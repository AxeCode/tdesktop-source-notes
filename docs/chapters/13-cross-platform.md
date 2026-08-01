# 第 13 章：跨平台与发布工程 —— 让差异停在边界

<div class="chapter-meta"><span>M13</span><span>难度：进阶</span><span>建议 35 分钟</span><span>关键词：Platform / Integration / packaging</span></div>

> 跨平台应用的成功标准不是“到处加 `#ifdef` 后能编译”，而是让绝大多数业务代码只看到稳定接口，让平台差异集中在可替换实现和构建目标中。

## 1. 三种平台差异

| 差异 | 例子 | 处理位置 |
|---|---|---|
| 启动/进程 | main、参数、单实例、updater | `platform/*/launcher_*`, `core/launcher/sandbox` |
| OS 集成 | tray、通知、global menu、autostart、URL scheme | `platform/*`, integration classes |
| UI/媒体原生能力 | title bar、窗口效果、摄像头、系统 media controls | platform façade + lib_ui/lib_webrtc |

若一个差异只是主题颜色或布局，不应被误放到 Platform；若涉及原生句柄与系统 API，也不应硬塞进通用 Widget。

## 2. 公共声明 + 平台实现

常见模式：

```text
platform/platform_specific.h      public contract
platform/win/specific_win.cpp     Windows implementation
platform/mac/specific_mac.mm      macOS implementation
platform/linux/specific_linux.cpp Linux implementation
```

CMake 每次只编译当前平台实现。公共业务调用 `Platform::Function()`，链接阶段选择实现。这比运行时到处 `if (IsWindows())` 更容易维护和测试。

## 3. Launcher 的平台钩子

`Core::Launcher` 定义公共模板，Platform::Launcher 覆盖：

- `initHook` / 环境设置；
- updater 启动；
- 特殊 helper 模式；
- 可执行路径/权限行为。

Linux launcher 例如先识别 `-webviewhelper`，Flatpak/KSandbox 下选择不同 updater/relaunch；Windows 与 macOS 分别处理其进程和 bundle 约束。

模板方法模式让公共启动顺序不被复制三份。

## 4. Integration 对象

`base::Integration`、platform integration、UI integration 为基础库提供回调，例如文件操作、字体、native event、URL 打开。基础子模块因此不需要反向依赖 Telegram 主程序。

这是依赖倒置：lib_base/lib_ui 定义需要的能力，主程序在启动时注入平台实现。

## 5. 窗口与原生事件

Qt 抽象了多数事件，但 Telegram 仍需要：

- Windows native messages、toast activator、taskbar；
- macOS Dock/global menu、NSWindow、系统休眠；
- Linux X11/Wayland、DBus、desktop portal。

`Core::Sandbox` 安装 native event filter，Window platform subclasses 处理窗口级细节。系统关机这类事件甚至影响销毁时机，说明平台边界不仅是 API 名称差异，也是生命周期差异。

## 6. 通知为什么必须平台化

通知涉及权限、action、reply、头像缓存、点击回调与系统标识。通用 `Window::Notifications::Manager` 定义产品行为，平台 manager 映射到 Toast/UNUserNotification/DBus portal 等。

点击通知后必须回到正确 account、peer、msgId，而不是只“激活应用”。平台 payload 因此携带可由公共层解析的稳定身份。

## 7. 文件与沙箱环境

同一 Linux 还可能运行于 Flatpak/Snap；macOS 有 bundle/sandbox；Windows 有安装版与 portable。文件打开、另存为、下载完成 postprocess 和 updater 都要尊重环境权限。

上层调用 platform file utility，而不是假设 `QDesktopServices` 或裸 path 在所有封装环境下行为一致。

## 8. CMake 条件不是随意开关

主 `Telegram/CMakeLists.txt`：

- Windows 加 MIDL、资源与系统库；
- macOS 启用 ObjC/ObjC++、framework、entitlements、assets 和可选 Swift runtime；
- Linux 生成 DBus 接口、链接桌面环境依赖；
- 各平台选择不同 source list 和 compile definitions。

新增跨平台功能时，先定义公共 target 接口，再在三个平台分支补实现。只让当前开发机编译成功不算完成。

## 9. updater 是独立生命周期

Launcher 退出 Qt 应用后，根据 `cRestartingUpdate/cRestarting` 启动 Updater 或重新执行 Telegram。更新器要处理：

- 当前进程完全释放文件；
- 写保护目录的提权；
- portable/安装路径；
- Flatpak 等外部包管理边界；
- 失败时清理 temp 并可恢复启动。

因此“下载更新”和“替换正在运行的可执行文件”被拆成两个进程生命周期。

## 10. 打包与签名是构建的一部分

可执行文件之外还有：

- app bundle/desktop file/icons；
- entitlements/codesign/notarization；
- Windows resources 与 installer/portable；
- Linux tarball/Snap/Flatpak/AppStream；
- crash symbols、update metadata、version channel。

功能代码若新增权限、动态库或资源，必须同时更新打包层。Debug build 通过只证明核心代码可链接，不证明发布物可运行。

## 11. 平台抽象的坏味道

- 通用业务文件出现长串三平台 `#ifdef`；
- platform 实现开始包含大量 Data/History 产品逻辑；
- 不同平台复制同一状态机，只差一个系统调用；
- 公共接口暴露 HWND/NSView/X11 类型；
- 只在一个平台初始化/销毁 producer，造成生命周期语义不一致。

更好的拆分是把共同状态机留在 core/window/calls，把最小系统操作放入 platform adapter。

## 12. 修改检查表

1. 公共 API 能否不暴露 native 类型？
2. 三个平台是否都有实现或明确 fallback？
3. headless/helper/portable/sandbox 模式是否受影响？
4. 初始化与 finish 是否对称？
5. 资源是否进入正确 target/package？
6. 新权限是否需要 entitlement/manifest/portal？
7. 至少能否让非目标平台在编译期暴露漏实现？

## 13. 本章源码入口

<div class="source-card">
<p><strong>启动模板：</strong>core/launcher.* · platform/*/launcher_*</p>
<p><strong>公共平台面：</strong>platform/platform_specific.h · platform/platform_integration.h</p>
<p><strong>窗口：</strong>platform/*/main_window_* · window/window_controller.*</p>
<p><strong>通知：</strong>window/notifications_manager.* · platform/*/notifications_manager_*</p>
<p><strong>构建：</strong>CMakeLists.txt · Telegram/CMakeLists.txt · Telegram/cmake/*</p>
</div>

## 14. 小结

tdesktop 用公共 façade、Integration 注入、平台专属源文件和条件 target 共同隔离系统差异；Updater 与打包则把运行生命周期延伸到应用外。跨平台修改要验证的不只是函数结果，还有初始化、权限、资源和发布物。

最后一章把前面的地图变成一套可执行的调试与源码阅读方法。

