# Stream overlay architecture notes

This document is intentionally short and operational. It describes the
contracts that must stay stable when the overlay is changed by a human or an
AI.

## Runtime flow

`live-score-poller.js` fetches Cricbuzz/Crex pages, detects the match format,
normalizes provider-specific fields, and broadcasts one score payload over the
local WebSocket. `chat-overlay.html` owns the browser UI: `updateScore()`
renders the payload and `addMsg()` appends chat items. `yt-chat-server.js`
provides the chat WebSocket bridge and static overlay server.

## Score payload contract

- `format`: `T20`, `ODI`, `Test`, or `HUN` (The Hundred).
- `teams`: two team objects with `score`; per-over formats may include
  `overs`, while `HUN` uses exact `balls`.
- `rateMetric`: `crr` for T20/ODI/Test, `rpb` for HUN.
- `currentOver`: ball tokens for the active over/five.
- `innings`, `day`, and `session` are Test-only context when available.
- `target.balls` is valid for limited-overs chases; Tests must not invent a
  balls-to-chase value.

Format-specific rules live in the `FORMATS` table in
`live-score-poller.js`. The overlay consumes stamped hints (`showBalls`,
`rateMetric`, `rateMax`) and only has legacy fallbacks for older payloads.

## Chat interaction contract

Chat cards must keep a stable layout and hit area while hovered. Hover styles
may change color, border, or shadow, but must not translate or resize a card;
the pointer can legitimately be in the `gap` between two cards during scroll.

## Verification

Run the focused browser contract test and parser tests before changing the
overlay behavior:

```text
node test-scorecard-details.mjs
npm test
```

The browser test covers T20, ODI, Test, and The Hundred display contracts plus
the chat hover hit-area regression. Parser tests cover provider normalization,
format math, Test innings inference, and The Hundred's five-ball rules.
