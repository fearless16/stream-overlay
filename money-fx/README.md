# Note udaana — Super Chat

15-second transparent, silent vector scene. **V5:** two bottom-anchored, three-quarter
inward-facing cartoon men in orange/teal kurta and cream dhoti rush in, brake,
plant their feet, and laugh while showering notes. Each grips a thick bundle
with one hand and drag-flicks with the other. The latest visual revision copies
the approved left actor's entire arm/hand pose onto the right, mirrored inward,
replacing its awkward independent shoulder/elbow setup. Both
release one note simultaneously every 0.34s (0.24s finale). Notes fan upward
across five centre face/cheek/shoulder lanes, crest, flutter, spin and fall.
Characters are 20% larger than V4, with feet about 20px above the canvas bottom.
Emerald/sage prop notes use three sizes for depth. Translucent emerald/gold
glows and sweeping rays brighten the backdrop without hiding the live camera.
Fixed centre framing, not face tracking; the streamer's reaction stays live.
The stack is angled toward the centre at chest height with an explicit palm,
thumb and curled fingers beneath it. Right fingertips sweep across the top
sheet and flick it off the bundle edge: **no lifted note or throwing motion**.

The scene is now **1920×1080**, matching the existing like/new-viewer/member
alerts: donor name pops at the true screen centre, with a staggered amount,
gold/cream text, crown, expanding rings, and a scale/rotate exit. This is
foreground celebration artwork over the existing layout, not a new opaque
background. Small comic speech beats and a faster finale give it a sequence,
not fifteen seconds of identical loops. See `SCENE-PLAN.md`.

## Operation

- Existing `youtube-chat` WebSocket → `MoneyFX.handleChat(d)` for Super Chats
  (including paid stickers, which the bridge already classifies as Super Chat).
- History never celebrates. Message IDs are deduplicated with a bounded
  sessionStorage cache; reconnects and same-tab refreshes do not replay them.
- A donation containing the disgusting emoji plays **only** the money routine.
  Non-paid disgusting emoji messages retain their existing sticker routine.
- `animation-stage.js` owns a shared FIFO for money, stickers, likes, members,
  new viewers, subscriber bumps, boundaries, wickets, and milestones. No alert
  interrupts an active celebration. Normal chat rendering and score updates
  are not held up. Operator-controlled comment cards are not celebrations.
- BRB cancels the current celebration, pauses pending entries, and resumes the
  queue when dismissed. Escape/Reset All cancels and clears the queue.
- Queue capacity: 1024 waiting alerts. Overflow is explicitly rejected/logged,
  never silently replaces an earlier donation. A pending queue is in-memory,
  not persisted across a browser/OBS restart; historical donations don't replay.

Preview: open `money-fx/preview.html` (also works with `file://`). The checkerboard
is only the preview's transparency reference, not an animation background.
It is linked from the overlay's **Controls → Animations** and from
`animations-demo.html`; these links open a separate preview, never a fake
donation on the live stream.

```js
MoneyFX.play({ name: 'Rahul Sharma', amount: '₹500' });
MoneyFX.status();
AnimationStage.status();
```

## Engineering plan / operational contract

1. **Architecture impact:** extend the existing HTML/JS overlay; no bridge,
   score parser, OBS source, audio, encoder or network configuration changes.
2. **Files:** `animation-stage.js`, `money-fx/*`, `chat-overlay.html`, `animations-demo.html`,
   `sticker-fx/sticker-fx.js`, focused browser test and package test command.
3. **Execution:** parsed live donation → history/chat card → guarded money
   request → FIFO → 15s routine → canvas/rAF cleanup → next celebration.
4. **Risks:** long bursts cause queue delay; overflow is visible in logs and
   health. 1920px scene geometry matches this overlay; scale preserves aspect.
5. **Implementation:** two-bone arm IK with separate holding hand; explicit
    surface-drag/edge-release phases; designed inward arc/fall; 16 pre-baked curved-paper
    sprites; donor textContent and staged spring reveals. Shared
    scheduler and existing bridge dispatch unchanged by V5.
6. **Edges:** international currencies, missing amount, long/HTML-like names,
   duplicate IDs, history, same-message emoji, multiple simultaneous alerts.
7. **Recovery:** bounded deadline releases failed jobs; money render exceptions
   stop its canvas; BRB, Escape, Reset and pagehide cancel resources. Existing
   WebSocket reconnect/backoff is preserved, not duplicated. No network assets
   are needed for the new cartoon artwork.
8. **Tests:** `npm run test:animations` exercises browser integration, FIFO,
   timing, transparency, dedupe, BRB/reset, failures, reload/reconnect, bounded
   stress and simulated uptime. Manual OBS playback still required for
   compositor smoothness, actual framing and live donation confirmation.
    `npm run test:money-scene` checks enlarged bottom rigs, full-screen centring,
    surface-only finger motion, no detached held note, measured bundle-edge
    release origin, inward/upward targets, pace change, long Hindi
   names and viewport scaling; captures actual existing alert references and
   a multi-beat scene contact sheet under the approved Temp/opencode folder.
9. **Rollback:** remove money stylesheet/script and WS dispatch from
   `chat-overlay.html`; revert only shared-queue integrations in that HTML and
   `sticker-fx.js`, then remove the new stage and money files. Do not overwrite
   unrelated work. Without AnimationStage, sticker's original fallback remains.

## Performance / diagnostics

112 reusable note slots, one 1920×1080 alpha canvas, cached note sprite, two SVG
puppets. Idle has no rAF or recurring timers. No per-note timers or DOM nodes.
`money-fx` and `animation-stage` CustomEvents expose lifecycle/error evidence;
status snapshots expose queue health, frame gaps, pool use and bounded dedupe.
`npm run test:money-performance` records two uncaptured real-time 1080p runs:
p95/max JS render time, 60Hz frame gaps, task CPU time, heap delta and layouts.
There are no layout reads on release or per-frame selector/text-fill updates.
Rendering is capped to a phase-preserving 60Hz target, with rigs built at
overlay startup. Blurred filter chains were removed from the donor reveal.
Browser results do not establish OBS smoothness; live OBS verification remains
required. No software can guarantee zero dropped frames under every load.

V5 integrated browser smoke: 66 releases, peak 24 notes, no direction errors,
healthy empty FIFO and no live notes/rAF after 15 seconds. Dedicated performance
results are in `Temp/opencode/money-fx-review-v5/performance-results.json`:
p95 JS render ~0.3ms, ~1.06s task CPU per 15s scene, stable 211 preview nodes,
peak 24 notes. Cold run had ~83/94ms scheduling gaps; repeat had none over 20ms.
This passes workload/cleanup gates, not a zero-drop or OBS smoothness guarantee.
Browser restart intentionally loses pending alerts rather than replaying old
donations. This feature adds no sound or OBS audio/mixer changes.

OBS browser source historically pointed at the repo's `chat-overlay.html`
(1920×1080, 60 FPS). V5 work does not refresh or test-trigger it. Current host
state, loaded cached renderer and live-animation compositing remain unverified.
