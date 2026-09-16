<#
=====================================================================
 星璃集控 · 教室端离线部署包 —— 出包脚本（在开发机 / 服务端上运行）
=====================================================================
 作用：从「本机已跑通的那份 ClassIsland 安装」+「仓库里的 payload 模板」
       组装出一个可 U 盘拷走的自包含离线包。

 为什么这样出包（而不是让用户自己拼）：
   · ClassIsland 是目录便携形态，直接复制目录就能用，不需要安装程序；
   · 种子数据必须**脱敏**（本机配置里真实存在明文 API Key、绝对路径）；
   · 种子数据里的绝对路径必须换成占位符，否则装到别的机器上会静默失效
     （实测 Settings.json 里写死了 D:\Classlsland\assets\musics\*.wav）。

 用法：
   powershell -ExecutionPolicy Bypass -File build-package.ps1
   powershell -ExecutionPolicy Bypass -File build-package.ps1 -SourceRoot D:\Classlsland -OutDir E:\ClassroomDeploy
   powershell -ExecutionPolicy Bypass -File build-package.ps1 -Zip        # 同时打 zip

 产出结构：
   <OutDir>\
     1-部署到本机.cmd  2-环境自检.cmd  3-升级或降级.cmd  4-回滚.cmd
     config\  scripts\  docs\  app\  seed\data\  PACKAGE-INFO.json
=====================================================================
#>
[CmdletBinding()]
param(
    [string]$SourceRoot = 'D:\Classlsland',
    [string]$OutDir = '',
    [switch]$Zip,
    [switch]$SkipApp
)

$ErrorActionPreference = 'Stop'
$repoPayload = Join-Path $PSScriptRoot 'payload'

$stamp = Get-Date -Format 'yyyyMMdd'
if (-not $OutDir) { $OutDir = "D:\Stelarith\_deploy\ClassroomDeploy-$stamp" }

Write-Host ''
Write-Host ('=' * 68) -ForegroundColor DarkCyan
Write-Host '  星璃集控 · 出离线部署包' -ForegroundColor Cyan
Write-Host ('=' * 68) -ForegroundColor DarkCyan
Write-Host ("  来源安装：" + $SourceRoot)
Write-Host ("  输出目录：" + $OutDir)

function Step([string]$t) { Write-Host ("  -> " + $t) -ForegroundColor White }
function Ok([string]$t)   { Write-Host ("  [OK]   " + $t) -ForegroundColor Green }
function Warn([string]$t) { Write-Host ("  [注意] " + $t) -ForegroundColor Yellow }

# ---------------------------------------------------------------- 前置检查
if (-not (Test-Path -LiteralPath $SourceRoot)) { throw ("来源安装不存在：" + $SourceRoot) }
$srcApp = Get-ChildItem -LiteralPath $SourceRoot -Directory -Filter 'app-*' |
          Sort-Object Name -Descending | Select-Object -First 1
if (-not $srcApp) { throw "来源目录下没有 app-* 目录，确认 -SourceRoot 是否正确。" }
Ok ("来源版本：" + $srcApp.Name -replace '^app-', '')

$srcData = Join-Path $SourceRoot 'data'
if (-not (Test-Path -LiteralPath $srcData)) { throw "来源目录下没有 data 目录。" }

$pluginRoot = Join-Path $srcData 'Plugins\StelarithControlPlugin'
if (-not (Test-Path -LiteralPath $pluginRoot)) { throw "来源目录下没有集控插件。" }
$manifestPath = Join-Path $pluginRoot 'manifest.yml'
$pluginVer = 'unknown'
if (Test-Path -LiteralPath $manifestPath) {
    $m = Select-String -LiteralPath $manifestPath -Pattern '^\s*version:\s*(.+)$' | Select-Object -First 1
    if ($m) { $pluginVer = $m.Matches[0].Groups[1].Value.Trim() }
}
Ok ("集控插件版本：" + $pluginVer)

# 载入 deploy 的配置（用于给种子里的 stelarith-sync.json 预填）
$deployCfg = Get-Content -LiteralPath (Join-Path $repoPayload 'config\deployment.json') -Raw -Encoding UTF8 | ConvertFrom-Json

# ---------------------------------------------------------------- 准备输出
if (Test-Path -LiteralPath $OutDir) {
    Warn ("输出目录已存在，将清空重建：" + $OutDir)
    Remove-Item -LiteralPath $OutDir -Recurse -Force
}
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

function Copy-TextFile([string]$Src, [string]$Dst, [bool]$WithBom) {
    $dir = Split-Path -Parent $Dst
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $txt = [System.IO.File]::ReadAllText($Src, [System.Text.Encoding]::UTF8)
    $enc = New-Object System.Text.UTF8Encoding($WithBom)
    [System.IO.File]::WriteAllText($Dst, $txt, $enc)
}

# ---------------------------------------------------------------- 1. payload
Step '装配脚本与文档（payload）'
$scriptCount = 0
Get-ChildItem -LiteralPath $repoPayload -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($repoPayload.Length).TrimStart('\')
    $dst = Join-Path $OutDir $rel
    $ext = $_.Extension.ToLower()
    if ($ext -eq '.ps1' -or $ext -eq '.md') {
        # PowerShell 5.1 只有在有 UTF-8 BOM 时才正确解析中文；
        # 记事本打开 .md 同理。仓库里保持无 BOM（git 友好），出包时补上。
        Copy-TextFile $_.FullName $dst $true
    } else {
        $dir = Split-Path -Parent $dst
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Copy-Item -LiteralPath $_.FullName -Destination $dst -Force
    }
    if ($ext -eq '.ps1') { $scriptCount = $scriptCount + 1 }
}
Ok ("脚本 " + $scriptCount + " 个，文档与配置已就位")

# ---------------------------------------------------------------- 2. app
if (-not $SkipApp) {
    Write-Host ''
    Step '复制 ClassIsland 本体（约 280 MB，稍等）'
    $dstApp = Join-Path $OutDir 'app'
    New-Item -ItemType Directory -Path $dstApp -Force | Out-Null

    # 顶层文件（排除 data / 快捷方式 / 备份）
    Get-ChildItem -LiteralPath $SourceRoot -File | Where-Object { $_.Extension -ne '.lnk' } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $dstApp -Force
    }
    Ok '顶层文件（ClassIsland.exe / PackageType / files.json）'

    # app-<版本> 目录
    $r = & robocopy $srcApp.FullName (Join-Path $dstApp $srcApp.Name) /E /NFL /NDL /NJH /NJS /R:1 /W:1
    if ($LASTEXITCODE -ge 8) { throw ("复制 app 目录失败，robocopy 返回码 " + $LASTEXITCODE) }
    Ok ("程序目录 " + $srcApp.Name)

    # assets（提醒音效；Settings.json 里按绝对路径引用，必须一起带）
    $srcAssets = Join-Path $SourceRoot 'assets'
    if (Test-Path -LiteralPath $srcAssets) {
        $r = & robocopy $srcAssets (Join-Path $dstApp 'assets') /E /NFL /NDL /NJH /NJS /R:1 /W:1
        if ($LASTEXITCODE -ge 8) { throw '复制 assets 失败' }
        $mb = [math]::Round(((Get-ChildItem (Join-Path $dstApp 'assets') -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
        Ok ("提醒音效 assets（" + $mb + " MB）")
    } else {
        Warn '来源没有 assets 目录，提醒音效可能失效'
    }
} else {
    Warn '按参数跳过本体复制（-SkipApp）'
}

# ---------------------------------------------------------------- 3. seed
Write-Host ''
Step '构造种子数据（脱敏 + 绝对路径占位化）'
$dstSeed = Join-Path $OutDir 'seed\data'
New-Item -ItemType Directory -Path $dstSeed -Force | Out-Null

# 3.1 Settings.json —— 三处必要修正
$srcSettings = Join-Path $srcData 'Settings.json'
Copy-TextFile $srcSettings (Join-Path $dstSeed 'Settings.json') $false
$sp = Join-Path $dstSeed 'Settings.json'
$raw = [System.IO.File]::ReadAllText($sp, [System.Text.Encoding]::UTF8)
$raw = [regex]::Replace($raw, '("AutoDisableCorruptPlugins"\s*:\s*)(true|false)', '${1}false')
$raw = [regex]::Replace($raw, '("CorruptPluginsDisabledLastSession"\s*:\s*)(true|false)', '${1}false')
$raw = [regex]::Replace($raw, '("IsWelcomeWindowShowed"\s*:\s*)(true|false)', '${1}true')
# 绝对路径 -> 占位符（部署时替换成真实安装目录）
# 注意：JSON 里 Windows 路径是**转义过的**（D:\Classlsland 在文件里写作 D:\\Classlsland）。
# 用 [regex]::Escape($SourceRoot) 去匹配会**静默失配**（模式里的 \\ 只匹配一个反斜杠）。
# 所以必须显式按「已转义形态」和「原样形态」各替换一次，且替换结果保持 JSON 合法。
$srcEsc = $SourceRoot.Replace('\', '\\')       # D:\\Classlsland  —— JSON 文件里的实际形态
$nPath = 0
if ($raw.Contains($srcEsc)) {
    $nPath = ([regex]::Matches($raw, [regex]::Escape($srcEsc))).Count
    $raw = $raw.Replace($srcEsc, '{{INSTALL_DIR}}')
}
if ($raw.Contains($SourceRoot)) {
    $nPath = $nPath + ([regex]::Matches($raw, [regex]::Escape($SourceRoot))).Count
    $raw = $raw.Replace($SourceRoot, '{{INSTALL_DIR}}')
}
[System.IO.File]::WriteAllText($sp, $raw, (New-Object System.Text.UTF8Encoding($false)))
Ok ("Settings.json（关闭插件自动禁用 / 跳过欢迎向导 / 替换 " + $nPath + " 处绝对路径）")

# 3.2 Profiles —— 只带主档案，不带 .bak / .pre-*
$srcProfiles = Join-Path $srcData 'Profiles'
$dstProfiles = Join-Path $dstSeed 'Profiles'
New-Item -ItemType Directory -Path $dstProfiles -Force | Out-Null
$profN = 0
Get-ChildItem -LiteralPath $srcProfiles -File -Filter '*.json' |
    Where-Object { $_.Name -notmatch '\.(bak|pre-[^.]+)' -and $_.Name -notmatch '\.bak-' } | ForEach-Object {
        Copy-TextFile $_.FullName (Join-Path $dstProfiles $_.Name) $false
        $profN = $profN + 1
    }
Ok ("课表档案 " + $profN + " 份（离线显示基线）")

# 3.3 Config —— 排除密钥与日志
$srcConfig = Join-Path $srcData 'Config'
$dstConfig = Join-Path $dstSeed 'Config'
$cfgSkipped = New-Object System.Collections.Generic.List[string]
Get-ChildItem -LiteralPath $srcConfig -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($srcConfig.Length).TrimStart('\')
    # 排除：日志、备份、以及含明文密钥的第三方插件设置
    if ($_.Extension -eq '.log') { return }
    if ($_.Name -match '\.bak') { return }
    if ($rel -ieq 'Plugins\ClassIsland.AISmartClass\aisettings.json') {
        $cfgSkipped.Add($rel + '  ← 含明文 apiKey') | Out-Null
        return
    }
    $dst = Join-Path $dstConfig $rel
    $dir = Split-Path -Parent $dst
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if ($_.Extension -eq '.json') {
        # 同样做路径占位化（实测 injector 插件设置里也有绝对路径）
        # 同样要处理 JSON 转义形态，见上文 Settings.json 处的说明。
        $t = [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8)
        $t = $t.Replace($srcEsc, '{{INSTALL_DIR}}')
        $t = $t.Replace($SourceRoot, '{{INSTALL_DIR}}')
        [System.IO.File]::WriteAllText($dst, $t, (New-Object System.Text.UTF8Encoding($false)))
    } else {
        Copy-Item -LiteralPath $_.FullName -Destination $dst -Force
    }
}
Ok 'Config（已排除日志 / 备份 / 含密钥项）'
foreach ($s in $cfgSkipped) { Warn ("排除：" + $s) }

# 3.4 Plugins —— 全部插件，排除 .bak-* 与插件内的私密配置
$srcPlugins = Join-Path $srcData 'Plugins'
$dstPlugins = Join-Path $dstSeed 'Plugins'
$plugN = 0
Get-ChildItem -LiteralPath $srcPlugins -Directory | Where-Object { $_.Name -notmatch '^\.?bak' -and $_.Name -notmatch '\.bak-' } | ForEach-Object {
    $r = & robocopy $_.FullName (Join-Path $dstPlugins $_.Name) /E /NFL /NDL /NJH /NJS /R:1 /W:1 /XF '*.log' /XD '.bak-*'
    if ($LASTEXITCODE -ge 8) { throw ("复制插件失败：" + $_.Name) }
    $plugN = $plugN + 1
}
Ok ("插件 " + $plugN + " 个（已排除 .bak-* 与 *.log）")

# 3.5 插件同步配置 —— 用部署包配置预填（部署时脚本还会重写一次）
$seedPluginDir = Join-Path $dstPlugins 'StelarithControlPlugin'
if (-not (Test-Path -LiteralPath $seedPluginDir)) {
    New-Item -ItemType Directory -Path $seedPluginDir -Force | Out-Null
}
$sync = [ordered]@{
    ClientAppBase           = [string]$deployCfg.ServerBase
    BaseDomain              = [string]$deployCfg.BaseDomain
    Slug                    = [string]$deployCfg.Slug
    ClientUid               = [string]$deployCfg.ClientUid
    ClassPlanName           = 'default_classplan'
    ComponentsName          = 'default_components'
    RefreshIntervalSeconds  = 30
    ResourceWriteBack       = $true
    MessageFeedBase         = ''
    NotificationSourceName  = [string]$deployCfg.NotificationSourceName
    VoiceHubBase            = [string]$deployCfg.VoiceHubBase
    VoiceHubKey             = ''
    SongboardResource       = 'songboard'
    SongboardRefreshSeconds = 15
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $seedPluginDir 'stelarith-sync.json'),
    ($sync | ConvertTo-Json -Depth 10), $utf8)
$panelUrl = if ($deployCfg.ServerPanel) { [string]$deployCfg.ServerPanel } else { '' }
[System.IO.File]::WriteAllText((Join-Path $seedPluginDir 'stelarith-panel.json'),
    ([ordered]@{ panelUrl = $panelUrl } | ConvertTo-Json), $utf8)
Ok 'stelarith-sync.json / stelarith-panel.json（已按部署配置预填）'

# ---------------------------------------------------------------- 4. 包信息
$appMB  = 0; $seedMB = 0
if (Test-Path -LiteralPath (Join-Path $OutDir 'app')) {
    $appMB = [math]::Round(((Get-ChildItem (Join-Path $OutDir 'app') -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
}
$seedMB = [math]::Round(((Get-ChildItem $dstSeed -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)

$info = [ordered]@{
    BuiltAt            = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    BuiltFrom          = $SourceRoot
    ClassIslandVersion = ($srcApp.Name -replace '^app-', '')
    PluginVersion      = $pluginVer
    PluginCount        = $plugN
    AppSizeMB          = $appMB
    SeedSizeMB         = $seedMB
    TotalSizeMB        = [math]::Round(($appMB + $seedMB), 1)
    Excluded           = @(
        'data\Logs / Cache / Temp / Backups（运行时产物）',
        'data\Plugins\*.bak-*（历史备份）',
        'data\Config\Plugins\**\*.log（日志）',
        'data\Config\Plugins\ClassIsland.AISmartClass\aisettings.json（含明文 API Key —— 安全红线）'
    )
    AbsolutePathPolicy = ('种子内所有 ' + $SourceRoot + ' 路径已替换为 {{INSTALL_DIR}}，由 deploy.ps1 在目标机替换为真实安装目录')
}
[System.IO.File]::WriteAllText((Join-Path $OutDir 'PACKAGE-INFO.json'),
    ($info | ConvertTo-Json -Depth 5), $utf8)

Write-Host ''
Write-Host ('=' * 68) -ForegroundColor DarkCyan
Write-Host '  出包完成' -ForegroundColor Green
Write-Host ('=' * 68) -ForegroundColor DarkCyan
Write-Host ("  路径      : " + $OutDir) -ForegroundColor White
Write-Host ("  本体      : " + $appMB + " MB") -ForegroundColor Gray
Write-Host ("  种子数据  : " + $seedMB + " MB（含 " + $plugN + " 个插件）") -ForegroundColor Gray
Write-Host ("  合计      : " + ($appMB + $seedMB) + " MB") -ForegroundColor Gray
Write-Host ("  ClassIsland: " + ($srcApp.Name -replace '^app-', '') + "   插件: " + $pluginVer) -ForegroundColor Gray
Write-Host ''
Write-Host '  ⚠ 分发前请自查（安全红线）：' -ForegroundColor Yellow
Write-Host '    · seed 里不应出现任何 sk- 开头的密钥（本脚本已自动排除已知项）' -ForegroundColor Gray
Write-Host '    · 不要把 stelarith-sync.json 的 VoiceHubKey 预先填成真 key' -ForegroundColor Gray
Write-Host ''

# ---------------------------------------------------------------- 5. 打包 zip
if ($Zip) {
    Write-Host '  正在压缩...' -ForegroundColor White
    $zipPath = $OutDir.TrimEnd('\') + '.zip'
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    Compress-Archive -Path (Join-Path $OutDir '*') -DestinationPath $zipPath -CompressionLevel Optimal
    $zipMB = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 1)
    Write-Host ("  [OK]   zip 已生成：" + $zipPath + "（" + $zipMB + " MB）") -ForegroundColor Green
    Write-Host ''
}
