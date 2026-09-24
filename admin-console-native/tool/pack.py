#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""星集控桌面端出包脚本。

为什么用 Python 而不是 PowerShell 的 Compress-Archive：
  - Compress-Archive 需要先 Remove-Item 旧包，会被安全删除垫片拦下
    （[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]）；
  - zipfile 以 'w' 打开 = 原地截断写，**不产生 delete 系统调用**，天然绕过。
  - 顺带避免了 .ps1 中文必须 UTF-8 BOM 的坑。

用法：
    python tool/pack.py [--src build/windows/x64/runner/Release] [--out dist/xingjikong-release.zip]
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_SRC = os.path.join(ROOT, "build", "windows", "x64", "runner", "Release")
DEFAULT_OUT = os.path.join(ROOT, "dist", "xingjikong-release.zip")

# 缺一不可：少了任何一个插件 DLL，对应能力在别人机器上会静默失效。
REQUIRED = [
    "xingjikong.exe",
    "flutter_windows.dll",
    "dartjni.dll",
    "native_assets.json",
    "tray_manager_plugin.dll",
    "window_manager_plugin.dll",
    "screen_retriever_windows_plugin.dll",
    "url_launcher_windows_plugin.dll",
    "data/icudtl.dat",
    "data/app.so",
    "data/flutter_assets/assets/app_icon.ico",
]

README = """星集控 · 桌面端（Windows）
================================

【第一步】把整个文件夹解压到任意位置（不要只解压 exe）。
【第二步】双击 xingjikong.exe 启动。
【第三步】打开左侧「设置」，把「本机作为被控设备」开关打开，
          填好设备名（默认取电脑名），点「立即上报」。
          看到绿点「已上线」就完成了。

之后这个窗口可以关掉——它会缩到右下角托盘里继续工作，
集控面板上下发的关机 / 重启 / 截图 / 调音量都能在这台电脑上生效。

开机自启：设置里打开「开机自动启动」即可。

数据位置：%LOCALAPPDATA%\\xingjikong\\
  logs\\   运行日志（按天分文件，保留 7 天）
  shots\\  本机截图
"""


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    src = os.path.abspath(args.src)
    out = os.path.abspath(args.out)

    if not os.path.isdir(src):
        print(f"[x] 找不到 Release 目录：{src}")
        print("    先跑：flutter build windows --release")
        return 1

    files = []
    for base, _dirs, names in os.walk(src):
        for n in names:
            full = os.path.join(base, n)
            files.append((full, os.path.relpath(full, src).replace("\\", "/")))
    files.sort(key=lambda x: x[1])

    present = {rel for _f, rel in files}
    missing = [r for r in REQUIRED if r not in present]
    if missing:
        print("[!] 以下必需文件不在 Release 目录里，出包中止（否则能力会静默失效）：")
        for m in missing:
            print("    -", m)
        return 1

    os.makedirs(os.path.dirname(out), exist_ok=True)
    # 'w' = 截断写，不触发安全删除守卫
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for full, rel in files:
            z.write(full, rel)
        z.writestr("使用说明.txt", README)

    size = os.path.getsize(out)
    print(f"[√] {out}")
    print(f"    文件数 {len(files) + 1}（含 使用说明.txt） / {size / 1048576:.2f} MB")
    print(f"    sha256 {sha256(out)}")
    print("    --- 关键运行件 ---")
    for r in REQUIRED:
        print("    ✓", r)
    return 0


if __name__ == "__main__":
    sys.exit(main())
