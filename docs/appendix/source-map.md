# 源码地图：从任务反查入口

这份地图不是目录树的复读，而是回答“我要理解或调试某种行为，最少先打开哪些文件”。路径都相对于仓库根目录；链接固定到上游 `v7.0.6`。

## 进程与生命周期

| 任务 | 第一入口 | 配套文件 | 观察重点 |
|---|---|---|---|
| 启动参数、路径、日志 | [`core/launcher.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/core/launcher.cpp) | `platform/*/launcher_*` | 平台启动钩子、工作目录、Updater |
| Qt 事件循环与单实例 | [`core/sandbox.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/core/sandbox.cpp) | `core/external_control.cpp` | QLockFile、QLocalServer、退出顺序 |
| 进程级服务根 | [`core/application.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/core/application.cpp) | `core/application.h` | Domain、窗口、媒体、通知的创建顺序 |
| 多账号切换 | [`main/main_domain.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/main/main_domain.cpp) | `main/main_account.cpp` | active variable、账号槽位、session changes |
| 登录会话建立 | [`main/main_session.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/main/main_session.cpp) | `main/main_account.cpp` | 服务聚合、Data::Session 创建、启动异步读盘 |

## 网络与同步

| 任务 | 第一入口 | 配套文件 | 观察重点 |
|---|---|---|---|
| 发起 RPC | [`mtproto/sender.h`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/mtproto/sender.h) | `mtp_instance.cpp`, `session.cpp` | builder、request id、回调 owner、DC 路由 |
| 连接与 transport | [`mtproto/session.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/mtproto/session.cpp) | `session_private.cpp`, `connection.cpp` | 加密 session、重连、ack、容器 |
| 业务 API 门面 | [`apiwrap.h`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/apiwrap.h) | `apiwrap.cpp`, `api/*.cpp` | 产品操作到 TL 请求的转换 |
| 接收 Updates | [`api/api_updates.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/api/api_updates.cpp) | `api/api_pts_waiter.*` | seq/pts 缺口、difference、应用顺序 |
| TL schema | [`mtproto/scheme/api.tl`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/mtproto/scheme/api.tl) | `scheme/mtproto.tl`, `codegen/scheme` | constructor、flags、生成类型 |

## 数据与消息

| 任务 | 第一入口 | 配套文件 | 观察重点 |
|---|---|---|---|
| 领域对象仓库 | [`data/data_session.h`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/data/data_session.h) | `data_session.cpp` | peers/messages/histories 的身份映射 |
| 变更广播 | [`data/data_changes.h`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/data/data_changes.h) | `data_changes.cpp` | flags 合并、realtime 与批量通知 |
| Peer 层次 | [`data/data_peer.h`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/data/data_peer.h) | `data_user.*`, `data_chat.*`, `data_channel.*` | 公共能力与类型特有状态 |
| 会话聚合 | [`history/history.h`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/history/history.h) | `history.cpp` | item 注册、blocks、unread、chat list |
| 消息实体 | [`history/history_item.h`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/history/history_item.h) | `history_item.cpp`, `history_message.*` | flags、media、reply、view 创建 |
| 发送文本 | [`apiwrap.cpp#L4579`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/apiwrap.cpp#L4579) | `data/data_histories.cpp` | 本地 ID、random_id、乐观 item、回包对账 |
| 应用新消息 | [`api/api_updates.cpp#L1304`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/api/api_updates.cpp#L1304) | `data_session.cpp`, `history.cpp` | update 类型分派、去重、History 插入 |

## 界面与导航

| 任务 | 第一入口 | 配套文件 | 观察重点 |
|---|---|---|---|
| 窗口级控制 | [`window/window_controller.h`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/window/window_controller.h) | `window_controller.cpp` | account/window 关系、layer/box |
| 登录会话导航 | [`window/window_session_controller.h`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/window/window_session_controller.h) | `window_session_controller.cpp` | active chat、section stack、memento |
| 三栏主内容 | [`mainwidget.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/mainwidget.cpp) | `mainwidget.h` | dialogs/history/info 的布局协作 |
| 消息列表 | [`history/view/history_view_list_widget.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/history/view/history_view_list_widget.cpp) | `history_view_element.*` | 虚拟化、可见区、元素复用 |
| 消息绘制 | [`history/view/history_view_message.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/history/view/history_view_message.cpp) | `history_view_element.cpp`, `media/` | layout 与 paint 分离、media view |
| 对话列表 | [`dialogs/dialogs_widget.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/dialogs/dialogs_widget.cpp) | `dialogs_inner_widget.cpp` | filter、row、active entry |

## 媒体、存储与通话

| 任务 | 第一入口 | 配套文件 | 观察重点 |
|---|---|---|---|
| 通用文件加载 | [`storage/file_download.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/storage/file_download.cpp) | `file_download_mtproto.cpp`, `file_download_web.cpp` | local-first、缓存/文件、进度 producer |
| MTProto 下载调度 | [`storage/download_manager_mtproto.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/storage/download_manager_mtproto.cpp) | `download_manager_mtproto.h` | DC 队列、优先级、动态 session 数量 |
| 流媒体 | [`media/streaming/media_streaming_instance.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/media/streaming/media_streaming_instance.cpp) | `media_streaming_reader.cpp` | FFmpeg reader、线程切换、frame/update |
| 播放器编排 | [`media/player/media_player_instance.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/media/player/media_player_instance.cpp) | player widget/panel | song/voice 状态、playlist、通话暂停 |
| 本地密钥与账号表 | [`storage/storage_domain.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/storage/storage_domain.cpp) | `storage_encryption.*` | passcodeKey → localKey → encrypted info |
| 分账号文件 | [`storage/storage_account.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/storage/storage_account.cpp) | `localstorage.cpp` | map、MTP auth、drafts、stickers、settings |
| 一对一通话 | [`calls/calls_call.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/calls/calls_call.cpp) | `calls_instance.cpp`, controller_webrtc | 信令状态机、DH/emoji、媒体控制器 |
| 群组通话 | [`calls/group/calls_group_call.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/calls/group/calls_group_call.cpp) | group panel/members | participant updates、SSRC、join payload |

## 用五个问题快速定位未知功能

1. 它是进程级、账号级、登录会话级，还是窗口级状态？
2. 它的服务器事实来自 RPC result 还是 Updates？
3. 它的稳定身份是 PeerId、FullMsgId、DocumentId 还是其他复合 key？
4. UI 是直接读取当前值，还是订阅 Data::Changes / rpl producer？
5. 销毁 session、切账号、关窗口或取消请求后，谁终止回调？

回答完这五个问题，通常能把搜索范围从整个仓库缩到 3–8 个文件。
