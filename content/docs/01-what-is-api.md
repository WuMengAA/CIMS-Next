---
title: 大模型API到底是个什么东西
date: '2026-09-11'
updated: '2026-09-13'
status: published
category: AI 入门
tags:
  - AI
  - API
  - 入门
order: 0
---

我第一次听到"API调用"的时候，满脑子都是问号。

网页上用AI不是挺好的吗，打开浏览器输句话就能聊，为什么还要搞什么API？后来才搞明白，这两件事的区别本质上就是**"去店里吃饭"和"买食材回家自己做"**的区别。

## 开好的饭店 vs 自己下厨

网页版AI（DeepSeek官网、ChatGPT网页端）就是一个开好的饭店。你进去坐下，点菜，后厨给你做好了端上来。你什么都不用管，吃完买单就行。但问题是你只能按菜单点，不能跟后厨说"我要把这个菜改成另一种做法"。

API调用就是你买食材回家自己做。你得先有食材（API Key），有厨房（Python环境），有菜谱（调用代码），然后你想做什么就做什么。坏处是麻烦，好处是自由。

## 调用一次API，其实就是四步

**第一步**：你写一段代码，告诉电脑"我要给大模型发一句话"。

**第二步**：电脑把这句话打包成一个HTTP请求，通过互联网发给模型服务商的服务器。DeepSeek 的地址通常是：

```
https://api.deepseek.com/v1/chat/completions
```

**第三步**：服务器上的模型处理你的请求，生成回复。

**第四步**：服务器把回复打包发回来，你的代码把它打印到屏幕上。

整个过程基本上在一两秒内完成。

> [!NOTE]
> 你写的代码和模型服务器之间，说的就是HTTP。这跟你打开网页时浏览器和网站之间的通信方式是同一套东西——区别只是"返回的是网页"还是"返回的是一段JSON"。

## token 是什么

这东西我刚接触的时候被它搞得一头雾水，后来发现其实就是**计价单位**。

大模型不认识汉字，它认识的是数字。你的问题会被切成小块，每块叫一个token。中文大概**一个字对应1.5到2个token**。你问一句"你好"，大概消耗3-4个token。模型给你的回答也是按token算钱的。

计费分输入和输出两侧，通常输出比输入贵一些。对平时只是自己用一用的人来说，花不了几个钱——真正的成本是"忘了自己在循环里调用"这种事故，所以**开发期一定要盯用量页面**。

## 普通人只需要知道这四点

- 什么是**API Key**（就是你的身份凭证）
- 什么是**base URL**（就是服务器地址）
- 什么是**model**（就是你要用哪个模型）
- 什么是**messages**（就是你要说的话，包括你的问题和AI的回答历史）

至于背后那些模型架构、注意力机制、梯度下降，跟你没有半毛钱关系，不用看。

## 关键词汇解释

| 术语 | 解释 |
|------|------|
| **API** | Application Programming Interface的缩写。简单说就是两个软件之间沟通的桥梁，让你写的代码能直接调用大模型的能力。 |
| **API Key** | 你的身份凭证，相当于登录密码。调用API时必须带上，告诉服务器"是谁在调用"。 |
| **base URL** | API服务器的地址。所有请求都发往这个地址。DeepSeek的是 `https://api.deepseek.com/v1`。 |
| **model** | 你要用的具体模型名称，比如 `deepseek-v4-flash`。不同模型能力和价格不同。 |
| **token** | 大模型处理文本的最小单位。中文约1个字=1.5-2个token。计费按token数量算。 |
| **HTTP请求** | 电脑之间通信的方式。你的代码通过HTTP请求把问题发给API服务器，服务器通过HTTP响应把答案传回来。 |
| **Chat Completions API** | 最常用的API接口，专门处理对话式的问答。你发一段对话历史，它返回模型的回复。 |
| **OpenAI兼容** | 指API格式和OpenAI的规范一致。DeepSeek和商汤都支持这种格式，所以用OpenAI的SDK也能调用。 |

## 几个容易一开始就搞混的点

> [!WARNING]
> **API Key 等于密码。** 别截图发群里，别提交到 GitHub，最好放进环境变量或本地配置文件。一旦泄露，别人花的钱记在你账上。

> [!TIP]
> **"兼容OpenAI"是什么意思？** 意思是接口的字段名、请求格式、返回结构都跟OpenAI一致。好处是你不需要学新的SDK，装 `openai` 这个包、把 `base_url` 换掉就能调别家的模型——这也是为什么很多教程里"用的是DeepSeek但装的是openai包"。

## 相关链接

| 链接 | 说明 |
|------|------|
| [DeepSeek Platform](https://platform.deepseek.com/) | DeepSeek官网控制台，注册、管理API Key、查看用量都在这里 |
| [DeepSeek API Docs](https://api-docs.deepseek.com/zh-cn/) | DeepSeek官方API文档 |
| [DeepSeek Chat Completions API](https://api-docs.deepseek.com/zh-cn/api/chat-completions) | 对话接口的详细说明 |
| [DeepSeek 模型与价格](https://api-docs.deepseek.com/zh-cn/api/pricing) | 各模型的定价信息 |
| [商汤 SenseNova 平台](https://platform.sensenova.cn/console) | 商汤日日新控制台 |
| [商汤 SenseNova API 文档](https://platform.sensenova.cn/docs) | 商汤API文档 |
