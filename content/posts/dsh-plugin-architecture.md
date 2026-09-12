---
title: dsh 插件化架构与代际兼容
date: '2026-09-07'
updated: '2026-09-13'
status: published
category: 工程笔记
tags:
  - dsh
  - Cordis
  - 插件
  - 架构
  - 版本兼容
owner: admin
excerpt: DeepSeek Harness 用 Cordis 做插件内核：服务声明、依赖注入、可逆卸载。但这套优雅模型的代价是"代际敏感"——主程序一改名，插件就 pending 或硬崩。记录一套可复用的排查顺序，以及当前唯一可用的版本组合。
cover: /covers/dsh-plugin-architecture.svg
---

DeepSeek Harness（dsh）把"一切皆插件"落到实处，内核是 Cordis 这套**时空可组合**的元框架 [1]。理解它的架构，才能看懂为什么插件会"突然不激活"——以及为什么**盲目升级主程序几乎总是错的解法**。

## Cordis 三件套：上下文、服务、注入

- **Context**：既是服务容器，也是隔离边界。每个插件在自己的 Context 里运行，继承父上下文能力
- **Service**：跨插件提供能力的载体（对话事件、UI 会话、设置命名空间等），强类型、可拦截
- **Inject**：插件用 `inject` 声明依赖，依赖就绪才激活，缺失就挂起

```ts
import { Context } from 'cordis'

export const inject = ['chat', 'settings']  // 声明依赖，就绪才激活

export function apply(ctx: Context) {
  // 事件监听、命令注册等副作用都被 ctx 托管
  ctx.on('chat/message', (msg) => {
    console.log('got:', msg.text)
  })

  ctx.setInterval(() => {
    // 定时器同样被托管
  }, 1000)
}
```

关键在于 `ctx` **托管了所有副作用**：事件监听、定时器、服务注册都记在这个 Context 的账上。卸载时沿依赖树自动撤销，不留泄漏——这是"可逆卸载"的真实含义，也是它比普通插件系统优雅的地方。

## 代价：代际敏感

优雅是有代价的。dsh 处于快速迭代期，alpha 线会**重命名或删除服务**。于是同一个插件在不同 dsh 版本上有两种截然不同的失败：

| 失败类型 | 触发条件 | 表现 | 影响面 |
|----------|----------|------|--------|
| **软失败** | 插件要的服务被改名 | `pending (waiting for service: xxx)` | 只有该插件不激活，其余照常 |
| **硬失败** | 插件 import 的导出被删 | `does not provide an export named 'CallId'` | **整个 profile 起不来** |

硬失败最要命：它不是"少个功能"，而是 `dsh web` 直接起不来。

> [!WARNING]
> 更麻烦的是，多个插件依赖的 API 可能分属**互斥的代次**，并不存在某个 dsh 版本能同时满足所有插件。这时候"升级到最新版"不是解法，反而是制造问题。

## 排查顺序：先静态验证，别急着装

我踩过一轮之后，把流程固化成下面五步。**前三步全是只读操作，不动依赖**：

**1. 提取插件真正依赖的服务名**

```bash
grep -rn "export const inject" node_modules/@nanmicoder/dsh-agent-teams/
```

**2. 确认当前 dsh 是否还提供该服务**

```bash
grep -rn "serviceName" node_modules/@nanmicoder/dsh-*/dist/
# 命中 0 次 = 该服务在这一代已被移除
```

**3. 横向对比候选版本（只下 tarball 静态验证）**

```bash
npm pack @nanmicoder/dsh-agent-teams@0.1.14 --pack-destination /tmp/dsh-probe
# 解开看 package.json 的 peerDependencies，不真正安装
```

**4. 看其他插件会不会被牵连**——检查各插件 `peerDependencies` 声明支持哪个代次。

**5. 最后才考虑升降级主程序。**

## 实测结论：唯一可用的版本组合

按上面流程逐个验证后，结论很明确：

| 组合 | agent-teams | commandcode-provider | better-sidebar | 结论 |
|------|-------------|----------------------|----------------|------|
| dsh `0.1.1-rc.2` + agent-teams `0.1.14` | 激活 | 激活 | 激活 | **唯一全绿** |
| dsh `0.1.2-alpha.x` | 硬失败 | 硬失败 | 硬失败 | profile 起不来 |

原因不是"新版有 bug"，而是 `commandcode-provider` 与 `dsh-better-sidebar` 的 `peerDependencies` **只声明到 `^0.1.1-rc.x`**。升到 alpha 线后 peer 契约断裂，`dsh web` 完全起不来。

> [!NOTE]
> 这条经验的本质：插件生态的兼容不是"越新越好"，而是**服务名契约的对齐**。主程序一改名，契约就断。所以判断能否升级，看的是 peer 声明与导出符号，不是 changelog 写了多少新功能。

## 四个真实踩过的坑

1. **把硬失败误判成软失败**：看到某个插件 `pending`，以为是它自己的问题，去改它；结果真正的杀手是另一个插件的硬失败导致 profile 没起来。**先看 dsh web 能不能起，再看单个插件**。
2. **用 npm 装 dsh 插件污染 pnpm 工程**：pnpm 的 `isolated` 布局下混用 npm 安装会破坏 `node_modules` 结构并产生 lockfile 冲突。dsh 侧一律用 pnpm，不要图省事 `npm i`。
3. **改了版本没清插件缓存**：dsh 会缓存插件解析结果。升级后如果行为没变，先确认缓存失效，否则会一直在旧状态里排查。
4. **同时改多个变量**：一次既升主程序又升插件，出事后无法归因。版本问题必须**一次只动一个**，动完立刻验证。

## 小结

| 原则 | 做法 |
|------|------|
| 先看面再看点 | 先确认 profile 能起，再查单个插件 |
| 静态优先 | 用 `npm pack` 看 peerDependencies，别急着装 |
| 一次一动 | 版本变更逐个验证，失败立刻回退 |
| 信契约不信版本号 | 对齐的是服务名与 peer 声明，不是"最新" |

插件化架构带来的是组合能力，代价是**契约的脆弱**。接受这个代价，把验证做成流程而不是直觉，比任何"升级试试"都可靠 [2]。

## 参考来源

1. Cordis — 插件化元框架（dsh 内核），GitHub 仓库，https://github.com/cordiverse/cordis ，访问于 2026-09-13。
2. DeepSeek Harness — 官方仓库（deepseek-ai/deepseek-harness），https://github.com/deepseek-ai/deepseek-harness ，访问于 2026-09-13。
3. npm 文档 — 《peerDependencies》与 `npm pack` 用法，https://docs.npmjs.com/cli/v10/configuring-npm/package-json#peerdependencies ，访问于 2026-09-13。
