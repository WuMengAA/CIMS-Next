using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace StelarithControlPlugin;

/// <summary>
/// 一个可开关的功能模块的元数据。
/// </summary>
public sealed class StelarithModuleDef
{
    public string Id { get; init; } = "";
    public string Label { get; init; } = "";
    public string Description { get; init; } = "";
    /// <summary>核心模块：不允许关闭（面板上开关置灰并给出原因）。</summary>
    public bool IsCore { get; init; }
    public bool DefaultEnabled { get; init; } = true;
}

/// <summary>
/// 星璃·集控「功能模块开关」—— 让面板上的开关**真正生效**的唯一落点。
///
/// 为什么需要它（现状问题）：
///   面板「插件管理」页此前读写的是 CIMS 的 `Components` 资源，那是**客户端组件布局配置**，
///   与"插件/功能是否启用"毫无关系。于是开关点下去有请求、有 200，教室端行为一动不动
///   —— 典型的"假开关"。
///
/// 为什么不用 ClassIsland 的插件启停：
///   经对本机 ClassIsland 2.1.0.1 程序集实测，宿主**没有**任何公开的插件启停 API：
///     · `IPluginService` 只暴露 `LoadedPluginsInternal` / `LoadedPluginsIds`（只读枚举）；
///     · `PluginInfo.IsEnabled` 虽有 public setter，但宿主不监听它，改了不落地；
///     · 唯一的"禁用"机制是启动期 `Settings.AutoDisableCorruptPlugins`（加载异常才禁用）
///       与 `CorruptPluginsDisabledLastSession`，且都需要**重启**才生效。
///   所以"启停第三方插件"这件事在运行时做不到，也不该假装能做。本类改为管理
///   **星璃插件内部的**功能模块 —— 这些是插件自己执行的代码路径，开关即时生效、可验证。
///
/// 持久化：插件目录下 `stelarith-modules.json`（{moduleId: bool}）。
/// 读失败/写失败都不抛异常：开关是增强能力，绝不能因此让插件启动失败。
/// </summary>
public static class StelarithModules
{
    // ---- 模块 id 常量（与面板、后端三处共用同一套字符串）----
    public const string Sync = "sync";
    public const string WriteBack = "writeback";
    public const string CommandPoll = "command_poll";
    public const string Notification = "notification";
    public const string OsActions = "os_actions";
    public const string RemoteControl = "remote_control";
    public const string MessageFeed = "message_feed";
    public const string Heartbeat = "heartbeat";
    // 2026-09-19 新增：这三项都是**真的会改变教室端行为**的开关（各有对应的执行路径），
    // 不是"信息展示"型开关。纪律相关（切班）与隐私相关（摄像头）必须能单独关掉。
    public const string ClassSwitch = "class_switch";
    public const string CameraCapture = "camera_capture";
    public const string MediaP2P = "media_p2p";

    // 2026-09-25 新增：通知增强三件套 —— 全屏紧急通知 / 语音朗读 / 底部滚动条。
    // 全屏紧急是「打断式」呈现（覆盖全屏、必须确认），语音与滚动条是「非打断」增强，
    // 三者都是真的会改变教室端行为的开关，必须能单独关掉。
    public const string FullscreenNotice = "fullscreen_notice";
    public const string Tts = "tts";
    public const string Marquee = "marquee";

    /// <summary>模块清单（顺序即面板展示顺序）。</summary>
    public static readonly IReadOnlyList<StelarithModuleDef> All = new List<StelarithModuleDef>
    {
        new() { Id = Sync, Label = "资源主动同步", IsCore = false,
                Description = "定时从集控服务器拉取课表 / 作息 / 科目 / 组件配置。" },
        new() { Id = WriteBack, Label = "写回 ClassIsland 档案", IsCore = false,
                Description = "把同步到的资源写入本机档案，使大屏真正显示新配置。" },
        new() { Id = CommandPoll, Label = "集控指令通道", IsCore = true,
                Description = "轮询并执行集控下发的指令（锁屏/截图/切班/广播）。关闭后本机将失去远程控制能力。" },
        new() { Id = Notification, Label = "集控播报", IsCore = false,
                Description = "把集控广播落到 ClassIsland 官方提醒系统，在大屏播放遮罩播报。" },

        new() { Id = FullscreenNotice, Label = "全屏紧急通知", IsCore = false,
                Description = "紧急通知在全屏置顶遮罩中呈现（红边警示 + 必须手动确认 + 回执上报）。关闭后紧急通知降级为普通播报。" },
        new() { Id = Tts, Label = "语音朗读（TTS）", IsCore = false,
                Description = "通知/播报到达时用中文语音朗读一遍，让投影距离外的学生也能听到。" },
        new() { Id = Marquee, Label = "底部滚动通知条", IsCore = false,
                Description = "在岛上底部常驻一条滚动字幕，循环显示最近的广播与通知（可配置显示条数与滚动速度）。" },
        new() { Id = OsActions, Label = "本机动作（锁屏 / 截图）", IsCore = false,
                Description = "允许集控对这台机器执行锁屏与截屏。" },
        new() { Id = RemoteControl, Label = "远程控制转发", IsCore = false,
                Description = "允许集控经本地代理发起远程控制（VNC）会话。" },
        new() { Id = ClassSwitch, Label = "远程切班", IsCore = false,
                Description = "允许集控把本班大屏切换到指定课表群。考试 / 重要活动期间可临时关闭，避免被打断。" },
        new() { Id = CameraCapture, Label = "摄像头抓拍与录像", IsCore = false,
                Description = "允许集控抓取本机摄像头画面（单帧抓拍 / 短录像）。关闭后摄像头类指令一律拒绝执行。" },
        new() { Id = MediaP2P, Label = "P2P 媒体直连", IsCore = false,
                Description = "允许本机作为点对点端点被直连观看（画面 / 录像走设备之间，不经服务器中转）。关闭则只能经服务器转发。" },
        new() { Id = MessageFeed, Label = "岛内消息中心", IsCore = false,
                Description = "在 ClassIsland 设置页 / 托盘里查看本机最近的广播与通知。" },
        new() { Id = Heartbeat, Label = "状态心跳上报", IsCore = true,
                Description = "定期向集控上报本机在线状态、插件清单与模块开关。关闭后面板将看不到这台设备。" },
    };

    private static readonly object Lock = new();
    private static Dictionary<string, bool> _state = new(StringComparer.OrdinalIgnoreCase);
    private static bool _loaded;
    private static long _revision;

    /// <summary>开关发生变化的通知（供状态上报立即刷新）。</summary>
    public static event Action<string, bool>? Changed;

    /// <summary>状态版本号，每次变更 +1（心跳据此决定是否需要立即重报）。</summary>
    public static long Revision
    {
        get { lock (Lock) return _revision; }
    }

    private static string ConfigPath => Path.Combine(StelarithLog.ConfigDir!, "stelarith-modules.json");

    private static void EnsureLoaded()
    {
        lock (Lock)
        {
            if (_loaded) return;
            _loaded = true;
            _state = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            foreach (var def in All) _state[def.Id] = def.DefaultEnabled;

            // 一次性迁移：旧版把 stelarith-modules.json 写在程序目录（AppContext.BaseDirectory），
            // 现改为官方 PluginConfigFolder。若新位置没有、旧位置有，则搬过去，避免用户开关丢失。
            try
            {
                var legacy = Path.Combine(AppContext.BaseDirectory, "stelarith-modules.json");
                if (!File.Exists(ConfigPath) && File.Exists(legacy))
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(ConfigPath)!);
                    File.Copy(legacy, ConfigPath, true);
                    Diag("migrated modules config from program dir -> " + ConfigPath);
                }
            }
            catch (Exception ex)
            {
                Diag("modules config migration skipped: " + ex.Message);
            }

            try
            {
                if (File.Exists(ConfigPath))
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(ConfigPath));
                    if (doc.RootElement.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var prop in doc.RootElement.EnumerateObject())
                        {
                            if (TryParseBool(prop.Value, out var on)) _state[prop.Name] = on;
                        }
                    }
                }
                else
                {
                    Diag("config not found, using defaults");
                }
            }
            catch (Exception ex)
            {
                Diag("load failed, using defaults: " + ex.Message);
            }

            // 核心模块强制开启：即使配置文件被人为改成 false 也不认
            foreach (var def in All.Where(d => d.IsCore)) _state[def.Id] = true;
        }
    }

    private static bool TryParseBool(JsonElement el, out bool value)
    {
        switch (el.ValueKind)
        {
            case JsonValueKind.True: value = true; return true;
            case JsonValueKind.False: value = false; return true;
            case JsonValueKind.Number: value = el.GetDouble() != 0; return true;
            case JsonValueKind.String:
                var s = el.GetString();
                if (bool.TryParse(s, out value)) return true;
                if (s is "1" or "on" or "yes") { value = true; return true; }
                if (s is "0" or "off" or "no") { value = false; return true; }
                break;
        }
        value = true;
        return false;
    }

    /// <summary>某模块是否启用。未知 id 视为启用（前向兼容：新模块在旧配置下默认开）。</summary>
    public static bool IsEnabled(string id)
    {
        EnsureLoaded();
        var def = All.FirstOrDefault(d => string.Equals(d.Id, id, StringComparison.OrdinalIgnoreCase));
        if (def is { IsCore: true }) return true;
        lock (Lock)
        {
            return _state.TryGetValue(id, out var on) ? on : true;
        }
    }

    /// <summary>当前全量开关快照（用于心跳上报 / 面板回显）。</summary>
    public static Dictionary<string, bool> Snapshot()
    {
        EnsureLoaded();
        lock (Lock) return new Dictionary<string, bool>(_state, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>模块清单 + 当前值（面板直接渲染用）。</summary>
    public static List<object> Describe()
    {
        EnsureLoaded();
        var snap = Snapshot();
        return All.Select(d => (object)new
        {
            id = d.Id,
            label = d.Label,
            description = d.Description,
            core = d.IsCore,
            enabled = snap.TryGetValue(d.Id, out var on) ? on : d.DefaultEnabled,
        }).ToList();
    }

    /// <summary>
    /// 设置某模块开关。返回 (是否成功, 说明)。核心模块拒绝关闭。
    /// 写文件失败不回滚内存值 —— 内存已生效可立即验证，文件只是持久化，下次启动仍可修正。
    /// </summary>
    public static (bool Ok, string Message) Set(string id, bool enabled)
    {
        EnsureLoaded();
        var def = All.FirstOrDefault(d => string.Equals(d.Id, id, StringComparison.OrdinalIgnoreCase));
        if (def is null)
            return (false, $"未知模块 {id}");

        if (def.IsCore && !enabled)
            return (false, $"「{def.Label}」是核心模块，不允许关闭（关闭后本机将无法被集控发现或控制）");

        bool changed;
        lock (Lock)
        {
            changed = !_state.TryGetValue(def.Id, out var cur) || cur != enabled;
            _state[def.Id] = enabled;
            if (changed) _revision++;
        }

        if (!changed)
            return (true, $"「{def.Label}」已是 {(enabled ? "启用" : "停用")} 状态");

        Save();
        Diag($"module {def.Id} -> {(enabled ? "on" : "off")}");
        try { Changed?.Invoke(def.Id, enabled); } catch { /* 订阅方异常不影响开关 */ }
        return (true, $"「{def.Label}」已{(enabled ? "启用" : "停用")}");
    }

    private static void Save()
    {
        try
        {
            var snap = Snapshot();
            var json = JsonSerializer.Serialize(snap, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(ConfigPath, json, new UTF8Encoding(false));
        }
        catch (Exception ex)
        {
            Diag("save failed: " + ex.Message);
        }
    }

    /// <summary>
    /// 从已反序列化的指令任务里取模块开关设置。
    ///
    /// 为什么不在 <see cref="StelarithTask"/> 上直接写业务逻辑：任务类型是「通道协议的形状」，
    /// 模块开关是「业务语义」，两者混在一起会让任务类型随业务膨胀。这里做一次转换，
    /// 复用 <see cref="ApplyFromCommand"/> 的批量/单个两种形态解析。
    /// </summary>
    public static string ApplyFromTask(StelarithTask task)
    {
        try
        {
            var o = new JsonObject();
            if (task.Modules is { Count: > 0 })
            {
                var mods = new JsonObject();
                foreach (var kv in task.Modules) mods[kv.Key] = kv.Value;
                o["modules"] = mods;
            }
            if (!string.IsNullOrWhiteSpace(task.Module)) o["module"] = task.Module;
            if (task.Enabled.HasValue) o["enabled"] = task.Enabled.Value;

            if (o.Count == 0) return "指令未携带任何模块开关字段";
            return ApplyFromCommand(o.ToJsonString());
        }
        catch (Exception ex)
        {
            return "解析模块指令失败：" + ex.Message;
        }
    }

    /// <summary>处理集控下发的 set_module 指令载荷：{module, enabled} 或 {modules:{...}}。</summary>
    public static string ApplyFromCommand(string? payload)
    {
        if (string.IsNullOrWhiteSpace(payload)) return "载荷为空";
        try
        {
            using var doc = JsonDocument.Parse(payload);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return "载荷非对象";

            // 形态一：批量 {"modules": {"sync": false, ...}}
            if (root.TryGetProperty("modules", out var mods) && mods.ValueKind == JsonValueKind.Object)
            {
                var applied = new List<string>();
                foreach (var p in mods.EnumerateObject())
                {
                    if (!TryParseBool(p.Value, out var on)) continue;
                    var (ok, msg) = Set(p.Name, on);
                    applied.Add(ok ? msg : "跳过：" + msg);
                }
                return string.Join("；", applied);
            }

            // 形态二：单个 {"module": "sync", "enabled": false}
            var id = root.TryGetProperty("module", out var mid) ? mid.GetString() : null;
            var enabled = true;
            if (root.TryGetProperty("enabled", out var en) && TryParseBool(en, out var parsed)) enabled = parsed;
            if (string.IsNullOrWhiteSpace(id)) return "缺少 module 字段";
            var (ok2, msg2) = Set(id!, enabled);
            return ok2 ? msg2 : "失败：" + msg2;
        }
        catch (Exception ex)
        {
            return "解析失败：" + ex.Message;
        }
    }

    internal static void Diag(string msg)
    {
        try
        {
                StelarithLog.Write("ste-modules-diag.log", msg);
        }
        catch { /* 忽略 */ }
    }
}
