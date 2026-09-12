---
title: 注册账号、拿Key、搞定环境
date: '2026-09-05'
updated: '2026-09-13'
status: published
category: AI 入门
tags:
  - AI
  - API
  - 环境搭建
order: 1
---

我最早折腾API的时候，在选哪个平台上纠结了好一阵。后来发现其实不用纠结，直接说结论：

**如果你只想快点上手用起来，选商汤日日新。** 注册就有免费额度，每5小时有1500次免费调用。对于刚开始折腾的人来说，这个量足够你玩很久了。

**如果你打算长期用，或者需要更强的模型能力，选DeepSeek。** 价格便宜，模型能力强，社区生态成熟。

我现在的做法是**两个都用**——开发测试用日日新的免费额度，正式跑东西用DeepSeek。这样既不用心疼测试期的消耗，也不用牺牲正式环境的能力。

## DeepSeek 怎么注册

打开浏览器，访问 `platform.deepseek.com`。点注册，填邮箱、设密码、收验证邮件——就是正常注册流程。

注册完登录进去，在控制台找到 **API Key 管理**，点「创建 API Key」，给它起个名字（比如 `my-first-key`），点确定，就会生成一串字符。这串字符就是你的 API Key。

> [!WARNING]
> **这东西相当于密码。** 别截图发群里，别传到 GitHub 上，最好直接存到本地配置文件里，或者用环境变量存着。
>
> Key 只在创建时完整显示一次，关掉窗口就再也看不到了——**生成的第一件事就是复制保存**。

## 商汤日日新怎么注册

访问 `https://platform.sensenova.cn`，注册登录。在控制台侧边栏找到「管理中心 → API Key 管理 → 创建 API Key」。

商汤的接口兼容 OpenAI 协议，base URL 是：

```
https://token.sensenova.cn/v1
```

## 电脑上需要装什么

两样东西：**Python** 和 **VS Code**。

**Python** 去[官网](https://www.python.org/downloads/)下载安装就行。装的时候**记得勾选"Add Python to PATH"**——这个选项不勾的话，后面命令行里用不了 `python` 命令，会报"不是内部或外部命令"。

装完打开命令行（Win+R 输入 `cmd` 回车），输入：

```bash
python --version
```

能显示版本号就说明装好了。

**VS Code** 去 [code.visualstudio.com](https://code.visualstudio.com/) 下载安装，这个没什么好说的。

> [!TIP]
> Windows 上如果 `python --version` 报错，多半是 PATH 没勾。最简单的补救是重新运行安装包选 "Modify"，把 PATH 选项补上，比手动改环境变量省事。

## 怎么验证 Key 是能用的

最简单的办法——用 curl 命令直接测，不用写任何代码。打开命令行，把 `YOUR_API_KEY` 换成你的真实 Key：

```bash
curl https://api.deepseek.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "deepseek-v4-flash",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

看到返回的 JSON 里有 `"choices"` 和 `"message"`，说明 Key 是好的、环境也是好的。

## 报错对照表

| 你看到的 | 大概是什么问题 | 怎么办 |
|----------|----------------|--------|
| `401 Unauthorized` | Key 写错了或没复制全 | 重新生成一次 Key，注意别带空格 |
| `404 Not Found` | base URL 或模型名写错 | 核对地址与模型名 |
| `402 Payment Required` / 余额不足 | 账号没钱了 | 去控制台充值，或换免费额度的平台 |
| `Connection refused` / 超时 | 网络问题 | 检查能不能访问外网，有没有代理干扰 |
| 返回了但内容是空的 | 请求体格式不对 | 检查 JSON 是否合法、`messages` 是否为数组 |

> [!NOTE]
> 排查顺序有个经验：**先用 curl 验证 Key，再写代码。** curl 能通说明 Key 和网络都没问题，之后出错就是代码的事；curl 都不通，写再多代码也白搭。这一步能帮你把问题域砍掉一半。

## 关键词汇解释

| 术语 | 解释 |
|------|------|
| **API Key** | 身份凭证，调用API时必须带上。DeepSeek在控制台的"API Keys"页面创建，商汤在"管理中心→API Key管理"创建。 |
| **控制台/Console** | 平台的后台管理界面。在这里可以查看用量、创建Key、充值等。 |
| **PATH** | 系统环境变量。把Python加到PATH里，才能在任意目录下直接输入 `python` 命令。 |
| **curl** | 命令行工具，用来发送HTTP请求。用它测试API最简单，不用写代码。 |
| **base URL** | API的基础地址。DeepSeek的是 `https://api.deepseek.com/v1`，商汤的是 `https://token.sensenova.cn/v1`。 |
| **OpenAI兼容** | API格式和OpenAI一致，所以可以用OpenAI的SDK调用。 |

## 相关链接

| 链接 | 说明 |
|------|------|
| [DeepSeek Platform](https://platform.deepseek.com/) | DeepSeek官网，注册和登录入口 |
| [DeepSeek API Keys](https://platform.deepseek.com/api_keys) | 直接跳转到API Key管理页面 |
| [商汤 SenseNova 平台](https://platform.sensenova.cn/console) | 商汤日日新控制台 |
| [Python 官网下载](https://www.python.org/downloads/) | Python安装包下载 |
| [VS Code 官网下载](https://code.visualstudio.com/) | VS Code安装包下载 |
