---
layout: home

hero:
  name: Telegram Desktop 源码拆解
  text: 从 106 万行 C++ 中找到主干
  tagline: 不逐文件背目录。沿着启动、请求、同步、数据、消息、界面、媒体和存储的真实运行链路，建立一张可用于调试与二次开发的系统地图。
  image:
    src: /logo.svg
    alt: Telegram Desktop Source Notes
  actions:
    - theme: brand
      text: 从第 1 章开始
      link: /chapters/01-overview
    - theme: alt
      text: 先看阅读指南
      link: /reading-guide
    - theme: alt
      text: 打开源码地图
      link: /appendix/source-map

features:
  - icon: ◎
    title: 沿运行链路拆解
    details: 每章都从一个用户动作或系统事件开始，追踪它如何穿过网络、数据层和界面，而不是只解释孤立的类。
  - icon: ⇄
    title: 双向源码索引
    details: 既可以按章节顺序学习，也可以从“我要找发送、更新、缓存、导航代码”反查最小入口集合。
  - icon: ⌁
    title: 设计取舍优先
    details: 除了“代码做了什么”，还解释为什么需要 PTS 补洞、乐观消息、rpl 生命周期、分层密钥和平台适配层。
  - icon: ◫
    title: 固定版本锚点
    details: 基于 Telegram Desktop v7.0.6，源码链接固定到 tag，减少 dev 分支变化造成的认知漂移。
  - icon: ⚑
    title: 调试导向
    details: 每条主线都给出断点候选、状态不变量、常见误判与验证方式，方便把地图带回真实问题。
  - icon: ◇
    title: VitePress 在线书
    details: 本地全文搜索、深色模式、移动端目录、GitHub Pages 自动发布，Markdown 源文件也适合离线阅读。
---

## 一张图建立主线

<div class="flow">平台入口
   │
   ▼
Core::Launcher ──► Core::Sandbox ──► Core::Application
   │                                      │
   │                                      ▼
   │                              Main::Domain（多账号集合）
   │                                      │
   │                                      ▼
   │                              Main::Account（授权与 MTProto）
   │                                      │
   │                         ┌────────────┴────────────┐
   │                         ▼                         ▼
   │                  Main::Session               MTP::Instance
   │                         │                         │
   │                         ▼                         ▼
   │                  Data::Session ◄──── Api::Updates / ApiWrap
   │                         │
   │              ┌──────────┼───────────┐
   │              ▼          ▼           ▼
   │           History    Storage      Media
   │              │
   ▼              ▼
Qt 事件循环 ──► Window::SessionController ──► HistoryView / Dialogs / Info</div>

这张图故意省略了大量产品功能，却保留了绝大多数问题都必须经过的“骨架对象”。理解这些对象的所有权和消息流，之后再进入贴纸、Stories、群组通话、支付或 WebView，都会容易很多。

## 14 章路线

| 阶段 | 章节 | 你最终能回答的问题 |
|---|---|---|
| 建模 | 01–03 | 这个百万行客户端的稳定边界在哪里？启动后谁拥有账号、会话和窗口？ |
| 网络 | 04–05 | 一个 TL 请求怎样发出？推送乱序或丢失时，客户端怎样恢复一致？ |
| 数据 | 06–08 | User/Chat/Channel/HistoryItem 如何归一化？发送消息为什么先出现在屏幕上？ |
| 界面 | 09 | rpl、lifetime、Controller、Memento 如何协作而不把业务状态锁死在 Widget 里？ |
| 重型子系统 | 10–12 | 下载如何并发调度？本地数据怎样加密？通话怎样跨过信令与媒体引擎边界？ |
| 工程 | 13–14 | 平台差异、代码生成与发布怎样隔离？遇到问题该从哪里下断点？ |

## 推荐阅读方式

- 第一次读：按 `01 → 09` 顺序，先拿到主干，再按兴趣选 `10–13`。
- 带着 bug 读：直接去[源码地图](/appendix/source-map)，找到所属链路后只读相邻两章。
- 做二次开发：先读 `02 / 03 / 06 / 09 / 13`，重点看边界和生命周期。
- 研究协议同步：集中读 `04 / 05 / 08`，把 request、update、random_id、pts/seq 放进同一张图。

::: tip 基线说明
本教程分析的是本地快照 `7.0.6`（`AppVersion 7000006`）。上游仍会快速演进；文中所有源码链接都固定到 `v7.0.6`，概念性结论则尽量只依赖长期稳定的结构。
:::
