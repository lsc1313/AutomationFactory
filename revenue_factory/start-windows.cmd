@echo off
chcp 65001 >nul
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 20 이상을 설치해주세요: https://nodejs.org/
  pause
  exit /b 1
)
echo Revenue Factory 로컬 서버를 시작합니다.
echo http://127.0.0.1:8038
node revenue_factory/server.mjs
pause