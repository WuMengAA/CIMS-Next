---
title: DeepSeek Harness——让模型变成能干活的东西
date: '2026-09-05'
status: published
category: AI 入门
tags:
  - AI
  - API
order: 6
---
前六篇聊的是怎么调用API，让模型能回答你的问题。但很多情况下，光回答不够，你希望它直接帮你把事干了——读文件、改代码、跑命令、查资料，然后自己把整个流程跑完。

2026年8月，DeepSeek开源了一个叫DeepSeek Harness（简称DSH）的框架，做的事就是上面说的这些。

如果你把大模型比作一个人的“大脑”，那Harness就是给这个大脑装上了“手脚”——让它能读文件、调工具、执行命令、管理上下文，还能在失败的时候自己重试。

官方给了一个很直白的公式：

&gt; **Model + Harness = Agent**

Harness本身不包含模型，它负责的是Agent层的工作：调度工具、管理上下文、编排执行流程。你给它配好模型（就是前面几篇里你拿到API Key的那些），它就能干活了。

### 它能做什么

DSH内置了本地Agent工作台需要的全套能力：

- **项目管理**：在指定项目目录里工作
- **文件操作**：读、写、搜索、编辑文件
- **命令执行**：在终端里跑命令（Linux/macOS用Bash，Windows用PowerShell）
- **网页搜索**：联网获取最新信息
- **多智能体编排**：主Agent可以把任务拆给子Agent
- **上下文管理**：维持长对话的记忆和状态

### 四种运行模式

DSH内置了四种模式，按场景切换：

| 模式 | 特点 | 适用场景 |

| :--- | :--- | :--- |

| **标准模式** | 搭载全套工具组件 | 通用开发，绝大多数情况用这个 |

| **PTC模式** | 由模型生成代码编排多轮工具调用 | 需要精确控制工具调用流程的自动化任务 |

| **极简模式** | 只保留Shell和文件编辑两个工具 | 最小环境下的模型基准测试 |

| **创造模式** | 支持运行时调试插件，可自定义生成全新模式 | 想自己折腾插件和预设的开发者 |

### 安装

先确认你的电脑上装了Node.js，版本要求≥22.19.0。在终端输入`node --version`检查一下。如果没有，去[nodejs.org](https://nodejs.org/)下载安装。

然后直接运行这一条命令：

\`\`\`bash

npx @deepseek-ai/dsh web

\`\`\`

这条命令会自动下载并启动DSH的Web界面。首次运行可能需要等一两分钟下载依赖。启动成功后，在浏览器里打开`http://127.0.0.1:3080`[，就能看到Web](http://127.0.0.1:3080`，就能看到Web) UI了。

如果不想每次都用`npx`，可以全局安装：

\`\`\`bash

npm install -g @deepseek-ai/dsh

dsh web

\`\`\`

首次进入Web UI后，还需要做两件事：

1. **配置API Key**：进入Settings → Models，填入你在DeepSeek开放平台（`platform.deepseek.com`）申请的API Key。
2. **选择工作区**：点击Choose workspace，添加一个工作目录。这样Harness才能访问你指定文件夹里的文件。

配置完后，就可以在主界面里给它下指令了。

### 核心理念：一切皆插件

DSH的所有功能模块——模型适配器、工具注册表、会话日志，甚至Agent循环本身——全部以插件形式存在，每一个都可以被替换。它底层基于一个叫Cordis的元框架，负责插件的加载、卸载和依赖管理。

这意味着你可以自由组装自己的Agent：想换模型就换模型，想加工具就加工具，不用动框架本身的代码。

### 补充：不想用命令行？

DSH也有社区打包的桌面版，下载解压就能用，不需要装Node.js。可以在GitHub上搜索`deepseek-harness-desktop`找下载地址。

&gt; 注意：DSH本身是免费且开源的，但它只是一个运行框架。使用时需要你自己提供API Key，并为消耗的Token付费。

## 关键词汇解释

| 术语 | 解释 |

|------|------|

| **DeepSeek Harness (DSH)** | DeepSeek开源的AI Agent运行框架，让模型能调用工具、读写文件、执行命令。 |

| **Agent** | 能独立完成任务的AI系统。基础逻辑：思考→规划→调用工具→执行→迭代。 |

| **Cordis** | DSH底层依赖的元框架，负责插件的加载、卸载和依赖管理。 |

| **PTC模式** | Programmatic Tool Calling的缩写，DSH的一种运行模式，专注于程序化的工具调用。 |

| **工作区（Workspace）** | DSH能访问的文件夹目录，所有文件操作都在这个范围内。 |

| **插件（Plugin）** | DSH的功能模块，可以自由替换和扩展。 |

## 相关链接

| 链接 | 说明 |

|------|------|

| [DeepSeek Harness GitHub](https://github.com/deepseek-ai/DeepSeek-Harness) | DSH官方仓库 |

| [DSH Web UI](http://127.0.0.1:3080) | DSH本地Web界面地址 |

| [DeepSeek Platform](https://platform.deepseek.com/) | 获取API Key |

| [Node.js 官网](https://nodejs.org/) | Node.js安装包 |
