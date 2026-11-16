$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cli = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if (-not $cli) { throw 'Install and sign in to Tailscale on Windows first: https://tailscale.com/download/windows' }
$status = & $cli.Source status --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $status.Self -or -not $status.Self.DNSName) { throw 'Tailscale must be connected before mobile access can be enabled.' }
$dns = $status.Self.DNSName.TrimEnd('.').ToLowerInvariant()
if ($dns -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+\.ts\.net$') { throw "Invalid Tailscale device hostname: $dns" }
$private = Join-Path $root 'private'
New-Item -ItemType Directory -Path $private -Force | Out-Null
# Backend remains bound to localhost. Tailscale Serve is PRIVATE to the tailnet; never use Funnel here.
& $cli.Source serve --bg 8040
if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve failed. Run this setup in Windows Terminal (Admin); enable HTTPS in Tailscale if prompted.' }
Set-Content -Path (Join-Path $private 'mobile-host.txt') -Value $dns -Encoding ascii
Write-Output "Mobile URL: https://$dns/app"
Write-Output 'Restart Revenue Factory background app to apply its exact HTTPS host allowlist.'
