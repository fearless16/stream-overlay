# Agent 3 — Typography Recommendations

## Summary of Typography Issues

The overlay currently prioritises compactness over readability:

- **Show Comment overlay** is the hero moment, but `.sc-msg` is only `18px` while `.sc-name` is `14px`, so the message fails to dominate visually.
- **Right-panel chat** uses very small type (`13px` names, `12.5px` text) with tight line-height (`1.45`) and cramped internal spacing, making it hard to read on mobile/TV.
- **Scorecard** team and status text is small (`13px` / `12px`) with modest line-height, reducing glanceability.
- **Brand bar** labels are under-sized (`13px` / `10px`) and could be more legible without harming the compact layout.
- **Bottom bar** text is extremely faint (`rgba(255,215,0,0.2)` / `rgba(255,255,255,0.1)`) and over-tracked (`5px`), so it disappears against dark game footage.
- The global `line-height: 1.5` on a `14px` base is acceptable for desktop but too tight for TV and mobile viewers.
- No viewport-aware scaling exists for Desktop, Mobile, YouTube Shorts, or TV.

**Guiding principle:** the message body must always be the visual focus; meta labels (names, badges, timestamps) should recede.

---

## 1. Show Comment Overlay (`#show-comment`)

### Current values
- `.sc-name`: `14px`
- `.sc-msg`: `18px`, `line-height: 1.5`
- `.sc-card`: `gap: 8px`, `padding: 20px 24px 20px 20px`

### Recommended CSS

```css
.sc-card {
  gap: 14px;
  padding: 22px 26px 22px 22px;
}

.sc-pill {
  padding: 6px 18px 6px 6px;
}

.sc-avatar {
  width: 38px;
  height: 38px;
  font-size: 15px;
}

.sc-name {
  font-size: 19px;
  font-weight: 800;
  letter-spacing: 0.2px;
}

.sc-msg {
  font-size: 30px;
  font-weight: 600;
  line-height: 1.45;
  letter-spacing: -0.2px;
  padding: 0 4px;
}

.sc-meta {
  margin-top: 4px;
}
```

### Rationale
- Username at `19px` sits comfortably inside the requested `18–20px` range.
- Message at `30px` sits in the requested `28–32px` range and becomes the clear visual focus.
- `line-height: 1.45` prevents multi-line messages from feeling too airy while keeping them readable.
- Slightly larger card gap and pill give the hero content room to breathe.

---

## 2. Right-Panel Chat (`#right-panel`)

### Current values
- `.msg`: `gap: 4px`, `padding: 8px 12px 8px 14px`
- `.msg .name`: `13px`, `font-weight: 800`
- `.msg .text`: `12.5px`, `line-height: 1.45`, `font-weight: 500`
- `#chat-container`: `gap: 4px`

### Recommended CSS

```css
#chat-container {
  gap: 8px;
}

.msg {
  gap: 7px;
  padding: 11px 14px 12px 16px;
  border-radius: 12px;
}

.msg .name {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0;
  max-width: 170px;
}

.msg .text {
  font-size: 15px;
  font-weight: 500;
  line-height: 1.55;
  color: rgba(240, 236, 228, 0.86);
  padding-right: 18px;
}

.msg .msg-time {
  font-size: 10px;
}

.msg .badge {
  font-size: 9.5px;
  padding: 2.5px 9px;
}
```

### Rationale
- Message text is now larger than the username (`15px` vs `15px` but slightly lighter weight), establishing hierarchy through weight rather than size alone.
- `line-height: 1.55` improves legibility for viewers watching on phones or TVs.
- More internal padding and container gap separate messages so they do not visually merge.
- The text colour is lifted from `0.75` to `0.86` alpha so the message is the first thing the eye reads.

---

## 3. Scorecard (`#scorecard`)

### Current values
- `.sc-t-name`: `13px`, `margin-bottom: 6px`
- `.sc-t-score`: `28px`, `line-height: 1`
- `.sc-status`: `12px`, no explicit line-height, 2-line clamp
- `.sc-t-ov`: `10px`

### Recommended CSS

```css
.sc-t-name {
  font-size: 15px;
  font-weight: 800;
  margin-bottom: 8px;
  letter-spacing: 0.1px;
}

.sc-t-score {
  font-size: 30px;
  line-height: 1.05;
  letter-spacing: -1px;
}

.sc-t-score.blank {
  font-size: 17px;
}

.sc-t-ov {
  font-size: 11px;
  margin-top: 7px;
}

.sc-status {
  font-size: 14px;
  line-height: 1.5;
  font-weight: 700;
  margin-top: 12px;
  padding-top: 12px;
}
```

### Rationale
- Team names are lifted to `15px` for better glanceability on TV/mobile.
- Score grows to `30px` to remain the dominant element inside each team block.
- Status text becomes `14px` with `1.5` line-height so wrapped status lines do not touch.
- Overs text is slightly larger so it no longer competes with tiny metadata elsewhere.

---

## 4. Brand Bar (`#brand-bar`)

### Current values
- `#brand-name`: `13px`, `letter-spacing: -0.2px`
- `#brand-live`: `10px`, `letter-spacing: 2px`

### Recommended CSS

```css
#brand-name {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0;
}

#brand-live {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1.8px;
}
```

### Rationale
- Channel name gains `2px` for readability at a distance.
- `letter-spacing: 0` on the name keeps it compact; `LIVE` retains its uppercase tracking but is slightly larger.
- No layout width is added because the brand bar already has generous padding.

---

## 5. Bottom Bar (`#bottom-bar`)

### Current values
- `.bb-brand`: `14px`, `letter-spacing: 5px`, `color: rgba(255,215,0,0.2)`
- `.bb-social`: `10px`, `letter-spacing: 2px`, `color: rgba(255,255,255,0.1)`

### Recommended CSS

```css
#bottom-bar {
  gap: 7px;
  padding: 22px 60px 30px;
}

#bottom-bar .bb-brand {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 3.5px;
  color: rgba(255, 215, 0, 0.55);
  text-shadow: 0 0 20px rgba(255, 215, 0, 0.12);
}

#bottom-bar .bb-social {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: rgba(255, 255, 255, 0.35);
}
```

### Rationale
- Contrast is drastically improved while preserving the subtle bar aesthetic.
- Brand name tracking is reduced so the words read as a single brand rather than disconnected letters.
- Social text is lifted enough to be readable without drawing attention away from the chat/message overlays.

---

## 6. Global / Responsive Scaling

### Recommended base changes

```css
body {
  font-size: 15px;
  line-height: 1.6;
}
```

### Recommended viewport media queries

Add these after the main styles. They scale the overlay for different delivery formats without changing any IDs or class names used by JavaScript.

```css
/* ---------- Mobile viewers (up to 720px wide preview / embed) ---------- */
@media (max-width: 720px) {
  #right-panel {
    width: 320px;
    padding: 24px 16px 22px;
  }

  .msg {
    padding: 9px 12px 10px 13px;
    gap: 5px;
  }

  .msg .name,
  .msg .text {
    font-size: 13px;
    line-height: 1.5;
  }

  #scorecard {
    width: 300px;
    left: 14px;
    top: 78px;
  }

  .sc-t-name {
    font-size: 13px;
  }

  .sc-t-score {
    font-size: 22px;
  }

  .sc-status {
    font-size: 12px;
  }

  .sc-card {
    width: 88vw;
    max-width: 420px;
  }

  .sc-name {
    font-size: 16px;
  }

  .sc-msg {
    font-size: 22px;
    line-height: 1.45;
  }

  #brand-bar {
    top: 10px;
    left: 12px;
    padding: 8px 14px 8px 10px;
  }

  #brand-name {
    font-size: 13px;
  }

  #bottom-bar .bb-brand {
    font-size: 13px;
    letter-spacing: 2.5px;
  }

  #bottom-bar .bb-social {
    font-size: 9px;
  }
}

/* ---------- YouTube Shorts vertical 9:16 crop ---------- */
@media (max-aspect-ratio: 9/16) {
  #right-panel {
    width: 100%;
    height: auto;
    top: auto;
    bottom: 130px;
    right: 0;
    left: 0;
    padding: 0 16px;
    flex-direction: column-reverse;
    gap: 10px;
  }

  #chat-panel {
    max-height: 32vh;
    border-radius: 14px;
  }

  .msg .name,
  .msg .text {
    font-size: 14px;
    line-height: 1.55;
  }

  #scorecard,
  #brand-bar,
  #bottom-bar {
    display: none;
  }

  .sc-card {
    width: calc(100% - 32px);
    left: 16px;
    right: 16px;
  }

  .sc-msg {
    font-size: 24px;
    line-height: 1.45;
  }
}

/* ---------- TV / large-screen viewers ---------- */
@media (min-width: 1921px), (min-height: 1081px) {
  .msg .name,
  .msg .text {
    font-size: 17px;
    line-height: 1.6;
  }

  .sc-t-name {
    font-size: 17px;
  }

  .sc-t-score {
    font-size: 34px;
  }

  .sc-status {
    font-size: 16px;
  }

  .sc-msg {
    font-size: 34px;
    line-height: 1.5;
  }

  .sc-name {
    font-size: 20px;
  }

  #bottom-bar .bb-brand {
    font-size: 18px;
    letter-spacing: 4px;
  }

  #bottom-bar .bb-social {
    font-size: 13px;
  }
}
```

### Rationale
- The base `line-height: 1.6` improves readability across all viewports.
- Mobile/Shorts queries reduce panel widths and scale type down proportionally; the chat message remains the focus.
- The Shorts query hides heavy chrome (scorecard/brand/bottom bar) because vertical space is limited.
- TV query scales key text up so it remains readable from a distance.
- All existing IDs and class names are preserved; only CSS property values change.

---

## Constraints Observed

- No JavaScript, WebSocket, localStorage, timers, event listeners, score fetching, chat fetching, backend, or business logic is modified.
- All existing IDs and class names used by JS are preserved.
- Recommendations are CSS-only.
