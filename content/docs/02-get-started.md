---
title: 注册账号、拿Key、搞定环境
date: '2026-09-05'
status: published
category: AI 入门
tags:
  - AI
  - API
order: 1
---
我最早折腾API的时候，在选哪个平台上纠结了好一阵。后来发现其实不用纠结，直接说结论：

**如果你只想快点上手用起来，选商汤日日新。** 注册就有免费额度，每5小时有1500次免费调用。对于刚开始折腾的人来说，这个量足够你玩很久了。

**如果你打算长期用，或者需要更强的模型能力，选DeepSeek。** 价格便宜，模型能力强，社区生态成熟。我现在的做法是两个都用——开发测试用日日新的免费额度，正式跑东西用DeepSeek。

先说DeepSeek怎么注册。

打开浏览器，访问DeepSeek平台，地址是`platform.deepseek.com`。点注册，填邮箱、设密码、收验证邮件——就是正常注册流程。注册完了登录进去，在控制台找到API Key管理。点“创建API Key”，给它起个名字（比如“my-first-key”），点确定，就会生成一串字符。这串字符就是你的API Key。\*\*这东西相当于密码，别截图发群里，别传到GitHub上，最好直接记在本地的文本文件里或者用环境变量存着\*\*。

再说商汤日日新。

访问`https://platform.sensenova.cn`[，注册登录。在控制台侧边栏找到“管理中心→API](https://platform.sensenova.cn`，注册登录。在控制台侧边栏找到“管理中心→API) Key管理→创建API Key”。商汤的接口兼容OpenAI协议，base URL是`https://token.sensenova.cn/v1`[。](https://token.sensenova.cn/v1`。)

电脑上需要装什么？两样东西：Python和VS Code。

Python去[官网](https://www.python.org/downloads/)下载安装就行。装的时候\*\*记得勾选“Add Python to PATH”\*\*——这个选项不勾的话后面命令行用不了python命令。装完了打开命令行（Win+R输入cmd回车），输入`python --version`，如果能显示版本号就说明装好了。

VS Code去[code.visualstudio.com](https://code.visualstudio.com/)下载安装，这个没什么好说的。

怎么验证Key是能用的？有一个最简单的办法——用curl命令直接测。打开命令行，输入下面这个命令（把`YOUR_API_KEY`换成你的真实Key）：

\`\`\`bash

curl [https://api.deepseek.com/v1/chat/completions](https://api.deepseek.com/v1/chat/completions) \\

  -H "Content-Type: application/json" \\

  -H "Authorization: Bearer YOUR\_API\_KEY" \\

  -d '{

```
"model": "deepseek-v4-flash",

"messages": \[{"role": "user", "content": "你好"}\]
```

  }'

\`\`\`

如果你能看到返回的JSON里面有`"choices"`和`"message"`，说明你的Key是好的，环境也是好的。如果返回类似“401 Unauthorized”的东西，那就是Key写错了。如果返回“Connection refused”或者超时，那就是网络问题。

## 关键词汇解释

| 术语 | 解释 |

|------|------|

| **API Key** | 身份凭证，调用API时必须带上。DeepSeek在控制台的“API Keys”页面创建。商汤在“管理中心→API Key管理”创建。 |

| **控制台/Console** | 平台的后台管理界面。在这里可以查看用量、创建Key、充值等。 |

| **PATH** | 系统环境变量。把Python加到PATH里，才能在任意目录下直接输入`python`命令。 |

| **curl** | 命令行工具，用来发送HTTP请求。用它测试API最简单，不用写代码。 |

| **base URL** | API的基础地址。DeepSeek的是`https://api.deepseek.com/v1`[，商汤的是](https://api.deepseek.com/v1`，商汤的是`https://token.sensenova.cn/v1`。)`https://token.sensenova.cn/v1`[。](https://api.deepseek.com/v1`，商汤的是`https://token.sensenova.cn/v1`。) |

| **OpenAI兼容** | API格式和OpenAI一致，所以可以用OpenAI的SDK调用。 |

## 相关链接

| 链接 | 说明 |

|------|------|

| [DeepSeek Platform](https://platform.deepseek.com/) | DeepSeek官网，注册和登录入口 |

| [DeepSeek API Keys](https://platform.deepseek.com/api_keys) | 直接跳转到API Key管理页面 |

| [商汤 SenseNova 平台](https://platform.sensenova.cn/console) | 商汤日日新控制台 |

| [Python 官网下载](https://www.python.org/downloads/) | Python安装包下载 |

| [VS Code 官网下载](https://code.visualstudio.com/) | VS Code安装包下载 |
