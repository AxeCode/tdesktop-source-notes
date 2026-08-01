import { defineConfig } from 'vitepress'

const github = 'https://github.com/Hanqing/tdesktop-source-notes'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Telegram Desktop 源码拆解',
  description: '从启动、MTProto、同步、消息、UI、媒体、存储到通话，系统拆解 Telegram Desktop 7.0.6',
  base: '/tdesktop-source-notes/',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['meta', { name: 'theme-color', content: '#17212b' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Telegram Desktop 源码拆解' }],
    ['meta', { property: 'og:description', content: '一套沿真实运行链路组织的 Telegram Desktop 7.0.6 中文源码导读' }],
    ['link', { rel: 'icon', href: '/tdesktop-source-notes/logo.svg', type: 'image/svg+xml' }]
  ],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'tdesktop / source notes',
    search: { provider: 'local' },
    outline: { level: [2, 3], label: '本章导航' },
    lastUpdated: { text: '最后更新于' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    darkModeSwitchLabel: '外观',
    sidebarMenuLabel: '目录',
    returnToTopLabel: '回到顶部',
    nav: [
      { text: '开始阅读', link: '/chapters/01-overview' },
      { text: '源码地图', link: '/appendix/source-map' },
      { text: '术语表', link: '/appendix/glossary' },
      { text: 'v7.0.6', link: 'https://github.com/telegramdesktop/tdesktop/tree/v7.0.6' }
    ],
    sidebar: [
      {
        text: '阅读指南',
        items: [
          { text: '首页与路线图', link: '/' },
          { text: '如何使用这套文档', link: '/reading-guide' }
        ]
      },
      {
        text: '第一部分 · 建立全局模型',
        collapsed: false,
        items: [
          { text: '01 · 全貌与系统边界', link: '/chapters/01-overview' },
          { text: '02 · 仓库、构建与代码生成', link: '/chapters/02-repository-build' },
          { text: '03 · 启动、进程与多账号', link: '/chapters/03-startup-lifecycle' }
        ]
      },
      {
        text: '第二部分 · 网络与一致性',
        collapsed: false,
        items: [
          { text: '04 · MTProto 请求管线', link: '/chapters/04-mtproto' },
          { text: '05 · Updates 同步引擎', link: '/chapters/05-updates' },
          { text: '06 · Data::Session 领域模型', link: '/chapters/06-data-model' }
        ]
      },
      {
        text: '第三部分 · 消息与界面',
        collapsed: false,
        items: [
          { text: '07 · History 消息模型', link: '/chapters/07-history' },
          { text: '08 · 发送消息与乐观更新', link: '/chapters/08-send-message' },
          { text: '09 · 窗口、导航与响应式 UI', link: '/chapters/09-ui-reactive' }
        ]
      },
      {
        text: '第四部分 · 重型子系统',
        collapsed: false,
        items: [
          { text: '10 · 媒体、下载与播放', link: '/chapters/10-media' },
          { text: '11 · 本地存储与密钥层次', link: '/chapters/11-storage' },
          { text: '12 · 语音与视频通话', link: '/chapters/12-calls' }
        ]
      },
      {
        text: '第五部分 · 工程方法',
        collapsed: false,
        items: [
          { text: '13 · 跨平台与发布工程', link: '/chapters/13-cross-platform' },
          { text: '14 · 调试与源码阅读方法', link: '/chapters/14-debugging' }
        ]
      },
      {
        text: '附录',
        items: [
          { text: 'A · 源码地图', link: '/appendix/source-map' },
          { text: 'B · 术语表', link: '/appendix/glossary' },
          { text: 'C · 版本与方法说明', link: '/appendix/methodology' }
        ]
      }
    ],
    socialLinks: [{ icon: 'github', link: github }],
    editLink: { pattern: `${github}/edit/main/docs/:path`, text: '在 GitHub 上改进此页' },
    footer: {
      message: '独立学习资料 · 基于 Telegram Desktop v7.0.6',
      copyright: 'Released under the MIT License'
    }
  }
})
