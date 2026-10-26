@echo off
setlocal
cd /d "%~dp0.."
if not exist "theme_factory\.local" mkdir "theme_factory\.local"
set "REPORT=theme_factory\.local\pc-diagnostics.json"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "theme_factory\adapters\preflight.py" > "%REPORT%"
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo Python not found. Install Python or use cloud generation.
    pause
    exit /b 1
  )
  python "theme_factory\adapters\preflight.py" > "%REPORT%"
)
if errorlevel 1 (
  echo Diagnostic failed. Check Python installation.
  pause
  exit /b 1
)
echo.
echo === Theme Factory PC Diagnostics ===
type "%REPORT%"
echo.
echo Saved: %CD%\%REPORT%
echo.
pause
