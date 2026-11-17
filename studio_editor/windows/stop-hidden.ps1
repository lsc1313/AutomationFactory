$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$file = Join-Path $root 'private\server-pid.txt'
if (-not (Test-Path $file)) { exit 0 }
$processNumber=(Get-Content $file -Raw).Trim()
if ($processNumber -match '^\d+$') {
 $p=Get-CimInstance Win32_Process -Filter "ProcessId=$processNumber" -ErrorAction SilentlyContinue
 if ($p -and $p.Name -match '^node(\.exe)?$' -and $p.CommandLine -like '*server.mjs*') { Stop-Process -Id ([int]$processNumber) }
}
Remove-Item $file -Force -ErrorAction SilentlyContinue