# Cricket With Prajjwal — Stream Overlay

YouTube Live chat + cricket score overlay wired into OBS Studio. The chat
server bridges YouTube's API to a local WebSocket; OBS loads the HTML
overlay as a Browser Source.

## Quick start (Windows)

1. Double-click **`3-go-live.bat`**.
2. OBS opens (or refresh) — the **Cricket Overlay** source is wired in.

That's it. The script:
- starts the chat server (mock by default — switch to real with option `3`)
- enables OBS WebSocket if needed
- injects the browser source live (no OBS restart required)
- opens a preview in your default browser

## Entry points

| File | What it does |
|------|--------------|
| `3-go-live.bat` | Start server + OBS + inject source + open preview (the only one you need) |
| `1-start.bat` | Start the chat server only |
| `2-stop.bat` | Stop the chat server |
| `controller.bat` | Interactive menu (start/stop/switch-mode/launch-obs/...) |
| `start.ps1` | The PowerShell that the .bat files call |

## Modes

Set in `.env` (`MODE=mock` or `MODE=real`). Switch any time with option `3` in the menu.

- **mock** — fake chat messages on a timer. No YouTube account required. Good for testing the overlay.
- **real** — polls the YouTube live chat via the Data API v3 (`YOUTUBE_API_KEY`) and broadcasts to the overlay.

## Real-mode setup

1. Get a YouTube Data API v3 key: https://console.cloud.google.com/apis/credentials
2. Set `MODE=real` in `.env`
3. Set `VIDEO_ID` to the **currently-live** stream's ID (the part after `?v=` in the URL)
4. Start. The chat appears in the overlay within ~5s of being posted.

## Files

```
.env                         - mode + keys
chat-overlay.html            - the overlay (75KB, self-contained)
yt-chat-server.js            - real YouTube chat bridge
mock-server.js               - fake chat for testing
live-score-poller.js         - optional cricket score from crex.com
obs-connect.js               - injects the browser source into OBS via WebSocket v5
obs-inject.ps1               - fallback: writes the source into the scene JSON directly
start.ps1                    - the controller
1-start.bat / 2-stop.bat / 3-go-live.bat / controller.bat  - Windows entry points
stream.sh                    - macOS/Linux menu (legacy)
```

## OBS layer order

Put the **Cricket Overlay** source **above** your camera/capture sources.
The center of the overlay is transparent — let the game feed show through.

## Keyboard shortcuts (in the overlay)

- `Ctrl+1` — toggle scorecard
- `Ctrl+2` — toggle controls panel
- `Ctrl+3` — clear chat
- `Esc` — dismiss the popped comment
