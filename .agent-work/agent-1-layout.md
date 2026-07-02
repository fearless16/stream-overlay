# Agent 1 — Layout Architect Recommendations

## Scope
- Show Comment overlay: `#show-comment`, `.sc-card`, `.sc-top`, `.sc-pill`, `.sc-avatar`, `.sc-name`, `.sc-badge`, `.sc-msg`, `.sc-meta`, `.sc-bar`, `.sc-timer`, `.sc-hint`
- Right Panel: `#right-panel`, `#chat-panel`, `#chat-container`, `.msg`, `.msg-top`, `.msg .name`, `.msg .text`, `.chat-hdr`

---

## 1. Layout Issues Found

### Show Comment overlay
1. **Card is too narrow** — at `520px` long messages wrap awkwardly and the card looks like a small toast rather than a broadcast graphic.
2. **Tight internal spacing** — `gap: 8px`, `padding: 20px 24px 20px 20px` and small avatar/name/badge leave little visual breathing room.
3. **Weak hierarchy** — the message text (`18px`) is only marginally larger than the name (`14px`), so the featured comment does not dominate the card.
4. **Low readability** — thin progress bar (`2px`), tiny hint text (`9px`), and low-contrast meta elements make the overlay harder to read at a glance.

### Right panel
1. **Panel feels cramped** — `400px` width squeezes long names and multi-line chat messages.
2. **Chat text is dense** — `12.5px` text with `1.45` line-height and tight `gap: 4px` makes the stream hard to follow.
3. **Name truncation** — `.msg .name` is capped at `180px`, cutting off names even though horizontal space is available.
4. **Padding imbalance** — `#chat-panel` uses asymmetric padding (`16px 14px 14px 16px`) and `#right-panel` top/bottom padding does not match the new wider proportions.

---

## 2. Specific CSS Recommendations

Apply the following additions/changes **only** inside the existing `<style>` block of `chat-overlay.html`.

### Right Panel — width and spacing

```css
#right-panel {
  width: 490px;
  padding: 38px 28px 32px;
  gap: 16px;
}
```

```css
#chat-panel {
  padding: 20px 18px 18px 20px;
  border-radius: 18px;
}
```

```css
#chat-container {
  gap: 6px;
}
```

### Chat message readability

```css
.msg {
  padding: 10px 14px 10px 16px;
  border-radius: 12px;
  gap: 5px;
}
```

```css
.msg .msg-top {
  gap: 10px;
}

.msg .name {
  font-size: 13.5px;
  max-width: 240px;
}

.msg .msg-time {
  font-size: 10px;
}

.msg .text {
  font-size: 13.5px;
  line-height: 1.55;
  color: rgba(245, 243, 240, 0.88);
  padding-right: 24px;
}
```

### Chat header polish

```css
.chat-hdr {
  margin-bottom: 14px;
  padding-bottom: 12px;
}

.chat-hdr .title {
  font-size: 12px;
  letter-spacing: 3.5px;
}
```

### Show Comment overlay — broadcast graphic treatment

```css
#show-comment {
  padding: 0 0 40px 70px;
}
```

```css
.sc-card {
  width: 700px;
  padding: 28px 32px 28px 28px;
  gap: 12px;
  border-radius: 22px;
  border: 1px solid rgba(255, 45, 85, 0.22);
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(255, 45, 85, 0.08),
    0 0 40px rgba(255, 45, 85, 0.12);
}

.sc-card::before {
  width: 5px;
}
```

```css
.sc-top {
  gap: 14px;
}

.sc-pill {
  padding: 6px 20px 6px 6px;
  gap: 12px;
}

.sc-avatar {
  width: 40px;
  height: 40px;
  font-size: 15px;
}

.sc-name {
  font-size: 17px;
  letter-spacing: 0.2px;
}

.sc-badge {
  font-size: 10px;
  padding: 4px 14px;
  letter-spacing: 1.2px;
}
```

```css
.sc-msg {
  font-size: 24px;
  font-weight: 600;
  line-height: 1.45;
  color: #ffffff;
  padding: 6px 8px;
  letter-spacing: 0.1px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}
```

```css
.sc-meta {
  margin-top: 10px;
  gap: 14px;
}

.sc-bar {
  height: 3px;
  border-radius: 2px;
}

.sc-timer {
  width: 120px;
  height: 3px;
  border-radius: 2px;
}

.sc-hint {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.22);
  letter-spacing: 0.8px;
}
```

---

## 3. Structural HTML Changes

**None required.** All existing IDs and class names used by JavaScript are preserved. The layout goals can be achieved entirely through CSS adjustments to the existing selectors.

---

## 4. Rationale

| Change | Why |
|--------|-----|
| `#right-panel` → `490px` | Gives chat messages enough horizontal room for longer names and multi-line text without overlapping the central video area. |
| `#chat-panel` padding increase | Better visual separation between panel edge and content; matches the wider panel proportions. |
| `#chat-container` gap `6px` | Slightly separates messages for readability while keeping vertical footprint small. |
| `.msg` padding `10px 14px 10px 16px` | More internal breathing room per message; improves scannability. |
| `.msg .text` `13.5px` / `line-height: 1.55` | Largest readable size that still allows the fixed 12-message limit to fit. |
| `.msg .name` `max-width: 240px` | Uses the extra panel width instead of truncating unnecessarily. |
| `#show-comment` bottom/left padding | Moves the broadcast card away from the absolute edges for a framed, professional look. |
| `.sc-card` `700px` | TV-style lower-third/comment graphic width; handles long comments gracefully. |
| Larger avatar/name/message scale | Creates clear visual hierarchy: message dominates, then identity pill, then subtle meta. |
| Stronger border + layered shadow | Elevates the card above the stream, making it feel like a polished broadcast element. |
| Thicker `3px` progress bar and `10px` hint | Improves legibility of the timer/dismiss cue without adding clutter. |

---

## Status

Recommendations written. No JavaScript or HTML structural changes are proposed; only CSS values for the scoped selectors need to be updated.
