# Temporary phone-only guest testing (no Tailscale required by invited friends).
# Starts a completely separate Studio server + Cloudflare Quick Tunnel.
# The owner Studio (8050) and its projects are never forwarded.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$local = $env:LOCALAPPDATA
if (-not $local -or -not (Test-Path -LiteralPath (Join-Path $root 'server.mjs'))) { throw 'Studio Editor v1.3 must be installed first.' }
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$node = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:ProgramFiles 'nodejs\node.exe' }
if (-not (Test-Path -LiteralPath $node)) { throw 'Node.js is required.' }
$bin = Join-Path $root 'bin'
$cloudflared = Join-Path $bin 'cloudflared.exe'
if (-not (Test-Path -LiteralPath $cloudflared)) {
 New-Item -ItemType Directory -Path $bin -Force | Out-Null
 Write-Host 'Downloading official Cloudflare tunnel executable for temporary guest access...'
 [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
 Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $cloudflared -TimeoutSec 120
 if ((Get-Item -LiteralPath $cloudflared).Length -lt 5000000) { throw 'cloudflared download is incomplete.' }
}
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$sha = [Security.Cryptography.SHA256]::Create()
$hash = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($token)) | ForEach-Object { $_.ToString('x2') })
$guestId = [guid]::NewGuid().ToString('N')
$guestDir = Join-Path $local ('StudioEditor-GuestSessions\' + $guestId)
$ownerPrivate = Join-Path $root 'private'
$statusPath = Join-Path $ownerPrivate 'guest-preview.json'
$progressPath = Join-Path $ownerPrivate 'guest-progress.json'
function Set-GuestProgress([string]$phase, [string]$message) {
 try {
  $record = @{phase=$phase;message=$message;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
  [IO.File]::WriteAllText($progressPath,($record | ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
 }catch{}
}
$revokedFile = Join-Path $guestDir 'revoked'
$stdout = Join-Path $guestDir 'server.log'
$stderr = Join-Path $guestDir 'server-error.log'
$tunnelLog = Join-Path $guestDir 'tunnel.log'
$tunnelOut = Join-Path $guestDir 'tunnel-out.log'
New-Item -ItemType Directory -Force -Path $guestDir,$ownerPrivate | Out-Null
$end = [DateTimeOffset]::UtcNow.AddHours(2)
$nodeProcess = $null
$tunnelProcess = $null
$old = @{}
$vars = @{
 STUDIO_GUEST_MODE='1'
 STUDIO_GUEST_TOKEN_HASH=$hash
 STUDIO_GUEST_EXPIRES_AT=[string]$end.ToUnixTimeMilliseconds()
 STUDIO_GUEST_STOP_FILE=$revokedFile
 STUDIO_GUEST_AI_CONFIG_PATH=(Join-Path $ownerPrivate 'ai-config.json')
 STUDIO_TRUST_PROXY='1'
 STUDIO_DATA_DIR=$guestDir
 STUDIO_PORT='8060'
}
try {
 Set-GuestProgress 'starting' '지인 전용 서버를 준비하고 있습니다.'
 foreach ($key in $vars.Keys) {
  $old[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
  [Environment]::SetEnvironmentVariable($key,$vars[$key],'Process')
 }
 $nodeProcess = Start-Process -FilePath $node -ArgumentList @('server.mjs') -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
 foreach ($key in $vars.Keys) { [Environment]::SetEnvironmentVariable($key,$old[$key],'Process') }
 Start-Sleep -Seconds 2
 if ($nodeProcess.HasExited) { throw 'Guest editor failed to start. Inspect: ' + $stderr }
 Set-GuestProgress 'tunnel' '외부 체험 연결을 생성하고 있습니다.'
 $tunnelProcess = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel','--no-autoupdate','--url','http://127.0.0.1:8060') -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardError $tunnelLog -RedirectStandardOutput $tunnelOut
 $url = $null
 for($i=0;$i -lt 65;$i++){
  Start-Sleep -Seconds 1
  if ($tunnelProcess.HasExited) { throw 'Temporary tunnel stopped. Inspect: ' + $tunnelLog }
  if(Test-Path -LiteralPath $tunnelLog){
   $match = [regex]::Match((Get-Content -LiteralPath $tunnelLog -Raw), 'https://[a-z0-9-]+[.]trycloudflare[.]com')
   if($match.Success){$url=$match.Value;break}
  }
 }
 if(-not $url){ throw 'Could not obtain a share URL. Inspect: ' + $tunnelLog }
 $invite = $url.TrimEnd('/') + '/invite/' + $token
 $info = @{url=$invite;expires=$end.ToUnixTimeMilliseconds();guestId=$guestId;startedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
 [IO.File]::WriteAllText($statusPath,($info | ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
 Set-GuestProgress 'ready' '체험 링크가 준비되었습니다.'
 try { Set-Clipboard -Value $invite -ErrorAction Stop }catch{}
 Write-Host ''
 Write-Host '========================================================'
 Write-Host 'Studio Editor GUEST TEST LINK (2 HOURS ONLY)'
 Write-Host $invite
 Write-Host '========================================================'
 Write-Host 'Link copied to PC clipboard. Owner can also copy it on their phone'
 Write-Host 'through the Studio Editor top menu: [Guest test link].'
 Write-Host 'Friend needs NO Tailscale account or installation.'
 Write-Host 'One invite = one isolated temporary test workspace.'
 Write-Host 'Sharing this link grants access to that guest workspace.'
 Write-Host 'Do not close this window before guest testing is finished.'
 Write-Host 'To stop/revoke immediately: press ENTER, then close this window.'
 Write-Host ''
 while([DateTimeOffset]::UtcNow -lt $end -and -not (Test-Path -LiteralPath $revokedFile)){
  try {
   if([Console]::KeyAvailable){
    $pressed=[Console]::ReadKey($true)
    if($pressed.Key -eq 'Enter'){break}
   }
  }catch{}
  Start-Sleep -Milliseconds 800
 }
}catch{
 $reason = $_.Exception.Message
 $summary = if($reason -match 'cloudflared download|Downloading official|Invoke-WebRequest|download is incomplete'){'Cloudflare 연결 프로그램 다운로드에 실패했습니다. PC의 인터넷 연결과 보안 프로그램을 확인하세요.'} elseif($reason -match 'Guest editor failed|Guest editor|server-error'){'지인 전용 서버 실행에 실패했습니다. StudioEditor-GuestSessions 서버 오류 로그를 확인하세요.'} elseif($reason -match 'Temporary tunnel stopped|Could not obtain a share URL'){'Cloudflare 외부 연결을 만들지 못했습니다. PC의 방화벽 또는 인터넷 연결을 확인하세요.'}else{'체험 링크 연결 작업에 실패했습니다. PC의 private/guest-launch.log 파일을 확인하세요.'}
 Set-GuestProgress 'failed' $summary
 throw
}finally{
 foreach ($key in $vars.Keys) { [Environment]::SetEnvironmentVariable($key,$old[$key],'Process') }
 if($tunnelProcess -and -not $tunnelProcess.HasExited){Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue}
 if($nodeProcess -and -not $nodeProcess.HasExited){Stop-Process -Id $nodeProcess.Id -Force -ErrorAction SilentlyContinue}
 if(Test-Path -LiteralPath $statusPath) {
  try {
   $present = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
   if($present.guestId -eq $guestId){Remove-Item -LiteralPath $statusPath -Force}
  }catch{}
 }
 Write-Host 'Guest access has been stopped. Your original Studio Editor is unchanged.'
}
