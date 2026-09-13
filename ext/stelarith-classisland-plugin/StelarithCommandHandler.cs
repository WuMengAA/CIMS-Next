using System;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace StelarithControlPlugin;

/// <summary>
/// 统一命令处理器：按 ClassIsland 官方集控 CommandTypes 语义分发并执行命令。
///
/// gRPC 实时通道（StelarithCommandHost 订阅 IManagementService.Connection.CommandReceived）
/// 与 HTTP 轮询兜底通道（StelarithCommandPollerService 轮询 command_queue）都汇入本处理器，
/// 保证两通道对同一批官方命令采用完全一致的语义，不再各自为政。
///
/// 官方 CommandTypes（proto ClassIsland.Shared.Protobuf.Enum.CommandTypes）：
///   DefaultCommand = 0     （无操作）
///   Ping          = 10     （心跳，仅链路层，不出现在命令分发）
///   Pong          = 11     （心跳回执，同上）
///   RestartApp    = 101    （重启应用）
///   SendNotification = 102 （推送桌面通知；payload 为 SendNotification 消息）
///   DataUpdated   = 103    （数据已更新，客户端应主动拉取并刷新）
///   GetClientConfig = 104  （请求客户端上报当前配置）
///
/// 载荷来源两种形态：
///   1) gRPC 通道：ClientCommandEventArgs.Payload 为 SendNotification 的 protobuf 二进制
///      （CIMS 侧 SendNotification_pb2 序列化），本文通过给定字符串化载荷做兼容解析；
///   2) 轮询通道：payload 为 JSON（CIMS 侧 NotificationPayload.model_dump()）。
///
/// 额外兼容：无论哪种形态，若载荷内含 stelarith_task 片段，仍按插件原生指令执行，
/// 保证既有「电教一键锁屏/截图/远程控制」能力不因对齐官方语义而退化。
/// </summary>
public sealed class StelarithCommandHandler
{
    private readonly ILogger _logger;

    /// <summary>CIMS 官方命令类型常量（与 CIMS-backend app/grpc/api/Protobuf/Enum/CommandTypes.proto 一致）。</summary>
    public const int CmdRestartApp = 101;
    public const int CmdSendNotification = 102;
    public const int CmdDataUpdated = 103;
    public const int CmdGetClientConfig = 104;

    public StelarithCommandHandler(ILogger logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// 处理 gRPC 实时通道命令（原始字节载荷）。SendNotification 的 payload 在 gRPC 通道为
    /// protobuf 二进制（CIMS 侧 SendNotification_pb2 序列化），此处先解析消息再统一处理。
    /// </summary>
    public Task HandleRawAsync(int type, byte[]? raw, CancellationToken ct = default)
    {
        switch (type)
        {
            case CmdSendNotification:
                // 反解 protobuf wire，提取 MessageContent(2)/MessageMask(1)；其中 MessageContent
                // 可能内嵌 stelarith_task JSON，ExtractTask 会二次取用。
                var (title, content) = ParseNotificationProto(raw);
                return HandleSendNotificationCore(content, title, ct);
            default:
                // 其余命令 payload 为空或可选，直接按 JSON 形态处理（String 视图）
                var str = raw is null ? null : BytesToSafeString(raw);
                return HandleAsync(type, str, ct);
        }
    }

    /// <summary>
    /// 按命令类型名处理（轮询通道：command_queue 行的 command_type 字段）。
    /// </summary>
    public async Task HandleAsync(string? typeName, string? payload, CancellationToken ct = default)
    {
        int? numeric = TypeNameToNumber(typeName);
        if (numeric.HasValue)
        {
            await HandleAsync(numeric.Value, payload, ct);
            return;
        }
        // 名字无法映射到官方枚举：仍尝试解析 stelarith_task（兼容旧格式直接打包任务）
        var task = StelarithDispatch.ExtractTask(payload);
        if (task is not null)
        {
            _logger.LogInformation("Stelarith cmd: 未知命令类型 {type}，但含 stelarith_task.action={action}，照常执行",
                typeName, task.Action);
            await StelarithDispatch.RunAsync(task);
        }
        else
        {
            _logger.LogWarning("Stelarith cmd: 未知命令类型 {type}，且无 stelarith_task，跳过", typeName);
        }
    }

    /// <summary>
    /// 按 CommandTypes 数值分派（gRPC 通道：事件参数 Type 枚举的底层整数值）。
    /// </summary>
    public async Task HandleAsync(int type, string? payload, CancellationToken ct = default)
    {
        switch (type)
        {
            case CmdRestartApp:
                HandleRestartApp();
                break;

            case CmdSendNotification:
                await HandleSendNotificationAsync(payload, ct);
                break;

            case CmdDataUpdated:
                HandleDataUpdated();
                break;

            case CmdGetClientConfig:
                await HandleGetClientConfigAsync(ct);
                break;

            case 10: // Ping
            case 11: // Pong
                // 链路层心跳，不进入命令分发
                break;

            default:
                // 非官方类型：退化为 stelarith_task 解析
                var task = StelarithDispatch.ExtractTask(payload);
                if (task is not null)
                {
                    _logger.LogInformation("Stelarith cmd: 非官方类型 {type}，按 stelarith_task.action={action} 执行", type, task.Action);
                    await StelarithDispatch.RunAsync(task);
                }
                break;
        }
    }

    /// <summary>处理 RestartApp：请求 ClassIsland 重启。默认不自动退出，发系统提示由用户确认。</summary>
    private void HandleRestartApp()
    {
        _logger.LogInformation("Stelarith cmd: 收到官方 RestartApp 指令（默认不自动重启，提示用户）");
        Notify("星璃·集控", "集控已请求重启 ClassIsland，可手动重启应用以应用改动。");
    }

    /// <summary>处理 DataUpdated：请求本地立即拉取刷新配置快照。</summary>
    private void HandleDataUpdated()
    {
        _logger.LogInformation("Stelarith cmd: 收到官方 DataUpdated 指令，请求本地刷新配置");
        StelarithSyncState.RequestRefresh();
    }

    /// <summary>处理 GetClientConfig：本地无法强类型取得官方配置序列化器，记录并提示走同步快照。</summary>
    private Task HandleGetClientConfigAsync(CancellationToken _)
    {
        var snap = StelarithSyncState.Current;
        var cfgBrief = string.Concat(
            "manifest:", snap.ManifestJson is null ? "—" : $"{snap.ManifestJson.Length}B",
            " / classplan:", snap.ClassPlanJson is null ? "—" : $"{snap.ClassPlanJson.Length}B",
            " / components:", snap.ComponentsJson is null ? "—" : $"{snap.ComponentsJson.Length}B");
        _logger.LogInformation("Stelarith cmd: 收到官方 GetClientConfig 指令，上报配置快照 -> {cfg}", cfgBrief);

        // 官方 GetClientConfig 期望客户端经上行流回传配置序列化字节。由于插件不直接持有
        // ClassIsland 上行流句柄，此处通过「主动同步快照」直观呈现当前已下发的配置规模，
        // 并将完整快照写入本地 JSON 供管理端/审计二次落盘（见 ToLocalDumpFile）。完整上行
        // 回传在有集控激活的正式环境里由宿主配置同步器承担，插件负责触发即时刷新。
        Notify("星璃·集控", "已收到配置获取指令，当前同步快照: " + cfgBrief);
        DumpSnapshotToFile();
        return Task.CompletedTask;
    }

    /// <summary>处理 SendNotification（轮询通道：payload 为 JSON）。</summary>
    private Task HandleSendNotificationAsync(string? payload, CancellationToken ct)
    {
        var (title, content) = ParseNotificationText(payload);
        return HandleSendNotificationCore(content ?? payload, title, ct);
    }

    /// <summary>SendNotification 统一核心：提取内嵌 stelarith_task 执行 + 展示通知文案。</summary>
    private async Task HandleSendNotificationCore(string? textContent, string? title, CancellationToken ct)
    {
        // 先尝试提取内嵌 stelarith_task（面板经 send-notification 下发的形态，打包在 MessageContent）
        var task = StelarithDispatch.ExtractTask(textContent);
        if (task is not null)
        {
            _logger.LogInformation("Stelarith cmd: SendNotification 含 stelarith_task.action={action}，执行",
                task.Action);
            await StelarithDispatch.RunAsync(task);
        }

        if (!string.IsNullOrWhiteSpace(textContent) && !LooksLikeTaskJson(textContent))
        {
            var finalTitle = string.IsNullOrWhiteSpace(title) ? "星璃·集控" : title;
            StelarithNotificationProvider.Diag(
                $"处理 SendNotification: title={finalTitle} contentLen={textContent!.Length} provider={(StelarithNotificationProvider.Current is null ? "未就绪(降级)" : "已就绪")}");
            Notify(finalTitle, textContent);
        }
        else if (task is null)
        {
            _logger.LogInformation("Stelarith cmd: SendNotification 无 stelarith_task，仅作通知桥接");
        }
    }

    /// <summary>粗略判断一段文本是否为 stelarith_task JSON（避免把任务当文案展示）。</summary>
    private static bool LooksLikeTaskJson(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return false;
        try
        {
            using var doc = JsonDocument.Parse(s);
            return doc.RootElement.ValueKind == JsonValueKind.Object &&
                   doc.RootElement.TryGetProperty("stelarith_task", out _);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>解析 protobuf wire 格式的 SendNotification，提取 MessageMask(1)/MessageContent(2) 字符串。</summary>
    private static (string? title, string? content) ParseNotificationProto(byte[]? raw)
    {
        if (raw is null || raw.Length == 0) return (null, null);
        string? mask = null, content = null;
        try
        {
            int i = 0;
            while (i < raw.Length)
            {
                int key = ReadVarint(raw, ref i, out bool ok);
                if (!ok) break;
                int field = key >> 3, wire = key & 7;
                switch (wire)
                {
                    case 0: // varint
                        ReadVarint(raw, ref i, out var v1);
                        break;
                    case 1: // 64-bit
                        i += 8;
                        break;
                    case 2: // length-delimited
                        var len = ReadVarint(raw, ref i, out var v2);
                        if (i + len > raw.Length) break;
                        if (field == 1) mask = Encoding.UTF8.GetString(raw, i, len);
                        else if (field == 2) content = Encoding.UTF8.GetString(raw, i, len);
                        i += len;
                        break;
                    case 5: // 32-bit
                        i += 4;
                        break;
                    default:
                        break;
                }
                if (i > raw.Length) break;
            }
        }
        catch
        {
            // 解析失败则返回 null，交给调用方降级
        }
        return (mask, content);
    }

    /// <summary>读取 protobuf varint。</summary>
    private static int ReadVarint(byte[] data, ref int idx, out bool ok)
    {
        ok = false;
        uint result = 0;
        int shift = 0;
        while (shift <= 28)
        {
            if (idx >= data.Length) return 0;
            byte b = data[idx++];
            result |= (uint)(b & 0x7F) << shift;
            if ((b & 0x80) == 0)
            {
                ok = true;
                return (int)result;
            }
            shift += 7;
        }
        return 0;
    }

    private static string BytesToSafeString(byte[] bytes)
    {
        try { return Encoding.UTF8.GetString(bytes); }
        catch { return Encoding.Latin1.GetString(bytes); }
    }

    /// <summary>从 SendNotification 载荷提取 (标题, 正文)。兼容 JSON 与内嵌 stelarith_task 容错。</summary>
    private (string? title, string? content) ParseNotificationText(string? payload)
    {
        if (string.IsNullOrWhiteSpace(payload)) return (null, null);
        try
        {
            using var doc = JsonDocument.Parse(payload);
            var root = doc.RootElement;
            // NotificationPayload 官方字段（proto SendNotification）：
            if (root.ValueKind == JsonValueKind.Object)
            {
                var content = GetString(root, "MessageContent");
                var title = GetString(root, "MessageMask");
                return (title, content);
            }
        }
        catch
        {
            // payload 可能是 protobuf 二进制，非 JSON——不强解析，只作提示
        }
        return (null, payload);
    }

    private static string? GetString(JsonElement el, string prop)
    {
        if (el.ValueKind == JsonValueKind.Object && el.TryGetProperty(prop, out var v))
            return v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        return null;
    }

    /// <summary>把最近同步快照完整写入插件目录下的 stelarith-config-snapshot.json（供管理端/审计复用）。</summary>
    private void DumpSnapshotToFile()
    {
        try
        {
            var dir = AppContext.BaseDirectory;
            var path = System.IO.Path.Combine(dir, "stelarith-config-snapshot.json");
            var snap = StelarithSyncState.Current;
            System.IO.File.WriteAllText(path, JsonSerializer.Serialize(new
            {
                snap.At,
                snap.Ok,
                snap.Error,
                snap.ManifestJson,
                snap.ClassPlanJson,
                snap.ComponentsJson,
            }, new JsonSerializerOptions { WriteIndented = true }), Encoding.UTF8);
            _logger.LogInformation("Stelarith cmd: 配置快照已落盘 {path}", path);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Stelarith cmd: 配置快照落盘失败");
        }
    }

    /// <summary>
    /// 展示一条来自集控的播报。
    ///
    /// 首选 ClassIsland 官方提醒系统（<see cref="StelarithNotificationProvider"/>）——它会在
    /// 教室大屏播放「遮罩 + 正文」，并遵循宿主在【设置】→【提醒】里的开关与时长配置，
    /// 这正是官方集控 SendNotification 的语义。
    ///
    /// 若提供方尚未被 DI 构造（极早期或宿主异常），降级为 Windows 托盘气泡，保证不静默丢失。
    /// </summary>
    private void Notify(string title, string message)
    {
        // ① 官方提醒通道
        var provider = StelarithNotificationProvider.Current;
        if (provider is not null)
        {
            provider.Push(title, message);
            return;
        }

        // ② 降级：系统托盘气泡
        ShowTrayBalloon(title, message);
    }

    // 托盘气泡实例必须长期持有：NotifyIcon 一旦被释放（Dispose），Windows 会连未展示完的
    // 气泡一起撤掉 —— 旧实现用 `using var ni` 在方法返回时就释放，气泡实际从未出现过。
    private static readonly object TrayLock = new();
    private static System.Windows.Forms.NotifyIcon? _trayIcon;

    private static void ShowTrayBalloon(string title, string message)
    {
        try
        {
            lock (TrayLock)
            {
                _trayIcon ??= new System.Windows.Forms.NotifyIcon
                {
                    Icon = System.Drawing.SystemIcons.Information,
                    Visible = true,
                    Text = "星璃·集控",
                };
                _trayIcon.BalloonTipTitle = title;
                _trayIcon.BalloonTipText = message;
                _trayIcon.ShowBalloonTip(4000);
            }
        }
        catch (Exception ex)
        {
            StelarithNotificationProvider.Diag("托盘气泡降级失败: " + ex.Message);
        }
    }

    /// <summary>名字 → 官方数值映射（轮询数据源的 command_type 多为可读名）。</summary>
    internal static int? TypeNameToNumber(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        return name.Trim().ToLowerInvariant() switch
        {
            "restartapp" => CmdRestartApp,
            "sendnotification" => CmdSendNotification,
            "dataupdated" => CmdDataUpdated,
            "getclientconfig" => CmdGetClientConfig,
            _ => null,
        };
    }
}
