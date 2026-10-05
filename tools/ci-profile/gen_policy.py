#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""集控策略文件(policy.json) 与凭证文件(Credentials.json) 生成器。

Policy 格式来源:
  官方文档 https://docs.classisland.tech/management/policy.html  （8 字段）
  真机 D:\\Classlsland\\data\\Config\\Management\\Policy.json     （10 字段，多出
  DisableEasterEggs / IsActive —— 官方文档未列，但真机有，所以必须带上）
  ⚠️ Credentials.json 官方文档完全没有提及，但真机有。格式从真机反解。
  生成器必须输出这两个文件，否则客户端集控流程不完整。

用法:
  python tools/ci-profile/gen_policy.py                     # 生成默认(全放行) -> dist/policy.json + dist/credentials.json
  python tools/ci-profile/gen_policy.py --lock              # 锁定模式：禁编辑档案+设置
  python tools/ci-profile/gen_policy.py --disable-debug     # 禁用调试菜单
  python tools/ci-profile/gen_policy.py --credential admin  # 设置管理员密码(生成哈希)
  python tools/ci-profile/gen_policy.py --out outdir --print  # 打印不写文件
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding="utf-8")

# ============================================================
# Policy —— 10 字段
# 官方文档列 8 个；真机多出 DisableEasterEggs / IsActive
# ============================================================

POLICY_FIELDS: dict[str, bool] = {
    # 官方文档列出的 8 个
    "DisableProfileClassPlanEditing": False,
    "DisableProfileTimeLayoutEditing": False,
    "DisableProfileSubjectsEditing": False,
    "DisableProfileEditing": False,
    "DisableSettingsEditing": False,
    "DisableSplashCustomize": False,
    "DisableDebugMenu": False,
    "AllowExitManagement": True,        # 注意：这个是 True 表示"允许退出"，其余是"禁止"
    # 真机多出、官方文档未列的 2 个
    "DisableEasterEggs": False,
    "IsActive": False,                  # 集控启用标志
}


def gen_policy(
    *,
    profile: bool = False,
    time_layout: bool = False,
    subjects: bool = False,
    settings: bool = False,
    splash: bool = False,
    debug: bool = False,
    easter_eggs: bool = False,
    allow_exit: bool = True,
    active: bool = True,
) -> dict[str, bool]:
    """生成 Policy。全部参数对应官方文档/真机字段的实际语义。

    语义注意：
      - 除 AllowExitManagement 外，其余都是「True=禁止」
      - AllowExitManagement True=允许用户退出集控（默认 True）
      - IsActive 控制整个集控是否启用，生产环境应 True
    """
    out = dict(POLICY_FIELDS)
    out["DisableProfileClassPlanEditing"] = profile
    out["DisableProfileTimeLayoutEditing"] = time_layout
    out["DisableProfileSubjectsEditing"] = subjects
    out["DisableProfileEditing"] = profile or time_layout or subjects  # 父项兜底
    out["DisableSettingsEditing"] = settings
    out["DisableSplashCustomize"] = splash
    out["DisableDebugMenu"] = debug
    out["DisableEasterEggs"] = easter_eggs
    out["AllowExitManagement"] = allow_exit
    out["IsActive"] = active
    return out


def validate_policy(p: dict[str, bool]) -> list[str]:
    """校验 Policy：字段齐全、类型对。返回错误列表（空=通过）。"""
    errs: list[str] = []
    if not isinstance(p, dict):
        return ["Policy 必须是 dict"]
    missing = set(POLICY_FIELDS) - set(p)
    extra = set(p) - set(POLICY_FIELDS)
    if missing:
        errs.append(f"缺字段: {sorted(missing)}")
    if extra:
        errs.append(f"多字段(可能拼错): {sorted(extra)}")
    for k, v in p.items():
        if not isinstance(v, bool):
            errs.append(f"{k} 应为 bool，实际 {type(v).__name__}={v}")
    return errs


# ============================================================
# Credentials —— 真机 10 字段，官方文档未提
# ============================================================

CRED_FIELDS: dict[str, str | int | bool] = {
    "UserCredential": "",                       # 用户级密码（明文，真机空）
    "AdminCredential": "",                      # 管理员密码（哈希，真机空）
    "EditAuthorizeSettingsAuthorizeLevel": 0,   # 编辑授权设置所需等级
    "EditPolicyAuthorizeLevel": 0,              # 编辑策略所需等级
    "ExitManagementAuthorizeLevel": 0,          # 退出集控所需等级
    "EditProfileAuthorizeLevel": 0,             # 编辑档案所需等级
    "EditSettingsAuthorizeLevel": 0,            # 编辑设置所需等级
    "ExitApplicationAuthorizeLevel": 0,         # 退出应用所需等级
    "ChangeLessonsAuthorizeLevel": 0,           # 临时换课所需等级
    "IsActive": False,                          # 凭据记录启用标志
}


def hash_credential(pwd: str) -> str:
    """加盐哈希密码。真机 AdminCredential 是哈希，UserCredential 是明文。

    用 SHA256 + 固定盐（集控场景下客户端无法协商盐值，所以走固定盐）。
    ⚠️ 这不是抗离线爆破的强哈希——真正的集控服务器场景应使用 PBKDF2/Argon2
    并由服务器下发盐值。本工具只保证格式正确。
    """
    if not pwd:
        return ""
    salt = b"stelarith-ci-2026"
    h = hashlib.sha256(salt + pwd.encode("utf-8")).hexdigest()
    return f"sha256$${h}"


def gen_credentials(
    *,
    user_credential: str = "",
    admin_credential: str = "",
    edit_authorize_settings_level: int = 0,
    edit_policy_level: int = 0,
    exit_management_level: int = 0,
    edit_profile_level: int = 0,
    edit_settings_level: int = 0,
    exit_application_level: int = 0,
    change_lessons_level: int = 0,
    active: bool = True,
) -> dict[str, str | int | bool]:
    """生成 Credentials。

    字段语义：
      - *Credential 是密码（User 明文 / Admin 哈希）
      - *AuthorizeLevel 是所需等级：0=无等级（直接放行），>=1=需要对应凭据
      - IsActive 控制整个凭据记录是否生效

    典型场景：
      - 全放行：所有 level=0，两个 Credential 留空
      - 管理员密码锁档案：admin_credential="mypwd" + edit_profile_level=1
    """
    return {
        "UserCredential": user_credential,
        "AdminCredential": hash_credential(admin_credential) if admin_credential else "",
        "EditAuthorizeSettingsAuthorizeLevel": edit_authorize_settings_level,
        "EditPolicyAuthorizeLevel": edit_policy_level,
        "ExitManagementAuthorizeLevel": exit_management_level,
        "EditProfileAuthorizeLevel": edit_profile_level,
        "EditSettingsAuthorizeLevel": edit_settings_level,
        "ExitApplicationAuthorizeLevel": exit_application_level,
        "ChangeLessonsAuthorizeLevel": change_lessons_level,
        "IsActive": active,
    }


def validate_credentials(c: dict[str, str | int | bool]) -> list[str]:
    errs: list[str] = []
    if not isinstance(c, dict):
        return ["Credentials 必须是 dict"]
    missing = set(CRED_FIELDS) - set(c)
    extra = set(c) - set(CRED_FIELDS)
    if missing:
        errs.append(f"缺字段: {sorted(missing)}")
    if extra:
        errs.append(f"多字段: {sorted(extra)}")
    for k in ("UserCredential", "AdminCredential"):
        if not isinstance(c.get(k), str):
            errs.append(f"{k} 应为 str，实际 {type(c.get(k)).__name__}")
    for k in CRED_FIELDS:
        if k.endswith("Level"):
            v = c.get(k)
            if not isinstance(v, int):
                errs.append(f"{k} 应为 int，实际 {type(v).__name__}")
        elif k == "IsActive":
            if not isinstance(c.get(k), bool):
                errs.append(f"{k} 应为 bool")
    return errs


# ============================================================
# CLI
# ============================================================

def main() -> int:
    ap = argparse.ArgumentParser(description="生成 ClassIsland 集控策略 + 凭证文件")
    ap.add_argument("--out", default=None, help="输出目录（默认 stdout 打印）")
    ap.add_argument("--lock", action="store_true", help="锁定模式：禁编辑档案+设置+调试菜单")
    ap.add_argument("--no-lock-profile", action="store_true", help="配合 --lock，不禁档案（只禁设置）")
    ap.add_argument("--disable-debug", action="store_true")
    ap.add_argument("--no-exit", action="store_true", help="禁止退出集控")
    ap.add_argument("--inert", action="store_true", help="生成未启用(IsActive=false)的 policy/credentials")
    ap.add_argument("--credential", default="", help="管理员密码（生成哈希）")
    ap.add_argument("--edit-profile-level", type=int, default=None,
                    help="显式指定编辑档案所需等级（0=不锁；不传则跟随 --credential）")
    ap.add_argument("--edit-settings-level", type=int, default=None,
                    help="显式指定编辑设置所需等级")
    ap.add_argument("--exit-level", type=int, default=None)
    ap.add_argument("--change-lessons-level", type=int, default=None)
    ap.add_argument("--print", action="store_true", dest="do_print", help="打印不写文件")
    a = ap.parse_args()

    # ---- Policy ----
    policy_kwargs: dict = {}
    if a.lock:
        policy_kwargs["settings"] = True
        policy_kwargs["debug"] = True
        policy_kwargs["easter_eggs"] = True
        if not a.no_lock_profile:
            policy_kwargs["profile"] = True
            policy_kwargs["time_layout"] = True
            policy_kwargs["subjects"] = True
    if a.disable_debug:
        policy_kwargs["debug"] = True
    if a.no_exit:
        policy_kwargs["allow_exit"] = False
    if a.inert:
        policy_kwargs["active"] = False
    policy = gen_policy(**policy_kwargs)

    # ---- Credentials ----
    cred_kwargs: dict = {}
    # 显式参数优先；未显式指定时才跟随 --credential 走默认锁
    ep_level = a.edit_profile_level if a.edit_profile_level is not None else (1 if a.credential else 0)
    es_level = a.edit_settings_level if a.edit_settings_level is not None else (1 if a.credential else 0)
    ex_level = a.exit_level if a.exit_level is not None else 0
    cl_level = a.change_lessons_level if a.change_lessons_level is not None else 0
    if a.credential:
        cred_kwargs["admin_credential"] = a.credential
    if ep_level:
        cred_kwargs["edit_profile_level"] = ep_level
    if es_level:
        cred_kwargs["edit_settings_level"] = es_level
    if ex_level:
        cred_kwargs["exit_management_level"] = ex_level
    if cl_level:
        cred_kwargs["change_lessons_level"] = cl_level
    if a.inert:
        cred_kwargs["active"] = False
    credentials = gen_credentials(**cred_kwargs)

    # ---- 校验 ----
    pe = validate_policy(policy)
    ce = validate_credentials(credentials)
    all_errs = pe + ce
    if all_errs:
        print("!! 校验失败:")
        for e in all_errs:
            print(f"   - {e}")
        return 1
    print(f"✅ Policy: {len(policy)} 字段 / Credentials: {len(credentials)} 字段")

    if a.do_print or not a.out:
        print("\n--- policy.json ---")
        print(json.dumps(policy, ensure_ascii=False, indent=2))
        print("\n--- credentials.json ---")
        print(json.dumps(credentials, ensure_ascii=False, indent=2))
        return 0

    os.makedirs(a.out, exist_ok=True)
    for fn, obj in (("policy.json", policy), ("credentials.json", credentials)):
        fp = os.path.join(a.out, fn)
        with open(fp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        print(f"  {fp} ({os.path.getsize(fp)} B)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
