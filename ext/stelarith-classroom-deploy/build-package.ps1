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
     config\  scripts\  docs\  app\  seed\data\  agent\  PACKAGE-INFO.json

   agent\stelarith-agent.exe —— 本地代理。没有它，面板上的「远程屏幕控制」
   与「系统级重启」在教室里点不动（其余功能不受影响）。
=====================================================================
#>
[CmdletBinding()]
param(
    [string]$SourceRoot = 'D:\Classlsland',
    [string]$OutDir = '',
    # 本地代理二进制。默认从仓库里已编译的 release 产物取；
    # 取不到时不静默放过 —— 见下方「1.5 本地代理」的处理。
    [string]$AgentExe = '',
    [switch]$Zip,
    [switch]$SkipApp,
    # 本地代理的 HMAC 共享密钥（远程控制/重启校验用）。
    # 刻意**不写进源码**：那是共享密钥，进版本库就失去意义（谁拿到包谁知道）。
    # 出包时用 -AgentSecret <值> 注入；不传则保持源码里的空值 ——
    # 代理会明确拒绝远程控制类指令（面板显示拒绝原因，不会静默失败）。
    [string]$AgentSecret = '',
    # 允许带入教室端包的插件白名单。默认**只有集控插件**。
    #
    # 这里曾经原样复制制作机上的全部插件目录，而制作机是开发机，装着壁纸
    # 注入、AI 课堂、地震预警、动画等个人插件。后果（2026-09-18 首次实测暴露）：
    #   1) AI 插件的密钥配置被安全规则排除，插件本体却还在 → 教室机启动即刷报错；
    #   2) 注入器类插件在教室机环境会往 UI 线程抛异常，而宿主又不能开
    #      AutoDisableCorruptPlugins（否则会连带禁用集控插件）
    #      → 表现为「进程活着、主窗口不显示」。
    # 插件携带策略（2026-09-21 用户纠正：装哪些插件是用户的事，不该由脚本拍板）。
    #   · 两个都不传  → **全部带上**（默认，只排除 .bak-* 备份）
    #   · -PluginAllowList  → 只带这几个（集控插件仍强制带上）
    #   · -ExcludePlugins   → 除了这几个都带
    [string[]]$PluginAllowList = @(),
    [string[]]$ExcludePlugins = @()
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

function Copy-TextFile([string]$Src, [string]$Dst, [bool]$WithBom, [bool]$Crlf = $true, [bool]$AsciiOnly = $false) {
    $dir = Split-Path -Parent $Dst
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $txt = [System.IO.File]::ReadAllText($Src, [System.Text.Encoding]::UTF8)

    # 行尾统一成 CRLF：仓库里存 LF（git 友好），但 .cmd / .ps1 在 Windows 上必须是 CRLF。
    # 不依赖 .gitattributes —— 出包脚本读的是**工作区**文件，checkout 行为不可控。
    if ($Crlf) {
        $txt = $txt.Replace("`r`n", "`n").Replace("`r", "`n").Replace("`n", "`r`n")
    }

    # .cmd 必须纯 ASCII：cmd 解析批处理用的是**当前代码页**，UTF-8 中文在 GBK 控制台上
    # 会被按字节拆开，轻则乱码、重则把命令行的引号/括号配对搞坏。宁可出包时炸。
    if ($AsciiOnly) {
        for ($i = 0; $i -lt $txt.Length; $i++) {
            if ([int]$txt[$i] -gt 127) {
                throw ("$Src 含非 ASCII 字符（位置 $i）：'.cmd' 必须纯 ASCII。请改成英文。")
            }
        }
    }

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
        Copy-TextFile $_.FullName $dst $true $true $false
    } elseif ($ext -eq '.cmd') {
        Copy-TextFile $_.FullName $dst $false $true $true
    } else {
        Copy-TextFile $_.FullName $dst $false $false $false
    }
    if ($ext -eq '.ps1') { $scriptCount = $scriptCount + 1 }
}
Ok ("脚本 " + $scriptCount + " 个，文档与配置已就位（行尾/编码已规范化）")

# ---------------------------------------------------------------- 1.5 本地代理
Write-Host ''
Step '纳入本地代理（StelarithAgent）'
if (-not $AgentExe) {
    # 默认取仓库里已编译好的 release 产物（与出包脚本同属 ext/ 下）
    $AgentExe = Join-Path (Split-Path -Parent $PSScriptRoot) 'stelarith-agent\target\release\stelarith-agent.exe'
}
$agentIncluded = $false
$agentSha = ''
$agentSizeKB = 0
if (-not (Test-Path -LiteralPath $AgentExe)) {
    Warn ('未找到本地代理二进制：' + $AgentExe)
    Warn '  缺它的后果：面板上的「远程屏幕控制」与「系统级重启」在教室里不可用。'
    Warn '  其余功能（锁屏/截图/课表/广播/切班）不受影响 —— 那些不走代理。'
    Warn '  补上它： cd ext\stelarith-agent ; cargo build --release'
} else {
    $dstAgent = Join-Path $OutDir 'agent\stelarith-agent.exe'
    New-Item -ItemType Directory -Path (Split-Path -Parent $dstAgent) -Force | Out-Null
    Copy-Item -LiteralPath $AgentExe -Destination $dstAgent -Force
    $agentSizeKB = [math]::Round((Get-Item -LiteralPath $dstAgent).Length / 1KB, 0)
    $agentSha = (Get-FileHash -LiteralPath $dstAgent -Algorithm SHA256).Hash
    $agentIncluded = $true
    Ok ('代理已入包：' + $agentSizeKB + ' KB，SHA256 ' + $agentSha.Substring(0, 12) + '...')
}

# 1.5.1 T11 防拆 L2：守护进程 stelarith-guard.exe（与代理同级入包）。
# 没有它只是少一层 15s 快速兜底（L3 看门狗仍在）——所以缺它时警告、不阻断。
$guardIncluded = $false
$guardSizeKB = 0
$guardSrc = Join-Path (Split-Path -Parent $PSScriptRoot) 'stelarith-guard\target\release\stelarith-guard.exe'
if (Test-Path -LiteralPath $guardSrc) {
    $dstGuard = Join-Path $OutDir 'agent\stelarith-guard.exe'
    Copy-Item -LiteralPath $guardSrc -Destination $dstGuard -Force
    $guardSizeKB = [math]::Round((Get-Item -LiteralPath $dstGuard).Length / 1KB, 0)
    $guardIncluded = $true
    Ok ('守护进程已入包：' + $guardSizeKB + ' KB（stelarith-guard.exe，防拆 L2）')
} else {
    Warn ('未找到守护进程二进制：' + $guardSrc)
    Warn '  缺它的后果：教室端少一层 15s 常驻兜底（学生杀 agent 后要等 5 分钟看门狗才拉回）。'
    Warn '  补上它： cd ext\stelarith-guard ; cargo build --release'
}

# ---------------------------------------------------------------- 2. app
if (-not $SkipApp) {
    Write-Host ''
    Step '复制 ClassIsland 本体（约 280 MB，稍等）'
    $dstApp = Join-Path $OutDir 'app'
    New-Item -ItemType Directory -Path $dstApp -Force | Out-Null

    # 顶层文件（排除 data / 快捷方式 / 备份 / 日志）
    Get-ChildItem -LiteralPath $SourceRoot -File |
        Where-Object { $_.Extension -ne '.lnk' -and $_.Extension -ne '.log' } | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $dstApp -Force
        }
    Ok '顶层文件（ClassIsland.exe / PackageType / files.json）'

    # app-<版本> 目录
    # 排除 *.log：应用目录里躺着宿主/插件的运行时诊断日志（ste-*-diag.log 等）。
    # 打进包的后果：新装教室机跑 preflight 时会读到「出包机」的日志，
    # 误报「集控插件日志 N 分钟前」，看上去像插件刚跑过、其实一次都没跑 —— 极易误导排障。
    $r = & robocopy $srcApp.FullName (Join-Path $dstApp $srcApp.Name) /E /NFL /NDL /NJH /NJS /R:1 /W:1 /XF '*.log'
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

# 3.3 Config —— 排除日志/备份；含明文密钥的设置**保留文件但置空密钥**
#
# 为什么不再整份跳过：2026-09-18 那次跳过 aisettings.json 的后果是「插件本体在、配置没了」
# → 教室机启动即刷报错。2026-09-21 用户又明确指出「装哪些插件不该由脚本替他决定」。
# 现在的做法是两头都占：**文件照常带上**（插件行为正常），**密钥置空**（红线不破），
# 并允许部署后在教室机上自行填写自己的 Key。
$srcConfig = Join-Path $srcData 'Config'
$dstConfig = Join-Path $dstSeed 'Config'
$cfgSkipped = New-Object System.Collections.Generic.List[string]
$cfgRedacted = New-Object System.Collections.Generic.List[string]
Get-ChildItem -LiteralPath $srcConfig -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($srcConfig.Length).TrimStart('\')
    # 排除：日志、备份
    if ($_.Extension -eq '.log') { return }
    if ($_.Name -match '\.bak') { return }
    # 已知含明文密钥的第三方插件设置：保留文件、置空密钥
    $isSecretCfg = ($rel -ieq 'Plugins\ClassIsland.AISmartClass\aisettings.json')
    $dst = Join-Path $dstConfig $rel
    $dir = Split-Path -Parent $dst
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if ($_.Extension -eq '.json') {
        # 同样做路径占位化（实测 injector 插件设置里也有绝对路径）
        # 同样要处理 JSON 转义形态，见上文 Settings.json 处的说明。
        $t = [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8)
        $t = $t.Replace($srcEsc, '{{INSTALL_DIR}}')
        $t = $t.Replace($SourceRoot, '{{INSTALL_DIR}}')
        if ($isSecretCfg) {
            $before = $t
            # 先按字段清空，再兜底清掉任何漏网的 sk- 值（自检 5.1 会再扫一遍）
            $t = [regex]::Replace($t, '("apiKey"\s*:\s*")[^"]*(")', '${1}${2}')
            $t = [regex]::Replace($t, 'sk-[A-Za-z0-9]{16,}', '')
            if ($t -ne $before) { $cfgRedacted.Add($rel + '  ← 明文 apiKey 已置空（文件保留，插件照常可用）') | Out-Null }
        }
        [System.IO.File]::WriteAllText($dst, $t, (New-Object System.Text.UTF8Encoding($false)))
    } else {
        Copy-Item -LiteralPath $_.FullName -Destination $dst -Force
    }
}
Ok 'Config（已排除日志 / 备份；含密钥项已置空而非整份丢弃）'
foreach ($s in $cfgSkipped) { Warn ("排除：" + $s) }
foreach ($s in $cfgRedacted) { Ok ("脱敏：" + $s) }

# 3.4 Plugins —— 默认**全部带上**（2026-09-21 用户明确纠正）
#
# 历史：这里曾经默认「只带集控插件、其余全部剔除」，理由是制作机是开发机，
# 装着壁纸注入、AI 课堂、地震预警、动画等个人插件，拿到教室机上会刷报错甚至
# 让 ClassIsland 主窗口不显示。但——**这是产品决策，不该由出包脚本替用户拍板**，
# 用户安装/部署哪些插件由用户决定。所以改成：
#   · 默认：全部带上（只排除 .bak-* 备份目录）；
#   · 要"只带某几个"：显式传 -PluginAllowList（此时集控插件仍强制带上）；
#   · 要"除了某几个都带"：传 -ExcludePlugins。
$srcPlugins = Join-Path $srcData 'Plugins'
$dstPlugins = Join-Path $dstSeed 'Plugins'

$allPlugins = @(Get-ChildItem -LiteralPath $srcPlugins -Directory |
    Where-Object { $_.Name -notmatch '^\.?bak' -and $_.Name -notmatch '\.bak-' })

$explicitAllow = @($PluginAllowList | Where-Object { $_ })
if ($explicitAllow.Count -gt 0) {
    # 显式白名单模式（集控插件没它包就没意义，永远带上）
    $allow = @($explicitAllow + 'StelarithControlPlugin' | Select-Object -Unique)
} else {
    # 默认模式：全带，减去 -ExcludePlugins
    $allow = @($allPlugins | Where-Object { $ExcludePlugins -notcontains $_.Name } | ForEach-Object { $_.Name })
    if ($allow -notcontains 'StelarithControlPlugin') { throw '集控插件被排除了 —— 这样的包没有意义，请检查 -ExcludePlugins。' }
}
$keepPlugins = @($allPlugins | Where-Object { $allow -contains $_.Name })
$skipPlugins = @($allPlugins | Where-Object { $allow -notcontains $_.Name })

$plugN = 0
foreach ($p in $keepPlugins) {
    $r = & robocopy $p.FullName (Join-Path $dstPlugins $p.Name) /E /NFL /NDL /NJH /NJS /R:1 /W:1 /XF '*.log' /XD '.bak-*'
    if ($LASTEXITCODE -ge 8) { throw ("复制插件失败：" + $p.Name) }
    $plugN = $plugN + 1
}
Ok ("插件 " + $plugN + " 个（全带；" + ($keepPlugins.Name -join ', ') + "）")

# 3.4a 插件目录内的**文本文件**同样要做绝对路径占位化。
# 为什么必须单列这一步：插件目录是用 robocopy **原样**搬过去的（见 3.4），
# 而插件自带的 README.md 里写着制作机上的示例路径（如 D:\Classlsland\data\...）。
# 不处理有两个后果：① 包拷到别的机器后，文档里全是"不存在的目录"，照着做会踩空；
# ② 出包自检（5.1）会以「源机绝对路径残留」直接拦下整包 —— 2026-09-21 实测踩到。
# 只动文本类扩展名，二进制（dll / pdb / png）一律不碰。
$scrubExts = @('.md', '.json', '.yml', '.yaml', '.txt', '.ps1', '.cmd', '.jsonc')
$scrubN = 0
$scrubHit = 0
if (Test-Path -LiteralPath $dstPlugins) {
    Get-ChildItem -LiteralPath $dstPlugins -Recurse -File |
        Where-Object { $scrubExts -contains $_.Extension.ToLower() } | ForEach-Object {
            $scrubN = $scrubN + 1
            $t = [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8)
            if ($t.Contains($srcEsc) -or $t.Contains($SourceRoot)) {
                # 先替换 JSON 里的转义形态，再替换原样形态，避免二次替换互相吃掉
                $t = $t.Replace($srcEsc, '{{INSTALL_DIR}}').Replace($SourceRoot, '{{INSTALL_DIR}}')
                [System.IO.File]::WriteAllText($_.FullName, $t, (New-Object System.Text.UTF8Encoding($false)))
                $scrubHit = $scrubHit + 1
            }
        }
}
Ok ("插件文本文件 " + $scrubN + " 个：占位化改写 " + $scrubHit + " 个")

# 3.4b 清掉未入选插件的**配置目录** —— 插件本体不带了，配置留着是无源之水，
#      且 PluginsIndex 里若仍登记，宿主启动时会去找一个不存在的插件目录。
$seedCfgPlugins = Join-Path $dstSeed 'Config\Plugins'
$cfgRemoved = 0
if (Test-Path -LiteralPath $seedCfgPlugins) {
    Get-ChildItem -LiteralPath $seedCfgPlugins -Directory -ErrorAction SilentlyContinue |
        Where-Object { $allow -notcontains $_.Name } | ForEach-Object {
        [System.IO.Directory]::Delete($_.FullName, $true)
        $cfgRemoved = $cfgRemoved + 1
    }
}
if ($skipPlugins.Count -gt 0) {
    Warn ("按你的 -PluginAllowList / -ExcludePlugins 排除插件 " + $skipPlugins.Count + " 个：" + ($skipPlugins.Name -join ', '))
}
if ($cfgRemoved -gt 0) { Ok ("已移除 " + $cfgRemoved + " 个未入选插件的配置目录") }

# 3.5 插件同步配置 —— 用部署包配置预填（部署时脚本还会重写一次）
#
# ⚠️ 这里必须写**两个**位置，而且**不能**把制作机的配置原样带出去：
#   · 插件读配置走 StelarithSyncOptions.ResolveConfigDir()：
#       优先 PluginConfigFolder（= data\Config\Plugins\StelarithControlPlugin），
#       取不到才回落程序集目录（= data\Plugins\StelarithControlPlugin）。
#   · 3.3 会把制作机的 data\Config 整个搬进种子，其中就含**制作机自己的**
#       stelarith-sync.json（ClientUid=lab-pc-001、demo 租户、内网指向 127.0.0.1）。
#   · 若只写 install dir，那份制作机配置会**静默胜出** → 每间教室都顶着同一个 uid 注册。
#     （2026-09-21 实测发现，见 PACKAGE-INFO 的 SeedSyncWrittenTo。）
#   · ClientUid 一律**留空**：插件在留空时用机器名兜底，天然逐机唯一。
$seedPluginDir = Join-Path $dstPlugins 'StelarithControlPlugin'
$seedCfgPluginDir = Join-Path $dstSeed 'Config\Plugins\StelarithControlPlugin'
foreach ($d in @($seedPluginDir, $seedCfgPluginDir)) {
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# 双通道（内网直连 / 公网域名）—— 插件设置页有「切到内网直连 / 切到公网域名」两个按钮，
# 切换时会把对应那组地址成对写入。两组都必须非空，否则切一次就把 ClientAppBase 刷成空串
# （插件的 lan 分支**不做校验**，空串会让整套同步静默失败）。
$netMode = if ($deployCfg.NetworkMode) { ([string]$deployCfg.NetworkMode).Trim().ToLowerInvariant() } else { 'wan' }
if ($netMode -ne 'lan' -and $netMode -ne 'wan') { $netMode = 'wan' }
$wanBase = if ($deployCfg.WanClientAppBase) { [string]$deployCfg.WanClientAppBase } else { [string]$deployCfg.ServerBase }
$wanDom  = if ($deployCfg.WanBaseDomain)    { [string]$deployCfg.WanBaseDomain }    else { [string]$deployCfg.BaseDomain }
$lanBase = if ($deployCfg.LanClientAppBase) { [string]$deployCfg.LanClientAppBase } else { 'http://10.0.0.10:8096' }
$lanDom  = if ($deployCfg.LanBaseDomain)    { [string]$deployCfg.LanBaseDomain }    else { 'localhost' }
if (-not $deployCfg.LanClientAppBase -or -not $deployCfg.LanBaseDomain) {
    Warn ('内网备用地址未在 config\deployment.json 里显式配置，暂用 ' + $lanBase + '（内网基域 ' + $lanDom + '）；若学校走内网，请填真实的内网服务地址与内网基域。')
}

$sync = [ordered]@{
    ClientAppBase           = [string]$deployCfg.ServerBase
    BaseDomain              = [string]$deployCfg.BaseDomain
    Slug                    = [string]$deployCfg.Slug
    ClientUid               = ''
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
    NetworkMode             = $netMode
    WanClientAppBase        = $wanBase
    WanBaseDomain           = $wanDom
    LanClientAppBase        = $lanBase
    LanBaseDomain           = $lanDom
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
$panelUrl = if ($deployCfg.ServerPanel) { [string]$deployCfg.ServerPanel } else { '' }
foreach ($d in @($seedPluginDir, $seedCfgPluginDir)) {
    [System.IO.File]::WriteAllText((Join-Path $d 'stelarith-sync.json'),
        ($sync | ConvertTo-Json -Depth 10), $utf8)
    [System.IO.File]::WriteAllText((Join-Path $d 'stelarith-panel.json'),
        ([ordered]@{ panelUrl = $panelUrl } | ConvertTo-Json), $utf8)
}
Ok ('stelarith-sync.json / stelarith-panel.json（两处均写：data\Plugins + data\Config\Plugins；模式 ' + $netMode + '）')

# ---------------------------------------------------------------- 4. 包信息
$appMB  = 0; $seedMB = 0
if (Test-Path -LiteralPath (Join-Path $OutDir 'app')) {
    $appMB = [math]::Round(((Get-ChildItem (Join-Path $OutDir 'app') -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
}
$seedMB = [math]::Round(((Get-ChildItem $dstSeed -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)

$info = [ordered]@{
    BuiltAt            = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    BuiltFrom          = '制作机上的 ClassIsland 便携安装（源绝对路径已脱敏，不落包）'
    ClassIslandVersion = ($srcApp.Name -replace '^app-', '')
    PluginVersion      = $pluginVer
    PluginCount        = $plugN
    Plugins            = @($keepPlugins.Name)
    PluginPolicy       = '默认全部带上；如需裁剪用 -PluginAllowList（只带这些）或 -ExcludePlugins（除这些都带）'
    RedactedFiles      = @($cfgRedacted)
    NetworkMode        = $netMode
    SeedSyncWrittenTo  = 'data\Plugins\StelarithControlPlugin + data\Config\Plugins\StelarithControlPlugin（两处内容一致；插件优先读后者）'
    ClientUidPolicy    = '包内 ClientUid 一律留空 → 插件按计算机名兜底，逐机唯一（绝不能让某一台机器的 uid 出厂）'
    AgentIncluded      = $agentIncluded
    AgentSHA256        = $agentSha
    AgentSizeKB        = $agentSizeKB
    AppSizeMB          = $appMB
    SeedSizeMB         = $seedMB
    TotalSizeMB        = [math]::Round(($appMB + $seedMB), 1)
    Excluded           = @(
        'app\**\*.log（出包机运行时诊断日志 ste-*-diag.log —— 否则新机 preflight 会误报「插件日志 N 分钟前」）',
        'data\Logs / Cache / Temp / Backups（运行时产物）',
        'data\Plugins\*.bak-*（历史备份）',
        'data\Config\Plugins\**\*.log（日志）',
        'data\Config\Plugins\ClassIsland.AISmartClass\aisettings.json 的 apiKey 值（文件保留，密钥置空 —— 安全红线）'
    )
    AbsolutePathPolicy = '种子内所有制作机绝对路径已替换为 {{INSTALL_DIR}}，由 deploy.ps1 在目标机替换为真实安装目录'
}

# Agent.Secret 注入（可选，见 param 说明）：只在出包产物里落值，源码保持空。
# 否则下次出包会把上一次手工填好的密钥洗回空 —— 现场表现为「远程控制昨天还好好的」。
if ($AgentSecret) {
    $cfgPath = Join-Path $OutDir 'config\deployment.json'
    if (Test-Path -LiteralPath $cfgPath) {
        $cfgJ = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $cfgJ.Agent.Secret = $AgentSecret
        [System.IO.File]::WriteAllText(
            $cfgPath,
            ($cfgJ | ConvertTo-Json -Depth 6),
            (New-Object System.Text.UTF8Encoding($false)))
        Ok ("已注入 Agent.Secret（长度 " + $AgentSecret.Length + "）—— 面板「设置 → 指令密钥」须填同一个值")
    } else {
        Warn '未找到 config\deployment.json，跳过 Agent.Secret 注入'
    }
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

Write-Host ''
Write-Host ('=' * 68) -ForegroundColor DarkCyan
Write-Host '  出包后自检（自动）' -ForegroundColor Cyan
Write-Host ('=' * 68) -ForegroundColor DarkCyan

$fail = New-Object System.Collections.Generic.List[string]
$srcEsc2 = $SourceRoot.Replace('\', '\\')

# 5.1 文本类：密钥 + 源机绝对路径残留
$txtExts = @('.ps1', '.cmd', '.json', '.md', '.html', '.yml', '.txt')
$scanned = 0
Get-ChildItem -LiteralPath $OutDir -Recurse -File | Where-Object { $txtExts -contains $_.Extension.ToLower() } | ForEach-Object {
    $scanned++
    $t = [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8)
    if ($t -match 'sk-[A-Za-z0-9]{16,}') {
        $fail.Add('密钥泄露: ' + $_.FullName)
    }
    # T06 安全红线：代理指令密钥不得以明文落包。
    # 模板写法是 `'set "STELARITH_AGENT_SECRET=' + ...`（等号后是引号），
    # 真实明文值是 `STELARITH_AGENT_SECRET=abc...`（等号后是值字符）——用这个区分。
    if ($t -match 'STELARITH_(AGENT_SECRET|SITE_PUBKEY)=[^"'']') {
        $fail.Add('代理密钥明文落包: ' + $_.FullName)
    }
    if ($t.Contains($SourceRoot) -or $t.Contains($srcEsc2)) {
        $fail.Add('源机绝对路径残留: ' + $_.FullName)
    }
}
Write-Host ("  · 文本文件 " + $scanned + " 个：密钥/绝对路径已扫描") -ForegroundColor Gray

# 5.2 .ps1 必须带 UTF-8 BOM
$nPs = 0
Get-ChildItem -LiteralPath (Join-Path $OutDir 'scripts') -File -Filter '*.ps1' | ForEach-Object {
    $nPs++
    $b = [System.IO.File]::ReadAllBytes($_.FullName)
    if ($b.Length -lt 3 -or $b[0] -ne 0xEF -or $b[1] -ne 0xBB -or $b[2] -ne 0xBF) {
        $fail.Add('缺 UTF-8 BOM: ' + $_.Name)
    }
}
Write-Host ("  · .ps1 " + $nPs + " 个：BOM 已校验") -ForegroundColor Gray

# 5.3 .cmd 必须纯 ASCII + CRLF
$nCmd = 0
Get-ChildItem -LiteralPath $OutDir -File -Filter '*.cmd' | ForEach-Object {
    $nCmd++
    $b = [System.IO.File]::ReadAllBytes($_.FullName)
    foreach ($by in $b) { if ($by -gt 127) { $fail.Add('非 ASCII 字符: ' + $_.Name); break } }
    if ($b -notcontains 13) { $fail.Add('非 CRLF 行尾: ' + $_.Name) }
}
Write-Host ("  · .cmd " + $nCmd + " 个：ASCII/CRLF 已校验") -ForegroundColor Gray

# 5.4 所有 JSON 必须能解析（宁可出包时炸，不要到教室机上才发现）
$nJson = 0
Get-ChildItem -LiteralPath $OutDir -Recurse -File -Filter '*.json' | ForEach-Object {
    $nJson++
    try { $null = [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8) | ConvertFrom-Json }
    catch { $fail.Add('JSON 非法: ' + $_.FullName) }
}
Write-Host ("  · JSON " + $nJson + " 个：语法已校验") -ForegroundColor Gray

# 5.5 本地代理：必须是真正的 PE 可执行文件
# 为什么单独查：它是**外部工具链产物**，既不进 git，也不在文本/JSON 校验的覆盖范围内。
# 源路径写错或产物被截断时，包会「看起来很完整」，但教室里代理根本起不来，
# 而现象又会退化成「面板点了没反应」——正好是这次要消灭的那类问题。
$agentPath = Join-Path $OutDir 'agent\stelarith-agent.exe'
if (Test-Path -LiteralPath $agentPath) {
    $ab = [System.IO.File]::ReadAllBytes($agentPath)
    if ($ab.Length -lt 10240) {
        $fail.Add('本地代理体积异常（' + $ab.Length + ' 字节），疑似截断')
    } elseif ($ab[0] -ne 0x4D -or $ab[1] -ne 0x5A) {
        $fail.Add('本地代理不是有效 PE 可执行文件（缺 MZ 头）')
    } else {
        Write-Host ('  · 本地代理：PE 头/体积已校验（' + [math]::Round($ab.Length / 1KB, 0) + ' KB）') -ForegroundColor Gray
    }
} else {
    Write-Host '  · 本地代理：未入包 —— 面板上的「远程屏幕控制 / 系统级重启」将不可用' -ForegroundColor Yellow
}

# 5.5.1 T11 防拆 L2：守护进程 stelarith-guard.exe（PE 校验，防截断/防缺包）
$guardPath = Join-Path $OutDir 'agent\stelarith-guard.exe'
if (Test-Path -LiteralPath $guardPath) {
    $gb = [System.IO.File]::ReadAllBytes($guardPath)
    if ($gb.Length -lt 10240) {
        $fail.Add('守护进程体积异常（' + $gb.Length + ' 字节），疑似截断')
    } elseif ($gb[0] -ne 0x4D -or $gb[1] -ne 0x5A) {
        $fail.Add('守护进程不是有效 PE 可执行文件（缺 MZ 头）')
    } else {
        Write-Host ('  · 守护进程：PE 头/体积已校验（' + [math]::Round($gb.Length / 1KB, 0) + ' KB，防拆 L2）') -ForegroundColor Gray
    }
} else {
    Write-Host '  · 守护进程：未入包 —— 教室端少一层 15s 常驻兜底（仅 L3 看门狗 5 分钟在）' -ForegroundColor Yellow
}

# 5.5.2 T11 防拆 L2 防回归：部署脚本必须含 guard 安装/注册逻辑（关键词扫描）
# 与 T08 的 5.8 防拆 L3 防回归同理：改了脚本忘了同步注册逻辑，出包自检直接拦下。
$guardKeywords = @('Register-StelarithGuard', 'AGENT_GUARD_TASK', 'stelarith-guard.exe', 'Get-AgentGuardExePath', 'Remove-StelarithGuard')
$libCommon = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'payload\scripts\lib-common.ps1'))
foreach ($kw in $guardKeywords) {
    if (-not $libCommon.Contains($kw)) {
        $fail.Add('防拆 L2 防回归：lib-common.ps1 缺关键词 "' + $kw + '"（guard 安装逻辑不完整）')
    }
}
Write-Host ('  · 防拆 L2（guard）关键词：' + $guardKeywords.Count + '/' + $guardKeywords.Count + ' 已校验') -ForegroundColor Gray

# 5.6 全包不得残留任何 *.log
# 出包机的运行时诊断日志（ste-*-diag.log 在应用目录、插件日志在 data 下）一旦入包，
# 新装教室机的 preflight 会读到出包机的日志并误报「插件日志 N 分钟前」，
# 排障时会被带偏：以为插件跑过，其实根本没跑。
$allLogs = @(Get-ChildItem -LiteralPath $OutDir -Recurse -File -Filter '*.log' -ErrorAction SilentlyContinue)
if ($allLogs.Count -gt 0) {
    foreach ($l in $allLogs) {
        $fail.Add('包内残留日志文件: ' + $l.FullName.Substring($OutDir.Length).TrimStart('\'))
    }
}
Write-Host ("  · 全包日志文件：" + $allLogs.Count + " 个（必须为 0）") -ForegroundColor Gray

# 5.7 插件同步配置：身份与网络模式
# 为什么单列：这两项错了**都不会报错**，只会"看起来很正常的跑着"。
#   · ClientUid 带了某一台机器的值 → 全校教室注册成同一台设备（设备管理全乱、指令发错班）；
#   · 内网/公网那两组地址有一组空 → 面板上点一次"切换网络"就把 ClientAppBase 刷成空串，
#     整套同步静默失效（插件的 lan 分支不做校验）。
$syncJsons = @(Get-ChildItem -LiteralPath $OutDir -Recurse -File -Filter 'stelarith-sync.json' -ErrorAction SilentlyContinue)
if ($syncJsons.Count -eq 0) {
    $fail.Add('包内没有任何 stelarith-sync.json —— 插件将用代码内置默认值（多半指向 demo 环境）')
} else {
    foreach ($sj in $syncJsons) {
        $rel = $sj.FullName.Substring($OutDir.Length).TrimStart('\')
        try { $j = [System.IO.File]::ReadAllText($sj.FullName, [System.Text.Encoding]::UTF8) | ConvertFrom-Json }
        catch { $fail.Add('stelarith-sync.json 非法 JSON: ' + $rel); continue }
        if (-not [string]::IsNullOrWhiteSpace([string]$j.ClientUid)) {
            $fail.Add('ClientUid 非空（全校会共用同一设备身份）: ' + $rel + ' -> ' + $j.ClientUid)
        }
        foreach ($k in @('ClientAppBase', 'BaseDomain', 'Slug', 'WanClientAppBase', 'WanBaseDomain', 'LanClientAppBase', 'LanBaseDomain')) {
            $v = [string]$j.$k
            if ([string]::IsNullOrWhiteSpace($v)) { $fail.Add('stelarith-sync.json 缺非空字段 ' + $k + ': ' + $rel) }
        }
        if ([string]$j.Slug -ne [string]$deployCfg.Slug) {
            $fail.Add('stelarith-sync.json 的 Slug(' + $j.Slug + ') 与 deployment.json(' + $deployCfg.Slug + ') 不一致: ' + $rel)
        }
    }
    if ($syncJsons.Count -lt 2) {
        $fail.Add('只写了 ' + $syncJsons.Count + ' 处 stelarith-sync.json —— 插件优先读 data\Config\Plugins\..., 只写 install dir 会被制作机配置屏蔽')
    } else {
        $h = $syncJsons | ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } | Select-Object -Unique
        if ($h.Count -ne 1) { $fail.Add('两处 stelarith-sync.json 内容不一致（哪份生效取决于插件配置目录）') }
    }
}
Write-Host ("  · 插件同步配置：" + $syncJsons.Count + " 处，身份/双通道地址已校验") -ForegroundColor Gray

# 5.8 防拆 L3（T08）：payload 必须包含看门狗任务的三件套 —— 常量、注册函数、生成脚本路径。
# 为什么单列：防拆是「少了不报错、只会在被拆时躺平」的静默能力。某次重构若把
# Register-AgentWatchdog 删了，出包自检必须在出包那一刻拦住，不能等教室机被拆了才发现。
$libPath = Join-Path $OutDir 'scripts\lib-common.ps1'
if (Test-Path -LiteralPath $libPath) {
    $libTxt = [System.IO.File]::ReadAllText($libPath, [System.Text.Encoding]::UTF8)
    $tamperParts = @(
        @('看门狗任务名常量',  'AGENT_WATCHDOG_TASK'),
        @('看门狗注册函数',    'function Register-AgentWatchdog'),
        @('看门狗移除函数',    'function Remove-AgentWatchdog'),
        @('自启任务加固参数',  '-RestartCount 3 -RestartInterval'),
        @('自启任务防叠实例',  '-MultipleInstances IgnoreNew'),
        @('自启任务补启动',    '-StartWhenAvailable')
    )
    foreach ($tp in $tamperParts) {
        if ($libTxt -notmatch [regex]::Escape($tp[1])) {
            $fail.Add('防拆 L3 组件缺失（' + $tp[0] + '）: ' + $tp[1] + ' 不在 lib-common.ps1 中')
        }
    }
    Write-Host ("  · 防拆 L3 看门狗组件：" + $tamperParts.Count + " 项已校验（lib-common.ps1）") -ForegroundColor Gray
} else {
    $fail.Add('scripts\lib-common.ps1 缺失，无法校验防拆组件')
}

Write-Host ''
if ($fail.Count -gt 0) {
    Write-Host ('  [FAIL] 自检发现 ' + $fail.Count + ' 个问题：') -ForegroundColor Red
    foreach ($f in $fail) { Write-Host ('    - ' + $f) -ForegroundColor Red }
    throw '出包自检未通过，请修复后重跑。'
}
Write-Host '  [OK]   自检全部通过' -ForegroundColor Green
Write-Host ''

# ---------------------------------------------------------------- 6. 打包 zip
if ($Zip) {
    Write-Host '  正在压缩...' -ForegroundColor White
    $zipPath = $OutDir.TrimEnd('\') + '.zip'
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    Compress-Archive -Path (Join-Path $OutDir '*') -DestinationPath $zipPath -CompressionLevel Optimal
    $zipMB = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 1)
    Write-Host ("  [OK]   zip 已生成：" + $zipPath + "（" + $zipMB + " MB）") -ForegroundColor Green
    Write-Host ''
}
