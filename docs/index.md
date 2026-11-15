---
layout: home

hero:
  name: Nekolux
  text: 进程外 hook 驱动的 QQ NT 协议框架
  tagline: 以轻量注入驱动 QQ NT，对外提供标准 OneBot v11 接口，让机器人一次部署、长期稳定运行
  image:
    src: /logo.png
    alt: Nekolux
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/QUICKSTART
    - theme: alt
      text: 插件开发
      link: /plugins/PLUGIN-SYSTEM
    - theme: alt
      text: GitHub
      link: https://gitea.binbim.top/AperturePrism/Nekolux

features:
  - icon: 🧩
    title: 插件系统
    details: 完整生命周期钩子、action 注册、原始封包监听、动态配置 UI、扩展页与静态资源、Worker 沙箱、插件市场。140+ 测试覆盖。
  - icon: 🔬
    title: 签名式偏移
    details: 用函数序言字节特征定位 hook 点，不依赖硬编码版本表。已跨 3.2.28 / 3.2.35 双版本验证。
  - icon: 🐧
    title: Linux 原生
    details: 进程外 ptrace 注入，不修改 QQ 代码页。封包层存活已由零账号 uprobe 实验证实。
  - icon: 🐳
    title: Docker 部署
    details: 单容器跑通 Xvfb + QQ + 运行时，VNC 登录，端口可配。已在 NAS 生产环境验证。
  - icon: 👥
    title: 多账号
    details: 同一实例托管多个 QQ 账号，各自独立的 OneBot 适配器与插件上下文。
  - icon: 📡
    title: OneBot v11
    details: 225 个内置 action，覆盖消息、群管理、文件、互动等。标准 HTTP / WebSocket 适配器。
---

## 为什么有这个项目

NapCat 与 SnowLuma 都已停止维护。Nekolux 是把两者能用的部分重新组合的结果：

- **SnowLuma 的进程外 hook** —— 不侵入 QQ 进程内存，注入失败也不影响 QQ 本身
- **NapCat 的插件生态设计** —— action 注册、配置表单、市场索引

而**偏移定位**这一层自己重做了：用签名扫描替代硬编码版本表，让「QQ 升级就要人工逆向」这件事的维护成本降下来。

## 三分钟跑起来

```bash
# 1. 构建运行时
pnpm install && pnpm build:all

# 2. 组装 Docker 镜像
export NEKOLUX_DIST=$PWD/dist
cd unified/docker && bash build.sh

# 3. 起容器（VNC 登录 QQ）
docker run -d --name nekolux \
  --cap-add SYS_PTRACE --security-opt seccomp=unconfined \
  -e VNC_PASSWORD=你的密码 \
  -p 5099:5099 -p 5902:5900 -p 3000:3000 \
  -v ./data:/app/data nekolux:local
```

打开 `http://<host>:5099`，VNC 连 `:5902` 扫码登录，OneBot 在 `:3000` 就绪。

详见 [快速开始](/guide/QUICKSTART) · [Windows 部署](/guide/DEPLOY-WINDOWS) · [Linux 部署](/guide/DEPLOY-LINUX)。
