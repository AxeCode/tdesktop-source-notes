# 第 8 章：发送消息与乐观更新 —— 两条世界线如何合并

<div class="chapter-meta"><span>M08</span><span>难度：核心</span><span>建议 45 分钟</span><span>关键词：optimistic / random_id / reconcile</span></div>

> 用户期待按下 Enter 的瞬间就看到消息；网络和服务器确认却可能晚几秒甚至失败。发送管线必须同时维护“本地预测世界线”和“服务器事实世界线”，最后无重复地合并。

## 1. 发送不是一次 RPC

文本发送至少包含：

- compose 输入与 TextWithTags；
- entity 转换、trim、长度切分；
- reply/topic/send-as/schedule/effect/paid 等选项；
- local MsgId、random_id 与 sending HistoryItem；
- cloud draft 清理；
- TL flags 与 request；
- `updateMessageID` 对账；
- success/fail 后的状态、错误提示与重试。

媒体发送还会增加预处理、缩略图、upload parts、file reference refresh 和 sendMedia。

## 2. 入口对象 MessageToSend

UI 不直接调用 `messages.sendMessage`。compose controls 构造高层 `MessageToSend`，其中 action 包含：

- target History；
- replyTo 与 topic root；
- clearDraft；
- send options：silent、scheduled、sendAs、effect、stars 等；
- 文本 tags 与 web page draft。

它是 UI 与 API 之间的产品语义 DTO。这样快捷回复、通知栏回复、分享框等入口可以复用同一发送实现。

## 3. 第一步：能力和特殊路径

[`ApiWrap::sendMessage`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/apiwrap.cpp#L4579) 先：

1. 取 history/peer；
2. 发送 typing action 的收尾；
3. 解析 reply/topic；
4. 检查 ephemeral message；
5. 检查 `CanSendTexts`；
6. 尝试 dice 等特殊发送；
7. 保存最近 hashtag。

早分流避免把所有消息类型塞进一个巨型 TL flags 分支。

## 4. 文本准备与长度切分

tags 被转换成 entities，`PrepareForSending` 做规范化。随后 `CutPart` 按当前账号限制切分超长文本。

切分必须同时维护：

- Unicode 与 entity 边界；
- 第一段/最后一段的 webpage preview；
- 每段独立 local id/random_id；
- reply、schedule 和 send options；
- draft 只在正确时机清理。

这解释了为什么“发送文本”函数看起来远比一个 API call 长。

## 5. 本地预测：先创建 sending item

每一段消息：

1. `nextLocalMessageId()` 生成本地 ID；
2. `RandomValue<uint64>()` 生成 random_id；
3. Data::Session 注册 random_id → FullMsgId；
4. 保存 sent data，供错误/重试使用；
5. 计算 MessageFlags；
6. `History::addNewLocalMessage(...)` 插入本地项。

<div class="flow">Press Enter
  → local MsgId + random_id
  → HistoryItem(state = sending)
  → Data::Changes
  → bubble appears immediately
  ───────────────────────────── network continues in parallel</div>

乐观更新改善延迟感，但也让发送成为分布式对账问题。

## 6. flags 是产品选项的协议投影

发送代码同时维护两组 flags：

- 本地 `MessageFlags`：UI/领域状态，如 HasReplyInfo、Scheduled、InvertMedia；
- `MTPmessages_SendMessage::Flags`：wire 可选字段，如 `f_reply_to`、`f_entities`、`f_schedule_date`。

二者不能混用。本地可能需要一个状态但协议没有同名 flag；协议字段也可能只为请求存在，不应该永久写进 HistoryItem。

## 7. sendPreparedMessage 的角色

请求不是直接 `.send()`，而常通过 `Data::Histories::sendPreparedMessage`：

- 把 reply placeholder 替换成最终 input reply；
- 关联 random_id 与 local item；
- 统一完成 send result 的 Updates 应用；
- 处理依赖顺序和失败；
- 更新 send progress / draft。

这是发送领域的协调层，避免文本、媒体、转发各自实现一套对账。

## 8. 服务端确认的两步合并

### 8.1 updateMessageID

服务端返回 random_id 对应的最终 message id。Updates 在应用新消息前优先 feed message-id update，让本地 item 更换身份。

### 8.2 updateNewMessage / sent update

随后正式消息携带日期、服务端 flags、entities、media 等权威数据。Data::Session 找到已迁移 item，更新而不是创建副本。

最终状态：

```text
local(-N, random R, sending)
          │ updateMessageID(R → 123)
          ▼
server(123, random mapping consumed)
          │ updateNewMessage(123, authoritative fields)
          ▼
confirmed HistoryItem(123)
```

## 9. 为什么 result 与 push 顺序不能假设

网络上可能先收到 RPC result，也可能 push 先到；Updates container 内 updateMessageID 与 newMessage 也要按特定顺序处理。代码显式先 feed message ids，再处理 messages。

对账逻辑必须具备幂等性：重复确认不能重复插入；晚到 result 不能把已确认 item 重新标成 sending。

## 10. 失败不是统一红色感叹号

`ApiWrap::sendMessageFail` 根据错误类型处理：

- `PEER_FLOOD`：信息框；
- `SLOWMODE_WAIT_*`：更新频道 slowmode；
- `CHAT_FORWARDS_RESTRICTED`：toast；
- `PREMIUM_ACCOUNT_REQUIRED`：打开 Premium；
- scheduled/paid/file-reference 等：各自恢复或移除状态；
- 普通失败：标记 HistoryItem failed，并保留重试所需数据。

错误处理本身就是产品状态机。不能只在 transport 层统一 toast。

## 11. FILE_REFERENCE 过期为什么会重试

Telegram media reference 有时效。富文本/媒体请求遇到 `FILE_REFERENCE_*` 时，代码可根据 origin 刷新引用，重新序列化当前 media，再重复请求一次。

重试必须有“是否已经 refreshed”护栏，否则服务端持续报错会无限循环。它也要重新读取当前实体，而不是复用已过期的 serialized request。

## 12. 草稿的一致性

发送时可以清本地/云草稿，但网络失败后不能随意恢复旧草稿覆盖用户新输入。代码用 start/finish saving cloud draft、topic root、monoforum peer 等维度标记正在进行的保存。

草稿 bug 常来自把“发起发送时的内容”和“当前输入框内容”当成同一个状态。它们在异步等待期间已经可能分叉。

## 13. 媒体发送在这条主线上的扩展

媒体管线在 optimistic skeleton 上增加：

1. 本地文件检查与转码/缩略图；
2. 先创建带本地 media 的 sending item；
3. Uploader 分片上传并发进度；
4. 获得 InputFile / remote reference；
5. sendMedia / sendMultiMedia；
6. Updates 对账并替换 media fields；
7. 失败时保留可重试数据或清理临时文件。

理解文本发送后再读 uploader，会少一半认知负担。

## 14. 调试检查表

| 阶段 | 记录 |
|---|---|
| UI | History、replyTo/topic、options、原始 TextWithTags |
| local | local FullMsgId、random_id、sending item pointer |
| request | TL flags、目标 DC、request id |
| result | Updates constructor、updateMessageID 是否存在 |
| reconcile | random map 是否命中、item id 是否迁移、是否重复 |
| fail | error type、request id 清理、item failed/destroy、draft 状态 |

一个非常有效的断点组合：`ApiWrap::sendMessage`、`History::addNewLocalMessage`、`Updates::feedMessageIds`、`Data::Session::addNewMessage`、`ApiWrap::sendMessageFail`。

## 15. 小结

发送消息是“本地预测 + 协议请求 + 服务端事实 + 身份对账”的四段式事务。local MsgId 提供即时 UI，random_id 提供幂等关联，Updates 保证确认顺序，History/Data 在原实体上完成迁移。

下一章进入 UI：这些领域变化如何通过 rpl 和 controller 投影到多窗口、三栏布局、layer 与可恢复 section。

