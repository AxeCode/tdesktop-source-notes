# 第 4 章：MTProto 请求管线 —— 从强类型 RPC 到正确的数据中心

<div class="chapter-meta"><span>M04</span><span>难度：核心</span><span>建议 40 分钟</span><span>关键词：TL / Sender / Instance / DC</span></div>

> 本章不推导 MTProto 密码学，而是拆解客户端工程问题：业务层如何描述请求、回调如何绑定 owner、请求如何选择 DC、连接失败或迁移时谁负责重试，以及 push update 在哪里重新进入业务世界。

## 1. 先分清四个抽象层

| 层 | 代表对象 | 关心的问题 |
|---|---|---|
| 产品语义 | `ApiWrap`, `api/*` | “发送消息”“加载历史”“更新隐私” |
| 请求门面 | `MTP::Sender`, request builder | done/fail/cancel、request id、owner 生命周期 |
| 实例编排 | `MTP::Instance` | main DC、跨 DC 路由、config、auth keys、sessions |
| 传输执行 | `MTP::Session`, `Connection` | 加密消息、ack、重发、连接状态、socket/HTTP transport |

业务代码通常只需要前两层。只有处理文件 DC、main DC migration、代理或连接状态时，才应向下进入 Instance/Session。

## 2. TL 让协议成为类型

`api.tl` 中一条 method 定义同时给出：

- constructor id；
- flags bit 与可选参数的关系；
- 参数顺序和 wire type；
- 返回类型。

生成器把它变成 C++ 类型。以 `messages.sendMessage` 为例，业务层构造 `MTPmessages_SendMessage`，编译器即可检查字段类型；返回值静态是 `MTPUpdates`，`done` 回调也因此获得具体类型。

TL 的 sum type 使用 `match` 或 `type()/c_xxx()` 分派。看到 `MTPUpdates` 时不要把它当一个扁平 struct；它可能是 `updates`、`updatesCombined`、`updateShortMessage` 等多个 constructor。

## 3. Sender 的 builder 模式

典型调用：

```cpp
request(MTPupdates_GetState()
).done([=](const MTPupdates_State &result) {
    stateDone(result);
}).fail([=](const MTP::Error &error) {
    differenceFail(error);
}).send();
```

它表达了一个生命周期：

1. `request(query)` 创建 builder；
2. `.done(...)` 注册成功处理；
3. `.fail(...)` 注册 RPC/transport 失败处理；
4. 选配 `.toDC(...)`、`.after(...)`、`.handleFloodErrors()` 等策略；
5. `.send()` 分配 request id 并交给 Instance；
6. owner 销毁或显式 `request(id).cancel()` 时撤销回调。

`MTP::Sender` 的价值不只是语法好看。它把 pending callbacks 归属到一个业务 owner，减少“页面已经销毁但网络回调仍访问 this”的风险。

## 4. request id 是控制句柄

很多业务服务保存 `mtpRequestId`：

- 再次触发同一加载时先取消旧请求；
- 防止重复并发；
- 回调结束把 id 清零；
- 析构时由 Sender 统一取消。

它不是服务端消息 ID，而是客户端 pending RPC 的句柄。调试“为什么没发第二次”时，先看 request id 是否因为失败分支漏清而一直非零。

## 5. Instance 负责跨 DC 世界

[`MTP::Instance`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/mtproto/mtp_instance.h) 由一个 Account 拥有。它维护：

- environment 与 config；
- main DC id；
- DC options 与代理；
- auth key 集合；
- main、upload、download 等逻辑 session；
- request callback maps 与 update handler；
- connection state 和 config refresh。

上层给出 request 和可选 DC 约束，Instance 解析目标 session。文件 location 自带 dcId；普通授权请求多走 main DC；下载代码还会用 shifted id 区分同 DC 的并行下载 session。

## 6. 一个请求的下行路径

<div class="flow">ApiWrap / api service
  → MTP::Sender::request(query)
  → RequestBuilder::send
  → MTP::Instance::send
  → choose / create MTP::Session for DC
  → Session::sendPrepared / queue
  → Connection transport
  → serialize TL + encrypt + msg_id/seq_no
  → socket / HTTP / proxy</div>

下层还要处理 message container、ack、salt/session 变化、bad message、时间偏差和重连。对业务层而言，这些细节应尽量折叠成“done、fail 或继续 pending”。

## 7. 上行有两类：result 与 unsolicited Updates

### 7.1 RPC result

收到 `rpc_result` 后，Instance 按 request id 找 callback，解析为请求声明的返回类型，再回到发起 owner。回调可能调用 `ApiWrap::applyUpdates(result)`，把返回的 Updates 交给统一同步引擎。

### 7.2 Push Updates

没有对应 request 的 update 从 `Session` 到 `Instance::processUpdate`，再通过 Account 的 `mtpUpdates()` producer 交给 `Api::Updates`。这条路径不依赖当前 UI 是否打开。

因此不要假设“所有状态变化都来自我的 done 回调”。另一个设备的动作、服务端定时事件、对方消息都只走 push。

## 8. DC migration 为什么不该由每个业务函数处理

Telegram RPC 可能返回 `PHONE_MIGRATE_X / NETWORK_MIGRATE_X / USER_MIGRATE_X / FILE_MIGRATE_X`。正确处理往往包括：

1. 解析新 DC；
2. 确保目标 DC 有 config/auth；
3. 必要时导出/导入 authorization；
4. 重新投递请求；
5. 对 main DC 变更持久化。

这些属于 Instance/Session 的协议编排，而不是“发送消息”产品代码。集中处理才能保证所有 RPC 行为一致。

## 9. 错误不是一个维度

| 错误层 | 例子 | 典型策略 |
|---|---|---|
| transport | 断网、TLS/代理失败 | 重连、换地址、保持 pending |
| protocol/session | bad salt、session lost、time skew | 更新 salt/session、重发 |
| routing | migrate / wrong DC | 切 DC、授权迁移、重发 |
| rate limit | flood wait | 框架延迟或交给业务显示 |
| product RPC | 权限不足、slow mode、premium required | 业务 fail handler 更新 UI/状态 |
| owner lifecycle | 页面/Session 已销毁 | 取消 callback，不再触发业务对象 |

“请求失败”若不标注层次，很难讨论正确修复位置。

## 10. 代理、域名解析与连接状态

Instance 监听 `Core::Application::proxyChanges()`，重建或更新连接。`connection_resolving.cpp`、domain resolver 和 special config request 提供在受限网络下获取可用 DC options 的路径。

业务 UI 只观察连接状态 producer；它不直接轮询 socket。连接状态也通常是多个 session 的汇总，因此“显示 Connecting”不一定意味着所有 DC 都断开。

## 11. 并发与主线程回切

网络、加解密和媒体可能在工作线程；Data/UI 变更通常必须回主线程。代码使用 `crl::on_main(owner, callback)` 或 producer 调度边界。

调试时记录三件事：

1. callback 当前线程；
2. owner 是否仍存活；
3. 回主线程前捕获的是强引用、weak pointer 还是裸指针。

许多“偶现 crash”不是协议错误，而是 async owner 边界错误。

## 12. 读请求代码的五步模板

碰到任意 RPC，按这个顺序：

1. 在 `.tl` 查 method 和返回类型；
2. 找业务构造点，列出 flags 与输入身份；
3. 看是否 `.toDC/.after/handleFloodErrors`；
4. 检查 done、fail 是否都清 request id / 更新本地状态；
5. 查返回是否调用 `applyUpdates`，以及同类事实是否也可能从 push 到达。

## 13. 调试入口

<div class="source-card">
<p><strong>高层：</strong>apiwrap.h / apiwrap.cpp / api/*.cpp</p>
<p><strong>请求所有权：</strong>mtproto/sender.h / sender.cpp</p>
<p><strong>路由与回调：</strong>mtproto/mtp_instance.h / mtp_instance.cpp</p>
<p><strong>传输：</strong>mtproto/session.cpp / session_private.cpp / connection.cpp</p>
<p><strong>协议：</strong>mtproto/scheme/api.tl / mtproto.tl</p>
</div>

## 14. 小结

业务请求通过 TL 生成类型获得静态结构，通过 Sender 获得 owner-aware 回调，通过 Instance 获得 DC 路由和会话恢复，通过底层 Session/Connection 获得可靠传输。服务端事实再以 RPC result 或 push Updates 回到统一同步层。

下一章专门分析 Updates：为什么“收到了包”仍不能立刻应用，以及客户端怎样用 pts/seq/difference 修复世界线。

