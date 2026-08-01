# 第 12 章：语音与视频通话 —— 信令状态机和媒体引擎的边界

<div class="chapter-meta"><span>M12</span><span>难度：进阶</span><span>建议 40 分钟</span><span>关键词：signaling / WebRTC / group call</span></div>

> 通话不是一个“打开 WebRTC”的按钮。Telegram API 负责建立会话、交换参数和状态；tgcalls/WebRTC 负责实时媒体；Calls::Call 把两边编排成用户可理解的状态机。

## 1. 两条平行通道

<div class="flow">Control / signaling plane
UI → Calls::Instance/Call → phone.* MTProto RPC → Api::Updates → Call state
Media plane
Call → Controller(WebRTC/tgcalls) → ICE/relay/P2P → audio/video devices → frames</div>

信令成功不代表媒体一定连通；媒体暂时断开也不一定需要立即结束服务端 call。调试时必须先判断问题属于哪条通道。

## 2. 核心对象

| 对象 | 作用 |
|---|---|
| `Calls::Instance` | 进程/Session 内通话管理、创建/接听、当前 call、设备与窗口协作 |
| `Calls::Call` | 一对一通话领域状态机，绑定 user、call id、DH/key、controller |
| `Calls::Controller` | 媒体引擎抽象；具体 WebRTC/tgcalls 实现 |
| `Calls::Panel` / top bar | UI 投影，观察 Call state |
| `Data::GroupCall` / `Calls::Group::Call` | 群组通话数据与媒体编排 |

状态属于 Call，不属于 Panel。关闭面板不应自动结束正在进行的通话。

## 3. 一对一外呼主线

概念流程：

1. UI 请求 `Calls::Instance` 发起 call；
2. 创建 `Calls::Call`，进入 requesting；
3. 生成/准备 DH 与随机材料；
4. 发送 `phone.requestCall`；
5. 服务端返回 call id/access hash/protocol；
6. 等待对端接受 update；
7. 交换确认参数，计算共享 key；
8. 创建媒体 Controller，配置 endpoints/proxy/P2P；
9. state 从 connecting → established；
10. discard/failure 更新服务端并清媒体。

具体 constructor 随协议演进，但“信令先建立安全参数，再启动媒体控制器”是稳定骨架。

## 4. 来电主线

push `phoneCallRequested` 进入 Api Updates，定位用户并创建 incoming Call；UI 播铃并展示接听/拒绝。接听时发送 accept，等待对端 confirm，验证 key fingerprint 后启动 controller。

来电可能在 UI 尚未完全建立时到达，所以 Calls::Instance 和通知层不能依赖某个具体窗口已显示。

## 5. 状态机为什么不能用几个 bool

典型状态包括：

- starting/requesting/waiting；
- ringing/connecting/exchanging keys；
- established；
- hanging up/ended；
- busy/failed。

每个状态允许的动作不同：waiting 时 cancel，ringing 时 decline，established 时 hangup；重复 update 必须幂等。一个 `connected` + `ended` 组合无法表达合法转移和 UI 文案。

## 6. DH key 与 emoji fingerprint

信令交换公钥材料，双方计算共享 key，并从 key/fingerprint 生成可人工比对的 emoji。Calls 层保存验证所需数据，UI 只展示结果。

文档不展开密码学证明，但工程上有三个不变量：

- 参数必须通过合法性检查；
- fingerprint 必须与服务端/对端声明匹配；
- key material 不进入普通日志或长期 UI 状态。

## 7. Controller 隔离媒体实现

`calls_controller_webrtc.*` 把 Call 状态映射到媒体引擎：

- network endpoints 与 proxy；
- input/output device；
- mute、volume、video capture；
- connection state、signal bars、statistics；
- remote video frames。

Call 订阅 controller events，再更新高层 state/quality producer。UI 不直接调用 WebRTC 内部对象，降低引擎升级影响。

## 8. 设备和平台层

麦克风、扬声器、摄像头和系统权限具有平台差异。Calls UI 选择逻辑设备，媒体/平台层解析具体 device id；权限失败需要映射成可操作提示，而不是一般网络错误。

热插拔时 producer 更新设备列表；当前设备消失要回退默认设备，同时保持 Call 状态机继续运行。

## 9. Updates 如何驱动通话

Call 的远端状态来自 `updatePhoneCall` 等 Updates。应用逻辑根据 call id/access hash 找当前对象，再把不同 constructor 交给 Call。

同样的 Updates 一致性原则仍生效：重复 accepted/discarded update 不应二次创建/销毁 controller；晚到 update 要和当前 terminal state 比较。

## 10. 群组通话为何是另一套模型

群组通话不是 N 个一对一 call。它围绕 group call + participants：

- API 创建/加入 call，交换 join payload；
- participant update 带 source/ssrc、mute、video endpoint、raise hand；
- `Data::GroupCall` 维护服务端参与者事实；
- `Calls::Group::Call` 管本地媒体引擎与 join/leave；
- Panel/Members UI 订阅 participants 和 levels。

Api::Updates 还会特意排序 group call chain blocks 与 participant updates，说明应用顺序对媒体图有依赖。

## 11. 音频电平和高频数据

speaking level、frame、network stats 比普通 peer update 高频。它们不应全部走通用 Data::Changes 批量模型，否则主线程和 UI 会被淹没。

通话子系统使用专用 producer、节流与可见性策略；成员列表只重绘受影响行，视频 frame 走专门 surface。

## 12. 与全局系统协作

通话开始/结束还要协调：

- Media Player 暂停/恢复；
- 系统媒体键/音频焦点；
- notifications 和铃声；
- 窗口 top bar / panel；
- auto lock/idle；
- 应用退出与账号 logout。

这些协作通过 Calls::Instance 的状态 producer集中完成，而不是散落在每个功能按钮。

## 13. 调试矩阵

| 现象 | 信令检查 | 媒体检查 | UI 检查 |
|---|---|---|---|
| 一直“正在连接” | request/accept/confirm update | controller state、endpoint | state producer 是否到 Panel |
| 能接通无声音 | call 已 established | device、mute、audio route | level 是否有数据 |
| 来电不显示 | updatePhoneCall 是否应用 | 尚未到媒体层 | Calls::Instance/notification/window |
| 挂断后仍占麦 | discard/terminal state | controller 是否销毁 | panel lifetime |
| 群成员重复 | participant version/update order | source map | list identity key |
| 视频黑屏 | signaling video flags | capture/decoder/frame | surface visibility/size |

## 14. 本章源码入口

<div class="source-card">
<p><strong>一对一：</strong>calls/calls_instance.* · calls/calls_call.* · calls/calls_controller_webrtc.*</p>
<p><strong>UI：</strong>calls/calls_panel.* · calls/calls_top_bar.*</p>
<p><strong>群组：</strong>calls/group/calls_group_call.* · data/data_group_call.* · calls_group_members.*</p>
<p><strong>服务端事实：</strong>api/api_updates.cpp 中 phone/group call update 分支</p>
</div>

## 15. 小结

通话层用明确状态机把 MTProto 信令与 WebRTC/tgcalls 媒体平面隔离，再通过 producer 把高层 state、质量和设备状态交给 UI。群组通话另以 participant/source 图建模，不能复用一对一的简单两端关系。

下一章回到整个工程：同一套业务怎样通过 platform façade、条件 target、资源与打包流程落在三个桌面操作系统上。
