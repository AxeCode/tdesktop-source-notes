# 第 7 章：History 消息模型 —— 实体、会话、视图不是一回事

<div class="chapter-meta"><span>M07</span><span>难度：核心</span><span>建议 45 分钟</span><span>关键词：HistoryItem / blocks / view</span></div>

> `history/` 是仓库中最大的主线目录之一。读懂它的关键不是硬啃上万行 Widget，而是先把 `History`、`HistoryItem`、`HistoryView::Element` 三层分开。

## 1. 三层对象

| 层 | 对象 | 负责 | 不负责 |
|---|---|---|---|
| 会话聚合 | `History` | peer/thread、消息索引、加载边界、未读、聊天列表状态 | 具体气泡绘制 |
| 消息实体 | `HistoryItem` 及子类 | id、flags、文本、media、reply、发送/已读状态 | 屏幕坐标和可见区 |
| 视图表现 | `HistoryView::Element/Message/Service` | layout、paint、hit test、选择、动画 | 网络事实和持久身份 |

同一 HistoryItem 可以暂时没有 main view；视图被虚拟化销毁后，消息实体仍存在。反过来，某些管理日志/预览 view 也可能不是主历史中的普通 entry。

## 2. History 是 thread 的状态聚合

[`History`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/history/history.h) 绑定一个 `PeerData`，并关联 `Data::Session` owner。它管理：

- message items 与按 id 查找；
- 已加载顶部/底部、缺口与分页；
- inbox/outbox read till 与 unread count；
- chat list message、folder、pinned/filter 状态；
- drafts、send actions、typing；
- main view blocks 和重布局；
- forum topic / saved sublist 等 thread 派生。

所以 History 的存在价值是“把消息流和对话列表中的这个会话节点统一起来”。

## 3. HistoryItem 的类型层次

协议 `MTPMessage` 至少可能是普通消息、服务消息或 empty。Data 层创建相应 HistoryItem：

- 普通 `HistoryMessage`：文本、media、reply markup、reactions 等；
- `HistoryService`：加入群、置顶、通话、礼物等服务动作；
- 特殊/本地项：sending、日期分隔、迁移等辅助状态。

基类保存共同身份与 flags，子类把变化频繁、类型特有的数据放到 components/owned media 中，避免每条普通消息都承担所有功能字段。

## 4. 从 MTPMessage 到 HistoryItem

<div class="flow">Api::Updates / history RPC
  → Data::Session::processMessages / addNewMessage
  → resolve peer + FullMsgId
  → Data::Session::history(peer)
  → History::addNewMessage
      ├─ validate id / type / existing
      ├─ createItem(...)
      ├─ owner.registerMessage(item)
      ├─ applyMessageChanges(...)
      └─ addNewItem(...)
  → History change notifications
  → HistoryView list updates</div>

[`History::addNewMessage`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/history/history.cpp#L623) 会先判断是否已存在、是 Existing 还是 Unread/New，决定是否应用对话级副作用，再插入主视图。

## 5. 消息身份和本地 ID

服务器消息使用正 `MsgId`；正在发送的本地项使用本地分配区间。`FullMsgId` 加上 PeerId 避免频道作用域冲突。

发送成功后不能简单“删本地项、建服务端项”，否则：

- UI 动画和选中状态丢失；
- reply/upload/progress 引用断裂；
- notification/playlist/shared media index 短暂重复。

系统通过 random_id 和 message id update 对账，在原实体周围迁移身份与状态。

## 6. Blocks 与消息列表虚拟化

聊天可能有几十万条消息，不可能为所有消息长期创建完整 QWidget。HistoryView 使用自绘元素和 blocks：

- item 保留领域状态；
- main view element 保存测量/绘制信息；
- blocks 聚合连续 elements 与高度；
- list widget 根据 viewport 计算可见范围；
- 滚动、插入和尺寸变化只更新受影响区间。

这也是为什么定位“屏幕上的第 N 个气泡”不能只对 History 的 item vector 做简单索引：日期条、未读条、隐藏/折叠、service item 和 topic 都会影响视图结构。

## 7. Layout 与 paint 分离

`HistoryView::Element` 及 media views 通常有：

- 尺寸/布局计算；
- draw/paint；
- text state / hit test；
- selection 与 context menu；
- animation/state update。

数据 flag 变化可能只需 repaint，也可能改变高度并触发 relayout。`Data::MessageUpdate::Flags` 与 view 的依赖决定成本。

调 UI 性能时先判断：问题是 paint 太慢，还是一次小变更错误触发了全列表 resize。

## 8. 分页不是“append 一页”

打开聊天时，历史可围绕某个消息加载，而不是永远从底部开始。状态包括：

- loaded at top / bottom；
- around id；
- unread anchor；
- migrated history；
- forum topic root；
- scheduled/saved sublist 独立 section。

请求返回后需要把 slice 合并到已有 item map、保留滚动锚点、处理重叠去重，并更新加载边界。分页 bug 往往出现在“从中间打开 + 上下加载 + 同时收到新 update”的组合。

## 9. 未读状态是多变量模型

History 同时维护：

- inbox read till；
- outbox read till；
- unread count；
- unread mentions/reactions；
- muted/folder 对 badge 的影响；
- unread bar 的视图位置。

`updateReadHistoryInbox` 不只是把气泡打勾，它还可能改变 dialog row、folder badge、Domain 总 badge 和通知清理。

因此所有 read mutation 应走 History/Data 提供的方法，不能只改一个 item flag。

## 10. Media 作为消息组件

照片、文档、网页、投票、位置、联系人、游戏等由 `HistoryMedia`/view media 层表达。领域 media 指向 Data::Session 中稳定的 `PhotoData / DocumentData / WebPageData`；view media 处理布局和交互。

这实现多处复用：同一 DocumentData 可以出现在聊天、shared media、播放器和下载列表，它的加载状态更新能传播给所有消费者。

## 11. destroy 是一条事务式路径

[`History::destroyMessage`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/history/history.cpp) 会：

1. 从 history entry 与 message components 移除；
2. 更新 shared media storage；
3. 处理 itemRemoved 与 chat list；
4. 若仍 sending，取消本地 API item；
5. 从 Data::Session 注销；
6. 清 notification；
7. 最后从 owning set erase。

这个顺序保证任何观察者都不会在 map 中看到已析构对象。把 item 当普通 `unique_ptr` 删除会破坏多个索引。

## 12. 一个渲染问题怎么查

### 数据存在但看不见

先查 Data::Session 的 message map，再查 item 是否 `isHistoryEntry`、是否有 `mainView()`、是否位于 loaded blocks，最后查 viewport。

### 文本更新但高度没变

查 updateEditedMessage 是否发出 Text/Media/Layout 相关 flags，Element 是否标记 resize，block 高度是否向 list widget 传播。

### 滚动跳动

查插入前后的 anchor item 与 offset，异步媒体尺寸变化是否保持 anchor，顶部 load 是否把高度增量错误加到当前位置。

### 消息残影

查 destroy 是否走完整路径、view element 是否 detach、repaint rect 是否覆盖旧区域。

## 13. 最小阅读集

<div class="source-card">
<p><strong>实体：</strong>history/history.h · history/history.cpp · history/history_item.h · history/history_item.cpp</p>
<p><strong>视图：</strong>history/view/history_view_element.* · history_view_message.* · history_view_list_widget.*</p>
<p><strong>入口：</strong>data/data_session.cpp 的 processMessages/addNewMessage · api/api_updates.cpp 的 message updates</p>
</div>

先读头文件和 `addNewMessage/destroyMessage`，再选一个具体 media view。直接从 `history_widget.cpp` 第一行读到最后一行，投入产出比极低。

## 14. 小结

History 是会话状态聚合，HistoryItem 是稳定消息实体，HistoryView::Element 是可丢弃/重建的展示对象。Data::Session 保证身份，Updates 保证顺序，History 保证对话不变量，View 只把当前切片高效画出来。

下一章沿反方向走一遍：用户按下发送后，本地 item 如何先出现、请求如何发出、server id 如何对账、失败又如何回滚。

