@echo off
setlocal

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

if "%~1"=="" (
  set "TARGET_URL=about:blank"
) else (
  set "TARGET_URL=%~1"
)

if not "%FIREFOX_EXE%"=="" goto have_firefox

set "FIREFOX_EXE=%ProgramFiles%\Mozilla Firefox\firefox.exe"
if exist "%FIREFOX_EXE%" goto have_firefox

set "FIREFOX_EXE=%ProgramFiles(x86)%\Mozilla Firefox\firefox.exe"
if exist "%FIREFOX_EXE%" goto have_firefox

set "FIREFOX_EXE=%LocalAppData%\Mozilla Firefox\firefox.exe"
if exist "%FIREFOX_EXE%" goto have_firefox

echo Firefox was not found.
echo Install Firefox, or set FIREFOX_EXE to firefox.exe before running this file.
pause
exit /b 1

:have_firefox
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js/npm is required to launch this temporary Firefox extension.
  echo Install Node.js from https://nodejs.org, then run this file again.
  pause
  exit /b 1
)

if not exist "%APP_DIR%node_modules\.bin\web-ext.cmd" (
  echo Installing launcher dependency...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo Launching Firefox with Fish Again Finder...
call "%APP_DIR%node_modules\.bin\web-ext.cmd" run --source-dir "%APP_DIR%" --firefox "%FIREFOX_EXE%" --url "%TARGET_URL%" --profile-create-if-missing --firefox-profile "%APP_DIR%.firefox-fish-again-profile"

pause
