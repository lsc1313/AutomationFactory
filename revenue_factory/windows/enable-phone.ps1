$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cli = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if (-not $cli) {
 $installed = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
 if (Test-Path $installed) { $cli = [pscustomobject]@{Source=$installed} }
}
if (-not $cli) { throw 'Tailscale CLI not found. Existing Tailscale desktop installation path needs to be checked.' }
# Windows PowerShell 5.1 decodes native output using the console code page.
# Non-ASCII peer/display names can corrupt Tailscale JSON before ConvertFrom-Json.
# Capture the CLI's UTF-8 stdout directly instead of piping through PowerShell.
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $cli.Source
$psi.Arguments = 'status --json'
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
$process = New-Object System.Diagnostics.Process
$process.StartInfo = $psi
[void]$process.Start()
$rawJson = $process.StandardOutput.ReadToEnd()
$errorOutput = $process.StandardError.ReadToEnd()
$process.WaitForExit()
if ($process.ExitCode -ne 0) { throw "Tailscale status failed: $errorOutput" }
try { $status = ConvertFrom-Json -InputObject $rawJson -ErrorAction Stop }
catch { throw 'Tailscale status JSON could not be decoded as UTF-8. Verify the Tailscale installation.' }
if ($LASTEXITCODE -ne 0 -or -not $status.Self -or -not $status.Self.DNSName) { throw 'Tailscale must be connected before mobile access can be enabled.' }
$dns = $status.Self.DNSName.TrimEnd('.').ToLowerInvariant()
if ($dns -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+\.ts\.net$') { throw "Invalid Tailscale device hostname: $dns" }
$private = Join-Path $root 'private'
New-Item -ItemType Directory -Path $private -Force | Out-Null
# Backend remains bound to localhost. Tailscale Serve is PRIVATE to the tailnet; never use Funnel here.
& $cli.Source serve --bg --https=8443 8040
if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve failed. Run this setup in Windows Terminal (Admin); enable HTTPS in Tailscale if prompted.' }
Set-Content -Path (Join-Path $private 'mobile-host.txt') -Value $dns -Encoding ascii
Write-Output "Mobile URL: https://$dns`:8443/app"
Write-Output 'Restart Revenue Factory background app to apply its exact HTTPS host allowlist.'
