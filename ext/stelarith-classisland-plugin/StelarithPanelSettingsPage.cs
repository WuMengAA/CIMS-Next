using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using ClassIsland.Core.Abstractions.Controls;
using ClassIsland.Core.Attributes;
using ClassIsland.Core.Enums.SettingsWindow;

namespace StelarithControlPlugin;

/// <summary>
/// 星璃·集控面板设置页（展示于 ClassIsland 设置窗口侧边栏，Category=External）。
/// 为规避 Avalonia XAML 编译链路，页面内容用纯 C# 构建：标题 + 说明 + 「打开集控面板」按钮。
/// 点击按钮调用 <see cref="StelarithPanelService.OpenPanel"/> 在默认浏览器打开集控面板。
/// </summary>
[SettingsPageInfo(
    "stelarith_panel",
    "星璃·集控面板",
    false,
    SettingsPageCategory.External)]
public class StelarithPanelSettingsPage : SettingsPageBase
{
    public StelarithPanelSettingsPage()
    {
        var title = new TextBlock
        {
            Text = "星璃·集控面板",
            FontSize = 26,
            FontWeight = FontWeight.Bold,
            Foreground = Brushes.White,
        };

        var desc = new TextBlock
        {
            Text = "打开电教委员集控面板，可遥控本机执行锁屏 / 截图 / 远程控制等操作。\n" +
                   "面板地址可在插件目录下的 stelarith-panel.json 中调整（panelUrl）。",
            FontSize = 14,
            Foreground = new SolidColorBrush(Color.FromArgb(200, 255, 255, 255)),
            TextWrapping = TextWrapping.Wrap,
        };

        var openBtn = new Button
        {
            Content = "打开集控面板",
            FontSize = 16,
            Padding = new Avalonia.Thickness(16, 8),
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        openBtn.Click += (_, _) => StelarithPanelService.OpenPanel();

        var stack = new StackPanel
        {
            Spacing = 16,
            Margin = new Avalonia.Thickness(8),
            Children =
            {
                title,
                desc,
                openBtn,
            },
        };

        Content = stack;
    }
}
