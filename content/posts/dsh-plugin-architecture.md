---
title: dsh 插件化架构与代际兼容
date: '2026-09-07'
status: published
category: 工程笔记
tags:
  - dsh
  - Cordis
  - 插件
  - 架构
owner: admin
excerpt: DeepSeek Harness 用 Cordis 做插件内核：服务声明、依赖注入、可逆卸载。但这套优雅模型的代价是"代际敏感"——主程序一改名，插件就 pending 或硬崩。记录兼容排查思路。
---

DeepSeek Harness（dsh）把"一切皆插件"落到实处，内核是 Cordis 这套**时空可组合**的元框架。理解它的架构，才能看懂为什么插件会"突然不激活"。

## Cordis 三件套：上下文、服务、注入

- **Context**：既是服务容器，也是隔离边界。每个插件在自己的 Context 里运行，继承父上下文能力
- **Service**：跨插件提供能力的载体（如对话事件、UI 会话、设置命名空间），强类型、可拦截
- **Inject**：插件用 `inject = ['serviceName']` 声明依赖，依赖就绪才激活，缺失就挂起

这种"声明式依赖"让插件像积木：加载即装配，卸载即沿依赖树自动撤销副作用（事件、定时器、服务注册），不留泄漏。

## 代价：代际敏感

优雅是有代价的。dsh 的 alpha 线会**重命名或删除服务**，于是：

- 插件要的服务没了 → `pending (waiting for service: xxx)`，软失败，插件不激活
- 插件用的导出被删 → `does not provide an export named 'CallId'`，硬失败，整个 profile 起不来

更麻烦的是：多个插件要的 API 可能分属**互斥的版本**，没有单一 dsh 版本能全兼容。

## 排查顺序（别盲升）

1. 提取插件真正依赖的服务名（`grep "export const inject"`）
2. 确认当前 dsh 是否还提供该服务（在 `dsh-*` provider 包里 `grep` 服务名，0 次 = 不存在）
3. 横向对比候选版本（只下载 tarball 静态验证，别急着装）
4. 看其他插件会不会被牵连（`peerDependencies` 声明支持哪个代次）
5. 最后才考虑升降级主程序

实测结论：当前唯一让 agent-teams、better-sidebar、commandcode-provider **同时**活下来的组合是 dsh `0.1.1-rc.2` + agent-teams `0.1.14`。升级到 alpha 线反而让两个插件硬失败。

> [!NOTE]
> 这条经验的本质：插件生态的兼容不是"越新越好"，而是"服务名契约的对齐"。主程序改名，契约就断。

## 参考来源

1. Cordis — 插件化元框架（dsh 内核），GitHub 仓库，https://github.com/cordiverse/cordis ，访问于 2026-09-07。
2. DeepSeek Harness — 官方仓库（deepseek-ai/deepseek-harness），https://github.com/deepseek-ai/deepseek-harness ，访问于 2026-09-07。
