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
    return 0


if __name__ == "__main__":
    sys.exit(main())
