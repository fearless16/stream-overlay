# V5 — bottom-anchored cinematic emerald shower (15 seconds)

## Visual target and references

Reviewed actual `chat-overlay.html` like, new-viewer and member alert styles,
timing and rendered frames. Borrow their centre alignment, scale overshoot,
rotation, staggered reveals and rings. Do not borrow their full-screen colour
wash: this scene retains camera visibility with translucent lighting only.

The donor is the hero; the characters are supporting comedians. Roughly
375px-tall visible figures in 288×416 rig boxes, enlarged 20% over V4. Feet
sit around Y=1060, 20px above the 1080px canvas bottom. They look
diagonally inward, with projecting noses, side-plane shading, near/far eyes,
inward pupils and asymmetrical silhouettes. Orange scarf vs teal spectacles
distinguishes them. Both retain dhoti and kurta.

## Beat sheet (15 seconds)

| Time | Direction |
| --- | --- |
| 0–1.2 | Committed side entrance; running legs, overshoot, heel-brake squash, short speed marks/dust; feet settle. Right character arrives slightly later. |
| 1.0–2.1 | Left: “ARRE, SETH JI!” bubble. |
| 1.38–2.45 | Name scales/rotates into true frame centre with overshoot; crown/rings; stagger amount; readable hold. |
| 2.15–10.5 | Simultaneous 0.34s bundle-edge drag-flick cycles. Notes fan upward, crest above the central face lanes, then flutter down around shoulders. Three paper sizes create depth. No lifted-note throw. |
| 9.55–10.7 | Right: “AUR HAI!”; sets up the accelerated finale. |
| 10.5–12.65 | Faster 0.24s simultaneous cycles; “FULL IZZAT!”; “SETH JI OP!”; stronger controlled lighting. |
| 12.65–13.65 | Acknowledgement/bow, “SHUKRIYA, DIL SE!” |
| 13.65–15 | Back out; donor exits; notes and lighting fade to transparent; all resources cleaned. |

## Motion contract

- Arm solves shoulder/elbow/wrist geometry. RIGHT fingertips remain on the
  top-sheet plane throughout the stroke (constant bundle-local Y=10); the
  wrist slides along that plane rather than lifting a banknote upward.
- LEFT palm, bracing thumb and three curled fingers are separately drawn
  underneath the angled stack. Stack layers are visible; feed edge is free.
- Top sheet slides only a few pixels along the stack before departure. No
  banknote is attached to the right hand at any point.
- A single note can spawn only on the release phase, once per RIGHT-hand cycle.
- Latest visual correction: right actor copies the approved left actor's entire
  grip, shoulder, elbow lengths, wrist and finger geometry, mirrored inward.
  This replaces the independent short-arm setup that looked awkward. Grip/flick
  names now identify rig roles on the mirrored artwork, not independently
  anatomically handed character rigs. The palm remains under the bundle.
- Actual transformed BUNDLE EDGE is the launch origin, calculated from known
  SVG/CSS transforms without `getScreenCTM`/layout reads in the hot loop.
- All flight targets are above and toward frame centre, never an arbitrary
  random velocity. Five centre face/cheek/shoulder lanes cross and coast onward
  with continuous velocity, flutter, axial rotation and gravity. This is fixed
  framing, not face tracking. The streamer's laughter remains live camera.
- Emerald/sage Indian-style ₹500 prop artwork: rupee and Devanagari numerals,
  guilloche, security-thread motif and fictional portrait; no US dollar bills.
  Fine pattern is deliberately restrained to avoid moiré at stream resolution.
- Paper curvature is pre-baked into 16 small sprite frames (eight strips each)
  and drawn with one blit per note. Notes render **behind** donor typography.
- One shared RIG geometry object supplies CSS dimensions and analytic bundle
  origins. Approved local hand/grip/arm paths and lengths stay unchanged.
- Pre-baked emerald/gold radial glows and six low-alpha sweeping rays render
  behind notes and characters. No opaque plate, strobe, filter or blur pass.

## Engineering / safety plan

1. **Impact:** only money scene renderer/styles/preview and focused tests/docs;
   no new service, audio, OBS settings or bridge changes.
2. **Affected:** `money-fx/*`, test clock helper, `tests/animations.cjs`,
   `tests/money-scene.cjs`, package command. Existing queue/dispatch preserved.
3. **Flow:** live paid event → existing dedupe/FIFO → scene → cleanup → next.
4. **Risks:** name contrast, long names, clipping, premature note release,
   colour-surface bleed, overlapping alerts. Verify pixels and motion phases,
   not merely existence of DOM nodes.
5. **Implementation:** staged JS timeline; small 3/4 rigs; articulated hand;
   targeted arcs; centre-aligned alert typography; restrained scene accents.
6. **Edges:** Unicode/long names, foreign currency, skipped frame, resize,
   duplicate/history message, BRB, reset, Escape, large alert burst.
7. **Recovery:** existing bounded FIFO deadlines and cleanup remain. Scene
   exceptions log/emit and stop rAF/canvas. No external artwork dependency.
8. **Verification:** phase/geometry tests plus multi-beat images and real-time
   browser run, followed by existing alert FIFO/recovery/stress tests. OBS
   health probe only; no restarting/killing a live OBS session for testing.
9. **Rollback:** revert only this revision's renderer/preview/test/doc changes;
   do not discard unrelated work or remove the already-integrated shared FIFO.

V5 scope: renderer, CSS, preview label, three focused tests and docs only.
Shared FIFO and WS dispatch untouched; duration is 15000ms with an existing
80ms queue-release safety margin. Longer scenes increase queued-alert latency.
Tests verify foot placement, 20% enlargement, local hand paths, matched full
cycles, measured source edge, green translucent lighting and clearing, long
names, scaling, no hot-loop layout reads, FIFO, stress and recovery.
Rollback this revision's geometry, lighting, palette and timeline plus matching
tests/docs only; do not remove the FIFO or discard unrelated work.
Do not refresh the on-air OBS browser source or trigger a test donation.

V5 is browser-verified only. OBS was not refreshed/test-triggered; loaded cache,
live compositing, face alignment and compositor/encoder drops remain unverified.
Historical OBS states are not evidence of current stream/recording state.

## Performance gate

No per-note nodes/timers. Fixed pool, bounded telemetry, no hot-loop geometry
reads or animated text-fill repaint, and no repeated tagline DOM replacement.
Notes use absolute scene age so a delayed frame does not slow the simulation.
`test:money-performance` measures two real-time 1080p runs without captures,
reports 60Hz scheduling gaps separately from JS render cost, checks p95 JS cost
under 8ms, bounded live note count, cleanup and stable DOM. Title blur/filter
chains are removed; scene draw calls are capped to a 60Hz target; hidden rigs
are built at overlay load. Fresh-browser cold-render scheduling hitches remain
in the measured report even though JS cost passes. It cannot certify
OBS compositor/encoder performance or promise zero drops under arbitrary load.
