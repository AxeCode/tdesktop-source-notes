# 术语表

| 术语 | 在 tdesktop 中的含义 | 容易混淆的点 |
|---|---|---|
| `Core::Launcher` | 解析启动参数、准备路径/日志/平台环境并创建 Qt 应用的前置层 | 不是业务 Application，也不是平台窗口 |
| `Core::Sandbox` | `QApplication` 子类；Qt 事件循环、单实例 IPC、应用对象创建与退出编排 | 名字不是“安全沙箱”的承诺 |
| `Core::Application` | 进程级业务根对象，持有 Domain、窗口、媒体、通知和全局服务 | 不等于 `QApplication` |
| `Main::Domain` | 一个本地数据目录中的账号集合与当前激活账号 | Telegram 的网络 domain 不是这里的 Domain |
| `Main::Account` | 一个授权槽位；拥有 MTProto 实例、账号本地存储与可选登录 Session | Account 在未登录时也可以存在 |
| `Main::Session` | 已登录用户的运行时服务容器 | 与 MTProto transport session 不是同一个概念 |
| `Data::Session` | 已登录用户的内存领域仓库，统一拥有 peers、histories、messages 等实体 | 它被 `Main::Session` 拥有，不负责网络连接本身 |
| `MTP::Instance` | 跨 DC 的 MTProto 客户端编排入口 | 下层还有每 DC / transport 的 session 与 connection |
| `ApiWrap` | 面向产品语义的 API 门面与高层操作集合 | 不是所有 API 都在这个大文件里；许多已拆到 `api/` |
| `Api::Updates` | 维护 seq/pts/qts/date、应用 Updates、发现缺口并请求 difference | 它同时处理全局和频道两套一致性路径 |
| `PeerData` | User/Chat/Channel 的公共基类 | `PeerId` 编码了 peer 类型；不要只看裸数值 |
| `History` | 某个 peer/thread 的会话聚合、消息索引和聊天列表状态 | 不是简单 `std::vector<HistoryItem>` |
| `HistoryItem` | 一条消息或服务消息的领域对象 | 视图对应物是 `HistoryView::Element` |
| `FullMsgId` | `PeerId + MsgId` 的全局可定位消息身份 | 普通 `MsgId` 在不同频道可能冲突 |
| `random_id` | 客户端发送请求的幂等/对账标识 | 不等于最终服务器消息 ID |
| `pts` | 更新序列位置；配合 `pts_count` 检测是否连续 | 频道维护独立 PTS |
| `seq` | Updates 容器的全局序号 | 不应和消息 ID 或 PTS 混用 |
| `qts` | 与加密/特殊更新队列相关的序列位置 | 大部分普通消息阅读不先深入它 |
| `DC` | Telegram 数据中心 | 主 DC、媒体 DC、下载 shift 会影响请求路由 |
| `TL` | Telegram Type Language；从 `.tl` schema 生成强类型 C++ | 生成类型名常带 `MTP` 前缀和 constructor 分支 |
| `rpl::producer<T>` | 惰性的值/事件序列 | producer 本身不一定持有数据 |
| `rpl::variable<T>` | 当前值 + 后续变化 | `value()` 与 `changes()` 语义不同 |
| `rpl::event_stream<T>` | 主动 fire 的事件源 | 通常对外暴露 `events()` producer |
| `rpl::lifetime` | 订阅和异步链的取消边界 | 忘记绑定会造成悬挂回调或过期更新 |
| `crl::on_main` | 把任务切回主线程执行 | 它同时形成异步边界，需要弱引用/owner guard |
| `Memento` | 可保存并恢复一个页面/section 的导航状态 | 不是数据库持久化对象 |
| `tdata` | Telegram Desktop 本地工作数据目录 | 里面既有全局映射，也有分账号加密文件和缓存 |
| `localKey` | 用于保护账号本地数据的随机密钥 | 本地 passcode 派生的是保护 localKey 的 key，不直接逐文件加密 |
