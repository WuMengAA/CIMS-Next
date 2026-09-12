---
title: DeepSeek Harness（dsh）本地 AI 运行底座
date: '2026-09-07'
updated: '2026-09-13'
status: published
category: 本地项目
tags:
  - AI
  - 插件
  - Cordis
  - 本地运行
owner: admin
excerpt: 一个本地运行的 AI 控制台底座，基于 Cordis 插件容器。第三方插件以声明式依赖接入服务，主程序按需提供——星璃的"大脑"之一就跑在这里。
---

## 它是什么

DeepSeek Harness（dsh）是一个**跑在本机的 AI 控制台底座**，不是某个线上 SaaS。它用 Cordis 作为插件容器：主程序提供一系列"服务"（如对话事件、UI 会话、设置命名空间），第三方插件通过 `inject` 声明自己依赖哪些服务、导出哪些能力，由容器在启动时装配起来。

> [!NOTE]
> 这种"容器 + 声明式依赖"的模型，让能力可以像积木一样拼装：今天加一个侧边栏插件，明天加一个子代理团队插件，彼此通过服务名解耦，不必硬编码互相引用。

## 为什么是本地

星璃的 AI 能力里，有一部分是**必须在本地成型**的：插件要在用户的机器上加载、调试、随环境变。把底座放在本地，意味着插件生态、配置、模型接入都跟着用户走，不依赖某个远端账号或订阅。这也契合"本地优先"的整体取向。

## 真实的坑：代际兼容

dsh 的 alpha 线会重命名或删除服务，导致依赖旧服务的插件 `pending`（软失败，不激活）或 `SyntaxError`（硬失败，整个 profile 起不来）。已实测的兼容矩阵表明：当前唯一能让 agent-teams、better-sidebar、commandcode-provider 三个插件**同时**活下来的组合，是 dsh `0.1.1-rc.2` + agent-teams `0.1.14`——升到 alpha 线反而会让两个插件硬失败，dsh web 完全起不来。

> [!WARNING]
> 升级 dsh 往往不是解药。多个插件要的 API 可能分属互斥的版本，没有单一版本能全兼容。排查顺序是：先确认插件真正依赖的服务名 → 确认当前 dsh 是否还提供 → 横向对比候选版本 → 最后才考虑升降级主程序。

## 当前状态

底座运行正常，插件组合**锁定**在 dsh `0.1.1-rc.2` + `@nanmicoder/dsh-agent-teams@0.1.14`。

这个组合是实测排出来的唯一解，不是"装最新版"。后续任何升级都必须重跑一遍服务名与 peer 声明的验证——**版本号变大不等于兼容变好**。

## 参考来源

1. DeepSeek Harness — 官方仓库（deepseek-ai/deepseek-harness，MIT 协议），https://github.com/deepseek-ai/deepseek-harness ，访问于 2026-09-07。
2. Cordis — 插件化元框架（dsh 的内核，由 Koishi 作者 Shigma 开源），GitHub 仓库，https://github.com/cordiverse/cordis ，访问于 2026-09-07。
3. `@deepseek-ai/dsh` — npm 包（本地安装入口），https://www.npmjs.com/package/@deepseek-ai/dsh ，访问于 2026-09-07。
