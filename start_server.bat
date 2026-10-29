@echo off
title PWA Motion Capture Server
cd /d "%~dp0"
echo Starting PWA Motion Capture HTTPS Server...
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 serve_https.py
) else (
  python serve_https.py
)
pause
