# obs-inject.ps1
# Injects a Browser Source pointing at chat-overlay.html into the OBS scene file.
# Idempotent: if the source already exists, it is updated, not duplicated.

param(
    [Parameter(Mandatory=$true)][string]$SceneFile,
    [Parameter(Mandatory=$true)][string]$HtmlPath
)

$ErrorActionPreference = "Stop"

# Convert to absolute file:// URL
$abs = [System.IO.Path]::GetFullPath($HtmlPath)
$fileUrl = ([System.Uri]$abs).AbsoluteUri

Write-Host "  Scene file : $SceneFile"
Write-Host "  Overlay URL: $fileUrl"

if (-not (Test-Path $SceneFile)) {
    Write-Host "  [SKIP] Scene file does not exist yet. Open OBS once to create it, then run this again." -ForegroundColor Yellow
    exit 0
}

$json = Get-Content $SceneFile -Raw -Encoding UTF8 | ConvertFrom-Json

# Find the Scene source (scene container)
$sceneSource = $json.sources | Where-Object { $_.id -eq "scene" } | Select-Object -First 1
if (-not $sceneSource) {
    Write-Host "  [WARN] No scene container found in file. Aborting." -ForegroundColor Yellow
    exit 0
}

# Ensure Scene items array exists
if (-not $sceneSource.settings.id_counter)  { $sceneSource.settings | Add-Member -NotePropertyName "id_counter"  -NotePropertyValue 0 -Force }
if (-not $sceneSource.settings.custom_size) { $sceneSource.settings | Add-Member -NotePropertyName "custom_size" -NotePropertyValue $false -Force }
if (-not $sceneSource.settings.items)        { $sceneSource.settings | Add-Member -NotePropertyName "items"        -NotePropertyValue @()  -Force }

# 1) Make sure the top-level source definition exists
$overlaySource = $json.sources | Where-Object { $_.name -eq "Cricket Overlay" } | Select-Object -First 1
$newUuid = [guid]::NewGuid().ToString()
if ($overlaySource) {
    Write-Host "  [UPDATE] Updating existing 'Cricket Overlay' source definition" -ForegroundColor Cyan
    $overlaySource.settings.url                  = $fileUrl
    $overlaySource.settings.width                = 1920
    $overlaySource.settings.height               = 1080
    $overlaySource.settings.                fps                 = 60
    $overlaySource.settings.shutdown             = $false
    $overlaySource.settings.restart_when_active  = $true
    $overlaySource.settings.custom_css           = ""
    $overlaySource.settings.css                  = ""
    $overlaySource.settings.reroute_audio        = $false
    $overlaySource.settings.persist             = $true
} else {
    Write-Host "  [ADD] Creating 'Cricket Overlay' browser source" -ForegroundColor Green
    $overlaySource = [PSCustomObject]@{
        prev_ver      = 536936450
        name          = "Cricket Overlay"
        uuid          = $newUuid
        id            = "browser_source"
        versioned_id  = "obs-browser"
        settings      = [PSCustomObject]@{
            url                 = $fileUrl
            width               = 1920
            height              = 1080
            fps                 = 60
            shutdown            = $false
            restart_when_active = $true
            css                 = ""
            custom_css          = ""
            reroute_audio       = $false
            persist             = $true
        }
        mixers        = 0
        sync          = 0
        flags         = 0
        volume        = 1.0
        balance       = 0.5
        enabled       = $true
        muted         = $false
        "push-to-mute"= $false
        "push-to-mute-delay" = 0
        "push-to-talk"= $false
        "push-to-talk-delay" = 0
        hotkeys       = @{}
        deinterlace_mode = 0
        deinterlace_field_order = 0
        monitoring_type = 0
        private_settings = @{}
    }
    $json.sources = @($json.sources) + @($overlaySource)
}

# 2) Add the item reference to the Scene if missing
$existingItem = $sceneSource.settings.items | Where-Object { $_.name -eq "Cricket Overlay" } | Select-Object -First 1
$newId = $sceneSource.settings.id_counter + 1
if ($existingItem) {
    Write-Host "  [OK] Scene item already references the source" -ForegroundColor DarkGray
} else {
    Write-Host "  [ADD] Referencing 'Cricket Overlay' in Scene items" -ForegroundColor Green
    $item = [PSCustomObject]@{
        name             = "Cricket Overlay"
        sourceName       = "Cricket Overlay"
        pos              = [PSCustomObject]@{ x = 0.0; y = 0.0 }
        scale            = [PSCustomObject]@{ x = 1.0; y = 1.0 }
        align            = 5
        rot              = 0.0
        visible          = $true
        locked           = $false
        group_item_backup = $false
        blend_type       = "default"
        blend_method     = "default"
        show_transition  = [PSCustomObject]@{ duration = 0 }
        hide_transition  = [PSCustomObject]@{ duration = 0 }
        scale_filter     = "disable"
        private_settings = @{}
        id               = $newId
        bounds_type      = "OBS_BOUNDS_NONE"
        bounds           = [PSCustomObject]@{ x = 0.0; y = 0.0 }
        bounds_align     = 0
        crop_top         = 0
        crop_bottom      = 0
        crop_left        = 0
        crop_right       = 0
        id_counter       = $newId
        group_item_backup_type = ""
        parent_group_item_id   = $null
    }
    $sceneSource.settings.items = @($sceneSource.settings.items) + @($item)
    $sceneSource.settings.id_counter = $newId
}

# Serialize
$outJson = $json | ConvertTo-Json -Depth 100
$outJson = $outJson -replace "`r`n", "`n"
[System.IO.File]::WriteAllText($SceneFile, $outJson, [System.Text.UTF8Encoding]::new($false))

Write-Host "  [OK] Scene file updated: $SceneFile" -ForegroundColor Green
Write-Host "  Tip: in OBS, click the Scene and press Ctrl+R to refresh, or right-click the source -> Refresh." -ForegroundColor DarkGray
