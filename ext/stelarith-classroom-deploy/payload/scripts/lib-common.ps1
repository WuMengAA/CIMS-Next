# =====================================================================
# 星璃集控 · 教室端部署包 —— 公共函数库（被 deploy/preflight/rollback/upgrade 共用）
# 目标环境：Windows 10/11 + Windows PowerShell 5.1（不依赖 PowerShell 7）
# =====================================================================

$ErrorActionPreference = 'Stop'

# ---------- 常量 ----------
$script:PKG_ROOT      = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$script:PKG_CONFIG    = Join-Path $script:PKG_ROOT 'config\deployment.json'
$script:PKG_APP       = Join-Path $script:PKG_ROOT 'app'
$script:PKG_SEED      = Join-Path $script:PKG_ROOT 'seed\data'
$script:PKG_AGENT     = Join-Path $script:PKG_ROOT 'agent'
$script:PLUGIN_DIRREL = 'Plugins\StelarithControlPlugin'

# 本地代理：装在 <InstallDir>\agent\ 下（跟安装目录走，卸载=删目录，一目了然）。
$script:AGENT_DIRREL  = 'agent'
# 代理端口 17999 是**双向硬约定**：插件侧 AgentClient.Base 把它写死了，
# 所以这里不做成可配置项 —— 做成可配只会制造「两边不一致」的静默故障。
$script:AGENT_PORT    = 17999
# 计划任务名。用计划任务而非注册服务：服务以 SYSTEM 跑在会话 0，VNC 拿不到桌面。
$script:AGENT_TASK    = 'Stelarith-Agent-AutoStart'
# 看门狗任务名（T08 防拆 L3）。与自启任务**互相独立**：自启任务管「登录时拉起」，
# 看门狗管「每 5 分钟复查，不在就再拉起」。学生要同时发现并删两条才算拆掉。
$script:AGENT_WATCHDOG_TASK = 'Stelarith-Agent-Watchdog'
# 守护进程任务名（T11 防拆 L2）：stelarith-guard.exe 每 15s 探活 agent 与 ClassIsland，
# 不在则拉起 + 记篡改事件。与自启/看门狗互不依赖，三层兜底：L2 guard（15s）→
# L3 watchdog（5 分钟复查，guard 不在也拉起）→ 自启任务（登录时拉起）。
$script:AGENT_GUARD_TASK = 'Stelarith-Agent-Guard'

# ---------- 输出 ----------
function Write-Head([string]$Text) {
    Write-Host ''
    Write-Host ('=' * 68) -ForegroundColor DarkCyan
    Write-Host ("  " + $Text) -ForegroundColor Cyan
    Write-Host ('=' * 68) -ForegroundColor DarkCyan
}
function Write-Step([string]$Text) { Write-Host ("  -> " + $Text) -ForegroundColor White }
function Write-Ok([string]$Text)   { Write-Host ("  [OK]   " + $Text) -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host ("  [注意] " + $Text) -ForegroundColor Yellow }
function Write-Err([string]$Text)  { Write-Host ("  [错误] " + $Text) -ForegroundColor Red }
function Write-Info([string]$Text) { Write-Host ("         " + $Text) -ForegroundColor Gray }

# ---------- 权限 ----------
function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p  = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---------- JSON ----------
function Read-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    return ($raw | ConvertFrom-Json)
}

function Save-JsonFile([string]$Path, $Object, [int]$Depth = 100) {
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    # UTF-8 无 BOM（ClassIsland 的 JSON 读取器按 UTF-8 解析，带 BOM 虽可容错但不必要）
    $json = $Object | ConvertTo-Json -Depth $Depth
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json, $utf8)
}

# ---------- 备份 ----------
function Backup-File([string]$Path, [string]$Tag = 'bak') {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $dest  = "$Path.$Tag-$stamp"
    Copy-Item -LiteralPath $Path -Destination $dest -Force
    return $dest
}

# ---------- 快捷方式（.lnk / .url）----------
function New-ShortcutFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$TargetPath,
        [string]$Arguments = '',
        [string]$WorkingDirectory = '',
        [string]$IconLocation = ''
    )
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($Path)
    $lnk.TargetPath       = $TargetPath
    if ($Arguments)        { $lnk.Arguments        = $Arguments }
    if ($WorkingDirectory) { $lnk.WorkingDirectory = $WorkingDirectory }
    if ($IconLocation)     { $lnk.IconLocation     = $IconLocation }
    $lnk.Save()
}

function New-UrlShortcutFile([string]$Path, [string]$Url, [string]$IconFile = '') {
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $lines = @('[InternetShortcut]', "URL=$Url")
    if ($IconFile) { $lines += "IconFile=$IconFile" }
    # UTF-8 无 BOM + CRLF：Windows 的 .url 解析器对 BOM 敏感
    [System.IO.File]::WriteAllText($Path, ($lines -join "`r`n") + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
}

# ---------- 配置 ----------
function New-DefaultConfig {
    return [ordered]@{
        ServerBase             = ''
        ServerPanel            = ''
        BaseDomain             = 'localhost'
        Slug                   = 'demo-class'
        ClientUid              = ''
        ClassName              = ''
        ClassPlanName          = ''
        NotificationSourceName = '集控广播'
        InstallDir             = 'C:\ClassIsland'
        AutoStart              = $true
        CreateDesktopShortcut  = $true
        ResourceWriteBack      = $true
        RefreshIntervalSeconds = 30
        VoiceHubBase           = ''
        VoiceHubKey            = ''
        Agent                  = [ordered]@{
            Enabled    = $true
            Secret     = ''
            SitePubKey = ''
            ExtUrl     = ''
            VncCmd     = 'vncserver'
        }
        OfficialManagement     = [ordered]@{
            Enabled             = $false
            ManagementServerKind = 0
            ManagementServer    = ''
            ManifestUrlTemplate = ''
            ClassIdentity       = ''
        }
    }
}

function Get-DeployConfig([string]$Path) {
    $cfg = New-DefaultConfig
    $file = Read-JsonFile $Path
    if ($null -ne $file) {
        foreach ($k in @($cfg.Keys)) {
            if ($file.PSObject.Properties.Name -contains $k -and $null -ne $file.$k) {
                # 嵌套段：只覆盖文件里**出现过**的子键，未出现的保留默认值，
                # 这样旧版 deployment.json（没有 Agent 段）也能正常载入。
                if ($k -eq 'OfficialManagement' -or $k -eq 'Agent') {
                    $src = $file.$k
                    foreach ($k2 in @($cfg[$k].Keys)) {
                        if ($src.PSObject.Properties.Name -contains $k2 -and $null -ne $src.$k2) {
                            $cfg[$k][$k2] = $src.$k2
                        }
                    }
                } else {
                    $cfg[$k] = $file.$k
                }
            }
        }
    }
    return $cfg
}

function Normalize-Url([string]$Url) {
    if ([string]::IsNullOrWhiteSpace($Url)) { return '' }
    $u = $Url.Trim().TrimEnd('/')
    if ($u -notmatch '^[a-zA-Z][a-zA-Z0-9+.-]*://') { $u = 'http://' + $u }
    return $u
}

function Get-ClientUidDefault {
    $n = $env:COMPUTERNAME
    if ([string]::IsNullOrWhiteSpace($n)) { $n = 'class-pc' }
    $n = $n.ToLower() -replace '[^a-z0-9\-]', '-'
    $n = $n -replace '-{2,}', '-'
    return $n.Trim('-')
}

function ConvertTo-PanelUrl([string]$ServerBase) {
    $m = [regex]::Match($ServerBase, '^(?<scheme>[a-zA-Z][a-zA-Z0-9+.-]*://)(?<host>[^:/]+)(?::(?<port>\d+))?(?<rest>/.*)?$')
    if (-not $m.Success) { return '' }
    $host_ = $m.Groups['host'].Value
    return ($m.Groups['scheme'].Value + $host_ + ':8090/admin/console')
}

# ---------- 磁盘空间 ----------
function Get-FreeSpaceGB([string]$Path) {
    try {
        $root = [System.IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue).Path)
        if (-not $root) { $root = [System.IO.Path]::GetPathRoot($Path) }
        if (-not $root) { return -1 }
        $d = New-Object System.IO.DriveInfo($root)
        return [math]::Round($d.AvailableFreeSpace / 1GB, 1)
    } catch { return -1 }
}

# ---------- 连通性 ----------
function Test-HttpHost {
    param(
        [string]$Url,
        [int]$TimeoutSec = 6,
        # CIMS 靠 Host 头识别租户。**探测时必须和插件一样带上它**，
        # 否则会得到 403 并把「服务端正常」误判成「租户配置错误」——
        # 这正是本脚本第一次实跑时踩到的坑（浏览器/默认 HttpClient 都不会带这个头）。
        [string]$HostHeader = ''
    )
    $result = [ordered]@{ Ok = $false; Status = 0; Detail = '' }
    try {
        $req = [System.Net.HttpWebRequest]::Create($Url)
        $req.Method = 'GET'
        $req.Timeout = $TimeoutSec * 1000
        $req.AllowAutoRedirect = $false
        $req.UserAgent = 'Stelarith-Deploy-Preflight'
        if ($HostHeader) { $req.Host = $HostHeader }
        $resp = $req.GetResponse()
        $result.Ok = $true
        $result.Status = [int]$resp.StatusCode
        $result.Detail = [string]$resp.StatusCode
        $resp.Close()
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) {
            $result.Status = [int]$_.Exception.Response.StatusCode
            $result.Detail = [string]$_.Exception.Response.StatusCode
            $result.Ok = ($result.Status -lt 500)
        } else {
            $result.Detail = $_.Exception.Message
        }
    } catch {
        $result.Detail = $_.Exception.Message
    }
    return $result
}

function Test-TcpPort {
    param([string]$HostName, [int]$Port, [int]$TimeoutMs = 4000)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect($HostName, $Port, $null, $null)
        if ($iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false) -and $client.Connected) {
            $client.EndConnect($iar)
            return $true
        }
        return $false
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

# ---------- ClassIsland 进程 ----------
function Get-ClassIslandProcess {
    return @(Get-Process -Name 'ClassIsland*' -ErrorAction SilentlyContinue)
}

function Stop-ClassIsland {
    param([int]$WaitSeconds = 8)
    $procs = Get-ClassIslandProcess
    if (-not $procs -or $procs.Count -eq 0) { return $false }
    foreach ($p in $procs) {
        try { $p.CloseMainWindow() | Out-Null } catch { }
    }
    Start-Sleep -Seconds 3
    $left = Get-ClassIslandProcess
    foreach ($p in $left) {
        try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
    }
    # 等到真的退干净——DLL 被锁着的话复制会失败
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while ((Get-Date) -lt $deadline) {
        if ((Get-ClassIslandProcess).Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return ((Get-ClassIslandProcess).Count -eq 0)
}

function Start-ClassIsland {
    param([Parameter(Mandatory)][string]$Root, [int]$WaitSeconds = 20)
    $exe = Join-Path $Root 'ClassIsland.exe'
    if (-not (Test-Path -LiteralPath $exe)) { return $null }
    # 必须在交互式会话中启动，插件/窗口才会真正跑起来
    Start-Process -FilePath $exe -WorkingDirectory $Root
    Start-Sleep -Seconds $WaitSeconds
    $p = Get-ClassIslandProcess | Select-Object -First 1
    return $p
}

# ---------- 找本机已有的 ClassIsland 安装 ----------
function Find-ClassIslandRoot {
    $cands = @()
    # 1) 从正在运行的进程反推（最可靠）
    foreach ($p in (Get-ClassIslandProcess)) {
        try {
            $path = $p.Path
            if ($path) {
                $d = Split-Path -Parent $path
                # 进程可能在 app-<ver> 子目录里跑，回到根
                if ((Split-Path -Leaf $d) -like 'app-*') { $d = Split-Path -Parent $d }
                $cands += $d
            }
        } catch { }
    }
    # 2) 常见安装位置
    $cands += 'C:\ClassIsland'
    $cands += 'D:\ClassIsland'
    $cands += (Join-Path $env:LOCALAPPDATA 'ClassIsland')
    $cands += (Join-Path $env:APPDATA 'ClassIsland')

    foreach ($c in $cands) {
        if (-not $c) { continue }
        if (Test-Path -LiteralPath (Join-Path $c 'ClassIsland.exe')) { return $c }
    }
    return ''
}

# ---------- 读插件同步配置 ----------
# ⚠️ 读的顺序必须与**插件**一致，否则自检看的是"另一份文件"，会给出假结论。
# 插件侧 StelarithSyncOptions.ResolveConfigDir() 优先 PluginConfigFolder
# （data\Config\Plugins\StelarithControlPlugin），取不到才回落程序集目录
# （data\Plugins\StelarithControlPlugin）。2026-09-21 之前这里只读后者。
function Get-SyncConfig([string]$InstallRoot) {
    if (-not $InstallRoot) { return $null }
    $cands = @(
        (Join-Path $InstallRoot ('data\Config\Plugins\' + (Split-Path -Leaf $script:PLUGIN_DIRREL) + '\stelarith-sync.json')),
        (Join-Path $InstallRoot ('data\' + $script:PLUGIN_DIRREL + '\stelarith-sync.json'))
    )
    foreach ($p in $cands) {
        if (Test-Path -LiteralPath $p) { return Read-JsonFile $p }
    }
    return $null
}

function Get-ClassIslandVersion([string]$Root) {
    if (-not $Root) { return '' }
    $dirs = Get-ChildItem -LiteralPath $Root -Directory -Filter 'app-*' -ErrorAction SilentlyContinue
    if ($dirs -and $dirs.Count -gt 0) {
        return ($dirs | Sort-Object Name -Descending | Select-Object -First 1).Name -replace '^app-', ''
    }
    return ''
}

# =====================================================================
#  本地代理（StelarithAgent）
# =====================================================================

# 写一个 .cmd：强制纯 ASCII + CRLF。
# 为什么必须挡在这里：cmd 按**当前代码页**解析批处理，UTF-8 中文在 GBK 控制台上会被
# 按字节拆开，轻则乱码、重则把引号/括号配对搞坏。宁可写的时候就炸。
function Write-AsciiCmdFile([string]$Path, [string[]]$Lines) {
    foreach ($l in $Lines) {
        for ($i = 0; $i -lt $l.Length; $i++) {
            if ([int]$l[$i] -gt 127) {
                throw ("要写入的 .cmd 含非 ASCII 字符（位置 $i）：$l")
            }
        }
    }
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $txt = ($Lines -join "`r`n") + "`r`n"
    [System.IO.File]::WriteAllText($Path, $txt, (New-Object System.Text.ASCIIEncoding))
}

# 把值安全地放进 .cmd 的 set 里。
# 引号包住 set 能保护绝大多数特殊字符，**但保护不了 %** —— 批处理对 % 的展开发生在
# 引号之前，所以必须自己把 % 写成 %%。
function ConvertTo-CmdValue([string]$Value) {
    if ($null -eq $Value) { return '' }
    return $Value.Replace('%', '%%')
}

function Get-AgentExePath([string]$InstallDir) {
    return (Join-Path (Join-Path $InstallDir $script:AGENT_DIRREL) 'stelarith-agent.exe')
}

function Get-AgentCmdPath([string]$InstallDir) {
    return (Join-Path (Join-Path $InstallDir $script:AGENT_DIRREL) 'run-agent.cmd')
}

# 看门狗脚本路径（T08）：放在 agent 目录，与 run-agent.cmd 同级。
# 它由部署脚本生成（纯 ASCII + CRLF），任务只负责按周期调用它。
function Get-AgentWatchdogCmdPath([string]$InstallDir) {
    return (Join-Path (Join-Path $InstallDir $script:AGENT_DIRREL) 'watch-agent.cmd')
}

# 密钥/公钥独立文件（T06 整改：密钥不再明文写进 run-agent.cmd）。
# 任何能读安装目录的人都可能拿到 run-agent.cmd，所以密钥必须放一个
# **ACL 受限**的文件里：普通学生账号（非管理员）读不到，也就无法冒用代理身份。
# 启动器运行时 `if exist ... call ...` 把它加载进环境变量。
function Get-AgentSecretPath([string]$InstallDir) {
    return (Join-Path (Join-Path $InstallDir $script:AGENT_DIRREL) 'agent-secret.cmd')
}

# 写 agent-secret.cmd（纯 ASCII + CRLF），并收紧 ACL 到 SYSTEM/管理员/当前部署用户。
# 幂等：重复执行会先删旧文件再重建（删除只依赖父目录权限，绕开旧 ACL 的只读限制）。
function Write-AgentSecretFile {
    param(
        [Parameter(Mandatory)][string]$InstallDir,
        [Parameter(Mandatory)]$AgentCfg,
        [switch]$DryRun
    )
    $secretPath = Get-AgentSecretPath $InstallDir
    $hasSecret = [bool]$AgentCfg.Secret
    $hasPubKey = [bool]$AgentCfg.SitePubKey
    if ($DryRun) {
        return [ordered]@{ Path = $secretPath; Written = ($hasSecret -or $hasPubKey); Detail = $(if ($hasSecret -or $hasPubKey) { '将写入受限密钥文件并设 ACL' } else { '无密钥，不生成受限文件' }) }
    }
    if (-not ($hasSecret -or $hasPubKey)) {
        # 无密钥也要确保旧文件不残留（升级时从明文改到无密钥的配置）
        if (Test-Path -LiteralPath $secretPath) {
            Remove-Item -LiteralPath $secretPath -Force
        }
        return [ordered]@{ Path = $secretPath; Written = $false; Detail = '无密钥，未生成受限文件（已清理旧文件）' }
    }
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('@echo off')
    $lines.Add('rem Stelarith agent credentials - ACL restricted, generated by deploy.ps1. Do NOT hand-edit.')
    $lines.Add('rem This file contains the shared secret / site pubkey. Access is limited to SYSTEM/Administrators.')
    if ($AgentCfg.Secret)     { $lines.Add(('set "STELARITH_AGENT_SECRET=' + (ConvertTo-CmdValue $AgentCfg.Secret) + '"')) }
    if ($AgentCfg.SitePubKey) { $lines.Add(('set "STELARITH_SITE_PUBKEY=' + (ConvertTo-CmdValue $AgentCfg.SitePubKey) + '"')) }
    if (Test-Path -LiteralPath $secretPath) {
        # 旧文件可能是只读 ACL（仅读权限），Remove-Item 会被拒 —— 先 /reset 恢复继承
        & icacls $secretPath /reset 2>&1 | Out-Null
        Remove-Item -LiteralPath $secretPath -Force
    }
    Write-AsciiCmdFile -Path $secretPath -Lines $lines
    # ACL：仅 SYSTEM / 管理员 / 当前部署用户可读。教室学生账号读不到密钥。
    # /inheritance:r 先去掉继承，再只授读权限。
    $aclUser = "$env:USERDOMAIN\$env:USERNAME"
    & icacls $secretPath /inheritance:r /grant:r "BUILTIN\Administrators:(R)" "NT AUTHORITY\SYSTEM:(R)" "${aclUser}:(R)" 2>&1 | Out-Null
    return [ordered]@{ Path = $secretPath; Written = $true; Detail = '已写入受限密钥文件并设 ACL（SYSTEM/管理员/部署用户只读）' }
}

function Get-AgentTaskInfo {
    if (-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) { return $null }
    return (Get-ScheduledTask -TaskName $script:AGENT_TASK -ErrorAction SilentlyContinue)
}

function Get-AgentWatchdogTaskInfo {
    if (-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) { return $null }
    return (Get-ScheduledTask -TaskName $script:AGENT_WATCHDOG_TASK -ErrorAction SilentlyContinue)
}

# 守护进程（T11 L2）：stelarith-guard.exe 路径 = agent 目录下，与 run-agent.cmd 同级。
function Get-AgentGuardExePath([string]$InstallDir) {
    return (Join-Path (Join-Path $InstallDir $script:AGENT_DIRREL) 'stelarith-guard.exe')
}

function Get-AgentGuardTaskInfo {
    if (-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) { return $null }
    return (Get-ScheduledTask -TaskName $script:AGENT_GUARD_TASK -ErrorAction SilentlyContinue)
}

# =====================================================================
#  T08 防拆 L3 · 看门狗任务
# =====================================================================
# 与自启任务（Stelarith-Agent-AutoStart）**互相独立**：自启任务管「登录时拉起」，
# 看门狗管「每 5 分钟复查，不在就再拉起」。学生要同时发现并删两条才算拆掉。
# ⚠️ 看门狗**必须也是交互用户**（不是 SYSTEM）：它要拉起的是交互会话里的自启任务，
#    SYSTEM 语境下 Start-ScheduledTask 拉起的任务仍在会话 0，VNC 依旧黑屏。
# 生成两个文件（都放 agent 目录，纯 ASCII + CRLF）：
#   watch-agent.cmd   —— 手动运行用的薄壳（转发给 ps1）；计划任务**不再用它**
#   watch-agent.ps1   —— 实际探活 + 拉起 + lnk 自愈（纯 ASCII 所以无需 BOM）
#   任务 Action 直接跑 powershell.exe -WindowStyle Hidden -File watch-agent.ps1：
#   计划任务若以 InteractiveToken 直接执行 .cmd，会**每 5 分钟在桌面弹一个黑窗**
#   （2026-09-25 实测）。-WindowStyle Hidden 隐藏窗口，逻辑完全不变。
function Register-AgentWatchdog {
    param(
        [Parameter(Mandatory)][string]$InstallDir,
        [switch]$DryRun
    )
    $st = [ordered]@{ Ok = $false; Detail = '' }
    $watchCmd = Get-AgentWatchdogCmdPath $InstallDir
    $agentExe = Get-AgentExePath $InstallDir
    if (-not (Test-Path -LiteralPath $agentExe)) {
        $st.Detail = '代理未安装，跳过看门狗任务'
        return $st
    }
    if ($DryRun) {
        $st.Detail = ('[演练] 将生成 ' + $watchCmd + '（watch-agent.cmd / .ps1）并注册任务 ' + $script:AGENT_WATCHDOG_TASK + '（每 5 分钟复查，不在就拉起自启任务）')
        return $st
    }

    # 1) 薄壳 .cmd：手动运行入口（`watch-agent.cmd`），把复杂逻辑留在 .ps1。
    #    计划任务不经过它 —— 任务 Action 直接跑隐藏窗口的 powershell -File watch-agent.ps1，
    #    避免 InteractiveToken + cmd.exe 每 5 分钟弹一个黑窗（2026-09-25 实测）。
    $cmdLines = New-Object System.Collections.Generic.List[string]
    $cmdLines.Add('@echo off')
    $cmdLines.Add('rem Stelarith agent watchdog - generated by deploy.ps1. Do NOT hand-edit.')
    $cmdLines.Add('rem Keep this file pure ASCII + CRLF.')
    $cmdLines.Add('powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0watch-agent.ps1"')
    $cmdLines.Add('exit /b 0')
    Write-AsciiCmdFile -Path $watchCmd -Lines $cmdLines

    # 2) 探活脚本 .ps1（纯 ASCII + CRLF，无需 BOM）
    #    PSScriptRoot = agent 目录，父目录 = InstallDir，ClassIsland.exe 在根。
    $ps1Lines = New-Object System.Collections.Generic.List[string]
    $ps1Lines.Add('# Stelarith agent watchdog body - generated by deploy.ps1. Do NOT hand-edit.')
    $ps1Lines.Add('$ErrorActionPreference = "SilentlyContinue"')
    $ps1Lines.Add(('$port = ' + $script:AGENT_PORT))
    $ps1Lines.Add(('$task = "' + $script:AGENT_TASK + '"'))
    $ps1Lines.Add('')
    $ps1Lines.Add('# 1) probe agent /status; start the autostart task if not responding')
    $ps1Lines.Add('$alive = $false')
    $ps1Lines.Add('try {')
    $ps1Lines.Add('    $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:" + $port + "/status") -TimeoutSec 4')
    $ps1Lines.Add('    if ($r.StatusCode -eq 200) { $alive = $true }')
    $ps1Lines.Add('} catch { }')
    $ps1Lines.Add('if (-not $alive) {')
    $ps1Lines.Add('    try { Start-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue } catch { }')
    $ps1Lines.Add('}')
    $ps1Lines.Add('')
    $ps1Lines.Add('# 1b) T11 L2: guard daemon missing -> start guard task (3-layer: guard 15s -> watchdog 5min -> autostart)')
    $ps1Lines.Add('$guardTask = "' + $script:AGENT_GUARD_TASK + '"')
    $ps1Lines.Add('$guardProc = Get-Process -Name "stelarith-guard" -ErrorAction SilentlyContinue')
    $ps1Lines.Add('if (-not $guardProc) {')
    $ps1Lines.Add('    try { Start-ScheduledTask -TaskName $guardTask -ErrorAction SilentlyContinue } catch { }')
    $ps1Lines.Add('}')
    $ps1Lines.Add('')
    $ps1Lines.Add('# 2) self-heal the startup shortcut (ClassIsland.lnk removed by tampering)')
    $ps1Lines.Add('#    When recreated, also tighten its ACL (RX for Users only) - same as deploy.ps1.')
    $ps1Lines.Add('$startup = [Environment]::GetFolderPath("Startup")')
    $ps1Lines.Add('$lnk = Join-Path $startup "ClassIsland.lnk"')
    $ps1Lines.Add('$exe = Join-Path (Split-Path -Parent $PSScriptRoot) "ClassIsland.exe"')
    $ps1Lines.Add('if (-not (Test-Path -LiteralPath $lnk) -and (Test-Path -LiteralPath $exe)) {')
    $ps1Lines.Add('    try {')
    $ps1Lines.Add('        $ws = New-Object -ComObject WScript.Shell')
    $ps1Lines.Add('        $s = $ws.CreateShortcut($lnk)')
    $ps1Lines.Add('        $s.TargetPath = $exe')
    $ps1Lines.Add('        $s.WorkingDirectory = Split-Path -Parent $exe')
    $ps1Lines.Add('        $s.IconLocation = $exe')
    $ps1Lines.Add('        $s.Save()')
    $ps1Lines.Add('        & icacls $lnk /inheritance:r /grant:r "BUILTIN\Administrators:(F)" "NT AUTHORITY\SYSTEM:(F)" (($env:USERDOMAIN + "\" + $env:USERNAME) + ":(F)") "BUILTIN\Users:(RX)" 2>&1 | Out-Null')
    $ps1Lines.Add('    } catch { }')
    $ps1Lines.Add('}')
    $ps1Lines.Add('exit 0')
    $dir = Split-Path -Parent (Get-AgentWatchdogCmdPath $InstallDir)
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $ps1Path = Join-Path $dir 'watch-agent.ps1'
    $ps1Txt = ($ps1Lines -join "`r`n") + "`r`n"
    [System.IO.File]::WriteAllText($ps1Path, $ps1Txt, (New-Object System.Text.ASCIIEncoding))

    # 3) 注册任务：TimeTrigger 每 5 分钟无限重复（不写 <Duration> 才是无限，PS5.1
    #    的 New-ScheduledTaskTrigger 表达不了"无限"，所以手写 XML —— 见 skill 7.1）。
    #    StartBoundary 设过去日期 → 立即进入无限 5 分钟周期。IgnoreNew：Running 时忽略刻度。
    $user = "$env:USERDOMAIN\$env:USERNAME"
    $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <TimeTrigger>
      <StartBoundary>2026-01-01T00:00:00</StartBoundary>
      <Repetition>
        <Interval>PT5M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$user</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT15M</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$ps1Path"</Arguments>
    </Exec>
  </Actions>
</Task>
"@
    Register-ScheduledTask -TaskName $script:AGENT_WATCHDOG_TASK -Xml $xml -Force | Out-Null
    $st.Ok = ($null -ne (Get-AgentWatchdogTaskInfo))
    $st.Detail = ('看门狗任务 ' + $script:AGENT_WATCHDOG_TASK + '（每 5 分钟复查，不在就拉起 ' + $script:AGENT_TASK + '；ClassIsland.lnk 缺失自动重建）')
    return $st
}

function Remove-AgentWatchdog {
    $t = Get-AgentWatchdogTaskInfo
    if (-not $t) { return $false }
    try { Stop-ScheduledTask -TaskName $script:AGENT_WATCHDOG_TASK -ErrorAction SilentlyContinue } catch { }
    Unregister-ScheduledTask -TaskName $script:AGENT_WATCHDOG_TASK -Confirm:$false
    return $true
}

# =====================================================================
#  T11 防拆 L2 · 守护进程 stelarith-guard.exe
# =====================================================================
# 与看门狗任务（L3，每 5 分钟复查）不同，guard 是**常驻**进程：每 15s 探活
# agent /status 与 ClassIsland 进程，不在则拉起并记篡改事件到
# C:\ProgramData\Stelarith\guard.log。它由本任务在登录时拉起并常驻。
#
# 三层兜底（谁都要独立发现并删三条才拆得掉）：
#   L2  guard 任务（本函数）  —— 登录时拉起，RestartCount 失败自愈；
#   L3  看门狗任务            —— 每 5 分钟复查，guard 进程不在也把本任务拉起来；
#   L1  自启任务              —— 登录时拉起 agent（guard 探活对象之一）。
#
# guard 是纯 std 单二进制（约 0.2MB），无第三方依赖；互斥端口 18001
# （STELARITH_GUARD_PORT 可改），已有一个实例时新实例自动退出。
function Register-StelarithGuard {
    param(
        [Parameter(Mandatory)][string]$InstallDir,
        [switch]$DryRun
    )
    $st = [ordered]@{ Ok = $false; Detail = '' }
    $guardExe = Get-AgentGuardExePath $InstallDir
    if (-not (Test-Path -LiteralPath $guardExe)) {
        $st.Detail = '守护进程未安装（stelarith-guard.exe 缺失），跳过任务注册'
        return $st
    }
    if ($DryRun) {
        $st.Detail = ('[演练] 将注册任务 ' + $script:AGENT_GUARD_TASK + '（登录时拉起 ' + $guardExe + '，常驻 15s 探活）')
        return $st
    }
    # 与自启任务同款加固：AtLogOn + 交互用户 + RestartCount/StartWhenAvailable/IgnoreNew。
    # 必须**交互用户**（不是 SYSTEM）：guard 要拉起的是交互会话里的 agent 与 ClassIsland。
    $user = "$env:USERDOMAIN\$env:USERNAME"
    $action    = New-ScheduledTaskAction -Execute $guardExe
    $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
        -MultipleInstances IgnoreNew -StartWhenAvailable
    Register-ScheduledTask -TaskName $script:AGENT_GUARD_TASK -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Force | Out-Null
    $st.Ok = ($null -ne (Get-AgentGuardTaskInfo))
    $st.Detail = ('守护进程任务 ' + $script:AGENT_GUARD_TASK + '（登录时拉起 guard，常驻探活 agent/ClassIsland）')
    return $st
}

function Remove-StelarithGuard {
    $t = Get-AgentGuardTaskInfo
    if (-not $t) { return $false }
    try { Stop-ScheduledTask -TaskName $script:AGENT_GUARD_TASK -ErrorAction SilentlyContinue } catch { }
    Get-Process -Name 'stelarith-guard' -ErrorAction SilentlyContinue |
        ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch { } }
    Unregister-ScheduledTask -TaskName $script:AGENT_GUARD_TASK -Confirm:$false
    return $true
}

# 判活：代理只监听 127.0.0.1，所以 TCP 通了还不够，必须真拿到 /status 的 JSON。
function Test-AgentStatus([int]$TimeoutSec = 4) {
    $result = [ordered]@{ Ok = $false; Detail = '' }
    if (-not (Test-TcpPort -HostName '127.0.0.1' -Port $script:AGENT_PORT)) {
        $result.Detail = ('TCP 127.0.0.1:' + $script:AGENT_PORT + ' 不通（代理未运行？）')
        return $result
    }
    try {
        $req = [System.Net.HttpWebRequest]::Create(('http://127.0.0.1:' + $script:AGENT_PORT + '/status'))
        $req.Method = 'GET'
        $req.Timeout = $TimeoutSec * 1000
        $req.Proxy = $null
        $resp = $req.GetResponse()
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $body = $sr.ReadToEnd()
        $sr.Close()
        $resp.Close()
        $result.Ok = $true
        $result.Detail = $body.Trim()
    } catch {
        $result.Detail = ('/status 请求失败：' + $_.Exception.Message)
    }
    return $result
}

# 安装/更新本地代理，并确保它随登录自启。幂等。
function Install-StelarithAgent {
    param(
        [Parameter(Mandatory)][string]$InstallDir,
        [Parameter(Mandatory)]$AgentCfg,
        [switch]$DryRun
    )
    $st = [ordered]@{ Ok = $false; Skipped = $false; Task = $false; Detail = '' }

    $agentDir = Join-Path $InstallDir $script:AGENT_DIRREL
    $dstExe   = Get-AgentExePath $InstallDir
    $dstCmd   = Get-AgentCmdPath $InstallDir
    $srcExe   = Join-Path $script:PKG_AGENT 'stelarith-agent.exe'

    if ($DryRun) {
        $secInfo = Write-AgentSecretFile -InstallDir $InstallDir -AgentCfg $AgentCfg -DryRun
        $st.Detail = ('[演练] 将安装代理 -> ' + $dstExe + '，并注册计划任务 ' + $script:AGENT_TASK + '；' + $secInfo.Detail)
        return $st
    }

    # 0) 代理自身的状态日志写在 C:\ProgramData\Stelarith\，目录不存在时它会**静默**写不进去
    $progData = Join-Path $env:ProgramData 'Stelarith'
    if (-not (Test-Path -LiteralPath $progData)) {
        New-Item -ItemType Directory -Path $progData -Force | Out-Null
    }

    # 1) 落二进制
    if (-not (Test-Path -LiteralPath $agentDir)) {
        New-Item -ItemType Directory -Path $agentDir -Force | Out-Null
    }
    if (Test-Path -LiteralPath $srcExe) {
        if (Test-Path -LiteralPath $dstExe) {
            # 代理正在跑时二进制被占用，覆盖会失败 —— 先停任务再停进程
            $task = Get-AgentTaskInfo
            if ($task) {
                try { Stop-ScheduledTask -TaskName $script:AGENT_TASK -ErrorAction SilentlyContinue } catch { }
                Start-Sleep -Seconds 1
                Get-Process -Name 'stelarith-agent' -ErrorAction SilentlyContinue |
                    ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch { } }
                Start-Sleep -Seconds 1
            }
            Backup-File $dstExe 'before-deploy' | Out-Null
        }
        Copy-Item -LiteralPath $srcExe -Destination $dstExe -Force
    } else {
        $st.Skipped = $true
        $st.Detail = ('部署包里没有 agent\stelarith-agent.exe，已跳过代理安装')
        return $st
    }

    # 2) 生成启动器。用 .cmd 而不是把命令塞进计划任务的 -Argument：
    #    -Argument 里嵌套引号在 Register-ScheduledTask 上极易出错。
    #    T06 整改：密钥（STELARITH_AGENT_SECRET / STELARITH_SITE_PUBKEY）**不再**
    #    明文写进本文件 —— 任何能读安装目录的人都可能读到它。密钥改存独立的
    #    agent-secret.cmd（ACL 受限），本启动器运行时按需 call 加载。
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('@echo off')
    $lines.Add('rem Stelarith local agent launcher - generated by deploy.ps1. Do NOT hand-edit.')
    $lines.Add('rem Keep this file pure ASCII + CRLF.')
    $lines.Add('rem Credentials live in agent-secret.cmd (ACL restricted); loaded only if present.')
    $lines.Add(('if exist "%~dp0agent-secret.cmd" call "%~dp0agent-secret.cmd"'))
    $lines.Add(('set "STELARITH_AGENT_PORT=' + $script:AGENT_PORT + '"'))
    if ($AgentCfg.DeviceUid)  { $lines.Add(('set "STELARITH_DEVICE_UID=' + (ConvertTo-CmdValue $AgentCfg.DeviceUid) + '"')) }
    if ($AgentCfg.ExtUrl)     { $lines.Add(('set "STELARITH_EXT_URL=' + (ConvertTo-CmdValue $AgentCfg.ExtUrl) + '"')) }
    if ($AgentCfg.VncCmd)     { $lines.Add(('set "STELARITH_VNC_CMD=' + (ConvertTo-CmdValue $AgentCfg.VncCmd) + '"')) }
    $lines.Add(('"' + $dstExe + '" >> "' + (Join-Path $agentDir 'agent.log') + '" 2>&1'))
    Write-AsciiCmdFile -Path $dstCmd -Lines $lines

    # 2.1) 密钥写独立受限文件（不在启动器里留明文）。agent 进程由本启动器
    #      call 加载 agent-secret.cmd 后继承环境变量，鉴权路径完全不变。
    $sec = Write-AgentSecretFile -InstallDir $InstallDir -AgentCfg $AgentCfg

    # 3) 注册自启。
    #    刻意选「登录时 + 交互式用户 + 最高权限」，而不是「开机时 + SYSTEM」：
    #    SYSTEM 跑在会话 0，它拉起的 VNC 拿不到交互桌面 —— 远程看屏会是一片黑。
    #    这个取舍与 ClassIsland 一致（它也随登录会话启动）；机器若不自动登录，
    #    ClassIsland 本来也不在跑，代理跟着不跑并不额外丢能力。
    #    T08 防拆 L3 加固：RestartCount=3/PT1M + StartWhenAvailable（失败退出码自愈）
    #    + MultipleInstances=IgnoreNew（重复触发不叠实例）。
    $user = "$env:USERDOMAIN\$env:USERNAME"
    $action    = New-ScheduledTaskAction -Execute $dstCmd
    $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
        -MultipleInstances IgnoreNew -StartWhenAvailable
    Register-ScheduledTask -TaskName $script:AGENT_TASK -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Force | Out-Null
    $st.Task = ($null -ne (Get-AgentTaskInfo))

    # 3.1) T08 防拆 L3：独立看门狗任务（与自启任务互不依赖）。
    #      RestartCount 只对「失败退出码」生效；学生若用 schtasks /End 把任务杀掉
    #      （退出码 0），RestartCount 不会触发 —— 必须有一条独立任务每 5 分钟复查。
    #      ⚠️ 看门狗**必须也是交互用户**（不是 SYSTEM）：它要拉起的还是
    #      Stelarith-Agent-AutoStart（交互会话），SYSTEM 语境下 Start-ScheduledTask
    #      拉起的任务仍在会话 0，VNC 依旧黑屏。
    Register-AgentWatchdog -InstallDir $InstallDir | Out-Null

    # 3.2) T11 防拆 L2：守护进程 stelarith-guard.exe（常驻 15s 探活 agent/ClassIsland）。
    #      二进制从部署包 agent\ 目录复制（与 stelarith-agent.exe 同级）。
    $srcGuard = Join-Path $script:PKG_AGENT 'stelarith-guard.exe'
    $dstGuard = Get-AgentGuardExePath $InstallDir
    if (Test-Path -LiteralPath $srcGuard) {
        if (Test-Path -LiteralPath $dstGuard) {
            Get-Process -Name 'stelarith-guard' -ErrorAction SilentlyContinue |
                ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch { } }
            Backup-File $dstGuard 'before-deploy' | Out-Null
        }
        Copy-Item -LiteralPath $srcGuard -Destination $dstGuard -Force
        Register-StelarithGuard -InstallDir $InstallDir | Out-Null
    } else {
        # 旧包（T11 之前出包）没有 guard 二进制：注册任务也没有意义，跳过即可。
        # 不报错：guard 是增强件，缺它只是少一层 15s 快速兜底（L3 看门狗仍在）。
        Write-Warn '部署包没有 agent\stelarith-guard.exe，跳过防拆 L2 守护进程安装'
    }

    # 4) 立刻起一次并判活（起来才算真的装好了）
    try { Start-ScheduledTask -TaskName $script:AGENT_TASK } catch { }
    $ok = $false
    for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Milliseconds 700
        $s = Test-AgentStatus
        if ($s.Ok) { $ok = $true; $st.Detail = ('/status = ' + $s.Detail); break }
        $st.Detail = $s.Detail
    }
    $st.Ok = $ok
    return $st
}
