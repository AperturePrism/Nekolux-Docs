import { defineConfig } from 'vitepress';

export default defineConfig({
    lang: 'zh-CN',
    title: 'Nekolux',
    description: 'Nekolux —— 进程外 hook 驱动的 QQ NT 协议框架',
    base: '/',
    cleanUrls: true,
    lastUpdated: true,

    head: [
        ['link', { rel: 'icon', href: '/logo.png' }],
        ['meta', { name: 'theme-color', content: '#8561bd' }],
        ['meta', { property: 'og:type', content: 'website' }],
        ['meta', { property: 'og:title', content: 'Nekolux 文档' }],
        [
            'meta',
            {
                property: 'og:description',
                content: '进程外 hook 驱动 QQ NT，对外提供标准 OneBot v11 接口',
            },
        ],
    ],

    themeConfig: {
        logo: '/logo.png',
        siteTitle: 'Nekolux',

        nav: [
            { text: '指南', link: '/guide/overview', activeMatch: '/guide/' },
            { text: '插件开发', link: '/plugins/PLUGIN-SYSTEM', activeMatch: '/plugins/' },
            { text: '协议层', link: '/protocol/LINUX-HOOK-INVESTIGATION', activeMatch: '/protocol/' },
            { text: '报告', link: '/reports/X64-CODEC-ALIVE-EXPERIMENT', activeMatch: '/reports/' },
            {
                text: '相关仓库',
                items: [
                    { text: '主仓库', link: 'https://github.com/AperturePrism/Nekolux' },
                    { text: '插件源', link: 'https://github.com/AperturePrism/Nekolux-Plugins' },
                    { text: 'Gitea 镜像', link: 'https://gitea.binbim.top/AperturePrism/Nekolux' },
                ],
            },
        ],

        sidebar: {
            '/guide/': [
                {
                    text: '开始使用',
                    items: [
                        { text: '项目总览', link: '/guide/overview' },
                        { text: '运行时装配', link: '/guide/RUNTIME-ASSEMBLY' },
                        { text: 'NAS 部署', link: '/guide/NAS-DEPLOYMENT' },
                        { text: '多账号', link: '/guide/MULTI-ACCOUNT' },
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
            { icon: 'github', link: 'https://github.com/AperturePrism/Nekolux' },
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
