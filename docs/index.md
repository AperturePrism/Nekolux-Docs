---
layout: home

hero:
  name: Nekolux
  text: 轻量、可扩展的 OneBot v11 机器人运行时
  tagline: 插件化架构 + 标准 OneBot v11 接口，一次部署、长期稳定运行
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
    details: 完整生命周期钩子、action 注册、动态配置 UI、扩展页与静态资源、Worker 沙箱、插件市场。140+ 测试覆盖。
  - icon: 🔬
    title: 自适应版本
    details: 用函数特征码定位目标，不依赖硬编码版本表。已跨两个客户端大版本验证通过。
  - icon: 🐧
    title: 跨平台
    details: Windows 与 Linux 原生支持，Docker 一键部署。不改动宿主程序任何文件。
  - icon: 🐳
    title: Docker 部署
    details: 单容器跑通显示 + 客户端 + 运行时，VNC 登录，端口可配。已在 NAS 生产环境验证。
  - icon: 👥
    title: 多账号
    details: 同一实例托管多个账号，各自独立的 OneBot 适配器与插件上下文。
  - icon: 📡
    title: OneBot v11
    details: 225 个内置 action，覆盖消息、群管理、文件、互动等。标准 HTTP / WebSocket 适配器。
---

## 为什么有这个项目

两个先行项目都已停止维护。Nekolux 是在它们的基础上重新做的一层运行时：

- **进程外架构** —— 运行时与客户端是两个独立进程，一方异常不牵连另一方
- **插件化设计** —— action 注册、配置表单、市场索引，全部可扩展

而**版本适配**这一层自己重做了：用特征码扫描替代硬编码偏移表，
让「客户端升级就要人工重新适配」这件事的维护成本降下来。

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
