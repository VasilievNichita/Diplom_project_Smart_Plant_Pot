@echo off
if not exist "%~dp0.venv\Scripts\python.exe" (
  echo Local ML environment is missing. Follow ml/README.md.
  exit /b 1
)
"%~dp0.venv\Scripts\python.exe" "%~dp0run.py" %*
