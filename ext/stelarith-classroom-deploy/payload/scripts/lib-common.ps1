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
$script:PLUGIN_DIRREL = 'Plugins\StelarithControlPlugin'

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
                if ($k -eq 'OfficialManagement') {
                    foreach ($k2 in @($cfg.OfficialManagement.Keys)) {
                        if ($file.OfficialManagement.PSObject.Properties.Name -contains $k2) {
                            $cfg.OfficialManagement[$k2] = $file.OfficialManagement.$k2
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
