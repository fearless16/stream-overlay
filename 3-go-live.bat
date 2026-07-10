@echo off
title Cricket With Prajjwal - GO LIVE
cd /d "%~dp0"

:: Step 0: Optimize Windows settings (no reboot needed)
powershell -ExecutionPolicy Bypass -NoProfile -File "optimize-windows.ps1"
echo.

:: Step 1: Launch OBS, inject overlay, apply optimized settings
powershell -ExecutionPolicy Bypass -NoProfile -File "start.ps1" go-live
pause
