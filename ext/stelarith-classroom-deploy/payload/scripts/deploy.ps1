<#
=====================================================================
 星璃集控 · 教室端一键部署
=====================================================================
 作用：把离线包里的 ClassIsland 本体 + 预置数据 + 集控插件装到本机，
       写入指向学校服务端的配置，并建立开机自启与桌面快捷方式。

 用法（一般由「1-部署到本机.cmd」双击调用，也可手动执行）：
   powershell -ExecutionPolicy Bypass -File deploy.ps1
   powershell -ExecutionPolicy Bypass -File deploy.ps1 -NonInteractive
   powershell -ExecutionPolicy Bypass -File deploy.ps1 -DryRun     # 只看计划，不动磁盘

 设计原则：
   · 幂等 —— 重复执行不会破坏已有数据；已有文件默认不覆盖（除脚本主动管理的配置文件）。
   · 可解释 —— 每一步都打印在做什么、为什么。
   · 不静默失败 —— 连不上服务端只警告、不中断（教室断网也要能显示课表）。
   · 不碰系统配置 —— 只写自己的安装目录、启动文件夹、桌面。
=====================================================================
#>
[CmdletBinding()]
param(
    [string]$ConfigPath = '',
    [switch]$NonInteractive,
    [switch]$DryRun,
    [switch]$SkipAppInstall,
    [switch]$OpenFirewall
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib-common.ps1')

$pkgRoot = Split-Path -Parent $PSScriptRoot
if (-not $ConfigPath) { $ConfigPath = Join-Path $pkgRoot 'config\deployment.json' }

Write-Head '星璃集控 · 教室端一键部署'
Write-Info ("部署包目录：" + $pkgRoot)
Write-Info ("配置文件：" + $ConfigPath)
if ($DryRun) { Write-Warn '当前为 DryRun（演练）模式：只显示将要执行的动作，不修改任何文件。' }

# ---------------------------------------------------------------- 0. 权限
if (-not (Test-Admin)) {
    Write-Err '本脚本需要管理员权限（要写入安装目录、启动文件夹与桌面）。'
    Write-Info '请右键使用「1-部署到本机.cmd」-> 以管理员身份运行，或在管理员 PowerShell 中执行本脚本。'
    exit 1
}
Write-Ok '管理员权限已确认'

# ---------------------------------------------------------------- 1. 配置
Write-Head '第 1 步 / 共 7 步 · 读取部署配置'
$cfg = Get-DeployConfig $ConfigPath
Write-Ok ("已载入配置：" + $ConfigPath)

function Read-Required([string]$Label, [string]$Current, [string]$Example) {
    if ($Current -and $Current.Trim() -ne '') { return $Current.Trim() }
    if ($NonInteractive) {
        Write-Err ("配置项为空且处于 -NonInteractive 模式：" + $Label)
        Write-Info ("请先在 config\deployment.json 里填写，例如：" + $Example)
        exit 2
    }
    Write-Host ''
    Write-Host ("  需要填写：" + $Label) -ForegroundColor Yellow
    Write-Host ("  例如：" + $Example) -ForegroundColor Gray
    $v = Read-Host '  请输入（直接回车取消部署）'
    if ([string]::IsNullOrWhiteSpace($v)) {
        Write-Err '未提供必需信息，已取消。'
        exit 2
    }
    return $v.Trim()
}

$cfg.ServerBase = Normalize-Url $cfg.ServerBase
if (-not $cfg.ServerBase) {
    $cfg.ServerBase = Normalize-Url (Read-Required '学校集控服务端地址（CIMS 客户端端口）' '' 'http://10.0.0.10:8096')
} else {
    Write-Ok ("服务端地址：" + $cfg.ServerBase)
}

if (-not $cfg.ServerPanel) { $cfg.ServerPanel = ConvertTo-PanelUrl $cfg.ServerBase }
$cfg.ServerPanel = Normalize-Url $cfg.ServerPanel

if (-not $cfg.ClientUid) { $cfg.ClientUid = Get-ClientUidDefault }
$cfg.ClientUid = ($cfg.ClientUid.ToLower() -replace '[^a-z0-9\-]', '-').Trim('-')

$cfg.InstallDir = $cfg.InstallDir.TrimEnd('\')
if (-not $cfg.ClassName) { $cfg.ClassName = '' }

Write-Host ''
Write-Host '  本次部署参数：' -ForegroundColor White
Write-Host ("    · 服务端 CIMS    : " + $cfg.ServerBase) -ForegroundColor Gray
Write-Host ("    · 电教委员面板   : " + $cfg.ServerPanel) -ForegroundColor Gray
Write-Host ("    · 租户 (Slug)    : " + $cfg.Slug + "    基域: " + $cfg.BaseDomain) -ForegroundColor Gray
Write-Host ("    · 本机设备标识   : " + $cfg.ClientUid + "    (CUID 由 ClassIsland 自行生成)") -ForegroundColor Gray
Write-Host ("    · 安装目录       : " + $cfg.InstallDir) -ForegroundColor Gray
Write-Host ("    · 开机自启       : " + $cfg.AutoStart) -ForegroundColor Gray
Write-Host ("    · 课表写回本机   : " + $cfg.ResourceWriteBack) -ForegroundColor Gray
if ($cfg.OfficialManagement.Enabled) {
    Write-Host ("    · 官方集控       : 已启用（Kind=" + $cfg.OfficialManagement.ManagementServerKind + "）") -ForegroundColor Gray
} else {
    Write-Host  '    · 官方集控       : 未启用（由星璃插件负责同步）' -ForegroundColor Gray
}

# ---------------------------------------------------------------- 2. 前置检查
Write-Head '第 2 步 / 共 7 步 · 环境前置检查'

# 2.1 安装源存在
if (-not (Test-Path -LiteralPath $script:PKG_APP)) {
    Write-Err ("部署包缺少 app 目录：" + $script:PKG_APP)
    Write-Info '请确认 U 盘里的文件已完整拷贝（app / seed / scripts / config / docs 五个目录都要在）。'
    exit 3
}
Write-Ok 'ClassIsland 安装源存在'

$hasSeed = Test-Path -LiteralPath $script:PKG_SEED
if ($hasSeed) { Write-Ok '预置数据（seed）存在' } else { Write-Warn '未找到 seed 目录：将不预置数据（首次运行会走欢迎向导）' }

# 2.2 磁盘空间
$freeGB = Get-FreeSpaceGB (Split-Path -Qualifier $cfg.InstallDir)
if ($freeGB -ge 0) {
    if ($freeGB -lt 2) {
        Write-Err ("安装盘可用空间仅 " + $freeGB + " GB，至少需要 2 GB。")
        exit 3
    }
    Write-Ok ("安装盘可用空间 " + $freeGB + " GB")
}

# 2.3 操作系统
$os = [System.Environment]::OSVersion.Version
if ($os.Major -lt 10) {
    Write-Warn ("当前系统版本 " + $os + "，ClassIsland 官方建议 Windows 10 及以上。")
} else {
    Write-Ok ("Windows 版本 " + $os.Major + "." + $os.Minor)
}

# 2.4 连通性（不阻断）
$uri = [System.Uri]$cfg.ServerBase
Write-Step ("探测服务端连通性：" + $uri.Host + ":" + $uri.Port)
$tcp = Test-TcpPort -HostName $uri.Host -Port $uri.Port
if ($tcp) {
    Write-Ok 'TCP 可达'
    $url = $cfg.ServerBase + '/api/v1/client/' + $cfg.ClientUid + '/manifest'
    # 必须按插件的方式带 Host: <slug>.<基域>，否则 CIMS 一律 403（详见 docs/01 第 0 节）
    $r = Test-HttpHost -Url $url -HostHeader ($cfg.Slug + '.' + $cfg.BaseDomain)
    if ($r.Status -eq 200 -or $r.Status -eq 302) {
        Write-Ok ("Manifest 接口可用（HTTP " + $r.Status + "）")
    } elseif ($r.Status -eq 403) {
        Write-Warn ("Manifest 返回 403：服务端在，但租户未被识别。")
        Write-Info ("请核对服务端 .env 的 CIMS_BASE_DOMAIN 是否等于 '" + $cfg.BaseDomain + "'、账户 slug 是否等于 '" + $cfg.Slug + "'。")
    } else {
        Write-Warn ("Manifest 探测未得到预期响应：" + $r.Detail)
    }
} else {
    Write-Warn ("连不上 " + $uri.Host + ":" + $uri.Port + " —— 这不影响安装。")
    Write-Info 'ClassIsland 会先按预置档案显示课表；等网络通了插件自动开始同步。'
    if (-not $NonInteractive) {
        $go = Read-Host '  仍要继续部署吗？(Y/n)'
        if ($go -and $go.Trim().ToLower().StartsWith('n')) { Write-Info '已按你的选择取消。'; exit 0 }
    }
}

# ---------------------------------------------------------------- 3. 安装本体
Write-Head '第 3 步 / 共 7 步 · 安装 ClassIsland 本体'
if ($SkipAppInstall) {
    Write-Warn '按参数要求跳过本体安装（-SkipAppInstall）'
} elseif ($DryRun) {
    Write-Info ("[演练] 将复制 " + $script:PKG_APP + "  ->  " + $cfg.InstallDir)
} else {
    if (-not (Test-Path -LiteralPath $cfg.InstallDir)) {
        New-Item -ItemType Directory -Path $cfg.InstallDir -Force | Out-Null
        Write-Ok ("已创建安装目录 " + $cfg.InstallDir)
    } else {
        Write-Ok ("安装目录已存在，将增量覆盖程序文件：" + $cfg.InstallDir)
    }
    # robocopy 的返回码 0-7 都是成功
    $null = & robocopy $script:PKG_APP $cfg.InstallDir /E /NFL /NDL /NJH /NJS /R:1 /W:1
    if ($LASTEXITCODE -ge 8) {
        Write-Err ("复制程序文件失败，robocopy 返回码 " + $LASTEXITCODE)
        exit 4
    }
    Write-Ok '程序文件已就位'
}

# ---------------------------------------------------------------- 4. 预置数据
Write-Head '第 4 步 / 共 7 步 · 预置数据与插件'
$dataDir = Join-Path $cfg.InstallDir 'data'
$pluginDir = Join-Path $dataDir $script:PLUGIN_DIRREL

if ($DryRun) {
    Write-Info ("[演练] 目标数据目录：" + $dataDir)
} else {
    if (-not (Test-Path -LiteralPath $dataDir)) {
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    }

    # 4.1 首次部署：整包落盘；已存在：只补缺失（绝不覆盖用户/已同步的数据）
    if ($hasSeed) {
        if (-not (Get-ChildItem -LiteralPath $dataDir -Force -ErrorAction SilentlyContinue)) {
            Copy-Item -Path (Join-Path $script:PKG_SEED '*') -Destination $dataDir -Recurse -Force
            Write-Ok '预置数据已整体落盘（首次部署）'
        } else {
            Write-Step '数据目录已存在，仅补齐缺失文件（不覆盖已有文件）'
            $copied = 0
            $seedFiles = Get-ChildItem -LiteralPath $script:PKG_SEED -Recurse -File
            foreach ($f in $seedFiles) {
                $rel = $f.FullName.Substring($script:PKG_SEED.Length).TrimStart('\')
                $dst = Join-Path $dataDir $rel
                if (-not (Test-Path -LiteralPath $dst)) {
                    $dd = Split-Path -Parent $dst
                    if (-not (Test-Path -LiteralPath $dd)) { New-Item -ItemType Directory -Path $dd -Force | Out-Null }
                    Copy-Item -LiteralPath $f.FullName -Destination $dst -Force
                    $copied = $copied + 1
                }
            }
            Write-Ok ("补齐 " + $copied + " 个缺失文件（已存在的文件一律保留）")
        }
    }

    # 4.2 把种子里的 {{INSTALL_DIR}} 占位符换成真实安装目录
    #     为什么必须做：宿主的设置里存的是**绝对路径**（实测 Settings.json 里写死了
    #     出包机器的 <源目录>\assets\musics\*.wav）。不换掉的话，装到别的机器上提醒音效会
    #     **静默失效** —— 不报错、不提示，只是上课打铃没声音，极难排查。
    #     注意 JSON 里路径是转义的（\\），所以替换值也要转义，否则会产生非法转义序列。
    $phTarget = $cfg.InstallDir.Replace('\', '\\')
    $phFiles = 0
    $jsonFiles = Get-ChildItem -LiteralPath $dataDir -Recurse -File -Filter '*.json' -ErrorAction SilentlyContinue
    foreach ($jf in $jsonFiles) {
        $t = [System.IO.File]::ReadAllText($jf.FullName, [System.Text.Encoding]::UTF8)
        if ($t.Contains('{{INSTALL_DIR}}')) {
            [System.IO.File]::WriteAllText($jf.FullName, $t.Replace('{{INSTALL_DIR}}', $phTarget), (New-Object System.Text.UTF8Encoding($false)))
            $phFiles = $phFiles + 1
        }
    }
    if ($phFiles -gt 0) {
        Write-Ok ("已把 " + $phFiles + " 个配置文件里的安装路径占位符替换为 " + $cfg.InstallDir)
    } else {
        Write-Info '未发现路径占位符（若来源包已就地替换过，属正常）。'
    }

    if (-not (Test-Path -LiteralPath $pluginDir)) {
        New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
        Write-Warn '未发现插件目录，已创建空目录；若包内无插件文件，请检查部署包完整性。'
    } else {
        Write-Ok '集控插件目录已就位'
    }
}

# ---------------------------------------------------------------- 5. 写配置
Write-Head '第 5 步 / 共 7 步 · 写入指向服务端的配置'

# 5.1 插件同步配置：stelarith-sync.json（插件从程序集目录读取，即插件目录下）
$syncCfg = [ordered]@{
    ClientAppBase          = $cfg.ServerBase
    BaseDomain             = $cfg.BaseDomain
    Slug                   = $cfg.Slug
    ClientUid              = $cfg.ClientUid
    ClassPlanName          = $(if ($cfg.ClassPlanName) { $cfg.ClassPlanName } else { 'default_classplan' })
    ComponentsName         = 'default_components'
    RefreshIntervalSeconds = [int]$cfg.RefreshIntervalSeconds
    ResourceWriteBack      = [bool]$cfg.ResourceWriteBack
    MessageFeedBase        = ''
    NotificationSourceName = $cfg.NotificationSourceName
    VoiceHubBase           = $cfg.VoiceHubBase
    VoiceHubKey            = $cfg.VoiceHubKey
    SongboardResource      = 'songboard'
    SongboardRefreshSeconds = 15
}
$syncPath = Join-Path $pluginDir 'stelarith-sync.json'

# 5.2 面板地址：stelarith-panel.json（插件设置页内嵌面板用）
$panelCfg = [ordered]@{ panelUrl = $cfg.ServerPanel }
$panelPath = Join-Path $pluginDir 'stelarith-panel.json'

if ($DryRun) {
    Write-Info ("[演练] 将写入 " + $syncPath)
    Write-Info ("[演练] 将写入 " + $panelPath)
} else {
    if (Test-Path -LiteralPath $syncPath) {
        $b = Backup-File $syncPath 'before-deploy'
        Write-Info ("已备份原同步配置：" + (Split-Path -Leaf $b))
    }
    Save-JsonFile -Path $syncPath -Object $syncCfg
    Write-Ok 'stelarith-sync.json 已写入'

    Save-JsonFile -Path $panelPath -Object $panelCfg
    Write-Ok 'stelarith-panel.json 已写入'
}

# 5.3 宿主设置：关闭「插件异常即自动禁用」、跳过欢迎向导
$settingsPath = Join-Path $dataDir 'Settings.json'
if (Test-Path -LiteralPath $settingsPath) {
    if ($DryRun) {
        Write-Info ("[演练] 将修正 " + $settingsPath + " 的 AutoDisableCorruptPlugins / CorruptPluginsDisabledLastSession / IsWelcomeWindowShowed")
    } else {
        $raw = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8
        $orig = $raw
        $raw = [regex]::Replace($raw, '("AutoDisableCorruptPlugins"\s*:\s*)(true|false)', '${1}false')
        $raw = [regex]::Replace($raw, '("CorruptPluginsDisabledLastSession"\s*:\s*)(true|false)', '${1}false')
        $raw = [regex]::Replace($raw, '("IsWelcomeWindowShowed"\s*:\s*)(true|false)', '${1}true')
        if ($raw -ne $orig) {
            $b = Backup-File $settingsPath 'before-deploy'
            $utf8 = New-Object System.Text.UTF8Encoding($false)
            [System.IO.File]::WriteAllText($settingsPath, $raw, $utf8)
            Write-Ok 'Settings.json 已修正（已备份 ' + (Split-Path -Leaf $b) + '）'
        } else {
            Write-Ok 'Settings.json 无需修正'
        }
        Write-Info '说明：关闭 AutoDisableCorruptPlugins 是因为宿主没有运行时的插件启停接口，'
        Write-Info '      一旦某个插件抽风就可能把集控插件连带禁用，教室端会静默失联。'
    }
} else {
    Write-Warn '未找到 Settings.json（首次运行时 ClassIsland 会自行生成）。'
    Write-Info '插件 StelarithHostGuard 会在启动时自动把 AutoDisableCorruptPlugins 置为 false，无需手工处理。'
}

# 5.4 官方集控绑定（可选）
if ($cfg.OfficialManagement.Enabled) {
    Write-Step '写入 ClassIsland 官方集控绑定文件 ManagementPreset.json'
    $om = $cfg.OfficialManagement
    $kind = [int]$om.ManagementServerKind
    if ($kind -eq 1 -and -not $om.ManagementServer) {
        Write-Warn '官方集控选择「集控服务器(1)」但未填 ManagementServer，已跳过。'
    } elseif ($kind -eq 0 -and -not $om.ManifestUrlTemplate) {
        Write-Warn '官方集控选择「静态配置(0)」但未填 ManifestUrlTemplate，已跳过。'
    } else {
        $preset = [ordered]@{
            ManagementServerKind = $kind
            ManagementServer     = [string]$om.ManagementServer
            ManifestUrlTemplate  = [string]$om.ManifestUrlTemplate
            ClassIdentity        = [string]$om.ClassIdentity
        }
        $presetPath = Join-Path $cfg.InstallDir 'ManagementPreset.json'
        if ($DryRun) {
            Write-Info ("[演练] 将写入 " + $presetPath)
        } else {
            Save-JsonFile -Path $presetPath -Object $preset
            Write-Ok 'ManagementPreset.json 已写入（下次启动 ClassIsland 后可在 设置 -> 集控 中确认）'
        }
    }
}

# ---------------------------------------------------------------- 6. 自启与快捷方式
Write-Head '第 6 步 / 共 7 步 · 开机自启与桌面快捷方式'

$exeRoot = Join-Path $cfg.InstallDir 'ClassIsland.exe'
$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')

if ($DryRun) {
    Write-Info ("[演练] 自启=" + $cfg.AutoStart + "  快捷方式=" + $cfg.CreateDesktopShortcut)
} else {
    if (-not (Test-Path -LiteralPath $exeRoot)) {
        Write-Warn ("未找到启动器 " + $exeRoot + "，跳过快捷方式创建。")
    } else {
        $icon = Join-Path $cfg.InstallDir 'app-2.1.0.1-0\ClassIsland.Desktop.exe'

        if ($cfg.AutoStart) {
            $lnk = Join-Path $startup 'ClassIsland.lnk'
            New-ShortcutFile -Path $lnk -TargetPath $exeRoot -WorkingDirectory $cfg.InstallDir -IconLocation $icon
            Write-Ok ('已加入开机自启：' + $lnk)
            Write-Info '（通过「启动」文件夹实现：登录桌面后自动显示课表，不需要 UAC 授权，也便于随时删除）'
        }

        if ($cfg.CreateDesktopShortcut) {
            New-ShortcutFile -Path (Join-Path $desktop 'ClassIsland.lnk') -TargetPath $exeRoot -WorkingDirectory $cfg.InstallDir -IconLocation $icon
            Write-Ok '桌面快捷方式「ClassIsland」已创建'
            New-UrlShortcutFile -Path (Join-Path $desktop '电教委员面板.url') -Url $cfg.ServerPanel
            Write-Ok ('桌面快捷方式「电教委员面板」已创建 -> ' + $cfg.ServerPanel)
        }
    }
}

# 6.1 可选：放行本机入站端口（仅当这台机器同时充当服务端时使用）
if ($OpenFirewall) {
    Write-Step '按参数要求放行本机入站端口 8090 / 8096 / 8097 / 8098'
    if (-not $DryRun) {
        foreach ($p in 8090, 8096, 8097, 8098) {
            $name = "Stelarith Server (TCP $p)"
            if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
                New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $p -Profile Any | Out-Null
                Write-Ok ("已放行 TCP " + $p)
            } else {
                Write-Ok ("已存在放行规则 TCP " + $p)
            }
        }
    }
}

# ---------------------------------------------------------------- 7. 收尾自检
Write-Head '第 7 步 / 共 7 步 · 部署结果自检'
$checks = @()
$checks += ,@('安装目录',       (Test-Path -LiteralPath $cfg.InstallDir))
$checks += ,@('启动器 exe',     (Test-Path -LiteralPath $exeRoot))
$checks += ,@('数据目录',       (Test-Path -LiteralPath $dataDir))
$checks += ,@('插件 DLL',       (Test-Path -LiteralPath (Join-Path $pluginDir 'StelarithControlPlugin.dll')))
$checks += ,@('插件清单',       (Test-Path -LiteralPath (Join-Path $pluginDir 'manifest.yml')))
$checks += ,@('同步配置',       (Test-Path -LiteralPath $syncPath))
$checks += ,@('面板地址配置',   (Test-Path -LiteralPath $panelPath))
$checks += ,@('课表档案',       (Test-Path -LiteralPath (Join-Path $dataDir 'Profiles\Default.json')))
$allOk = $true
foreach ($c in $checks) {
    if ($c[1]) { Write-Host ("  [OK]   " + $c[0]) -ForegroundColor Green }
    else       { Write-Host ("  [缺失] " + $c[0]) -ForegroundColor Red; $allOk = $false }
}

Write-Host ''
if ($allOk) {
    Write-Host '  ****************************************************' -ForegroundColor Green
    Write-Host '    部署完成 —— 所有检查项通过' -ForegroundColor Green
    Write-Host '  ****************************************************' -ForegroundColor Green
} else {
    Write-Host '  ****************************************************' -ForegroundColor Yellow
    Write-Host '    部署完成，但存在缺失项，请查看上面的 [缺失]' -ForegroundColor Yellow
    Write-Host '  ****************************************************' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '  接下来请做这三件事：' -ForegroundColor White
Write-Host ("    1) 启动 ClassIsland：" + $exeRoot) -ForegroundColor Gray
Write-Host '       首次启动会加载预置档案，主界面应显示课表。' -ForegroundColor Gray
Write-Host '    2) 在集控面板里给这台设备登记班级' -ForegroundColor Gray
Write-Host ("       面板地址：" + $cfg.ServerPanel) -ForegroundColor Gray
Write-Host ("       设备标识填：" + $cfg.ClientUid + "（CUID 在 ClassIsland 设置 -> 集控 里可见）") -ForegroundColor Gray
Write-Host '    3) 跑一次自检：双击「2-环境自检.cmd」' -ForegroundColor Gray
Write-Host ''
if (-not $KeepRunning) {
    Write-Host '  详细说明见 docs\00-部署指南.html（双击用浏览器打开）' -ForegroundColor DarkGray
}
