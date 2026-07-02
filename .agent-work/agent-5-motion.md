# Agent 5 — Motion Design Recommendations

## Scope
Review limited to `chat-overlay.html` stylesheet: all `@keyframes`, `transition`, and animation-related properties. JavaScript, WebSocket, localStorage, timers, event listeners, score/chat fetching, and business logic are **not modified**.

## Summary of Motion Issues
1. **Layout-thrashing animations**:
   - `.msg.exiting` (`msgExit`) animates `max-height`, `margin`, `padding`, and `border-width` — full reflow every frame.
   - `#ctrl-body` uses a `max-height` transition — reflows the control panel on every open/close.
   - `.sc-rate-fill` and `.sc-target-fill` use `width` transitions — reflow the bar fills.
2. **Repaint-heavy border rotation**:
   - `#scorecard::after` animates a conic-gradient via a registered CSS custom property (`--sc-angle`), forcing a full background repaint each frame.
3. **Paint-heavy enter animation**:
   - `msgEnter` uses `filter: brightness()`, which is more expensive than transform/opacity.
4. **Over-broad transitions**:
   - Several `transition: all` declarations exist; they should target only the properties actually changing.
5. **No layer promotion**:
   - Several high-frequency animated elements lack `will-change`, so the browser may not promote them to their own compositor layers.
6. **Show-comment auto-dismiss timer**:
   - Already GPU-friendly (`transform: scaleX`). It must be preserved exactly as-is.

## Specific CSS Recommendations

### 1. Message exit — replace reflow with transform/opacity
**Current:**
```css
@keyframes msgExit {
  0%   { opacity: 1; transform: translateY(0) scale(1); max-height: 200px; margin-bottom: 4px; }
  100% { opacity: 0; transform: translateY(-12px) scale(0.92); max-height: 0; margin-bottom: 0; padding-top: 0; padding-bottom: 0; border-width: 0; }
}

.msg.exiting {
  animation: msgExit 0.4s cubic-bezier(0.4, 0, 1, 1) forwards;
  pointer-events: none;
}
```

**Recommended:**
```css
@keyframes msgExit {
  0%   { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(-12px) scale(0.92); }
}

.msg.exiting {
  animation: msgExit 0.4s cubic-bezier(0.4, 0, 1, 1) forwards;
  pointer-events: none;
  will-change: transform, opacity;
}
```

**Rationale:** `transform` and `opacity` are compositor-only properties. JavaScript removes the node on `animationend`, so the final layout collapse still happens once, without 60 frames of reflow.

---

### 2. Scorecard rotating border — replace custom-property repaint with transform rotate
**Current:**
```css
@property --sc-angle { ... }

#scorecard::after {
  ...
  background: conic-gradient(from var(--sc-angle), transparent 0%, ...);
  animation: scBorderRotate 6s linear infinite;
}

@keyframes scBorderRotate {
  to { --sc-angle: 360deg; }
}
```

**Recommended:**
```css
#scorecard::after {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 18px;
  background: conic-gradient(
    from 0deg,
    transparent 0%,
    rgba(255,45,85,0.15) 25%,
    transparent 50%,
    rgba(0,212,255,0.15) 75%,
    transparent 100%
  );
  animation: scBorderRotate 6s linear infinite;
  pointer-events: none;
  z-index: -1;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  -webkit-mask-composite: xor;
  padding: 1px;
  will-change: transform;
}

@keyframes scBorderRotate {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* The @property --sc-angle rule can be removed; it is no longer used. */
```

**Rationale:** Rotating the entire pseudo-element via `transform: rotate()` is GPU-composited and avoids re-rasterizing a conic-gradient every frame. The mask is rotationally symmetric, so rotating it does not change the visible 1 px border ring.

---

### 3. Control panel body — replace max-height with transform/opacity
**Current:**
```css
#ctrl-body {
  width: 100%;
  background: rgba(4, 3, 10, 0.98);
  border-top: 1px solid rgba(255,45,85,0.12);
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.4s cubic-bezier(0.22, 1, 0.36, 1);
  display: flex;
  flex-direction: column;
}
#ctrl-panel.open #ctrl-body { max-height: 500px; }
```

**Recommended:**
```css
#ctrl-body {
  width: 100%;
  background: rgba(4, 3, 10, 0.98);
  border-top: 1px solid rgba(255,45,85,0.12);
  display: flex;
  flex-direction: column;
  transform: translateY(100%);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    transform 0.4s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.3s ease,
    visibility 0s linear 0.4s;
  will-change: transform, opacity;
}

#ctrl-panel.open #ctrl-body {
  transform: translateY(0);
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition:
    transform 0.4s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.3s ease,
    visibility 0s;
}
```

**Rationale:** `translateY` and `opacity` do not affect layout. Because `#ctrl-body` is fixed to the bottom of the viewport, translating it by its own height moves it fully off-screen. `visibility` prevents interaction and focusability while collapsed.

---

### 4. Rate / target bars — replace width transition with transform scaleX
**Current:**
```css
.sc-rate-fill {
  height: 100%; border-radius: 2px;
  transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
}

.sc-target-fill {
  height: 100%; border-radius: 3px;
  transition: width 1s cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  ...
}
```

**Recommended:**
```css
.sc-rate-fill {
  height: 100%;
  width: 100%;
  border-radius: 2px;
  transform: scaleX(var(--fill, 0));
  transform-origin: left;
  transition: transform 0.8s cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  will-change: transform;
}

.sc-target-fill {
  height: 100%;
  width: 100%;
  border-radius: 3px;
  transform: scaleX(var(--target, 0));
  transform-origin: left;
  transition: transform 1s cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  will-change: transform;
  ...
}
```

**Rationale:** `width` changes recalculate layout and can thrash the bar and its siblings. `transform: scaleX()` is composited. **Note:** The data layer currently sets an inline `width` on these fills. To realize the performance gain, set `--fill` / `--target` (a 0–1 fraction) instead of `width`, and remove inline `width` / inline `transition` overrides. Until then, keep `will-change: transform` on the fills.

---

### 5. Message entry — remove expensive brightness filter
**Current:**
```css
@keyframes msgEnter {
  0% { transform: translateX(20px) scale(0.95); opacity: 0; filter: brightness(2); }
  100% { transform: translateX(0) scale(1); opacity: 1; filter: brightness(1); }
}
```

**Recommended:**
```css
@keyframes msgEnter {
  0% { transform: translateX(20px) scale(0.95); opacity: 0; }
  100% { transform: translateX(0) scale(1); opacity: 1; }
}

.msg {
  ...
  will-change: transform, opacity;
}
```

**Rationale:** `filter: brightness()` changes are not as cheap as pure `transform`/`opacity` and can force extra compositor work when many chat messages enter rapidly. The recommended keyframe keeps the same slide + scale feel.

---

### 6. Show-comment auto-dismiss timer — preserve and promote
**Current:**
```css
.sc-timer-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--neon-red), var(--neon-blue));
  width: 100%;
  transform-origin: left;
  animation: timerShrink var(--auto-dismiss, 12s) linear forwards;
}

@keyframes timerShrink {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}
```

**Recommended:**
```css
.sc-timer-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--neon-red), var(--neon-blue));
  width: 100%;
  transform-origin: left;
  animation: timerShrink var(--auto-dismiss, 12s) linear forwards;
  will-change: transform;
}

@keyframes timerShrink {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}
```

**Rationale:** This animation is already GPU-friendly (`transform: scaleX`) and driven by the same `timerShrink` keyframes and `.sc-timer-fill` class that JavaScript expects. Only `will-change` is added to ensure consistent layer promotion.

---

### 7. Narrow over-broad transitions
Replace `transition: all` with the exact properties being animated. This avoids accidental animating of layout/paint properties and lets the browser optimize.

| Selector | Current | Recommended |
|---|---|---|
| `.donator-card` | `transition: all 0.3s;` | `transition: border-color 0.3s, box-shadow 0.3s;` |
| `.donator-name` | `transition: all 0.3s;` | Remove (no CSS state change; only `goldPulse` applies). |
| `.chat-hdr .count` | `transition: all 0.3s;` | `transition: transform 0.3s, background-color 0.3s, color 0.3s;` |
| `.msg` | `transition: all 0.2s ease;` | `transition: transform 0.2s ease, background-color 0.2s ease, border-color 0.2s ease;` |
| `.msg-action-btn` | `transition: all 0.15s;` | `transition: transform 0.15s, background-color 0.15s, color 0.15s;` |
| `.sc-t` | `transition: all 0.3s ease;` | `transition: background-color 0.3s ease, box-shadow 0.3s ease;` |
| `.sc-bm` | `transition: all 0.25s ease;` | `transition: transform 0.25s ease;` |
| `.sc-bowler` | `transition: all 0.3s ease;` | Remove (no CSS state change). |
| `.sc-ball` | `transition: all 0.25s cubic-bezier(...);` | `transition: transform 0.25s cubic-bezier(...), box-shadow 0.25s, background-color 0.25s, border-color 0.25s;` |
| `#ctrl-tab` | `transition: all 0.2s;` | `transition: background-color 0.2s, transform 0.2s, box-shadow 0.2s;` |
| `.ctrl-fields input, .ctrl-fields select` | `transition: all 0.2s;` | `transition: border-color 0.2s, box-shadow 0.2s, background-color 0.2s;` |
| `.ctrl-btn` | `transition: all 0.15s;` | `transition: transform 0.15s, box-shadow 0.15s;` |

---

### 8. Add `will-change` for key animated elements
Use sparingly on elements that animate repeatedly. This is a hint for the browser to keep a compositor layer ready.

```css
.msg,
.msg.exiting { will-change: transform, opacity; }

.donator-name.updated,
.chat-hdr .count,
.sc-t-flag,
.sc-ball-pop,
.sc-ball.wicket,
.sc-score-changed .sc-t-score,
.live-dot,
.sc-hdr .sc-title::before,
.brb-logo { will-change: transform; }

.sc-card { will-change: transform, opacity; }
.sc-timer-fill,
.sc-rate-fill,
.sc-target-fill,
#scorecard::after { will-change: transform; }
```

**Rationale:** `will-change` reduces the chance of missed frames during the first animation by promoting layers upfront. Avoid applying it to too many static elements; the list above covers the animated overlay pieces.

---

### 9. Add containment to overlay roots
Containment limits the area the browser has to repaint on each animation.

**Recommended:**
```css
#right-panel,
#chat-panel,
#superchat-panel,
#scorecard,
#show-comment,
#ctrl-panel,
#brand-bar,
#bottom-bar,
#brb-overlay {
  contain: layout paint style;
}
```

**Rationale:** `contain: layout paint style` tells the browser that internal layout/paint changes do not affect siblings, and style changes are scoped. This is safe for fixed overlay panels that are already self-contained.

---

### 10. Optional: reduce paint-heavy shadow/glow keyframes
The following keyframes animate `box-shadow` or `text-shadow`, which repaints every frame:
- `goldPulse` (`text-shadow`)
- `scDotPulse` (`box-shadow`)
- `scBallWicketPulse` (`box-shadow`)
- `brbPulse` (`box-shadow`)
- `scUpdateFlash`, `scBoundaryFlash`, `scWicketFlash` (`border-color` + `box-shadow`)

**Recommendation:** For maximum 60 FPS headroom, replace animated shadow values with a dedicated pseudo-element whose `opacity` is animated, or combine with `transform: scale()` on a blurred glow layer. This is lower priority than the reflow issues above, but worth noting if dropped frames are observed during boundary/wicket flashes.

---

## Easing / Timing Notes
- `cubic-bezier(0.22, 1, 0.36, 1)` and `cubic-bezier(0.34, 1.56, 0.64, 1)` already give a premium, snappy feel. Keep them.
- `msgExit` currently uses `cubic-bezier(0.4, 0, 1, 1)` (ease-in). This is acceptable for an exit, but consider `cubic-bezier(0.22, 1, 0.36, 1)` if the exit should feel lighter.
- `livePulse` and `brbPulse` use `ease-in-out`, which is correct for breathing/pulsing loops.

---

## Class / Keyframe Names to Preserve
The JavaScript triggers these classes and keyframes; they must remain unchanged:
- `.msg.exiting` + `@keyframes msgExit`
- `.new-entry` + `@keyframes msgEnter`
- `.donator-name.updated` + `@keyframes goldPulse`
- `.chat-hdr .count.pulse`
- `@keyframes livePulse` (used by `.live-dot`)
- `#scorecard` classes: `.hidden`, `.sc-update`, `.sc-flash-boundary`, `.sc-flash-wicket`, `.sc-shake`
- `@keyframes scCardEntry`, `@keyframes scBorderRotate`, `@keyframes scScoreShimmer`, `@keyframes scScoreFlash`, `@keyframes scBmSlideIn`, `@keyframes scBowlerFlash`, `@keyframes scBallPop`, `@keyframes scBallWicketPulse`, `@keyframes scStatusFadeIn`, `@keyframes scTargetPulse`, `@keyframes scTargetGradient`
- `.sc-timer-fill` + `@keyframes timerShrink`
- `.sc-card` + `@keyframes scCardIn`, `.sc-backdrop` + `@keyframes fadeIn`
- `.brb-logo` + `@keyframes brbPulse`

All recommendations above keep these names intact.
