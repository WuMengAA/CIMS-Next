<#
=====================================================================
 星璃集控 · 回滚（把插件/配置恢复到之前的状态）
=====================================================================
 用途：升级后出问题时，一条命令退回上一个可用状态。
       升级脚本每次替换都会在插件目录留下 .bak-<时间戳>\，本脚本就是它们的还原器。

 用法：
   powershell -ExecutionPolicy Bypass -File rollback.ps1                 # 列出所有备份
   powershell -ExecutionPolicy Bypass -File rollback.ps1 -Last           # 恢复到最近一次备份
   powershell -ExecutionPolicy Bypass -File rollback.ps1 -FromBackup "D:\ClassIsland\data\Plugins\StelarithControlPlugin\.bak-20260916-101530"
   powershell -ExecutionPolicy Bypass -File rollback.ps1 -RestoreSyncOnly  # 只把同步配置恢复成出厂部署值

 说明：本脚本只动「程序文件」和「插件配置」，不会碰课表档案（Profiles）与宿主设置（Settings.json，
       它有独立的 .before-deploy-* 备份，需要时手工还原）。
=====================================================================
#>
[CmdletBinding()]
param(
    [string]$InstallRoot = '',
    [switch]$Last,
    [string]$FromBackup = '',
    [switch]$RestoreSyncOnly,
    [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib-common.ps1')

Write-Head '星璃集控 · 回滚'

if (-not $InstallRoot) { $InstallRoot = Find-ClassIslandRoot }
if (-not $InstallRoot -or -not (Test-Path -LiteralPath $InstallRoot)) {
    Write-Err '未找到 ClassIsland 安装目录，请用 -InstallRoot 指定。'
    exit 1
}
$pluginDir = Join-Path (Join-Path $InstallRoot 'data') $script:PLUGIN_DIRREL
Write-Ok ('插件目录：' + $pluginDir)

# ---------------------------------------------------------------- 只恢复同步配置
if ($RestoreSyncOnly) {
    $pkgRoot = Split-Path -Parent $PSScriptRoot
    $cfg = Get-DeployConfig (Join-Path $pkgRoot 'config\deployment.json')
    if (-not $cfg.ServerBase) {
        Write-Err '部署包配置里没有 ServerBase，无法恢复。请改用 -FromBackup 指定要还原的备份目录。'
        exit 2
    }
    foreach ($f in @('stelarith-sync.json', 'stelarith-panel.json')) {
        $p = Join-Path $pluginDir $f
        if (Test-Path -LiteralPath $p) { Write-Info ('已备份 ' + (Split-Path -Leaf (Backup-File $p 'before-rollback'))) }
    }
    $sync = [ordered]@{
        ClientAppBase = $cfg.ServerBase; BaseDomain = $cfg.BaseDomain; Slug = $cfg.Slug
        ClientUid = $(if ($cfg.ClientUid) { $cfg.ClientUid } else { Get-ClientUidDefault })
        ClassPlanName = $(if ($cfg.ClassPlanName) { $cfg.ClassPlanName } else { 'default_classplan' })
        ComponentsName = 'default_components'; RefreshIntervalSeconds = 30; ResourceWriteBack = $true
        MessageFeedBase = ''; NotificationSourceName = $cfg.NotificationSourceName
        VoiceHubBase = $cfg.VoiceHubBase; VoiceHubKey = $cfg.VoiceHubKey
        SongboardResource = 'songboard'; SongboardRefreshSeconds = 15
    }
    Save-JsonFile -Path (Join-Path $pluginDir 'stelarith-sync.json') -Object $sync
    Save-JsonFile -Path (Join-Path $pluginDir 'stelarith-panel.json') -Object ([ordered]@{ panelUrl = $cfg.ServerPanel })
    Write-Ok '同步配置与面板地址已按部署包恢复'
    if (-not $NoRestart) {
        Write-Step '重启 ClassIsland 使配置生效'
        $null = Stop-ClassIsland
        $p = Start-ClassIsland -Root $InstallRoot
        if ($p) { Write-Ok ('已重启（PID ' + $p.Id + '）') } else { Write-Warn '请手工启动 ClassIsland。' }
    }
    exit 0
}

# ---------------------------------------------------------------- 找备份
$backups = @()
if (Test-Path -LiteralPath $pluginDir) {
    $backups = @(Get-ChildItem -LiteralPath $pluginDir -Directory -Filter '.bak-*' -ErrorAction SilentlyContinue |
                 Sort-Object Name -Descending)
}

Write-Head '可用备份列表'
if ($backups.Count -eq 0) {
    Write-Warn '插件目录下没有任何 .bak-* 备份。'
    Write-Info '备份由「4-升级.cmd」在每次替换前自动创建；如果从未升级过，就没有可回滚的目标。'
} else {
    $i = 1
    foreach ($b in $backups) {
        $mv = Join-Path $b.FullName 'manifest.yml'
        $ver = ''
        if (Test-Path -LiteralPath $mv) {
            $m = Select-String -LiteralPath $mv -Pattern '^\s*version:\s*(.+)$' | Select-Object -First 1
            if ($m) { $ver = $m.Matches[0].Groups[1].Value.Trim() }
        }
        $hasDll = Test-Path -LiteralPath (Join-Path $b.FullName 'StelarithControlPlugin.dll')
        Write-Host ("   [" + $i + "] " + $b.Name + "    版本 " + $(if ($ver) { $ver } else { '?' }) + $(if ($hasDll) { '' } else { '  （无 DLL，仅配置）' })) -ForegroundColor White
        $i = $i + 1
    }
}

# 决定用哪个备份
$target = $null
if ($FromBackup) {
    if (-not (Test-Path -LiteralPath $FromBackup)) { Write-Err ('指定备份目录不存在：' + $FromBackup); exit 2 }
    $target = Get-Item -LiteralPath $FromBackup
} elseif ($Last) {
    if ($backups.Count -eq 0) { Write-Err '没有可用的备份。'; exit 2 }
    $target = $backups[0]
} else {
    if ($backups.Count -eq 0) { exit 0 }
    Write-Host ''
    $sel = Read-Host ('  输入要恢复的编号（1-' + $backups.Count + '，回车取消）')
    if ([string]::IsNullOrWhiteSpace($sel)) { Write-Info '已取消。'; exit 0 }
    $n = 0
    if (-not [int]::TryParse($sel, [ref]$n) -or $n -lt 1 -or $n -gt $backups.Count) { Write-Err '编号无效。'; exit 2 }
    $target = $backups[$n - 1]
}

Write-Head ('准备恢复：' + $target.Name)
Write-Info '目标：把该备份里的插件文件与配置覆盖回插件目录'

# ---------------------------------------------------------------- 停进程
Write-Step '停止 ClassIsland'
$wasRunning = (Get-ClassIslandProcess).Count -gt 0
if ($wasRunning) {
    if (Stop-ClassIsland) { Write-Ok '已停止' } else { Write-Err '进程未退出，无法替换 DLL。'; exit 3 }
} else {
    Write-Ok '进程未运行'
}

# ---------------------------------------------------------------- 先备份当前状态，再恢复
Write-Step '先把「当前」状态也备份一份（万一想再切回来）'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$preDir = Join-Path $pluginDir ('.bak-before-rollback-' + $stamp)
New-Item -ItemType Directory -Path $preDir -Force | Out-Null
foreach ($f in @('StelarithControlPlugin.dll', 'StelarithControlPlugin.deps.json', 'StelarithControlPlugin.pdb', 'manifest.yml', 'stelarith-sync.json', 'stelarith-panel.json')) {
    $p = Join-Path $pluginDir $f
    if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $preDir -Force }
}
Write-Ok ('当前状态已备份到 ' + $preDir)

# ---------------------------------------------------------------- 恢复
Write-Step '把备份内容覆盖回插件目录'
$restored = 0
foreach ($f in @('StelarithControlPlugin.dll', 'StelarithControlPlugin.deps.json', 'StelarithControlPlugin.pdb', 'manifest.yml', 'stelarith-sync.json', 'stelarith-panel.json')) {
    $s = Join-Path $target.FullName $f
    if (Test-Path -LiteralPath $s) {
        Copy-Item -LiteralPath $s -Destination (Join-Path $pluginDir $f) -Force
        Write-Info ('  恢复 ' + $f)
        $restored = $restored + 1
    }
}
Write-Ok ('共恢复 ' + $restored + ' 个文件')

$mv = Join-Path $pluginDir 'manifest.yml'
if (Test-Path -LiteralPath $mv) {
    $m = Select-String -LiteralPath $mv -Pattern '^\s*version:\s*(.+)$' | Select-Object -First 1
    if ($m) { Write-Ok ('当前插件版本：' + $m.Matches[0].Groups[1].Value.Trim()) }
}

# 说明：本脚本只还原「插件」，**不还原本地代理** —— 代理装在 <安装根>\agent\，是独立程序。
# 有意为之：回滚路径最需要的属性是「确定性」，多动一份文件就多一个失败点。
# 而且插件与代理之间只是 127.0.0.1 上的 HTTP 契约，版本可以各自独立。
$agentExe = Get-AgentExePath $InstallRoot
if (Test-Path -LiteralPath $agentExe) {
    Write-Host ''
    Write-Info '本地代理未参与本次回滚（独立程序，装在 agent\ 下）。'
    $abak = Get-ChildItem -LiteralPath (Split-Path -Parent $agentExe) -Filter 'stelarith-agent.exe.before-deploy-*' -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending | Select-Object -First 1
    if ($abak) {
        Write-Info ('  如需一并回退代理：把 ' + $abak.Name + ' 改名覆盖回 stelarith-agent.exe，')
        Write-Info ('  再执行  Restart-ScheduledTask -TaskName ' + $script:AGENT_TASK + '  （或重新登录）。')
    }
}

# ---------------------------------------------------------------- 重启
Write-Head '重启并校验'
if ($NoRestart) {
    Write-Warn '按参数要求不自动启动。'
} else {
    $p = Start-ClassIsland -Root $InstallRoot -WaitSeconds 25
    if ($p) {
        Write-Ok ('ClassIsland 已启动（PID ' + $p.Id + '）')
    } else {
        Write-Err '未能启动，请手工双击桌面快捷方式。'
    }
}

Write-Host ''
Write-Host '  回滚完成。若问题依旧，请跑「2-环境自检.cmd」并把结果发给集控管理员。' -ForegroundColor Green
Write-Host ''
