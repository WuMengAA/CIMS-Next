using System;
using System.Threading;
using System.Threading.Tasks;
using ClassIsland.Core.Abstractions.Services;
using ClassIsland.Core.Abstractions.Services.Management;
using ClassIsland.Shared.Abstraction.Services;
using ClassIsland.Shared.Interfaces;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace StelarithControlPlugin;

/// <summary>
/// 宿主启动后运行的后台服务：取得已构建的 IManagementService，订阅集控命令通道，
/// 并把星璃·集控注册为通知提供方。命令到达时解析 stelarith_task 并交 StelarithDispatch 执行。
/// </summary>
public class StelarithCommandHost : BackgroundService
{
    private readonly ILogger<StelarithCommandHost> _logger;
    private readonly IManagementService _management;
    private readonly INotificationHostService? _notificationHost;
    private readonly INotificationProvider _provider;

    public StelarithCommandHost(
        ILogger<StelarithCommandHost> logger,
        IManagementService management,
        INotificationHostService? notificationHost,
        INotificationProvider provider)
    {
        _logger = logger;
        _management = management;
        _notificationHost = notificationHost;
        _provider = provider;
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // 订阅集控命令通道
        var conn = _management.Connection;
        if (conn is not null)
        {
            // lambda 订阅：编译器自动推断事件参数为 ClientCommandEventArgs，无需显式 using 其命名空间
            conn.CommandReceived += (_, e) =>
            {
                try
                {
                    // dynamic 安全提取命令载荷，避免写死版本相关字段名导致编译失败。
                    dynamic dyn = e;
                    string? payload = SafeStr(dyn?.Payload) ?? SafeStr(dyn?.Command?.Payload);
                    string? action = SafeStr(dyn?.Action);
                    var task = StelarithDispatch.Parse(payload ?? action ?? "");
                    _ = StelarithDispatch.RunAsync(task);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Stelarith: 解析/执行集控命令失败，已忽略该条");
                }
            };
            _logger.LogInformation("Stelarith: 已订阅集控命令通道 CommandReceived");
        }
        else
        {
            // 设备可能尚未加入集控或连接尚未建立；记录待后续排查（连接就绪后由宿主重连触发）。
            _logger.LogWarning("Stelarith: 集控连接暂不可用，命令通道未订阅（设备可能未加入集控）");
        }

        // 注册为通知提供方（展示侧），使星璃指令出现在 ClassIsland 通知中心
        try
        {
            _notificationHost?.RegisterNotificationProvider(_provider);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Stelarith: 注册通知提供方失败（不影响命令执行）");
        }

        return Task.CompletedTask;
    }

    private static string? SafeStr(object? o) => o?.ToString();
}
