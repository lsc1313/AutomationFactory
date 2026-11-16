$ErrorActionPreference = 'Stop'
$startup = [Environment]::GetFolderPath('Startup')
$link = Join-Path $startup 'Revenue Factory.lnk'
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($link)
$shortcut.TargetPath = (Join-Path $env:WINDIR 'System32\wscript.exe')
$shortcut.Arguments = '"' + (Join-Path $PSScriptRoot 'start-app-silent.vbs') + '"'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = 'Start Revenue Factory in background after Windows sign-in'
$shortcut.Save()
Write-Output "Installed startup shortcut: $link"
