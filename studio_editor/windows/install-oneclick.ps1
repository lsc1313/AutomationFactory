# Standalone Studio Editor one-command installer/updater for Windows PowerShell 5.1+.
# Only updates %LOCALAPPDATA%\StudioEditor; never touches ShortsAI or Revenue Factory.
[CmdletBinding()]
param([switch]$NoPhone)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$version = 'v1.3.12'
$branch = if ($env:STUDIO_SOURCE_REF -and $env:STUDIO_SOURCE_REF -match '^[0-9a-f]{40}$') { $env:STUDIO_SOURCE_REF } else { 'feature/standalone-studio-editor-v0-1' }
$repoBase = "https://raw.githubusercontent.com/lsc1313/AutomationFactory/$branch/studio_editor"
$dest = Join-Path $env:LOCALAPPDATA 'StudioEditor'
$private = Join-Path $dest 'private'
$log = Join-Path $env:TEMP 'StudioEditor-install.log'
$files = @(
 'server.mjs', 'ai-draft.mjs', 'timeline-v2.mjs', 'stt-server.mjs', 'stt-local.py', 'tts_windows.py', 'tests/ai-draft.test.mjs', 'public/index.html', 'public/client.js', 'public/styles.css', 'public/timeline-ui.js', 'public/timeline-ui.css', 'public/mobile-ui.js', 'public/mobile-ui.css',
 'tests/studio.test.mjs', 'tests/timeline-v2.test.mjs', 'windows/start-hidden.ps1',
 'windows/start-hidden.vbs', 'windows/stop-hidden.ps1',
 'windows/enable-phone.ps1', 'windows/start-guest-preview.ps1', 'README.md', 'windows/install-oneclick.ps1'
)
function Note([string]$message) {
 $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message"
 Write-Host $line
 Add-Content -LiteralPath $log -Value $line -Encoding UTF8
}
function Download([string]$url,[string]$file) {
 # TLS 1.2 is required on older Windows PowerShell.
 [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
 Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $file -TimeoutSec 45 -ErrorAction Stop
 if ((Get-Item -LiteralPath $file).Length -lt 10) { throw "Downloaded file is empty: $url" }
}
function Find-Program([string]$name,[string[]]$candidates) {
 $cmd = Get-Command $name -ErrorAction SilentlyContinue
 if ($cmd) { return $cmd.Source }
 foreach($p in $candidates) { if ($p -and (Test-Path -LiteralPath $p)) {return $p} }
 return $null
}
function StudioProcess([int]$processNumber) {
 if (-not $processNumber) { return $false }
 $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$processNumber" -ErrorAction SilentlyContinue
 $listener = Get-NetTCPConnection -LocalPort 8050 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $processNumber } | Select-Object -First 1
 return [bool]($proc -and $proc.Name -match '^node(\.exe)?$' -and $proc.CommandLine -match 'server\.mjs' -and $listener)
}
try {
 Note "Studio Editor $version install/update started"
 if (-not $env:LOCALAPPDATA) {throw 'LOCALAPPDATA is not set.'}
 $node = Find-Program 'node.exe' @("$env:ProgramFiles\nodejs\node.exe")
 if (-not $node) {throw 'Node.js is required. Install Node.js 20+ first (existing ShortsAI PC may already have it).'}
 $nodeMajor = [int]((& $node --version).TrimStart('v').Split('.')[0])
 if ($nodeMajor -lt 20) {throw "Node.js 20+ is required. Current version: $nodeMajor"}
 $stage = Join-Path $env:TEMP ('StudioEditor-stage-'+[guid]::NewGuid().ToString('N'))
 New-Item -ItemType Directory -Path $stage -Force | Out-Null
 try {
  Note "Downloading editor files (existing projects will be preserved)"
  foreach ($relative in $files) {
   $output = Join-Path $stage ($relative.Replace('/',[IO.Path]::DirectorySeparatorChar))
   New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
   Download "$repoBase/$relative`?v=$version" $output
  }
  & $node --check (Join-Path $stage 'timeline-v2.mjs')
  if ($LASTEXITCODE -ne 0) {throw 'Timeline engine syntax check failed; existing version unchanged.'}
  & $node --check (Join-Path $stage 'public\timeline-ui.js')
  if ($LASTEXITCODE -ne 0) {throw 'Precision editor UI syntax check failed; existing version unchanged.'}
  & $node --check (Join-Path $stage 'server.mjs')
  if ($LASTEXITCODE -ne 0) {throw 'Editor server syntax check failed; existing version unchanged.'}
  & $node --check (Join-Path $stage 'public\client.js')
  if ($LASTEXITCODE -ne 0) {throw 'Editor UI syntax check failed; existing version unchanged.'}
  & $node --check (Join-Path $stage 'public\mobile-ui.js')
  if ($LASTEXITCODE -ne 0) {throw 'Mobile editor syntax check failed; existing version unchanged.'}
  if (-not (Select-String -Path (Join-Path $stage 'public\index.html') -Pattern 'guest-share-dialog' -Quiet)) {throw 'Wrong editor release downloaded: guest share UI missing.'}
  if (-not (Select-String -Path (Join-Path $stage 'public\index.html') -Pattern 'v1.3.12' -SimpleMatch -Quiet)) {throw 'Wrong editor release downloaded: version marker missing.'}
  Note 'New files downloaded and validated'
  # Never stop or alter unrelated Node instances.
  $pidFile = Join-Path $private 'server-pid.txt'
  if (Test-Path $pidFile) {
   $existing = (Get-Content -LiteralPath $pidFile -Raw).Trim()
   if ($existing -match '^\d+$' -and (StudioProcess ([int]$existing))) {
    Note "Stopping old Studio Editor process $existing"
    Stop-Process -Id ([int]$existing) -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 600
   }
   Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  }
  $port = Get-NetTCPConnection -LocalPort 8050 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($port) {throw "Port 8050 is already occupied by process $($port.OwningProcess). Not touching another program."}
  New-Item -ItemType Directory -Path $dest,$private -Force | Out-Null
  foreach ($relative in $files) {
   $from = Join-Path $stage ($relative.Replace('/',[IO.Path]::DirectorySeparatorChar))
   $to = Join-Path $dest ($relative.Replace('/',[IO.Path]::DirectorySeparatorChar))
   New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force | Out-Null
   Copy-Item -LiteralPath $from -Destination $to -Force
  }
  Set-Content -LiteralPath (Join-Path $dest 'installed-version.txt') -Value $version -Encoding ascii
  Note 'Editor installed. Previous projects and uploaded media are preserved.'
  Note "Installed release $version into $dest; verify version marker on Project tab."
 } finally {Remove-Item -LiteralPath $stage -Force -Recurse -ErrorAction SilentlyContinue}
 # Create a familiar desktop shortcut; no admin/elevation needed.
 $desktop = [Environment]::GetFolderPath('Desktop')
 if ($desktop) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut((Join-Path $desktop 'Studio Editor.lnk'))
  $shortcut.TargetPath = (Join-Path $dest 'windows\start-hidden.vbs')
  $shortcut.WorkingDirectory = $dest
  $shortcut.Description = 'Open Studio Editor (local free video editor)'
  $shortcut.Save()
  Note 'Desktop shortcut created: Studio Editor'
 }
 # Restart the editor automatically when this Windows user signs in.
 $startup = [Environment]::GetFolderPath('Startup')
 if ($startup) {
  $shell = New-Object -ComObject WScript.Shell
  $autostart = $shell.CreateShortcut((Join-Path $startup 'Studio Editor Background.lnk'))
  $autostart.TargetPath = 'powershell.exe'
  $autostart.Arguments = ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $dest 'windows\start-hidden.ps1') + '"')
  $autostart.WorkingDirectory = $dest
  $autostart.WindowStyle = 7
  $autostart.Description = 'Launch Studio Editor background server when Windows signs in'
  $autostart.Save()
  Note 'Editor will automatically restart after Windows login.'
 }
 $ffmpeg = Find-Program 'ffmpeg.exe' @("$dest\bin\ffmpeg.exe")
 $ffprobe = Find-Program 'ffprobe.exe' @("$dest\bin\ffprobe.exe")
 if ($ffmpeg -and $ffprobe) {Note 'FFmpeg and FFprobe found. MP4 export available.'}
 else {Note 'WARNING: FFmpeg/FFprobe not found in PATH. Editor can open, but exporting MP4 requires FFmpeg.'}
 # Install/update TTS for the exact local interpreter, including Python 3.9.
 $pythonCandidates = @(
  "$env:LOCALAPPDATA\\Programs\\Python\\Python314\\python.exe",
  "$env:LOCALAPPDATA\\Programs\\Python\\Python313\\python.exe",
  "$env:LOCALAPPDATA\\Programs\\Python\\Python312\\python.exe",
  "$env:LOCALAPPDATA\\Programs\\Python\\Python311\\python.exe",
  "$env:LOCALAPPDATA\\Programs\\Python\\Python310\\python.exe",
  "$env:LOCALAPPDATA\\Programs\\Python\\Python39\\python.exe"
 )
 # Prefer known real installations over a Windows Store shim in PATH.
 $python = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
 if (-not $python) { $python = Find-Program 'python.exe' @() }
 if ($python) {
  Note "Preparing Edge TTS with Python interpreter: $python"
  try {
   & $python -m pip install --user --disable-pip-version-check --upgrade 'edge-tts==7.3.1' 2>&1 |
    ForEach-Object { Note "TTS: $_" }
   if ($LASTEXITCODE -ne 0) { Note "WARNING: TTS setup exit code $LASTEXITCODE; see install log." }
   else { Note 'TTS package verified/updated; selector event-loop bridge installed.' }
  } catch { Note "WARNING: TTS install failed: $($_.Exception.Message)" }
 } else {
  Note 'WARNING: Python was not detected. TTS preview will require manual repair.'
 }
 # Optional free/offline CPU speech-to-text: model downloads only on first use.
 if ($python) {
  try {
   Note 'Preparing optional CPU Whisper STT engine (may require additional download)'
   & $python -m pip install --user --disable-pip-version-check 'faster-whisper>=1.0,<2' 2>&1 |
    ForEach-Object { Note "STT: $_" }
   if ($LASTEXITCODE -ne 0) { Note 'WARNING: STT package setup incomplete. AI/editing remain available.' }
  } catch { Note "WARNING: STT package setup skipped: $($_.Exception.Message)" }
 }
 # Private Tailscale Serve setup is best-effort; do not replace 443/8443.
 if (-not $NoPhone) {
  $tailscale = Find-Program 'tailscale.exe' @("$env:ProgramFiles\Tailscale\tailscale.exe")
  if ($tailscale) {
   try {
    Note 'Connecting private Tailscale phone endpoint on HTTPS port 10000'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dest 'windows\enable-phone.ps1') 2>&1 | ForEach-Object { Note "Tailscale: $_" }
    if ($LASTEXITCODE -ne 0) {Note 'Tailscale phone setup did not finish. Local editor still works.'}
   } catch {Note "Tailscale setup skipped: $($_.Exception.Message)"}
  } else {Note 'Tailscale not found. Local editor is still available.'}
 }
 Note 'Starting Studio Editor (hidden background, no black CMD window)'
 & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dest 'windows\start-hidden.ps1')
 if ($LASTEXITCODE -ne 0) {throw 'Studio Editor start failed; inspect private/server-error.log.'}
 Start-Sleep -Milliseconds 1100
 $live = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8050/app' -TimeoutSec 10
 if ($live.StatusCode -ne 200 -or -not $live.Content.Contains($version) -or $live.Content -notmatch 'guest-share-dialog') {throw 'Update was installed but running editor is still an older version. Check server-pid.txt and port 8050 before sharing.'}
 Note "Verified running editor release $version at port 8050"
 Start-Process 'http://127.0.0.1:8050/app?build=1312'
 $hostFile = Join-Path $private 'mobile-host.txt'
 if (Test-Path $hostFile) {
  $dns = (Get-Content -LiteralPath $hostFile -Raw).Trim()
  Note "MOBILE URL: https://$($dns):10000/app"
 }
 Note 'COMPLETE. Future launches: Desktop > Studio Editor. Updates: run this same installer again.'
} catch {
 Note "ERROR: $($_.Exception.Message)"
 Note "Check installation log: $log"
 throw
}
