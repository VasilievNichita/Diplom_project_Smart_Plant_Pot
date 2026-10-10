@echo off
cd /d "%~dp0site"
where node >nul 2>nul
if %errorlevel% equ 0 (
  node scripts\serve.mjs
) else (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\serve.mjs
  ) else (
    echo Install Node.js 20 or newer, then run this file again.
    pause
  )
)
