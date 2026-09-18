# =============================================================
# generate-md5.ps1 -- Generates MD5 checksums for .cipx packages.
# Mirrors ClassIsland's official StartUpAsAdmin generate-md5.ps1:
# computes MD5 for each .cipx, writes <file>.md5sum and checksums.md.
# Usage: powershell -ExecutionPolicy Bypass -File generate-md5.ps1
# NOTE: keep this script ASCII-only (PS5.1 reads it as ANSI when no BOM).
# =============================================================
param($path = $PSScriptRoot)

Write-Output $path
$files = Get-ChildItem -Path $path -File | Where-Object { $_.Extension -eq '.cipx' }

$hashes = [ordered]@{}
$summary = @"

> [!important]
> Please verify the MD5 before downloading.

| File | MD5 |
| --- | --- |
"@

foreach ($i in $files) {
    $name = $i.Name
    $hash = (Get-FileHash -Path $i.FullName -Algorithm MD5).Hash
    $hashes[$name] = $hash
    Get-ChildItem -Path $path -Filter "$name.md5sum" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Set-Content -LiteralPath "$($i.FullName).md5sum" -Value $hash -Encoding Ascii
    $summary += "| $name | ``$($hash)```n"
}

$summary +=  "`n<!-- CLASSISLAND_PKG_MD5 $($hashes | ConvertTo-Json -Compress) -->"
Set-Content -LiteralPath (Join-Path $path 'checksums.md') -Value $summary -Encoding ASCII

Write-Host "MD5 Summary:" -ForegroundColor Gray
Write-Host $summary -ForegroundColor Gray
Write-Host "----------" -ForegroundColor Gray
