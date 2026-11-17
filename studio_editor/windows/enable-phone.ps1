$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cli = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if (-not $cli) {
 $installed = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
 if (Test-Path $installed) { $cli = [pscustomobject]@{Source=$installed} }
}
if (-not $cli) { throw 'Tailscale CLI could not be found.' }
# Avoid Windows PowerShell's incorrect native UTF-8 JSON decoding of Korean device names.
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
$json = $process.StandardOutput.ReadToEnd()
$errorOutput = $process.StandardError.ReadToEnd()
$process.WaitForExit()
if ($process.ExitCode -ne 0) { throw "Tailscale status error: $errorOutput" }
$status = ConvertFrom-Json -InputObject $json -ErrorAction Stop
if ($status.BackendState -ne 'Running' -or -not $status.Self.DNSName) { throw "Tailscale is not connected: $($status.BackendState)" }
$dns = $status.Self.DNSName.TrimEnd('.').ToLowerInvariant()
if ($dns -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+\.ts\.net$') { throw 'Invalid DNS name' }
# Tailscale Serve is private. Use a different port than Shorts Studio and Revenue Factory.
& $cli.Source serve --bg --https=10000 8050
if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve failed.' }
$private = Join-Path $root 'private'
New-Item -ItemType Directory -Path $private -Force | Out-Null
Set-Content -Path (Join-Path $private 'mobile-host.txt') -Value $dns -Encoding ascii
Write-Output "Mobile editor URL: https://$dns`:10000/app"
Write-Output 'Restart Studio Editor to read the mobile-host setting.'