@echo off
title PWA Motion Capture Server
cd /d "%~dp0"
echo Starting PWA Motion Capture HTTPS Server...
python serve_https.py
pause
