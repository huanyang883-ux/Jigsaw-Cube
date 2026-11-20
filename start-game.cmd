@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or later, then try again.
  pause
  exit /b 1
)
call npm ls --depth=0 >nul 2>nul
if errorlevel 1 (
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm run build
if errorlevel 1 (
  pause
  exit /b 1
)
node scripts/serve.mjs --release --open
if errorlevel 1 pause
