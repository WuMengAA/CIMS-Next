// Runtime .env loader (BOM-safe). Used to launch stelarith with:
//   node -r /path/to/loadenv.cjs build/index.js
// adapter-node does not auto-read .env; this guarantees all vars land in
// process.env before any request is handled (covers routes like /voicehub
// that read env via $env/dynamic/private without going through getSiteUrl).
const fs = require('node:fs');
const path = require('node:path');
try {
  const p = path.join(process.cwd(), '.env');
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf-8').replace(/^﻿/, '');
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
} catch {}
