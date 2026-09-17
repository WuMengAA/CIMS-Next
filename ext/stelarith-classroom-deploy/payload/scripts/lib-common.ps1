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
function Get-SyncConfig([string]$InstallRoot) {
    if (-not $InstallRoot) { return $null }
    $p = Join-Path $InstallRoot ('data\' + $script:PLUGIN_DIRREL + '\stelarith-sync.json')
    return Read-JsonFile $p
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

function Get-AgentTaskInfo {
    if (-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) { return $null }
    return (Get-ScheduledTask -TaskName $script:AGENT_TASK -ErrorAction SilentlyContinue)
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
        $st.Detail = ('[演练] 将安装代理 -> ' + $dstExe + '，并注册计划任务 ' + $script:AGENT_TASK)
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
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('@echo off')
    $lines.Add('rem Stelarith local agent launcher - generated by deploy.ps1. Do NOT hand-edit.')
    $lines.Add('rem Keep this file pure ASCII + CRLF.')
    $lines.Add(('set "STELARITH_AGENT_PORT=' + $script:AGENT_PORT + '"'))
    if ($AgentCfg.DeviceUid)  { $lines.Add(('set "STELARITH_DEVICE_UID=' + (ConvertTo-CmdValue $AgentCfg.DeviceUid) + '"')) }
    if ($AgentCfg.Secret)     { $lines.Add(('set "STELARITH_AGENT_SECRET=' + (ConvertTo-CmdValue $AgentCfg.Secret) + '"')) }
    # 单行 base64 即可：代理的 pem_to_der() 会丢掉 ----- 行并去除空白，
    # 所以不必在 .cmd 里放多行 PEM（多行环境变量在批处理里很难写对）。
    if ($AgentCfg.SitePubKey) { $lines.Add(('set "STELARITH_SITE_PUBKEY=' + (ConvertTo-CmdValue $AgentCfg.SitePubKey) + '"')) }
    if ($AgentCfg.ExtUrl)     { $lines.Add(('set "STELARITH_EXT_URL=' + (ConvertTo-CmdValue $AgentCfg.ExtUrl) + '"')) }
    if ($AgentCfg.VncCmd)     { $lines.Add(('set "STELARITH_VNC_CMD=' + (ConvertTo-CmdValue $AgentCfg.VncCmd) + '"')) }
    $lines.Add(('"' + $dstExe + '" >> "' + (Join-Path $agentDir 'agent.log') + '" 2>&1'))
    Write-AsciiCmdFile -Path $dstCmd -Lines $lines

    # 3) 注册自启。
    #    刻意选「登录时 + 交互式用户 + 最高权限」，而不是「开机时 + SYSTEM」：
    #    SYSTEM 跑在会话 0，它拉起的 VNC 拿不到交互桌面 —— 远程看屏会是一片黑。
    #    这个取舍与 ClassIsland 一致（它也随登录会话启动）；机器若不自动登录，
    #    ClassIsland 本来也不在跑，代理跟着不跑并不额外丢能力。
    $user = "$env:USERDOMAIN\$env:USERNAME"
    $action    = New-ScheduledTaskAction -Execute $dstCmd
    $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $script:AGENT_TASK -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Force | Out-Null
    $st.Task = ($null -ne (Get-AgentTaskInfo))

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
