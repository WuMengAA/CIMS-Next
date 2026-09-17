<#
=====================================================================
 星璃集控 · 升级 / 降级（换版本）
=====================================================================
 作用：把「新版本部署包」里的**插件**和/或**ClassIsland 本体**换到本机，
       全程保留 data 目录（课表、插件配置、日志）。
       降级与升级是同一个动作，只是版本号方向不同 —— 所以本脚本两者通用。

 典型用法：
   # 1) 只升级插件（最常见：日常只换插件）
   powershell -ExecutionPolicy Bypass -File upgrade.ps1 -From E:\ClassroomDeploy-新

   # 2) 连 ClassIsland 本体一起升级
   powershell -ExecutionPolicy Bypass -File upgrade.ps1 -From E:\ClassroomDeploy-新 -WithApp

   # 3) 回退到上一版（把 U 盘里的旧版本包当 -From 即可）
   powershell -ExecutionPolicy Bypass -File upgrade.ps1 -From E:\ClassroomDeploy-旧

   # 4) 卸掉自启与快捷方式（不动数据）
   powershell -ExecutionPolicy Bypass -File upgrade.ps1 -RemoveAutoStart

 安全设计：
   · 换 DLL 前必须先停 ClassIsland —— 宿主会锁住 DLL，复制会失败（Device or resource busy）。
   · 每次替换前把旧文件备份到 插件目录\.bak-<时间戳>\，随时可手工回退。
   · 只替换程序文件与清单，绝不触碰 data 下用户的课表 / 设置。
=====================================================================
#>
[CmdletBinding()]
param(
    [string]$From = '',
    [string]$InstallRoot = '',
    [switch]$WithApp,
    [switch]$RemoveAutoStart,
    [switch]$NoRestart,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib-common.ps1')

Write-Head '星璃集控 · 升级 / 降级'

# ---------------------------------------------------------------- 卸自启模式
if ($RemoveAutoStart) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $startup = [Environment]::GetFolderPath('Startup')
    foreach ($p in @((Join-Path $startup 'ClassIsland.lnk'), (Join-Path $desktop 'ClassIsland.lnk'), (Join-Path $desktop '电教委员面板.url'))) {
        if (Test-Path -LiteralPath $p) {
            Remove-Item -LiteralPath $p -Force
            Write-Ok ('已删除 ' + $p)
        } else {
            Write-Info ('不存在，跳过：' + $p)
        }
    }
    # 本地代理的自启也要一起摘 —— 否则「卸掉自启」只卸了一半，
    # 重登录后代理照样自己起来，人会以为没卸干净。
    if (Get-AgentTaskInfo) {
        try { Stop-ScheduledTask -TaskName $script:AGENT_TASK -ErrorAction SilentlyContinue } catch { }
        Unregister-ScheduledTask -TaskName $script:AGENT_TASK -Confirm:$false
        Get-Process -Name 'stelarith-agent' -ErrorAction SilentlyContinue |
            ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch { } }
        Write-Ok ('已移除本地代理自启任务：' + $script:AGENT_TASK)
    } else {
        Write-Info '本地代理自启任务不存在，跳过。'
    }
    Write-Warn '已移除开机自启与桌面快捷方式（数据与安装目录保留）。'
    exit 0
}

if (-not $InstallRoot) { $InstallRoot = Find-ClassIslandRoot }
if (-not $InstallRoot -or -not (Test-Path -LiteralPath $InstallRoot)) {
    Write-Err '未找到 ClassIsland 安装目录，请用 -InstallRoot 指定。'
    exit 1
}
Write-Ok ('安装目录：' + $InstallRoot)

$dataDir   = Join-Path $InstallRoot 'data'
$pluginDir = Join-Path $dataDir $script:PLUGIN_DIRREL

# ---------------------------------------------------------------- 来源校验
if (-not $From) {
    Write-Err '请用 -From 指定新版本部署包目录（含 app\ 与 seed\data\Plugins 的那个根目录）。'
    Write-Info '例如：-From E:\ClassroomDeploy-20260916'
    exit 2
}
if (-not (Test-Path -LiteralPath $From)) {
    Write-Err ('来源目录不存在：' + $From)
    exit 2
}

$srcPluginDir = Join-Path $From 'seed\data\' 
$srcPluginDir = Join-Path $srcPluginDir $script:PLUGIN_DIRREL
$hasSrcPlugin = Test-Path -LiteralPath (Join-Path $srcPluginDir 'StelarithControlPlugin.dll')
$hasSrcApp    = Test-Path -LiteralPath (Join-Path $From 'app\ClassIsland.exe')

Write-Host ''
Write-Host '  即将执行：' -ForegroundColor White
Write-Host ('    · 来源：' + $From) -ForegroundColor Gray
Write-Host ('    · 替换插件：' + $(if ($hasSrcPlugin) { '是' } else { '否（来源包内无插件）' })) -ForegroundColor Gray
Write-Host ('    · 替换本体：' + $(if ($WithApp -and $hasSrcApp) { '是' } else { '否' })) -ForegroundColor Gray
Write-Host  '    · 保留数据：是（data 目录不会被改动）' -ForegroundColor Gray

if (-not $hasSrcPlugin -and -not ($WithApp -and $hasSrcApp)) {
    Write-Err '来源包里既没有可用插件，也没有要求替换本体，无事可做。'
    exit 2
}
if ($DryRun) { Write-Warn 'DryRun 模式：以下只显示动作，不执行。' }

# ---------------------------------------------------------------- 1. 停进程
Write-Head '第 1 步 / 共 5 步 · 停止 ClassIsland'
$wasRunning = (Get-ClassIslandProcess).Count -gt 0
if ($wasRunning) {
    if ($DryRun) {
        Write-Info '[演练] 将停止 ClassIsland'
    } else {
        $okStop = Stop-ClassIsland
        if ($okStop) { Write-Ok '已停止（DLL 不再被锁）' }
        else { Write-Err '进程未能完全退出，复制会失败。请手工结束 ClassIsland 后重试。'; exit 3 }
    }
} else {
    Write-Ok '进程未运行，无需停止'
}

# ---------------------------------------------------------------- 2. 备份
Write-Head '第 2 步 / 共 5 步 · 备份将要被替换的文件'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bakDir = Join-Path $pluginDir ('.bak-' + $stamp)
if (-not $DryRun) {
    New-Item -ItemType Directory -Path $bakDir -Force | Out-Null
    $toBackup = @('StelarithControlPlugin.dll', 'StelarithControlPlugin.deps.json', 'StelarithControlPlugin.pdb', 'manifest.yml', 'stelarith-sync.json', 'stelarith-panel.json')
    foreach ($f in $toBackup) {
        $p = Join-Path $pluginDir $f
        if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $bakDir -Force }
    }
    Write-Ok ('旧版本已备份到 ' + $bakDir)
    Write-Info '如需回退：把该目录里的文件复制回上一级即可（或直接把它当作 -From 的插件来源）。'
} else {
    Write-Info ('[演练] 将备份到 ' + $bakDir)
}

# ---------------------------------------------------------------- 3. 替换插件
Write-Head '第 3 步 / 共 5 步 · 替换集控插件'
if (-not $hasSrcPlugin) {
    Write-Warn '来源包内没有插件，跳过。'
} elseif ($DryRun) {
    Write-Info ('[演练] 将复制 ' + $srcPluginDir + '\*.dll|deps.json|manifest.yml  ->  ' + $pluginDir)
} else {
    # 先读旧版本号，便于对照
    $oldManifest = Join-Path $pluginDir 'manifest.yml'
    $oldVer = ''
    if (Test-Path -LiteralPath $oldManifest) {
        $m = Select-String -LiteralPath $oldManifest -Pattern '^\s*version:\s*(.+)$' | Select-Object -First 1
        if ($m) { $oldVer = $m.Matches[0].Groups[1].Value.Trim() }
    }
    Copy-Item -LiteralPath (Join-Path $srcPluginDir 'StelarithControlPlugin.dll') -Destination $pluginDir -Force
    foreach ($f in @('StelarithControlPlugin.deps.json', 'StelarithControlPlugin.pdb', 'manifest.yml')) {
        $s = Join-Path $srcPluginDir $f
        if (Test-Path -LiteralPath $s) { Copy-Item -LiteralPath $s -Destination $pluginDir -Force }
    }
    Write-Ok '插件程序文件与清单已替换'
    Write-Info '注意：manifest.yml 必须与 dll 一起换 —— 面板/插件管理页显示的版本号取自 manifest，只换 dll 会显示旧版本。'

    $newManifest = Join-Path $pluginDir 'manifest.yml'
    $newVer = ''
    if (Test-Path -LiteralPath $newManifest) {
        $m = Select-String -LiteralPath $newManifest -Pattern '^\s*version:\s*(.+)$' | Select-Object -First 1
        if ($m) { $newVer = $m.Matches[0].Groups[1].Value.Trim() }
    }
    Write-Ok ('版本：' + $(if ($oldVer) { $oldVer } else { '未知' }) + '  ->  ' + $(if ($newVer) { $newVer } else { '未知' }))
}

# 3.5 本地代理：新包里带了就一起换，否则代理会永远停在旧版本
#     为什么放在「替换插件」里：两者都是程序文件，且同样不该触碰 data。
$srcAgentExe = Join-Path $From 'agent\stelarith-agent.exe'
if (-not (Test-Path -LiteralPath $srcAgentExe)) {
    Write-Info '来源包内没有本地代理，跳过（当前代理保持原样）。'
} elseif ($DryRun) {
    Write-Info ('[演练] 将替换本地代理 -> ' + (Get-AgentExePath $InstallRoot))
} else {
    # 配置取值优先级：
    #   ① 本机已在用的 run-agent.cmd（里面是本机实际生效的密钥）—— 保住「已经跑通的配置」
    #   ② 新包 config\deployment.json 的 Agent 段 —— 适用于本机还没装过代理的情况
    #   ③ 都没有 → 不装。半成品代理（没密钥）会让远程控制/重启全部被拒，
    #      比明确不装更糟：面板上看着有，点了永远失败。
    $agentCfg = [ordered]@{ DeviceUid = ''; Secret = ''; SitePubKey = ''; ExtUrl = ''; VncCmd = '' }
    $cfgSource = ''
    $oldCmd = Get-AgentCmdPath $InstallRoot
    if (Test-Path -LiteralPath $oldCmd) {
        $raw = Get-Content -LiteralPath $oldCmd -Raw
        foreach ($pair in @(
            @('STELARITH_DEVICE_UID',    'DeviceUid'),
            @('STELARITH_AGENT_SECRET',  'Secret'),
            @('STELARITH_SITE_PUBKEY',   'SitePubKey'),
            @('STELARITH_EXT_URL',       'ExtUrl'),
            @('STELARITH_VNC_CMD',       'VncCmd'))) {
            $m = [regex]::Match($raw, ('set "' + $pair[0] + '=([^"]*)"'))
            if ($m.Success) { $agentCfg[$pair[1]] = $m.Groups[1].Value.Replace('%%', '%') }
        }
        $cfgSource = '本机现有启动器'
    } else {
        $newCfgPath = Join-Path $From 'config\deployment.json'
        if (Test-Path -LiteralPath $newCfgPath) {
            $nc = Get-DeployConfig $newCfgPath
            $agentCfg.DeviceUid  = [string]$nc.ClientUid
            $agentCfg.Secret     = [string]$nc.Agent.Secret
            $agentCfg.SitePubKey = [string]$nc.Agent.SitePubKey
            $agentCfg.ExtUrl     = [string]$nc.Agent.ExtUrl
            $agentCfg.VncCmd     = [string]$nc.Agent.VncCmd
            $cfgSource = '新包 deployment.json'
        }
    }

    if (-not $agentCfg.Secret -and -not $agentCfg.SitePubKey) {
        Write-Warn '本机既没有代理启动器，新包里也没配 Agent.Secret / SitePubKey。'
        Write-Info '已跳过代理安装 —— 不装半个配置的代理（它只会让按钮「点了永远失败」）。'
        Write-Info '要用远程控制/重启，请跑一次「1-部署到本机.cmd」并填好 Agent.Secret。'
    } else {
        $ar = Install-StelarithAgent -InstallDir $InstallRoot -AgentCfg $agentCfg
        if ($ar.Skipped)     { Write-Warn $ar.Detail }
        elseif ($ar.Ok)      { Write-Ok ('本地代理已更新并重启（配置沿用' + $cfgSource + '，' + $ar.Detail + '）') }
        else                 { Write-Warn ('本地代理已替换，但探活未通过：' + $ar.Detail) }
    }
}

# ---------------------------------------------------------------- 4. 替换本体
Write-Head '第 4 步 / 共 5 步 · 替换 ClassIsland 本体'
if (-not ($WithApp -and $hasSrcApp)) {
    Write-Info '未启用本体替换（如需请加 -WithApp）。'
} elseif ($DryRun) {
    Write-Info ('[演练] 将复制 ' + (Join-Path $From 'app') + '  ->  ' + $InstallRoot + '（data 目录不受影响）')
} else {
    $result = & robocopy (Join-Path $From 'app') $InstallRoot /E /NFL /NDL /NJH /NJS /R:1 /W:1 /XD data
    if ($LASTEXITCODE -ge 8) {
        Write-Err ('本体复制失败，robocopy 返回码 ' + $LASTEXITCODE)
        exit 4
    }
    Write-Ok '本体文件已更新（已排除 data 目录）'
    $newVer = Get-ClassIslandVersion $InstallRoot
    Write-Ok ('当前本体版本目录：app-' + $newVer)
    Write-Info '若出现多个 app-* 目录，ClassIsland.exe 会按 files.json 选取目标版本。'
}

# ---------------------------------------------------------------- 5. 重启与校验
Write-Head '第 5 步 / 共 5 步 · 重启与校验'
if ($NoRestart) {
    Write-Warn '按参数要求不自动启动，请手工打开 ClassIsland。'
} elseif ($DryRun) {
    Write-Info '[演练] 将启动 ClassIsland'
} else {
    $p = Start-ClassIsland -Root $InstallRoot -WaitSeconds 25
    if ($p) {
        Write-Ok ('ClassIsland 已启动（PID ' + $p.Id + '）')
        Start-Sleep -Seconds 10
        $exeDir = Join-Path $InstallRoot ('app-' + (Get-ClassIslandVersion $InstallRoot))
        $newLogs = Get-ChildItem -LiteralPath $exeDir -Filter 'ste-*.log' -File -ErrorAction SilentlyContinue |
                   Where-Object { ((Get-Date) - $_.LastWriteTime).TotalMinutes -lt 3 }
        if ($newLogs -and $newLogs.Count -gt 0) {
            Write-Ok ('插件已在新进程中工作，本轮刷新了 ' + $newLogs.Count + ' 个诊断日志：')
            $newLogs | ForEach-Object { Write-Info ('  ' + $_.Name) }
        } else {
            Write-Warn '未看到本轮新增的插件日志。可能原因：启动较慢、或插件加载失败。'
            Write-Info '请运行「2-环境自检.cmd」进一步定位。'
        }
    } else {
        Write-Err '未能启动 ClassIsland，请手工双击桌面快捷方式。'
        exit 5
    }
}

Write-Host ''
Write-Host '  完成。建议接着跑一次「2-环境自检.cmd」确认版本与连通性。' -ForegroundColor Green
Write-Host ('  本次备份位置（可手工回退）：' + $bakDir) -ForegroundColor DarkGray
Write-Host ''
