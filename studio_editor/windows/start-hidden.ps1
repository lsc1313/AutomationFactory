$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js 20+ is required.' }
$private = Join-Path $root 'private'
New-Item -ItemType Directory -Path $private -Force | Out-Null
$pidFile = Join-Path $private 'server-pid.txt'
if (Test-Path $pidFile) {
 $previous = (Get-Content $pidFile -Raw).Trim()
 if ($previous -match '^\d+$') {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$previous" -ErrorAction SilentlyContinue
  if ($proc -and $proc.Name -match '^node(\.exe)?$' -and $proc.CommandLine -like '*server.mjs*') { exit 0 }
 }
 Remove-Item $pidFile -Force
}
$env:STUDIO_PORT = '8050'
$hostFile = Join-Path $private 'mobile-host.txt'
if (Test-Path $hostFile) {
 $dns = (Get-Content $hostFile -Raw).Trim()
 if ($dns -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+\.ts\.net$') { throw 'Invalid Tailscale DNS name.' }
 $env:STUDIO_PUBLIC_HOST = $dns
 $env:STUDIO_TRUST_PROXY = '1'
}
$process = Start-Process -FilePath $node -ArgumentList @('server.mjs') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $private 'server-out.log') -RedirectStandardError (Join-Path $private 'server-error.log')
Set-Content -Path $pidFile -Value $process.Id -Encoding ascii