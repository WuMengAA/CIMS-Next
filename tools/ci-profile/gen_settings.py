#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ClassIsland Settings.json 生成器（merge 模式）。

⚠️ 关键背景（真机数据得出，非官方文档）：
  1. Settings.json 顶层 198 字段。硬造一个新文件会丢失大量本地设置（字号、主题、
     通知、语音等），用户一导入就发现"怎么全乱了"。所以默认走 merge：
     读现有 Settings.json，只覆盖关键字段，其余原样保留。
  2. TrustedProfileIds 是隐藏依赖。真机值 ["d39a5f3e-..."] 正好等于真机档案
     的 Id 字段。档案 Id 必须加进此列表才被客户端信任；缺失则集控下发的
     档案不被加载。官方文档完全没提这个字段。
  3. 多周轮换参数：SingleWeekStartTime / MultiWeekRotationMaxCycle /
     MultiWeekRotationOffset。这三个都在 Settings.json，不在档案里。
     只改档案的 TimeRule.WeekCountDiv 不会生效。

用法:
  python tools/ci-profile/gen_settings.py --existing 现有Settings.json --profile 档案.json
  python tools/ci-profile/gen_settings.py --existing 现有Settings.json --print   # 只打印改动
  python tools/ci-profile/gen_settings.py --new --profile 档案.json               # 无现有文件时硬造
  python tools/ci-profile/gen_settings.py --existing ... --cycle 2 --start 2026-09-01
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8")

ZERO = "00000000-0000-0000-0000-000000000000"

# ============================================================
# 集控场景下需要管的关键字段（其余 198-16=182 个字段全部保留）
# 字段来源：真机 D:\Classlsland\data\Settings.json（2 台真机交叉确认）
# ============================================================

# 多周轮换相关
SETTINGS_MANAGED_KEYS: list[str] = [
    "SelectedProfile",
    "SingleWeekStartTime",
    "MultiWeekRotationMaxCycle",
    "MultiWeekRotationOffset",
    "ClassPrepareNotifySeconds",
    "IsClassPrepareNotificationEnabled",
    "IsClassChangingNotificationEnabled",
    "IsClassOffNotificationEnabled",
    "ShowCurrentLessonOnlyOnClass",
    "DefaultOnClassTimePointMinutes",
    "TrustedProfileIds",
    "RefreshingScopes",
]


# ============================================================
# 默认值（来自真机反解，非猜测）
# ============================================================

# 真机 MultiWeekRotationOffset = [-1, -1, 0, 0, 0]
# 语义：每个元素对应"该周期内第 N 周使用第几周课表"
#   -1 = 使用基础课表（不轮换）
#    N = 使用 TimeRule.WeekCountDiv == N 的课表
# 5 个元素 = 最多支持 5 周轮换；MaxCycle=4 时前 4 个有效
DEFAULT_ROTATION_OFFSET = [-1, -1, 0, 0, 0]


def build_refreshing_scopes(*, profile: bool = True,
                            class_plans: bool = True,
                            time_layouts: bool = True,
                            components: bool = True,
                            automations: bool = True,
                            plugins: bool = True,
                            reserved_class_plans: list[str] | None = None,
                            reserved_time_layouts: list[str] | None = None) -> dict:
    """RefreshingScopes：集控刷新的资源范围。

    ⚠️ 关键（CIMS-backend\\seed_resources\\DefaultSettings.json 实测）：
    这个字段在 Settings.json 里，不在 manifest 也不在档案里。
    设为 True 的资源由集控服务端下发，客户端只拉不改；Reserved* 是
    要保留本地不被覆盖的 GUID 白名单。

    字段：
      Profile            整个档案
      ProfileClassPlans  课表（ClassPlan）
      ProfileTimeLayouts 作息（TimeLayout）
      Components         组件
      Automations        自动化规则
      Plugins            插件
      ReservedClassPlans     保留本地的课表 GUID
      ReservedTimeLayouts    保留本地的作息 GUID
    """
    return {
        "Profile": profile,
        "ProfileClassPlans": class_plans,
        "ProfileTimeLayouts": time_layouts,
        "Components": components,
        "Automations": automations,
        "Plugins": plugins,
        "ReservedClassPlans": reserved_class_plans or [],
        "ReservedTimeLayouts": reserved_time_layouts or [],
    }


def load_existing(path: str) -> dict:
    """读现有 Settings.json（UTF-8 with BOM 兼容）。"""
    with open(path, "rb") as f:
        raw = f.read()
    return json.loads(raw.decode("utf-8-sig"))


def load_profile_id(profile_path: str) -> str:
    """从档案 JSON 里读 Id 字段。"""
    with open(profile_path, "rb") as f:
        raw = f.read()
    prof = json.loads(raw.decode("utf-8-sig"))
    pid = prof.get("Id")
    if not pid or pid == ZERO:
        raise ValueError(f"档案 {profile_path} 缺 Id 字段或为空 —— TrustedProfileIds 需要有效 Id")
    return pid


def build_settings(
    existing: dict | None,
    *,
    profile_id: str,
    profile_name: str = "Default.json",
    cycle: int = 4,
    start_date: str = "2026-09-01",
    rotation_offset: list[int] | None = None,
    class_prepare_seconds: int = 60,
    hide_on_class: bool = False,
    refreshing_scopes: dict | None = None,
    add_trusted: bool = True,
) -> tuple[dict, list[dict]]:
    """合并生成 Settings.json。

    策略：
      - 现有字段全部保留（merge）
      - 只覆盖 SETTINGS_MANAGED_KEYS 列出的字段
      - TrustedProfileIds 合并（不覆盖，追加档案 Id，去重）

    返回 (新 Settings, 改动日志)。
    """
    out = json.loads(json.dumps(existing)) if existing else {}
    changes: list[dict] = []

    def set_key(k: str, v) -> None:
        old = out.get(k)
        if old != v:
            changes.append({"key": k, "old": old, "new": v})
        out[k] = v

    # ---- 基础 ----
    set_key("SelectedProfile", profile_name)

    # ---- 多周轮换 ----
    set_key("SingleWeekStartTime", f"{start_date}T00:00:00")
    set_key("MultiWeekRotationMaxCycle", cycle)
    set_key("MultiWeekRotationOffset", rotation_offset or DEFAULT_ROTATION_OFFSET)

    # ---- 上课通知 ----
    set_key("ClassPrepareNotifySeconds", class_prepare_seconds)
    set_key("IsClassPrepareNotificationEnabled", True)
    set_key("IsClassChangingNotificationEnabled", True)
    set_key("IsClassOffNotificationEnabled", True)
    set_key("ShowCurrentLessonOnlyOnClass", False)
    set_key("DefaultOnClassTimePointMinutes", 40)
    set_key("HideOnClass", hide_on_class)

    # ---- 集控刷新范围 ----
    set_key("RefreshingScopes", refreshing_scopes or build_refreshing_scopes())

    # ---- 信任档案（关键隐藏依赖）----
    if add_trusted:
        cur = out.get("TrustedProfileIds") or []
        if not isinstance(cur, list):
            cur = []
        new = [profile_id] + [x for x in cur if x != profile_id]
        set_key("TrustedProfileIds", new)
        changes.append({"key": "_note", "old": None,
                        "new": f"档案 {profile_id[:8]}... 加入 TrustedProfileIds（共 {len(new)} 个）"})

    return out, changes


def validate_settings(s: dict, profile_id: str) -> list[str]:
    """校验 Settings.json 关键约束。"""
    errs: list[str] = []

    # 1. 档案 Id 必须在 TrustedProfileIds 里
    trusted = s.get("TrustedProfileIds") or []
    if profile_id and profile_id != ZERO:
        if profile_id not in trusted:
            errs.append(f"档案 Id {profile_id[:8]}... 不在 TrustedProfileIds —— 档案不会被信任加载")

    # 2. MultiWeekRotationMaxCycle 范围
    cyc = s.get("MultiWeekRotationMaxCycle")
    if not isinstance(cyc, int) or cyc < 1 or cyc > 5:
        errs.append(f"MultiWeekRotationMaxCycle={cyc} 应在 1-5（真机最大值 4，客户端支持 5）")

    # 3. MultiWeekRotationOffset 长度
    off = s.get("MultiWeekRotationOffset")
    if not isinstance(off, list):
        errs.append(f"MultiWeekRotationOffset={off} 应为 list")
    elif len(off) != 5:
        errs.append(f"MultiWeekRotationOffset 应有 5 个元素，实际 {len(off)}")
    else:
        for i, x in enumerate(off):
            if not isinstance(x, int):
                errs.append(f"MultiWeekRotationOffset[{i}]={x} 应为 int（-1=基础课表，>=0=轮换第 N 周）")

    # 4. SingleWeekStartTime 格式
    sdt = s.get("SingleWeekStartTime")
    if not sdt:
        errs.append("SingleWeekStartTime 缺失")
    else:
        try:
            datetime.fromisoformat(sdt)
        except ValueError:
            errs.append(f"SingleWeekStartTime={sdt} 不是 ISO8601 格式")

    # 5. RefreshingScopes 字段
    rs = s.get("RefreshingScopes")
    if not isinstance(rs, dict):
        errs.append(f"RefreshingScopes={rs} 应为 dict")
    else:
        for k in ("Profile", "ProfileClassPlans", "ProfileTimeLayouts",
                  "Components", "Automations", "Plugins"):
            if not isinstance(rs.get(k), bool):
                errs.append(f"RefreshingScopes.{k}={rs.get(k)} 应为 bool")
        for k in ("ReservedClassPlans", "ReservedTimeLayouts"):
            if not isinstance(rs.get(k), list):
                errs.append(f"RefreshingScopes.{k}={rs.get(k)} 应为 list")

    # 6. 上课通知相关字段
    for k in ("ClassPrepareNotifySeconds", "DefaultOnClassTimePointMinutes"):
        if not isinstance(s.get(k), int):
            errs.append(f"{k}={s.get(k)} 应为 int")
    for k in ("IsClassPrepareNotificationEnabled", "IsClassChangingNotificationEnabled",
              "IsClassOffNotificationEnabled", "ShowCurrentLessonOnlyOnClass"):
        if not isinstance(s.get(k), bool):
            errs.append(f"{k}={s.get(k)} 应为 bool")

    return errs


def main() -> int:
    ap = argparse.ArgumentParser(description="生成 ClassIsland Settings.json（merge 模式）")
    ap.add_argument("--existing", help="现有 Settings.json 路径（merge 基底；缺省则硬造）")
    ap.add_argument("--profile", required=True, help="档案 JSON 路径（读 Id 加入 TrustedProfileIds）")
    ap.add_argument("--out", help="输出路径（默认打印）")
    ap.add_argument("--profile-name", default="Default.json", help="SelectedProfile 值")
    ap.add_argument("--cycle", type=int, default=4, help="多周轮换周期（1-5，真机 4）")
    ap.add_argument("--start", default="2026-09-01", help="SingleWeekStartTime 日期")
    ap.add_argument("--rotation-offset", help='JSON list 如 [-1,0,-1,0,0]')
    ap.add_argument("--prepare-seconds", type=int, default=60, help="上课前提醒秒数")
    ap.add_argument("--hide-on-class", action="store_true", help="上课时隐藏 ClassIsland")
    ap.add_argument("--new", action="store_true", help="强制硬造（忽略 --existing）")
    ap.add_argument("--no-trusted", action="store_true", help="不修改 TrustedProfileIds")
    ap.add_argument("--print-changes", action="store_true", help="只打印改动项")
    a = ap.parse_args()

    # 读现有 Settings
    existing = None
    if a.existing and not a.new:
        if not os.path.isfile(a.existing):
            print(f"❌ --existing 指定的文件不存在: {a.existing}")
            return 2
        existing = load_existing(a.existing)
        print(f"读取现有 Settings.json: {len(existing)} 字段（merge 基底）")

    # 读档案 Id
    try:
        profile_id = load_profile_id(a.profile)
    except (FileNotFoundError, ValueError) as e:
        print(f"❌ {e}")
        return 2
    print(f"档案 Id: {profile_id[:12]}...")

    # 轮换偏移
    rotation_offset = None
    if a.rotation_offset:
        if os.path.isfile(a.rotation_offset):
            rotation_offset = json.loads(open(a.rotation_offset, "rb").read().decode("utf-8-sig"))
        else:
            rotation_offset = json.loads(a.rotation_offset)

    # 生成
    settings, changes = build_settings(
        existing,
        profile_id=profile_id,
        profile_name=a.profile_name,
        cycle=a.cycle,
        start_date=a.start,
        rotation_offset=rotation_offset,
        class_prepare_seconds=a.prepare_seconds,
        hide_on_class=a.hide_on_class,
        add_trusted=not a.no_trusted,
    )

    # 校验
    errs = validate_settings(settings, profile_id)
    if errs:
        print("❌ 校验失败:")
        for e in errs:
            print(f"   - {e}")
        return 1

    print(f"✅ Settings.json 校验通过：{len(settings)} 字段，{len(changes)} 项改动")

    # --print-changes: 额外打印改动项（不跳过写文件）
    # 无 --out: 打印完整 JSON（无基底时）
    if a.print_changes or (not a.out and not a.existing):
        print("\n--- 改动项 ---")
        for c in changes:
            if c["key"] == "_note":
                print(f"  ℹ️  {c['new']}")
            else:
                o = json.dumps(c["old"], ensure_ascii=False)[:50] if c["old"] is not None else "null"
                n = json.dumps(c["new"], ensure_ascii=False)[:50]
                print(f"  {c['key']}: {o} → {n}")
        # 无 --out 且无基底时打印完整内容（便于查看硬造结果）
        if not a.out:
            print("\n--- 完整 Settings.json ---")
            print(json.dumps(settings, ensure_ascii=False, indent=2))

    if a.out:
        d = os.path.dirname(a.out)
        if d:
            os.makedirs(d, exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)
        print(f"  已写入 {a.out} ({os.path.getsize(a.out)} B)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
