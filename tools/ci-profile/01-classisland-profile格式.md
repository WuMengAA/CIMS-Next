# ClassIsland 2.x 课表档案格式（真机反解，非文档转述）

> 用途：星集控被控端 / 站点生成课表档案，教室机 ClassIsland 客户端直接消费。
> **格式来源**：`D:\Classlsland\data\Profiles\Default.json`（真机 ClassIsland 2.1.0.1，85,771 B）
> 逐字段反解 + 生成器输出对照验证通过（见 `tools/ci-profile/verify_ci_profile.py`）。
>
> ⚠️ **不是照官方文档猜的**。之前 `school-multimedia-control\classisland-config\` 里的
> `自动化规则-*.json` / `视图配置示例.json` 都带 `_comment` 声明"概念结构，导入前请对照
> schema 校验"——那几份是**猜的**，不能直接用。

---

## 一 文件位置与分发

| 路径 | 内容 | 集控可否覆盖 |
|---|---|---|
| `%LocalAppData%\ClassIsland\data\Profiles\Default.json` | 课表档案（课表/作息/科目） | ✅ 主目标 |
| `%LocalAppData%\ClassIsland\data\Settings.json` | 客户端设置（含多周轮换） | ✅ |
| `%LocalAppData%\ClassIsland\data\Config\Management\Policy.json` | 集控策略（禁用编辑项） | ✅ |
| `%LocalAppData%\ClassIsland\data\Config\Management\Credentials.json` | 集控授权等级 | ✅ |

`Data\` 下还有 `Config\Automations\`、`Config\ComponentLayouts\`、`Config\Plugins\` ——
集控可整目录覆盖。

---

## 二 档案顶层（17 键，一个都不能少）

```
Name, Id, IsActive,
TimeLayouts, ClassPlans, Subjects, ClassPlanGroups, SelectedClassPlanGroupId,
IsOverlayClassPlanEnabled, OverlayClassPlanId,
TempClassPlanId, TempClassPlanSetupTime,
TempClassPlanGroupId, TempClassPlanGroupExpireTime, IsTempClassPlanGroupEnabled,
TempClassPlanGroupType,
OrderedSchedules
```

> `OrderedSchedules` 是**按日期键控的临时课表覆盖**（应对临时调课），留 `{}` 即可。

---

## 三 四张表

### Subjects —— `{GUID: 科目}`

```json
{"Name":"语文","Initial":"语","TeacherName":"","IsOutDoor":false,
 "AttachedObjects":{},"IsActive":false}
```

- `GUID` 用标准小写带连字符 UUID
- **同一科目复用同一 GUID**，课表靠这个引用；重名要判断是否复用，避免课表引用断掉
- `IsOutDoor`=true 表示户外课（体育/军训）

### TimeLayouts —— `{GUID: 作息}`

```json
{
  "IsOverlay": false, "OverlaySourceId": null,
  "Name": "周1234(高二通用)",
  "Layouts": [ ... ],
  "AttachedObjects": {}, "IsActive": false
}
```

#### LayoutItem —— 关键

```json
{
  "StartSecond": "", "EndSecond": "",
  "StartTime": "07:25:00", "EndTime": "08:05:00",
  "TimeType": 0,
  "IsHideDefault": false,
  "DefaultClassId": "00000000-0000-0000-0000-000000000000",
  "BreakName": "", "ActionSet": null,
  "AttachedObjects": {}, "IsActive": false
}
```

| 字段 | 值 | 含义 |
|---|---|---|
| `TimeType` | **0** | 上课 → **这个时间点会被 ClassPlan.Classes 分配科目** |
| `TimeType` | 1 | 课间休息（填 `BreakName`，如"课间"/"眼保健操"） |
| `TimeType` | 2 | 分割线（`StartTime`==`EndTime`，零长度） |
| `TimeType` | 3 | 行动组（挂 `ActionSet`，如"上课自动打铃"） |
| `DefaultClassId` | Subject 的 GUID | **这节课的默认科目**（不是班级！） |
| `DefaultClassId` | `00000000-...` | **全零占位 = 这节课没有默认科目** |

> ⚠️ 一开始误判 `DefaultClassId` 指向班级，实际指向**科目**（Subject）。
> 验证方式：把 5 个真实 GUID 拿去 Subjects 字典里查，全部命中（升旗/数学/自习/早读/课间活动）。

### ClassPlans —— `{GUID: 课表}`

```json
{
  "TimeLayoutId": "48e20dfa-...",          // 指向 TimeLayouts 的 GUID
  "TimeRule": {
    "WeekDay": 1,                          // 1=周一 ... 7=周日
    "WeekCountDiv": 0,                     // 多周轮换：本表在第 N 周生效（0-based）
    "WeekCountDivTotal": 2,                // 轮换周期（2=单双周）
    "IsActive": false
  },
  "Classes": [
    {"SubjectId": "97d0bf3f-...", "IsChangedClass": false,
     "AttachedObjects": {}, "IsEnabled": true, "IsActive": false}
  ],
  "Name": "周一", "IsOverlay": false, "OverlaySourceId": null,
  "OverlaySetupTime": null, "IsEnabled": true,
  "AssociatedGroup": "c990f5a5-...",       // 指向 ClassPlanGroups 的 GUID
  "AttachedObjects": {}, "IsActive": false
}
```

### ClassPlanGroups —— `{GUID: 课表群}`

```json
{
  "00000000-0000-0000-0000-000000000000": {"Name":"全局课表群","IsGlobal":true,"IsActive":false},
  "acaf4ef0-...": {"Name":"默认","IsGlobal":false,"IsActive":false},
  "c990f5a5-...": {"Name":"1班课表群","IsGlobal":false,"IsActive":false},
  "a919235f-...": {"Name":"8班课表群","IsGlobal":false,"IsActive":false}
}
```

> ⚠️ **键必须是 UUID，不能是群名** —— 这是生成器里的一个真 bug，靠校验器抓出来的。
> 用名字做键会导致 `SelectedClassPlanGroupId` 找不到对应群。

---

## 四 ⚠️ 铁律：Classes 数必须 == TimeType==0 的数量

**这是最容易炸、且炸了不报任何错的一条。**

ClassIsland 把 `Classes[i]` 分配给**第 i 个 `TimeType==0` 的时间点**（不是第 i 个
Layout，因为中间还夹着课间/分割线）。数量不等时教室机课表**静默空白**，客户端不报错、
不弹窗、日志不记 —— 只能对着教室机发呆。

真机档案实测（12 个 ClassPlan，全部匹配）：

| 课表 | Classes | TimeType==0 |
|---|---|---|
| 周一~周四 | 12 | 12 |
| 周五 | 8 | 8 |
| 周日 | 3 | 3 |

生成器里每次变更作息时间点，都必须同步改 `DEFAULT_SCHEDULE` 的科目数 ——
`make_profile()` 里有硬性 assert，不等直接 `ValueError`。

---

## 五 多周轮换在 Settings.json，不在档案里

`DefaultSettings.json` 里的字段（来自真机）：

```json
"SingleWeekStartTime": "2026-09-01T00:00:00",
"MultiWeekRotationMaxCycle": 4,
"MultiWeekRotationOffset": [-1, -1, 0, 0, 0]
```

`MultiWeekRotationOffset` 里 `-1` = 用基础课表，`N` = 用轮换第 N 周。
**改轮换要同时写 Settings.json**，只改 ClassPlan 的 `TimeRule.WeekCountDiv` 没用。

---

## 六 集控本地配置（Config\Management）

`Policy.json` —— 限制客户端可改什么：

```json
{"DisableProfileClassPlanEditing":false,"DisableProfileTimeLayoutEditing":false,
 "DisableProfileSubjectsEditing":false,"DisableProfileEditing":false,
 "DisableSettingsEditing":false,"DisableSplashCustomize":false,
 "DisableDebugMenu":false,"AllowExitManagement":true,
 "DisableEasterEggs":false,"IsActive":false}
```

`Credentials.json` —— 各级操作的授权等级（`EditProfileAuthorizeLevel` 等）。

> 本机这两份 `IsActive:false` = **集控未启用**。启用集控后档案与客户端个人设置隔离。

---

## 七 分发机制（本机可查的）

`CIMS-backend\seed_resources\DefaultSettings.json` 里的 `RefreshingScopes` 是现成的
分发控制面，**不用自己设计推送协议**：

```json
{
  "Profile": false, "ProfileClassPlans": false, "ProfileTimeLayouts": false,
  "Components": false, "Automations": false, "Plugins": false,
  "ReservedClassPlans": [], "ReservedTimeLayouts": []
}
```

- `RefreshingScopes` 为 true 的资源由集控服务端下发，客户端只拉不改
- `Reserved*` 是要**保留客户端本地**不被覆盖的资源 GUID

教室端拉取入口见 `_pkg-good\ext\stelarith-classisland-plugin\stelarith-sync.example.json`：
`ClientAppBase` + `ClassPlanName` + `ComponentsName` + `RefreshIntervalSeconds`。

---

## 八 工具

```bash
# 生成 + 自校验
python tools/ci-profile/gen_ci_profile.py --check-only

# 生成样例档案
python tools/ci-profile/gen_ci_profile.py --out dist/ci-profile-sample.json

# 合并进现有档案（保留客户端本地设置：主题/字号/通知）
python tools/ci-profile/gen_ci_profile.py --merge 现有Default.json --out 合并.json

# 自定义课表（科目数必须精确匹配该天 TimeType==0 数）
python tools/ci-profile/gen_ci_profile.py --schedule '{"1":["语文","数学",...],"5":[...]}'

# 与真机档案逐字段对照（10 项校验）
python tools/ci-profile/verify_ci_profile.py
```

**当前校验结果：10/10 通过** —— 顶层键、ClassPlan、Class、LayoutItem、Subject、
ClassPlanGroups 六类字段集合与真机完全一致，0 个悬空引用，时间格式全部 `HH:mm:ss`。

**未验证**：生成器输出**没有真机装过 ClassIsland 实测渲染**。格式对照只能证明字段对，
不能证明客户端解析无误。要实机验证需一台装了 ClassIsland 的教室机。
