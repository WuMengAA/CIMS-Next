#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 ClassIsland 2.x 课表档案（Default.json 格式）。

用法:
    python tools/ci-profile/gen_ci_profile.py              # 生成样例 -> dist/ci-profile-sample.json
    python tools/ci-profile/gen_ci_profile.py --merge 现有.json --out 合并.json
    python tools/ci-profile/gen_ci_profile.py --print-profile    # 只打印档案

格式来源: D:\\Classlsland\\data\\Profiles\\Default.json（真机 2.1.0.1 反解），
         字段名与结构逐字对照，不是照文档猜的。详见 01-classisland-profile格式.md。
"""
from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import datetime, timedelta

ZERO = "00000000-0000-0000-0000-000000000000"

# TimeType: 0=上课 1=课间休息 2=分割线 3=行动组
T_CLASS, T_BREAK, T_LINE, T_ACTION = 0, 1, 2, 3


def gu() -> str:
    """ClassIsland 用标准小写带连字符 UUID。"""
    return str(uuid.uuid4())


def hhmmss(minutes: int) -> str:
    """分钟数 -> 'HH:mm:ss'（ClassIsland 的时间精度）。"""
    return f"{minutes // 60:02d}:{minutes % 60:02d}:00"


def span(start_min: int, dur: int) -> dict:
    """一个上课时间段。dur=0 表示零长度（分割线/行动组那种）。"""
    return {"StartTime": hhmmss(start_min), "EndTime": hhmmss(start_min + dur),
            "TimeType": T_CLASS}


# ---------- 默认作息（周1234：上午 4 节 + 下午 4 节 + 晚自习 4 节）----------
WEEKDAY_LESSONS = [span(7 * 60 + 25, 40), span(8 * 60 + 10, 40),
                   span(9 * 60, 40), span(10 * 60 + 10, 40),
                   span(14 * 60 + 10, 40), span(15 * 60, 40),
                   span(15 * 60 + 55, 40), span(16 * 60 + 45, 70),
                   span(18 * 60 + 50, 50), span(19 * 60 + 50, 40),
                   span(20 * 60 + 40, 40), span(21 * 60, 40)]

# 周5：下午早收工
FRIDAY_LESSONS = [span(7 * 60 + 25, 40), span(8 * 60 + 10, 40), span(9 * 60, 40),
                  span(10 * 60 + 10, 40), span(14 * 60 + 10, 40),
                  span(15 * 60, 40), span(15 * 60 + 55, 40), span(16 * 60 + 45, 40)]

# 周日：只到晚自习第一节
SUNDAY_LESSONS = [span(18 * 60 + 50, 50), span(19 * 60 + 50, 40), span(20 * 60 + 40, 40)]

BREAK = 10
LUNCH = 130  # 11:50 -> 14:10
EVE_GAP = 30  # 17:55 -> 18:50
WEEKDAY_BREAKS = [7 * 60 + 40, 8 * 60, 9 * 60 + 40, 10 * 60 + 50,
                  14 * 60 + 50, 15 * 60 + 40, 16 * 60 + 35]
FRIDAY_BREAKS = [7 * 60 + 40, 8 * 60, 9 * 60 + 40, 10 * 60 + 50,
                 14 * 60 + 50, 15 * 60 + 40]
SUNDAY_BREAKS = [18 * 60 + 40, 19 * 60 + 40, 20 * 60 + 30]

BREAK_NAMES = ["课间", "眼保健操", "大课间", "午休", "课间", "课间", "晚自习间"]

# 默认样例课表：周1-4 用 12 节，周5 8 节，周日 3 节。
# 科目数必须精确等于该天 TimeType==0 的数量，否则教室机课表静默空白。
DEFAULT_SCHEDULE: dict[int, list[str]] = {
    1: ["早读", "语文", "数学", "英语", "化学", "物理", "生物", "体育",
        "班会", "数学", "自习", "化学"],
    2: ["早读", "数学", "英语", "语文", "物理", "化学", "生物", "音乐",
        "班会", "语文", "自习", "历史"],
    3: ["早读", "语文", "数学", "英语", "化学", "物理", "生物", "美术",
        "班会", "数学", "自习", "化学"],
    4: ["早读", "数学", "英语", "语文", "物理", "化学", "生物", "体育",
        "班会", "语文", "自习", "历史"],
    5: ["早读", "语文", "数学", "英语", "化学", "物理", "生物", "体育"],
    6: ["早读", "班会", "自习"],
    7: ["早读", "班会", "自习"],
}


def build_time_layout(name: str, lessons: list[dict], breaks: list[int],
                      break_name_cycle: int = 7) -> dict:
    """生成一个 TimeLayout：把上课段与课间穿插排序，输出 ClassIsland 的 Layouts 数组。

    关键: 只有 TimeType==0 的时间点会被 ClassPlan.Classes 分配科目，
    所以 Classes 数组长度必须 == TimeType==0 的数量。
    """
    pts = list(lessons)
    for i, b in enumerate(breaks):
        pts.append({"StartTime": hhmmss(b), "EndTime": hhmmss(b + BREAK),
                    "TimeType": T_BREAK, "BreakName": BREAK_NAMES[i % break_name_cycle]})
    # 中午/晚上零长度分割线
    for gap in (11 * 60 + 50, 17 * 60 + 55):
        if any(l["StartTime"] < hhmmss(gap) < l["EndTime"] for l in lessons):
            continue
        pts.append({"StartTime": hhmmss(gap), "EndTime": hhmmss(gap),
                    "TimeType": T_LINE})
    pts.sort(key=lambda p: (p["StartTime"], p["EndTime"]))

    out = []
    for p in pts:
        out.append({
            "StartSecond": "", "EndSecond": "",
            "StartTime": p["StartTime"], "EndTime": p["EndTime"],
            "TimeType": p["TimeType"], "IsHideDefault": False,
            "DefaultClassId": ZERO, "BreakName": p.get("BreakName", ""),
            "ActionSet": None, "AttachedObjects": {}, "IsActive": False,
        })
    return {"IsOverlay": False, "OverlaySourceId": None, "Name": name,
            "Layouts": out, "AttachedObjects": {}, "IsActive": False}


def new_subject(name: str, teacher: str = "", outdoor: bool = False) -> dict:
    return {"Name": name, "Initial": name[:1], "TeacherName": teacher,
            "IsOutDoor": outdoor, "AttachedObjects": {}, "IsActive": False}


def make_profile(name: str = "星集控课表",
                 group_names: list[str] = ("8班课表群",),
                 schedule: dict[int, list[str]] | None = None,
                 subjects: list[str] | None = None,
                 cycle: int = 2) -> dict:
    """生成完整档案。

    schedule: {day_of_week(1-7): [科目名, ...]}，长度必须等于该天 TimeType==0 的数量。
              缺哪天就复制周1。cycle: 多周轮换周期（1=不轮换）。
    """
    subjects = subjects or ["语文", "数学", "英语", "物理", "化学", "生物",
                            "历史", "政治", "地理", "体育", "信息技术", "音乐",
                            "美术", "自习", "早读", "班会", "升旗", "课间活动"]
    sg: dict[str, dict] = {gu(): new_subject(s) for s in subjects}
    sname2id: dict[str, str] = {}
    for k, v in sg.items():
        sname2id[v["Name"]] = k

    tl_w = build_time_layout("周1234", WEEKDAY_LESSONS, WEEKDAY_BREAKS)
    tl_f = build_time_layout("周5", FRIDAY_LESSONS, FRIDAY_BREAKS)
    tl_s = build_time_layout("周日", SUNDAY_LESSONS, SUNDAY_BREAKS)
    id_w, id_f, id_s = gu(), gu(), gu()
    tl: dict[str, dict] = {id_w: tl_w, id_f: tl_f, id_s: tl_s}

    lessons_per_day = {1: len(WEEKDAY_LESSONS), 2: len(WEEKDAY_LESSONS),
                       3: len(WEEKDAY_LESSONS), 4: len(WEEKDAY_LESSONS),
                       5: len(FRIDAY_LESSONS), 6: len(SUNDAY_LESSONS),
                       7: len(SUNDAY_LESSONS)}
    layout_of = {1: id_w, 2: id_w, 3: id_w, 4: id_w, 5: id_f, 6: id_s, 7: id_s}

    # 课表群: {UUID: 群名}。键必须是 UUID —— ClassIsland 用 GUID 索引，
    # 用名字做键会导致 SelectedClassPlanGroupId 找不到对应群。
    # 键 "00000000-..." 固定表示全局课表群。
    group_name_by_id: dict[str, str] = {ZERO: "全局课表群"}
    default_group_id = gu()
    group_name_by_id[default_group_id] = "默认"

    target_group_name = group_names[0] if group_names else "默认"
    gid = default_group_id
    if target_group_name not in ("默认", "全局课表群"):
        new_gid = gu()
        group_name_by_id[new_gid] = target_group_name
        gid = new_gid

    cp: dict[str, dict] = {}
    sched = schedule or DEFAULT_SCHEDULE
    for d in range(1, 8):
        subj_names = sched.get(d) or sched.get(1) or []
        if len(subj_names) != lessons_per_day[d]:
            raise ValueError(f"星期{d}: 科目数 {len(subj_names)} != 该天 {lessons_per_day[d]} 个上课时间点")
        cls = [{"SubjectId": sname2id.get(s, ZERO), "IsChangedClass": False,
                "AttachedObjects": {}, "IsEnabled": True, "IsActive": False}
               for s in subj_names]
        cp[gu()] = {"TimeLayoutId": layout_of[d], "TimeRule": {
            "WeekDay": d, "WeekCountDiv": 0, "WeekCountDivTotal": cycle,
            "IsActive": False},
            "Classes": cls, "Name": f"周{d}", "IsOverlay": False,
            "OverlaySourceId": None, "OverlaySetupTime": None, "IsEnabled": True,
            "AssociatedGroup": gid, "AttachedObjects": {}, "IsActive": False}

    return {
        "Name": name, "TimeLayouts": tl, "ClassPlans": cp, "Subjects": sg,
        "IsOverlayClassPlanEnabled": False, "OverlayClassPlanId": None,
        "TempClassPlanId": None, "TempClassPlanSetupTime": None,
        "ClassPlanGroups": {k: {"Name": v, "IsGlobal": (k == ZERO), "IsActive": False}
                            for k, v in group_name_by_id.items()},
        "SelectedClassPlanGroupId": gid,
        "TempClassPlanGroupId": None, "TempClassPlanGroupExpireTime": None,
        "IsTempClassPlanGroupEnabled": False, "TempClassPlanGroupType": 1,
        "Id": gu(), "OrderedSchedules": {}, "IsActive": False,
    }


def validate(prof: dict) -> list[str]:
    """校验档案内部一致性。返回错误列表（空=通过）。

    最致命的一条: Classes 数 != TimeType==0 数 → 教室机课表静默空白（不报错）。
    """
    errs: list[str] = []
    sg = prof.get("Subjects") or {}
    if not isinstance(sg, dict):
        return ["Subjects 不是 dict"]

    cp = prof.get("ClassPlans") or {}
    if not cp:
        errs.append("ClassPlans 为空")
    tl = prof.get("TimeLayouts") or {}

    for cid, plan in cp.items():
        tli = plan.get("TimeLayoutId")
        if tli not in tl:
            errs.append(f"ClassPlan[{cid[:8]}] TimeLayoutId={tli} 不存在")
            continue
        layouts = tl[tli].get("Layouts") or []
        n_class = len([l for l in layouts if l.get("TimeType") == 0])
        n_plan = len(plan.get("Classes") or [])
        if n_class != n_plan:
            errs.append(f"ClassPlan[{plan.get('Name')}] Classes={n_plan} != "
                        f"TimeType0={n_class} → 教室机课表会静默空白")
        for i, c in enumerate(plan.get("Classes") or []):
            sid = c.get("SubjectId") or ZERO
            if sid != ZERO and sid not in sg:
                errs.append(f"ClassPlan[{plan.get('Name')}] Classes[{i}] "
                            f"SubjectId={sid} 不在 Subjects 里")

    gid = prof.get("SelectedClassPlanGroupId")
    groups = prof.get("ClassPlanGroups") or {}
    if gid and gid not in groups:
        errs.append(f"SelectedClassPlanGroupId={gid} 不在 ClassPlanGroups 里")

    for kid in tl:
        for l in tl[kid].get("Layouts") or []:
            d = l.get("DefaultClassId") or ZERO
            if d != ZERO and d not in sg:
                errs.append(f"TimeLayout[{tl[kid]['Name']}] DefaultClassId={d} "
                            f"不在 Subjects 里")
    return errs


def merge_into(base: dict, new: dict, keep_layout: bool = False) -> dict:
    """把生成的档案合并进现有档案（保留现有主题/字号/通知等客户端本地设置）。

    keep_layout=True 时跳过 TimeLayouts 合并（只改课表，不动作息）。
    """
    out = json.loads(json.dumps(base))  # 深拷贝

    # 科目：新增，同名复用已有 GUID（避免课表引用断掉）
    for k, v in new["Subjects"].items():
        if k in out["Subjects"]:
            continue
        dup = next((ek for ek, ev in out["Subjects"].items()
                    if ev.get("Name") == v.get("Name")), None)
        if dup:
            continue
        out["Subjects"][k] = v

    if not keep_layout:
        for k, v in new["TimeLayouts"].items():
            out.setdefault("TimeLayouts", {})[k] = v

    gid = new["SelectedClassPlanGroupId"]
    grp = (new.get("ClassPlanGroups") or {}).get(gid, {})
    for k, v in new["ClassPlans"].items():
        out.setdefault("ClassPlans", {})[k] = v
    out.setdefault("ClassPlanGroups", {})
    out["ClassPlanGroups"][gid] = {"Name": grp.get("Name", "生成的课表群"),
                                   "IsGlobal": False, "IsActive": False}
    out["SelectedClassPlanGroupId"] = gid

    # 多周轮换在 DefaultSettings.json，不在档案里 → 返回提醒
    return out


def _load_json(v: str) -> dict:
    """接受 JSON 字符串或文件路径。PowerShell 传含中文/嵌套引号的 JSON 会被吃掉，
    所以支持直接给文件路径。用 utf-8-sig 兼容 PowerShell 写出的 BOM。"""
    if os.path.isfile(v):
        return json.loads(open(v, "rb").read().decode("utf-8-sig"))
    return json.loads(v)


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser(description="生成 ClassIsland 课表档案")
    ap.add_argument("--out", default="dist/ci-profile-sample.json")
    ap.add_argument("--merge", help="合并进这个现有档案")
    ap.add_argument("--keep-layout", action="store_true", help="合并不动作息")
    ap.add_argument("--print-profile", action="store_true")
    ap.add_argument("--check-only", action="store_true")
    ap.add_argument("--group", default="8班课表群")
    ap.add_argument("--schedule", help='JSON 字符串 {"1":["语文",...],"5":[...]}')
    ap.add_argument("--cycle", type=int, default=2)
    # 集控模式
    ap.add_argument("--mode", choices=["profile", "mgmt"], default="profile",
                    help="profile=只生成档案(默认)；mgmt=生成全套集控文件")
    ap.add_argument("--base-url", default="https://update.example.edu/ci",
                    help="集控静态托管根 URL")
    ap.add_argument("--manifest-name", default="manifest.json")
    ap.add_argument("--classes", help='JSON: {"8-1":"8班课表群","8-2":"8班课表群"}')
    ap.add_argument("--versions", help='JSON: {"ClassPlanSource":1,"TimeLayoutSource":1,'
                    '"SubjectsSource":1,"PolicySource":1}（必须显式指定）')
    ap.add_argument("--preset-out", help="ManagementPreset.json 输出路径")
    ap.add_argument("--overrides", help='JSON 或文件: {班级ID: {"group_name":,"schedule":,"timelayout":}}')
    a = ap.parse_args()

    sched = json.loads(a.schedule) if a.schedule else None
    prof = make_profile(group_names=(a.group,), schedule=sched, cycle=a.cycle)
    errs = validate(prof)
    if errs:
        print("!! 档案校验失败:")
        for e in errs:
            print(f"   - {e}")
        return 1
    print(f"档案校验通过: {len(prof['ClassPlans'])} 课表 / "
          f"{sum(len(v['Layouts']) for v in prof['TimeLayouts'].values())} 时间点 / "
          f"{len(prof['Subjects'])} 科目")

    if a.check_only:
        return 0

    if a.merge:
        if not os.path.exists(a.merge):
            print(f"找不到 {a.merge}")
            return 2
        base = json.loads(open(a.merge, "rb").read().decode("utf-8-sig"))
        prof = merge_into(base, prof, keep_layout=a.keep_layout)

    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(prof, f, ensure_ascii=False, indent=2)
    print(f"已写入 {a.out} ({os.path.getsize(a.out)} B)")

    if a.print_profile:
        print(json.dumps(prof, ensure_ascii=False, indent=2))

    if a.mode == "profile":
        return 0

    # ---- 集控模式：生成 ManagementPreset.json + manifest.json + 拆分资源 ----
    base = a.base_url.rstrip("/")
    classes = _load_json(a.classes) if a.classes else None
    overrides = _load_json(a.overrides) if a.overrides else None
    parts = split_profile(prof, base, per_class=classes)

    versions = {"ClassPlanSource": 1, "TimeLayoutSource": 1,
                "SubjectsSource": 1, "PolicySource": 1,
                "DefaultSettingsSource": 1}
    if a.versions:
        versions.update(json.loads(a.versions))

    man = manifest(
        sources={
            "ClassPlanSource": parts["ClassPlanSource"]["_url"],
            "TimeLayoutSource": parts["TimeLayoutSource"]["_url"],
            "SubjectsSource": parts["SubjectsSource"]["_url"],
            "PolicySource": f"{base}/policy.json",
            "DefaultSettingsSource": f"{base}/settings.json",
        },
        versions=versions,
    )
    if classes:
        per_class = per_class_files(prof, classes)

    def w(path: str, obj) -> None:
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        print(f"  {path} ({os.path.getsize(path)} B)")

    print("\n=== 集控文件 ===")
    root_out = os.path.dirname(a.out) or "."
    w(os.path.join(root_out, "manifest.json"), man)

    preset = management_preset(
        f"{base}/{a.manifest_name}",
        a.group.replace("课表群", "").strip(),
    )
    preset_path = a.preset_out or os.path.join(root_out, "ManagementPreset.json")
    w(preset_path, preset)

    filename_of = {
        "ClassPlanSource": "classplans.json",
        "TimeLayoutSource": "timelayouts.json",
        "SubjectsSource": "subjects.json",
    }
    for key in filename_of:
        src = parts[key]
        w(os.path.join(root_out, filename_of[key]),
          {k: v for k, v in src.items() if not k.startswith("_")})

    if classes:
        for cid, cp_file in per_class.items():
            w(os.path.join(root_out, cid, "classplans.json"),
              {k: v for k, v in cp_file.items() if not k.startswith("_")})
        print(f"  ({len(classes)} 个班级的课表已按 {{id}} 模板切分)")

    print("\n⚠️  缓存陷阱: 修改资源内容后必须 bump manifest 里的 Version，")
    print("    否则教室机不会更新（官方文档明确的已知坑）。用 bump_version() 或 --versions。")
    print("\n部署:")
    print("  1. manifest.json + 拆分资源 -> 静态托管到基 URL")
    print("  2. ManagementPreset.json -> 每台教室机的 ClassIsland 【安装目录】")
    print("  3. 每台设备填不同的 ClassIdentity (id)，即可按班级拉不同课表")
    return 0


# ============================================================
# 集控层：ManagementPreset.json + manifest.json + 资源拆分
#
# 参考: https://docs.classisland.tech/management/configure.html
#       https://docs.classisland.tech/management/tutorial-create-management-config/
# ============================================================

def management_preset(manifest_url: str, class_identity: str = "") -> dict:
    """客户端集控配置（放在 ClassIsland 【安装目录】，不是 data 目录）。

    客户端启动/进入「加入集控」时自动加载此文件。
    ManagementServerKind: 0=静态托管配置文件, 1=集控服务器(🚧官方标注"正在开发")
    """
    return {"ManagementServerKind": 0, "ManagementServer": "",
            "ManagementServerGrpc": "", "ManifestUrlTemplate": manifest_url,
            "ClassIdentity": class_identity}


def manifest(*, sources: dict[str, str], versions: dict[str, int],
             organization_name: str = "星集控",
             core_version: str = "2.0.0.0") -> dict:
    """集控清单（索引文件）。引用资源源的 URL + 版本号。

    sources:  {源名: URL}   例 {"ClassPlanSource": "https://.../{id}/classplans.json"}
    versions: {源名: 版本号} 例 {"ClassPlanSource": 2}
    两者必须一一对应 —— 缺任何一边直接报错，不留隐式默认。

    ⚠️ 缓存陷阱（官方原话）：
    "在修改这些字段的 url，或者这些字段的 url 指向的内容时，请务必记得增加版本数，
     否则 ClassIsland 实例可能不会更新这些数据。"

    这就是「教室机不更新」最常见的根因——内容改了但 Version 没 bump。

    URL 支持 {id}（客户端自定义 ID）/ {cuid}（唯一客户端 ID）模板，
    用于按班级分发不同课表：.../classplans.json -> .../{id}/classplans.json
    """
    miss_s = set(versions) - set(sources)
    miss_v = set(sources) - set(versions)
    if miss_s or miss_v:
        raise ValueError(f"sources 与 versions 不一致: "
                         f"仅 sources 有={sorted(miss_v)} 仅 versions 有={sorted(miss_s)}")
    out: dict = {"ServerKind": 0, "CoreVersion": core_version,
                 "OrganizationName": organization_name}
    for key, url in sources.items():
        out[key] = {"Value": url, "Version": versions[key]}
    return out


def split_profile(prof: dict, base_url: str, per_class: dict[str, dict] | None = None
                  ) -> dict[str, dict]:
    """把档案拆成 3 个可独立分发的文件（课表/时间表/科目）。

    官方说明：拆分文件仍是档案文件格式，"加载时只会加载相应的部分"，
    其余字段留 {} 即可。CIMS-backend\\seed_resources\\ 里那 5 个分离文件
    就是这个形态。

    per_class: {班级ID: 该班级的 ClassPlans 字典}。传入后 ClassPlanSource
    应使用 {id} 模板 URL，每台设备拉自己的课表。

    返回: {"ClassPlanSource": {...}, "TimeLayoutSource": {...},
           "SubjectsSource": {...}}，值即 ReVersionString。
    """
    per_class = per_class or {}
    cp_url = f"{base_url}/{{id}}/classplans.json" if per_class else f"{base_url}/classplans.json"

    return {
        "ClassPlanSource": {
            "Name": prof.get("Name", ""),
            "TimeLayouts": {},
            "ClassPlans": prof["ClassPlans"],
            "Subjects": {},
            "_url": cp_url,
        },
        "TimeLayoutSource": {
            "Name": prof.get("Name", ""),
            "TimeLayouts": prof["TimeLayouts"],
            "ClassPlans": {},
            "Subjects": {},
            "_url": f"{base_url}/timelayouts.json",
        },
        "SubjectsSource": {
            "Name": prof.get("Name", ""),
            "TimeLayouts": {},
            "ClassPlans": {},
            "Subjects": prof["Subjects"],
            "_url": f"{base_url}/subjects.json",
        },
    }


def per_class_files(prof: dict, classes: dict[str, str] | None = None,
                    group_name: str = "8班",
                    overrides: dict[str, dict] | None = None) -> dict[str, dict]:
    """按班级切分课表（配合 manifest 里的 {id} 模板用）。

    classes:    {班级ID: 班级组名}，键对应 ClassPlanGroups 里群的 Name。
    overrides:  {班级ID: {"group_name": 群名, "schedule": 课表, "timelayout": 作息}}
                传 schedule/timelayout 的班级获得专属课表与作息，用于同校不同作息场景。

    返回的每个文件仍是完整档案格式（TimeLayouts/ClassPlans/Subjects 三块），
    加载时只取需要的那块。Subjects 与档案共享同一份 GUID，保证引用不断。
    """
    classes = classes or {}
    overrides = overrides or {}
    groups = prof.get("ClassPlanGroups") or {}
    out: dict[str, dict] = {}

    for cid in sorted(set(classes) | set(overrides)):
        ov = overrides.get(cid) or {}
        gname = ov.get("group_name") or classes.get(cid) or group_name
        gid = next((k for k, v in groups.items()
                    if v.get("Name") == gname), ZERO)

        if ov.get("schedule") is not None:
            # 自定义课表：必须配自定义作息，硬性校验科目数 == TimeType==0 数
            tl_src = ov.get("timelayout") or {}
            if not tl_src:
                raise ValueError(f"班级 {cid}: 传了 schedule 但没传 timelayout")
            cp_map: dict[str, dict] = {}
            for k, lay in tl_src.items():
                d = lay.get("_weekDay")
                if d is None:
                    continue
                n0 = len([x for x in lay["Layouts"] if x["TimeType"] == 0])
                subj_names = (ov["schedule"].get(d) or ov["schedule"].get(1) or [])
                if len(subj_names) != n0:
                    raise ValueError(
                        f"班级 {cid} 星期{d}: 科目 {len(subj_names)} 节 != "
                        f"该作息 {n0} 节 —— 教室机课表会静默空白")
                cp_map[gu()] = {
                    "TimeLayoutId": k,
                    "TimeRule": {"WeekDay": d, "WeekCountDiv": 0,
                                 "WeekCountDivTotal": 1, "IsActive": False},
                    "Classes": [{"SubjectId": next(
                        (sk for sk, sv in prof["Subjects"].items()
                         if sv["Name"] == s), ZERO),
                        "IsChangedClass": False, "AttachedObjects": {},
                        "IsEnabled": True, "IsActive": False} for s in subj_names],
                    "Name": f"周{d}", "IsOverlay": False, "OverlaySourceId": None,
                    "OverlaySetupTime": None, "IsEnabled": True,
                    "AssociatedGroup": gid, "AttachedObjects": {}, "IsActive": False,
                }
            # 清掉内部标记 _weekDay
            tl_out = {k: {kk: vv for kk, vv in v.items() if not kk.startswith("_")}
                      for k, v in tl_src.items()}
        else:
            cp_map = prof["ClassPlans"]
            tl_out = prof["TimeLayouts"]

        # 引用完整性：每个 ClassPlan 的 TimeLayoutId 必须存在
        for k, v in cp_map.items():
            if v["TimeLayoutId"] not in tl_out:
                raise ValueError(
                    f"班级 {cid}: ClassPlan[{v['Name']}] TimeLayoutId={v['TimeLayoutId']} "
                    f"不在该班级的 TimeLayouts 里 → 教室机课表静默空白")

        out[cid] = {"Name": prof.get("Name", ""), "TimeLayouts": tl_out,
                    "ClassPlans": cp_map, "Subjects": prof["Subjects"]}
    return out


def bump_version(old: dict, key: str) -> dict:
    """对某个源做版本自增（改内容后必须调）。"""
    out = json.loads(json.dumps(old))
    src = out.get(key)
    if not isinstance(src, dict) or "Version" not in src:
        raise KeyError(f"manifest 里没有 {key}")
    out[key]["Version"] = src["Version"] + 1
    return out


if __name__ == "__main__":
    sys.exit(main())
