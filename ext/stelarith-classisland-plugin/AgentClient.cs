using System;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace StelarithControlPlugin;

/// <summary>
/// 本地代理转发的结果。**失败必须带原因** —— 只回一个 bool 会让上层只能报「没成功」，
/// 而排查时最需要知道的恰恰是「为什么」。
/// </summary>
public sealed class AgentResult
{
    public bool Ok { get; }
    public string Error { get; }

    private AgentResult(bool ok, string error)
    {
        Ok = ok;
        Error = error;
    }

    public static readonly AgentResult Success = new(true, string.Empty);

    public static AgentResult Fail(string reason) => new(false, reason);
}

/// <summary>
/// 与本地代理 StelarithAgent 通信的轻量客户端。
/// 代理只监听 127.0.0.1，不暴露公网；本类仅做 localhost 转发。
/// </summary>
public class AgentClient
{
    // 与 StelarithAgent 约定一致的本地端口（见 ext/stelarith-agent，默认 17999）。
    private const string Base = "http://127.0.0.1:17999";

    // 必须设超时：代理没起来时 HttpClient 默认要等 100s 才失败，
    // 会把命令通道长时间挂住（轮询线程也在等它）。
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(5) };

    private readonly ILogger? _logger;

    public AgentClient(ILogger? logger = null)
    {
        _logger = logger;
    }

    /// <summary>
    /// 转发一条指令给本地代理，并**把失败原因带回来**。
    /// </summary>
    /// <remarks>
    /// 为什么不能只看 HTTP 状态码：代理对「拒绝执行」也返回 HTTP 200 + {"error": "..."}。
    /// 实测至少四种情况走这条路 —— shell 默认关闭、验签失败/防重放、未知动作、VNC 启动失败。
    /// 若只调 EnsureSuccessStatusCode()，这些会全部表现成
    /// 「指令下发成功、HTTP 200，但设备毫无反应」——本系统里最难排查的一类现象。
    /// </remarks>
    public async Task<AgentResult> SendAsync(StelarithTask task)
    {
        try
        {
            using var resp = await Http.PostAsJsonAsync($"{Base}/task", task);
            var body = await resp.Content.ReadAsStringAsync();

            if (!resp.IsSuccessStatusCode)
                return AgentResult.Fail($"本地代理返回 HTTP {(int)resp.StatusCode}");

            var reason = ExtractError(body);
            if (reason is not null)
                return AgentResult.Fail(reason);

            return AgentResult.Success;
        }
        catch (TaskCanceledException)
        {
            return AgentResult.Fail("本地代理无响应（超时 5s）");
        }
        catch (HttpRequestException ex)
        {
            // 当前最可能的一种：代理从未被部署或未被启动。
            // 此前这里只写一行没人看的 stderr，等价于静默失败。
            return AgentResult.Fail(
                $"连不上本地代理（127.0.0.1:17999）：{ex.Message}。" +
                "请确认本机已安装并启动 StelarithAgent。");
        }
        catch (Exception ex)
        {
            if (_logger is not null)
                _logger.LogWarning(ex, "Stelarith: 转发指令到本地代理失败");
            return AgentResult.Fail($"转发本地代理失败：{ex.Message}");
        }
    }

    /// <summary>从代理响应体里提取 error 字段；没有（或非 JSON）返回 null。</summary>
    private static string? ExtractError(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind == JsonValueKind.Object &&
                doc.RootElement.TryGetProperty("error", out var e) &&
                e.ValueKind == JsonValueKind.String)
            {
                var s = e.GetString();
                return string.IsNullOrWhiteSpace(s) ? null : s;
            }
        }
        catch
        {
            // 非 JSON 响应：不当作错误，避免把正常回执误判为失败。
        }
        return null;
    }
}
