# STICKER FX — "DISGUSTING" fullscreen moment

A self-contained fullscreen animation that fires when a viewer sends the
`DISGUSTING` channel custom emoji (`:disgusting:` / `:disguxting:`) in YouTube
Live Chat.

It animates the **actual sticker artwork** (1254×1254, transparent PNG) across
the whole 1920×1080 overlay: a molten hellgate backdrop, slam-in with heat
ring + impact flash, drifting embers, and the sender's name in fire-gold.

```
sticker-fx/
├─ sticker-fx.css        scoped styles + keyframes (all prefixed `sfx-`)
├─ sticker-fx.js         trigger detection, stage lock, particle canvas
├─ preview.html          standalone harness (open in Chrome, no server needed)
├─ assets/
│  ├─ disgusting.png       transparent sticker (source for the animation)
│  └─ disgusting-glow.png  pre-blurred aura (no runtime blur filter)
└─ tools/
   └─ prepare-assets.py  regenerates both PNGs from the original JPEG
```

Wired into `chat-overlay.html` with exactly two lines:

```html
<link rel="stylesheet" href="sticker-fx/sticker-fx.css">
<script src="sticker-fx/sticker-fx.js"></script>
```

## Trigger contract

`sticker-fx.js` exposes `window.StickerFX`:

| method | purpose |
| --- | --- |
| `handleChat(message)` | called for every live `youtube-chat` WebSocket message |
| `play({ name, amount, source })` | force a performance (manual testing) |
| `stop(reason)` | abort instantly (Escape also does this) |
| `isBusy()` | `true` while the fullscreen stage is claimed |
| `status()` | diagnostics snapshot (frames, long frames, cooldown) |
| `configure({ triggers, duration, cooldown })` | retune without editing code |

Matching (case-insensitive substring) checks, in order:

1. `segments[].value` — e.g. `:disguxting:`
2. `segments[].emojiId` — e.g. `UCxxxx/disguxting` (added in `yt-chat-server.js`)
3. `segments[].name` / `segments[].shortcut`
4. raw `message.text` fallback — only for a colon-delimited shortcut such as
   `:disguxting:` (plain prose like "that was disgusting" never triggers it)

Default triggers: `disgusting`, `disguxting`. To rename the emoji:

```js
StickerFX.configure({ triggers: ['disgusting', 'disguxting', 'new-emoji'] });
```

History replays are ignored (`isHistory`), and every YouTube message id is
de-duplicated, so an OBS refresh or WS reconnect never re-fires the moment.

## No-overlap guarantee

The module owns a single fullscreen stage and enforces exclusivity both ways:

- On start it pre-empts the transient fullscreen overlays (`like`,
  `member-join`, `new-user`). The like overlay is dismissed through its own
  `dismissLikeAnimation(true)` so its canvas rAF is cancelled correctly.
- `triggerLikeAnimation`, `triggerMemberJoin` and `showNewUserAlert` return
  early while `StickerFX.isBusy()` is true.
- While BRB is active the moment is skipped — BRB is an operator state, not an
  animation, and must stay visible.
- If a second sticker arrives mid-performance it is queued (one max, latest
  wins) and starts after a 1.4 s anti-spam cooldown.
- Turning BRB on mid-performance stops the sticker immediately (MutationObserver).

Nothing else in `chat-overlay.html` changes.

## Performance contract

Built for a 24/7 OBS browser source:

- Idle cost is zero: `#sfx-root { display: none }` — no layers, no rAF, no timers.
- Only `transform` and `opacity` animate; no animated filters, no shadows, no
  layout/paint animation.
- The aura is a pre-blurred PNG, not a CSS `blur()`.
- Embers use one 1920×1080 canvas, a fixed 280-object pool, three pre-rendered
  glow sprites, and `requestAnimationFrame` with delta-time clamping. No DOM
  particles, no per-frame allocations, no `setTimeout` per particle.
- Canvas work is skipped while the document is hidden; audio/encoder untouched.
- Every timer/rAF is cleared in `finish()`, and the canvas is cleared.

## Manual verification

1. Open `sticker-fx/preview.html` in Chrome (works over `file://`).
2. Press **Play**. Check: no white fringe, smooth slam, 60 fps, caption fits.
3. Press **Like overlay → Play** — the like layer must vanish instantly.
4. Turn **BRB on → Play** — nothing must play.
5. In OBS, add `?sticker=test` to the Browser Source URL to auto-play 1.2 s
   after load, or run in the Browser Source console:

```js
StickerFX.play({ name: 'TestViewer' })
StickerFX.status()
```

6. Emoji end-to-end: send `:disguxting:` in chat with the chat server running;
   the WS message path calls `handleChat` automatically. `?stickerDebug=1` logs
   match/queue/skip decisions to the console.

## Tuning

- Duration: `StickerFX.configure({ duration: 6200 })` (min 2500 ms).
- Cooldown: `StickerFX.configure({ cooldown: 3000 })`.
- Size: `--sfx-size` in `sticker-fx.css` (default `min(66vh, 58vw)`).
- Palette: `--sfx-orange`, `--sfx-red`, `--sfx-gold` on `#sfx-root`.

## Asset regeneration

`tools/prepare-assets.py` removes the flat background with a border flood fill
(so white teeth/highlights inside the artwork survive), trims the die-cut white
edge, and generates the pre-blurred aura:

```bash
python sticker-fx/tools/prepare-assets.py "C:/Users/user/Downloads/disguxting.jpeg"
```

## Rollback

Remove the two link/script lines from `chat-overlay.html` and delete
`sticker-fx/`. The three `isBusy()` guards become inert when the module is
missing, so no other code needs to change.

## Limits

- The trigger is intentionally name-based; YouTube does not label custom emoji
  with a stable human name beyond the shortcut/emojiId. If the channel emoji is
  renamed, update `triggers`.
- The local PNG is shown instead of the 88px YouTube emoji URL on purpose —
  the emoji image is far too small for fullscreen use.
