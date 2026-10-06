@echo off
title YouTube Chatbot
cd /d "%~dp0"

echo Running pre-flight health check...
node health_check.js
if %errorlevel% neq 0 (
    echo.
    echo HEALTH CHECK FAILED. Please fix the errors above before continuing.
    pause
    exit /b %errorlevel%
)

echo Starting Custom YouTube Chatbot...
node bot.js
pause
