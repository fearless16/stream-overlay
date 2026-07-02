@echo off
title Cricket Overlay - Start
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "start.ps1" start
pause
