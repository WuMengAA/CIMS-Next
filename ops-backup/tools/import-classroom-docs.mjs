// 把教室端部署包里的 7 篇 markdown 教程导入 website 的 /docs 文档系统。
// - 加 frontmatter（title/date/status/folder/category/order），使其出现在公开教程库
// - 去掉正文首行 H1（详情页 header 已渲染 title，避免重复大标题）
// - 按文件名前缀数字作为 order，保证组内有序
import fs from "node:fs";
import path from "node:path";

const SRC = "D:/Stelarith/_deploy/ClassroomDeploy-20260917/docs";
const DST = "D:/Stelarith/Stelarith-website/stelarith/content/docs";
const FOLDER = "集控系统部署";
const DATE = "2026-09-17";

const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".md")).sort();
let ok = 0;
for (const f of files) {
  const base = f.replace(/\.md$/, "");
  let body = fs.readFileSync(path.join(SRC, f), "utf-8").replace(/^﻿/, "");
  const lines = body.split("\n");
  let title = base;
  if (lines[0] && lines[0].startsWith("# ")) {
    title = lines[0].slice(2).replace(/^\d+\s*[·.\-]\s*/, "").trim();
    lines.shift();
    while (lines.length && lines[0].trim() === "") lines.shift();
    body = lines.join("\n");
  }
  const ordMatch = base.match(/^(\d+)/);
  const order = ordMatch ? parseInt(ordMatch[1], 10) : 99;
  const fm =
    `---\ntitle: ${title}\ndate: ${DATE}\nstatus: published\nfolder: ${FOLDER}\ncategory: ${FOLDER}\norder: ${order}\n---\n\n` +
    body.replace(/^\s+/, "");
  fs.writeFileSync(path.join(DST, f), fm, "utf-8");
  console.log(`+ ${f}  -> title="${title}" order=${order}`);
  ok++;
}
console.log(`done: ${ok} files imported to ${DST}`);
