# start.ps1 — one-click launcher for the Cricket overlay.
# Usage: powershell -ExecutionPolicy Bypass -NoProfile -File start.ps1 [start|stop|status|go-live|obs|preview|mode|menu]

param(
    [string]$Action = "menu"
)

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$OBS_EXE = "C:\Program Files\obs-studio\bin\64bit\obs64.exe"
$OBS_DIR = "C:\Program Files\obs-studio\bin\64bit"
$WS_PORT = 8765
$OBS_WS_PORT = 4455

# ── Helpers ──────────────────────────────────────────────────────────────────

function Read-Env {
    $env = @{}
    if (Test-Path ".env") {
        Get-Content ".env" | ForEach-Object {
            if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
                $key = $Matches[1].Trim()
                $val = $Matches[2].Trim()
                $env[$key] = $val
            }
        }
    }
    return $env
}

function Get-ServerPid {
    $conn = Get-NetTCPConnection -LocalPort $WS_PORT -State Listen -ErrorAction SilentlyContinue
    if ($conn) { return $conn.OwningProcess }
    return $null
}

function Get-ObsPid {
    $p = Get-Process obs64 -ErrorAction SilentlyContinue
    if ($p) { return @($p)[0].Id }
    return $null
}

function Stop-Server {
    $pid_ = Get-ServerPid
    if ($pid_) {
        Write-Host "  Stopping server PID $pid_..." -ForegroundColor Yellow
        Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 800
        Write-Host "  [OK] Server stopped" -ForegroundColor Green
    } else {
        Write-Host "  No server running on port $WS_PORT" -ForegroundColor DarkGray
    }
}

function Start-Server {
    Stop-Server
    if (-not (Test-Path "logs")) { New-Item -ItemType Directory -Path "logs" | Out-Null }
    $envVars = Read-Env
    $mode = if ($envVars["MODE"]) { $envVars["MODE"] } else { "mock" }
    Write-Host ""
    Write-Host "  Mode: $mode" -ForegroundColor Cyan
    $logFile = Join-Path $Root "logs\server.log"
    if ($mode -eq "real") {
        $script = "yt-chat-server.js"
        Write-Host "  Starting real YouTube chat server..." -ForegroundColor Cyan
    } else {
        $script = "mock-server.js"
        Write-Host "  Starting mock server (fake chat for testing)..." -ForegroundColor Cyan
    }
    $args = "/c", "node $script > `"$logFile`" 2>&1"
    $proc = Start-Process -FilePath "cmd.exe" -ArgumentList $args -WorkingDirectory $Root -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 2
    $listen = Get-NetTCPConnection -LocalPort $WS_PORT -State Listen -ErrorAction SilentlyContinue
    if ($listen) {
        Write-Host "  [OK] Server up on ws://localhost:$WS_PORT  (PID $($listen.OwningProcess))" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] Server did not bind port $WS_PORT" -ForegroundColor Red
        if (Test-Path $logFile) {
            Write-Host "  Last log lines:" -ForegroundColor Yellow
            Get-Content $logFile -Tail 8 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        }
    }
}

function Show-Status {
    Write-Host ""
    Write-Host "  === Status ===" -ForegroundColor Cyan
    $listen = Get-NetTCPConnection -LocalPort $WS_PORT -State Listen -ErrorAction SilentlyContinue
    if ($listen) {
        Write-Host "  [ON ] Server    : ws://localhost:$WS_PORT  (PID $($listen.OwningProcess))" -ForegroundColor Green
    } else {
        Write-Host "  [OFF] Server    : not running" -ForegroundColor Red
    }
    $obsId = Get-ObsPid
    if ($obsId) {
        Write-Host "  [ON ] OBS       : PID $obsId" -ForegroundColor Green
    } else {
        Write-Host "  [OFF] OBS       : not running" -ForegroundColor Red
    }
    $obsWs = Get-NetTCPConnection -LocalPort $OBS_WS_PORT -State Listen -ErrorAction SilentlyContinue
    if ($obsWs) {
        Write-Host "  [ON ] OBS-WS    : ws://localhost:$OBS_WS_PORT" -ForegroundColor Green
    } else {
        Write-Host "  [-- ] OBS-WS    : not listening" -ForegroundColor DarkGray
    }
    $envVars = Read-Env
    $mode = if ($envVars["MODE"]) { $envVars["MODE"] } else { "mock" }
    Write-Host "  [i  ] Mode      : $mode" -ForegroundColor DarkGray
    Write-Host ""
}

function Open-Preview {
    $url = "file:///" + ($Root -replace "\\","/") + "/chat-overlay.html"
    Write-Host "  Opening: $url" -ForegroundColor Cyan
    Start-Process $url
}

function Launch-OBS {
    if (-not (Test-Path $OBS_EXE)) {
        Write-Host "  [FAIL] OBS not found at $OBS_EXE" -ForegroundColor Red
        return
    }
    $obsId = Get-ObsPid
    if ($obsId) {
        Write-Host "  OBS is already running (PID $obsId)" -ForegroundColor DarkGray
        return
    }
    Write-Host "  Launching OBS..." -ForegroundColor Cyan
    # CRITICAL: launch from OBS's own directory so it finds data/locale files
    Start-Process -FilePath $OBS_EXE -WorkingDirectory $OBS_DIR
    Start-Sleep -Seconds 3
    $obsId = Get-ObsPid
    if ($obsId) {
        Write-Host "  [OK] OBS running (PID $obsId)" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] OBS not detected. Check it manually." -ForegroundColor Yellow
    }
}

function Enable-ObsWebSocket {
    $cfgPath = Join-Path $env:APPDATA "obs-studio\plugin_config\obs-websocket\config.json"
    if (-not (Test-Path $cfgPath)) {
        Write-Host "  [INFO] No OBS WebSocket config found (OBS will create on first launch)" -ForegroundColor DarkGray
        return
    }
    $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
    if ($cfg.server_enabled) {
        Write-Host "  WebSocket already enabled" -ForegroundColor DarkGray
        return
    }
    $cfg.server_enabled = $true
    $cfg | ConvertTo-Json -Depth 10 | Set-Content $cfgPath -Encoding UTF8
    Write-Host "  [OK] WebSocket enabled (restart OBS to apply)" -ForegroundColor Green
}

function Inject-ObsSource {
    $obsWs = Get-NetTCPConnection -LocalPort $OBS_WS_PORT -State Listen -ErrorAction SilentlyContinue
    if (-not $obsWs) {
        Write-Host "  [INFO] OBS WebSocket not running. Trying to enable it..." -ForegroundColor DarkGray
        Enable-ObsWebSocket
        $obsId = Get-ObsPid
        if ($obsId) {
            Write-Host "  [INFO] OBS is running. Restarting to pick up WebSocket config..." -ForegroundColor Yellow
            Stop-Process -Id $obsId -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }
        Launch-OBS
        # Wait for websocket to come up (up to 15s)
        for ($i = 0; $i -lt 15; $i++) {
            Start-Sleep -Seconds 1
            if (Get-NetTCPConnection -LocalPort $OBS_WS_PORT -State Listen -ErrorAction SilentlyContinue) { break }
        }
        $obsWs = Get-NetTCPConnection -LocalPort $OBS_WS_PORT -State Listen -ErrorAction SilentlyContinue
        if (-not $obsWs) {
            Write-Host "  [FAIL] OBS WebSocket did not start. Falling back to file-based inject." -ForegroundColor Red
            $sceneFile = Join-Path $env:APPDATA "obs-studio\basic\scenes\Untitled.json"
            & powershell -ExecutionPolicy Bypass -NoProfile -File (Join-Path $Root "obs-inject.ps1") -SceneFile $sceneFile -HtmlPath (Join-Path $Root "chat-overlay.html")
            return
        }
    }
    # Use websocket-based inject
    Write-Host "  Connecting to OBS WebSocket..." -ForegroundColor Cyan
    & node (Join-Path $Root "obs-connect.js")
}

function Show-Logs {
    $logFile = Join-Path $Root "logs\server.log"
    if (Test-Path $logFile) {
        Write-Host ""
        Write-Host "  === logs\server.log (last 30) ===" -ForegroundColor Cyan
        Get-Content $logFile -Tail 30 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    } else {
        Write-Host "  No logs yet. Start the server first." -ForegroundColor Yellow
    }
}

function Switch-Mode {
    $envFile = Join-Path $Root ".env"
    $envVars = Read-Env
    $current = if ($envVars["MODE"]) { $envVars["MODE"] } else { "mock" }
    $new = if ($current -eq "real") { "mock" } else { "real" }
    $content = Get-Content $envFile -Raw
    if ($content -match '(?m)^MODE=.*$') {
        $content = $content -replace '(?m)^MODE=.*$', "MODE=$new"
    } else {
        $content = "MODE=$new`n" + $content
    }
    [System.IO.File]::WriteAllText($envFile, $content, [System.Text.UTF8Encoding]::new($false))
    Write-Host "  Mode: $current -> $new" -ForegroundColor Green
    if ($new -eq "real") {
        Write-Host "  Make sure VIDEO_ID in .env is a CURRENTLY-LIVE YouTube stream." -ForegroundColor Yellow
    } else {
        Write-Host "  Mock mode = fake chat (works offline)." -ForegroundColor DarkGray
    }
}

function Go-Live {
    Write-Host ""
    Write-Host "  === One-shot go-live ===" -ForegroundColor Cyan
    Start-Server
    Start-Sleep -Milliseconds 500
    $obsId = Get-ObsPid
    if (-not $obsId) { Launch-OBS }
    Inject-ObsSource
    Start-Sleep -Milliseconds 500
    Open-Preview
    Write-Host ""
    Write-Host "  [OK] Done. Open OBS - the overlay is wired in." -ForegroundColor Green
    Write-Host "  Press Ctrl+1 in the overlay to toggle the scorecard." -ForegroundColor DarkGray
}

function Show-Menu {
    Show-Status
    Write-Host "  [1]  Start server"                -ForegroundColor Yellow
    Write-Host "  [2]  Stop server"                 -ForegroundColor Yellow
    Write-Host "  [3]  Switch mode (mock<->real)"  -ForegroundColor Yellow
    Write-Host "  [4]  Open preview in browser"     -ForegroundColor Yellow
    Write-Host "  [5]  Inject source into OBS"      -ForegroundColor Yellow
    Write-Host "  [6]  Launch OBS"                  -ForegroundColor Yellow
    Write-Host "  [7]  View live logs"              -ForegroundColor Yellow
    Write-Host "  [8]  One-shot GO-LIVE"            -ForegroundColor Magenta
    Write-Host "  [0]  Exit"                        -ForegroundColor Yellow
    Write-Host ""
    $choice = Read-Host "  Choose"
    switch ($choice) {
        "1" { Start-Server; pause; Show-Menu }
        "2" { Stop-Server; pause; Show-Menu }
        "3" { Switch-Mode; pause; Show-Menu }
        "4" { Open-Preview; pause; Show-Menu }
        "5" { Inject-ObsSource; pause; Show-Menu }
        "6" { Launch-OBS; pause; Show-Menu }
        "7" { Show-Logs; pause; Show-Menu }
        "8" { Go-Live; pause; Show-Menu }
        "0" { return }
        default { Show-Menu }
    }
}

switch ($Action) {
    "start"    { Start-Server }
    "stop"     { Stop-Server }
    "status"   { Show-Status }
    "preview"  { Open-Preview }
    "obs"      { Launch-OBS }
    "inject"   { Inject-ObsSource }
    "logs"     { Show-Logs }
    "mode"     { Switch-Mode }
    "go-live"  { Go-Live }
    "menu"     { Show-Menu }
    default    { Show-Menu }
}
