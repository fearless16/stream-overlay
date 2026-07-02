# Agent 6 — CSS Architecture Recommendations

**Scope:** Clean the stylesheet inside `chat-overlay.html` without touching JavaScript, WebSocket logic, IDs, or class names.

**Goal:** Remove duplication, introduce design tokens, group related rules, and restructure the CSS so layout, component, typography, glassmorphism, and motion improvements from other agents can be merged cleanly.

---

## 1. Structural Issues Found

1. **One flat, long stylesheet.** Rules for chat, scorecard, controls, overlays, and animations are interleaved, making concurrent edits error-prone.
2. **Repeated literal values.** `rgba(255,45,85,…)`, `rgba(0,212,255,…)`, `rgba(255,215,0,…)`, and `rgba(255,255,255,…)` opacity variants appear dozens of times. The same shadows, borders, and glows are re-declared across modules.
3. **No spacing / type / motion tokens.** Font sizes, gaps, paddings, border-radii, easings, and durations are hard-coded, making a global polish difficult.
4. **Duplicated rules.** `.msg.chat` repeats the same `border-left-color` already set on `.msg`. `.sc-vs::before`/`.sc-vs::after` share an identical declaration block but are only partially merged.
5. **Inefficient transitions.** Many rules use `transition: all`, which forces the browser to interpolate every animatable property.
6. **Namespace collision.** The scorecard module and the "show comment" overlay both use the `sc-` prefix (`.sc-hdr`, `.sc-card`, `.sc-top`, etc.). Class names cannot be changed, but the CSS should be grouped into clearly labeled sections to avoid accidental cross-module edits.
7. **Fixed canvas dimensions duplicated.** `1920px`, `1080px`, and `calc(1080px - …)` are scattered through the file.
8. **Hard-coded accent derivatives.** Message-type tints, badges, and scorecard ball states repeat the same pattern with only the hue changing.

---

## 2. Proposed `:root` Token Block

Replace the current `:root` with this expanded token set. Existing variable names are preserved so current references keep working; new tokens extend them.

```css
:root {
  /* ── Core brand colors ── */
  --neon-blue: #00d4ff;
  --neon-red: #ff2d55;
  --gold: #FFD700;
  --green: #00E676;
  --purple: #CE93D8;
  --announce-blue: #448AFF;

  /* Derived dark accents used in gradients */
  --red-dark: #aa0022;
  --gold-dark: #ff9500;
  --orange: #ff6b35;

  /* ── Neutral text ── */
  --text: #f0f0f5;
  --text2: #a0a0b0;
  --muted: #555;
  --text-body: rgba(240, 236, 228, 0.75);

  /* ── Surfaces ── */
  --bg-dark: #06040e;
  --panel-bg: rgba(8, 6, 16, 0.92);
  --overlay-bg: rgba(4, 3, 10, 0.97);
  --brand-bg: rgba(8, 6, 16, 0.85);

  /* ── Glass / alpha helpers (using color-mix keeps a single source of truth) ── */
  --glass-border: color-mix(in srgb, #fff 6%, transparent);
  --glass-highlight: color-mix(in srgb, #fff 3%, transparent);
  --glass-border-strong: color-mix(in srgb, #fff 8%, transparent);
  --glass-border-subtle: color-mix(in srgb, #fff 4%, transparent);
  --glass-hover: color-mix(in srgb, #fff 10%, transparent);
  --glass-bg: color-mix(in srgb, #fff 2.5%, transparent);
  --glass-bg-hover: color-mix(in srgb, #fff 6%, transparent);
  --glass-input: color-mix(in srgb, #fff 4%, transparent);

  --white-3: color-mix(in srgb, #fff 3%, transparent);
  --white-4: color-mix(in srgb, #fff 4%, transparent);
  --white-5: color-mix(in srgb, #fff 5%, transparent);
  --white-6: color-mix(in srgb, #fff 6%, transparent);
  --white-8: color-mix(in srgb, #fff 8%, transparent);
  --white-10: color-mix(in srgb, #fff 10%, transparent);
  --white-12: color-mix(in srgb, #fff 12%, transparent);
  --white-15: color-mix(in srgb, #fff 15%, transparent);
  --white-20: color-mix(in srgb, #fff 20%, transparent);
  --white-25: color-mix(in srgb, #fff 25%, transparent);
  --white-30: color-mix(in srgb, #fff 30%, transparent);
  --white-35: color-mix(in srgb, #fff 35%, transparent);
  --white-70: color-mix(in srgb, #fff 70%, transparent);
  --white-85: color-mix(in srgb, #fff 85%, transparent);

  --red-6: color-mix(in srgb, var(--neon-red) 6%, transparent);
  --red-8: color-mix(in srgb, var(--neon-red) 8%, transparent);
  --red-10: color-mix(in srgb, var(--neon-red) 10%, transparent);
  --red-12: color-mix(in srgb, var(--neon-red) 12%, transparent);
  --red-15: color-mix(in srgb, var(--neon-red) 15%, transparent);
  --red-20: color-mix(in srgb, var(--neon-red) 20%, transparent);
  --red-25: color-mix(in srgb, var(--neon-red) 25%, transparent);
  --red-30: color-mix(in srgb, var(--neon-red) 30%, transparent);
  --red-40: color-mix(in srgb, var(--neon-red) 40%, transparent);
  --red-50: color-mix(in srgb, var(--neon-red) 50%, transparent);
  --red-70: color-mix(in srgb, var(--neon-red) 70%, transparent);

  --blue-4: color-mix(in srgb, var(--neon-blue) 4%, transparent);
  --blue-6: color-mix(in srgb, var(--neon-blue) 6%, transparent);
  --blue-8: color-mix(in srgb, var(--neon-blue) 8%, transparent);
  --blue-12: color-mix(in srgb, var(--neon-blue) 12%, transparent);
  --blue-15: color-mix(in srgb, var(--neon-blue) 15%, transparent);
  --blue-20: color-mix(in srgb, var(--neon-blue) 20%, transparent);
  --blue-25: color-mix(in srgb, var(--neon-blue) 25%, transparent);
  --blue-30: color-mix(in srgb, var(--neon-blue) 30%, transparent);
  --blue-40: color-mix(in srgb, var(--neon-blue) 40%, transparent);

  --gold-3: color-mix(in srgb, var(--gold) 3%, transparent);
  --gold-4: color-mix(in srgb, var(--gold) 4%, transparent);
  --gold-8: color-mix(in srgb, var(--gold) 8%, transparent);
  --gold-10: color-mix(in srgb, var(--gold) 10%, transparent);
  --gold-12: color-mix(in srgb, var(--gold) 12%, transparent);
  --gold-15: color-mix(in srgb, var(--gold) 15%, transparent);
  --gold-20: color-mix(in srgb, var(--gold) 20%, transparent);
  --gold-25: color-mix(in srgb, var(--gold) 25%, transparent);
  --gold-30: color-mix(in srgb, var(--gold) 30%, transparent);
  --gold-40: color-mix(in srgb, var(--gold) 40%, transparent);
  --gold-50: color-mix(in srgb, var(--gold) 50%, transparent);

  --green-3: color-mix(in srgb, var(--green) 3%, transparent);
  --green-8: color-mix(in srgb, var(--green) 8%, transparent);
  --green-12: color-mix(in srgb, var(--green) 12%, transparent);
  --green-25: color-mix(in srgb, var(--green) 25%, transparent);

  --announce-3: color-mix(in srgb, var(--announce-blue) 3%, transparent);
  --announce-8: color-mix(in srgb, var(--announce-blue) 8%, transparent);
  --announce-12: color-mix(in srgb, var(--announce-blue) 12%, transparent);
  --announce-25: color-mix(in srgb, var(--announce-blue) 25%, transparent);

  --black-20: color-mix(in srgb, #000 20%, transparent);
  --black-30: color-mix(in srgb, #000 30%, transparent);
  --black-40: color-mix(in srgb, #000 40%, transparent);
  --black-50: color-mix(in srgb, #000 50%, transparent);

  /* ── Shadows ── */
  --shadow-sm: 0 2px 8px var(--black-30);
  --shadow-md: 0 8px 32px var(--black-40);
  --shadow-lg: 0 8px 32px var(--black-50), 0 0 60px var(--black-30);
  --shadow-glow-red: 0 0 20px var(--red-15);
  --shadow-glow-blue: 0 0 20px var(--blue-15);
  --shadow-glow-gold: 0 0 20px var(--gold-15);
  --shadow-glow-green: 0 0 20px var(--green-25);

  --btn-shadow-red: 0 4px 16px var(--red-20), 0 0 0 1px var(--red-20);
  --btn-shadow-red-hover: 0 6px 24px var(--red-30), 0 0 0 1px var(--red-30);
  --btn-shadow-blue: 0 0 0 1px var(--blue-10);
  --btn-shadow-blue-hover: 0 0 0 1px var(--blue-20), 0 4px 16px var(--blue-10);

  --sc-shadow-base: var(--shadow-md);

  /* ── Layout ── */
  --screen-w: 1920px;
  --screen-h: 1080px;
  --right-panel-w: 400px;
  --scorecard-w: 420px;

  /* ── Spacing scale ── */
  --space-1: 4px;
  --space-1-5: 6px;
  --space-2: 8px;
  --space-2-5: 10px;
  --space-3: 12px;
  --space-3-5: 14px;
  --space-4: 16px;
  --space-4-5: 18px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 28px;
  --space-8: 30px;
  --space-9: 35px;
  --space-10: 40px;
  --space-11: 48px;
  --space-12: 60px;

  /* ── Typography scale ── */
  --text-2xs: 9px;
  --text-xs: 10px;
  --text-sm: 11px;
  --text-base: 12px;
  --text-md: 12.5px;
  --text-lg: 13px;
  --text-xl: 14px;
  --text-2xl: 16px;
  --text-3xl: 18px;
  --text-4xl: 20px;
  --text-5xl: 28px;
  --text-6xl: 32px;
  --text-7xl: 48px;
  --text-8xl: 72px;

  /* ── Radii ── */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 10px;
  --radius-xl: 12px;
  --radius-2xl: 14px;
  --radius-3xl: 16px;
  --radius-4xl: 18px;
  --radius-5xl: 20px;
  --radius-6xl: 24px;
  --radius-pill: 999px;

  /* ── Motion ── */
  --ease-out-expo: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-out-back: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-out-quad: cubic-bezier(0.25, 0.46, 0.45, 0.94);

  --duration-fast: 0.15s;
  --duration-normal: 0.2s;
  --duration-slow: 0.3s;
  --duration-enter: 0.5s;
  --duration-card: 0.6s;
  --duration-panel: 0.8s;

  /* ── Effects ── */
  --blur-sm: 10px;
  --blur-md: 12px;
  --blur-lg: 16px;
  --blur-xl: 24px;
  --blur-2xl: 32px;
}
```

If the target runtime does not support `color-mix()`, replace each `color-mix(in srgb, X Y%, transparent)` with the equivalent literal `rgba(...)` value. The naming convention stays the same, so the rest of the CSS is unaffected.

---

## 3. Grouping Recommendations

Re-order the stylesheet into clearly delimited layers. Use the existing banner comment style so other agents can locate their module quickly.

```text
1.  Imports & reset
2.  Design tokens (:root + @property --sc-angle)
3.  Base / global (body, scrollbar, utility keyframes such as fadeIn/livePulse/shimmer)
4.  Layout shells
    4.1 #right-panel
    4.2 #brand-bar
    4.3 #scorecard
    4.4 #bottom-bar
    4.5 #ctrl-panel
    4.6 #brb-overlay
    4.7 #show-comment overlay
5.  Components
    5.1 Chat / messages / badges / actions
    5.2 Donator card
    5.3 Superchat panel
    5.4 Show-comment card
    5.5 Scorecard internals
    5.6 Control inputs & buttons
6.  Module keyframes (grouped by the module that uses them)
```

Keep the `sc-` class names untouched, but put scorecard rules and show-comment rules in separate, labeled sections to make the namespace collision explicit.

---

## 4. Specific Cleanup Recommendations

### A. Consolidate message-type tints
The four message variants use the exact same gradient shape with only the accent color changing.

```css
.msg.superchat,
.msg.membership,
.msg.moderator,
.msg.announcement,
.msg.pinned {
  background: linear-gradient(90deg, var(--msg-tint), var(--white-2));
}

.msg.superchat    { --msg-tint: var(--gold-3); }
.msg.membership   { --msg-tint: var(--green-3); }
.msg.moderator    { --msg-tint: var(--blue-3); }
.msg.announcement { --msg-tint: var(--announce-3); }
.msg.pinned       { --msg-tint: var(--gold-4); }
```

### B. Consolidate badges
Badges share the same box model; only the accent changes.

```css
.msg .badge {
  background: var(--badge-bg);
  color: var(--badge-color);
  border-color: var(--badge-border);
}
.msg .badge.superchat    { --badge-bg: var(--gold-12);  --badge-color: var(--gold);          --badge-border: var(--gold-25); }
.msg .badge.membership   { --badge-bg: var(--green-12); --badge-color: var(--green);         --badge-border: var(--green-25); }
.msg .badge.moderator    { --badge-bg: var(--blue-12);  --badge-color: var(--neon-blue);     --badge-border: var(--blue-25); }
.msg .badge.announcement { --badge-bg: var(--announce-12); --badge-color: var(--announce-blue); --badge-border: var(--announce-25); }
```

### C. Consolidate scorecard ball states
```css
.sc-ball {
  --ball-bg: var(--white-5);
  --ball-color: var(--white-70);
  --ball-border: var(--white-8);
  --ball-glow: none;
  background: var(--ball-bg);
  color: var(--ball-color);
  border-color: var(--ball-border);
  box-shadow: var(--ball-glow);
}
.sc-ball.wicket { --ball-bg: var(--red-25);  --ball-color: var(--neon-red);  --ball-border: var(--red-40);  --ball-glow: var(--shadow-glow-red); }
.sc-ball.four   { --ball-bg: var(--blue-20); --ball-color: var(--neon-blue); --ball-border: var(--blue-40); --ball-glow: var(--shadow-glow-blue); }
.sc-ball.six    { --ball-bg: var(--gold-25); --ball-color: var(--gold);      --ball-border: var(--gold-40); --ball-glow: var(--shadow-glow-gold); }
.sc-ball.wide   { --ball-bg: var(--white-6); --ball-color: var(--white-35); }
```

### D. Remove the redundant `.msg.chat` rule
`.msg` already sets `border-left-color: rgba(255,45,85,0.4)`. Delete:

```css
.msg.chat { border-left-color: rgba(255,45,85,0.4); }
```

### E. Unify the live dot
Both `#brand-live .live-dot` and `.chat-hdr .title .live-dot` can share a base class. Keep selectors as-is but declare shared properties once:

```css
.live-dot {
  border-radius: 50%;
  background: var(--neon-red);
  box-shadow: 0 0 12px var(--neon-red);
  animation: livePulse 1.5s ease-in-out infinite;
  flex-shrink: 0;
}
#brand-live .live-dot { width: 6px; height: 6px; box-shadow: 0 0 8px var(--neon-red); }
.chat-hdr .title .live-dot { width: 8px; height: 8px; }
```

### F. Replace hard-coded accent dark shades
Use the new tokens in gradients:

```css
#brand-logo,
#brb-overlay .brb-logo,
.ctrl-btn {
  background: linear-gradient(135deg, var(--neon-red), var(--red-dark));
}

.sc-t-score {
  background: linear-gradient(135deg, var(--gold), var(--gold-dark), var(--gold));
}

.sc-target-fill {
  background: linear-gradient(90deg, var(--neon-red), var(--orange), var(--gold));
}
```

### G. Replace fixed dimensions with layout tokens
```css
body {
  width: var(--screen-w);
  height: var(--screen-h);
}

#right-panel {
  width: var(--right-panel-w);
  height: var(--screen-h);
}

#bottom-bar {
  width: var(--screen-w);
}

#scorecard {
  width: var(--scorecard-w);
  max-height: calc(var(--screen-h) - 160px);
}

.sc-bd {
  max-height: calc(var(--screen-h) - 232px);
}
```

### H. Standardize glass panels
```css
#chat-panel,
#scorecard,
#brand-bar,
.sc-card,
.donator-card {
  backdrop-filter: blur(var(--blur-xl));
}
```

Where a module intentionally uses a different blur value (e.g., `blur(32px)` on `.sc-card`, `blur(16px)` on `#brand-bar`), use the corresponding token (`--blur-2xl`, `--blur-lg`).

### I. Replace repeated `transition: all`
Use targeted transitions with the motion tokens. Example for `.msg`:

```css
.msg {
  transition:
    background-color var(--duration-normal) var(--ease-out-expo),
    border-color var(--duration-normal) var(--ease-out-expo),
    transform var(--duration-normal) var(--ease-out-expo);
}
```

This preserves the visible hover behavior while avoiding the performance cost of `transition: all`.

### J. Centralize scorecard base shadow in flash keyframes
The `scUpdateFlash`, `scBoundaryFlash`, and `scWicketFlash` keyframes all reset the same base shadow. Use the token:

```css
@keyframes scUpdateFlash {
  0%, 100% { filter: brightness(1); border-color: var(--red-10); box-shadow: var(--sc-shadow-base); }
  15% { filter: brightness(1.3); border-color: var(--red-40); box-shadow: var(--sc-shadow-base), 0 0 0 2px var(--red-15), 0 0 40px var(--red-08); }
}
```

### K. Group numeric/tabular selectors
```css
.sc-t-score,
.sc-bm-score,
.sc-bowler-fig,
.sc-rate-val,
.sc-ball,
.brb-timer {
  font-variant-numeric: tabular-nums;
}
```

### L. Move `@property --sc-angle` next to tokens
Keep the Houdini property registration right after `:root` so the animated conic border is discoverable as an effect token:

```css
@property --sc-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
```

### M. Keep the user-color override intact
The following rule is intentionally specific; leave it exactly as-is so per-user colors continue to win:

```css
.msg[style*="--user-color"] { border-left-color: var(--user-color) !important; }
```

### N. Preserve JS-facing classes and IDs
Do **not** rename any of the following (this is a non-exhaustive list):
`#right-panel`, `#chat-panel`, `#chat-container`, `.msg`, `.msg-actions`, `.badge`, `.pinned`, `.superchat`, `.membership`, `.moderator`, `.announcement`, `#superchat-panel`, `#show-comment`, `.sc-card`, `#scorecard`, `#ctrl-panel`, `#ctrl-tab`, `#ctrl-body`, `#brb-overlay`, `#brand-bar`, `.health-indicator`, etc.

---

## 5. Rationale

- **Tokens reduce drift.** By centralizing colors, opacities, shadows, spacing, type, radii, and motion, future agents can apply a global polish from one place instead of hunting through 1200 lines.
- **Grouping prevents merge collisions.** Layout, chat, scorecard, controls, and overlay rules live in distinct sections, making parallel work from other agents safer.
- **Removing duplication shrinks the file and removes inconsistency.** Message tints, badges, and ball states are now one pattern with a hue variable, so a future theme change cannot accidentally update only three of the four variants.
- **Targeted transitions improve rendering.** `transition: all` is replaced by property-specific transitions, which reduces browser work while keeping the same visual result.
- **Fixed-dimension tokens make the 1920×1080 canvas explicit.** Calculations like `calc(1080px - 160px)` become self-documenting and easier to adapt if the canvas size ever changes.
- **Class/ID preservation guarantees zero JavaScript impact.** All cleanup happens inside the `<style>` block; no DOM hooks are renamed or removed.
