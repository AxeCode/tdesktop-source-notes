# 第 2 章：仓库、构建与代码生成 —— 手写代码只是一半故事

<div class="chapter-meta"><span>M02</span><span>难度：入门</span><span>建议 30 分钟</span><span>关键词：CMake / TL / style / lang</span></div>

> 读 tdesktop 前必须先分清三类东西：主程序手写代码、复用子模块、构建期生成代码。否则你会不断搜索一个“不存在”的类实现，或直接修改下次构建就被覆盖的产物。

## 1. 顶层仓库不是普通单目录应用

顶层 [`CMakeLists.txt`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/CMakeLists.txt) 做四件关键事情：

1. 从 `Telegram/build/version` 解析版本；
2. 定义跨平台 C/C++ 项目和配置类型；
3. 建立 `third_party_loc / submodules_loc / cmake_helpers_loc`；
4. 依次进入 `cmake/` 和 `Telegram/`。

`Telegram/CMakeLists.txt` 再创建主可执行目标，加载子模块与功能 target，最后把超过两千个源文件组合到 `Telegram`。

<div class="flow">root CMakeLists.txt
├── cmake/                     通用构建帮助与外部依赖
└── Telegram/CMakeLists.txt
    ├── lib_rpl / lib_crl / lib_base / lib_ui ...
    ├── codegen/
    ├── td_mtproto / td_scheme / td_ui / td_lang ...
    ├── SourceFiles/**/*.cpp
    ├── Resources/**/*
    └── platform-specific sources and link options</div>

## 2. 先按“性质”而不是“功能”看目录

### 2.1 主程序手写层

`Telegram/SourceFiles` 是产品主代码。功能目录并非严格分层，但大致可以分成：

| 类别 | 目录 | 典型职责 |
|---|---|---|
| 运行时骨架 | `core`, `main`, `window` | 进程、账号、会话、窗口、导航 |
| 网络与同步 | `mtproto`, `api`, `apiwrap.*` | TL 请求、连接、Updates、产品 API |
| 领域数据 | `data`, `history`, `dialogs` | peers、messages、histories、聊天列表 |
| 界面组件 | `ui`, `boxes`, `info`, `settings` | 控件、弹窗、信息页、设置页 |
| 重型能力 | `media`, `calls`, `storage`, `export`, `iv` | 媒体、通话、本地数据、导出、Instant View |
| 平台实现 | `platform` | Windows/macOS/Linux 特有行为 |

这只是导航，不是依赖规则。比如 `history` 既含领域对象也含 view；`apiwrap.cpp` 仍保留大量高层产品逻辑。

### 2.2 可复用基础库

`Telegram/lib_*` 和相关子模块提供正交能力：

- `lib_rpl`：响应式流；
- `lib_crl`：并发运行层与主线程切换；
- `lib_base`：容器、弱引用、timer、工具；
- `lib_ui`：Qt 上层 UI 基础设施；
- `lib_tl`：TL 序列化基础；
- `lib_storage`：通用缓存/数据库能力；
- `lib_webrtc` / `lib_webview`：媒体与嵌入式网页边界。

这些通常作为独立 target 链接进主程序。读主线时，先理解“主程序如何使用它”，再决定是否进入子模块内部。

### 2.3 第三方与准备脚本

`Telegram/ThirdParty`、外部 Libraries 与 `Telegram/build/prepare` 共同解决固定工具链和依赖。官方构建不是简单 `apt install && cmake`；路径布局、patched Qt、OpenSSL、FFmpeg、WebRTC 等都参与可复现性。

## 3. 为什么代码生成是架构的一部分

tdesktop 的代码生成至少覆盖四个维度：

### 3.1 TL schema → 协议类型

[`mtproto/scheme/api.tl`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/mtproto/scheme/api.tl) 和 `mtproto.tl` 描述 constructor、method、flags 与返回类型。构建期工具生成：

- `MTPmessages_SendMessage` 这类方法类型；
- `MTPUpdates / MTPUpdate / MTPMessage` 这类 sum type；
- `c_updates()`、`match(...)`、`vusers()` 这类访问器；
- 序列化、类型 id 和大小计算。

看到：

```cpp
request(MTPmessages_SendMessage(...)).done(...).send();
```

正确追踪顺序是：先查 `.tl` 定义，理解 flags 与返回类型；再看业务如何构造；最后才在必要时看生成器。不要在手写源文件里搜索 `class MTPmessages_SendMessage` 后断言“代码缺失”。

### 3.2 `.style` → UI 样式常量

界面样式文件由 style codegen 转换成强类型对象。源码中的 `st::historyPadding`、`st::boxWidth` 等通常来自生成结果，而不是全局魔法。修改 UI 时要找对应 `.style` 定义，不要改 build 目录产物。

### 3.3 `.strings` → 本地化访问器

`lang.strings`、`cloud_lang.strings` 等生成 `tr::lng_*` 访问器。参数化文本使用 `lt_*` 和标记类型组合，避免手工拼接破坏复数规则和语言顺序。

### 3.4 资源与平台接口生成

Qt resource、DBus、Windows MIDL、macOS assets、AppStream changelog 等也在 CMake 中生成。它们解释了为什么“添加一个文件”有时还要更新 CMake target 或资源表。

## 4. target 比目录更接近真实依赖

`Telegram/CMakeLists.txt` 把功能拆成 `td_mtproto`、`td_scheme`、`td_ui`、`td_lang`、`td_export`、`td_iv` 等 target，再链接 `desktop-app::lib_*` 与外部库。

因此分析依赖时，建议三步：

1. 看源文件属于哪个 `nice_target_sources` / feature target；
2. 看该 target 的 `target_link_libraries`；
3. 再看 include，而不是仅凭目录猜层次。

目录是人为导航，target 才决定编译和链接边界。

## 5. 平台选择如何进入构建

平台代码通常采用“公共声明 + 平台实现”：

```text
platform/platform_specific.h
platform/win/specific_win.cpp
platform/mac/specific_mac.mm
platform/linux/specific_linux.cpp
```

CMake 根据 `WIN32 / APPLE / UNIX` 选择源文件、framework、系统库和编译选项。macOS 还启用 Objective-C/Objective-C++，部分功能可能包含 Swift runtime；Windows 生成 COM/MIDL 代码；Linux 生成 DBus 接口。

这使公共业务可以调用 `Platform::...`，而不是把平台宏扩散到每个功能模块。

## 6. 预编译头与“看不见的 include”

主 target 使用 `stdafx.h` 作为 C++/ObjC++ 预编译头。某些类型看起来没有在当前文件直接 include，却仍可编译。阅读时不要模仿这种偶然可见性；修改代码应遵循仓库自己的 include 规范，并通过实际 target 编译验证。

## 7. Debug、Release 与构建现实

上游指导通常围绕预先准备的依赖目录和生成好的 `out` 构建树。Debug 是日常验证首选；Release/MinSizeRel 会引入更重的优化、打包和签名成本。

不同平台入口：

- Windows：Visual Studio toolchain，架构要匹配依赖目录；
- macOS：Xcode/Qt 与 framework；
- Linux：官方 Docker 环境用于控制工具链与依赖。

本教程不要求完整构建 Telegram，但你在改源码时必须知道目标平台和现有 `out` 是谁生成的。不要用一个平台的 cmake 去驱动另一个平台的 build tree。

## 8. 从 schema 到运行时的一条完整链

以 `messages.sendMessage` 为例：

1. `api.tl` 声明 method、flags、参数与 `Updates` 返回值；
2. scheme codegen 生成 `MTPmessages_SendMessage`；
3. `ApiWrap::sendMessage` 根据 UI action 填 flags、entities、reply、schedule 等字段；
4. `MTP::Sender::request` 生成 request builder；
5. `MTP::Instance` 序列化并路由到 DC；
6. 返回 `MTPUpdates`，由 `Api::Updates` 解包并写入 Data 层。

代码生成不是“省去样板代码”这么简单；它让 wire schema 直接成为编译期类型系统的一部分，减少手写 tag/field 解码错误。

## 9. 修改时的文件选择规则

| 目标 | 应改 | 不应直接改 |
|---|---|---|
| 协议 method/constructor | `.tl` schema（通常由上游协议决定）与消费者 | 构建目录生成的 scheme `.h/.cpp` |
| 文案 | `.strings` 资源 | 生成的 `tr::lng_*` |
| 样式 token | `.style` | 生成的 `style_*` C++ |
| 平台行为 | 公共接口 + 对应平台实现 | 在通用业务文件散布大量 `#ifdef` |
| 新产品功能 | 对应 feature target 源清单 | 只把文件放进目录，期待自动发现 |

## 10. 阅读练习

1. 在 `api.tl` 找 `messages.sendMessage`，列出哪些字段由 flags 控制。
2. 回到 `ApiWrap::sendMessage`，找出 `reply_to / entities / schedule_date / send_as` 如何设置 flags。
3. 在 `Telegram/CMakeLists.txt` 找到 `apiwrap.cpp` 和 `api/api_updates.cpp` 属于哪个 target。
4. 任找一个 `tr::lng_*`，反向搜索 `.strings` 的 key。
5. 任找一个 `st::` 常量，反向定位对应 `.style`。

## 11. 本章结论

源码目录只是表面；真实工程由 CMake target、子模块和生成管线共同组成。建立“schema/资源 → 生成类型 → 手写业务 → target 链接”的模型后，许多看似神秘的类型和函数会立刻有出处。

下一章进入运行时：可执行文件启动后，Launcher、Sandbox、Application、Domain 和 Account 如何按顺序活起来。

