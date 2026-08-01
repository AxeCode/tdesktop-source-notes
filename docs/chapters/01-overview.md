# 第 1 章：全貌 —— 百万行客户端的稳定骨架

<div class="chapter-meta"><span>M01</span><span>难度：入门</span><span>建议 25 分钟</span><span>关键词：边界 / 所有权 / 数据流</span></div>

> 本章先不钻函数细节，而是回答三个问题：Telegram Desktop 到底由哪些长期稳定的层构成？一次用户动作会穿过哪些边界？在 106 万行 C++ 中，哪些对象是后续所有章节的坐标轴？

## 1. 为什么这个项目难读

Telegram Desktop 的难点不只在规模。它同时是：

- 一个跨 Windows、macOS、Linux 的 Qt 桌面应用；
- 一个长连接、弱网恢复、多数据中心的 MTProto 客户端；
- 一个本地状态丰富、可离线浏览的消息数据库前端；
- 一个包含音视频、贴纸、WebView、支付、导出等重型子系统的平台；
- 一个以代码生成、响应式流和大量异步回调组织起来的 C++ 工程。

如果按目录顺序读，很快会被 `history`、`data`、`api`、`window` 之间的双向引用淹没。更好的办法是先记住一棵所有权树和两条数据流。

## 2. 一棵所有权树

<div class="flow">Core::Sandbox (QApplication / event loop)
└── Core::Application (process services)
    ├── Main::Domain (accounts in one tdata)
    │   ├── Main::Account #0
    │   │   ├── Storage::Account
    │   │   ├── MTP::Instance
    │   │   └── Main::Session (only after login)
    │   │       ├── ApiWrap / Api::Updates
    │   │       ├── Data::Session
    │   │       │   ├── PeerData objects
    │   │       │   ├── History objects
    │   │       │   └── HistoryItem objects
    │   │       ├── uploader / downloader
    │   │       └── feature services
    │   └── Main::Account #1 ...
    ├── Window::Controller(s)
    │   └── Window::SessionController
    ├── Media::Player::Instance
    ├── Notifications manager
    └── process-wide caches and services</div>

这里最容易犯的错，是把三个 `Session` 混在一起：

1. `Main::Session` 是“已登录用户的服务容器”；
2. `Data::Session` 是“这个用户的内存领域仓库”；
3. `MTP` 内部的 session 是“某个 DC 上的传输/加密会话”。

看到变量名 `session` 时，先确认命名空间，再继续推理。

## 3. 两条相反的数据流

### 3.1 命令流：从 UI 向服务器

<div class="flow">click / shortcut
  → HistoryView / Dialogs / Box
  → Window::SessionController
  → ApiWrap or api/* service
  → MTP::Sender request builder
  → MTP::Instance
  → DC session / connection
  → Telegram server</div>

界面通常不直接拼字节。它调用产品语义的方法，例如发送消息、归档对话或加载历史；高层 API 再把动作翻译成 TL 生成类型。

### 3.2 事实流：从服务器回到 UI

<div class="flow">Telegram server
  → MTProto response / push Updates
  → Api::Updates ordering & gap recovery
  → Data::Session entity normalization
  → History / HistoryItem mutation
  → Data::Changes + rpl producers
  → Window / Dialogs / HistoryView repaint</div>

命令流可以失败、取消或被重试；事实流必须处理乱序、重复和缺口。理解这一区别，是读消息发送和 Updates 的前提。

## 4. 六层心智模型

### 4.1 平台与进程层

[`core/launcher.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/core/launcher.cpp) 处理参数、路径、日志和平台初始化；[`core/sandbox.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/core/sandbox.cpp) 承担 Qt 事件循环、单实例 IPC 与退出；[`core/application.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/core/application.cpp) 才是产品运行时根。

边界原则：平台差异尽量停在 `platform/` 和 Launcher/Integration；业务对象不应该到处散落 `#ifdef`。

### 4.2 账号与授权层

`Main::Domain` 代表一个本地数据域，持有多个 `Main::Account`。Account 可以存在但尚未登录；登录成功后才创建 `Main::Session`。因此“账号槽位”“MTProto 授权”“已登录用户会话”不是同一件事。

这解释了为什么登录流程、添加账号和切换账号能复用窗口与进程服务，而不需要启动多个完整应用实例。

### 4.3 网络与协议层

`MTP::Instance` 对上提供请求发送和 Updates 入口，对下管理 DC、连接、认证 key、重试和迁移。`MTP::Sender` 让业务层以 builder 风格注册 `done/fail`，避免直接操作底层 connection。

TL schema 位于 `mtproto/scheme/*.tl`。许多以 `MTPmessages_`、`MTPDupdate` 开头的类型不是手写类，而是生成代码。遇到陌生类型，先查 schema，再查使用点。

### 4.4 同步与领域数据层

`Api::Updates` 保证事件顺序并在缺口时请求 difference；`Data::Session` 把 wire format 归一化为有稳定身份的 peers、histories 和 messages；`Data::Changes` 把批量变更发给观察者。

这层的核心不变量是：同一个稳定 ID 在一个 Data::Session 中尽量对应同一个内存实体。UI 因此可以长期持有受控引用，而不是每次响应都重建对象图。

### 4.5 会话与消息层

`History` 不只是消息数组。它聚合一个 peer/thread 的消息、未读状态、草稿、聊天列表位置、顶部/底部是否加载等信息。`HistoryItem` 表示消息实体，`HistoryView::Element` 才表示某个视图中的布局和绘制对象。

分离实体与视图，让虚拟化、不同展示上下文和增量重绘成为可能。

### 4.6 展示与交互层

`Window::Controller` 管窗口与全局 layer/box；`Window::SessionController` 管登录会话中的导航、活动聊天和 section stack；`MainWidget` 协调对话列表、聊天和信息栏。

界面大量使用 rpl：状态源发出 producer，Widget 把订阅绑定到 lifetime。这样页面销毁时订阅自动停止，但也要求开发者明确 owner 和生命周期。

## 5. 关键数字说明了什么

本地快照中，`Telegram/SourceFiles` 约 2,800 个源文件、C/C++ 约 106 万行。体量最大的目录包括 `history`、`boxes`、`iv`、`ui`、`data`、`info` 和 `media`。

不要把行数误读成架构重要性：

- `history` 大，是因为消息展示组合爆炸；
- `boxes` 大，是因为产品功能多；
- `data` 是实体归一化中心；
- `mtproto` 行数相对小，却承担网络正确性；
- `main` 只有少量文件，却定义账号/会话所有权骨架。

因此源码阅读优先级应该由“控制多少状态和边界”决定，而不是由目录大小决定。

## 6. 三个贯穿全书的设计原则

### 原则一：稳定身份优先

Peer、History、Message、Document 都围绕稳定 ID 建立索引。网络回包、缓存恢复和 UI 订阅最终都落到同一实体上。身份不稳，就无法可靠去重、合并或增量更新。

### 原则二：先恢复一致，再谈展示

Updates 不会被无条件直接应用。代码先检查 seq/pts 是否连续；缺口进入等待或 difference；用户和 chat 等依赖实体先处理，message update 后处理。UI 看到的是经过排序和归一化的状态。

### 原则三：生命周期就是异步安全

响应式订阅、网络回调、跨线程任务都可能晚于发起者。tdesktop 使用 request owner、`rpl::lifetime`、weak pointer 和 `crl::guard` 把“对象还活着吗”编码进调用链。

## 7. 一个动作如何贯穿全栈：发送文本

以发送文本为例：

1. compose controls 构造 `MessageToSend`；
2. `ApiWrap::sendMessage` 清洗文本、切分超长内容、生成 local `MsgId` 和 `random_id`；
3. `History::addNewLocalMessage` 立即插入 sending item，界面不等待网络；
4. `Data::Histories::sendPreparedMessage` 发送 `messages.sendMessage`；
5. result / push Updates 带回 `updateMessageID` 和新消息；
6. Updates 先完成 random_id 到 server id 的对账，再应用消息事实；
7. HistoryItem 从 sending 过渡到 confirmed，Data::Changes 触发局部更新；
8. 失败时 `sendMessageFail` 标记或移除本地项，并处理慢速模式、权限、付费等错误。

这条链路同时展示了本地预测、协议幂等、更新一致性和增量 UI 四个主题，后续会分别深入。

## 8. 常见误区

| 误区 | 更准确的理解 |
|---|---|
| `ApiWrap` 就是整个网络层 | 它是业务门面；底下还有 Sender、Instance、Session、Connection |
| 收到 RPC result 就完成所有数据更新 | 很多事实通过 Updates 统一回流；result 和 push 可能协作 |
| History 就是聊天记录数组 | 它还是会话聚合与聊天列表状态节点 |
| Widget 持有所有页面状态 | 可恢复状态常在 controller/memento/data 层 |
| 本地 passcode 是服务端账号密码 | 它主要保护本机 local key 和 tdata |
| Session 只有一种 | 至少要区分 Main、Data 与 MTP 语境 |

## 9. 本章源码入口

<div class="source-card">
<p><strong>所有权骨架：</strong>core/application.h · main/main_domain.h · main/main_account.h · main/main_session.h · data/data_session.h</p>
<p><strong>数据流骨架：</strong>apiwrap.h · api/api_updates.h · history/history.h · window/window_session_controller.h</p>
</div>

读完这些头文件后，不必立刻进入巨型 `.cpp`。先画出成员字段的所有权和公开 producer，再到下一章理解它们怎样被构建出来。

## 10. 小结

Telegram Desktop 可以先被压缩成一句话：**平台入口建立进程级 Application，Application 管理多账号 Domain；每个已登录 Account 建立 Main::Session 和 Data::Session；MTProto/Updates 把服务器事实写进稳定领域实体；Window controller 和 rpl 把这些事实投影为界面。**

下一章会解释这棵树如何从 CMake、子模块、schema 和代码生成中被组装成一个可执行文件。

