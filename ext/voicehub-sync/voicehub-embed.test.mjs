// 校园点歌即插即用模块 · 纯逻辑 / 契约测试（node 环境，不触网）
// 仅验证：导出结构、真实端点契约一致、demo 模式降级正确。
// 运行：node --test ext/voicehub-sync/voicehub-embed.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, "voicehub-embed.mjs"), "utf8");

test("导出 VoicehubEmbed 类与默认导出", () => {
  assert.match(src, /export class VoicehubEmbed/);
  assert.match(src, /export default VoicehubEmbed/);
});

test("契约：点歌拉取 / 点歌提交 / 推上屏 走真实已核实端点", () => {
  assert.match(src, /\/api\/open\/songs\?played=true/);
  assert.match(src, /\/api\/open\/songs\/request/);
  assert.match(src, /\/account\/\$\{?accountId\}?\/Components\/write\?name=songboard/);
  assert.match(src, /x-api-key/);
});

test("demo 模式 list() 返回演示队列且不触网", async () => {
  const mod = await import("./voicehub-embed.mjs");
  const vh = new mod.VoicehubEmbed({ demo: true });
  const r = await vh.list();
  assert.equal(r.now, null);
  assert.ok(Array.isArray(r.queue) && r.queue.length > 0);
  assert.equal(r.queue[0].title, "孤勇者");
});

test("demo 模式 pushToScreen() 返回 {demo:true} 且不触网", async () => {
  const mod = await import("./voicehub-embed.mjs");
  const vh = new mod.VoicehubEmbed({ demo: true });
  const r = await vh.pushToScreen(null, []);
  assert.deepEqual(r, { demo: true });
});

test("无 host 时 list() 同样降级演示队列", async () => {
  const mod = await import("./voicehub-embed.mjs");
  const vh = new mod.VoicehubEmbed({});
  const r = await vh.list();
  assert.ok(Array.isArray(r.queue) && r.queue.length > 0);
  assert.equal(r.now, null);
});
