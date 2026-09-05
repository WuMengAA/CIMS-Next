---
title: 第一次调用：从命令行跑通API
date: '2026-09-05'
status: published
category: AI 入门
tags:
  - AI
  - API
order: 2
---
上一节最后那个curl命令就是你的第一次调用。但如果不想用命令行，用Python也可以。

先装一下依赖。打开命令行，输入：

\`\`\`bash

pip install openai

\`\`\`

没错，你用的是DeepSeek的API，但装的是`openai`这个包。因为DeepSeek的接口兼容OpenAI的格式。装好了之后，新建一个Python文件，名字随便起，比如叫`first_call.py`，把下面这段代码复制进去：

\`\`\`python

from openai import OpenAI

client = OpenAI(

```
api\_key="你的DeepSeek API Key",

base\_url="[https://api.deepseek.com/v1](https://api.deepseek.com/v1)"
```

)

response = [client.chat](http://client.chat).completions.create(

```
model="deepseek-v4-flash",

messages=\[

    {"role": "user", "content": "用一句话解释什么是API"}

\]
```

)

print(response.choices\[0\].message.content)

\`\`\`

运行`python first_call.py`，如果屏幕上打印出了回答，恭喜你，你的第一个API调用成功了。

那如果换成商汤日日新呢？只需要改两行：

\`\`\`python

from openai import OpenAI

client = OpenAI(

```
api\_key="你的商汤API Key",

base\_url="[https://token.sensenova.cn/v1](https://token.sensenova.cn/v1)"
```

)

response = [client.chat](http://client.chat).completions.create(

```
model="sensenova-u1.5-lite",  # 具体模型名以官方文档为准

messages=\[

    {"role": "user", "content": "用一句话解释什么是API"}

\]
```

)

print(response.choices\[0\].message.content)

\`\`\`

base URL从DeepSeek的改成商汤的。其他逻辑一模一样，因为商汤的接口也兼容OpenAI协议。

第一次跑的时候我遇到过的报错大概有这几种：

- `401 Unauthorized`：API Key错了，检查一下有没有抄漏字符
- `404 Not Found`：base URL或者模型名写错了
- `Rate limit exceeded`：调用太频繁了，等一会儿再试
- 什么都没返回但也没报错：可能是网络问题，检查一下能不能访问外网

## 关键词汇解释

| 术语 | 解释 |

|------|------|

| **pip** | Python的包管理工具。`pip install openai`就是安装openai这个库。 |

| **OpenAI SDK** | OpenAI官方提供的Python库，装了这个就能用`from openai import OpenAI`。因为DeepSeek和商汤都兼容OpenAI格式，所以直接用这个库就能调用。 |

| **client** | 在代码里创建的客户端对象，用来发请求。创建的时候需要传入`api_key`和`base_url`。 |

| **chat.completions.create** | 真正发起对话请求的方法。`model`指定用哪个模型，`messages`放对话内容。 |

| **response.choices\[0\].message.content** | 从返回结果里提取AI的回复。`choices`数组里放着模型生成的多个候选答案，一般取第一个。 |

| **model** | 模型名称。DeepSeek用`deepseek-v4-flash`，商汤用`sensenova-u1.5-lite`等。不同平台的模型名不同，要以官方文档为准。 |

| **messages** | 对话历史。每个消息有`role`（角色）和`content`（内容）。`role`可以是`user`（你）、`assistant`（AI）、`system`（系统指令）。 |

| **Rate limit** | 调用频率限制。每个平台对每分钟/每小时的调用次数都有限制。超了会报`Rate limit exceeded`。 |

## 相关链接

| 链接 | 说明 |

|------|------|

| [DeepSeek Your First API Call](https://api-docs.deepseek.com/zh-cn/api/your-first-api-call) | DeepSeek官方“第一次调用”教程 |

| [DeepSeek Chat Completions API](https://api-docs.deepseek.com/zh-cn/api/chat-completions) | 对话接口的详细参数说明 |

| [商汤 SenseNova 模型列表](https://platform.sensenova.cn/docs) | 商汤各模型的model名称和文档 |

| [商汤 接口调用指南](https://platform.sensenova.cn/docs) | 商汤API的完整调用说明 |

| [OpenAI Python SDK](https://github.com/openai/openai-python) | OpenAI官方Python库，兼容调用DeepSeek和商汤 |
