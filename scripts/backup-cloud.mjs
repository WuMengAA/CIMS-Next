#!/usr/bin/env node
/**
 * backup-cloud.mjs —— 云端周期备份：pg_dump + tar(content,uploads) → 本地 backups/cloud/<ts>/，
 * 按 BACKUP_KEEP 轮转；设了 BACKUP_OFFSITE_CMD 则对新备份目录执行异地拷贝（R2 / Openlist 二选一）。
 *
 * 设计：
 * - 零第三方依赖（node 内置 + 外部 pg_dump / tar）。
 * - R2 解耦：本脚本不内置任何云 SDK。R2 就绪（绑卡后）只需把 BACKUP_OFFSITE_CMD 配成
 *   rclone / aws / curl 命令即可，$DIR 占位符会被替换为本次备份目录。
 * - 数据根与站点一致：STELARITH_DATA_ROOT（缺省工程根），content 与 uploads 平级于此。
 *
 * 运行前提：pg_dump 在 PATH，且能连通 DATABASE_URL 指向的 PG。
 * 推荐在 compose 网络内或装了 postgresql-client 的宿主跑（见 deploy/site/README.md）。
 *
 * 用法：node scripts/backup-cloud.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_ROOT = path.resolve(process.env.STELARITH_DATA_ROOT || ROOT);
const OUT_ROOT = path.join(ROOT, "backups", "cloud");
const KEEP = Number(process.env.BACKUP_KEEP || 14);
const OFFSITE_CMD = process.env.BACKUP_OFFSITE_CMD || "";

function loadDbUrl() {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	const m = fs.readFileSync(path.join(ROOT, ".env"), "utf-8").match(/^DATABASE_URL=(.*)$/m);
	if (m) return m[1].trim().replace(/^["']|["']$/g, "");
	throw new Error("未找到 DATABASE_URL：请设置环境变量或在 .env 配置");
}

const ts = () => new Date().toISOString().replace(/[:.]/g, "-");
const log = (m) => console.log(`[backup ${new Date().toLocaleString("sv-SE")}] ${m}`);

const DSN = loadDbUrl();
const stamp = ts();
const dir = path.join(OUT_ROOT, stamp);
fs.mkdirSync(dir, { recursive: true });

// ① PG dump（自定义格式 -Fc，再 gzip 压一层）
const dbDump = path.join(dir, "db.custom");
const dbGz = path.join(dir, "db.dump.gz");
log(`pg_dump → ${path.relative(ROOT, dbGz)}`);
execFileSync("pg_dump", [DSN, "-Fc", "-f", dbDump], { stdio: "inherit" });
fs.writeFileSync(dbGz, zlib.gzipSync(fs.readFileSync(dbDump)));
fs.rmSync(dbDump, { force: true });

// ② tar content + uploads（存在才打；平级于 DATA_ROOT）
const targets = ["content", "uploads"].filter((d) => fs.existsSync(path.join(DATA_ROOT, d)));
if (targets.length) {
	const tarGz = path.join(dir, "data.tar.gz");
	log(`tar ${targets.join(" ")} → ${path.relative(ROOT, tarGz)}`);
	execFileSync("tar", ["-czf", tarGz, "-C", DATA_ROOT, ...targets], { stdio: "inherit" });
} else {
	log("未找到 content/uploads，跳过数据打包。");
}

// ③ 异地拷贝（可选）：R2 / Openlist 由外部命令承担，$DIR 占位
if (OFFSITE_CMD) {
	const cmd = OFFSITE_CMD.replace(/\$DIR/g, dir).replace(/\$\{DIR\}/g, dir);
	log(`异地拷贝：${cmd}`);
	try {
		execFileSync(process.platform === "win32" ? "cmd" : "sh", [process.platform === "win32" ? "/c" : "-c", cmd], {
			stdio: "inherit"
		});
	} catch (e) {
		log(`异地拷贝失败（保留本地备份）：${e.message}`);
	}
} else {
	log("未设 BACKUP_OFFSITE_CMD，仅本地保留（R2 就绪后配置即可异地）。");
}

// ④ 轮转：保留最近 KEEP 份
const dirs = fs
	.readdirSync(OUT_ROOT, { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => d.name)
	.sort()
	.reverse();
for (const old of dirs.slice(KEEP)) {
	fs.rmSync(path.join(OUT_ROOT, old), { recursive: true, force: true });
	log(`轮转删除 ${old}`);
}

const size = (p) => (fs.existsSync(p) ? (fs.statSync(p).size / 1024 / 1024).toFixed(1) + "MB" : "-");
log(`完成：${path.relative(ROOT, dir)}  db=${size(dbGz)}`);
console.log(`[backup] OK ${stamp}`);
