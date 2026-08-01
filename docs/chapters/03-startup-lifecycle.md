# 第 3 章：启动、进程与多账号 —— 谁先活，谁最后死

<div class="chapter-meta"><span>M03</span><span>难度：核心</span><span>建议 35 分钟</span><span>关键词：Launcher / Sandbox / Domain / Account</span></div>

> 桌面应用最容易被低估的不是“怎么打开窗口”，而是如何在崩溃恢复、单实例、更新重启、本地 passcode、多账号和系统关机之间保持确定的构造与销毁顺序。

## 1. 启动不是一个 main 函数

平台入口最终创建 `Platform::Launcher`，它继承 `Core::Launcher`。公共启动骨架位于 [`core/launcher.cpp`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/core/launcher.cpp)，平台文件可在进入公共流程前处理特殊模式，例如 Linux 的 WebView helper。

<div class="flow">platform entry
  → Core::Launcher::Create
  → Platform::Launcher::exec
  → Core::Launcher::exec
      ├─ init / prepareSettings / arguments
      ├─ Logs::start
      ├─ Platform::start + ThirdParty::start
      ├─ executeApplication
      └─ updater / restart / finish</div>

Launcher 的职责是“在 Qt 应用和业务对象存在前，把运行环境准备正确”。这包括工作目录、portable 模式、DPI、debug 开关、安装标识和 updater 策略。

## 2. Launcher 为什么过滤 Qt 参数

`FilteredCommandLineArguments` 默认只把可执行路径传给 Qt，再按需要插入 platform/fontengine 参数。业务参数由 tdesktop 自己解析，避免 Qt 抢先消费或误解它们。

这是一个小但重要的边界：

- 原始 argv 属于产品启动协议；
- 传给 QApplication 的 argv 是受控子集；
- 平台特殊设置通过明确的 Qt platform 参数加入。

## 3. 工作目录就是数据域的根

Launcher 处理普通安装、`-workdir` 和 `TelegramForcePortable`。随后 debug 设置、beta 开关、安装 tag、tdata 路径都基于 `cWorkingDir()`。

这意味着“同一个可执行文件”可以因为工作目录不同而表现成不同的本地安装。单实例 server 名、锁文件和 Domain 的 data name 也与此相关。

## 4. Sandbox：名字容易误导的 QApplication

[`Core::Sandbox`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/core/sandbox.h) 继承 `QApplication`。这里的 Sandbox 主要是应用宿主与事件循环，不是把 Telegram 运行在 OS 安全隔离容器中。

`Sandbox::start()` 的关键顺序：

1. 基于工作目录生成单实例 local server 名；
2. 处理 cleanup launch mode；
3. 创建 UpdateChecker；
4. 获取与可执行路径相关的 `QLockFile`；
5. 连接 `QLocalSocket / QLocalServer` 信号；
6. 安排启动检查和退出清理；
7. 尝试连接已运行实例；
8. 进入 `QApplication::exec()`。

单实例不是一个 bool，而是一套 IPC 协议：新进程可把打开 URL、激活窗口或退出等命令交给已有实例。

## 5. 为什么 Application 延迟创建

`Sandbox::launchApplication()` 使用 queued 调用：先完成屏幕缩放、deadlock detector 等 QApplication 级准备，再创建 `Core::Application` 并安装 native event filter，最后调用 `Application::run()`。

延迟到事件循环后创建有两个好处：

- Qt 平台对象已经稳定；
- 初始化可以响应 quit/IPC，而不是把所有工作堵在 main 前。

## 6. Core::Application 的启动顺序

[`Application::run()`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/core/application.cpp#L266) 建立进程级服务。核心阶段可概括为：

<div class="flow">Application::run
  → settings / theme / language / shortcuts
  → media player / download / notifications facade
  → primary Window::Controller
  → startDomain
      → Main::Domain(data name)
      → startLocalStorage
      → Domain::start(passcode)
  → active account/session watchers
  → tray / media view / global integrations</div>

部分顺序是硬约束。例如通知 manager 要等 Domain 首次激活；某些 media/window 对象在 macOS 必须 queued 创建，避免 Dock 把临时窗口当可见应用窗口。

## 7. Domain：多账号集合，不是网络域名

[`Main::Domain`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/main/main_domain.h) 拥有：

- `Storage::Domain`：全局本地数据与 local key；
- `vector<AccountWithIndex>`：账号槽位；
- `rpl::variable<Account*> _active`：当前激活账号；
- active session、账号变化、未读 badge 等事件流。

`Domain::start(passcode)` 让 Storage::Domain 读取本地账号表；成功后 `activateAfterStarting()` 为所有账号安装 session watcher，并激活上次使用的账号。

账号上限由普通/高级账户条件决定，但容器仍以固定 index 保存账号。index 是本地槽位，不是用户 ID。

## 8. Account：登录前后都存在的授权槽位

[`Main::Account`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/main/main_account.h) 始终拥有账号本地存储，并在启动后拥有 `MTP::Instance`；只有获得用户信息后才创建 `Main::Session`。

<div class="flow">Storage restores Account
  → Account::prepareToStart(localKey)
  → Account::start(config)
  → Account::startMtp(config)
  → MTP auth available?
      ├─ no  → intro/login UI, no Main::Session
      └─ yes → Account::createSession(user, settings)
               → Main::Session
               → Data::Session / ApiWrap / Updates / storage services</div>

这个结构允许未登录账号仍保持网络配置和登录状态机，同时把只有登录后才合法的功能隔离在 Session 内。

## 9. Main::Session 是服务聚合器

[`Main::Session` 构造函数](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/main/main_session.cpp#L98) 的初始化列表很长，但顺序透露架构：

1. `Data::Changes`；
2. `ApiWrap` 与 `Api::Updates`；
3. 发送进度、下载、上传、Storage facade；
4. `Data::Session`，并处理当前用户；
5. 贴纸、WebView、最近联系人、scheduled/ephemeral/sponsored 等 feature services；
6. 设置保存 timer 和支持模式。

构造完成后，重型本地数据读取通过 `crl::on_main_queue` 分批执行，让 paint event 能穿插，避免启动时长时间冻结主线程。

这是一项值得记住的性能策略：**不是所有初始化都要并行；把主线程重读盘拆成多个事件循环切片，也能显著改善响应性。**

## 10. 激活账号不等于重建整个应用

`Domain::_active` 变化后：

- active session producer 切到新账号的 session；
- Window controller 可以切换或创建独立窗口；
- badge、通知、主题与菜单观察者收到变化；
- 老账号的 Account/Session 可以继续存在并收更新。

因此多账号是同进程多 Session，而不是“只有一个全局 Session，把内容替换掉”。这也是为什么调用代码应从明确的 account/session 获取数据，避免滥用全局 active。

## 11. 退出顺序与为什么要显式 finish

退出不是让 C++ 静态析构自然发生。系统关机、Updater 重启、普通 Quit 的事件路径不同；Windows 甚至要避免在 `WM_ENDSESSION` 分发中同步销毁窗口。

安全顺序大体是：

1. 停止接受新操作并标记 quitting；
2. 关闭窗口与通知/媒体等观察者；
3. `Domain::finish()` 先清 active，再销毁 accounts；
4. Account 销毁 Session、网络与本地写入；
5. Application 销毁；
6. Sandbox 离开事件循环；
7. Launcher 处理 updater/relaunch，再 finish ThirdParty/Platform/Logs。

如果 owner 先死而 producer/callback 仍在跑，就会出现典型的 shutdown-only crash。显式 finish 和 lifetime 正是为控制这类尾部竞态。

## 12. 启动问题的断点矩阵

| 现象 | 第一断点 | 继续观察 |
|---|---|---|
| 第二实例没有激活已有窗口 | `Sandbox::start` | local server name、socketConnected、command parsing |
| tdata 未恢复 | `Storage::Domain::start` | passcode result、info decrypt、accountsAdded |
| 有账号但未登录 | `Account::startMtp` | auth key、session user id、createSession 条件 |
| 登录后窗口无数据 | `Account::createSession` | Main::Session ctor、Updates::stateDone、requestDialogs |
| 切账号 badge 错 | `Domain::watchSession` | activeLifetime、unreadBadgeChanges、scheduleUpdateUnreadBadge |
| 退出崩溃 | `Sandbox::closeApplication` | system shutdown 分支、Domain finish、晚到回调 |

## 13. 重要不变量

- `Domain::started()` 后 accounts 非空；
- `Domain::active()` 只在 started 后调用；
- `Account::session()` 只在 sessionExists 后调用；
- `Main::Session` 的 Data/API 服务销毁必须早于 Account/MTP owner；
- 异步回调不得假设 active account 仍是发起请求时的 account；
- 本地 passcode 失败时不能半初始化账号图。

## 14. 小结

启动主线可以概括成四段：Launcher 准备环境，Sandbox 承载 Qt 与单实例，Application 建立进程服务，Domain/Account/Session 恢复用户运行时。最重要的不是背调用顺序，而是理解每层的生命周期边界。

下一章进入 `MTP::Instance`：业务请求如何从强类型 TL 对象变成发往正确 DC 的加密消息，又怎样把结果安全地交还给 owner。

