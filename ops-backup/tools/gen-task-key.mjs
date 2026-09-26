#!/usr/bin/env node
/**
 * gen-task-key.mjs —— 生成 Ed25519 任务签名密钥对（一次性的，可重复运行以轮换）
 *
 * 产出：
 *   1. 私钥（pkcs8 DER → base64 单行）→ 写入 Stelarith-website/stelarith/.env 的
 *      SITE_TASK_PRIVATE_KEY（网站服务端持私钥，为面板下发的指令签名）。
 *   2. 公钥（spki PEM）→ 写 _tools/stelarith_task.pub（出部署包时填 Agent.SitePubKey，
 *      教室代理持公钥验签；公钥不是秘密，可随包分发）。
 *
 * 验签契约（与 Rust 代理 main.rs::verify_ed25519 一致）：
 *   message = action + "|" + ts；token = base64url(Ed25519_sign(message))；
 *   代理侧 |now-ts|<=60s 防重放。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SITE_ENV = "D:/Stelarith/Stelarith-website/stelarith/.env";
const PUB_FILE = path.join("D:/Stelarith/_tools", "stelarith_task.pub");

const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const privDer = privateKey.export({ type: "pkcs8", format: "der" });
const pubPem = publicKey.export({ type: "spki", format: "pem" });

const privB64 = privDer.toString("base64");

// 写入 .env：有同名键则替换，无则追加
let env = fs.existsSync(SITE_ENV) ? fs.readFileSync(SITE_ENV, "utf-8") : "";
const KEY_NAME = "SITE_TASK_PRIVATE_KEY";
if (new RegExp(`^${KEY_NAME}=`, "m").test(env)) {
  env = env.replace(new RegExp(`^${KEY_NAME}=.*$`, "m"), `${KEY_NAME}=${privB64}`);
} else {
  env += (env.endsWith("\n") ? "" : "\n") + `${KEY_NAME}=${privB64}\n`;
}
fs.writeFileSync(SITE_ENV, env);

fs.writeFileSync(PUB_FILE, pubPem);
console.log("[gen-task-key] 私钥 -> .env SITE_TASK_PRIVATE_KEY（base64, " + privB64.length + " 字符）");
console.log("[gen-task-key] 公钥 -> _tools/stelarith_task.pub");
console.log("[gen-task-key] 公钥内容如下（给部署包用）:\n" + pubPem.trim());
