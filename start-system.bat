@echo off
title Cricket Overlay - System Start
cd /d "%~dp0"
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
echo  OBS apne shortcut se launch karo (obs64.exe --use-fake-ui-for-media-stream).
echo  Band karne ke liye windows band karo ya stop-system.bat chalay.
