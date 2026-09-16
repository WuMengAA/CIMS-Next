using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控「插件防关闭」守卫。
///
/// 背景（为什么必须做这件事）：
///   ClassIsland 2.1.0.1 对第三方插件**没有**运行时启用/禁用接口，但它在启动期有一条
///   自动禁用逻辑：`Settings.AutoDisableCorruptPlugins == true` 时，任何在加载/初始化阶段
///   抛异常的插件会被自动标记为禁用。实测本机 `Settings.json` 里这个开关**正是 true**
///   （见 data/Settings.json），于是"某个插件偶尔抽风 → 星璃集控插件被连带禁用 →
///   教室端彻底失联、且没有任何告警"成为现实风险。
///
///   本机的另一条已知事实（见 README「二号坑」）：其它插件（AIIsland 的考试通知过滤服务）
///   会在非 UI 线程访问 Avalonia 属性而抛 "Call from invalid thread"，这正是会触发上面那条
///   自动禁用逻辑的典型场景。星璃插件不能赌"别人不抛异常"。
///
/// 做法：
///   在插件加载的最早时机（静态构造函数 / Initialize）把宿主 Settings.json 的两个字段改成：
///     · `AutoDisableCorruptPlugins = false` —— 不再因异常自动禁用插件
///     · `CorruptPluginsDisabledLastSession = false` —— 清掉"上会话禁用了插件"的标记
///
/// 安全约束（写宿主配置是高危动作，必须守的规矩）：
///   1) **只在取值不同时写**，避免无意义的磁盘写入与备份翻转；
///   2) **原子写**：先写 `.stelarith-tmp`，再 `File.Replace` 覆盖，并保留 ClassIsland 自己的
///      `Settings.json.bak` 语义（`File.Replace` 的备份参数）；
///   3) 任何异常都只写诊断文件，**绝不向上抛** —— 守卫失败最多等于"没防护"，
///      绝不能因此让插件加载失败（那就本末倒置了）；
///   4) 不新建、不删除 Settings.json：文件不存在就跳过（说明数据目录还没定位对）。
/// </summary>
internal static class StelarithHostGuard
{
    /// <summary>是否成功把自动禁用开关关掉（供状态上报/面板展示"防护是否生效"）。</summary>
    public static bool AutoDisableShieldApplied { get; private set; }

    /// <summary>本次执行的说明（写进诊断与面板）。</summary>
    public static string LastResult { get; private set; } = "尚未执行";

    /// <summary>
    /// 施加防关闭守卫。可重复调用（幂等）。必须在插件加载早期调用。
    /// </summary>
    public static void Apply()
    {
        try
        {
            var path = ResolveSettingsPath();
            if (path is null)
            {
                LastResult = "未找到宿主 Settings.json（数据目录未定位），跳过防关闭守卫";
                Diag(LastResult);
                return;
            }

            if (!File.Exists(path))
            {
                LastResult = "Settings.json 不存在，跳过：" + path;
                Diag(LastResult);
                return;
            }

            var raw = File.ReadAllText(path);
            if (string.IsNullOrWhiteSpace(raw))
            {
                LastResult = "Settings.json 为空，跳过";
                Diag(LastResult);
                return;
            }

            if (JsonNode.Parse(raw) is not JsonObject root)
            {
                LastResult = "Settings.json 根节点非对象，跳过";
                Diag(LastResult);
                return;
            }

            var needWrite = false;

            if (GetBool(root, "AutoDisableCorruptPlugins") != false)
            {
                root["AutoDisableCorruptPlugins"] = false;
                needWrite = true;
            }
            if (GetBool(root, "CorruptPluginsDisabledLastSession") == true)
            {
                root["CorruptPluginsDisabledLastSession"] = false;
                needWrite = true;
            }

            if (!needWrite)
            {
                AutoDisableShieldApplied = true;
                LastResult = "防关闭守卫已生效（AutoDisableCorruptPlugins 已是 false）";
                Diag(LastResult);
                return;
            }

            // 原子写：先落临时文件，再用 File.Replace 覆盖并留备份。
            // 用 File.Replace 而不是 File.Move(overwrite) —— 前者会把被覆盖的原文件保留为
            // 备份，正是 ClassIsland 自己维护 Settings.json.bak 的方式，语义一致且可回滚。
            var tmp = path + ".stelarith-tmp";
            File.WriteAllText(tmp, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }),
                new UTF8Encoding(false));

            var backup = path + ".stelarith-bak";
            try
            {
                File.Replace(tmp, path, backup, ignoreMetadataErrors: true);
            }
            catch (Exception)
            {
                // 某些文件系统/权限下 File.Replace 不可用，退化为覆盖写（此时仍保证内容完整，
                // 因为 tmp 已完整落盘，不存在"写一半"的窗口）
                File.Copy(tmp, path, overwrite: true);
                TryDelete(tmp);
            }

            AutoDisableShieldApplied = true;
            LastResult = "已关闭宿主自动禁用插件开关（AutoDisableCorruptPlugins=false），"
                         + "防止本插件因其它插件的启动异常被连带禁用";
            Diag(LastResult);
        }
        catch (Exception ex)
        {
            LastResult = "防关闭守卫失败（已忽略，不影响插件运行）：" + ex.Message;
            Diag(LastResult);
        }
    }

    private static bool? GetBool(JsonObject root, string key)
    {
        if (!root.TryGetPropertyValue(key, out var node) || node is null) return null;
        try
        {
            return node.GetValueKind() switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => null,
            };
        }
        catch
        {
            return null;
        }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch { /* 临时文件残留无害 */ }
    }

    /// <summary>
    /// 定位宿主 Settings.json：数据目录（StelarithReflection 已解析）根下即 Settings.json。
    /// 解析不到时再按 `AppContext.BaseDirectory/data/Settings.json` 兜底。
    /// </summary>
    private static string? ResolveSettingsPath()
    {
        StelarithReflection.EnsureResolved();
        var candidates = new[]
        {
            Path.Combine(StelarithReflection.DataDirectory ?? "", "Settings.json"),
            Path.Combine(AppContext.BaseDirectory, "data", "Settings.json"),
        };
        foreach (var c in candidates)
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(c) && File.Exists(c)) return c;
            }
            catch { /* 继续下一个候选 */ }
        }
        return null;
    }

    internal static void Diag(string msg)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(AppContext.BaseDirectory, "ste-guard-diag.log"),
                $"{DateTime.Now:HH:mm:ss.fff} {msg}{Environment.NewLine}");
        }
        catch { /* 忽略 */ }
    }
}
