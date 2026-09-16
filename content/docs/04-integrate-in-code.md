---
title: 把API集成到你的代码里
date: '2026-09-05'
updated: '2026-09-13'
status: published
category: AI 入门
tags:
  - AI
  - API
  - Python
order: 3
---

前面用 curl 和 Python 脚本调通了 API，下一步是把它集成到你自己的项目里。不需要装额外插件，只需要写一个简单的封装函数，能在你需要的时候稳定调用就行。

**你不需要学什么复杂的框架，只需要会写一个函数。**

## 一个够用的封装

把下面这段代码保存成 `ai_utils.py`，放在你的项目里：

```python
import os
from openai import OpenAI


class DeepSeekClient:
    def __init__(self, api_key=None, model="deepseek-v4-flash"):
        self.client = OpenAI(
            api_key=api_key or os.environ["DEEPSEEK_API_KEY"],
            base_url="https://api.deepseek.com/v1",
            timeout=30,        # 不设超时，卡住的请求会一直挂着
            max_retries=2,     # SDK 内建的自动重试
        )
        self.model = model

    def chat(self, user_input, system_prompt=None):
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_input})

        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
        )
        return response.choices[0].message.content
```

使用方式：

```python
ai = DeepSeekClient(api_key="你的APIKey")
reply = ai.chat("用一句话解释什么是API", system_prompt="你是技术助手，回答要简洁")
print(reply)
```

**几点说明：**

- 这个类不依赖任何第三方插件，就是纯代码，你可以在任意 Python 脚本、Web 项目、自动化任务里调用。
- `system_prompt` 是可选的，用来设定 AI 的身份和回答风格。
- Key 优先从环境变量读（`DEEPSEEK_API_KEY`），避免硬编码进代码。

> [!IMPORTANT]
> **一定要设 `timeout`。** 默认值可能很长，一旦网络层卡住，你的程序会整个挂在那里。这不是"优化"，是必需项——我早期没设，一个批处理任务卡了半小时才发现。

## 换成商汤，只改两处

如果你用的是商汤日日新，把 `base_url` 改成 `https://token.sensenova.cn/v1`，模型名换成对应的即可。更省事的做法是把这两项做成参数：

```python
PROVIDERS = {
    "deepseek": ("https://api.deepseek.com/v1", "deepseek-v4-flash"),
    "sensenova": ("https://token.sensenova.cn/v1", "sensenova-u1.5-lite"),
}

def make_client(name, api_key):
    base_url, model = PROVIDERS[name]
    return OpenAI(api_key=api_key, base_url=base_url, timeout=30, max_retries=2)
```

这样切换平台只要换一个字符串。

## 别裸奔：加上错误处理

封装里最值得补的是错误处理。网络请求会失败，这是常态不是例外：

```python
from openai import APIError, RateLimitError, APITimeoutError


def safe_chat(client, model, messages, fallback="服务暂时不可用，请稍后再试"):
    try:
        resp = client.chat.completions.create(model=model, messages=messages)
        return resp.choices[0].message.content
    except RateLimitError:
        # 触发限流：退避后重试，或直接返回降级文案
        return fallback
    except APITimeoutError:
        return fallback
    except APIError as e:
        print(f"API 返回错误: {e}")
        return fallback
```

> [!TIP]
> 原则是**不要让一次 API 失败搞挂整个程序**。对用户可见的场景给一句降级文案，对批处理的场景记日志后跳过——都比抛异常终止要好。

## 关键词汇解释

| 术语 | 解释 |
|------|------|
| **封装** | 把重复使用的代码包起来，后面调用的时候就不用重复写同样的逻辑了。 |
| **class** | Python里定义类的关键字，可以理解为一个模板。用它创建的对象可以有自己的属性和方法。 |
| **方法** | 类里面定义的函数。这里的 `chat()` 就是一个方法。 |
| **system_prompt** | 系统提示词，用来设定AI的身份和行为。不是必填项。 |
| **timeout** | 超时时间。超过这个时间还没返回就放弃，避免程序无限等待。 |
| **max_retries** | 自动重试次数。遇到临时性失败时由SDK自动重试。 |
| **降级/fallback** | 调用失败时返回的备用结果，保证调用方不至于崩溃或看到空白。 |

## 相关链接

| 链接 | 说明 |
|------|------|
| [Python 类与对象](https://docs.python.org/zh-cn/3/tutorial/classes.html) | Python官方教程，类的基本用法 |
| [OpenAI Python SDK 错误处理](https://github.com/openai/openai-python) | SDK 的异常类型与重试机制 |
| [DeepSeek Chat Completions API](https://api-docs.deepseek.com/zh-cn/api/chat-completions) | 接口参数完整说明 |
