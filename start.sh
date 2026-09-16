#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# 加载同目录 .env（面板未提供环境变量 UI 时回退使用）
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

export NODE_ENV=production
export PORT="${PORT:-3000}"
export HOST="${HOST:-0.0.0.0}"
export COOKIE_SECURE="${COOKIE_SECURE:-true}"
export ORIGIN="${ORIGIN:-https://www.245959623.xyz}"
export PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-https://www.245959623.xyz}"

exec node build/index.js
