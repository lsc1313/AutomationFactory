@echo off
setlocal
REM Install the exact release included in this ZIP. Do not download a moving branch.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-oneclick.ps1"
if errorlevel 1 (
 echo.
 echo Installation failed. Check %TEMP%\StudioEditor-install.log
 pause
)
