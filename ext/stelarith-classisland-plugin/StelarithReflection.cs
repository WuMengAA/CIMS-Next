using System;
using System.IO;
using System.Linq;
using System.Reflection;
using ClassIsland.Core.Abstractions.Services;

namespace StelarithControlPlugin;

/// <summary>
/// 宿主服务与路径的反射定位器 —— 插件与 ClassIsland 版本解耦的唯一入口。
///
/// 背景：插件编译期只引用 `ClassIsland.Core`（抽象包），但很多可用能力实际落在宿主
/// 实现程序集（`ClassIsland.dll`）的具体类型上，且各版本签名可能漂移。把这些
/// 「按名字找东西」的逻辑集中到这里，业务代码只调本类，任何一处命中失败都能优雅降级，
/// 不会因为版本差异导致插件编译期/运行期硬失败。
///
/// 已知事实（本机 2.1.0.1 实测，反射确认）：
///   · 档案服务实现类：`ClassIsland.Services.ProfileService`（在宿主 ClassIsland.dll 的
///     `ClassIsland.Services` 命名空间，**不在** Core 抽象包里）
///       属性  Profile : ClassIsland.Shared.Models.Profile.Profile
///       属性  CurrentProfilePath : string
///       方法  SaveProfile() / SaveProfile(string) / LoadProfileAsync() : Task
///   · 数据目录：宿主启动参数 `-d &lt;dir&gt;`（本机 = D:\Classlsland\data）。
///
/// ⚠️ 定位策略（实测踩坑）：**不能只在同步线程里查 DI**。
///   档案服务由宿主在启动早期构建，而本插件的同步循环跑在静态守护线程上
///   （见 StelarithSyncService 的存活机制说明），两条线不共享 DI 作用域，
///   早期查不到就会一直失败。因此改为三条路并行：
///     ① 由宿主 DI 直接构造过的服务在我们这里**注册进来的引用**（StelarithReflection.Register）
///     ② 全局容器：`ClassIsland.AppBase.Current` / `AppBase.Services`（宿主公开的静态容器）
///     ③ 全程序集扫描 `ClassIsland.Services.ProfileService` 类型，取其实例字段兜底
///   任一命中即缓存。**降级不抛异常**是硬要求——写回失败绝不能连累宿主启动。
/// </summary>
internal static class StelarithReflection
{
    private static readonly object ResolveLock = new();
    private static bool _resolved;

    /// <summary>宿主档案服务实例（IProfileService）。</summary>
    public static object? ProfileService { get; private set; }

    /// <summary>宿主数据目录（含 Profiles/Config/Plugins 子目录）。</summary>
    public static string? DataDirectory { get; private set; }

    /// <summary>是否已成功定位到档案服务。</summary>
    public static bool ProfileServiceAvailable => ProfileService is not null;

    private static IServiceProvider? _registeredProvider;

    /// <summary>
    /// 由插件 Initialize 阶段注入的 IServiceProvider（宿主 DI 根容器）。
    /// 这是最可靠的路径：宿主的 IProfileService 一定注册在它里面。
    /// </summary>
    public static void RegisterProvider(IServiceProvider sp)
    {
        if (sp is null) return;
        _registeredProvider = sp;
        _resolved = false; // 允许用新容器重试
        Diag("RegisterProvider: 已登记宿主 IServiceProvider");
    }

    /// <summary>尝试解析宿主服务（幂等、可反复调用，每次写回前调用）。</summary>
    public static void EnsureResolved(IServiceProvider? sp = null)
    {
        if (_resolved && ProfileService is not null) return;
        lock (ResolveLock)
        {
            if (ProfileService is null)
            {
                Diag($"EnsureResolved: registeredProvider={(_registeredProvider is null ? "null" : _registeredProvider.GetType().FullName)}, argProvider={(sp is null ? "null" : sp.GetType().FullName)}");
                ProfileService = ResolveProfileService(sp ?? _registeredProvider);
            }
            DataDirectory ??= ResolveDataDirectory();
            if (ProfileService is not null) _resolved = true;
        }
    }

    /// <summary>
    /// 从已登记的宿主 DI 容器取任意服务（取不到返回 null，绝不抛异常）。
    ///
    /// 用途：状态上报要枚举 ClassIsland 的真实插件清单（`IPluginService`），
    /// 而这个服务只存在于宿主容器里，插件自己的静态守护线程没有 DI 作用域。
    /// 与档案服务同一套路：容器引用由 <see cref="RegisterProvider"/> 在宿主构建期间登记。
    /// </summary>
    public static object? TryGetService(Type serviceType)
    {
        if (serviceType is null) return null;
        var provider = _registeredProvider;
        if (provider is null) return null;
        try
        {
            return provider.GetService(serviceType);
        }
        catch (Exception ex)
        {
            Diag($"TryGetService({serviceType.Name}) 失败: {ex.Message}");
            return null;
        }
    }

    /// <summary>泛型便捷重载：取不到即 null（调用方需自行判空降级）。</summary>
    public static T? TryGetService<T>() where T : class => TryGetService(typeof(T)) as T;

    /// <summary>
    /// 定位档案服务，五条路径依次尝试（任一命中即返回）：
    ///   ① 传入的 / 已登记的 IServiceProvider 取 IProfileService
    ///   ② 同上但取实现类 `ClassIsland.Services.ProfileService`
    ///   ③ 宿主公开静态容器 AppBase.Current / AppBase.Services
    ///   ④ 已加载程序集里 ProfileService 的**静态属性/字段**（宿主管着单例时可用）
    ///   ⑤ 全程序集扫描 + 从任意持有者实例字段里挖（最后手段）
    /// </summary>
    private static object? ResolveProfileService(IServiceProvider? sp)
    {
        // ① / ② 经 DI 容器
        foreach (var provider in new[] { sp, _registeredProvider })
        {
            if (provider is null) continue;
            try
            {
                var byInterface = provider.GetService(typeof(IProfileService));
                if (byInterface is not null)
                {
                    Diag("ProfileService 经 DI(IProfileService) 命中: " + byInterface.GetType().FullName);
                    return byInterface;
                }
            }
            catch (Exception ex) { Diag("DI 取 IProfileService 失败: " + ex.Message); }

            var implType = FindProfileServiceImplType();
            if (implType is not null)
            {
                try
                {
                    var inst = provider.GetService(implType);
                    if (inst is not null)
                    {
                        Diag("ProfileService 经 DI(实现类) 命中: " + implType.FullName);
                        return inst;
                    }
                }
                catch (Exception ex) { Diag("DI 取实现类失败: " + ex.Message); }
            }
        }

        var impl = FindProfileServiceImplType();
        if (impl is null)
        {
            Diag("ProfileService 实现类未找到（档案写回将降级为只存快照）");
            return null;
        }

        // ③ 宿主公开静态容器（AppBase 系列）
        try
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type? appBase;
                try { appBase = asm.GetType("ClassIsland.AppBase", false); }
                catch { continue; }
                if (appBase is null) continue;

                foreach (var memberName in new[] { "Current", "Instance", "Default" })
                {
                    var holder = appBase.GetProperty(memberName,
                                       BindingFlags.Public | BindingFlags.Static)?.GetValue(null)
                                 ?? appBase.GetField(memberName,
                                       BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
                    if (holder is null) continue;

                    var services = holder.GetType()
                        .GetProperty("Services", BindingFlags.Public | BindingFlags.Instance)
                        ?.GetValue(holder) as IServiceProvider;
                    var inst = services?.GetService(impl);
                    if (inst is not null)
                    {
                        Diag($"ProfileService 经 AppBase.{memberName}.Services 命中");
                        return inst;
                    }
                    if (holder.GetType().IsInstanceOfType(null)) continue;
                    // AppBase 自身可能就是服务容器实现
                    if (holder is IServiceProvider hp)
                    {
                        var inst2 = hp.GetService(impl);
                        if (inst2 is not null)
                        {
                            Diag($"ProfileService 经 AppBase.{memberName}(IServiceProvider) 命中");
                            return inst2;
                        }
                    }
                }
            }
        }
        catch (Exception ex) { Diag("AppBase 静态容器探测失败: " + ex.Message); }

        // ④ 实现类自身的静态属性/字段（宿管成单例时存在）
        foreach (var name in new[] { "Current", "Instance", "Default", "Singleton" })
        {
            try
            {
                var v = impl.GetProperty(name, BindingFlags.Public | BindingFlags.Static)?.GetValue(null)
                        ?? impl.GetField(name, BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
                if (v is not null && impl.IsInstanceOfType(v))
                {
                    Diag($"ProfileService 经静态成员 {name} 命中");
                    return v;
                }
            }
            catch { /* 继续下一个名字 */ }
        }

        Diag("ProfileService 未命中（档案写回将降级为只存快照）");
        return null;
    }

    private static Type? FindProfileServiceImplType()
    {
        foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
        {
            try
            {
                var t = asm.GetType("ClassIsland.Services.ProfileService", false);
                if (t is not null) return t;
            }
            catch { /* 该程序集可能部分加载失败 */ }
        }
        return null;
    }

    /// <summary>
    /// 解析宿主数据目录。顺序：
    ///   ① 命令行 `-d &lt;dir&gt;`（ClassIsland 官方启动参数）
    ///   ② `AppContext.BaseDirectory` 下的 `data` 子目录
    ///   ③ BaseDirectory 自身（若含 Profiles 子目录）
    /// </summary>
    private static string? ResolveDataDirectory()
    {
        try
        {
            var args = Environment.GetCommandLineArgs();
            for (var i = 0; i < args.Length - 1; i++)
            {
                if (args[i] is "-d" or "--data" or "--data-dir")
                {
                    var d = Path.GetFullPath(args[i + 1]);
                    if (Directory.Exists(d))
                    {
                        Diag("数据目录经启动参数命中: " + d);
                        return d;
                    }
                }
            }
        }
        catch (Exception ex) { Diag("解析 -d 参数失败: " + ex.Message); }

        var baseDir = AppContext.BaseDirectory;
        var candidates = new[]
        {
            Path.Combine(baseDir, "data"),
            baseDir,
        };
        foreach (var c in candidates)
        {
            try
            {
                if (Directory.Exists(Path.Combine(c, "Profiles")) ||
                    Directory.Exists(Path.Combine(c, "Config")))
                {
                    Diag("数据目录经自检命中: " + c);
                    return c;
                }
            }
            catch { /* 继续 */ }
        }

        Diag("数据目录未命中，退用 BaseDirectory: " + baseDir);
        return baseDir;
    }

    /// <summary>文件诊断：写 <c>ste-reflect-diag.log</c>。</summary>
    private static void Diag(string msg)
    {
        try
        {
                StelarithLog.Write("ste-reflect-diag.log", msg);
        }
        catch { /* 忽略 */ }
    }
}
