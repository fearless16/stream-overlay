@echo off
title Cricket Overlay - Controller
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "start.ps1" menu
