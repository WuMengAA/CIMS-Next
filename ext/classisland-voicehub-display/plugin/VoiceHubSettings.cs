using System.ComponentModel;

namespace VoiceHub.Display;

/// <summary>
/// 组件设置：桥接代理地址与刷新间隔。
/// 桥接代理（bridge/bridge.mjs）在班级电脑本地运行，轮询 voicehub 并暴露 JSON。
/// </summary>
public class VoiceHubSettings : INotifyPropertyChanged
{
    private string _bridgeUrl = "http://localhost:8787/api/songboard";
    private int _refreshSec = 5;

    public string BridgeUrl
    {
        get => _bridgeUrl;
        set { _bridgeUrl = value; OnChanged(); }
    }

    public int RefreshSec
    {
        get => _refreshSec;
        set { _refreshSec = Math.Clamp(value, 1, 60); OnChanged(); }
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnChanged() => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(null));
}
