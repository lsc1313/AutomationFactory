@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 20+ first & pause & exit /b 1)
echo.
if not defined REVENUE_SHORTSAI_HOME (
  if exist "%~dp0..\..\ShortsAI_CLEAN\modules\shopping\director.js" set "REVENUE_SHORTSAI_HOME=%~dp0..\..\ShortsAI_CLEAN"
  if exist "%USERPROFILE%\ShortsAI_CLEAN\modules\shopping\director.js" set "REVENUE_SHORTSAI_HOME=%USERPROFILE%\ShortsAI_CLEAN"
)
echo Revenue Factory local customer app
echo ShortsAI home: %REVENUE_SHORTSAI_HOME%
 echo Open http://127.0.0.1:8040/app in your browser.
echo First launch: create an administrator account in the app.
echo.
node app.mjs
pause