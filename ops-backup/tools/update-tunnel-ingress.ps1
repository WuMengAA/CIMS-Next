param(
    [string]$ApiToken = $env:CF_API_TOKEN,
    [string]$AccountId = "ed7cc9ac1be3bea41051bb4e56ef1279",
    [string]$TunnelId  = "9d95ef14-54c4-4637-894b-0aa91ead6bf6",
    [string]$Zone      = "245959623.xyz",
    [string]$PanelHost = "panel",
    [int]$PanelPort    = 8090,
    [int]$ClientPort   = 8096,
    [switch]$SkipDns,
    [switch]$WhatIfOnly
)

# ASCII only on purpose.

$ErrorActionPreference = "Stop"
$API = "https://api.cloudflare.com/client/v4"
$HDR = @{ Authorization = "Bearer $ApiToken"; "Content-Type" = "application/json" }

function Info($m) { Write-Host "[*] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "[X] $m" -ForegroundColor Red; exit 1 }

function Invoke-CF {
    param([string]$Method, [string]$Path, $Body, [switch]$AllowFail)
    $uri = "$API$Path"
    try {
        if ($null -ne $Body) {
            $json = $Body | ConvertTo-Json -Depth 20 -Compress
            return Invoke-RestMethod -Method $Method -Uri $uri -Headers $HDR -Body $json
        }
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $HDR
    } catch {
        $detail = $null
        try {
            $resp = $_.Exception.Response
            if ($resp) {
                $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
                $detail = $reader.ReadToEnd(); $reader.Close()
            }
        } catch { }
        if (-not $detail) { $detail = $_.ErrorDetails.Message }
        if (-not $detail) { $detail = $_.Exception.Message }
        $code = "?"
        try { $code = $_.Exception.Response.StatusCode.value__ } catch { }
        if ($AllowFail) { Warn "$Method $Path -> HTTP $code : $detail"; return $null }
        Die "$Method $Path -> HTTP $code : $detail"
    }
}

if (-not $ApiToken) { Die "no token. pass -ApiToken <TOKEN> or set `$env:CF_API_TOKEN" }
if ($ApiToken.Length -lt 30) { Warn "token suspiciously short ($($ApiToken.Length) chars)" }
if ($ApiToken -notmatch '^(cfut_|cfat_|cfk_)') {
    Warn "token does not start with cfut_ / cfat_ / cfk_ - Cloudflare 2026 tokens always do."
}

# ---------------------------------------------------------------- token sanity
Info "Verifying token ..."
$v = Invoke-CF GET "/user/tokens/verify" $null -AllowFail
if ($v -and $v.result -and $v.result.status -eq "active") {
    Ok "token active (user-owned)"
} else {
    $v2 = Invoke-CF GET "/accounts/$AccountId/tokens/verify" $null -AllowFail
    if ($v2 -and $v2.result -and $v2.result.status -eq "active") {
        Ok "token active (account-owned)"
    } else {
        Warn "verify endpoint did not confirm the token; will still try the real call"
    }
}

# ---------------------------------------------------------------- read ingress
Info "Reading remote ingress of tunnel $TunnelId ..."
$cur = Invoke-CF GET "/accounts/$AccountId/cfd_tunnel/$TunnelId/configurations"
$existing = @()
if ($cur.result -and $cur.result.config -and $cur.result.config.ingress) {
    $existing = @($cur.result.config.ingress)
}
Ok "current rules = $($existing.Count)"

$panelFqdn = "$PanelHost.$Zone"
$wildFqdn  = "*.$Zone"

# keep everything except the trailing catch-all and any stale copy of our rules
$keep = New-Object System.Collections.ArrayList
$catchAll = $null
foreach ($r in $existing) {
    $h = $null
    if ($r.PSObject.Properties.Name -contains 'hostname') { $h = $r.hostname }
    if (-not $h -and $null -eq $catchAll) { $catchAll = [ordered]@{ service = "http_status:404" }; continue }
    if ($h -eq $panelFqdn -or $h -eq $wildFqdn) {
        Warn "dropping stale rule for $h (re-added below in correct order)"; continue
    }
    [void]$keep.Add($r)
}
if (-not $catchAll) { $catchAll = [ordered]@{ service = "http_status:404" }; Warn "no catch-all found; appending http_status:404" }

$merged = New-Object System.Collections.ArrayList
foreach ($r in $keep) { [void]$merged.Add($r) }
[void]$merged.Add([ordered]@{ hostname = $panelFqdn; service = "http://localhost:$PanelPort" })
[void]$merged.Add([ordered]@{ hostname = $wildFqdn;  service = "http://localhost:$ClientPort" })
[void]$merged.Add($catchAll)

Write-Host ""
Info "Merged ingress (order matters):"
$i = 0
foreach ($r in $merged) {
    $line = "    {0,2}. " -f $i
    if ($r.PSObject.Properties.Name -contains 'hostname') { $line += "$($r.hostname)  " }
    if ($r.PSObject.Properties.Name -contains 'path')     { $line += "path=$($r.path)  " }
    $line += "-> $($r.service)"
    Write-Host $line
    $i++
}
Write-Host ""

if ($WhatIfOnly) { Warn "-WhatIfOnly: nothing pushed."; exit 0 }

# ---------------------------------------------------------------- push
Info "Pushing merged ingress ..."
$cfg = @{ config = @{ ingress = @($merged); "warp-routing" = @{ enabled = $false } } }
Invoke-CF PUT "/accounts/$AccountId/cfd_tunnel/$TunnelId/configurations" $cfg | Out-Null
Ok "ingress pushed"

# ---------------------------------------------------------------- DNS (best effort)
if (-not $SkipDns) {
    $zr = Invoke-CF GET "/zones?name=$Zone" $null -AllowFail
    if ($zr -and $zr.result -and $zr.result.Count -gt 0) {
        $zoneId = $zr.result[0].id
        $cnameTarget = "$TunnelId.cfargotunnel.com"
        foreach ($rec in @($panelFqdn, $wildFqdn)) {
            $q = Invoke-CF GET "/zones/$zoneId/dns_records?name=$rec" $null -AllowFail
            if ($q -and $q.result -and $q.result.Count -gt 0) {
                Ok "DNS ok: $rec -> $($q.result[0].content) (proxied=$($q.result[0].proxied))"
            } else {
                Warn "DNS missing for $rec -> creating CNAME $cnameTarget"
                $c = Invoke-CF POST "/zones/$zoneId/dns_records" @{ type="CNAME"; name=$rec; content=$cnameTarget; proxied=$true } -AllowFail
                if ($c) { Ok "  created"; } else { Warn "  create failed (needs Zone:DNS:Edit)" }
            }
        }
    } else {
        Warn "cannot read zone (token lacks Zone:Read) - skipping DNS step."
        Warn "Add the DNS records by hand, or add these records in the dashboard:"
        Warn "   CNAME  $panelFqdn  ->  $TunnelId.cfargotunnel.com  (proxied)"
        Warn "   CNAME  *.$Zone     ->  $TunnelId.cfargotunnel.com  (proxied)"
    }
}

Write-Host ""
Ok "Done. Verify from OUTSIDE the tunnel:"
Write-Host "    https://$panelFqdn/admin/login"
Write-Host "    https://demo-class.$Zone/api/v1/client/lab-pc-001/command/queued"
Write-Host ""
Warn "The connector picks up the new config in ~30 s; no restart needed."
Warn "config.yml on disk is NOT used while config_src=cloudflare - do not edit it."
