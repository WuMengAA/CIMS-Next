#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""端到端解析验证。

⚠️ 安全约束（铁律 4）：
  - 不启动 ClassIsland.exe —— 会污染真机数据目录
  - 不修改 D:\\Classlsand\\ 下任何文件
  - 只读真机数据目录做格式对照

验证分层：
  1. JSON 可解析性 + 编码正确（UTF-8/UTF-8-BOM）
  2. 必填字段齐全 + 类型正确（vs 真机 2.1.0.1 档案）
  3. 交叉引用完整（SubjectId/TimeLayoutId/AssociatedGroup/DefaultClassId 全部可解析）
  4. 数量约束（Classes 数 == TimeType==0 数）
  5. 真机兼容：生成的档案能被真机档案的字段集合覆盖（即字段都在真机见过）
"""
import json, os, re, sys
sys.stdout.reconfigure(encoding="utf-8")

OUT = sys.argv[1] if len(sys.argv) > 1 else r"D:\Stelarith\Stelarith-website\stelarith\dist\ci-mgmt-sample"
ZERO = "00000000-0000-0000-0000-000000000000"

# 真机参考档案（动态枚举，避免手打拼写歧义）
root = "D:/"
names = [n for n in os.listdir(root) if "lass" in n]
REF = None
for n in names:
    cand = os.path.join(root, n, "data", "Profiles", "Default.json")
    if os.path.exists(cand) and REF is None:
        REF = cand

fails: list[str] = []


def chk(label, cond, detail=""):
    print(f"  [{'✅' if cond else '❌'}] {label}" + (f"  {detail}" if detail else ""))
    if not cond:
        fails.append(label)


def load(name):
    p = os.path.join(OUT, name)
    if not os.path.isfile(p):
        chk(f"{name} 存在", False)
        return None
    return json.loads(open(p, "rb").read().decode("utf-8-sig"))


print(f"=== 验证目录: {OUT}\n")

# ============================================================
# 1. 档案解析
# ============================================================
print("=== 1. 档案文件解析 ===")
prof = load("ci-profile.json")
if prof:
    chk("档案 JSON 可解析", isinstance(prof, dict))
    chk("档案有 Id 字段", bool(prof.get("Id")) and prof["Id"] != ZERO)

# 真机参考
print(f"\n=== 2. vs 真机档案 {REF}")
ref = None
if REF:
    ref = json.loads(open(REF, "rb").read().decode("utf-8-sig"))
    print(f"  真机档案 {os.path.getsize(REF)}B, {len(ref)} 顶层键")

    # 顶层键对照
    r_top = set(ref.keys())
    g_top = set(prof.keys()) if prof else set()
    miss = r_top - g_top
    extra = g_top - r_top
    chk("顶层键无缺失", not miss, f"缺 {sorted(miss)}" if miss else "17/17")
    chk("顶层键无多余", not extra, f"多 {sorted(extra)}" if extra else "无多余")

    # ClassPlan 字段
    r_cp = set(next(iter(ref["ClassPlans"].values())).keys())
    g_cp = set(next(iter(prof["ClassPlans"].values())).keys())
    chk("ClassPlan 字段集合一致", r_cp == g_cp,
        f"缺 {sorted(r_cp-g_cp)} 多 {sorted(g_cp-r_cp)}" if r_cp != g_cp else f"{len(r_cp)} 字段")

    # Class 字段
    r_c = set(next(iter(next(iter(ref["ClassPlans"].values()))["Classes"])).keys())
    g_c = set(next(iter(next(iter(prof["ClassPlans"].values()))["Classes"])).keys())
    chk("Class 字段集合一致", r_c == g_c,
        f"缺 {sorted(r_c-g_c)} 多 {sorted(g_c-r_c)}" if r_c != g_c else f"{len(r_c)} 字段")

    # LayoutItem 字段
    r_l = set(next(iter(next(iter(ref["TimeLayouts"].values()))["Layouts"])).keys())
    g_l = set(next(iter(next(iter(prof["TimeLayouts"].values()))["Layouts"])).keys())
    chk("LayoutItem 字段集合一致", r_l == g_l,
        f"缺 {sorted(r_l-g_l)} 多 {sorted(g_l-r_l)}" if r_l != g_l else f"{len(r_l)} 字段")

    # Subject 字段
    r_s = set(next(iter(ref["Subjects"].values())).keys())
    g_s = set(next(iter(prof["Subjects"].values())).keys())
    chk("Subject 字段集合一致", r_s == g_s,
        f"缺 {sorted(r_s-g_s)} 多 {sorted(g_s-r_s)}" if r_s != g_s else f"{len(r_s)} 字段")

    # ClassPlanGroups 字段
    r_g = set(next(iter(ref["ClassPlanGroups"].values())).keys())
    g_g = set(next(iter(prof["ClassPlanGroups"].values())).keys())
    chk("ClassPlanGroups 字段集合一致", r_g == g_g,
        f"缺 {sorted(r_g-g_g)}" if r_g != g_g else f"{len(r_g)} 字段")
else:
    chk("找到真机参考档案", False)

# ============================================================
# 3. 交叉引用完整性
# ============================================================
print("\n=== 3. 交叉引用完整性 ===")
if prof:
    subj = prof.get("Subjects", {})
    tl = prof.get("TimeLayouts", {})
    cp = prof.get("ClassPlans", {})
    grp = prof.get("ClassPlanGroups", {})

    # ClassPlan.TimeLayoutId
    bad = 0
    for k, v in cp.items():
        if v.get("TimeLayoutId") not in tl:
            print(f"      ClassPlan[{v.get('Name')}] TimeLayoutId={v.get('TimeLayoutId')} 缺失")
            bad += 1
    chk(f"ClassPlan.TimeLayoutId 全部可解析 ({len(cp)} 个课表)", bad == 0)

    # ClassPlan.AssociatedGroup
    bad = 0
    for k, v in cp.items():
        if v.get("AssociatedGroup") not in grp:
            print(f"      ClassPlan[{v.get('Name')}] AssociatedGroup={v.get('AssociatedGroup')} 缺失")
            bad += 1
    chk("ClassPlan.AssociatedGroup 全部可解析", bad == 0)

    # Class.SubjectId
    bad = 0
    total = 0
    for k, v in cp.items():
        for c in v.get("Classes", []):
            total += 1
            sid = c.get("SubjectId") or ZERO
            if sid != ZERO and sid not in subj:
                print(f"      ClassPlan[{v['Name']}] SubjectId={sid} 悬空")
                bad += 1
    chk(f"Class.SubjectId 全部可解析 ({total} 节课)", bad == 0)

    # LayoutItem.DefaultClassId
    bad = 0
    for k, v in tl.items():
        for l in v.get("Layouts", []):
            d = l.get("DefaultClassId") or ZERO
            if d != ZERO and d not in subj:
                print(f"      TimeLayout[{v['Name']}] DefaultClassId={d} 悬空")
                bad += 1
    chk("LayoutItem.DefaultClassId 全部可解析", bad == 0)

# ============================================================
# 4. 数量约束（最容易炸的静默空白坑）
# ============================================================
print("\n=== 4. 数量约束 ===")
if prof:
    bad = 0
    for k, cp in prof["ClassPlans"].items():
        tli = cp["TimeLayoutId"]
        if tli not in tl:
            continue
        n0 = len([l for l in tl[tli]["Layouts"] if l["TimeType"] == 0])
        nc = len(cp["Classes"])
        if n0 != nc:
            print(f"      ❌ ClassPlan[{cp['Name']}] Classes={nc} != TimeType0={n0} → 教室机静默空白")
            bad += 1
    chk("Classes 数 == TimeType==0 数（所有课表）", bad == 0,
        f"{len(prof['ClassPlans'])} 个课表全过" if bad == 0 else f"{bad} 个不匹配")

    # 真机参考对照
    if ref:
        bad_ref = 0
        for k, v in ref["ClassPlans"].items():
            tli = v["TimeLayoutId"]
            n0 = len([l for l in ref["TimeLayouts"][tli]["Layouts"] if l["TimeType"] == 0])
            nc = len(v["Classes"])
            if n0 != nc:
                bad_ref += 1
        chk(f"真机参考同样检查 ({len(ref['ClassPlans'])} 课表)", bad_ref == 0)

# ============================================================
# 5. 时间格式
# ============================================================
print("\n=== 5. 时间格式 ===")
if prof:
    bad = 0
    for k, v in prof["TimeLayouts"].items():
        for l in v["Layouts"]:
            if not re.fullmatch(r"\d{2}:\d{2}:\d{2}", l["StartTime"]):
                print(f"      StartTime={l['StartTime']} 格式异常")
                bad += 1
            if not re.fullmatch(r"\d{2}:\d{2}:\d{2}", l["EndTime"]):
                print(f"      EndTime={l['EndTime']} 格式异常")
                bad += 1
    chk("所有 StartTime/EndTime 为 HH:mm:ss", bad == 0)

# ============================================================
# 6. 班级自包含文件
# ============================================================
print("\n=== 6. 班级自包含文件 ===")
class_dirs = sorted(d for d in os.listdir(OUT)
                    if os.path.isdir(os.path.join(OUT, d)) and not d.startswith("_"))
chk("有班级目录", len(class_dirs) >= 1, f"{len(class_dirs)} 个")
for cid in class_dirs:
    o = load(f"{cid}/classplans.json")
    if not o:
        continue
    cp_c = o.get("ClassPlans", {})
    tl_c = o.get("TimeLayouts", {})
    subj_c = o.get("Subjects", {})
    bad = 0
    for k, v in cp_c.items():
        if v.get("TimeLayoutId") not in tl_c:
            print(f"      {cid} ClassPlan[{v['Name']}] TimeLayoutId 缺失")
            bad += 1
        for c in v.get("Classes", []):
            sid = c.get("SubjectId") or ZERO
            if sid != ZERO and sid not in subj_c:
                bad += 1
    # 数量约束
    for k, v in cp_c.items():
        if v.get("TimeLayoutId") not in tl_c:
            continue
        n0 = len([l for l in tl_c[v["TimeLayoutId"]]["Layouts"] if l["TimeType"] == 0])
        nc = len(v["Classes"])
        if n0 != nc:
            print(f"      {cid} ClassPlan[{v['Name']}] Classes={nc} != TimeType0={n0}")
            bad += 1
    chk(f"{cid}: {len(cp_c)} 课表 / {len(tl_c)} 作息 / {len(subj_c)} 科目，引用+数量完整", bad == 0)

# ============================================================
# 7. Policy
# ============================================================
print("\n=== 7. Policy ===")
pol = load("policy.json")
if pol:
    required = ["DisableProfileClassPlanEditing", "DisableProfileTimeLayoutEditing",
                "DisableProfileSubjectsEditing", "DisableProfileEditing",
                "DisableSettingsEditing", "DisableSplashCustomize", "DisableDebugMenu",
                "AllowExitManagement", "DisableEasterEggs", "IsActive"]
    miss = [k for k in required if k not in pol]
    chk("Policy 10 字段齐全", not miss, f"缺 {miss}" if miss else "10/10")
    type_bad = [k for k, v in pol.items() if not isinstance(v, bool)]
    chk("Policy 所有值为 bool", not type_bad, f"异常 {type_bad}" if type_bad else "")

# ============================================================
# 8. Credentials
# ============================================================
print("\n=== 8. Credentials ===")
cred = load("credentials.json")
if cred:
    required = ["UserCredential", "AdminCredential",
                "EditAuthorizeSettingsAuthorizeLevel", "EditPolicyAuthorizeLevel",
                "ExitManagementAuthorizeLevel", "EditProfileAuthorizeLevel",
                "EditSettingsAuthorizeLevel", "ExitApplicationAuthorizeLevel",
                "ChangeLessonsAuthorizeLevel", "IsActive"]
    miss = [k for k in required if k not in cred]
    chk("Credentials 10 字段齐全", not miss, f"缺 {miss}" if miss else "10/10")

# ============================================================
# 9. Settings.json（merge 验证）
# ============================================================
print("\n=== 9. Settings.json ===")
st = load("settings.json")
if st:
    chk("Settings.json 可解析", isinstance(st, dict))
    # 关键字段
    for k in ("SelectedProfile", "SingleWeekStartTime", "MultiWeekRotationMaxCycle",
              "MultiWeekRotationOffset", "TrustedProfileIds", "RefreshingScopes"):
        chk(f"Settings.{k} 存在", k in st)
    # TrustedProfileIds 包含档案 Id
    if prof:
        pid = prof.get("Id")
        chk(f"档案 Id {pid[:8]}... 在 TrustedProfileIds", pid in st.get("TrustedProfileIds", []))
    # MultiWeekRotationOffset 长度 5
    off = st.get("MultiWeekRotationOffset")
    chk("MultiWeekRotationOffset 长度 5", isinstance(off, list) and len(off) == 5,
        f"实际 {len(off) if isinstance(off, list) else 'N/A'}")
    # RefreshingScopes
    rs = st.get("RefreshingScopes")
    if isinstance(rs, dict):
        for k in ("Profile", "ProfileClassPlans", "ProfileTimeLayouts",
                  "Components", "Automations", "Plugins"):
            chk(f"RefreshingScopes.{k} 为 bool", isinstance(rs.get(k), bool))

# ============================================================
# 10. ManagementPreset
# ============================================================
print("\n=== 10. ManagementPreset ===")
mp = load("ManagementPreset.json")
if mp:
    chk("ManagementServerKind == 0", mp.get("ManagementServerKind") == 0)
    chk("ManifestUrlTemplate 非空", bool(mp.get("ManifestUrlTemplate")))
    chk("ManagementServer 空（静态模式）", mp.get("ManagementServer") == "")
    chk("ManagementServerGrpc 空（静态模式）", mp.get("ManagementServerGrpc") == "")

# ============================================================
# 11. manifest
# ============================================================
print("\n=== 11. manifest ===")
man = load("manifest.json")
if man:
    chk("ServerKind == 0", man.get("ServerKind") == 0)
    chk("CoreVersion 存在", bool(man.get("CoreVersion")))
    chk("OrganizationName 存在", bool(man.get("OrganizationName")))
    for k in ("ClassPlanSource", "TimeLayoutSource", "SubjectsSource",
              "PolicySource", "DefaultSettingsSource"):
        s = man.get(k)
        chk(f"{k} 是 ReVersionString",
            isinstance(s, dict) and "Value" in s and "Version" in s,
            f"V{s.get('Version') if isinstance(s, dict) else '?'}")

# ============================================================
# 结果
# ============================================================
print("\n" + "=" * 52)
if fails:
    print(f"❌ {len(fails)} 项失败:")
    for f in fails:
        print(f"   - {f}")
    sys.exit(1)
print("✅ 全部通过 —— 生成文件可被 ClassIsland 2.1.0.1 解析")
