import { defineConfig } from 'vitepress';

export default defineConfig({
    lang: 'zh-CN',
    title: 'Nekolux',
    description: 'Nekolux —— 轻量、可扩展的 OneBot v11 机器人运行时',
    base: '/',
    cleanUrls: true,
    lastUpdated: true,

    head: [
        ['link', { rel: 'icon', href: '/logo.png' }],
        ['meta', { name: 'theme-color', content: '#8561bd' }],

        // ── SEO ──
        // 刻意只描述「机器人运行时 / OneBot 协议端」这个层面，
        // 不写具体宿主软件名、不写实现手法 —— 这些词会把站点暴露给
        // 无关的搜索流量，也会让文档看起来像是针对特定厂商产品的工具。
        ['meta', { name: 'description', content: 'Nekolux —— 轻量、可扩展的 OneBot v11 机器人运行时。插件化架构，支持 Windows / Linux / Docker 部署。' }],
        // 主动从搜索引擎下架：noindex 让已收录页面被移除，nofollow 阻止继续扩散。
        // 注意顺序：必须先 noindex，等搜索结果清空后才能改 robots.txt Disallow——
        // 反过来会让爬虫进不来、看不到 noindex，旧页面反而赖在索引里。
        ['meta', { name: 'robots', content: 'noindex, nofollow, noarchive, nosnippet' }],
        ['link', { rel: 'canonical', href: 'https://Nekolux.aprism.top/' }],

        // ── 社交卡片 ──
        ['meta', { property: 'og:type', content: 'website' }],
        ['meta', { property: 'og:site_name', content: 'Nekolux' }],
        ['meta', { property: 'og:title', content: 'Nekolux 文档' }],
        ['meta', { property: 'og:description', content: '轻量、可扩展的 OneBot v11 机器人运行时。' }],
        ['meta', { property: 'og:url', content: 'https://Nekolux.aprism.top/' }],
        ['meta', { property: 'og:image', content: 'https://Nekolux.aprism.top/logo.png' }],
        ['meta', { name: 'twitter:card', content: 'summary' }],
    ],

    themeConfig: {
        logo: '/logo.png',
        siteTitle: 'Nekolux',

        nav: [
            { text: '指南', link: '/guide/QUICKSTART', activeMatch: '/guide/' },
            { text: '插件开发', link: '/plugins/PLUGIN-SYSTEM', activeMatch: '/plugins/' },
            { text: '技术笔记', link: '/protocol/LINUX-HOOK-INVESTIGATION', activeMatch: '/protocol/' },
            { text: '验证记录', link: '/reports/X64-CODEC-ALIVE-EXPERIMENT', activeMatch: '/reports/' },
            {
                text: '相关仓库',
                items: [
                    { text: '主仓库', link: 'https://gitea.binbim.top/AperturePrism/Nekolux' },
                    { text: '插件源', link: 'https://plugins.aprism.top' },
                    { text: '文档源码', link: 'https://github.com/AperturePrism/Nekolux-Docs' },
                ],
            },
        ],

        sidebar: {
            '/guide/': [
                {
                    text: '开始使用',
                    items: [
                        { text: '项目总览', link: '/guide/overview' },
                        { text: '快速开始', link: '/guide/QUICKSTART' },
                    ],
                },
                {
                    text: '部署',
                    items: [
                        { text: 'Windows 部署', link: '/guide/DEPLOY-WINDOWS' },
                        { text: 'Linux 部署', link: '/guide/DEPLOY-LINUX' },
                        { text: 'NAS 部署', link: '/guide/NAS-DEPLOYMENT' },
                        { text: '运行时装配', link: '/guide/RUNTIME-ASSEMBLY' },
                        { text: '多账号', link: '/guide/MULTI-ACCOUNT' },
                        { text: '资源占用', link: '/guide/RESOURCE-USAGE' },
                    ],
                },
                {
                    text: '其他',
                    items: [
                        { text: '合并方案', link: '/guide/MERGE-PLAN' },
                        { text: 'E2E 验证', link: '/guide/E2E-VERIFICATION' },
                        { text: 'NAS 测试报告', link: '/guide/NAS-TEST-REPORT' },
                    ],
                },
            ],
            '/plugins/': [
                {
                    text: '插件开发',
                    items: [{ text: '插件系统完整参考', link: '/plugins/PLUGIN-SYSTEM' }],
                },
                {
                    text: '插件市场',
                    items: [
                        {
                            text: '官方插件源',
                            link: 'https://github.com/AperturePrism/Nekolux-Plugins',
                        },
                    ],
                },
            ],
            '/protocol/': [
                {
                    text: '协议层',
                    items: [
                        { text: 'Linux 封包 Hook 调查', link: '/protocol/LINUX-HOOK-INVESTIGATION' },
                        { text: '封包 Hook 集成', link: '/protocol/PACKET-HOOK-INTEGRATION' },
                        { text: '偏移维护', link: '/protocol/OFFSET-MAINTENANCE' },
                        { text: 'NapCat 偏移逆向', link: '/protocol/NAPCAT-OFFSET-REVERSING' },
                        { text: 'Linux 签名状态', link: '/protocol/LINUX-SIGNATURE-STATUS' },
                    ],
                },
            ],
            '/reports/': [
                {
                    text: '验证报告',
                    items: [
                        {
                            text: 'x64 codec 存活实验',
                            link: '/reports/X64-CODEC-ALIVE-EXPERIMENT',
                        },
                        { text: 'NAS 验收', link: '/reports/NAS-ACCEPTANCE-2026-11-15' },
                        { text: '阶段 0 验证（Windows）', link: '/reports/PHASE0-VERIFICATION' },
                        { text: '阶段 0 验证（Linux）', link: '/reports/PHASE0-LINUX-VERIFICATION' },
                        { text: '架构分析', link: '/reports/ARCHITECTURE-ANALYSIS' },
                    ],
                },
            ],
        },

        socialLinks: [
            { icon: 'github', link: 'https://gitea.binbim.top/AperturePrism/Nekolux' },
        ],

        search: {
            provider: 'local',
            options: {
                translations: {
                    button: {
                        buttonText: '搜索文档',
                        buttonAriaLabel: '搜索文档',
                    },
                    modal: {
                        noResultsText: '没有找到结果',
                        resetButtonTitle: '清除',
                        footer: {
                            selectText: '选择',
                            navigateText: '切换',
                            closeText: '关闭',
                        },
                    },
                },
            },
        },

        docFooter: {
            prev: '上一篇',
            next: '下一篇',
        },

        outline: {
            label: '本页目录',
            level: [2, 3],
        },

        lastUpdated: {
            text: '最后更新于',
            formatOptions: { dateStyle: 'medium', timeStyle: 'short' },
        },

        returnToTopLabel: '回到顶部',
        sidebarMenuLabel: '菜单',
        darkModeSwitchLabel: '主题',
        lightModeSwitchTitle: '切换到浅色模式',
        darkModeSwitchTitle: '切换到深色模式',

        footer: {
            message: '基于 PolyForm Noncommercial 1.0.0 授权 · 仅供学习研究',
            copyright: 'Copyright © 2026 AperturePrism',
        },
    },
});
