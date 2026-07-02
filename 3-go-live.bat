@echo off
title Cricket Overlay - GO LIVE
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "start.ps1" go-live
pause
