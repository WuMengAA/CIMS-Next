---
title: 怎么让API输出你想要的东西
date: '2026-09-05'
updated: '2026-09-13'
status: published
category: AI 入门
tags:
  - AI
  - API
  - 提示词
order: 4
---

用了一段时间之后我发现，同样的需求、同样的问题，不同的人问AI得到的结果完全是两码事。**差距不在模型本身，在提问的方式。**

## 上下文决定回答质量

最基础但也最容易被忽略的一点：你给AI的上下文决定了它回答的质量。

我曾经直接问"帮我写一个登录功能"，它确实给我写了一个，但用的是我不想要的框架、不想要的数据库、不想要的验证方式。后来我改成这么问：

> 我用的 Flask 框架，数据库是 SQLite，需要用户名密码登录，密码用 bcrypt 加密。帮我写登录接口。

这次给出来的东西我直接就能用。

> [!TIP]
> 差别在于**约束**。你不说用什么框架，它就只能猜；你说了，它就不需要猜。提问时把自己知道的约束全列出来——技术栈、版本、格式、长度、语气——比反复追问"能不能改成那样"高效得多。

## system prompt 和 user prompt

区别不用搞太复杂，你只需要知道一件事：

| 类型 | 作用 | 例子 |
|------|------|------|
| **system prompt** | 告诉 AI"你是谁"、有什么限制、该用什么语气 | "你是一个专业的中英翻译" |
| **user prompt** | 告诉 AI"你要做什么" | "把下面这段中文翻译成英文" |

两者分开写，比混在一起问效果要好得多。因为 system 部分在整段对话里**持续生效**，不会被后面的追问冲淡。

## temperature：随机性开关

温度参数我一开始也没搞明白。后来有人跟我说"你就当它是**AI的随机性开关**"，一下就懂了。

| 温度 | 表现 | 适合 |
|------|------|------|
| 0 ~ 0.3 | 回答固定，同样问法每次结果差不多 | 写代码、做翻译、抽取结构化数据 |
| 0.4 ~ 0.7 | 有一定变化但仍可控 | 常规问答、总结 |
| 0.8 以上 | 发散，同样问法每次都不一样 | 头脑风暴、创意文案 |

我写代码的时候温度都设成 **0.1**，几乎不怎么动。

```python
response = client.chat.completions.create(
    model="deepseek-v4-flash",
    messages=messages,
    temperature=0.1,    # 要稳定复现就压低
    max_tokens=2000,    # 上限，防止意外超长
)
```

## 想让它按格式输出，就明确写出来

如果你要 JSON，别只说"返回JSON"，**给一个示例**效果会好很多：

```python
system_prompt = """你是数据抽取助手。只输出 JSON，不要任何解释文字。
输出格式示例：
{"title": "文章标题", "tags": ["标签1", "标签2"], "summary": "一句话摘要"}
"""
```

> [!NOTE]
> "给示例"这件事有个专门的说法叫 **few-shot**（少样本示例）。对格式类任务，一个示例的效果往往超过十句描述。模型很擅长模仿格式，不擅长猜你想要什么格式。

拿到结果后别直接信，先解析校验一遍：

```python
import json

raw = response.choices[0].message.content
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    # 模型偶尔会在 JSON 外面裹 ```json 标记，剥掉再试
    data = json.loads(raw.strip().removeprefix("```json").removesuffix("```"))
```

> [!WARNING]
> 模型返回的不保证是合法 JSON——哪怕你明确要求了。常见情况是外面裹了一层代码块标记。**一定要 try/except 兜住**，否则线上会不定期崩。

## 上下文要给多少

初期不用纠结，默认上下文长度就够了。真正需要担心的是等你开始用长文档、长对话的时候，token 会消耗得比较快。

注意控制每次发给 AI 的消息里不要塞太多历史对话——**越靠后的历史越值钱**，必要时只保留最近几轮 + 一份早期摘要。

## 关键词汇解释

| 术语 | 解释 |
|------|------|
| **system prompt** | 系统提示词，告诉AI"你是谁""有什么限制""该用什么样的语气"。在 `messages` 里 `role` 为 `system` 的那条消息。 |
| **user prompt** | 用户提示词，就是你要问的具体问题。在 `messages` 里 `role` 为 `user` 的那条消息。 |
| **temperature** | 温度参数，控制回答的随机性。0-1之间，越低越确定，越高越随机。 |
| **上下文/context** | 指你发给AI的全部内容，包括system prompt、历史对话、你问的问题。AI会根据这些来生成回答。 |
| **top_p** | 另一个控制随机性的参数，和temperature类似但算法不同。一般调temperature就够了，两个不要同时乱调。 |
| **max_tokens** | 限制AI回答的最大长度。设得太短回答会被截断，设得太长浪费token。 |
| **few-shot** | 在提示里给出一两个输入/输出示例，让模型模仿格式与风格。 |

## 相关链接

| 链接 | 说明 |
|------|------|
| [DeepSeek Chat Completions API 参数说明](https://api-docs.deepseek.com/zh-cn/api/chat-completions) | 包含temperature、max_tokens等参数的详细说明 |
| [DeepSeek 模型上下文长度](https://api-docs.deepseek.com/zh-cn/api/pricing) | 各模型支持的上下文长度 |
| [商汤 模型参数说明](https://platform.sensenova.cn/docs) | 商汤各模型的参数和限制 |
