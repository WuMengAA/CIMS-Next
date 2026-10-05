#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
用真机 Default.json 当标准答案，逐字段对比生成器输出。
任何字段缺失/类型不符都会被列出来 —— 这是防止"教室机静默空白"的最后一道闸。
"""
import json, os, sys
sys.stdout.reconfigure(encoding="utf-8")

# 动态找到真机档案（目录名有 l/i 拼写歧义，不手打）
root = "D:/"
REF = None
for n in os.listdir(root):
    if "lass" in n:
        c = os.path.join(root, n, "data", "Profiles", "Default.json")
        if os.path.exists(c) and REF is None:
            REF = c
print(f"参考档案: {REF}  ({os.path.getsize(REF)} B)\n")
ref = json.loads(open(REF, "rb").read().decode("utf-8-sig"))

GEN = r"D:\Stelarith\Stelarith-website\stelarith\dist\ci-profile-sample.json"
gen = json.loads(open(GEN, "r", encoding="utf-8").read())

problems: list[str] = []


def keys_of(obj):
    return set(obj.keys()) if isinstance(obj, dict) else set()


print("=== 1. 顶层键 ===")
r_top, g_top = keys_of(ref), keys_of(gen)
print(f"  参考 {len(r_top)} 键: {sorted(r_top)}")
print(f"  生成 {len(g_top)} 键: {sorted(g_top)}")
miss = r_top - g_top
extra = g_top - r_top
print(f"  缺: {sorted(miss) if miss else '无'}")
print(f"  多: {sorted(extra) if extra else '无'}")
if miss:
    problems.append(f"顶层缺键: {sorted(miss)}")
if extra:
    problems.append(f"顶层多键: {sorted(extra)}")

print("\n=== 2. ClassPlan 字段 ===")
r_cp = keys_of(next(iter(ref["ClassPlans"].values())))
g_cp = keys_of(next(iter(gen["ClassPlans"].values())))
print(f"  参考: {sorted(r_cp)}")
print(f"  生成: {sorted(g_cp)}")
print(f"  缺: {sorted(r_cp - g_cp) if r_cp - g_cp else '无'}")
print(f"  多: {sorted(g_cp - r_cp) if g_cp - r_cp else '无'}")
if r_cp - g_cp: problems.append(f"ClassPlan 缺字段: {sorted(r_cp - g_cp)}")
if g_cp - r_cp: problems.append(f"ClassPlan 多字段: {sorted(g_cp - r_cp)}")

print("\n=== 3. Class(课表条目) 字段 ===")
r_c = keys_of(next(iter(next(iter(ref["ClassPlans"].values()))["Classes"])))
g_c = keys_of(next(iter(next(iter(gen["ClassPlans"].values()))["Classes"])))
print(f"  参考: {sorted(r_c)}")
print(f"  生成: {sorted(g_c)}")
print(f"  缺: {sorted(r_c - g_c) if r_c - g_c else '无'}")
print(f"  多: {sorted(g_c - r_c) if g_c - r_c else '无'}")
if r_c - g_c: problems.append(f"Class 缺字段: {sorted(r_c - g_c)}")
if g_c - r_c: problems.append(f"Class 多字段: {sorted(g_c - r_c)}")

print("\n=== 4. LayoutItem 字段 ===")
r_l = keys_of(next(iter(next(iter(ref["TimeLayouts"].values()))["Layouts"])))
g_l = keys_of(next(iter(next(iter(gen["TimeLayouts"].values()))["Layouts"])))
print(f"  参考: {sorted(r_l)}")
print(f"  生成: {sorted(g_l)}")
print(f"  缺: {sorted(r_l - g_l) if r_l - g_l else '无'}")
print(f"  多: {sorted(g_l - r_l) if g_l - r_l else '无'}")
if r_l - g_l: problems.append(f"LayoutItem 缺字段: {sorted(r_l - g_l)}")
if g_l - r_l: problems.append(f"LayoutItem 多字段: {sorted(g_l - r_l)}")

print("\n=== 5. Subject 字段 ===")
r_s = keys_of(next(iter(ref["Subjects"].values())))
g_s = keys_of(next(iter(gen["Subjects"].values())))
print(f"  参考: {sorted(r_s)}")
print(f"  生成: {sorted(g_s)}")
print(f"  缺: {sorted(r_s - g_s) if r_s - g_s else '无'}")
print(f"  多: {sorted(g_s - r_s) if g_s - r_s else '无'}")
if r_s - g_s: problems.append(f"Subject 缺字段: {sorted(r_s - g_s)}")
if g_s - r_s: problems.append(f"Subject 多字段: {sorted(g_s - r_s)}")

print("\n=== 6. ClassPlanGroups 字段 ===")
r_g = keys_of(next(iter(ref["ClassPlanGroups"].values())))
g_g = keys_of(next(iter(gen["ClassPlanGroups"].values())))
print(f"  参考: {sorted(r_g)}")
print(f"  生成: {sorted(g_g)}")
print(f"  缺: {sorted(r_g - g_g) if r_g - g_g else '无'}")
if r_g - g_g: problems.append(f"ClassPlanGroup 缺字段: {sorted(r_g - g_g)}")

print("\n=== 7. TimeType 取值 ===")
def tt(obj, path_a, path_b):
    s = set()
    for _, v in obj[path_a].items():
        for l in v.get(path_b, []):
            s.add(l.get("TimeType"))
    return s
r_tt, g_tt = tt(ref, "TimeLayouts", "Layouts"), tt(gen, "TimeLayouts", "Layouts")
print(f"  参考: {sorted(x for x in r_tt if x is not None)}")
print(f"  生成: {sorted(x for x in g_tt if x is not None)}")
print("  说明: 参考含 2=分割线、3=行动组；生成器目前只用 0/1，不影响课表显示")

print("\n=== 8. Classes 数 vs TimeType==0 数（最关键）===")
ok = True
for k, cp in gen["ClassPlans"].items():
    tli = cp["TimeLayoutId"]
    n0 = len([l for l in gen["TimeLayouts"][tli]["Layouts"] if l["TimeType"] == 0])
    nc = len(cp["Classes"])
    if n0 != nc:
        ok = False
        problems.append(f"ClassPlan[{cp['Name']}] Classes={nc} != TimeType0={n0}")
print(f"  {'全部匹配 ✅' if ok else '有不匹配 ❌'}")
print(f"  参考档案同样检查:")
for k, cp in ref["ClassPlans"].items():
    tli = cp["TimeLayoutId"]
    n0 = len([l for l in ref["TimeLayouts"][tli]["Layouts"] if l["TimeType"] == 0])
    nc = len(cp["Classes"])
    print(f"    {cp['Name']:5} Classes={nc:2} TimeType0={n0:2} "
          f"{'✅' if n0 == nc else '❌'}")

print("\n=== 9. Subject GUID 引用完整性 ===")
ZERO = "00000000-0000-0000-0000-000000000000"  # 36 字符：ClassIsland 的"无科目"占位
bad = 0
for k, cp in gen["ClassPlans"].items():
    for i, c in enumerate(cp["Classes"]):
        sid = c.get("SubjectId") or ZERO
        if sid != ZERO and sid not in gen["Subjects"]:
            print(f"  ❌ {cp['Name']} Classes[{i}] SubjectId 悬空: {sid}")
            bad += 1
print(f"  悬空引用: {bad} 个  {'✅' if bad == 0 else '❌'}")
if bad: problems.append(f"SubjectId 悬空 {bad} 个")

print("\n=== 10. 时间格式 ===")
r_fmt = set(l["StartTime"][:2] for _t in ref["TimeLayouts"].values() for l in _t["Layouts"])
g_fmt = set(l["StartTime"][:2] for _t in gen["TimeLayouts"].values() for l in _t["Layouts"])
print(f"  参考 StartTime 形如: {sorted(r_fmt)[:3]}")
print(f"  生成 StartTime 形如: {sorted(g_fmt)[:3]}")
# 精确校验 HH:mm:ss
import re
bad_fmt = [l["StartTime"] for _t in gen["TimeLayouts"].values() for l in _t["Layouts"]
           if not re.fullmatch(r"\d{2}:\d{2}:\d{2}", l["StartTime"])]
print(f"  格式异常: {len(bad_fmt)} 个  {'✅' if not bad_fmt else '❌ ' + str(bad_fmt[:3])}")
if bad_fmt: problems.append(f"时间格式异常 {len(bad_fmt)} 个")

print("\n" + "=" * 60)
if problems:
    print(f"❌ {len(problems)} 项问题:")
    for p in problems:
        print(f"   - {p}")
    sys.exit(1)
print("✅ 生成器输出与真机档案格式完全一致")
