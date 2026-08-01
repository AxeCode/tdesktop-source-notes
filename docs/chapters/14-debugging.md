# 第 14 章：调试与源码阅读方法 —— 从现象找到唯一事实源

<div class="chapter-meta"><span>M14</span><span>难度：实践</span><span>建议 35 分钟</span><span>关键词：invariant / trace / ownership</span></div>

> 百万行项目里最浪费时间的方式，是从报错所在行漫无目的地向外读。本章给出一套“先分类、再定身份、沿事实流、验证不变量”的操作方法。

## 1. 先判断问题属于哪条链

把现象放进下列一类：

1. **生命周期**：启动、切账号、退出、对象已销毁；
2. **请求**：RPC 未发、未回、被取消、DC/代理；
3. **一致性**：更新乱序、缺口、重复、difference；
4. **身份**：PeerId/FullMsgId/random_id 映射错误；
5. **派生状态**：未读、badge、列表排序；
6. **投影**：Data 正确但 rpl/UI 未刷新；
7. **I/O**：存储、缓存、下载、解码；
8. **平台**：原生事件、权限、打包、资源。

分类错误会让你在 Widget 里修协议 bug，或在 MTProto 里修 lifetime bug。

## 2. 记录“身份四元组”

跨层跟踪一条行为时，至少记录：

```text
Account/Session identity
PeerId or DC id
FullMsgId / random_id / request id
object pointer + lifecycle owner
```

日志只写“received message 123”几乎没用，因为频道消息 123 不唯一，也不知道属于哪个账号。

## 3. 寻找唯一事实源

问：这个字段最终由谁定义？

| 状态 | 唯一事实源候选 |
|---|---|
| 服务端消息内容 | HistoryItem，经 Updates/Data::Session 更新 |
| 当前激活账号 | Main::Domain::_active |
| 页面 active chat | Window::SessionController active entry |
| 下载进度 | FileLoader/Download task |
| 播放状态 | Media::Player::Instance |
| 本地 passcode 验证 | Storage::Domain passcodeKey |
| 通话状态 | Calls::Call |

UI label、缓存副本和临时 request struct 通常只是投影，不应在那里强行修事实。

## 4. 从现象向上与向下各走一步

例如“编辑消息后界面不刷新”：

- 向上：updateEditMessage 是否到达、seq/pts 是否通过；
- 当前层：Data::Session 是否更新同一个 HistoryItem；
- 向下：MessageUpdate flags 是否发出、Element 是否 resize/repaint。

只要三层都证实，问题范围就能缩到具体桥接，而不是继续遍历整个仓库。

## 5. 断点比全文阅读更有信息量

选择能观察状态转移的断点，而不是每个 getter：

- 构造/销毁：Account::createSession、Session::~Session；
- 请求边界：Sender send、done/fail；
- 一致性：Updates::applyUpdates、getDifference；
- 身份：Data::Session::addNewMessage/register/unregister；
- UI：Changes fire、订阅 on_next、showSection；
- I/O：FileLoader::start/finish、Storage read/decrypt。

每个断点只记录输入身份、旧状态、新状态、下一跳。

## 6. 用不变量而不是猜测

### 生命周期不变量

- child 不应晚于 owner 接收回调；
- producer 订阅必须绑定能覆盖 callback 使用对象的 lifetime；
- logout 后 Data::Session 的实体指针全部失效。

### Updates 不变量

- 只有连续 pts/seq 才推进 state；
- gap 恢复时不并行应用越过基线的更新；
- updateMessageID 在正式 sent message 前完成对账。

### 数据不变量

- 一个 Data::Session 内同一稳定 ID 对应同一实体；
- HistoryItem 注册/注销与 owning History 同步；
- UI 不成为服务端事实源。

### 存储不变量

- passcodeKey 只用于解包 localKey；
- 顺序序列化的新字段只追加；
- cache 清理不触碰授权与账号表。

找到被破坏的不变量，根因往往比表面堆栈更清楚。

## 7. 处理异步竞态的时间线

对偶现问题画时间线：

```text
T0 user action / request start
T1 owner switches account or page closes
T2 network/work thread completes
T3 callback queued to main
T4 owner destruction / new state
T5 callback runs
```

检查 T0 捕获了什么、T1/T4 谁改变身份、T5 通过什么 guard。许多问题并非多线程同时写，而是“单线程回调在错误的逻辑时代运行”。

## 8. 区分可重试与不可重试

| 类型 | 例子 | 策略 |
|---|---|---|
| 短暂 transport | 断网、timeout | 底层重连/保持 pending |
| 可恢复协议 | migrate、bad salt、file reference | 刷新状态并有界重试 |
| 一致性缺口 | pts/seq gap | getDifference |
| 产品拒绝 | 权限、slow mode、付费 | 更新本地状态并反馈用户 |
| 数据损坏 | decrypt/hash/schema 错 | 停止读取、保护原文件、显式恢复 |
| owner 消失 | 页面关闭/logout | 取消，不重试到新 owner |

把所有 fail 都“再试一次”会制造重复请求和无限循环。

## 9. 性能问题的分层测量

### 启动慢

区分同步读盘、解密、构造对象、首次网络和首帧绘制。第 3 章提到的 on_main_queue 切片能作为阶段标记。

### 滚动卡

区分 producer 高频触发、layout invalidation、paint、图片 decode、GPU upload。不要看到 history_widget 大就默认它是热点。

### 下载慢

区分服务器/DC、queue priority、session 并发、磁盘写和 decoder 消费速度。

### CPU 高

先找事件频率 × 单次成本。一个 0.1 ms 的回调每帧对几千项执行，比一个偶发 20 ms 操作更糟。

## 10. 日志应回答问题，不应倾倒对象

推荐结构化字段：

```text
event=update_apply account=... peer=... type=... pts=... current=...
event=message_reconcile random=... local=... server=...
event=download_part dc=... session=... offset=... bytes=... duration=...
```

避免输出文本内容、手机号、auth key、localKey、完整请求 payload。敏感数据泄漏不是调试的合理代价。

## 11. 修改前先做最小复现

一个好的复现明确：

- 单账号还是多账号；
- 私聊、群、频道还是 forum topic；
- 在线、断网、休眠恢复；
- fresh start 还是已有 tdata；
- 当前窗口/另一个窗口；
- 首次动作还是重试；
- 是否涉及 scheduled、reply、media。

Telegram 功能组合多，模糊复现会把多个状态机混在一起。

## 12. 验证矩阵

修复不能只重跑 happy path。按风险选择相邻维度：

| 修改 | 最少相邻验证 |
|---|---|
| 发送 | success、RPC fail、断网恢复、重复 Updates、reply/topic |
| Updates | 连续、重复、gap、difference slice、频道独立 pts |
| UI subscription | 页面关闭、切账号、切 peer、窗口销毁 |
| 存储 | 新文件、旧文件、字段缺失、错误 passcode、写失败 |
| 媒体 | cache hit/miss、取消、partial、不同 DC、seek |
| 平台 | 目标平台 + 至少编译检查其他平台接口 |

## 13. 推荐搜索策略

1. `rg "Class::method"` 找定义；
2. `rg "method\("` 找调用；
3. 先读 `.h` 成员和公开 producer；
4. 查 constructor/destructor 确定 owner；
5. 查 TL/schema/style/strings 是否为生成源；
6. 用 git blame/log 只解释“为什么这样改”，不替代当前代码阅读；
7. 最后才扩到大目录。

## 14. 一套完整示例：消息重复

1. 记录重复两项的 FullMsgId、random_id、指针；
2. 在 `Updates::applyUpdates` 确认 result/push 到达次数；
3. 检查 `feedMessageIds` 是否先于 new message；
4. 检查 random map 是否被过早移除；
5. 在 `Data::Session::addNewMessage` 看 existing lookup；
6. 在 `History::addNewMessage` 看 detachExisting/newMessage；
7. 若实体只有一个，再进入 view 检查重复 element；
8. 用断网/重连和 RPC/push 反序复现验证。

这条路径从协议到视图逐层排除，不会一开始就在 UI 删除“重复气泡”掩盖身份 bug。

## 15. 全书收束

现在可以把整个项目压缩为一个调试公式：

```text
现象
→ 找 owner 与稳定 identity
→ 找命令流或事实流
→ 检查顺序/生命周期不变量
→ 在唯一事实源修复
→ 验证相邻失败与销毁路径
```

你不需要记住 106 万行代码。只要掌握 Launcher/Sandbox/Application 的进程骨架，Domain/Account/Session 的所有权，MTP/Updates 的事实流，Data/History 的身份与不变量，以及 Controller/rpl 的投影方式，就能持续推导陌生功能的位置。

接下来可以使用[源码地图](/appendix/source-map)按任务反查入口，或回到任一章节跟着断点实际走一遍。

