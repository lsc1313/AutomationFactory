@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 20+ first & pause & exit /b 1)
echo.
echo Revenue Factory local customer app
 echo Open http://127.0.0.1:8040/app in your browser.
echo First launch: create an administrator account in the app.
echo.
node app.mjs
pause