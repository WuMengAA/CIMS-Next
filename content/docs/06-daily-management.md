---
title: API调用的日常管理
date: '2026-09-05'
status: published
category: AI 入门
tags:
  - AI
  - API
order: 5
---
用了一段时间之后你会需要知道两件事：花了多少钱、还能用多久。

DeepSeek的用量可以在控制台看。登录`platform.deepseek.com`，在控制台的用量或账单页面可以看到每天的调用次数和token消耗。商汤日日新可以在`platform.sensenova.cn`的控制台查看剩余免费额度。

控制token消耗这件事，说穿了就是少发废话。每次问问题之前想清楚自己要什么，把问题写清楚再发。不要发一条“你好”，等它回了再发“我想问个问题”，再等它回了再发真正的问题——这样你会为前面那些废话付三次token的钱。直接把完整问题一次发过去。

本地模型和API怎么配合这件事，我的经验是：

简单重复的任务给本地模型（比如格式化代码、改错别字、简单的文本处理），复杂推理和需要最新知识的任务给API。本地模型的优势是不要钱、隐私安全，缺点是能力有限。API的优势是能力强、知识新，缺点是要花钱。两者配合用，能把成本压到最低。

遇到API返回错误的时候，先看状态码：

- 4开头的错误（400、401、403、404）基本上是你这边的问题——参数写错了、Key不对、模型名错了
- 5开头的错误（500、502、503）是服务端的问题——等一会儿再试，或者看官方公告是不是在维护

大部分时候你遇到的都是4开头的错误，耐心看看错误信息，问题通常就在里面。

## 关键词汇解释

| 术语 | 解释 |

|------|------|

| **控制台/Console** | 平台的后台管理界面。DeepSeek在`platform.deepseek.com`，商汤在`platform.sensenova.cn`。 |

| **用量统计** | 控制台里可以看到每天/每月的调用次数和token消耗。 |

| **本地模型** | 跑在自己电脑上的模型，不需要联网调用API。用Ollama、LM Studio等工具运行。优点是免费、隐私安全，缺点是能力比云端大模型弱。 |

| **状态码** | HTTP响应的状态码。2xx表示成功，4xx表示客户端错误，5xx表示服务端错误。 |

| **401 Unauthorized** | API Key无效或已过期。检查Key是否正确。 |

| **429 Too Many Requests** | 调用频率超限，等一会儿再试。 |

| **500 Internal Server Error** | 服务端内部错误，通常是平台临时问题，等会儿再试。 |

## 相关链接

| 链接 | 说明 |

|------|------|

| [DeepSeek 控制台](https://platform.deepseek.com/) | 查看用量和账单 |

| [DeepSeek API 错误码](https://api-docs.deepseek.com/zh-cn/api/errors) | API返回的错误码说明 |

| [商汤 SenseNova 控制台](https://platform.sensenova.cn/console) | 商汤用量和额度查看 |

| [商汤 模型速率限制](https://platform.sensenova.cn/docs) | 各模型的调用频率限制 |
