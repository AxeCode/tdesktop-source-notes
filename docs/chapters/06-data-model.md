# 第 6 章：Data::Session 领域模型 —— 把协议快照变成稳定对象图

<div class="chapter-meta"><span>M06</span><span>难度：核心</span><span>建议 40 分钟</span><span>关键词：identity map / Peer / Changes</span></div>

> 协议返回的是一批 value objects；界面需要的是能被多个页面长期观察、增量更新且身份稳定的实体。`Data::Session` 就是二者之间的归一化边界。

## 1. 为什么不能直接把 MTP 对象给 Widget

假设 dialogs 回包、history 回包和 push update 各自带一份同一用户：

- 若每次创建新 User 对象，头像组件和资料页会观察不同实例；
- 缓存、权限和在线状态很难合并；
- 消息只存裸 MTP 数据会不断重复 sender/chat 信息；
- 编辑/删除必须遍历所有页面副本。

Data::Session 使用 identity map：按稳定 ID 找到或创建唯一实体，再把新字段合并进去。

## 2. Main::Session 与 Data::Session 的分工

| `Main::Session` | `Data::Session` |
|---|---|
| 网络 API、Updates、上传下载、设置和 feature service 容器 | peers、histories、messages、documents、photos 等实体仓库 |
| 知道 Account、MTP、Storage | 知道所属 Main::Session，但不拥有网络连接 |
| 控制登录会话生命周期 | 所有实体生命周期被登录会话包住 |
| 面向服务协作 | 面向身份、索引、变更与查询 |

这让 logout 形成清晰边界：销毁 Main::Session 就能一起销毁 Data::Session 和所有登录用户数据。

## 3. Peer 是第一根主轴

`PeerData` 是 User/Chat/Channel 的公共抽象。`PeerId` 编码类型，常见转换函数把 MTP peer 变成本地 PeerId。

[`Data::Session::processUsers/processChats`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/data/data_session.cpp) 大体执行：

1. 从 MTP constructor 提取 id/type；
2. 在 map 中找到或创建 `UserData / ChatData / ChannelData`；
3. 合并 access hash、名称、照片、权限、状态等字段；
4. 累积 `Data::PeerUpdate::Flags`；
5. 通知 Changes manager。

实体指针稳定，字段和 flags 变化。

## 4. “loaded” 与“存在”不是一回事

常见 API 有 `peer(id)`、`peerLoaded(id)`、`history(id)`、`historyLoaded(id)` 等语义差异：

- 创建占位对象不代表拿到了完整资料；
- 某 update 只包含最小 peer 引用；
- access hash 或 full info 可能需要额外 RPC；
- UI 可先显示占位，再订阅 FullInfo/Name/Photo flags。

读调用点时要看它需要“身份存在”还是“数据已加载”。误用 loaded 判定会导致无谓请求或空 UI。

## 5. Message 的全局定位

普通聊天消息 ID 与频道消息 ID 的作用域不同。代码使用 `FullMsgId{peerId, msgId}` 作为稳定定位；Data::Session 维护：

- peer → History；
- FullMsgId → HistoryItem；
- 非频道 msgId 的快速索引；
- random_id → local FullMsgId；
- 文档、照片、web page 等媒体 id maps。

因此更新删除/编辑消息时可以直接定位实体，而不是扫描所有 History。

## 6. process、add 与 update 三种语义

### `process*`

把一批协议对象归一化，既可能创建也可能合并。例如 `processUsers`、`processMessages`。

### `addNewMessage`

明确处理一个新到达的消息事实，决定 History、NewMessageType、未读/通知、dialog 排序与 view 插入。

### `updateExistingMessage / updateEditedMessage`

尽量在原对象上更新，保留引用稳定；同时产生精确 flags，触发需要的重绘或布局。

函数名字反映调用者对“这是快照、增量还是新事实”的承诺。

## 7. Changes：位标志驱动的增量通知

[`Data::Changes`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/data/data_changes.h) 为 Peer、History、Topic、Message、Story 等实体维护 manager。

每类 update 包含：

- 被改变的实体指针；
- flags：Name、Photo、UnreadView、Text、Media 等；
- realtime stream：立即观察；
- batched stream：合并后通知；
- `flagsValue`：先发当前值，再发后续匹配变化。

消费者通过 flags 只响应关心的变化。头像组件不必因为 unread count 改变而重新加载图片；聊天行不必因为与其无关的 media 内部状态做完整 layout。

## 8. realtime 与 batched 的取舍

有些逻辑必须立刻维护不变量，例如内部索引；多数 UI 可以等一批 Updates 完成再刷新。

Changes manager 因此区分：

- `realtimeUpdates`：mutation 发生时马上发；
- `updates`：把同一对象 flags 合并，稍后统一发；
- `sendHistoryChangeNotifications` 等 flush 点：在一致性批次边缘输出。

若一个订阅只为 repaint，优先 batched；若用于维护另一个同步索引，才考虑 realtime。

## 9. Data::Session 为什么很大

它不仅保存 core peer/message，还编排：

- chat filters、folders、pinned order；
- stickers、custom emoji、reactions；
- stories、saved messages、forums；
- shared media、drafts、downloads；
- documents/photos/webpages/games；
- unread badge 与 notifications 相关派生状态。

这是“统一身份仓库”的自然结果，也带来风险：不要把任意产品逻辑都继续塞进 Data::Session。新功能应让实体身份与跨功能索引留在 Data 层，把操作流程拆到 feature service。

## 10. 派生状态与唯一事实源

未读 badge、聊天列表顺序、置顶、静音等可能由多个字段派生。代码倾向于：

- 原始事实留在实体/History；
- Data::Session 提供汇总查询；
- Domain 汇总多个 Session 的 badge；
- Window/UI 只订阅最终 producer。

若 UI 自己重复计算，切账号、folder 或 muted 规则变化时容易分叉。

## 11. 数据清理与引用安全

`Session::clear()`、History clear、message destroy 必须同步：

1. 从 History blocks/indices 移除；
2. 从 Data::Session message map 注销；
3. 清 shared media 与 notifications；
4. 取消本地 sending request；
5. 让视图 element 解除关联；
6. 发出合适 change。

直接 `delete HistoryItem` 会绕开大量不变量。领域对象通常提供 `destroy()` 或 owner 方法，调用者不应自作主张管理内存。

## 12. 线程规则

Data::Session 绝大多数 mutation 发生在主线程。工作线程做文件、解码、网络后，通过 `crl::on_main` 返回。这样对象图本身通常不需要细粒度锁。

“主线程拥有可变领域状态，后台线程返回 immutable result”是这个客户端保持复杂度可控的重要策略。

## 13. 调试模板

| 问题 | 先看身份 | 再看 mutation | 最后看通知 |
|---|---|---|---|
| 用户名不刷新 | PeerId 是否同一 UserData | processUser 是否改 name | PeerUpdate::Name 是否发出 |
| 消息重复 | FullMsgId/random_id map | addNewMessage existing 分支 | History insert/change flush |
| 删除后仍显示 | message map 是否注销 | HistoryItem::destroy path | view element / repaint flags |
| badge 错 | 哪个 History/Folder | unread count 派生 | Session → Domain badge producer |
| 页面切换后崩溃 | 指针属于哪个 Data::Session | session 是否已销毁 | subscription lifetime 是否绑定 |

## 14. 本章结论

Data::Session 是 wire value 与长寿命 UI 之间的 identity boundary。它用稳定 ID 合并实体，用 History/Message 索引快速定位，用 Changes flags 做增量传播，并把所有状态限制在登录 Session 的生命周期内。

下一章把镜头对准最复杂的实体之一：History 与 HistoryItem 如何把消息事实组织成可分页、可虚拟化、可增量绘制的会话。

