---
title: 怎么让API输出你想要的东西
date: '2026-09-05'
status: published
category: AI 入门
tags:
  - AI
  - API
order: 4
---
用了一段时间之后我发现，同样的需求、同样的问题，不同的人问AI得到的结果完全是两码事。差距不在模型本身，在提问的方式。

说一个最基础但也最容易被忽略的东西：你给AI的上下文决定了它回答的质量。

我曾经直接问“帮我写一个登录功能”，它确实给我写了一个，但用的是我不想要的框架、不想要的数据库、不想要的验证方式。后来我改成这么问：“我用的Flask框架，数据库是SQLite，需要用户名密码登录，密码用bcrypt加密。帮我写登录接口。”这次给出来的东西我直接就能用。

system prompt和user prompt的区别不用搞太复杂。你只需要知道一件事：system prompt是告诉AI“你是谁”，user prompt是告诉AI“你要做什么”。比如你写一个翻译工具，system prompt可以写“你是一个专业的中英翻译”，user prompt写“把下面这段中文翻译成英文”。这两个东西分开写，比你放在一起问效果要好得多。

温度参数这个东西，我一开始也没搞明白是干什么的。后来有个老哥跟我说“你就当它是AI的随机性开关”，一下就懂了。温度低（0到0.3），AI回答比较固定，同样的问法每次给的答案都差不多，适合写代码、做翻译。温度高（0.8以上），AI回答比较发散，同样的问法每次答案都不一样，适合头脑风暴、写创意文案。我写代码的时候温度都设成0.1，几乎不怎么动。

上下文要给多少这个问题，初期不用纠结。默认的上下文长度就够了。真正需要担心的是等你开始用长文档、长对话的时候，token会消耗得比较快。注意控制一下每次发给AI的消息里不要塞太多历史对话。

## 关键词汇解释

| 术语 | 解释 |

|------|------|

| **system prompt** | 系统提示词，告诉AI“你是谁”“有什么限制”“该用什么样的语气”。在`messages`里`role`为`system`的那条消息。 |

| **user prompt** | 用户提示词，就是你要问的具体问题。在`messages`里`role`为`user`的那条消息。 |

| **temperature** | 温度参数，控制回答的随机性。0-1之间，越低越确定，越高越随机。 |

| **上下文/context** | 指你发给AI的全部内容，包括system prompt、历史对话、你问的问题。AI会根据这些来生成回答。 |

| **top\_p** | 另一个控制随机性的参数，和temperature类似但算法不同。一般调temperature就够了。 |

| **max\_tokens** | 限制AI回答的最大长度。设得太短回答会被截断，设得太长浪费token。 |

## 相关链接

| 链接 | 说明 |

|------|------|

| [DeepSeek Chat Completions API 参数说明](https://api-docs.deepseek.com/zh-cn/api/chat-completions) | 包含temperature、max\_tokens等参数的详细说明 |

| [DeepSeek 模型上下文长度](https://api-docs.deepseek.com/zh-cn/api/pricing) | 各模型支持的上下文长度 |

| [商汤 模型参数说明](https://platform.sensenova.cn/docs) | 商汤各模型的参数和限制 |
