# setup-tunnel-via-api.ps1
# Creates the Cloudflare Tunnel + DNS + remote ingress config entirely through the
# Cloudflare REST API, so we never depend on the interactive `cloudflared tunnel login`
# callback flow (which fails deterministically in this environment).
#
# Needs ONE Cloudflare API token with:
#   Account -> Cloudflare Tunnel -> Edit
#   Zone    -> DNS                -> Edit
#   Zone    -> Zone               -> Read
# scoped to the target zone.
#
# ASCII-only on purpose (PowerShell 5.1 + non-BOM non-ASCII = garbled / fake syntax errors).

param(
    [Parameter(Mandatory=$true)][string]$ApiToken,
    [string]$Zone       = "245959623.xyz",
    [string]$TunnelName = "stelarith-cims",
    [string]$PanelHost  = "panel",
    [int]$PanelPort     = 8090,
    [int]$ClientPort    = 8096,
    [switch]$Apply          # actually install + start the connector service
)

$ErrorActionPreference = "Stop"
$API = "https://api.cloudflare.com/client/v4"
$HDR = @{ Authorization = "Bearer $ApiToken"; "Content-Type" = "application/json" }

function Info($m) { Write-Host "[*] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "[X] $m" -ForegroundColor Red; exit 1 }

function Invoke-CF {
    param([string]$Method, [string]$Path, $Body)
    $uri = "$API$Path"
    try {
        if ($null -ne $Body) {
            $json = $Body | ConvertTo-Json -Depth 12 -Compress
            return Invoke-RestMethod -Method $Method -Uri $uri -Headers $HDR -Body $json
        } else {
            return Invoke-RestMethod -Method $Method -Uri $uri -Headers $HDR
        }
    } catch {
        # PS 5.1: Invoke-RestMethod does NOT populate ErrorDetails reliably.
        # Read the raw response stream so the real Cloudflare error text is visible.
        $detail = $null
        try {
            $resp = $_.Exception.Response
            if ($resp) {
                $stream = $resp.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $detail = $reader.ReadToEnd()
                $reader.Close()
            }
        } catch { }
        if (-not $detail) { $detail = $_.ErrorDetails.Message }
        if (-not $detail) { $detail = $_.Exception.Message }
        $code = "?"
        try { $code = $_.Exception.Response.StatusCode.value__ } catch { }
        Die "$Method $Path -> HTTP $code : $detail"
    }
}

# ---------------------------------------------------------------- 1. zone + account
Info "Looking up zone '$Zone' ..."
$zr = Invoke-CF GET "/zones?name=$Zone"
if (-not $zr.result -or $zr.result.Count -eq 0) { Die "zone '$Zone' not found (or token lacks Zone:Read)" }
$zoneObj  = $zr.result[0]
$zoneId   = $zoneObj.id
$accountId = $zoneObj.account.id
Ok "zone_id    = $zoneId"
Ok "account_id = $accountId  ($($zoneObj.account.name))"

# ---------------------------------------------------------------- 2. tunnel
Info "Looking for existing tunnel '$TunnelName' ..."
$tr = Invoke-CF GET "/accounts/$accountId/cfd_tunnel?is_deleted=false&name=$TunnelName"
$tunnel = $null
if ($tr.result -and $tr.result.Count -gt 0) { $tunnel = $tr.result[0]; Warn "already exists, reusing it" }

if (-not $tunnel) {
    Info "Creating tunnel (remotely managed) ..."
    $cr = Invoke-CF POST "/accounts/$accountId/cfd_tunnel" @{ name = $TunnelName; config_src = "cloudflare" }
    $tunnel = $cr.result
}
$tid = $tunnel.id
Ok "tunnel id  = $tid"

# ---------------------------------------------------------------- 3. ingress config
$panelFqdn = "$PanelHost.$Zone"
$wildFqdn  = "*.$Zone"
$ingress = @(
    @{ hostname = $panelFqdn; service = "http://localhost:$PanelPort" },
    @{ hostname = $wildFqdn;  service = "http://localhost:$ClientPort" },
    @{ service = "http_status:404" }
)
Info "Pushing ingress rules (panel rule first, wildcard second) ..."
Invoke-CF PUT "/accounts/$accountId/cfd_tunnel/$tid/configurations" @{ config = @{ ingress = $ingress } } | Out-Null
Ok "ingress configured"

# ---------------------------------------------------------------- 4. DNS
$cnameTarget = "$tid.cfargotunnel.com"
foreach ($rec in @($panelFqdn, $wildFqdn)) {
    Info "Creating DNS record: $rec -> $cnameTarget"
    $existing = Invoke-CF GET "/zones/$zoneId/dns_records?name=$rec"
    if ($existing.result -and $existing.result.Count -gt 0) {
        $rid = $existing.result[0].id
        Invoke-CF PUT "/zones/$zoneId/dns_records/$rid" @{ type = "CNAME"; name = $rec; content = $cnameTarget; proxied = $true } | Out-Null
        Warn "  updated existing record"
    } else {
        Invoke-CF POST "/zones/$zoneId/dns_records" @{ type = "CNAME"; name = $rec; content = $cnameTarget; proxied = $true } | Out-Null
        Ok "  created"
    }
}

# ---------------------------------------------------------------- 5. connector token
Info "Fetching connector token ..."
$tk = Invoke-CF GET "/accounts/$accountId/cfd_tunnel/$tid/token"
$connectorToken = $tk.result
if (-not $connectorToken) { Die "no connector token returned" }
Ok "connector token acquired ($($connectorToken.Length) chars)"

# ---------------------------------------------------------------- 6. install service
if ($Apply) {
    $cf = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
    if (-not (Test-Path $cf)) { $cf = Join-Path $env:ProgramFiles "cloudflared\cloudflared.exe" }
    if (-not (Test-Path $cf)) { Die "cloudflared.exe not found" }
    Info "Installing connector as a Windows service ..."
    & $cf service install $connectorToken
    Start-Sleep -Seconds 3
    Get-Service cloudflared -ErrorAction SilentlyContinue | ForEach-Object { Ok ("service state = " + $_.Status) }
}

# ---------------------------------------------------------------- summary
Write-Host ""
Ok "Tunnel is ready."
Write-Host "    panel  : https://$panelFqdn/admin/login"
Write-Host "    tenant : https://demo-class.$Zone/api/v1/client/manifest"
Write-Host ""
Write-Host "  For the SECOND (standby) server, JUST run this on it:"
Write-Host "      cloudflared service install $connectorToken"
Write-Host "  Same token on two machines = automatic multi-connector failover."
Write-Host ""
Write-Host "  Token (keep secret):"
Write-Host $connectorToken
