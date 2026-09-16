# 安全策略（Security Policy）

## 支持的版本

仅维护最新主分支（main）上的安全修复。

## 报告漏洞

请**不要**公开讨论安全漏洞。优先通过以下方式报告：

1. GitHub Security Advisory（推荐）：仓库页面 → Security → Report a vulnerability
2. 或发送邮件到仓库维护者（见 GitHub 个人主页）

请在报告中包含：

- 漏洞类型与影响范围
- 复现步骤（最小化用例）
- 受影响的版本
- 如已修复，说明你的建议

## 安全设计要点

- **密码存储**：scrypt 加盐哈希（每用户随机 salt），绝不明文存储
- **会话**：HttpOnly + SameSite=strict Cookie
- **多用户隔离**：editor 角色只能管理 owner 为自己的内容；admin 可管理全部
- **备份**：可 AES-256-GCM 加密导出（密码派生密钥 + 随机 salt/iv）
- **媒体上传**：扩展名白名单 + 20MB 大小限制
- **内容路径**：slug 由标题生成，避免路径注入

## 已知边界

- 管理后台为单 Cookie 鉴权，适合个人/小团队；大规模多租户请引入 OAuth 或 SSO
- 评论/友链申请未接反垃圾（验证码/频率限制），如有需要建议前置 CDN 防护