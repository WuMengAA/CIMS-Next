using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading;
using Microsoft.Extensions.Logging;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控「资源写回 ClassIsland 档案」——把 CIMS 下发的 ClassPlan / TimeLayout / Subjects
/// 真正合并进宿主当前档案，使教室端**实际生效**，而不是只存在插件自己的快照里。
///
/// 为什么用反射而不是强类型引用：
///   ClassIsland 的 <c>IProfileService</c> 在 **Core 抽象包**里只有少量成员，真正的
///   `Profile` / `CurrentProfilePath` / `SaveProfile()` 落在宿主的
///   `ClassIsland.Services.ProfileService` 实现类上，各版本字段名/签名可能漂移。
///   插件编译期只引用 `ClassIsland.Core` 抽象包（见 csproj），因此这里通过运行时反射
///   拿取「当前档案对象 + 保存方法」，任何一处找不到就**整体降级为只写快照**，
///   绝不因版本差异抛异常连累宿主启动。
///
/// 官方档案落点（与 ClassIsland 官方一致）：
///   · 档案文件：`<数据目录>/Profiles/<当前档案名>.json`（本机为 Default.json）
///   · 三类资源都是 **Profile 信封**：
///       ClassPlan  → { ClassPlans:{}, ClassPlanGroups:{} }
///       TimeLayout → { TimeLayouts:{} }
///       Subjects   → { Subjects:{} }
///     裸对象会被客户端静默忽略。
///   · 合并语义：按 GUID **逐键合并**（新键加入、同名键覆盖），保留档案里其它课表，
///     不整包替换——否则会抹掉用户本地手工建的课表。
/// </summary>
internal static class StelarithProfileWriter
{
    private static readonly object SyncLock = new();
    private static readonly JsonSerializerOptions PrettyJson = new() { WriteIndented = true };

    /// <summary>最近一次写回结果（供 UI / 诊断展示）。</summary>
    public static string LastResult { get; private set; } = "尚未写回";

    internal static void Diag(string msg)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(AppContext.BaseDirectory, "ste-profile-diag.log"),
                $"{DateTime.Now:HH:mm:ss.fff} {msg}{Environment.NewLine}");
        }
        catch { /* 诊断写失败忽略 */ }
    }

    /// <summary>
    /// 把一次同步拿到的三类资源写回宿主档案。
    /// </summary>
    /// <param name="classPlanJson">ClassPlan 资源原文（Profile 信封）</param>
    /// <param name="timeLayoutJson">TimeLayout 资源原文（Profile 信封）</param>
    /// <param name="subjectsJson">Subjects 资源原文（Profile 信封）</param>
    /// <param name="logger">宿主 logger（可为 null）</param>
    public static void WriteBack(
        string? classPlanJson,
        string? timeLayoutJson,
        string? subjectsJson,
        ILogger? logger)
    {
        lock (SyncLock)
        {
            try
            {
                var profileObj = ResolveCurrentProfile();
                if (profileObj is null)
                {
                    LastResult = "跳过：宿主档案尚未就绪（或 ProfileService 反射未命中）";
                    Diag("WriteBack skipped: profile object unresolved");
                    return;
                }

                var changed = new List<string>();
                if (MergeDictionaryInto(profileObj, "ClassPlans", classPlanJson, "ClassPlans"))
                    changed.Add("ClassPlans");
                if (MergeDictionaryInto(profileObj, "ClassPlanGroups", classPlanJson, "ClassPlanGroups"))
                    changed.Add("ClassPlanGroups");
                if (MergeDictionaryInto(profileObj, "TimeLayouts", timeLayoutJson, "TimeLayouts"))
                    changed.Add("TimeLayouts");
                if (MergeDictionaryInto(profileObj, "Subjects", subjectsJson, "Subjects"))
                    changed.Add("Subjects");

                if (changed.Count == 0)
                {
                    LastResult = "无变化（资源已是最新）";
                    Diag("WriteBack: no changes");
                    return;
                }

                SaveProfile(profileObj);

                LastResult = $"已写回 {string.Join("/", changed)}（{DateTime.Now:HH:mm:ss}）";
                Diag($"WriteBack ok: {LastResult}");
                logger?.LogInformation("Stelarith profile: {result}", LastResult);
            }
            catch (Exception ex)
            {
                LastResult = "写回失败：" + ex.Message;
                Diag("WriteBack exception: " + ex);
                logger?.LogWarning(ex, "Stelarith profile: 写回失败");
            }
        }
    }

    /// <summary>
    /// 反射取得宿主当前的 Profile 对象。优先 `IProfileService.Profile`（Core 抽象），
    /// 再退到实现类上的 `Profile` 属性 / 内部字段。
    /// </summary>
    private static object? ResolveCurrentProfile()
    {
        var svc = StelarithReflection.ProfileService;
        if (svc is null) return null;

        var t = svc.GetType();
        // ① 公开实例属性 Profile
        var prop = t.GetProperty("Profile", BindingFlags.Public | BindingFlags.Instance);
        if (prop?.GetValue(svc) is { } fromProp) return fromProp;

        // ② 查询 Core 接口成员（可能在接口上声明）
        foreach (var itf in t.GetInterfaces())
        {
            var ip = itf.GetProperty("Profile", BindingFlags.Public | BindingFlags.Instance);
            if (ip?.GetValue(svc) is { } fromItf) return fromItf;
        }

        // ③ 私有字段 _profile
        var field = t.GetField("_profile",
            BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Public);
        return field?.GetValue(svc);
    }

    /// <summary>
    /// 把资源信封里的某个字典（如 ClassPlans）逐键合并进档案对象的同名属性。
    /// 档案侧属性是 `ObservableDictionary&lt;Guid, T&gt;`，用 IDictionary 接口操作即可。
    /// </summary>
    /// <returns>是否有实际变更</returns>
    private static bool MergeDictionaryInto(
        object profileObj, string profilePropName, string? resourceJson, string envelopeKey)
    {
        if (string.IsNullOrWhiteSpace(resourceJson)) return false;

        Dictionary<string, JsonElement>? incoming;
        try
        {
            using var doc = JsonDocument.Parse(resourceJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return false;
            if (!doc.RootElement.TryGetProperty(envelopeKey, out var dictEl)) return false;
            if (dictEl.ValueKind != JsonValueKind.Object) return false;

            incoming = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
            foreach (var p in dictEl.EnumerateObject()) incoming[p.Name] = p.Value.Clone();
        }
        catch (Exception ex)
        {
            Diag($"MergeDictionaryInto({envelopeKey}) parse fail: {ex.Message}");
            return false;
        }
        if (incoming.Count == 0) return false;

        var profileType = profileObj.GetType();
        var targetProp = profileType.GetProperty(
            profilePropName, BindingFlags.Public | BindingFlags.Instance);
        if (targetProp?.GetValue(profileObj) is not { } targetDict)
        {
            Diag($"MergeDictionaryInto: 档案缺少属性 {profilePropName}（跳过）");
            return false;
        }

        // 目标字典实现 IDictionary<,>：取键/值类型（ClassPlans 是 <Guid, ClassPlan>）
        var dictInterface = targetDict.GetType().GetInterfaces()
            .FirstOrDefault(i => i.IsGenericType &&
                                 i.GetGenericTypeDefinition() == typeof(IDictionary<,>));
        if (dictInterface is null)
        {
            Diag($"MergeDictionaryInto: {profilePropName} 不是 IDictionary<,>（跳过）");
            return false;
        }

        var keyType = dictInterface.GetGenericArguments()[0];
        var valType = dictInterface.GetGenericArguments()[1];
        var containsKey = dictInterface.GetMethod("ContainsKey")!;
        var indexer = dictInterface.GetProperty("Item")!;
        var changed = false;

        foreach (var kv in incoming)
        {
            object? key;
            try
            {
                key = keyType == typeof(Guid) ? Guid.Parse(kv.Key) : Convert.ChangeType(kv.Key, keyType);
            }
            catch
            {
                continue; // 非 GUID 键（异常档案）跳过
            }

            bool exists;
            try { exists = (bool)containsKey.Invoke(targetDict, new[] { key })!; }
            catch { continue; }

            // 已存在且内容一致 → 不动（减少无谓写盘与档案变更事件风暴）
            if (exists)
            {
                try
                {
                    var oldVal = indexer.GetValue(targetDict, new[] { key });
                    var oldJson = JsonSerializer.Serialize(oldVal);
                    if (NormalizeJson(oldJson) == NormalizeJson(kv.Value.GetRawText())) continue;
                }
                catch { /* 比较失败则按需要更新处理 */ }
            }

            object? newVal;
            try
            {
                newVal = JsonSerializer.Deserialize(
                    kv.Value.GetRawText(), valType,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            }
            catch (Exception ex)
            {
                Diag($"  {profilePropName}[{kv.Key}] 反序列化失败: {ex.Message}");
                continue;
            }
            if (newVal is null) continue;

            try
            {
                // ObservableDictionary 的索引器 setter 会触发变更通知 → 界面自动刷新
                indexer.SetValue(targetDict, newVal, new[] { key });
                changed = true;
            }
            catch (Exception ex)
            {
                Diag($"  {profilePropName}[{kv.Key}] 写入失败: {ex.Message}");
            }
        }

        return changed;
    }

    /// <summary>JSON 规范化（去空白 + 稳定序）用于「是否变化」比较。</summary>
    private static string NormalizeJson(string s)
    {
        try
        {
            using var doc = JsonDocument.Parse(s);
            return JsonSerializer.Serialize(doc.RootElement);
        }
        catch
        {
            return (s ?? "").Trim();
        }
    }

    /// <summary>
    /// 反射调用宿主的 `SaveProfile()`（同时回写磁盘档案文件并触发宿主重载）。
    /// 找不到时退化为「直接写档案文件」兜底。
    /// </summary>
    private static void SaveProfile(object profileObj)
    {
        var svc = StelarithReflection.ProfileService;
        if (svc is not null)
        {
            var m = svc.GetType().GetMethod(
                "SaveProfile", BindingFlags.Public | BindingFlags.Instance, null,
                Type.EmptyTypes, null);
            if (m is not null)
            {
                m.Invoke(svc, null);
                Diag("SaveProfile() 已调用（宿主保存路径）");
                return;
            }
        }

        // 兜底：直接写 <数据目录>/Profiles/<当前档案名>.json
        var path = ResolveProfilePath();
        if (path is null)
        {
            Diag("SaveProfile 兜底失败：档案路径未知");
            return;
        }
        var json = JsonSerializer.Serialize(profileObj, profileObj.GetType(), PrettyJson);
        File.WriteAllText(path, json, new UTF8Encoding(false));
        Diag("SaveProfile 兜底：已直接写档案文件 " + path);
    }

    /// <summary>解析当前档案文件的绝对路径（宿主的 CurrentProfilePath 属性）。</summary>
    public static string? ResolveProfilePath()
    {
        var svc = StelarithReflection.ProfileService;
        if (svc is null) return null;
        var t = svc.GetType();
        var prop = t.GetProperty("CurrentProfilePath", BindingFlags.Public | BindingFlags.Instance)
                   ?? t.GetInterfaces()
                       .Select(i => i.GetProperty("CurrentProfilePath",
                           BindingFlags.Public | BindingFlags.Instance))
                       .FirstOrDefault(p => p is not null);
        try
        {
            var v = prop?.GetValue(svc) as string;
            if (!string.IsNullOrWhiteSpace(v) && File.Exists(v)) return v;
        }
        catch { /* 忽略，走兜底 */ }

        // 兜底：数据目录/Profiles/Default.json
        var candidates = new[]
        {
            Path.Combine(StelarithReflection.DataDirectory ?? "", "Profiles", "Default.json"),
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    /// <summary>返回当前档案里各类资源的条数摘要（供 UI 展示「岛内可见」的配置规模）。</summary>
    public static string DescribeCurrentProfile()
    {
        try
        {
            var p = ResolveCurrentProfile();
            if (p is null) return "档案未就绪";
            string Count(string name)
            {
                var prop = p.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
                if (prop?.GetValue(p) is System.Collections.ICollection c) return c.Count.ToString();
                return "—";
            }
            return $"课表 {Count("ClassPlans")} 张 / 作息 {Count("TimeLayouts")} 套 / 科目 {Count("Subjects")} 个";
        }
        catch (Exception ex)
        {
            return "读取失败：" + ex.Message;
        }
    }

    /// <summary>
    /// 切换当前激活的课表群（= 切换这台教室端显示的班级）。
    ///
    /// 为什么必须走插件而不是服务端：官方 <c>SelectedClassPlanGroupId</c> 只存在于本地档案，
    /// 集控通道合并资源时**不会覆盖**它（合并只逐键合 ClassPlans/TimeLayouts/Subjects 等字典）。
    /// 因此「这台设备该显示哪个班」只能由本地插件改档案来落地。
    ///
    /// 匹配策略（由宽到严，命中即用）：
    ///   ① groupGuid 精确匹配 ClassPlanGroups 的键
    ///   ② 按 groupName 匹配群名（支持「1班」「新课表群」这类中文名）
    ///   ③ 按 classId/name 反查：哪个群的课表里含该班关键字（兜底）
    ///
    /// 成功后同时更新 <c>SelectedClassPlanGroupId</c> 并调宿主 SaveProfile()，宿主会立刻
    /// 重算当前生效的课表 → 大屏显示随之切换。
    /// </summary>
    /// <param name="groupGuid">目标课表群 GUID（首选）</param>
    /// <param name="groupName">目标课表群名称（次选）</param>
    /// <returns>结果描述（同时写入 LastResult）</returns>
    public static string SetActiveClassGroup(string? groupGuid, string? groupName)
    {
        lock (SyncLock)
        {
            try
            {
                var profileObj = ResolveCurrentProfile();
                if (profileObj is null)
                {
                    LastResult = "切班失败：宿主档案未就绪";
                    Diag("SetActiveClassGroup skipped: profile unresolved");
                    return LastResult;
                }

                var groupsProp = profileObj.GetType().GetProperty(
                    "ClassPlanGroups", BindingFlags.Public | BindingFlags.Instance);
                if (groupsProp?.GetValue(profileObj) is not { } groupsDict)
                {
                    LastResult = "切班失败：档案缺少 ClassPlanGroups";
                    Diag(LastResult);
                    return LastResult;
                }

                // 枚举现有群（GUID + 名称）
                var existing = new List<(string Guid, string Name)>();
                if (groupsDict is System.Collections.IDictionary legacy)
                {
                    foreach (System.Collections.DictionaryEntry e in legacy)
                        existing.Add((e.Key?.ToString() ?? "", ReadName(e.Value)));
                }
                else
                {
                    var dictItf = groupsDict.GetType().GetInterfaces()
                        .FirstOrDefault(i => i.IsGenericType &&
                                             i.GetGenericTypeDefinition() == typeof(IDictionary<,>));
                    if (dictItf is not null)
                    {
                        var keys = dictItf.GetProperty("Keys")!.GetValue(groupsDict) as System.Collections.IEnumerable;
                        var indexer = dictItf.GetProperty("Item")!;
                        if (keys is not null)
                        {
                            foreach (var k in keys)
                            {
                                if (k is null) continue;
                                var v = indexer.GetValue(groupsDict, new[] { k });
                                existing.Add((k.ToString() ?? "", ReadName(v)));
                            }
                        }
                    }
                }

                if (existing.Count == 0)
                {
                    LastResult = "切班失败：档案里没有任何课表群";
                    Diag(LastResult);
                    return LastResult;
                }

                // ① GUID 精确
                string? target = null;
                if (!string.IsNullOrWhiteSpace(groupGuid))
                {
                    target = existing.FirstOrDefault(g =>
                        string.Equals(g.Guid, groupGuid!.Trim(), StringComparison.OrdinalIgnoreCase)).Guid;
                }
                // ② 群名
                if (target is null && !string.IsNullOrWhiteSpace(groupName))
                {
                    target = existing.FirstOrDefault(g =>
                        string.Equals(g.Name, groupName!.Trim(), StringComparison.OrdinalIgnoreCase)).Guid;
                }
                // 部分匹配（"3班" 命中 "3班课表群"）
                if (target is null && !string.IsNullOrWhiteSpace(groupName))
                {
                    target = existing.FirstOrDefault(g =>
                        g.Name.Contains(groupName!.Trim(), StringComparison.OrdinalIgnoreCase)).Guid;
                }

                if (string.IsNullOrEmpty(target))
                {
                    LastResult = $"切班失败：未找到群 guid={groupGuid} name={groupName}（现有 {existing.Count} 个群）";
                    Diag(LastResult);
                    return LastResult;
                }

                var selProp = profileObj.GetType().GetProperty(
                    "SelectedClassPlanGroupId", BindingFlags.Public | BindingFlags.Instance);
                if (selProp is null || !selProp.CanWrite)
                {
                    LastResult = "切班失败：档案无 SelectedClassPlanGroupId 可写属性";
                    Diag(LastResult);
                    return LastResult;
                }

                var newVal = selProp.PropertyType == typeof(Guid)
                    ? Guid.Parse(target)
                    : Convert.ChangeType(target, selProp.PropertyType);
                selProp.SetValue(profileObj, newVal);

                SaveProfile(profileObj);

                var matched = existing.First(g => g.Guid == target);
                LastResult = $"已切班至「{matched.Name}」({target})";
                Diag("SetActiveClassGroup ok: " + LastResult);
                return LastResult;
            }
            catch (Exception ex)
            {
                LastResult = "切班异常：" + ex.Message;
                Diag("SetActiveClassGroup exception: " + ex);
                return LastResult;
            }
        }
    }

    /// <summary>
    /// 读「本机当前实际生效的课表群」名称（如「3班课表群」）。
    ///
    /// 为什么需要单独读：远程切班（`set_active_class`）只改本地档案的
    /// `SelectedClassPlanGroupId`，**服务端并不知道执行结果**。面板要确认"切班真的生效了"，
    /// 就必须回读这个字段 —— 否则只能看到"指令已下发"，而无法区分
    /// 「切班成功」和「指令收到但没找到群」。
    ///
    /// 档案未就绪 / 群已被删 / 反射失败一律返回 ""，绝不抛异常。
    /// </summary>
    public static string CurrentActiveClassGroupName()
    {
        try
        {
            var profileObj = ResolveCurrentProfile();
            if (profileObj is null) return "";

            var selProp = profileObj.GetType().GetProperty(
                "SelectedClassPlanGroupId", BindingFlags.Public | BindingFlags.Instance);
            var raw = selProp?.GetValue(profileObj);
            if (raw is null) return "";
            var selected = raw.ToString() ?? "";
            if (string.IsNullOrWhiteSpace(selected) || selected == Guid.Empty.ToString()) return "";

            var groupsProp = profileObj.GetType().GetProperty(
                "ClassPlanGroups", BindingFlags.Public | BindingFlags.Instance);
            if (groupsProp?.GetValue(profileObj) is not { } groupsDict) return selected;

            if (groupsDict is System.Collections.IDictionary legacy)
            {
                foreach (System.Collections.DictionaryEntry e in legacy)
                {
                    if (string.Equals(e.Key?.ToString(), selected, StringComparison.OrdinalIgnoreCase))
                        return ReadName(e.Value);
                }
            }
            else
            {
                var dictItf = groupsDict.GetType().GetInterfaces()
                    .FirstOrDefault(i => i.IsGenericType &&
                                         i.GetGenericTypeDefinition() == typeof(IDictionary<,>));
                if (dictItf is not null)
                {
                    var keys = dictItf.GetProperty("Keys")!.GetValue(groupsDict) as System.Collections.IEnumerable;
                    var indexer = dictItf.GetProperty("Item")!;
                    if (keys is not null)
                    {
                        foreach (var k in keys)
                        {
                            if (!string.Equals(k?.ToString(), selected, StringComparison.OrdinalIgnoreCase)) continue;
                            return ReadName(indexer.GetValue(groupsDict, new[] { k! }));
                        }
                    }
                }
            }

            // 群字典里找不到（可能已被替换）—— 至少把 GUID 报出去，便于排查
            return selected;
        }
        catch (Exception ex)
        {
            Diag("CurrentActiveClassGroupName failed: " + ex.Message);
            return "";
        }
    }

    /// <summary>从群元对象里读 Name（群元在档案里是匿名结构，只能反射）。</summary>
    private static string ReadName(object? meta)
    {
        if (meta is null) return "";
        if (meta is string s) return s;
        try
        {
            var p = meta.GetType().GetProperty("Name", BindingFlags.Public | BindingFlags.Instance);
            return p?.GetValue(meta)?.ToString() ?? "";
        }
        catch
        {
            return "";
        }
    }
}
