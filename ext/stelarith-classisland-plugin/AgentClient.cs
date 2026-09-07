using System;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace StelarithControlPlugin;

/// <summary>
/// 与本地代理 StelarithAgent 通信的轻量客户端。
/// 代理只监听 127.0.0.1，不暴露公网；本类仅做 localhost 转发。
/// </summary>
public class AgentClient
{
    // 与 StelarithAgent 约定一致的本地端口（见 ext/stelarith-agent，默认 17999）。
    private const string Base = "http://127.0.0.1:17999";
    private static readonly HttpClient Http = new();
    private readonly ILogger? _logger;

    public AgentClient(ILogger? logger = null)
    {
        _logger = logger;
    }

    public async Task SendAsync(StelarithTask task)
    {
        // 仅在设备本机转发；token 由面板经网站签发，代理侧验签（见扩展能力设计 §1.2/§3.3）。
        try
        {
            var resp = await Http.PostAsJsonAsync($"{Base}/task", task);
            resp.EnsureSuccessStatusCode();
        }
        catch (Exception ex)
        {
            // 代理未运行等情况：记日志，不阻断 ClassIsland 主流程。
            if (_logger is not null)
                _logger.LogWarning(ex, "Stelarith: 转发指令到本地代理失败");
            else
                Console.Error.WriteLine($"[Stelarith] agent 转发失败: {ex.Message}");
        }
    }
}
