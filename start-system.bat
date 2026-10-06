@echo off
title Cricket Overlay - System Start
cd /d "%~dp0"

echo.
echo ===================================================
echo   Cricket Overlay System Starter
echo ===================================================
echo.
echo Do you want to start Multi-Stream (Twitch/Kick)? (y/n)
set /p multistream_choice="> "

if /i "%multistream_choice%"=="y" (
    echo [INFO] Starting MultiStream Manager...
    start "MultiStream Manager" cmd /k "npm run multistream"
    echo [INFO] Launching OBS Multistream trigger...
    start "OBS Multistream Trigger" cmd /c "node start-multistream-obs.js"
)

echo [INFO] Starting Guardians...
start "Chat Server (guardian.js)" cmd /k "node guardian.js"
start "Score Poller (guardian-score.js)" cmd /k "node guardian-score.js"
start "Hockey Poller (hockey-guardian.js)" cmd /k "node hockey-guardian.js"
start "YouTube Sentinel Bot" cmd /k "node youtube-bot\bot.js"

echo.
echo  All guardians started in their own windows:
echo   - Chat Server   (yt-chat-server.js,  WS 8765/8766)
echo   - Score Poller  (live-score-poller.js)
echo   - Hockey Poller (hockey-score-poller.js, WS 8790)
echo   - YouTube Sentinel Bot (youtube-bot/bot.js)
if /i "%multistream_choice%"=="y" (
    echo   - MultiStream Manager (Twitch, Kick, etc.)
    echo   - OBS Auto-Start Trigger (Waiting for OBS)
)
echo.
echo  OBS apne shortcut se launch karo (obs64.exe --use-fake-ui-for-media-stream).
echo  Band karne ke liye windows band karo ya stop-system.bat chalay.
