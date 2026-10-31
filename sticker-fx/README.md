# STICKER FX — "DISGUSTING" fullscreen moment

A self-contained fullscreen animation that fires when a viewer sends the
`DISGUSTING` channel custom emoji (`:disgusting:` / `:disguxting:`) in YouTube
Live Chat.

It rebuilds the **actual sticker artwork** (1254×1254, transparent PNG) out of
~4,600 embers, then makes it roar:

1. embers lie scattered on the floor while the hellgate fades up
2. the embers lift and stream in curved paths into the sticker silhouette,
   bottom-up, while the rim draws in hot gold
3. the artwork condenses out of the cloud and solidifies with a soft flash
4. it inhales, then **ROARS**: lunge, screen shake, shockwave rings, scream
   lines, echo blast and a 180-spark burst

```
sticker-fx/
├─ sticker-fx.css        scoped styles + keyframes (all prefixed `sfx-`)
├─ sticker-fx.js         trigger detection, stage lock, cloud assembly, roar
├─ preview.html          standalone harness (open in Chrome, no server needed)
├─ assets/
│  ├─ disgusting.png       transparent sticker (source for the animation)
│  ├─ disgusting-glow.png  pre-blurred aura (no runtime blur filter)
│  └─ disgusting-cloud.js  generated 4,600-particle cloud (window.StickerFXCloud)
└─ tools/
   ├─ prepare-assets.py  regenerates the PNGs from the original JPEG
   └─ prepare-cloud.py   regenerates the particle cloud from the PNG
```

Wired into `chat-overlay.html` with three lines:

```html
<link rel="stylesheet" href="sticker-fx/sticker-fx.css">
<script src="sticker-fx/assets/disgusting-cloud.js"></script>
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
| `status()` | diagnostics snapshot (frames, long frames, cooldown, cloud size) |
| `configure({ triggers, duration, cooldown })` | retune without editing code |

Matching (case-insensitive substring) checks, in order:

1. `segments[].value` — e.g. `:disguxting:`
2. `segments[].emojiId` — YouTube's opaque custom-emoji id (`UC…/<id>`, *not*
   the shortcut). Only matches if you add that exact string to `triggers`;
   useful as a rename-proof escape hatch.
3. `segments[].name` / `segments[].shortcut` — defensive, for other producers
4. raw `message.text` fallback — only for a colon-delimited shortcut such as
   `:disguxting:` (plain prose like "that was disgusting" never triggers it)

Default triggers: `disgusting`, `disguxting`. To rename the emoji:

```js
StickerFX.configure({ triggers: ['disgusting', 'disguxting', 'new-emoji'] });
```

History replays are ignored (`isHistory`), and every YouTube message id is
de-duplicated, so an OBS refresh or WS reconnect never re-fires the moment.

## No-overlap guarantee

**Current overlay integration:** `animation-stage.js` now supplies a shared
FIFO. In `chat-overlay.html`, stickers wait their turn instead of pre-empting
or dropping likes/member/viewer alerts. Super Chats use `money-fx/` instead;
even a donation containing this emoji gets only the money routine. The legacy
standalone preview (without AnimationStage) retains the fallback described
below. See `money-fx/README.md` for BRB/cancellation and queue limits.

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

Nothing else in `chat-overlay.html` changes: no markup, no z-index, no
existing animation timing is touched.

## Beat sheet

The times live in `CONFIG.timeline` in `sticker-fx.js` and are injected into
`#sfx-root` as `--sfx-t-*` custom properties, so the JS timers and the CSS
keyframes cannot drift apart.

| time | beat |
| --- | --- |
| 0.00 s | backdrop, hellgate, floor embers |
| 1.72 s | artwork starts condensing inside the assembled cloud (24% ghost) |
| 2.42 s | solidify: soft flash + 36-spark pop |
| 3.02 s | **ROAR**: lunge, screen shake, rings, scream lines, 180 sparks |
| 3.12 s | "STICKER UNLEASHED" kicker |
| 3.55 s | sender name; 3.75 s caption |
| 4.00 s | idle float |
| 6.98 s | fade out; 7.60 s end |

## Performance contract

Built for a 24/7 OBS browser source:

- After boot, idle cost is zero: `#sfx-root { display: none }` — no layers,
  no rAF, no timers.
- A one-time warm-up performance runs at boot behind `opacity: 0.001` to
  pre-rasterise both canvases and the filtered name. It is cancelled the
  instant a real trigger arrives, and it drops the first-play stall from
  ~450 ms to under 10 ms in the test harness.
- Only `transform` and `opacity` animate; no animated filters, no shadows, no
  layout/paint animation.
- The aura is a pre-blurred PNG, not a CSS `blur()`.
- Embers use one 1920×1080 canvas, a fixed 280-object pool, three pre-rendered
  glow sprites, and `requestAnimationFrame` with delta-time clamping. No DOM
  particles, no per-frame allocations, no `setTimeout` per particle.
- The assembly cloud is a second 1920×1080 canvas drawn from typed arrays
  decoded once at boot. Particles are grouped by palette bucket, so the whole
  cloud is ~17 `fillStyle` changes per frame, not 4,600. The canvas is
  composited with `mix-blend-mode: screen`, so dark palette buckets add nothing.
- The cloud canvas is hidden as soon as it finishes fading into the artwork,
  so the remaining 4.8 s of the moment composites only the ember canvas and
  DOM. Verified in OBS: 60.0 fps, `renderSkippedFrames` unchanged.
- The cloud is sampled offline from the PNG alpha. This is required: under
  `file://` (OBS), drawing the PNG to a canvas taints it and `getImageData`
  would throw.
- Canvas work is skipped while the document is hidden; audio/encoder untouched.
- Every timer/rAF is cleared in `finish()`/`endWarm()`, and both canvases are
  cleared.

## Manual verification

1. Open `sticker-fx/preview.html` in Chrome (works over `file://`).
2. Press **Play**. Check: embers rise, the outline assembles, the artwork
   solidifies, then the roar shakes without exposing the scene edges; 60 fps,
   caption fits.
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

- Duration: `StickerFX.configure({ duration: 8200 })` (min 4500 ms; the beat
  sheet is tuned for 7600 ms).
- Cooldown: `StickerFX.configure({ cooldown: 3000 })`.
- Size: `--sfx-size` in `sticker-fx.css` (default `min(66vh, 58vw)`).
- Palette: `--sfx-orange`, `--sfx-red`, `--sfx-gold` on `#sfx-root`.
- Cloud density: regenerate with `--count 5200` (or lower for weak machines).
  `StickerFX.status().cloud` reports the loaded particle count.

## Asset regeneration

`tools/prepare-assets.py` removes the flat background with a border flood fill
(so white teeth/highlights inside the artwork survive), trims the die-cut white
edge, and generates the pre-blurred aura:

```bash
python sticker-fx/tools/prepare-assets.py "C:/Users/user/Downloads/disguxting.jpeg"
```

The particle cloud must be regenerated after any artwork change:

```bash
python sticker-fx/tools/prepare-cloud.py --count 4600 --preview cloud.png
```

The sampler keeps every silhouette pixel (painted ember-gold so the die-cut
outline stays visible), the strongest luminance contours (eyes, teeth,
lettering), and a bright interior fill — never near-black pixels, which are
invisible on the stage. The blob is one byte triple per particle and is loaded
before `sticker-fx.js`.

## Rollback

Remove the three link/script lines from `chat-overlay.html` and delete
`sticker-fx/`. The three `isBusy()` guards become inert when the module is
missing, so no other code needs to change.

## Limits

- The trigger is intentionally name-based; YouTube does not label custom emoji
  with a stable human name beyond the shortcut/emojiId. If the channel emoji is
  renamed, update `triggers`.
- The local PNG is shown instead of the 88px YouTube emoji URL on purpose —
  the emoji image is far too small for fullscreen use.
