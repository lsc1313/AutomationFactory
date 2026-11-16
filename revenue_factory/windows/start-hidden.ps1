$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js 20+ is required.' }
$private = Join-Path $root 'private'
New-Item -ItemType Directory -Path $private -Force | Out-Null
$pidFile = Join-Path $private 'background-pid.txt'
$target = Join-Path $root 'app.mjs'
function IsOurProcess($processNumber) {
 if (-not $processNumber) { return $false }
 $p = Get-CimInstance Win32_Process -Filter "ProcessId=$processNumber" -ErrorAction SilentlyContinue
 return ($null -ne $p -and $p.Name -match '^node(\.exe)?$' -and $p.CommandLine -like "*app.mjs*")
}
if (Test-Path $pidFile) {
 $previous = (Get-Content $pidFile -Raw).Trim()
 if ($previous -match '^\d+$' -and (IsOurProcess $previous)) { exit 0 }
 Remove-Item $pidFile -Force
}
$env:REVENUE_APP_PORT = '8040'
$env:REVENUE_BIND = '127.0.0.1'
$hostFile = Join-Path $private 'mobile-host.txt'
if (Test-Path $hostFile) {
 $tailnetHost = (Get-Content $hostFile -Raw).Trim()
 if ($tailnetHost -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+\.ts\.net$') { throw 'Invalid tailnet host configuration' }
 $env:REVENUE_PUBLIC_HOST = $tailnetHost
 $env:REVENUE_TRUST_PROXY = '1'
 $env:REVENUE_SECURE_COOKIE = '1'
}
if (-not $env:REVENUE_SHORTSAI_HOME) {
 foreach ($candidate in @((Join-Path $root '..\..\ShortsAI_CLEAN'),(Join-Path $env:USERPROFILE 'ShortsAI_CLEAN'))) {
  if (Test-Path (Join-Path $candidate 'modules\shopping\director.js')) {
   $env:REVENUE_SHORTSAI_HOME = (Resolve-Path $candidate).Path; break
  }
 }
}
$stdout = Join-Path $private 'background-out.log'
$stderr = Join-Path $private 'background-error.log'
$process = Start-Process -FilePath $node -ArgumentList @('app.mjs') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
Set-Content -Path $pidFile -Value $process.Id -Encoding ascii
