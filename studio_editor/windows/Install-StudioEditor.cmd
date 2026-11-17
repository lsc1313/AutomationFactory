@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop';[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $p=Join-Path $env:TEMP 'StudioEditor-oneclick.ps1';Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/lsc1313/AutomationFactory/feature/standalone-studio-editor-v0-1/studio_editor/windows/install-oneclick.ps1' -OutFile $p; & $p"
if errorlevel 1 (
 echo.
 echo Installation failed. Check %%TEMP%%\StudioEditor-install.log
 pause
)