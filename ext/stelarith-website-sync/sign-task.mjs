#!/usr/bin/env node
/**
 * sign-task.mjs —— 服务端对 stelarith_task 做「网站私钥 Ed25519 签名」（生产令牌模型）
 *
 * 与浏览器端 HMAC（api.js signTask）区别：
 *   - 浏览器端只能用共享密钥 HMAC（私钥不能下发到前端）；
 *   - 生产由网站服务端持 Ed25519 私钥签名，设备代理持网站公钥验签，杜绝密钥分发泄露。
 *
 * 代理侧验签逻辑（见 ext/stelarith-agent/src/main.rs verify()）需相应升级为 Ed25519：
 *   验签 message = action + "|" + ts；通过且 |now-ts|<=60s 即放行。
 *
 * 用法：
 *   node sign-task.mjs --action remote_control_start --scope class
 *   node sign-task.mjs --action lock   # 默认 scope=class
 *
 * 私钥：首次运行自动生成并写入 ./stelarith_task.key（PEM），公钥写入 ./stelarith_task.pub。
 *       部署时把公钥下发到各设备代理（STELARITH_SITE_PUBKEY 环境变量）。
 */

import { webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY = path.join(__dirname, "stelarith_task.key");
const PUB = path.join(__dirname, "stelarith_task.pub");

async function ensureKeys() {
  if (fs.existsSync(KEY) && fs.existsSync(PUB)) {
    const priv = fs.readFileSync(KEY, "utf-8");
    const pub = fs.readFileSync(PUB, "utf-8");
    return { priv, pub };
  }
  const { privateKey, publicKey } = await webcrypto.subtle.generateKey(
    { name: "Ed25519" }, true, ["sign", "verify"]
  );
  const priv = await webcrypto.subtle.exportKey("pkcs8", privateKey);
  const pub = await webcrypto.subtle.exportKey("spki", publicKey);
  const toPem = (buf, tag) => {
    const b64 = Buffer.from(buf).toString("base64");
    const wrapped = b64.match(/.{1,64}/g).join("\n");
    return `-----BEGIN ${tag}-----\n${wrapped}\n-----END ${tag}-----\n`;
  };
  const privPem = toPem(priv, "PRIVATE KEY");
  const pubPem = toPem(pub, "PUBLIC KEY");
  fs.writeFileSync(KEY, privPem);
  fs.writeFileSync(PUB, pubPem);
  console.error("[sign-task] 已生成密钥对");
  return { priv: privPem, pub: pubPem };
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function main() {
  const args = process.argv.slice(2);
  const get = (k, d) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : d;
  };
  const action = get("--action", "remote_control_start");
  const scope = get("--scope", "class");
  const { priv } = await ensureKeys();

  const key = await webcrypto.subtle.importKey(
    "pkcs8",
    pemToBuf(priv, "PRIVATE KEY"),
    { name: "Ed25519" }, false, ["sign"]
  );
  const ts = Math.floor(Date.now() / 1000);
  const message = `${action}|${ts}`;
  const sig = await webcrypto.subtle.sign("Ed25519", key, new TextEncoder().encode(message));
  const token = b64url(sig);

  const task = { action, token, scope, ts };
  console.log(JSON.stringify(task, null, 2));
  console.error(`[sign-task] message="${message}"  token(Ed25519)=${token}`);
}

function pemToBuf(pem, tag) {
  const b64 = pem.replace(new RegExp(`-----BEGIN ${tag}-----`, "g"), "")
    .replace(new RegExp(`-----END ${tag}-----`, "g"), "")
    .replace(/\s+/g, "");
  return Buffer.from(b64, "base64");
}

main().catch((e) => { console.error(e); process.exit(1); });
