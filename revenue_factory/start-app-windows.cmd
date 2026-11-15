@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 20+ is required & pause & exit /b 1)
if "%REVENUE_ADMIN_EMAIL%"=="" (
 echo REVENUE_ADMIN_EMAIL environment variable is missing.
 echo Configure .env for your terminal - see README-PRODUCTION.md
 pause
 exit /b 1
)
node app.mjs
pause