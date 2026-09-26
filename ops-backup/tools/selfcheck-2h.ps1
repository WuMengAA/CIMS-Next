<#
  Stelarith 本地部署 · 2 小时自动健康检查 + 自愈
  ------------------------------------------------------------
  由计划任务 Stelarith-2H-Selfcheck 每 2 小时触发（带 ≤15 分钟随机抖动，避免踩踏）。

  设计前提：本机是唯一服务节点（无外网备份），任一核心服务挂掉 = 全校集控失联。
  所以本脚本不止"报告"，更做"自愈"：探测到核心端口不通 -> 重启对应计划任务，
  并落盘每一次结果，供下一次有人登录时复盘。

  自检项：
    1) 核心端口 HTTP 探针（8090 网站 / 8096-8100 CIMS）—— 用 HTTP 而非裸 TCP，
       避开 netsh portproxy 制造的幽灵监听者（它只认 0.0.0.0，会骗过 TCP 探针）。
    2) 面板静态件版本一致 + listClasses 修复逻辑已生效（确认不静默降级成演示班级）。
    3) /class/list 经代理返回真实班级数组（确认不假数据、不逻辑熔断）。
    4) 关键计划任务处于 Running（网站 / CIMS 后端 / CF 隧道 / P2P 信令 / 教室 Agent）。
    5) D 盘剩余空间 > 2GB。
#>
$ErrorActionPreference = 'Continue'
$script:anyFail = $false

# 解析 node 路径（mint 会话用）：优先 PATH，否则回退常见安装位置。
$nodeExe = "node"
$np = Get-Command node -ErrorAction SilentlyContinue
if ($np) {
    $nodeExe = $np.Source
} else {
    foreach ($cand in @("C:\Program Files\nodejs\node.exe", "C:\Program Files (x86)\nodejs\node.exe")) {
        if (Test-Path $cand) { $nodeExe = $cand; break }
    }
}

$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$logDir = "D:\Stelarith\_logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$jsonl       = Join-Path $logDir "selfcheck-2h.jsonl"
$summaryFile = Join-Path $logDir "selfcheck-2h.latest.txt"
$script:actions = @()
$script:restartedTasks = @{}

function Emit($name, $ok, $detail) {
    if (-not $ok) { $script:anyFail = $true }
    $line = ("{0}`t{1}`t{2}`t{3}" -f $ts, $(if ($ok) { "OK" } else { "FAIL" }), $name, $detail)
    try { Add-Content -Path $jsonl -Value $line -Encoding UTF8 } catch { }
    Write-Output $line
}

function Probe($url) {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 6 -MaximumRedirection 0 -ErrorAction Stop
        return @{ alive = $true; code = [int]$r.StatusCode }
    } catch [System.Net.WebException] {
        $resp = $_.Exception.Response
        if ($resp) { return @{ alive = $true; code = [int]$resp.StatusCode } }
        return @{ alive = $false; code = 0 }
    } catch { return @{ alive = $false; code = 0 } }
}

function Restart-Task($name) {
    # 去重：同一任务本轮只重启一次（4 个 CIMS 端口共用一个任务，
    # 若其中 2 个失败会连锁触发 4 次重启 —— 2026-09-23 T07 实测修正）。
    if ($script:restartedTasks.ContainsKey($name)) { return $true }
    $script:restartedTasks[$name] = $true
    try {
        Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
        Start-ScheduledTask -TaskName $name -ErrorAction Stop
        $script:actions += ("restarted:" + $name)
        return $true
    } catch { return $false }
}

# TCP 探针：gRPC 端口（8100）不是 HTTP，Invoke-WebRequest 永远拿不到
# HTTP 应答 -> 恒判 unreachable -> 误杀 CIMS。只能做 TCP 连接测试
# （与 selfcheck-2h.mjs 的 tcpProbe 同口径，2026-09-23 T07 修正）。
function Probe-Tcp($port) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        if ($iar.AsyncWaitHandle.WaitOne(3000)) {
            $client.EndConnect($iar)
            $client.Close()
            return $true
        }
        $client.Close()
        return $false
    } catch { return $false }
}

# ---- 1) 核心端口探针 ----
# 注意：8096~8098 是 HTTP 服务，用 HTTP 探；8100 是 gRPC（非 HTTP），
# 必须走 TCP 探（2026-09-23 T07 修正：旧版对 8100 做 HTTP 探测恒判
# unreachable，导致每 2 小时把活着的 CIMS 强杀重启一次）。
$map = @{
    "web-8090"  = @{ url = "http://127.0.0.1:8090/admin/console/"; task = "StelarithServer" }
    "cims-8096" = @{ url = "http://127.0.0.1:8096/";            task = "CIMS-Backend-AutoStart" }
    "cims-8097" = @{ url = "http://127.0.0.1:8097/";            task = "CIMS-Backend-AutoStart" }
    "cims-8098" = @{ url = "http://127.0.0.1:8098/";            task = "CIMS-Backend-AutoStart" }
}
$tcpMap = @{
    "cims-8100" = @{ port = 8100; task = "CIMS-Backend-AutoStart" }
}
foreach ($k in $map.Keys) {
    $p = Probe $map[$k].url
    if ($p.alive) {
        Emit $k $true ("http ok (" + $p.code + ")")
    } else {
        Emit $k $false "http unreachable"
        if (Restart-Task $map[$k].task) { Emit ($k + ":heal") $true ("restarted " + $map[$k].task) }
        else { Emit ($k + ":heal") $false "restart failed" }
    }
}
foreach ($k in $tcpMap.Keys) {
    if (Probe-Tcp $tcpMap[$k].port) {
        Emit $k $true ("tcp ok (listening)")
    } else {
        Emit $k $false "tcp connect failed"
        if (Restart-Task $tcpMap[$k].task) { Emit ($k + ":heal") $true ("restarted " + $tcpMap[$k].task) }
        else { Emit ($k + ":heal") $false "restart failed" }
    }
}

# ---- 2) 面板静态件 + listClasses 修复逻辑是否生效 ----
$apiJs = & curl.exe -s -m 8 "http://127.0.0.1:8090/console/api.js"
if ($apiJs -match "writeClassCache") {
    Emit "static-api" $true "api.js loaded, listClasses 不静默降级逻辑已生效"
} else {
    Emit "static-api" $false "api.js 未加载到 listClasses 修复逻辑（静态件可能未同步）"
}

# ---- 3) /class/list 返回真实班级（确认不假、不熔断）----
$tok = (& $nodeExe "D:\Stelarith\_probe\mint-session.mjs" mint admin 2>$null | Select-Object -First 1)
$clUrl = "http://127.0.0.1:8090/api/console/cims/class/list"
$tmp = Join-Path $env:TEMP ("cls_" + [guid]::NewGuid().ToString("N") + ".json")
$clCode = & curl.exe -s -m 10 -o $tmp -w "%{http_code}" -b ("admin_token=" + $tok) $clUrl
$clBody = ""
if (Test-Path $tmp) { $clBody = (Get-Content -Path $tmp -Raw -Encoding UTF8); Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
[int]$codeInt = 0
if ([int]::TryParse($clCode, [ref]$codeInt)) { $clCode = $codeInt } else { $clCode = 0 }
if ($clCode -eq 200) {
    $arr = $null
    try { $arr = $clBody | ConvertFrom-Json -ErrorAction Stop } catch { }
    if ($arr -is [System.Array] -and $arr.Count -gt 0) {
        Emit "class-list" $true ("真实班级数=$($arr.Count)")
    } else {
        Emit "class-list" $true "端点存活(200)，返回非空但非班级数组"
    }
} elseif ($clCode -in @(401, 403)) {
    Emit "class-list" $true "后端存活($clCode，需登录)，未验证班级数据"
} else {
    Emit "class-list" $false ("HTTP $clCode / 熔断或不可达")
}

# ---- 4) 关键计划任务状态 ----
$tasks = @("StelarithServer", "CIMS-Backend-AutoStart", "Cloudflared-Stelarith-Tunnel", "Stelarith-P2P-Signaling", "Stelarith-Agent-AutoStart")
foreach ($t in $tasks) {
    $s = (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue).State
    if ($s -eq "Running") {
        Emit ("task:" + $t) $true "Running"
    } else {
        Emit ("task:" + $t) $false ("state=$s，尝试重启")
        Restart-Task $t | Out-Null
    }
}

# ---- 5) 磁盘空间 ----
# D 盘：CIMS 日志/数据库所在（旧版只查 D，C 盘 0.5GB 事件后补 C 盘）。
# C 盘：uv/Python 运行所在（C:\Users\...\AppData\Roaming\uv），写临时文件/缓存
# 失败也会让 CIMS 硬崩 —— 2026-09-23 T07 实测 C 盘仅 0.5GB 时补的只读检查。
$d = Get-PSDrive -Name D -ErrorAction SilentlyContinue
if ($d -and $d.Free -lt 2GB) {
    Emit "disk-D" $false ("剩余=$([math]::Round($d.Free/1GB,1))GB < 2GB")
} else {
    Emit "disk-D" $true "剩余空间充足"
}
$c = Get-PSDrive -Name C -ErrorAction SilentlyContinue
if ($c -and $c.Free -lt 2GB) {
    Emit "disk-C" $false ("剩余=$([math]::Round($c.Free/1GB,1))GB < 2GB（CIMS 运行时在 C 盘，需清理）")
} else {
    Emit "disk-C" $true "剩余空间充足"
}

# ---- 汇总 ----
$status = if ($script:anyFail) { "DEGRADED" } else { "HEALTHY" }
$summary = ("{0} | {1} | 自愈动作: {2}" -f $ts, $status, ($script:actions -join ", "))
try { Add-Content -Path $summaryFile -Value $summary -Encoding UTF8 } catch { }
Write-Output ("=== 自检汇总: " + $status + " ===")
Write-Output $summary
exit 0
