# 贡献指南（Contributing）

感谢你的关注！欢迎提交 Issue、PR 与建议。

## 开发环境

```bash
pnpm install
pnpm dev        # 本地开发 http://localhost:5175
pnpm build      # 生产构建
```

## 分支与提交

- 从 main 拉新分支：git checkout -b feat/xxx
- 提交信息建议使用约定式提交：feat: / fix: / docs: / chore: / refactor:
- 合并前请确保 pnpm build 通过

## 代码约定

- Svelte 5 runes 模式（见 RUNES.md）
- 内容存储：content/ 目录，Markdown + frontmatter
- API 路由：src/routes/api/*，鉴权用 $lib/server/api-auth.ts
- UI 组件：优先复用 src/lib/components/ui/*（shadcn）

## 新增功能建议流程

1. 开 Issue 描述需求与场景
2. 讨论方案（存储、权限、UI）
3. 实现 + 测试 + 文档
4. PR 关联 Issue

## 测试

当前无自动化测试套件；合并前请手动验证关键路径：

- 后台增删改查（含权限隔离）
- 评论 / 友链申请流程
- 备份导出（普通 + 加密）
- pnpm build 通过