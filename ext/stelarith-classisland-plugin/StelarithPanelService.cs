using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Threading;
using ClassIsland.Core.Abstractions.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控面板入口：在 ClassIsland 的两处 UI 加入「集控面板」入口。
///  1) 设置页侧边栏：注册一个 External 类别的设置页（含「打开集控面板」按钮）；
///  2) 右键状态栏（托盘）图标菜单：追加「星璃·集控面板」菜单项。
///
/// 面板地址可配置：优先读插件目录下 stelarith-panel.json 的 panelUrl；
/// 缺省回落到**公网** web 面板地址（https://www.245959623.xyz/admin/console）。
///
/// 健壮性说明：宿主把各插件的 IHostedService 集中在同一个 Host 统一启动，
/// 若其它插件的宿主服务在启动期抛异常（例如 AIIsland 的考试通知过滤服务经实测会在
/// 非 UI 线程访问 Avalonia 属性触发 "Call from invalid thread"，进而连累本插件
/// StartAsync 不能按序执行），则把 UI 注入从 StartAsync 移出，改用重试式定时
/// Dispatcher 注入，确保托盘入口最终能挂上。诊断标记直接写文件，不依赖宿主 logger。
/// </summary>
public sealed class StelarithPanelService : IHostedService
{
    private readonly ILogger<StelarithPanelService> _logger;
    // 注入逻辑可能由静态重试线程调用，因此用静态服务定位器（运行时经构造赋值）
    private static IServiceProvider _sp = null!;

    public StelarithPanelService(ILogger<StelarithPanelService> logger, IServiceProvider sp)
    {
        _logger = logger;
        _sp = sp;
    }

    /// <summary>面板菜单项显示名。</summary>
    public const string PanelEntryDisplayName = "星璃·集控面板";

    /// <summary>「最近消息」托盘菜单项显示名。</summary>
    public const string MessageEntryDisplayName = "星璃·最近消息";

    /// <summary>托盘入口是否已经成功注入（供其它服务查询，避免重复注入）。</summary>
    public static bool TrayEntryInjected { get; private set; }

    /// <summary>诊断日志：写插件目录 ste-panel-diag.log，不依赖宿主 logger，绕开日志被宿主 Dispose 丢失的问题。</summary>
    internal static void Diag(string msg)
    {
        try
        {
            StelarithLog.Write("ste-panel-diag.log", msg);
        }
        catch { /* 诊断日志写入失败忽略 */ }
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        Diag("StartAsync entered");
        // 不依赖宿主 logger，直接写文件是最可靠的证据
        try
        {
            // 立即尝试一次；若 UI 未就绪，由 RetryLoop 兜底补注
            Dispatcher.UIThread.Post(TryInjectOnce);
        }
        catch (Exception ex)
        {
            Diag("StartAsync Dispatcher.Post faile: " + ex.Message);
        }
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    /// <summary>
    /// 在 UI 线程尝试注入托盘菜单入口。托盘菜单容器（MoreOptionsMenuItems）可能在主窗口完全
    /// 就绪前尚不可用，故失败后不重抛，交由 RetryLoop 周期重试直至成功或超时。
    /// 本方法为静态（供静态重试线程调用）。
    /// </summary>
    private static void TryInjectOnce()
    {
        try
        {
            if (TrayEntryInjected) return;
            if (_sp.GetService<ITaskBarIconService>() is not { } taskBarIcon)
            {
                Diag("TryInjectOnce: ITaskBarIconService is null (host not ready)");
                return;
            }

            if (taskBarIcon.MoreOptionsMenuItems is { } items)
            {
                var added = false;

                // ① 集控面板入口
                if (!HasMenuItems(items, PanelEntryDisplayName))
                {
                    var trayMenuItem = new NativeMenuItem { Header = PanelEntryDisplayName };
                    trayMenuItem.Click += (_, _) => OpenPanel();
                    items.Add(trayMenuItem);
                    added = true;
                    _sp.GetService<ILogger<StelarithPanelService>>()?
                        .LogInformation("Stelarith panel: 已向托盘右键菜单注入「{Name}」入口", PanelEntryDisplayName);
                }

                // ② 「最近消息」入口：直接在岛内弹出最近一条广播（不打开浏览器）
                if (!HasMenuItems(items, MessageEntryDisplayName))
                {
                    var msgItem = new NativeMenuItem { Header = MessageEntryDisplayName };
                    msgItem.Click += (_, _) => ShowLatestMessage();
                    items.Add(msgItem);
                    added = true;
                    _sp.GetService<ILogger<StelarithPanelService>>()?
                        .LogInformation("Stelarith panel: 已向托盘右键菜单注入「{Name}」入口", MessageEntryDisplayName);
                }

                TrayEntryInjected = true;
                if (added) Diag("TryInjectOnce: SUCCESS tray entries added");
                else Diag("TryInjectOnce: entries already exist");
            }
            else
            {
                Diag("TryInjectOnce: MoreOptionsMenuItems is null (retry later)");
            }
        }
        catch (Exception ex)
        {
            Diag("TryInjectOnce exception: " + ex);
        }
    }

    /// <summary>菜单集合里是否已存在同 Header 的项（防重复注入）。</summary>
    private static bool HasMenuItems(System.Collections.IEnumerable items, string header)
    {
        foreach (var it in items)
        {
            if (it is NativeMenuItem nm &&
                string.Equals(Convert.ToString(nm.Header), header, StringComparison.Ordinal))
                return true;
        }
        return false;
    }

    /// <summary>
    /// 在岛内弹出最近一条广播。数据经只读消息端点拉取，弹出走官方提醒提供方
    /// （StelarithNotificationProvider），因此教室里看到的是与集控下发同款的遮罩播报。
    /// </summary>
    private static void ShowLatestMessage() => ShowLatestMessageForUi(null);

    /// <summary>
    /// 同上，但把结果回灌给调用方（设置页用它把"弹了什么/为什么没弹"显示在页面上）。
    ///
    /// ⚠️ **必须离开 UI 线程拉网络**：托盘菜单的 <c>Click</c> 与设置页按钮回调跑在
    /// Avalonia **UI 线程**，而 <see cref="StelarithMessageFeed.Fetch"/> 是同步阻塞版
    /// （内部 <c>GetAwaiter().GetResult()</c> 拉公网）。在 UI 线程直接调用会在
    /// 公网慢/无响应时**把 UI 事件循环整个卡死** —— 表现为「界面加载不出来、
    /// 托盘图标点不动、窗口无响应」（2026-09-18 现场实测）。这里一律经
    /// <c>Task.Run</c> 放到线程池，网络期间 UI 线程保持可响应，结果再切回 UI 线程。
    /// </summary>
    public static void ShowLatestMessageForUi(Action<string>? feedback)
    {
        try
        {
            var opt = StelarithSyncOptions.Load();
            _ = Task.Run(() =>
            {
                try
                {
                    var feed = StelarithMessageFeed.Fetch(opt, 5);
                    if (!feed.Ok || feed.Messages.Count == 0)
                    {
                        var msg = feed.Ok ? "暂无最近消息。" : $"拉取失败：{feed.Error}";
                        StelarithNotificationProvider.Current?.Push(StelarithBranding.SourceName, msg, 5);
                        feedback?.Invoke(msg);
                        Diag("ShowLatestMessage: " + msg);
                        return;
                    }
                    var latest = feed.Messages[0];
                    StelarithNotificationProvider.Current?.Push(
                        string.IsNullOrWhiteSpace(latest.Title) ? StelarithBranding.SourceName : latest.Title,
                        latest.Content,
                        8);
                    feedback?.Invoke($"已弹出最近一条：{latest.Content}");
                    Diag("ShowLatestMessage: 已弹出最近一条 " + latest.Content);
                }
                catch (Exception ex)
                {
                    Diag("ShowLatestMessage exception: " + ex.Message);
                    feedback?.Invoke("弹出失败：" + ex.Message);
                }
            });
        }
        catch (Exception ex)
        {
            Diag("ShowLatestMessage setup exception: " + ex.Message);
            feedback?.Invoke("弹出失败：" + ex.Message);
        }
    }

    /// <summary>当前生效的集控面板 Web 地址（可配置；默认走公网站点）。</summary>
    public static string CurrentPanelUrl { get; private set; } = "https://www.245959623.xyz/admin/console";

    static StelarithPanelService()
    {
        CurrentPanelUrl = LoadPanelUrl();
        Diag($"ctor: panelUrl={CurrentPanelUrl}");

        // 兜底重试循环：启动后每 2s 重试注入，最长 60s，确保托盘入口最终挂上
        var t = new Thread(() =>
        {
            try
            {
                var deadline = DateTime.UtcNow.AddSeconds(60);
                while (DateTime.UtcNow < deadline && !TrayEntryInjected)
                {
                    Thread.Sleep(2000);
                    try { Dispatcher.UIThread.Post(TryInjectOnce); }
                    catch { }
                }
                if (!TrayEntryInjected) Diag("RetryLoop: timeout without injecting tray entry");
                else Diag("RetryLoop: tray entry injected (or already existed)");
            }
            catch (Exception ex) { Diag("RetryLoop exception: " + ex.Message); }
        });
        t.IsBackground = true;
        t.Start();
    }

    private static string LoadPanelUrl()
    {
        try
        {
            var baseDir = StelarithLog.ConfigDir!;
            var cfg = Path.Combine(baseDir, "stelarith-panel.json");
            if (File.Exists(cfg))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(cfg));
                if (doc.RootElement.TryGetProperty("panelUrl", out var u))
                    return u.GetString() ?? CurrentPanelUrl;
            }
        }
        catch (Exception)
        {
            // 配置读取失败则用默认地址
        }
        return CurrentPanelUrl;
    }

    /// <summary>以默认浏览器打开集控面板。</summary>
    public static void OpenPanel()
    {
        try
        {
            Process.Start(new ProcessStartInfo(CurrentPanelUrl) { UseShellExecute = true });
        }
        catch (Exception)
        {
            // 打开失败忽略（可能是静默环境），不抛出
        }
    }
}
