<!--
════════════════════════════════════════════════════════════════
  终末地文章模板 · 使用说明（作者须知，复制后请删除本注释块）
════════════════════════════════════════════════════════════════

用法：
  1. 复制本文件到 content/posts/ 目录，改成你的文章 slug（英文短横线命名）
  2. 改 frontmatter（title/date/tags/status…），status: draft 是草稿，
     改 published 才会出现在前台
  3. 从下方「效果片段库」复制需要的片段，粘进正文，改成你的内容
  4. 发布后自动获得：右侧目录（TOC，来自 ## / ### 标题）、文末上/下一篇

铁律：
  - 效果全部用 HTML 写（渲染管线 html:true，原样保留），配 ex-* class
  - 章节标题必须用 ## / ###（markdown 语法），才会进右侧目录
  - 图片建议放 static/ 下用绝对路径 /xxx.png 引用（防盗链自动处理）
  - 本文不是文章，不会出现在前台；它住在 content/templates/ 里
-->

---
title: 文章标题（改我）
date: 2026-10-24
status: draft
category: 技术
tags:
  - 标签一
  - 标签二
excerpt: 一两句话摘要，显示在列表页和搜索结果里。
pinned: false
---

<!-- ═══ 导语：文章开头的一段摘要（ex-lede）═══ -->
<p class="ex-lede">用一两句话概括全文：这篇讲什么、结论是什么。导语是读者读完标题后看到的第二眼，值得认真写。</p>

<!-- ═══ 正文开始 ═══ -->

## 第一节标题（## 才会进右侧目录）

正常 markdown 段落。**加粗**、*斜体*、`行内代码`、[链接](https://…) 都正常用。

<!-- ═══ 片段 1 · 通知块（注意 / 警告 / 提示）═══
     data-flag 是左侧信号块里的字，两个字最佳 -->
<p class="ex-notice" data-flag="注意">这里是需要读者特别注意的一条。flag 可以写「注意」「警告」「提示」「新」。</p>

<!-- ═══ 片段 2 · 键值对行（ex-kv）═══ -->
<p class="ex-kv"><span>版本</span><span>1.0.0</span><span>状态</span><span>已发布</span></p>

<!-- ═══ 片段 3 · 数据行列表（ex-ledger，左文右值）═══ -->
<ul class="ex-ledger">
  <li><span>条目名称</span><span>对应值或说明</span></li>
  <li><span>另一个条目</span><span>另一个值</span></li>
</ul>

<!-- ═══ 片段 4 · 记录行（事件 / 日志，左编号右内容）═══ -->
<div class="ex-record"><span class="ex-tag">10-24</span><span>今天做了什么，一句话。</span></div>

<!-- ═══ 片段 5 · 标签行（ex-chip）═══ -->
<p>
  <span class="ex-chip">标签 A</span>
  <span class="ex-chip">标签 B</span>
</p>

<!-- ═══ 片段 6 · 三列图组 + 图注（ex-figs / ex-plate）═══ -->
<div class="ex-figs">
  <figure><img src="/static/your-image-1.png" alt="图一" /><figcaption class="ex-plate">图一说明</figcaption></figure>
  <figure><img src="/static/your-image-2.png" alt="图二" /><figcaption class="ex-plate">图二说明</figcaption></figure>
  <figure><img src="/static/your-image-3.png" alt="图三" /><figcaption class="ex-plate">图三说明</figcaption></figure>
</div>

<!-- ═══ 片段 7 · 终末地表格（ex-table，包 wrap 防溢出）═══ -->
<div class="ex-table-wrap">
<table class="ex-table">
  <thead><tr><th>列一</th><th>列二</th><th>列三</th></tr></thead>
  <tbody>
    <tr><td>内容</td><td>内容</td><td>内容</td></tr>
    <tr><td>内容</td><td>内容</td><td>内容</td></tr>
  </tbody>
</table>
</div>

<!-- ═══ 片段 8 · 折叠块（FAQ / 细节展开，原生 details）═══ -->
<details>
  <summary>折叠起来的标题（点击展开）</summary>
  展开后的内容，可以写 markdown 也可以写 HTML。
</details>

<!-- ═══ 片段 9 · 引用块（blockquote 自动获得 prose 皮肤）═══ -->
> 引用别人的话或自己的旧文。markdown 原生语法即可。

## 第二节标题

继续写。代码块用三个反引号围栏，自动语法高亮：

```bash
echo "支持语言标注，如 bash / ts / json"
```

任务列表（勾选框）也支持：

- [x] 已完成的事
- [ ] 待办的事

脚注写法[^1]，自动在文末生成：

[^1]: 脚注内容。

<!-- ═══ 结尾提醒：发之前把上面所有注释和用不到的片段删掉 ═══ -->
