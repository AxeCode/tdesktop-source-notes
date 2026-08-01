# 第 5 章：Updates 同步引擎 —— 在乱序、重复与丢包中修复世界线

<div class="chapter-meta"><span>M05</span><span>难度：核心</span><span>建议 45 分钟</span><span>关键词：pts / seq / difference / gap</span></div>

> Telegram Desktop 不是“收到一条 WebSocket 消息就 setState”。它维护一套版本向量式的更新位置，先验证连续性，再把事实写入领域模型；一旦发现缺口，就主动向服务器索取差异。

## 1. Updates 要解决什么

客户端可能经历：

- 短暂断网后积压更新；
- 多条更新被合并或拆分；
- 不同连接回包顺序变化；
- 进程休眠后服务器状态前进；
- 同一事实同时出现在 RPC result 与 push；
- 频道与全局更新使用不同序列；
- 当前缺少 update 所依赖的 User/Chat 数据。

如果直接按到达顺序应用，未读数、消息顺序、编辑/删除与权限状态都会漂移。

## 2. 四个位置字段

| 字段 | 作用 | 典型范围 |
|---|---|---|
| `pts` | 可计数更新的位置；配合 `pts_count` 验证连续性 | 普通 Updates；频道另有独立 pts |
| `seq` | updates container 的全局顺序 | `updates` / `updatesCombined` |
| `qts` | 特殊更新队列的位置 | 某些加密或专用更新 |
| `date` | 服务端更新日期/同步参考 | getDifference state 与在线状态 |

它们不是消息 ID。一个更新可以改变多个对象；一个消息 ID 也不能证明此前所有更新都已处理。

## 3. Updates 对象从哪里接入

`Api::Updates` 在 `Main::Session` 构造期间创建。构造函数订阅：

- `account().mtpUpdates()`：网络 push；
- `account().mtpNewSessionCreated()`：传输新 session；
- `Data::Changes` 的部分 peer 更新；

随后立即请求 `updates.getState`。`stateDone()` 初始化 pts/date/qts/seq，解除 PtsWaiter 的 requesting 状态，再请求 dialogs 并更新 online。

这说明登录后的第一步不是“直接信任新推送”，而是先建立同步基线。

## 4. Updates constructor 的第一层分派

[`Updates::applyUpdates`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/api/api_updates.cpp#L1469) 区分：

- `updates`：users/chats + vector updates + date/seq；
- `updatesCombined`：包含 seq_start 到 seq 的范围；
- `updateShort`：单个 update；
- `updateShortMessage / updateShortChatMessage`：紧凑消息，需要本地已有 peer 数据；
- `updateShortSentMessage`：发送确认的短形式；
- `updatesTooLong`：要求 difference。

对于 container，代码先处理 users/chats，再 feed update vector。这个顺序确保消息引用的 sender/peer 更可能已存在。

## 5. seq 缺口：先暂存，不猜测

收到 `updates` 时：

- `seq <= current`：视为已处理/过期，跳过；
- `seq == current + 1`：可以应用；
- `seq > current + 1`：放入 `_bySeqUpdates`，启动短 timer；
- timer 到期仍无法衔接：请求 `updates.getDifference`。

这是一种有界等待：网络重排可能很快自行修复，因此先等；但不能永远等，所以最终由服务器差异兜底。

## 6. pts 与 PtsWaiter

可计数 update 携带 `pts` 与 `pts_count`。直观连续条件是：

```text
new_pts == current_pts + pts_count
```

但实际还要处理多个 updates、重复和等待队列。`PtsWaiter` 把这些规则集中起来：可应用则推进位置，不连续则暂存/触发 getDifference。

频道使用自己的 pts 状态，因此 `updateNewChannelMessage` 等需要在频道上下文检查。全局 gap 走 `getDifference()`；频道 gap 走 `getChannelDifference(channel, reason)`。

## 7. difference 是恢复协议，不是普通刷新

全局恢复请求 `updates.getDifference(pts, date, qts, limits...)`。返回可能是：

- `differenceEmpty`：没有缺失，只更新 state；
- `differenceSlice`：只返回一片，应用后继续请求；
- `difference`：完整差异 + 最终 state；
- `differenceTooLong`：状态差太远，需要更重恢复策略。

应用 difference 的顺序：

1. 自动锁检查；
2. process users；
3. process chats；
4. 处理 scheduled/message-id 对账；
5. process new messages；
6. feed other updates；
7. 更新最终 state。

恢复完成前 `_ptsWaiter` 保持 requesting，防止新到 updates 越过基线。

## 8. 频道 difference 为什么单独存在

大频道更新量巨大，若所有频道共享全局 pts，一个不活跃频道的缺口也会拖累整个账号。每个 `ChannelData` 保存 pts、requesting、waiting-for-short-poll 等状态。

`getChannelDifference` 使用 channel input、当前 pts 与 limit。结果：

- empty：只推进 pts；
- normal：处理 new messages 和 other updates；
- tooLong：重置 history 底部加载状态、应用 dialog snapshot，并请求范围修复。

活跃频道还会 short poll；离开活跃聊天后可取消等待，降低后台流量。

## 9. 应用 update 的第二层分派

`applyUpdateNoPtsCheck` 负责具体事实：

- `updateNewMessage / updateNewChannelMessage` → Data::Session::addNewMessage；
- `updateEditMessage` → updateEditedMessage；
- `updateDeleteMessages` → processMessagesDeleted；
- read inbox/outbox → History unread/read 状态；
- pinned/folder/webpage 等 → 对应实体更新。

函数名中的 `NoPtsCheck` 很关键：到这里时，顺序检查应该已经由上层完成。不要从业务代码直接绕过 PtsWaiter 调它。

## 10. 去重与发送对账

收到新消息前，代码检查现有 message 是否已存在；发送路径还先 feed `updateMessageID`，把 `random_id` 对应的本地消息换成服务器 ID，再应用正式消息。

这解决了两个竞态：

1. RPC result 与 push 都带同一消息；
2. 本地 optimistic item 已存在，而 server item 使用另一个 ID。

稳定实体和 random_id 映射让两条世界线合并，而不是在界面出现两条消息。

## 11. 为什么批量发送 History change notification

`feedUpdateVector` 循环应用一组 update，结束后调用 `data().sendHistoryChangeNotifications()`。Data::Changes 可以先合并 flags，再一次发出。

如果每个字段立刻触发完整 UI 更新，一个 container 里几十个 update 会造成重复 layout、聊天列表排序和 repaint。批量通知是在一致性边界上做性能优化。

## 12. 失败与退避

difference 失败后使用增长 timeout，最高受控；频道各自维护失败 timeout。超时或 ping 发现长时间无更新，也会重新检查。

这里的原则是：

- 失败不能把 requesting 永久卡住；
- 重试不能形成紧循环；
- 不同频道的失败不能污染所有频道；
- 新 update 到达时仍要尊重当前恢复状态。

## 13. 调试一致性问题的顺序

不要先看 Widget。按下列顺序记录：

1. update constructor 和 peer/channel；
2. 收到时的 seq/pts、pts_count；
3. 是立即应用、暂存还是触发 difference；
4. users/chats 依赖是否已加载；
5. Data::Session 是否已有相同 FullMsgId；
6. HistoryItem 是否被创建/更新/删除；
7. change flags 是否在批次结束发出。

| 现象 | 常见检查点 |
|---|---|
| 偶尔漏消息 | PtsWaiter gap、difference fail、channel pts |
| 重复消息 | random_id 对账、updateMessageID 顺序、existing item |
| 未读数错误 | read update 顺序、history loaded、batch notifications |
| 编辑后又变旧 | stale seq/pts 是否被错误应用 |
| 某频道卡住 | channel `ptsRequesting` 是否未复位、fail timer |

## 14. 小结

Updates 是客户端的因果顺序守门人：网络负责“把包送到”，Updates 负责“证明这些事实可以按此顺序进入本地世界”。pts/seq 检测缺口，difference 恢复缺失，Data::Session 去重归一化，批量 Changes 再把一致状态交给 UI。

下一章继续向内：Data::Session 如何把 TL 消息变成可长期引用的 User、Channel、History 和 HistoryItem 对象图。

