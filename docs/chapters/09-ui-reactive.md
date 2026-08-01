# 第 9 章：窗口、导航与响应式 UI —— 用生命周期组织复杂界面

<div class="chapter-meta"><span>M09</span><span>难度：核心</span><span>建议 45 分钟</span><span>关键词：rpl / Controller / Memento / lifetime</span></div>

> tdesktop 的 UI 不是 MVC 教科书模板。它由 Qt Widget、自绘元素、controller、memento 与 Reactive Programming Library 共同构成。真正的边界是“谁拥有状态、谁发命令、订阅活多久”。

## 1. 窗口层的对象关系

<div class="flow">Core::Application
└── Window::Controller (one top-level window)
    ├── MainWindow / layer stack / boxes
    └── Window::SessionController (when showing logged-in account)
        └── MainWidget
            ├── Dialogs::Widget
            ├── HistoryView::Chat/HistoryWidget
            └── Info::... section / third column</div>

多窗口场景下，一个 Account/Session 可被不同 Window controller 展示。数据属于 Session，不属于某个 Widget。

## 2. Window::Controller 与 SessionController 的分工

[`Window::Controller`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/window/window_controller.h) 处理：

- 顶层窗口与 account 切换；
- layer、box、toast、right column；
- terms/login 等跨 session 状态；
- 平台窗口激活与关闭。

[`Window::SessionController`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/window/window_session_controller.h) 处理：

- 当前 Session 的 active chat/thread；
- showPeer/showMessage/showSection；
- section stack 与 back；
- folder/forum/filter；
- chat theme、emoji interaction、上传 layer 等会话 UI 服务。

把两者混用会导致切账号或无 Session 窗口时访问非法状态。

## 3. rpl 的四个基本件

### `producer<T>`

描述值/事件序列。producer 可被 map/filter/combine，不一定自己拥有数据。

### `variable<T>`

保存当前值并产生后续变化。常见：`value()` 发当前值 + 变化，`changes()` 只发之后变化。

### `event_stream<T>`

owner 主动 `fire()`，对外暴露 `events()`。

### `lifetime`

订阅终止边界。`on_next(callback, owner->lifetime())` 把 callback 与 owner 生死绑定。

这四件套构成 UI 状态流的语法。

## 4. 一个典型订阅怎么读

```cpp
session->changes().peerUpdates(
    peer,
    Data::PeerUpdate::Flag::Name | Data::PeerUpdate::Flag::Photo
) | rpl::on_next([=] {
    updateHeader();
}, lifetime());
```

读法：

1. 状态源是 Data::Changes；
2. 只选指定 peer 与 flags；
3. 订阅者响应更新；
4. 当前 Widget 的 lifetime 销毁后自动取消。

不要只盯 lambda；更重要的是 source、operator 和 lifetime。

## 5. flatten_latest：切账号/切对象的关键

Domain 的 active account 是一个随时间变化的值；每个 account 又有自己的 session producer。`map(...producer...) | flatten_latest()` 表示：外层值改变时，取消旧内层订阅，只观察最新对象。

这相当于其他响应式库的 `switchMap`。若误用 merge/不取消，UI 会同时收到旧账号和新账号事件。

## 6. combine：派生 UI 状态

按钮是否可用、栏位是否显示，往往由多个 producer 决定。`rpl::combine(a, b, c)` 把最新值组合，随后 map 成 view state。

优势是依赖显式；风险是组合过大或每个源高频发出，导致昂贵 layout。性能调优应检查 producer 频率和 distinct 逻辑，而不只是 paint 函数。

## 7. 导航命令与页面状态

`SessionController::showPeerHistory(peerId, params, msgId)` 是命令。它先处理 community 等特殊情况，再让 content 显示 history。

`showMessage(item)` 还要：

- 找到属于 item account 的 SessionController；
- scheduled message 打开独立 memento；
- 普通消息交给 content 并按 activation 参数激活窗口。

这说明导航不能假设“当前窗口当前账号就是目标对象的 owner”。

## 8. Memento 为什么存在

Info、Settings、Scheduled、Media 等 section 使用 Memento 保存可恢复状态，例如：

- 当前 peer/topic；
- subsection/tab；
- 滚动与选择；
- 页面专用 controller state。

Controller 的 `showSection` 把 memento 交给 content；back stack 保存 memento 而非活 Widget。这样页面可以销毁重建，导航历史不需要长期保留整棵 UI 对象树。

## 9. Layer、Box、Section 是不同导航表面

| 表面 | 用途 | 生命周期 |
|---|---|---|
| Section | 主内容/第三栏，可进 back stack | 随导航切换，可由 memento 恢复 |
| Layer | 覆盖主内容的通用层 | Window controller 管 stack/blackout |
| Box | 对话框式 `BoxContent` | 通常有 closing producer 与弱 qptr |
| Toast | 短时反馈 | 定时自销毁，不承载业务事实 |

选择错误表面会造成返回行为、焦点和窗口激活不一致。

## 10. Qt 信号与 rpl 如何共存

Qt signal/slot 仍用于原生控件、事件和 QObject 集成；rpl 更适合可组合状态流。常见桥接：

- 把 Qt signal 包成 producer；
- producer 的 on_next 调 Widget 方法；
- `QObject` 销毁同时结束 lifetime；
- 跨线程结果先 `crl::on_main`，再 fire stream。

不要为了“统一风格”把所有一次性 Qt 事件强行改成 rpl，也不要用 signal 链手工模拟可组合状态。

## 11. 自绘消息与普通 Widget 的边界

设置页、box 大量使用 `Ui::RpWidget`；消息列表为性能采用自绘 `HistoryView::Element`。后者没有每条消息一个 QObject，因此不能直接依赖 QObject parent 自动管理。

消息 element 的 owner 是 list/History view，媒体子 view 与 HistoryItem 绑定；事件通过 hit test 和 ClickHandler 分派。这种结构换取了滚动性能，也提高了 layout/invalidations 的复杂度。

## 12. 生命周期常见错误

### 订阅绑定过长

把页面订阅绑到 Session lifetime，页面关闭后仍执行 update，可能访问已销毁 Widget。

### 订阅绑定过短

临时 lifetime 立即析构，producer 永远不触发。

### lambda 捕获裸 this 穿过异步边界

网络/queued 回调晚到后 UAF。使用 owner-aware API、weak_qptr 或 `crl::guard`。

### active 全局漂移

发起操作时拿的是 peer A，回调时从 `Core::App().domain().active()` 重新取到账号 B。应捕获明确 Session/Peer 身份。

## 13. UI 调试矩阵

| 现象 | 状态源 | 导航/订阅检查 | 绘制检查 |
|---|---|---|---|
| 页面没刷新 | Data::Changes flag | lifetime、filter、flatten_latest | update/repaint 是否调用 |
| 返回栈错误 | active entry/memento | showSection 参数、stack push/pop | 通常不是 paint |
| 切账号串数据 | Domain active | 旧 inner producer 是否取消 | Widget 是否缓存旧 peer |
| 关闭后崩溃 | callback owner | weak/lifetime/queued | 销毁顺序 |
| 滚动掉帧 | producer 频率 | 是否重复 relayout | element paint/viewport |

## 14. 最小源码路线

1. `main/main_domain.cpp`：看 active + flatten_latest；
2. `data/data_changes.h/.cpp`：看 producer 如何按 flags 发；
3. `window/window_controller.*`：看窗口表面；
4. `window/window_session_controller.cpp` 的 showPeerHistory/showMessage/showSection；
5. 选择一个小设置页看 producer 到 Ui::RpWidget；
6. 最后进入 history view 的自绘路径。

## 15. 小结

tdesktop UI 的稳定模式是：Data/Session 持有事实，Controller 发导航命令，Memento 保存可恢复页面状态，rpl producer 把变化投影到 Widget，lifetime 负责取消。掌握所有权与订阅边界后，复杂界面不再是一团 signal。

下一章进入媒体：同一个 DocumentData 如何从缓存探测、MTProto 分片下载一路走到 FFmpeg 流式解码和播放器状态。

