---
title: 把API集成到你的代码里
date: '2026-09-05'
status: published
category: AI 入门
tags:
  - AI
  - API
order: 3
---
前面用curl和Python脚本调通了API，下一步是把它集成到你自己的项目里。不需要装额外插件，只需要写一个简单的封装函数，能在你需要的时候稳定调用就行。

**你不需要学什么复杂的框架，只需要会写一个函数。**

把下面这段代码保存成一个文件，比如叫`ai_utils.py`，放在你的项目里：

\`\`\`python

from openai import OpenAI

class DeepSeekClient:

```
def **init**(self, api\_key, model="deepseek-v4-flash"):

    self.client = OpenAI(

        api\_key=api\_key,

        base\_url="[https://api.deepseek.com/v1](https://api.deepseek.com/v1)"

    )

    self.model = model

def chat(self, user\_input, system\_prompt=None):

    messages = \[\]

    if system\_prompt:

        messages.append({"role": "system", "content": system\_prompt})

    messages.append({"role": "user", "content": user\_input})

    response = [self.client.chat](http://self.client.chat).completions.create(

        model=self.model,

        messages=messages

    )

    return response.choices\[0\].message.content
```

\`\`\`

使用方式：

\`\`\`python

ai = DeepSeekClient(api\_key="你的APIKey")

reply = [ai.chat](http://ai.chat)("用一句话解释什么是API")

print(reply)

\`\`\`

**几点说明：**

- 这个类不依赖任何第三方插件，就是纯代码，你可以在任意Python脚本、Web项目、自动化任务里调用。
- `system_prompt`是可选的，你可以在调用时指定AI的身份。
- 如果你用的是商汤日日新，只需要把`base_url`改成`https://token.sensenova.cn/v1`[，模型名改成对应的即可。](https://token.sensenova.cn/v1`，模型名改成对应的即可。)

**你不需要额外学什么，这就是你以后调用API的方式。**

## 关键词汇解释

| 术语 | 解释 |

|------|------|

| **封装** | 把重复使用的代码包起来，后面调用的时候就不用重复写同样的逻辑了。 |

| **class** | Python里定义类的关键字，可以理解为一个模板。用它创建的对象可以有自己的属性和方法。 |

| **方法** | 类里面定义的函数。这里的`chat()`就是一个方法。 |

| **system\_prompt** | 系统提示词，用来设定AI的身份和行为。不是必填项。 |

## 相关链接

| 链接 | 说明 |

|------|------|

| [Python 类与对象](https://docs.python.org/zh-cn/3/tutorial/classes.html) | Python官方教程，类的基本用法 |
