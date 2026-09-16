using System;
using System.Collections.Generic;
using System.Reflection;
using ClassIsland.Core.Abstractions.Services;
using ClassIsland.Core.Enums;
using ClassIsland.Core.Models.Plugin;

namespace StelarithControlPlugin;

/// <summary>插件清单的一行（设置页展示与状态上报共用同一形状）。</summary>
public sealed class PluginRow
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Version { get; set; } = "";
    public string Author { get; set; } = "";
    public string Description { get; set; } = "";
    public bool Enabled { get; set; }
    public string Status { get; set; } = "";
    public string Folder { get; set; } = "";
    /// <summary>是否为星璃集控插件自身（面板对它只读：防关闭）。</summary>
    public bool IsStelarith { get; set; }
    public string? Error { get; set; }
}

/// <summary>
/// ClassIsland 插件清单的**唯一**采集点（设置页与状态心跳都走这里，不各写一套反射）。
///
/// 关于取法的实测结论（SDK 2.1.0.1 与运行版 app-2.1.0.1-0 **签名完全一致**）：
///   · `IPluginService.LoadedPlugins` 是 **public static** 属性，返回
///     `IReadOnlyList&lt;PluginInfo&gt;` —— 这是唯一可编译调用的公开入口，
///     而且因为是静态的，**连 DI 容器都不需要**（宿主在加载插件时就把结果写进了静态注册表）。
///   · `LoadedPluginsInternal` / `LoadedPluginsIds` 是 **nonpub static**，只能反射访问。
///     先试公开的 `LoadedPlugins`，为空时再用反射读 `LoadedPluginsInternal` 兜底。
///
/// 全程 try/catch 且绝不抛出：清单只是展示用信息，不能因为读不到就让心跳或设置页整体失败。
/// </summary>
public static class PluginInventory
{
    /// <summary>星璃插件在 ClassIsland 里的插件 id（= manifest.yml 的 id）。</summary>
    public const string StelarithPluginId = "StelarithControlPlugin";

    /// <summary>采集插件清单快照；取不到返回空列表。</summary>
    public static List<PluginRow> Snapshot()
    {
        var list = new List<PluginRow>();
        foreach (var info in RawInfos())
        {
            try
            {
                var m = info.Manifest;
                var id = m?.Id ?? "";
                list.Add(new PluginRow
                {
                    Id = id,
                    Name = string.IsNullOrWhiteSpace(m?.Name) ? id : m!.Name,
                    Version = m?.Version ?? "",
                    Author = m?.Author ?? "",
                    Description = m?.Description ?? "",
                    Enabled = info.IsEnabled,
                    Status = LoadStatusText(info.LoadStatus),
                    Folder = info.PluginFolderPath ?? "",
                    IsStelarith = string.Equals(id, StelarithPluginId, StringComparison.OrdinalIgnoreCase),
                    Error = info.Exception?.Message,
                });
            }
            catch (Exception ex)
            {
                StelarithControlPlugin.DiagBridge("PluginInventory: 单项读取失败: " + ex.Message);
            }
        }
        return list;
    }

    /// <summary>尽力取到插件信息集合（先公开属性，再反射内部静态属性）。</summary>
    private static IEnumerable<PluginInfo> RawInfos()
    {
        // ① 公开静态属性（首选，编译期绑定，两版本签名一致）
        try
        {
            var viaPublic = IPluginService.LoadedPlugins;
            if (viaPublic is { Count: > 0 }) return viaPublic;
        }
        catch (Exception ex)
        {
            StelarithControlPlugin.DiagBridge("PluginInventory: LoadedPlugins 读取失败: " + ex.Message);
        }

        // ② 反射 nonpub static LoadedPluginsInternal（含宿主内部插件，比公开属性更全）
        try
        {
            var prop = typeof(IPluginService).GetProperty(
                "LoadedPluginsInternal", BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public);
            if (prop?.GetValue(null) is System.Collections.IEnumerable seq)
            {
                var list = new List<PluginInfo>();
                foreach (var item in seq)
                {
                    if (item is PluginInfo pi) list.Add(pi);
                }
                if (list.Count > 0) return list;
            }
        }
        catch (Exception ex)
        {
            StelarithControlPlugin.DiagBridge("PluginInventory: LoadedPluginsInternal 反射失败: " + ex.Message);
        }

        return Array.Empty<PluginInfo>();
    }

    private static string LoadStatusText(PluginLoadStatus status) => status switch
    {
        PluginLoadStatus.Loaded => "已加载",
        PluginLoadStatus.Disabled => "已禁用",
        PluginLoadStatus.Error => "加载出错",
        PluginLoadStatus.NotLoaded => "未加载",
        _ => status.ToString(),
    };
}
