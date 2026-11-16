$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cli = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if ($cli) { & $cli.Source serve --https=8443 off }
Remove-Item (Join-Path $root 'private\mobile-host.txt') -ErrorAction SilentlyContinue
Write-Output 'Tailscale Serve disabled for port 443. Restart Revenue Factory.'
