---
title: 第一次调用：从命令行跑通API
date: '2026-09-05'
updated: '2026-09-13'
status: published
category: AI 入门
tags:
  - AI
  - API
  - Python
order: 2
---

上一节最后那个 curl 命令就是你的第一次调用。但如果不想用命令行，用 Python 也可以。

## 先装依赖

打开命令行，输入：

```bash
pip install openai
```

没错，你用的是 DeepSeek 的 API，但装的是 `openai` 这个包。因为 DeepSeek 的接口**兼容 OpenAI 的格式**，所以用官方 SDK 就能直接调。

## 第一段能跑的代码

新建一个 Python 文件，名字随便起，比如叫 `first_call.py`：

```python
from openai import OpenAI

client = OpenAI(
    api_key="你的DeepSeek API Key",
    base_url="https://api.deepseek.com/v1",
)

response = client.chat.completions.create(
    model="deepseek-v4-flash",
    messages=[
        {"role": "user", "content": "用一句话解释什么是API"}
    ],
)

print(response.choices[0].message.content)
```

运行：

```bash
python first_call.py
```

屏幕上打印出了回答，恭喜你——你的第一个 API 调用成功了。

## 换成商汤日日新，只改两行

```python
from openai import OpenAI

client = OpenAI(
    api_key="你的商汤API Key",
    base_url="https://token.sensenova.cn/v1",
)

response = client.chat.completions.create(
    model="sensenova-u1.5-lite",  # 具体模型名以官方文档为准
    messages=[
        {"role": "user", "content": "用一句话解释什么是API"}
    ],
)

print(response.choices[0].message.content)
```

`base_url` 从 DeepSeek 的改成商汤的，模型名换成商汤的。其他逻辑**一模一样**——这就是"兼容 OpenAI 协议"带来的实际好处：**换平台等于换两行字符串，不用重写代码**。

> [!TIP]
> 把 `api_key` 和 `base_url` 做成配置项（环境变量或配置文件），别硬编码在代码里。这样换平台、换 Key 都不用改代码，也不会不小心把 Key 提交到 Git。

## 多轮对话怎么传

`messages` 是一个**列表**，按顺序放对话历史。想让 AI 记住上文，就把之前的问答一起传进去：

```python
messages = [
    {"role": "system", "content": "你是一个简洁的技术助手，回答控制在三句话内"},
    {"role": "user", "content": "什么是API"},
    {"role": "assistant", "content": "API是软件之间沟通的桥梁……"},
    {"role": "user", "content": "那 token 又是什么"},
]
```

> [!NOTE]
> **模型没有记忆。** 每次调用都是独立的，你看到的"记得上文"是因为客户端把历史重新发了一遍。所以对话越长，`messages` 越长，消耗的 token 也越多——这就是为什么长对话会变贵。

## 报错对照

| 报错 | 原因 | 怎么办 |
|------|------|--------|
| `401 Unauthorized` | API Key 错了 | 检查有没有抄漏字符、多了空格 |
| `404 Not Found` | base URL 或模型名写错 | 核对地址与模型名 |
| `Rate limit exceeded` | 调用太频繁 | 等一会儿再试，或加退避重试 |
| 什么都没返回也没报错 | 网络问题 | 检查外网连通性、代理设置 |
| `insufficient balance` | 余额不足 | 充值或换有免费额度的平台 |

## 关键词汇解释

| 术语 | 解释 |
|------|------|
| **pip** | Python的包管理工具。`pip install openai` 就是安装 openai 这个库。 |
| **OpenAI SDK** | OpenAI官方提供的Python库。因为DeepSeek和商汤都兼容OpenAI格式，所以用这个库就能调用它们。 |
| **client** | 在代码里创建的客户端对象，用来发请求。创建时需要传入 `api_key` 和 `base_url`。 |
| **chat.completions.create** | 真正发起对话请求的方法。`model` 指定用哪个模型，`messages` 放对话内容。 |
| **response.choices[0].message.content** | 从返回结果里提取AI的回复。`choices` 数组里放着模型生成的多个候选答案，一般取第一个。 |
| **model** | 模型名称。DeepSeek用 `deepseek-v4-flash`，商汤用 `sensenova-u1.5-lite` 等。不同平台模型名不同，以官方文档为准。 |
| **messages** | 对话历史。每个消息有 `role`（角色）和 `content`（内容）。`role` 可以是 `user`（你）、`assistant`（AI）、`system`（系统指令）。 |
| **Rate limit** | 调用频率限制。每个平台对每分钟/每小时的调用次数都有限制，超了会报 `Rate limit exceeded`。 |

## 相关链接

| 链接 | 说明 |
|------|------|
| [DeepSeek Your First API Call](https://api-docs.deepseek.com/zh-cn/api/your-first-api-call) | DeepSeek官方"第一次调用"教程 |
| [DeepSeek Chat Completions API](https://api-docs.deepseek.com/zh-cn/api/chat-completions) | 对话接口的详细参数说明 |
| [商汤 SenseNova 模型列表](https://platform.sensenova.cn/docs) | 商汤各模型的model名称和文档 |
| [商汤 接口调用指南](https://platform.sensenova.cn/docs) | 商汤API的完整调用说明 |
| [OpenAI Python SDK](https://github.com/openai/openai-python) | OpenAI官方Python库，兼容调用DeepSeek和商汤 |
