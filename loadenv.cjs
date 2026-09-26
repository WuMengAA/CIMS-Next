// 加载 .env 到 process.env（轻量，无第三方依赖；与 dotenv 语义兼容）。
// 被 node -r 预加载：`node -r loadenv.cjs build/index.js`
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname);
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
