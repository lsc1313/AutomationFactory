$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pidFile = Join-Path $root 'private\background-pid.txt'
if (-not (Test-Path $pidFile)) { Write-Output 'No tracked Revenue Factory background process'; exit 0 }
$id = (Get-Content $pidFile -Raw).Trim()
if ($id -notmatch '^\d+$') { throw 'Invalid background PID file' }
$p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
if ($p -and $p.Name -match '^node(\.exe)?$' -and $p.CommandLine -like '*app.mjs*') {
 Stop-Process -Id ([int]$id) -ErrorAction Stop
 Write-Output 'Revenue Factory stopped.'
}
Remove-Item $pidFile -Force
