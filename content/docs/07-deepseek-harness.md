---
title: DeepSeek Harness——让模型变成能干活的东西
date: '2026-09-05'
updated: '2026-09-13'
status: published
category: AI 入门
tags:
  - AI
  - API
  - Agent
order: 6
---

前六篇聊的是怎么调用API，让模型能回答你的问题。但很多情况下，光回答不够，你希望它直接帮你把事干了——读文件、改代码、跑命令、查资料，然后自己把整个流程跑完。

DeepSeek 开源了一个叫 **DeepSeek Harness**（简称 dsh）的框架，做的事就是上面说的这些。

如果你把大模型比作一个人的"大脑"，那 Harness 就是给这个大脑装上了"手脚"——让它能读文件、调工具、执行命令、管理上下文，还能在失败的时候自己重试。

官方给了一个很直白的公式：

> **Model + Harness = Agent**

Harness 本身**不包含模型**，它负责的是 Agent 层的工作：调度工具、管理上下文、编排执行流程。你给它配好模型（就是前面几篇里你拿到 API Key 的那些），它就能干活了。

## 它能做什么

dsh 内置了本地 Agent 工作台需要的全套能力：

| 能力 | 说明 |
|------|------|
| **项目管理** | 在指定项目目录里工作 |
| **文件操作** | 读、写、搜索、编辑文件 |
| **命令执行** | 在终端里跑命令（Linux/macOS 用 Bash，Windows 用 PowerShell） |
| **网页搜索** | 联网获取最新信息 |
| **多智能体编排** | 主 Agent 可以把任务拆给子 Agent |
| **上下文管理** | 维持长对话的记忆和状态 |

## 四种运行模式

dsh 内置了四种模式，按场景切换：

| 模式 | 特点 | 适用场景 |
| :--- | :--- | :--- |
| **标准模式** | 搭载全套工具组件 | 通用开发，绝大多数情况用这个 |
| **PTC模式** | 由模型生成代码编排多轮工具调用 | 需要精确控制工具调用流程的自动化任务 |
| **极简模式** | 只保留 Shell 和文件编辑两个工具 | 最小环境下的模型基准测试 |
| **创造模式** | 支持运行时调试插件，可自定义生成全新模式 | 想自己折腾插件和预设的开发者 |

## 安装

先确认电脑上装了 Node.js，版本要求 **≥ 22.19.0**。终端输入 `node --version` 检查，没有的话去 [nodejs.org](https://nodejs.org/) 下载安装。

然后直接运行这一条命令：

```bash
npx @deepseek-ai/dsh web
```

这条命令会自动下载并启动 dsh 的 Web 界面。首次运行可能需要等一两分钟下载依赖。启动成功后，在浏览器里打开 `http://127.0.0.1:3080` 就能看到 Web UI。

如果不想每次都用 `npx`，可以全局安装：

```bash
npm install -g @deepseek-ai/dsh
dsh web
```

## 首次进入要做的两件事

1. **配置 API Key**：进入 Settings → Models，填入你在 DeepSeek 开放平台（`platform.deepseek.com`）申请的 API Key。
2. **选择工作区**：点击 Choose workspace，添加一个工作目录。这样 Harness 才能访问你指定文件夹里的文件。

> [!TIP]
> **工作区范围是安全边界。** 所有文件操作都限制在这个目录内，超出范围的读写会被拦。所以别图省事把根目录设成工作区。

配置完就可以在主界面下指令了。

## 核心理念：一切皆插件

dsh 的所有功能模块——模型适配器、工具注册表、会话日志，甚至 Agent 循环本身——**全部以插件形式存在**，每一个都可以被替换。它底层基于一个叫 Cordis 的元框架，负责插件的加载、卸载和依赖管理。

这意味着你可以自由组装自己的 Agent：想换模型就换模型，想加工具就加工具，不用动框架本身的代码。

## ⚠️ 版本兼容：不要盲目升级

这是我在实际使用中踩得最狠的一个坑，值得单独说。

dsh 处于快速迭代期，alpha 线会**重命名或删除服务**。插件依赖的服务一旦没了，会出现两种失败：

| 失败类型 | 表现 | 影响 |
|----------|------|------|
| 软失败 | `pending (waiting for service: xxx)` | 只有该插件不激活 |
| 硬失败 | `does not provide an export named 'CallId'` | **整个 profile 起不来** |

实测下来，能让 agent-teams、commandcode-provider、better-sidebar 三个插件**同时**活下来的组合是：

```bash
# 主程序锁 0.1.1-rc.2
# 插件 @nanmicoder/dsh-agent-teams 锁 0.1.14
```

> [!WARNING]
> **升级到 alpha 线会让插件硬失败，`dsh web` 完全起不来。** 原因是这些插件的 `peerDependencies` 只声明到 `^0.1.1-rc.x`，升上去 peer 契约就断了。
>
> 判断能否升级，看的是**服务名与 peer 声明**，不是 changelog 写了多少新功能。版本号变大不等于兼容变好。

## 不想用命令行？

dsh 也有社区打包的桌面版，下载解压就能用，不需要装 Node.js。可以在 GitHub 上搜索 `deepseek-harness-desktop` 找下载地址。

> [!NOTE]
> dsh 本身是免费且开源的，但它只是一个**运行框架**。使用时需要你自己提供 API Key，并为消耗的 Token 付费。

## 关键词汇解释

| 术语 | 解释 |
|------|------|
| **DeepSeek Harness (dsh)** | DeepSeek开源的AI Agent运行框架，让模型能调用工具、读写文件、执行命令。 |
| **Agent** | 能独立完成任务的AI系统。基础逻辑：思考→规划→调用工具→执行→迭代。 |
| **Cordis** | dsh底层依赖的元框架，负责插件的加载、卸载和依赖管理。 |
| **PTC模式** | Programmatic Tool Calling的缩写，dsh的一种运行模式，专注于程序化的工具调用。 |
| **工作区（Workspace）** | dsh能访问的文件夹目录，所有文件操作都在这个范围内。 |
| **插件（Plugin）** | dsh的功能模块，可以自由替换和扩展。 |

## 相关链接

| 链接 | 说明 |
|------|------|
| [DeepSeek Harness GitHub](https://github.com/deepseek-ai/deepseek-harness) | dsh官方仓库 |
| [DeepSeek Platform](https://platform.deepseek.com/) | 获取API Key |
| [Node.js 官网](https://nodejs.org/) | Node.js安装包 |
| [Cordis](https://github.com/cordiverse/cordis) | dsh 的插件内核 |
