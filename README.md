# Telegram Desktop 源码拆解

一套面向工程师的 Telegram Desktop 7.0.6 中文源码导读。它不按目录逐个解释文件，而是沿着真实运行链路回答：程序如何启动、账号与会话如何组织、MTProto 请求和更新如何流动、消息如何进入数据层并最终被绘制、媒体和本地数据如何管理。

## 在线阅读

GitHub Pages：<https://axecode.github.io/tdesktop-source-notes/>

## 内容结构

- 14 章正文：从全局架构走到启动、网络、同步、消息、UI、媒体、存储、通话与跨平台工程
- 源码地图：按任务反查关键目录、类和入口函数
- 术语表：解释 `Domain / Account / Session / History / PTS / DC / rpl` 等高频概念
- 每章包含源码入口、关键调用链、设计取舍、常见误区与继续阅读路线

分析基于 Telegram Desktop `v7.0.6`，上游源码链接固定到该 tag，避免 `dev` 分支持续变化导致行号漂移。

## 本地运行

```bash
npm install
npm run docs:dev
```

构建和校验：

```bash
npm run check:links
npm run docs:build
```

## 说明

本仓库是独立的学习资料，不隶属于 Telegram。Telegram Desktop 源码遵循其上游仓库中的 GPLv3 + OpenSSL exception；本站的原创站点代码和文字说明采用 MIT License。文中只引用必要的短代码片段，完整实现请以固定版本的上游源码为准。
