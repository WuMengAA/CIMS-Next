#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
验证 mgmt 模式产出：JSON 内容、拆分结构、中文编码、班级自包含文件。

用法: python tools/ci-profile/verify_mgmt.py [产出目录]
默认: dist/ci-mgmt-sample
"""
import json, sys, os
sys.stdout.reconfigure(encoding="utf-8")

OUT = sys.argv[1] if len(sys.argv) > 1 else r"D:\Stelarith\Stelarith-website\stelarith\dist\ci-mgmt-sample"
ZERO = "00000000-0000-0000-0000-000000000000"  # 36 字符：ClassIsland 的"无科目"占位
fails: list[str] = []


def chk(label, cond, detail=""):
    print(f"  [{'✅' if cond else '❌'}] {label}" + (f"  {detail}" if detail else ""))
    if not cond:
        fails.append(label)


def load(name):
    return json.loads(open(os.path.join(OUT, name), "rb").read().decode("utf-8-sig"))


print(f"=== 产出目录: {OUT}\n")

print("=== 1. 中文编码 ===")
man = load("manifest.json")
chk("manifest.OrganizationName == '星集控'",
    man.get("OrganizationName") == "星集控", repr(man.get("OrganizationName")))
preset = load("ManagementPreset.json")
chk("preset.ClassIdentity == '8班'",
    preset.get("ClassIdentity") == "8班", repr(preset.get("ClassIdentity")))

print("\n=== 2. manifest 结构 ===")
chk("ServerKind == 0", man.get("ServerKind") == 0)
chk("CoreVersion == '2.0.0.0'", man.get("CoreVersion") == "2.0.0.0")
for k in ("ClassPlanSource", "TimeLayoutSource", "SubjectsSource", "PolicySource"):
    s = man.get(k)
    chk(f"{k} 是 ReVersionString",
        isinstance(s, dict) and "Value" in s and "Version" in s and isinstance(s["Version"], int),
        f"Value={s.get('Value') if s else '?'} V{s.get('Version') if s else '?'}")
chk("ClassPlanSource 含 {id} 模板（按班级分发）",
    "{id}" in man.get("ClassPlanSource", {}).get("Value", ""))

print("\n=== 3. ManagementPreset 结构 ===")
chk("ManagementServerKind == 0", preset.get("ManagementServerKind") == 0)
chk("ManifestUrlTemplate 非空", bool(preset.get("ManifestUrlTemplate")))
chk("ManagementServer 空（静态模式）", preset.get("ManagementServer") == "")
chk("ManagementServerGrpc 空（静态模式）", preset.get("ManagementServerGrpc") == "")

print("\n=== 4. 拆分文件：只填目标块 ===")
for f, expect in (("classplans.json", "ClassPlans"),
                  ("timelayouts.json", "TimeLayouts"),
                  ("subjects.json", "Subjects")):
    o = load(f)
    filled = [k for k in ("ClassPlans", "TimeLayouts", "Subjects") if o.get(k)]
    chk(f"{f} 只有 {expect} 有内容", filled == [expect], f"filled={filled}")

print("\n=== 5. 拆分文件交叉校验 ===")
p = load("classplans.json")
tl = load("timelayouts.json")["TimeLayouts"]
subj = load("subjects.json")["Subjects"]

bad = 0
for k, cp in p["ClassPlans"].items():
    tli = cp.get("TimeLayoutId")
    if tli not in tl:
        print(f"      ClassPlan[{cp.get('Name')}] TimeLayoutId={tli} 缺失")
        bad += 1
        continue
    n0 = len([l for l in tl[tli]["Layouts"] if l["TimeType"] == 0])
    nc = len(cp.get("Classes") or [])
    if n0 != nc:
        print(f"      ClassPlan[{cp['Name']}] Classes={nc} != TimeType0={n0}")
        bad += 1
chk("ClassPlan.TimeLayoutId 全部可解析", bad == 0)

bad = 0
for k, cp in p["ClassPlans"].items():
    for i, c in enumerate(cp.get("Classes") or []):
        sid = c.get("SubjectId") or ZERO
        if sid != ZERO and sid not in subj:
            print(f"      ClassPlan[{cp['Name']}] Classes[{i}] SubjectId 悬空")
            bad += 1
chk("0 个悬空 SubjectId", bad == 0)

bad = 0
for _k, llist in tl.items():
    for l in llist["Layouts"]:
        d = l.get("DefaultClassId") or ZERO
        if d != ZERO and d not in subj:
            print(f"      TimeLayout[{l} DefaultClassId={d} 悬空")
            bad += 1
chk("0 个悬空 DefaultClassId", bad == 0)

print("\n=== 6. 班级自包含文件 ===")
class_dirs = sorted(d for d in os.listdir(OUT)
                    if os.path.isdir(os.path.join(OUT, d)) and not d.startswith("_"))
chk("有班级目录", len(class_dirs) >= 1, f"{len(class_dirs)} 个")
for cid in class_dirs:
    f = os.path.join(OUT, cid, "classplans.json")
    o = load(os.path.join(cid, "classplans.json"))
    cp = o["ClassPlans"]
    tl_c = o.get("TimeLayouts") or {}
    subj_c = o.get("Subjects") or {}
    bad = 0
    for _k, v in cp.items():
        if v["TimeLayoutId"] not in tl_c:
            bad += 1
    for v in cp.values():
        for c in v.get("Classes") or []:
            sid = c.get("SubjectId") or ZERO
            if sid != ZERO and sid not in subj_c:
                bad += 1
    chk(f"{cid}: {len(cp)} 课表 / {len(tl_c)} 作息 / {len(subj_c)} 科目，引用完整", bad == 0)

print("\n=== 7. bump_version 单元测试 ===")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_ci_profile as g

m = {"ClassPlanSource": {"Value": "https://x/a.json", "Version": 3}}
b = g.bump_version(m, "ClassPlanSource")
chk("bump_version 递增 3->4", b["ClassPlanSource"]["Version"] == 4, f"got {b['ClassPlanSource']['Version']}")
chk("bump_version 不改原对象", m["ClassPlanSource"]["Version"] == 3)
try:
    g.bump_version(m, "NoSuchSource")
    chk("bump_version 对不存在源应抛错", False)
except KeyError:
    chk("bump_version 对不存在源抛 KeyError", True)

# sources/versions 一致性检查
try:
    g.manifest(sources={"A": "u"}, versions={"A": 1, "B": 2})
    chk("manifest 拒绝不一致的 versions", False)
except ValueError:
    chk("manifest 拒绝不一致的 versions", True)

print("\n=== 8. 档案自校验回归 ===")
prof = g.make_profile(group_names=("8班课表群",))
chk("make_profile 校验通过", g.validate(prof) == [], f"{len(g.validate(prof))} 个错误")

print("\n" + "=" * 52)
if fails:
    print(f"❌ {len(fails)} 项失败:")
    for f in fails:
        print(f"   - {f}")
    sys.exit(1)
print("✅ 全部通过")
