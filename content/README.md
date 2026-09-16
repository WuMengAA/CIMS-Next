# content/ 内容目录

本目录是站点的全部内容（文件即内容，Git 可追踪）。开源版本默认处于**初始化状态**：

- `posts/` `docs/` `projects/` — 空目录，通过管理后台（/admin）创建内容
- `settings.json` — 站点配置（标题、描述、品牌名、标语、Hero 文字、特性、社交链接、页脚）
- `nav.json` — 侧边栏导航配置（分组、排序、增删）
- `links.json` — 友情链接列表（后台管理）

以下文件为**运行时生成**，已被 .gitignore 忽略，不提交：

- `users.json`（用户与密码哈希，自动 seed）
- `comments.json`（评论）
- `link-applications.json`（友链申请）

## 初始化步骤（开源使用者）

1. `pnpm install && pnpm dev`
2. 登录 /admin（默认账号见启动日志或 DEPLOYMENT.md，首次登录后立即修改）
3. 在「站点设置」修改品牌名、标语、Hero 文字、社交链接
4. 在「导航管理」配置侧边栏
5. 开始写文章 / 建文档 / 传项目