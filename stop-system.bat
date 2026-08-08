@echo off
title Cricket Overlay - System Stop
cd /d "%~dp0"
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'guardian|live-score-poller|yt-chat-server' } | ForEach-Object { Write-Host ('Killing PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force }"
echo.
echo  Guardians + poller + chat server stopped.
