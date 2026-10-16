<#
=====================================================================
 星璃集控 · 教室端环境自检
=====================================================================
 作用：在不动任何文件的前提下，回答三个问题：
       ① 这台机器装好了吗？   ② 能不能连上服务端？   ③ 集控插件在跑吗？
 什么时候用：部署后确认、出故障时定位、每周例行巡检。

 用法：powershell -ExecutionPolicy Bypass -File preflight.ps1
       powershell -ExecutionPolicy Bypass -File preflight.ps1 -Report out.txt
=====================================================================
#>
[CmdletBinding()]
param(
    [string]$ConfigPath = '',
    [string]$InstallRoot = '',
    [string]$Report = ''
)

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'lib-common.ps1')

$pkgRoot = Split-Path -Parent $PSScriptRoot
if (-not $ConfigPath) { $ConfigPath = Join-Path $pkgRoot 'config\deployment.json' }
if (-not $InstallRoot) { $InstallRoot = Find-ClassIslandRoot }

$lines = New-Object System.Collections.Generic.List[string]
function Emit([string]$Text, [string]$Color = 'Gray') {
    Write-Host $Text -ForegroundColor $Color
    $lines.Add($Text) | Out-Null
}

Write-Head '星璃集控 · 教室端环境自检'
Emit ("  时间：" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Emit ("  主机：" + $env:COMPUTERNAME + "        用户：" + $env:USERNAME)

$pass = 0; $warn = 0; $fail = 0
function V([string]$Label, [string]$State, [string]$Detail) {
    $tag = switch ($State) { 'ok' { '[OK]  ' } 'warn' { '[注意]' } 'fail' { '[失败]' } default { '[--]  ' } }
    $color = switch ($State) { 'ok' { 'Green' } 'warn' { 'Yellow' } 'fail' { 'Red' } default { 'Gray' } }
    if ($State -eq 'ok') { $script:pass = $script:pass + 1 }
    elseif ($State -eq 'warn') { $script:warn = $script:warn + 1 }
    elseif ($State -eq 'fail') { $script:fail = $script:fail + 1 }
    Emit ("  " + $tag + " " + $Label.PadRight(22) + "  " + $Detail) $color
}

# ================================================================ 1. 系统
Write-Head '一、系统环境'
$osv = [System.Environment]::OSVersion.Version
V '操作系统' $(if ($osv.Major -ge 10) { 'ok' } else { 'warn' }) ("Windows " + $osv.Major + "." + $osv.Minor + "." + $osv.Build)

$memGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
V '物理内存' $(if ($memGB -ge 3.5) { 'ok' } else { 'warn' }) ($memGB.ToString() + " GB")

$screen = ''
try {
    Add-Type -AssemblyName System.Windows.Forms
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $screen = ($b.Width.ToString() + 'x' + $b.Height.ToString())
} catch { $screen = '未知' }
V '主显示器分辨率' 'ok' $screen

# ================================================================ 2. 安装
Write-Head '二、安装完整性'
if (-not $InstallRoot) {
    V '安装目录' 'fail' '未找到 ClassIsland 安装（当前用户下没有任何 app-* 目录）'
} else {
    V '安装目录' 'ok' $InstallRoot
    $ver = Get-ClassIslandVersion $InstallRoot
    V 'ClassIsland 版本' $(if ($ver) { 'ok' } else { 'fail' }) $(if ($ver) { $ver } else { '未找到 app-* 目录' })
    V '启动器 ClassIsland.exe' $(if (Test-Path -LiteralPath (Join-Path $InstallRoot 'ClassIsland.exe')) { 'ok' } else { 'fail' }) 'ClassIsland.exe'
    $dataDir = Join-Path $InstallRoot 'data'
    V '数据目录' $(if (Test-Path -LiteralPath $dataDir) { 'ok' } else { 'fail' }) $dataDir
    $pluginDir = Join-Path $dataDir $script:PLUGIN_DIRREL
    $dll = Join-Path $pluginDir 'StelarithControlPlugin.dll'
    if (Test-Path -LiteralPath $dll) {
        $vi = (Get-Item -LiteralPath $dll).VersionInfo
        $dv = if ($vi.FileVersion) { $vi.FileVersion } else { '?' }
        V '集控插件 DLL' 'ok' ("存在，文件版本 " + $dv)
    } else {
        V '集控插件 DLL' 'fail' '缺失'
    }
    # 清单里的版本号才是面板/插件管理页显示的那个
    $manifest = Join-Path $pluginDir 'manifest.yml'
    if (Test-Path -LiteralPath $manifest) {
        $mv = (Select-String -LiteralPath $manifest -Pattern '^\s*version:\s*(.+)$' | Select-Object -First 1)
        V '插件清单版本' 'ok' $(if ($mv) { $mv.Matches[0].Groups[1].Value.Trim() } else { '未解析到 version' })
    } else {
        V '插件清单 manifest.yml' 'fail' '缺失（插件无法被宿主识别）'
    }
    # 插件读配置走 PluginConfigFolder 优先 → 两处都要在，且**内容要一致**。
    # 只查 install dir 会给出假结论：那份可能根本不生效（被 Config\Plugins 里的旧文件屏蔽）。
    $pSync = Join-Path $pluginDir 'stelarith-sync.json'
    $cSync = Join-Path $dataDir ('Config\Plugins\' + (Split-Path -Leaf $script:PLUGIN_DIRREL) + '\stelarith-sync.json')
    V 'stelarith-sync.json（插件目录）' $(if (Test-Path -LiteralPath $pSync) { 'ok' } else { 'fail' }) '插件同步配置'
    V 'stelarith-sync.json（配置目录·插件实际读取）' $(if (Test-Path -LiteralPath $cSync) { 'ok' } else { 'warn' }) '按 ClassIsland 规范，插件优先读这里'
    if ((Test-Path -LiteralPath $pSync) -and (Test-Path -LiteralPath $cSync)) {
        $h1 = (Get-FileHash -LiteralPath $pSync -Algorithm SHA256).Hash
        $h2 = (Get-FileHash -LiteralPath $cSync -Algorithm SHA256).Hash
        if ($h1 -ne $h2) { V '两处同步配置一致性' 'warn' '内容不一致 —— 实际生效的是「配置目录」那份，逐项核对再改' }
    }
    $eff = Get-SyncConfig $InstallRoot
    if ($eff) {
        $mode = if ($eff.NetworkMode) { [string]$eff.NetworkMode } else { 'wan(缺省)' }
        V '当前生效的同步配置' 'ok' ('模式 ' + $mode + ' -> ' + $eff.ClientAppBase + '（Host: ' + $eff.Slug + '.' + $eff.BaseDomain + '）')
        if ([string]::IsNullOrWhiteSpace([string]$eff.Slug)) {
            V '租户 Slug' 'fail' '为空 —— 所有 CIMS 请求会 403（且会被限流中间件自封 IP）'
        }
        if (-not [string]::IsNullOrWhiteSpace([string]$eff.ClientUid)) {
            V '本机设备身份' 'warn' ('ClientUid 被显式写死为 ' + $eff.ClientUid + ' —— 同租户下不可重复，多台机器会互相顶号')
        } else {
            V '本机设备身份' 'ok' ('未写死 → 插件按计算机名（' + $env:COMPUTERNAME + '）登记')
        }
    }
    V 'stelarith-panel.json' $(if (Test-Path -LiteralPath (Join-Path $pluginDir 'stelarith-panel.json')) { 'ok' } else { 'warn' }) '内嵌面板地址'
    V '课表档案 Default.json' $(if (Test-Path -LiteralPath (Join-Path $dataDir 'Profiles\Default.json')) { 'ok' } else { 'warn' }) '离线显示用'
}

# ================================================================ 3. 进程
Write-Head '三、运行状态'
$procs = Get-ClassIslandProcess
if ($procs.Count -gt 0) {
    foreach ($p in $procs) {
        $up = [math]::Round(((Get-Date) - $p.StartTime).TotalMinutes, 1)
        V 'ClassIsland 进程' 'ok' ("PID " + $p.Id + "，已运行 " + $up + " 分钟，内存 " + [math]::Round($p.WorkingSet64 / 1MB, 0) + " MB，会话 " + $p.SessionId)
    }
    if ($InstallRoot -and (Test-Path -LiteralPath (Join-Path $InstallRoot 'data\Plugins'))) {
        $dllPath = Join-Path $InstallRoot ('data\' + $script:PLUGIN_DIRREL + '\StelarithControlPlugin.dll')
        if (Test-Path -LiteralPath $dllPath) {
            $dllTime = (Get-Item -LiteralPath $dllPath).LastWriteTime
            $procTime = ($procs | Select-Object -First 1).StartTime
            if ($procTime -lt $dllTime) {
                V '插件是否为最新' 'warn' ("进程启动于 " + $procTime.ToString('MM-dd HH:mm') + "，而 DLL 是 " + $dllTime.ToString('MM-dd HH:mm') + " 更新的 —— 需重启 ClassIsland 才会加载新代码")
            } else {
                V '插件是否为最新' 'ok' '进程启动时间晚于 DLL，跑的是当前版本'
            }
        }
    }
} else {
    V 'ClassIsland 进程' 'warn' '未运行（若刚部署还没启动，属正常）'
}

# --- 本地代理：它决定「面板上需要 OS 权限的按钮」是否真的可用 ---
# 单独查它的理由：面板上「远程屏幕控制 / 系统级重启」看着是有的，但执行载体是这个代理。
# 代理没装/没跑，这两个按钮就是空的，而现象会退化成「点了没反应」。
$agentExe = if ($InstallRoot) { Get-AgentExePath $InstallRoot } else { '' }
if (-not $agentExe -or -not (Test-Path -LiteralPath $agentExe)) {
    V '本地代理' 'warn' '未安装 —— 「远程屏幕控制 / 系统级重启」不可用（其余功能正常）'
} else {
    $astat = Test-AgentStatus
    $apx   = Get-Process -Name 'stelarith-agent' -ErrorAction SilentlyContinue
    if ($astat.Ok) {
        V '本地代理' 'ok' ('在跑，/status = ' + $astat.Detail)
    } elseif ($apx) {
        V '本地代理' 'warn' ('进程在但 /status 不通：' + $astat.Detail)
    } else {
        V '本地代理' 'warn' ('已安装但未运行：' + $astat.Detail)
    }

    $at = Get-AgentTaskInfo
    V '代理自启任务' $(if ($at) { 'ok' } else { 'warn' }) `
        $(if ($at) { ($script:AGENT_TASK + "（" + $at.State + "）") } else { '未注册 —— 重新登录后代理不会自动起来' })

    # T08 防拆 L3：自启任务必须带失败重启 + 防叠实例 + 补启动（缺一个都会在
    # 「被 /End 或被强杀」后躺平）；另有独立看门狗任务兜底（见下）。
    if ($at) {
        $hardened = ($at.Settings.RestartCount -ge 3 -and
                     $at.Settings.MultipleInstances -eq 'IgnoreNew' -and
                     $at.Settings.StartWhenAvailable)
        V '代理自启加固' $(if ($hardened) { 'ok' } else { 'warn' }) `
            $(if ($hardened) { 'RestartCount=3/PT1M + IgnoreNew + StartWhenAvailable（防拆 L3）' }
              else { ('加固缺失（RestartCount=' + $at.Settings.RestartCount + '，Multi=' + $at.Settings.MultipleInstances + '，SWA=' + $at.Settings.StartWhenAvailable + '）—— 重新部署一次即可补齐') })
    }
    $wt = Get-AgentWatchdogTaskInfo
    V '代理看门狗任务' $(if ($wt) { 'ok' } else { 'warn' }) `
        $(if ($wt) { ($script:AGENT_WATCHDOG_TASK + "（" + $wt.State + "，每 5 分钟复查，不在就拉起）") } else { '未注册 —— 代理被 /End 后无人再拉起' })

    # T11 防拆 L2：守护进程（常驻 15s 探活 agent/ClassIsland，不在就拉起 + 记篡改事件）
    $guardExe = if ($InstallRoot) { Get-AgentGuardExePath $InstallRoot } else { '' }
    if ($guardExe -and (Test-Path -LiteralPath $guardExe)) {
        $gt = Get-AgentGuardTaskInfo
        V '守护进程任务' $(if ($gt) { 'ok' } else { 'warn' }) `
            $(if ($gt) { ($script:AGENT_GUARD_TASK + "（" + $gt.State + "，登录时拉起，15s 常驻探活）") } else { '未注册 —— 杀 agent 后要等 5 分钟看门狗才拉回' })
        $gproc = Get-Process -Name 'stelarith-guard' -ErrorAction SilentlyContinue
        V '守护进程运行' $(if ($gproc) { 'ok' } else { 'warn' }) `
            $(if ($gproc) { ('在跑（PID ' + $gproc.Id + '，防拆 L2）') } else { '已安装但未运行（任务未触发？）' })
    } else {
        V '守护进程' 'warn' '未安装（stelarith-guard.exe 缺失）—— 仅 L3 看门狗 5 分钟兜底'
    }

    # 只判断「有没有配」，绝不回显密钥本身
    # T06 整改：密钥不在 run-agent.cmd 里了，改存 agent-secret.cmd（ACL 受限）。
    # 兼容旧部署：旧版密钥明文写在 run-agent.cmd 里，两边都检查。
    $secretPath = Get-AgentSecretPath $InstallRoot
    $acmd = Get-AgentCmdPath $InstallRoot
    $secRaw = ''
    if (Test-Path -LiteralPath $secretPath) {
        $secRaw = Get-Content -LiteralPath $secretPath -Raw
    }
    $oldRaw = ''
    if (Test-Path -LiteralPath $acmd) {
        $oldRaw = Get-Content -LiteralPath $acmd -Raw
    }
    $raw = $secRaw + "`n" + $oldRaw
    $hasPub    = $raw -match 'STELARITH_SITE_PUBKEY='
    $hasSecret = $raw -match 'STELARITH_AGENT_SECRET='
    $secMode = if (Test-Path -LiteralPath $secretPath) { '密钥文件（ACL 受限）' } elseif ($raw) { '旧版启动器明文（建议重新部署以迁移）' } else { '' }
    V '代理指令验签' $(if ($hasPub -or $hasSecret) { 'ok' } else { 'warn' }) `
        $(if ($hasPub) { 'Ed25519 公钥模式（推荐）' + $(if ($secMode) { '，来源：' + $secMode } else { '' }) }
          elseif ($hasSecret) { '共享密钥模式（须与面板「设置 → 指令密钥」一致）' + $(if ($secMode) { '，来源：' + $secMode } else { '' }) }
          else { '未配置 —— 远程控制/重启会被代理拒绝' })
}

# --- AI 插件（第三方）的密钥：部署包**保留配置文件但把 apiKey 置空**，所以必须明说它会是「未配置」状态 ---
# 为什么值得单列：密钥被置空后，插件只是**不工作**，它不会告诉你「配置里是空的」——
# 现象与「这功能坏了」完全一样，正是本项目反复强调的「静默失败」。
# 2026-09-21 起不再整份丢弃该文件（整份丢弃会让插件启动就刷报错），改成置空密钥。
$aiDir = if ($InstallRoot) { Join-Path $InstallRoot 'data\Config\Plugins\ClassIsland.AISmartClass' } else { '' }
if ($aiDir -and (Test-Path -LiteralPath $aiDir)) {
    $aiFile = Join-Path $aiDir 'aisettings.json'
    if (-not (Test-Path -LiteralPath $aiFile)) {
        V 'AI 插件密钥' 'warn' '插件在但无配置文件 —— 要用就在本机重填（出包时按安全规则不落密钥）'
    } else {
        # 只判断「有没有填」，绝不回显密钥本身
        $aiRaw = Get-Content -LiteralPath $aiFile -Raw
        $aiM = [regex]::Match($aiRaw, '"apiKey"\s*:\s*"([^"]*)"')
        if ($aiM.Success -and $aiM.Groups[1].Value.Length -gt 8) {
            V 'AI 插件密钥' 'ok' ('已配置（长度 ' + $aiM.Groups[1].Value.Length + '，不回显内容）')
        } else {
            V 'AI 插件密钥' 'warn' 'apiKey 为空（部署包按安全规则置空）—— 要用就在本机重填，否则 AI 功能不会工作'
        }
    }
}

# ================================================================ 4. 服务端
Write-Head '四、服务器连通性'
$cfgLoaded = $false
$cfg = $null
if (Test-Path -LiteralPath $ConfigPath) { $cfg = Get-DeployConfig $ConfigPath; $cfgLoaded = $true }
if ($InstallRoot) {
    $sc = Get-SyncConfig $InstallRoot
    if ($sc) {
        # 以「本机实际生效的配置」为准，而不是部署包里的配置
        if (-not $cfg) { $cfg = New-DefaultConfig }
        $cfg.ServerBase = $sc.ClientAppBase
        $cfg.Slug = $sc.Slug
        $cfg.BaseDomain = $sc.BaseDomain
        $cfg.ClientUid = $sc.ClientUid
        $cfgLoaded = $true
        V '配置来源' 'ok' '本机插件 stelarith-sync.json（实际生效值）'
    }
}
if (-not $cfg -or -not $cfg.ServerBase) {
    V '服务端地址' 'fail' '配置里没有 ServerBase，无法探测'
} else {
    V '服务端地址' 'ok' $cfg.ServerBase
    V '租户 (Slug/基域)' 'ok' ($cfg.Slug + ' / ' + $cfg.BaseDomain)
    V '本机设备标识' 'ok' $cfg.ClientUid

    try { $u = [System.Uri]$cfg.ServerBase } catch { $u = $null }
    if ($u) {
        $tcp = Test-TcpPort -HostName $u.Host -Port $u.Port
        V 'CIMS 端口可达' $(if ($tcp) { 'ok' } else { 'fail' }) ($u.Host + ':' + $u.Port)

        if ($tcp) {
            # 关键：必须按插件的方式带 Host: <slug>.<基域>。不带的话 CIMS 一律 403，
            # 会把「一切正常」误报成「租户配置错误」。
            $hostHeader = ($cfg.Slug + '.' + $cfg.BaseDomain)
            $r = Test-HttpHost -Url ($cfg.ServerBase + '/api/v1/client/' + $cfg.ClientUid + '/manifest') -HostHeader $hostHeader
            if ($r.Status -eq 200 -or $r.Status -eq 302) {
                V 'Manifest 接口' 'ok' ('HTTP ' + $r.Status + '（已带 Host: ' + $hostHeader + '）—— 服务端认可本机身份')
            } elseif ($r.Status -eq 403) {
                V 'Manifest 接口' 'fail' ('HTTP 403 租户未识别（Host: ' + $hostHeader + '）—— 核对服务端 CIMS_BASE_DOMAIN / 账户 slug')
            } elseif ($r.Status -eq 404) {
                V 'Manifest 接口' 'warn' 'HTTP 404 —— 设备尚未在服务端登记'
            } else {
                V 'Manifest 接口' 'warn' ('异常响应：' + $r.Detail)
            }
        }

        # 面板（website 8090）
        $panel = ''
        try {
            $pc = Get-SyncConfig $InstallRoot
            $panelFile = Join-Path $InstallRoot ('data\' + $script:PLUGIN_DIRREL + '\stelarith-panel.json')
            if (Test-Path -LiteralPath $panelFile) { $panel = (Read-JsonFile $panelFile).panelUrl }
        } catch { }
        if ($panel) {
            try { $pu = [System.Uri]$panel } catch { $pu = $null }
            if ($pu) {
                $pt = Test-TcpPort -HostName $pu.Host -Port $pu.Port
                V '电教委员面板端口' $(if ($pt) { 'ok' } else { 'fail' }) ($pu.Host + ':' + $pu.Port)
            }
        }
    }
}

# ================================================================ 5. 插件日志
Write-Head '五、集控插件日志'
if ($InstallRoot) {
    $logDir = Join-Path $InstallRoot ('app-' + (Get-ClassIslandVersion $InstallRoot))
    $logs = @()
    if (Test-Path -LiteralPath $logDir) {
        $logs = Get-ChildItem -LiteralPath $logDir -Filter 'ste-*.log' -File -ErrorAction SilentlyContinue
    }
    if (-not $logs -or $logs.Count -eq 0) {
        $logs = Get-ChildItem -LiteralPath $InstallRoot -Filter 'ste-*.log' -File -Recurse -Depth 1 -ErrorAction SilentlyContinue
    }
    if ($logs -and $logs.Count -gt 0) {
        foreach ($l in ($logs | Sort-Object LastWriteTime -Descending)) {
            $sizeKB = [math]::Round($l.Length / 1KB, 1)
            $stale = ((Get-Date) - $l.LastWriteTime).TotalMinutes
            $state = if ($stale -gt 15) { 'warn' } else { 'ok' }
            V $l.Name $state ($sizeKB.ToString() + " KB，最后写入 " + $l.LastWriteTime.ToString('MM-dd HH:mm') + "（" + [math]::Round($stale, 0) + " 分钟前）")
        }
        $newest = ($logs | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
        Emit ''
        Emit ('  最近 5 行（' + $newest.Name + '）：') 'DarkGray'
        Get-Content -LiteralPath $newest.FullName -Tail 5 -Encoding UTF8 | ForEach-Object { Emit ('    ' + $_) 'DarkGray' }

        $big = $logs | Where-Object { $_.Length -gt 5MB }
        if ($big) {
            Emit ''
            V '日志体积' 'warn' ('有 ' + $big.Count + ' 个日志超过 5 MB，建议清理（见 docs 06-常见问题）')
        }
    } else {
        V '插件日志' 'warn' '未找到 ste-*.log —— 插件可能没有启动，或安装目录判断有误'
    }
}

# ================================================================ 结论
Write-Head '自检结论'
Emit ("  通过 " + $pass + " 项，注意 " + $warn + " 项，失败 " + $fail + " 项") $(if ($fail -gt 0) { 'Red' } elseif ($warn -gt 0) { 'Yellow' } else { 'Green' })
if ($fail -eq 0 -and $warn -eq 0) {
    Emit '  这台教室机状态良好。' 'Green'
} elseif ($fail -eq 0) {
    Emit '  没有致命问题；「注意」项通常不影响上课，可择机处理。' 'Yellow'
} else {
    Emit '  存在失败项，请对照上面的提示处理；不确定时把本页内容发给集控管理员。' 'Red'
}

if ($Report) {
    $outPath = if ([System.IO.Path]::IsPathRooted($Report)) { $Report } else { Join-Path (Get-Location).Path $Report }
    [System.IO.File]::WriteAllText($outPath, ($lines -join "`r`n"), (New-Object System.Text.UTF8Encoding($true)))
    Write-Host ''
    Write-Host ("  报告已保存：" + $outPath) -ForegroundColor Cyan
}
Write-Host ''
