# verify-public.ps1
# ---------------------------------------------------------------------------
# Probe the public entry points of the Stelarith stack through Cloudflare.
#
# WHY THIS EXISTS
#   The tunnel `stelarith-local` is REMOTELY managed (config_src=cloudflare),
#   so a missing ingress rule does NOT show up as a DNS failure or a connection
#   error - it shows up as the tunnel catch-all, i.e. a plain HTTP 404.
#   That makes 404-vs-403 the single most reliable signal:
#       404  -> request hit the tunnel but fell through to http_status:404
#               => the ingress rule for that hostname is MISSING
#       !=404 -> request reached an origin service (CIMS on 8096)
#               => the ingress rule EXISTS, any 4xx is now app-level policy
#
#   DNS lookups are useless here: this host's resolver is hijacked and
#   1.1.1.1 times out, so we always test over real HTTPS instead.
#
# ASCII only on purpose (PowerShell 5.1 + missing BOM = garbled text).
#
# USAGE
#   powershell -NoProfile -ExecutionPolicy Bypass -File `
#       D:\Stelarith\_tools\verify-public.ps1
# ---------------------------------------------------------------------------

param(
    [string]$Zone      = "245959623.xyz",
    [string]$PanelHost = "www",
    [int]$TimeoutSec   = 25
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ErrorActionPreference = "Continue"

function Probe([string]$url) {
    try {
        $r = Invoke-WebRequest -Uri $url -TimeoutSec $TimeoutSec -UseBasicParsing
        return "HTTP $($r.StatusCode) len=$($r.Content.Length)"
    } catch {
        $c = $null
        try { $c = $_.Exception.Response.StatusCode.value__ } catch { }
        if (-not $c) { return "NO-ANSWER" }
        return "HTTP $c"
    }
}

$suffix = -join ((97..122) | Get-Random -Count 8 | ForEach-Object { [char]$_ })

$checks = @(
    [pscustomobject]@{ Name = "panel (via $PanelHost)"; Url = "https://$PanelHost.$Zone/admin/login";                                   Expect = "200" }
    [pscustomobject]@{ Name = "panel (own hostname)";   Url = "https://panel.$Zone/admin/login";                                       Expect = "200 if you added it, 404 is OK" }
    [pscustomobject]@{ Name = "wildcard tenant";        Url = "https://$suffix.$Zone/api/v1/client/lab-pc-001/command/queued";         Expect = "NOT 404" }
    [pscustomobject]@{ Name = "wildcard (demo-class)";  Url = "https://demo-class.$Zone/api/v1/client/lab-pc-001/command/queued";      Expect = "NOT 404" }
)

Write-Host ""
Write-Host "Stelarith public entry-point probe  (zone $Zone)" -ForegroundColor Cyan
Write-Host ("-" * 78)
foreach ($c in $checks) {
    $res = Probe $c.Url
    $flag = "  "
    if ($res -eq "HTTP 404") { $flag = "!!" }
    if ($res -like "HTTP 200*") { $flag = "OK" }
    Write-Host ("{0} {1,-26} {2,-20} expect: {3}" -f $flag, $c.Name, $res, $c.Expect)
    Write-Host ("     {0}" -f $c.Url) -ForegroundColor DarkGray
}
Write-Host ("-" * 78)
Write-Host "!! = fell through to the tunnel catch-all -> ingress rule missing." -ForegroundColor Yellow
Write-Host "The connector picks up ingress changes within ~30 s; re-run this after that." -ForegroundColor Yellow
Write-Host ""
