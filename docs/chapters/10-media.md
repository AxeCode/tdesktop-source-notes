# 第 10 章：媒体、下载与播放 —— 从统一身份到自适应并发

<div class="chapter-meta"><span>M10</span><span>难度：进阶</span><span>建议 45 分钟</span><span>关键词：FileLoader / cache / streaming</span></div>

> 媒体链路跨越 Data、Storage、MTProto、FFmpeg、播放器和 UI。最有效的理解方式是分成四层：媒体身份、字节获取、解码播放、界面编排。

## 1. 一份媒体的四种形态

| 形态 | 代表对象 | 说明 |
|---|---|---|
| 领域身份 | `DocumentData / PhotoData` | id、location、mime、尺寸、缩略图、加载状态 |
| 字节任务 | `FileLoader / DownloadMtprotoTask` | 从 local/cache/cloud 获取 bytes |
| 可消费数据 | file、QByteArray、streaming loader | 完整文件或按 offset 读取的数据源 |
| 播放/显示 | `Streaming::Instance`, player, image/media view | 解码 frame/audio、进度、控制与绘制 |

同一 DocumentData 可以同时被聊天气泡、媒体查看器、播放器和下载列表观察；它们不应各自创建独立协议身份。

## 2. FileLoader 的 local-first 状态机

[`Storage::FileLoader`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/storage/file_download.h) 抽象共同流程：

1. `start()` 检查是否已完成；
2. `tryLoadLocal()` 尝试本地 location/cache；
3. local 命中 → `finishWithBytes`；
4. local 未命中且允许 cloud → 子类 `startLoading()`；
5. 进度通过 event stream 发出；
6. 完成时写文件/缓存、postprocess，并通知 Session downloader task finished；
7. cancel/failure 结束状态机。

它支持“只写文件”“写缓存”“缓存并写文件”“只允许本地”等策略，避免每种 media 重写一套 I/O 规则。

## 3. 两个 cloud 后端

- `mtpFileLoader`：Telegram file location，经 MTProto `upload.getFile` 分片；
- `webFileLoader`：HTTP(S) URL，例如外部网页资源。

它们继承共同 FileLoader，因而 UI 观察同样的 progress/finish/fail 语义。来源不同，不应污染上层展示接口。

## 4. MTProto 下载为什么按 DC 排队

文件 location 指向特定 DC。`DownloadManagerMtproto` 为每个 dcId 维护 queue 与 balance data；task 请求指定 offset 的 part。

<div class="flow">DocumentMedia requests bytes
  → mtpFileLoader
  → DownloadManagerMtproto::enqueue(task, priority)
  → queue[dcId]
  → choose session index
  → task->loadPart(index)
  → MTP upload.getFile
  → part arrives / progress
  → cache or file / consumer</div>

按 DC 隔离能避免一个慢 DC 阻塞其他媒体，也与 MTProto auth/session 路由一致。

## 5. 优先级不只是一个整数

Queue 记录 priority 与 generation。可见区图片、用户主动下载、预加载的优先级不同；generation 周期性重置，避免旧高优先级任务永远压住后来任务。

`nextTask(onlyHighestPriority)` 在已有请求占用带宽时偏向最高优先级，降低“同时加载很多缩略图”对当前用户动作的干扰。

## 6. 自适应并行 session

每个 DC 的 `DcBalanceData` 记录多个 session：

- 每个 session 当前 requested bytes；
- max waited amount；
- success 次数和 timeouts；
- 最近移除时间与退避。

成功且延迟良好时逐步提高并发或增加 session；多次超时则移除最后一个 session；无任务一段时间后停止额外 download sessions。

这不是固定“4 线程下载器”，而是根据观测到的请求时延调整并行度。目标是在吞吐与过载之间找到动态平衡。

## 7. partial 与渐进式显示

FileLoader 可识别 partial cache。图片在完整字节到齐前，可用当前前缀尝试解码 progressive preview；视频/音频 streaming 则按 offset 请求需要的范围。

渐进式体验的关键不只是 decoder 支持，还要：

- 缓存记录 partial 与完整状态；
- loader 知道 loadSize/fullSize；
- UI 接受质量逐步提升；
- 新 bytes 到来触发有限 repaint，而不是重建所有媒体对象。

## 8. 缓存与用户文件是两个目标

自动播放一段语音可以只进入内部 cache；用户“另存为”需要确定文件路径、写权限、下载完成后平台 postprocess；某些策略要求两者同时写。

这解释了 `LoadToCacheSetting` 和 file name 的组合，而不是让“有 filename”隐式决定所有行为。

## 9. Streaming 的线程边界

`Media::Streaming::Reader` 使用 FFmpeg 读取、seek 和解码。注释明确 streaming thread 与 main thread 通过 `crl::on_main` 通信。

基本链路：

<div class="flow">Streaming::Instance
  → Reader on streaming thread
      ├─ request bytes from Loader
      ├─ demux / decode
      ├─ audio packets / video frames
      └─ timing & seek
  → crl::on_main
  → Streaming::Update producer
  → Media::Player::Instance / video view</div>

解码线程不能直接修改 QWidget；主线程也不能同步等待网络 range，否则播放会卡 UI。

## 10. Player::Instance 是播放状态协调器

[`Media::Player::Instance`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/media/player/media_player_instance.cpp) 分别管理 Song 与 Voice/Round：

- current AudioMsgId；
- Streaming::Instance；
- playlist context 与 next/previous；
- speed、repeat、order、seek；
- update/stops/seeking producers；
- 通话开始时 pause、结束时恢复。

UI panel/widget 只是消费者。全局 player state 放在 Application，保证切聊天或换窗口时音乐继续、控制栏能迁移。

## 11. AudioMsgId 为什么携带消息上下文

音频不是只有 DocumentId。播放列表、已听状态、下一首和跳转原消息需要 FullMsgId/context。`AudioMsgId` 把 document 与消息身份结合，让 player 既能控制媒体，也能回到领域对象。

纯本地/外部音频则可能使用不同 context；调用者不能假设所有 track 都有可跳转 HistoryItem。

## 12. 通话与播放器协作

语音/视频通话开始时，player 暂停 song/voice；通话结束按记录恢复。这个协调发生在 process-wide player 与 call state producer 之间，而不是每个播放按钮自己监听通话。

集中协调避免多个窗口各自暂停/恢复导致状态翻转两次。

## 13. 调试路径

| 现象 | 第一层 | 第二层 | 第三层 |
|---|---|---|---|
| 进度不动 | FileLoader status | queue/task 是否 enqueue | MTP request/DC/session |
| 图片反复下载 | cache key/location | localLoaded 判定 | DocumentData 是否复用 |
| 下载速度低 | per-DC balance | requested/maxWaited | timeout 添加/移除 session |
| 能下载不能播放 | full bytes/file | Streaming loader/open | decoder/format error |
| seek 卡死 | player seeking state | range request | Reader thread → main update |
| 通话后不恢复 | pauseOnCall marker | call state producer | previous player state |

## 14. 小结

媒体系统用稳定 Document/Photo 身份把多个 UI 消费者聚合起来，用 FileLoader 统一 local-first 获取，用 per-DC manager 做优先级和自适应并发，再通过 streaming thread/FFmpeg 产出更新，最终由全局 Player 协调播放状态。

下一章进入这些数据落盘的地方：tdata 的全局 key、账号 map、local passcode 和各类加密文件如何组成分层存储。

