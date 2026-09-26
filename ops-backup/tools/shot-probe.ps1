param([Parameter(Mandatory=$true)][string]$Out)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object -TypeName System.Drawing.Bitmap -ArgumentList ([int]$b.Width), ([int]$b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen([int]$b.Left, [int]$b.Top, 0, 0, $bmp.Size)
$dir = Split-Path -Parent $Out
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()

$fi = Get-Item $Out
Write-Output ("OK " + $fi.FullName + " " + $fi.Length + " " + $b.Width + "x" + $b.Height)
