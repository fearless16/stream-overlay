# One-command offline integration test. Starts the opt-in fake feed, verifies
# the real overlay receives score + chat, runs contracts, then cleans up.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$MockPort = 8770
$mock = $null
$oldFakeChat = $env:ALLOW_FAKE_CHAT

function Test-Port([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

try {
    if (Test-Port $MockPort) { throw "Port $MockPort is already in use." }
    if (-not (Test-Path 'logs')) { New-Item -ItemType Directory -Path 'logs' | Out-Null }

    $env:ALLOW_FAKE_CHAT = '1'
    $mock = Start-Process -FilePath 'node' -ArgumentList 'mock-server.js' -WorkingDirectory $Root `
        -RedirectStandardOutput (Join-Path $Root 'logs\local-mock.out.log') `
        -RedirectStandardError (Join-Path $Root 'logs\local-mock.err.log') -WindowStyle Hidden -PassThru

    for ($i = 0; $i -lt 30 -and -not (Test-Port $MockPort); $i++) { Start-Sleep -Milliseconds 200 }
    if (-not (Test-Port $MockPort)) { throw "Mock server did not bind ws://localhost:$MockPort." }

    Write-Host '[1/3] Fake server running' -ForegroundColor Green
    $env:MOCK_WS_URL = "ws://localhost:$MockPort"
    node test-local-smoke.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Overlay-to-mock smoke test failed.' }

    Write-Host '[2/3] Parser contracts' -ForegroundColor Cyan
    node test-parser.js
    if ($LASTEXITCODE -ne 0) { throw 'Parser tests failed.' }

    Write-Host '[3/3] Browser contracts' -ForegroundColor Cyan
    node test-scorecard-details.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Browser contract tests failed.' }
    Write-Host "`nLOCAL TEST PASSED: fake server + overlay + scorecard + chat" -ForegroundColor Green
} finally {
    if ($mock -and -not $mock.HasExited) { Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue }
    if ($null -eq $oldFakeChat) { Remove-Item Env:ALLOW_FAKE_CHAT -ErrorAction SilentlyContinue }
    else { $env:ALLOW_FAKE_CHAT = $oldFakeChat }
    Remove-Item Env:MOCK_WS_URL -ErrorAction SilentlyContinue
}
