#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ClassIsland 集控部署工具。

部署分两部分：
  A. 静态托管：manifest.json + 拆分资源 -> 静态服务器
  B. 教室机分发：ManagementPreset.json -> 每台教室机的 ClassIsland【安装目录】

⚠️ 安全约束（生产红线）：
  - 本工具【不】连接星集控云端（8788/8090）——那是生产服务，铁律 4
  - 本工具【不】批量登录教室机执行命令——只做本地准备 + 生成待部署清单
  - 教室机分发输出 .ps1 脚本，需人工在每台机器上执行（或 IT 用 AD 推送）

用法:
  # 完整生成部署包（本地模拟）
  python tools/ci-profile/deploy.py --profile ci-profile.json --out deploy/pkg/ --base-url https://x/ci

  # 上传到静态服务器（HTTP PUT，如 nginx）
  python tools/ci-profile/deploy.py --profile ... --out ... --upload http://192.168.1.10/ci/

  # 上传到 Windows 共享目录
  python tools/ci-profile/deploy.py --profile ... --out ... --upload \\server\\share\\ci

  # 生成教室机批量部署脚本
  python tools/ci-profile/deploy.py --profile ... --out ... --class-list classes.csv --gen-script deploy/deploy.ps1
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ZERO = "00000000-0000-0000-0000-000000000000"


# ============================================================
# 部署包清单
# ============================================================

REQUIRED_FILES = [
    "manifest.json",
    "ManagementPreset.json",
    "classplans.json",
    "timelayouts.json",
    "subjects.json",
    "policy.json",
    "credentials.json",
    "settings.json",
]


def load_json(p: str) -> dict:
    with open(p, "rb") as f:
        return json.loads(f.read().decode("utf-8-sig"))


def build_manifest(
    *,
    base_url: str,
    profile_path: str,
    out_dir: str,
    classes: dict[str, str] | None = None,
    versions: dict[str, int] | None = None,
    organization_name: str = "星集控",
    core_version: str = "2.0.0.0",
) -> dict:
    """生成 manifest.json 并写入 out_dir。

    versions 强制显式指定 —— 漏 bump 会导致教室机静默不更新。
    """
    versions = versions or {
        "ClassPlanSource": 1, "TimeLayoutSource": 1,
        "SubjectsSource": 1, "PolicySource": 1,
        "DefaultSettingsSource": 1,
    }
    base = base_url.rstrip("/")

    # 检查每个资源文件存在
    for f in ("classplans.json", "timelayouts.json", "subjects.json",
              "policy.json", "credentials.json", "settings.json"):
        if not os.path.isfile(os.path.join(out_dir, f)):
            raise FileNotFoundError(
                f"缺资源文件 {f}（先跑 gen_ci_profile.py --mode mgmt / "
                f"gen_policy.py / gen_settings.py 生成）")

    cp_url = f"{base}/{{id}}/classplans.json" if classes else f"{base}/classplans.json"

    sources = {
        "ClassPlanSource": cp_url,
        "TimeLayoutSource": f"{base}/timelayouts.json",
        "SubjectsSource": f"{base}/subjects.json",
        "PolicySource": f"{base}/policy.json",
        "DefaultSettingsSource": f"{base}/settings.json",
    }
    miss_s = set(versions) - set(sources)
    miss_v = set(sources) - set(versions)
    if miss_s or miss_v:
        raise ValueError(f"versions 不一致: 多余={sorted(miss_s)} 缺失={sorted(miss_v)}")

    man = {
        "ServerKind": 0,
        "CoreVersion": core_version,
        "OrganizationName": organization_name,
    }
    for k, u in sources.items():
        man[k] = {"Value": u, "Version": versions[k]}

    mp = os.path.join(out_dir, "manifest.json")
    with open(mp, "w", encoding="utf-8") as f:
        json.dump(man, f, ensure_ascii=False, indent=2)
    print(f"  manifest.json ({os.path.getsize(mp)} B)")

    # ManagementPreset.json
    preset = {
        "ManagementServerKind": 0,
        "ManagementServer": "",
        "ManagementServerGrpc": "",
        "ManifestUrlTemplate": f"{base}/manifest.json",
        "ClassIdentity": "",
    }
    pp = os.path.join(out_dir, "ManagementPreset.json")
    with open(pp, "w", encoding="utf-8") as f:
        json.dump(preset, f, ensure_ascii=False, indent=2)
    print(f"  ManagementPreset.json ({os.path.getsize(pp)} B)")
    return man


# ============================================================
# 上传
# ============================================================

def upload_local(src_dir: str, dst_dir: str) -> list[str]:
    """本地目录复制（模拟部署 / 共享目录）。"""
    copied: list[str] = []
    src = Path(src_dir)
    dst = Path(dst_dir)
    dst.mkdir(parents=True, exist_ok=True)
    for p in src.rglob("*"):
        if p.is_file():
            rel = p.relative_to(src)
            # 跳过元数据
            if rel.name in ("_deploy-list.json", "_classes.csv"):
                continue
            target = dst / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, target)
            copied.append(str(rel))
    return copied


def upload_http(src_dir: str, base_url: str, *, dry_run: bool = False) -> list[str]:
    """HTTP PUT 上传到静态服务器（nginx/apache 等）。

    逐文件 PUT，保留目录结构（{id}/classplans.json 等）。
    需目标服务器支持 PUT（nginx 需 `location` 配置开启 PUT）。
    """
    uploaded: list[str] = []
    base = base_url.rstrip("/")
    src = Path(src_dir)

    for p in src.rglob("*"):
        if not p.is_file():
            continue
        rel = str(p.relative_to(src)).replace("\\", "/")
        if rel in ("_deploy-list.json", "_classes.csv"):
            continue
        url = f"{base}/{rel}"
        data = p.read_bytes()
        req = urllib.request.Request(url, data=data, method="PUT")
        req.add_header("Content-Type", "application/json")
        req.add_header("Content-Length", str(len(data)))
        if dry_run:
            print(f"    [dry-run] PUT {url} ({len(data)} B)")
            uploaded.append(rel)
            continue
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                code = resp.status
                print(f"    PUT {rel} -> {code}")
            uploaded.append(rel)
        except Exception as e:
            print(f"    ❌ PUT {url} 失败: {e}")
    return uploaded


def upload_share(src_dir: str, share_path: str) -> list[str]:
    """上传到 Windows 网络共享（\\server\\share\\path）。"""
    # 实质是网络路径上的本地复制
    return upload_local(src_dir, share_path)


def detect_upload_target(target: str) -> str:
    """根据 target 前缀判断类型。"""
    t = target.rstrip("/")
    if t.startswith(("http://", "https://")):
        return "http"
    if t.startswith("\\\\"):
        return "share"
    return "local"


# ============================================================
# 教室机分发清单
# ============================================================

def gen_class_list(out_dir: str, classes: dict[str, str] | None = None,
                   class_ids: list[str] | None = None) -> list[dict]:
    """生成教室机部署清单（每台设备的 id -> 课表路径映射）。"""
    rows: list[dict] = []
    all_ids = sorted(set((class_ids or []) + (list(classes) if classes else [])))
    if not all_ids:
        all_ids = ["DEVICE-001", "DEVICE-002", "DEVICE-003"]  # 占位，提醒用户填
    for cid in all_ids:
        rows.append({
            "id": cid,
            "class_group": (classes or {}).get(cid, ""),
            "manifest_url": f"https://example.com/manifest.json",  # 占位
            "install_dir": r"C:\Program Files\ClassIsland",  # 真机路径
        })
    return rows


def write_class_csv(path: str, rows: list[dict]) -> None:
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["id", "class_group", "manifest_url", "install_dir"])
        w.writeheader()
        w.writerows(rows)
    print(f"  {path} ({len(rows)} 台设备)")


def gen_ps1_script(path: str, classes: dict[str, str], install_dir: str,
                   manifest_base: str) -> None:
    """生成 Windows 批量部署 PowerShell 脚本。

    每台教室机运行一次：填 ClassIdentity -> 拷贝 ManagementPreset.json。
    """
    lines = [
        "# ClassIsland 集控部署脚本 —— 在每台教室机上运行",
        "# 用法: .\\deploy-classisland.ps1 -ClassIdentity '8-1' -InstallDir 'C:\\Program Files\\ClassIsland'",
        "",
        "param(",
        "    [Parameter(Mandatory=$true)][string]$ClassIdentity,",
        f"    [string]$InstallDir = '{install_dir}',",
        f"    [string]$ManifestBase = '{manifest_base.rstrip('/')}'",
        ")",
        "",
        "$ErrorActionPreference = 'Stop'",
        "",
        "# 1. 检查 ClassIsland 安装",
        "$exe = Join-Path $InstallDir 'ClassIsland.exe'",
        "if (-not (Test-Path $exe)) { Write-Error 'ClassIsland 未安装在 $InstallDir'; exit 1 }",
        "",
        "# 2. 关闭 ClassIsland（如果运行中）",
        "Get-Process -Name 'ClassIsland' -ErrorAction SilentlyContinue | Stop-Process -Force",
        "Start-Sleep -Seconds 2",
        "",
        "# 3. 生成 ManagementPreset.json",
        "$preset = @{",
        "    ManagementServerKind = 0",
        "    ManagementServer = ''",
        "    ManagementServerGrpc = ''",
        "    ManifestUrlTemplate = '$ManifestBase/manifest.json'",
        "    ClassIdentity = $ClassIdentity",
        "}",
        "$presetPath = Join-Path $InstallDir 'ManagementPreset.json'",
        "if (Test-Path $presetPath) { Write-Host '备份现有 ManagementPreset.json' ",
        "    Copy-Item $presetPath \"$presetPath.bak-$(Get-Date -Format yyyyMMddHHmmss)\" }",
        "$preset | ConvertTo-Json -Depth 5 | Set-Content -Path $presetPath -Encoding UTF8",
        "Write-Host \"✓ ManagementPreset.json 已写入 (ClassIdentity=$ClassIdentity)\" -ForegroundColor Green",
        "",
        "# 4. 启动 ClassIsland（触发集控加入流程）",
        "Start-Process $exe",
        "Write-Host '✓ ClassIsland 已启动，请在弹出窗口中确认加入集控' -ForegroundColor Green",
        "",
        "# 5. 验证",
        "Start-Sleep -Seconds 5",
        "$policy = Join-Path $env:LOCALAPPDATA 'ClassIsland\\data\\Config\\Management\\Policy.json'",
        "if (Test-Path $policy) {",
        "    $p = Get-Content $policy -Raw | ConvertFrom-Json",
        "    if ($p.IsActive -eq $true) {",
        "        Write-Host '✓ 集控已激活 (Policy.IsActive=true)' -ForegroundColor Green",
        "    } else {",
        "        Write-Host '⚠ Policy.IsActive=false —— 可能还在确认流程中，稍后检查' -ForegroundColor Yellow",
        "    }",
        "} else {",
        "    Write-Host '⚠ Policy.json 未生成，检查日志' -ForegroundColor Yellow",
        "}",
    ]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"  {path} ({len(lines)} 行)")


# ============================================================
# CLI
# ============================================================

def main() -> int:
    ap = argparse.ArgumentParser(description="ClassIsland 集控部署工具")
    ap.add_argument("--profile", required=True, help="档案 JSON（读 Id 加 TrustedProfileIds）")
    ap.add_argument("--out", default="deploy/pkg", help="部署包输出目录")
    ap.add_argument("--base-url", default="https://example.com/ci",
                    help="静态托管基 URL（manifest 里 URL 的前缀）")
    ap.add_argument("--classes", help="班级映射 JSON 或文件 {班级ID: 群组名}")
    ap.add_argument("--class-list", help="教室机清单 CSV（可选）")
    ap.add_argument("--gen-script", help="生成教室机部署 PS1 脚本路径")
    ap.add_argument("--install-dir", default=r"C:\Program Files\ClassIsland",
                    help="教室机上 ClassIsland 安装目录")
    ap.add_argument("--versions", help='JSON: {"ClassPlanSource":2,...} 强制显式版本号')
    ap.add_argument("--upload", help="上传目标（http:// / \\server\\share\\ / 本地目录）")
    ap.add_argument("--dry-run", action="store_true", help="上传只打印不执行")
    a = ap.parse_args()

    out_dir = a.out
    os.makedirs(out_dir, exist_ok=True)

    # 1. 解析 classes
    classes = None
    if a.classes:
        if os.path.isfile(a.classes):
            classes = load_json(a.classes)
        else:
            classes = json.loads(a.classes)

    # 2. 检查前置文件
    missing = [f for f in ("classplans.json", "timelayouts.json", "subjects.json",
                           "policy.json", "credentials.json")
               if not os.path.isfile(os.path.join(out_dir, f))]
    if missing:
        print(f"❌ 部署包缺文件: {missing}")
        print("   先跑: gen_ci_profile.py --mode mgmt --out <同目录> 生成")
        print("         gen_policy.py --out <同目录> 生成")
        return 2

    # 3. 版本号
    versions = None
    if a.versions:
        if os.path.isfile(a.versions):
            versions = load_json(a.versions)
        else:
            versions = json.loads(a.versions)

    # 4. 生成 manifest + ManagementPreset
    print("=== 生成 manifest + ManagementPreset ===")
    man = build_manifest(base_url=a.base_url, profile_path=a.profile, out_dir=out_dir,
                         classes=classes, versions=versions)

    # 5. 教室机清单
    if a.class_list:
        if os.path.isfile(a.class_list):
            with open(a.class_list, encoding="utf-8-sig") as f:
                rows = list(csv.DictReader(f))
        else:
            rows = []
        write_class_csv(os.path.join(out_dir, "_classes.csv"), rows)

    # 6. 部署清单（元数据）
    manifest_file = os.path.join(out_dir, "manifest.json")
    preset_file = os.path.join(out_dir, "ManagementPreset.json")
    files = sorted(p.name for p in Path(out_dir).rglob("*")
                   if p.is_file() and p.name not in
                   {"ci-profile.json", "_deploy-list.json", "_classes.csv",
                    "deploy-classisland.ps1", "classes.json"})
    deploy_list = {
        "base_url": a.base_url,
        "manifest": manifest_file,
        "preset": preset_file,
        "files": files,
        "classes": classes or {},
        "generated_at": "see filesystem mtime",
    }
    with open(os.path.join(out_dir, "_deploy-list.json"), "w", encoding="utf-8") as f:
        json.dump(deploy_list, f, ensure_ascii=False, indent=2)
    print(f"  _deploy-list.json ({len(files)} 个文件)")

    # 7. 教室机 PS1 脚本
    if a.gen_script:
        gen_ps1_script(a.gen_script, classes or {}, a.install_dir, a.base_url)

    # 8. 上传
    if a.upload:
        kind = detect_upload_target(a.upload)
        print(f"\n=== 上传到 {a.upload} ({kind}) ===")
        if kind == "http":
            uploaded = upload_http(out_dir, a.upload, dry_run=a.dry_run)
        elif kind == "share":
            uploaded = upload_share(out_dir, a.upload)
        else:
            uploaded = upload_local(out_dir, a.upload)
        print(f"  已上传 {len(uploaded)} 个文件")
        print("\n⚠️  上传完成。下一步：")
        print(f"  1. 每台教室机运行生成的 .ps1（或拷贝 ManagementPreset.json）")
        print(f"  2. 填不同的 ClassIdentity（id）")
        print(f"  3. 检查 Policy.json 的 IsActive 是否为 true")

    # 9. 缓存陷阱提醒
    print("\n⚠️  缓存陷阱: 修改资源内容后必须 bump manifest 里的 Version，")
    print("    否则教室机不会更新。用 gen_ci_profile.py 的 --versions 或 bump_version()。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
