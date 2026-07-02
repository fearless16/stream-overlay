const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'chat-overlay.html');
let html = fs.readFileSync(filePath, 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Upgrade :root tokens (keep existing variables, add design-system helpers)
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /:root \{[\s\S]*?--shadow-glow-blue: 0 0 20px rgba\(0,212,255,0\.15\);\n\}/,
  `:root {
  --neon-blue: #00d4ff;
  --neon-red: #ff2d55;
  --gold: #FFD700;
  --green: #00E676;
  --purple: #CE93D8;
  --text: #f0f0f5;
  --text2: #a0a0b0;
  --muted: #555;
  --bg-dark: #06040e;
  --panel-bg: rgba(8, 6, 16, 0.92);
  --glass-border: rgba(255, 255, 255, 0.08);
  --glass-highlight: rgba(255, 255, 255, 0.04);

  /* derived broadcast tokens */
  --red-dark: #aa0022;
  --gold-dark: #ff9500;
  --orange: #ff6b35;
  --announce-blue: #448AFF;

  /* spacing / layout */
  --screen-w: 1920px;
  --screen-h: 1080px;
  --right-panel-w: 490px;
  --scorecard-w: 420px;

  /* motion */
  --ease-out-expo: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-out-back: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-out-quad: cubic-bezier(0.25, 0.46, 0.45, 0.94);

  /* shadows */
  --shadow-sm: 0 2px 8px rgba(0,0,0,0.3);
  --shadow-md: 0 8px 32px rgba(0,0,0,0.4);
  --shadow-lg: 0 18px 50px rgba(0,0,0,0.5);
  --shadow-glow-red: 0 0 20px rgba(255,45,85,0.18);
  --shadow-glow-blue: 0 0 20px rgba(0,212,255,0.18);
  --shadow-glow-gold: 0 0 20px rgba(255,215,0,0.18);
}`
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Base body improvements (line-height, responsive base)
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /body \{\n  background: transparent;\n  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;\n  width: 1920px; height: 1080px;\n  overflow: hidden;\n  color: var\(--text\);\n  font-size: 14px;\n  line-height: 1\.5;\n\}/,
  `body {
  background: transparent;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  width: var(--screen-w); height: var(--screen-h);
  overflow: hidden;
  color: var(--text);
  font-size: 15px;
  line-height: 1.6;
}`
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Right Panel layout upgrade
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /#right-panel \{\n  position: fixed; top: 0; right: 0;\n  width: 400px; height: 1080px;\n  z-index: 10;\n  padding: 35px 24px 30px;\n  display: flex; flex-direction: column;\n  gap: 14px;\n  pointer-events: none;\n\}/,
  `#right-panel {
  position: fixed; top: 0; right: 0;
  width: var(--right-panel-w); height: var(--screen-h);
  z-index: 10;
  padding: 38px 28px 32px;
  display: flex; flex-direction: column;
  gap: 16px;
  pointer-events: none;
}`
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Donator card upgrade
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /\.donator-card \{\n  background: linear-gradient\(135deg, rgba\(255,215,0,0\.04\), transparent\);\n  border: 1px solid rgba\(255,215,0,0\.1\);\n  border-radius: 14px;\n  padding: 16px;\n  backdrop-filter: blur\(12px\);\n  pointer-events: auto;\n  position: relative;\n  overflow: hidden;\n  transition: all 0\.3s;\n\}/,
  `.donator-card {
  background:
    linear-gradient(135deg, rgba(255,215,0,0.08) 0%, rgba(255,255,255,0.02) 40%, transparent 70%);
  border: 1px solid rgba(255,215,0,0.18);
  border-radius: 16px;
  padding: 18px 18px 18px 64px;
  backdrop-filter: blur(16px) saturate(1.2);
  -webkit-backdrop-filter: blur(16px) saturate(1.2);
  pointer-events: auto;
  position: relative;
  overflow: visible;
  transition: border-color 0.3s, box-shadow 0.3s, transform 0.3s;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.05),
    0 6px 24px rgba(0,0,0,0.35),
    0 0 30px rgba(255,215,0,0.08);
}`
);

html = html.replace(
  /\.donator-card::before \{\n  content: ''; position: absolute; top: 0; right: 0;\n  width: 100px; height: 100px;\n  background: radial-gradient\(circle, rgba\(255,215,0,0\.08\), transparent 70%\);\n  pointer-events: none;\n\}/,
  `.donator-card::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 14px;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #fff5a0, var(--gold) 55%, #b8860b 100%);
  box-shadow: 0 0 16px rgba(255,215,0,0.45), 0 4px 10px rgba(0,0,0,0.3);
  pointer-events: none;
}
.donator-card::after {
  content: '★';
  position: absolute;
  top: 50%;
  left: 14px;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: rgba(0,0,0,0.45);
  font-weight: 900;
  pointer-events: none;
}`
);

html = html.replace(
  /\.donator-card:hover \{\n  border-color: rgba\(255,215,0,0\.2\);\n  box-shadow: 0 4px 20px rgba\(255,215,0,0\.08\);\n\}/,
  `.donator-card:hover {
  border-color: rgba(255,215,0,0.3);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.05),
    0 8px 30px rgba(0,0,0,0.4),
    0 0 40px rgba(255,215,0,0.14);
  transform: translateY(-2px);
}`
);

html = html.replace(
  /\.donator-name \{\n  font-size: 20px; font-weight: 900; color: var\(--gold\);\n  letter-spacing: -0\.5px;\n  transition: all 0\.3s;\n\}/,
  `.donator-name {
  font-size: 20px; font-weight: 900; color: var(--gold);
  letter-spacing: -0.5px;
}`
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Chat panel upgrade
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /#chat-panel \{\n  flex: 1; min-height: 0;\n  background: var\(--panel-bg\);\n  backdrop-filter: blur\(24px\);\n  border: 1px solid rgba\(255,45,85,0\.25\);\n  border-radius: 16px;\n  padding: 16px 14px 14px 16px;\n  display: flex; flex-direction: column;\n  box-shadow:\n    0 0 0 1px rgba\(255,45,85,0\.06\),\n    0 0 40px rgba\(255,45,85,0\.1\),\n    inset 0 0 60px rgba\(255,45,85,0\.02\);\n  position: relative;\n  overflow: hidden;\n  pointer-events: auto;\n\}/,
  `#chat-panel {
  flex: 1; min-height: 0;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 40%),
    linear-gradient(160deg, rgba(14, 12, 24, 0.78), rgba(8, 6, 16, 0.84));
  backdrop-filter: blur(24px) saturate(1.2);
  -webkit-backdrop-filter: blur(24px) saturate(1.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-top: 1px solid rgba(255, 45, 85, 0.22);
  border-left: 3px solid rgba(255, 45, 85, 0.32);
  border-radius: 18px;
  padding: 20px 18px 18px 20px;
  display: flex; flex-direction: column;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.05),
    0 14px 46px rgba(0,0,0,0.45),
    0 0 0 1px rgba(255,45,85,0.04);
  position: relative;
  overflow: hidden;
  pointer-events: auto;
}`
);

html = html.replace(
  /#chat-panel::before \{\n  content: ''; position: absolute; top: 0; left: 0; right: 0;\n  height: 2px;\n  background: linear-gradient\(90deg, transparent 5%, var\(--neon-red\) 40%, rgba\(255,45,85,0\.3\) 70%, transparent 95%\);\n  pointer-events: none;\n\}/,
  `#chat-panel::before {
  content: ''; position: absolute; top: 0; left: 12%; right: 12%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
  pointer-events: none;
}`
);

// Add inner sheen to chat panel (insert after ::before)
html = html.replace(
  /(#chat-panel::before \{[\s\S]*?pointer-events: none;\n\})/,
  `$1\n#chat-panel::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 35%);
  pointer-events: none;
}`
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Chat header upgrade
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /\.chat-hdr \{\n  display: flex; align-items: center; justify-content: space-between;\n  margin-bottom: 12px; padding-bottom: 10px;\n  border-bottom: 1px solid rgba\(255,45,85,0\.1\);\n  flex-shrink: 0;\n\}/,
  `.chat-hdr {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px; padding-bottom: 12px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  flex-shrink: 0;
}`
);

html = html.replace(
  /\.chat-hdr \.title \{\n  font-size: 11px; font-weight: 900;\n  text-transform: uppercase; letter-spacing: 3px;\n  color: rgba\(255,255,255,0\.85\);\n  display: flex; align-items: center; gap: 10px;\n\}/,
  `.chat-hdr .title {
  font-size: 12px; font-weight: 900;
  text-transform: uppercase; letter-spacing: 3.5px;
  color: rgba(255,255,255,0.88);
  display: flex; align-items: center; gap: 10px;
}`
);

html = html.replace(
  /\.chat-hdr \.count \{\n  background: rgba\(255,45,85,0\.08\);\n  color: rgba\(255,255,255,0\.35\);\n  border: 1px solid rgba\(255,45,85,0\.12\);\n  padding: 3px 10px; border-radius: 999px;\n  font-size: 10px; font-weight: 800;\n  transition: all 0\.3s;\n\}/,
  `.chat-hdr .count {
  background: rgba(255,45,85,0.08);
  color: rgba(255,255,255,0.35);
  border: 1px solid rgba(255,45,85,0.12);
  padding: 3px 10px; border-radius: 999px;
  font-size: 10px; font-weight: 800;
  transition: transform 0.3s, background-color 0.3s, color 0.3s;
}`
);

// ─────────────────────────────────────────────────────────────────────────────
// 7. Chat container + message upgrade
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /#chat-container \{\n  flex: 1; overflow: hidden;\n  display: flex; flex-direction: column;\n  justify-content: flex-end;\n  gap: 4px;\n  position: relative;\n\}/,
  `#chat-container {
  flex: 1; overflow: hidden;
  display: flex; flex-direction: column;
  justify-content: flex-end;
  gap: 8px;
  position: relative;
}`
);

html = html.replace(
  /\.msg \{\n  display: flex; flex-direction: column;\n  gap: 4px;\n  padding: 8px 12px 8px 14px;\n  border-radius: 10px;\n  cursor: pointer;\n  position: relative;\n  flex-shrink: 0;\n  background: rgba\(255,255,255,0\.025\);\n  border: 1px solid rgba\(255,255,255,0\.04\);\n  border-left: 3px solid rgba\(255,45,85,0\.4\);\n  transition: all 0\.2s ease;\n  overflow: hidden;\n  animation: msgEnter 0\.5s cubic-bezier\(0\.22, 1, 0\.36, 1\) forwards;\n\}/,
  `.msg {
  display: flex; flex-direction: column;
  gap: 7px;
  padding: 11px 14px 12px 16px;
  border-radius: 12px;
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  background: rgba(255,255,255,0.045);
  border: 1px solid rgba(255,255,255,0.05);
  border-left: 3px solid rgba(255,45,85,0.35);
  transition: transform 0.2s ease, background-color 0.2s ease, border-color 0.2s ease;
  overflow: hidden;
  animation: msgEnter 0.5s var(--ease-out-expo) forwards;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
}`
);

html = html.replace(
  /\.msg:hover \{\n  background: rgba\(255,255,255,0\.06\);\n  border-color: rgba\(255,255,255,0\.1\);\n  transform: translateX\(2px\);\n\}/,
  `.msg:hover {
  background: rgba(255,255,255,0.085);
  border-color: rgba(255,255,255,0.1);
  transform: translateX(3px);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.04),
    0 4px 12px rgba(0,0,0,0.2);
}`
);

html = html.replace(
  /\.msg \.msg-top \{\n  display: flex; align-items: center; gap: 8px;\n  padding-right: 50px;\n\}/,
  `.msg .msg-top {
  display: flex; align-items: center; gap: 10px;
  padding-right: 50px;
}`
);

html = html.replace(
  /\.msg \.name \{\n  font-size: 13px; font-weight: 800;\n  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;\n  max-width: 180px;\n  letter-spacing: -0\.2px;\n\}/,
  `.msg .name {
  font-size: 15px; font-weight: 800;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 240px;
  letter-spacing: 0;
}`
);

html = html.replace(
  /\.msg \.msg-time \{\n  font-size: 9px; color: var\(--muted\);\n  margin-left: auto;\n  font-weight: 600;\n  flex-shrink: 0;\n\}/,
  `.msg .msg-time {
  font-size: 10px; color: var(--muted);
  margin-left: auto;
  font-weight: 600;
  flex-shrink: 0;
}`
);

html = html.replace(
  /\.msg \.text \{\n  font-size: 12\.5px; color: rgba\(240,236,228,0\.75\);\n  font-weight: 500; line-height: 1\.45;\n  word-break: break-word;\n  padding-right: 20px;\n\}/,
  `.msg .text {
  font-size: 15px; color: rgba(244, 242, 240, 0.9);
  font-weight: 500; line-height: 1.55;
  word-break: break-word;
  padding-right: 18px;
}`
);

html = html.replace(
  /\.msg-action-btn \{\n  width: 22px; height: 22px;\n  border-radius: 6px;\n  border: none;\n  background: rgba\(255,255,255,0\.1\);\n  color: var\(--text2\);\n  font-size: 11px;\n  cursor: pointer;\n  display: flex; align-items: center; justify-content: center;\n  transition: all 0\.15s;\n\}/,
  `.msg-action-btn {
  width: 24px; height: 24px;
  border-radius: 7px;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(0,0,0,0.25);
  color: var(--text2);
  font-size: 11px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: transform 0.15s, background-color 0.15s, color 0.15s;
}`
);

html = html.replace(
  /\.msg-action-btn:hover \{ background: rgba\(255,255,255,0\.2\); color: var\(--text\); \}/,
  `.msg-action-btn:hover {
  background: rgba(255,255,255,0.14);
  color: var(--text);
  transform: translateY(-1px);
}`
);

// Remove redundant .msg.chat rule
html = html.replace(/\.msg\.chat \{ border-left-color: rgba\(255,45,85,0\.4\); \}\n/, '');

// ─────────────────────────────────────────────────────────────────────────────
// 8. Message variants upgrade
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /\.msg\.pinned \{\n  border-left-color: var\(--gold\);\n  background: linear-gradient\(90deg, rgba\(255,215,0,0\.04\), rgba\(255,255,255,0\.03\)\);\n\}\n\.msg\.superchat \{ border-left-color: var\(--gold\); background: linear-gradient\(90deg, rgba\(255,215,0,0\.03\), rgba\(255,255,255,0\.02\)\); \}\n\.msg\.membership \{ border-left-color: var\(--green\); background: linear-gradient\(90deg, rgba\(0,230,118,0\.03\), rgba\(255,255,255,0\.02\)\); \}\n\.msg\.moderator \{ border-left-color: var\(--neon-blue\); background: linear-gradient\(90deg, rgba\(0,212,255,0\.03\), rgba\(255,255,255,0\.02\)\); \}\n\.msg\.announcement \{ border-left-color: #448AFF; background: linear-gradient\(90deg, rgba\(68,138,255,0\.03\), rgba\(255,255,255,0\.02\)\); \}/,
  `.msg.pinned {
  border-left-color: var(--gold);
  background: linear-gradient(90deg, rgba(255,215,0,0.06), rgba(255,255,255,0.04));
}
.msg.superchat { border-left-color: var(--gold); background: linear-gradient(90deg, rgba(255,215,0,0.05), rgba(255,255,255,0.03)); }
.msg.membership { border-left-color: var(--green); background: linear-gradient(90deg, rgba(0,230,118,0.05), rgba(255,255,255,0.03)); }
.msg.moderator { border-left-color: var(--neon-blue); background: linear-gradient(90deg, rgba(0,212,255,0.05), rgba(255,255,255,0.03)); }
.msg.announcement { border-left-color: #448AFF; background: linear-gradient(90deg, rgba(68,138,255,0.05), rgba(255,255,255,0.03)); }`
);

// ─────────────────────────────────────────────────────────────────────────────
// 9. msgEnter animation — remove brightness filter
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /@keyframes msgEnter \{\n  0% \{ transform: translateX\(20px\) scale\(0\.95\); opacity: 0; filter: brightness\(2\); \}\n  100% \{ transform: translateX\(0\) scale\(1\); opacity: 1; filter: brightness\(1\); \}\n\}/,
  `@keyframes msgEnter {
  0% { transform: translateX(20px) scale(0.95); opacity: 0; }
  100% { transform: translateX(0) scale(1); opacity: 1; }
}`
);

// ─────────────────────────────────────────────────────────────────────────────
// 10. msgExit animation — remove reflow properties
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /@keyframes msgExit \{\n  0%   \{ opacity: 1; transform: translateY\(0\) scale\(1\); max-height: 200px; margin-bottom: 4px; \}\n  100% \{ opacity: 0; transform: translateY\(-12px\) scale\(0\.92\); max-height: 0; margin-bottom: 0; padding-top: 0; padding-bottom: 0; border-width: 0; \}\n\}/,
  `@keyframes msgExit {
  0%   { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(-12px) scale(0.92); }
}`
);

html = html.replace(
  /\.msg\.exiting \{\n  animation: msgExit 0\.4s cubic-bezier\(0\.4, 0, 1, 1\) forwards;\n  pointer-events: none;\n\}/,
  `.msg.exiting {
  animation: msgExit 0.4s cubic-bezier(0.4, 0, 1, 1) forwards;
  pointer-events: none;
  will-change: transform, opacity;
}`
);

// ─────────────────────────────────────────────────────────────────────────────
// 11. Superchat panel upgrade
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /#superchat-panel \{\n  background: rgba\(255,215,0,0\.03\);\n  border: 1px solid rgba\(255,215,0,0\.1\);\n  border-radius: 12px;\n  padding: 12px;\n  flex-shrink: 0;\n  max-height: 100px;\n  overflow: hidden;\n  pointer-events: auto;\n\}/,
  `#superchat-panel {
  background: linear-gradient(180deg, rgba(255,215,0,0.05), rgba(255,255,255,0.02));
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-top: 2px solid rgba(255, 215, 0, 0.18);
  border-radius: 14px;
  padding: 12px 14px;
  flex-shrink: 0;
  max-height: 110px;
  overflow: hidden;
  pointer-events: auto;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.04),
    0 8px 26px rgba(0,0,0,0.3);
}`
);

// ─────────────────────────────────────────────────────────────────────────────
// 12. Show Comment overlay — full redesign
// ─────────────────────────────────────────────────────────────────────────────

// Container padding
html = html.replace(
  /#show-comment \{\n  position: fixed; inset: 0;\n  z-index: 100;\n  display: none; align-items: flex-end; justify-content: flex-start;\n  padding: 0 0 16px 60px;\n  pointer-events: none;\n\}/,
  `#show-comment {
  position: fixed; inset: 0;
  z-index: 100;
  display: none; align-items: flex-end; justify-content: flex-start;
  padding: 0 0 40px 70px;
  pointer-events: none;
}`
);

// Backdrop radial vignette
html = html.replace(
  /\.sc-backdrop \{\n  position: absolute; inset: 0;\n  background: rgba\(0,0,0,0\.3\);\n  cursor: pointer;\n  animation: fadeIn 0\.25s ease;\n\}/,
  `.sc-backdrop {
  position: absolute; inset: 0;
  background: radial-gradient(
    ellipse at 20% 100%,
    rgba(0, 0, 0, 0.45) 0%,
    rgba(0, 0, 0, 0.18) 45%,
    transparent 75%
  );
  cursor: pointer;
  animation: fadeIn 0.3s ease;
}`
);

// Card redesign
html = html.replace(
  /\.sc-card \{\n  position: relative; z-index: 2;\n  width: 520px;\n  background: linear-gradient\(160deg, rgba\(12,9,20,0\.95\), rgba\(6,4,14,0\.97\)\);\n  backdrop-filter: blur\(32px\);\n  border: 1px solid rgba\(255,45,85,0\.15\);\n  border-radius: 20px;\n  padding: 20px 24px 20px 20px;\n  animation: scCardIn 0\.6s cubic-bezier\(0\.25, 0\.46, 0\.45, 0\.94\) forwards;\n  pointer-events: auto;\n  overflow: hidden;\n  display: flex; flex-direction: column;\n  gap: 8px;\n\}/,
  `.sc-card {
  position: relative; z-index: 2;
  width: 700px;
  background:
    linear-gradient(160deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 35%),
    linear-gradient(160deg, rgba(18, 15, 28, 0.86), rgba(8, 6, 16, 0.92));
  backdrop-filter: blur(32px) saturate(1.25);
  -webkit-backdrop-filter: blur(32px) saturate(1.25);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-left: none;
  border-radius: 22px;
  padding: 28px 32px 28px 90px;
  animation: scCardIn 0.6s var(--ease-out-quad) forwards;
  pointer-events: auto;
  overflow: visible;
  display: flex; flex-direction: column;
  gap: 12px;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.07),
    0 26px 70px rgba(0, 0, 0, 0.55),
    0 10px 28px rgba(0, 0, 0, 0.35),
    0 0 40px var(--user-color, rgba(255, 45, 85, 0.12));
}`
);

html = html.replace(
  /\.sc-card::before \{\n  content: ''; position: absolute; left: 0; top: 0; bottom: 0;\n  width: 4px;\n  background: var\(--neon-red\);\n  border-radius: 4px 0 0 4px;\n\}/,
  `.sc-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 12px;
  bottom: 12px;
  width: 5px;
  background: var(--user-color, var(--neon-red));
  border-radius: 0 4px 4px 0;
  box-shadow:
    0 0 14px var(--user-color, var(--neon-red)),
    0 0 30px var(--user-color, var(--neon-red));
  opacity: 0.9;
}`
);

// Add inner sheen pseudo-element
html = html.replace(
  /(\.sc-card::before \{[\s\S]*?opacity: 0\.9;\n\})/,
  `$1\n.sc-card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255,255,255,0.06), transparent 40%);
  pointer-events: none;
}`
);

// Top row
html = html.replace(
  /\.sc-top \{\n  display: flex; align-items: center; gap: 10px;\n\}/,
  `.sc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  position: relative;
  z-index: 1;
}`
);

html = html.replace(
  /\.sc-pill \{\n  display: inline-flex; align-items: center; gap: 10px;\n  background: linear-gradient\(135deg, rgba\(255,45,85,0\.85\), rgba\(140,0,30,0\.9\)\);\n  border-radius: 999px;\n  padding: 4px 16px 4px 4px;\n  box-shadow: 0 2px 12px rgba\(255,45,85,0\.25\);\n\}/,
  `.sc-pill {
  display: flex;
  align-items: center;
  gap: 14px;
  background: transparent;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
}`
);

html = html.replace(
  /\.sc-avatar \{\n  width: 32px; height: 32px; border-radius: 50%;\n  background: rgba\(255,255,255,0\.12\);\n  display: flex; align-items: center; justify-content: center;\n  font-size: 13px; font-weight: 900; color: #fff;\n  flex-shrink: 0;\n  overflow: hidden;\n\}/,
  `.sc-avatar {
  position: absolute;
  left: -34px;
  top: 50%;
  transform: translateY(-50%);
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(20, 16, 34, 0.95);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 900;
  color: #fff;
  flex-shrink: 0;
  overflow: hidden;
  border: 3px solid var(--user-color, var(--neon-red));
  box-shadow:
    0 0 0 4px rgba(6, 4, 14, 0.6),
    0 0 22px var(--user-color, var(--neon-red)),
    0 10px 24px rgba(0, 0, 0, 0.45);
  z-index: 3;
}`
);

html = html.replace(
  /\.sc-name \{\n  font-size: 14px; font-weight: 800; color: #fff;\n  white-space: nowrap; letter-spacing: 0px;\n\}/,
  `.sc-name {
  font-size: 19px;
  font-weight: 800;
  color: var(--user-color, #fff);
  white-space: nowrap;
  letter-spacing: 0.2px;
  text-shadow: 0 0 16px var(--user-color, transparent);
}`
);

html = html.replace(
  /\.sc-badge \{\n  display: inline-block; font-size: 9px; font-weight: 800;\n  padding: 3px 12px; border-radius: 999px;\n  text-transform: uppercase; letter-spacing: 1px;\n  white-space: nowrap;\n  backdrop-filter: blur\(10px\);\n\}/,
  `.sc-badge {
  display: inline-block;
  font-size: 9px;
  font-weight: 800;
  padding: 4px 12px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 1px;
  white-space: nowrap;
  backdrop-filter: blur(10px);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text2);
}`
);

html = html.replace(
  /\.sc-msg \{\n  font-size: 18px; color: var\(--text\);\n  font-weight: 500; line-height: 1\.5;\n  word-break: break-word; white-space: pre-wrap;\n  padding: 0 4px;\n  letter-spacing: 0px;\n\}/,
  `.sc-msg {
  font-size: 30px;
  color: rgba(255, 255, 255, 0.96);
  font-weight: 600;
  line-height: 1.45;
  word-break: break-word;
  white-space: pre-wrap;
  padding: 6px 8px;
  letter-spacing: 0.1px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  position: relative;
  z-index: 1;
}`
);

html = html.replace(
  /\.sc-meta \{\n  display: flex; align-items: center; gap: 10px;\n  margin-top: 2px;\n\}/,
  `.sc-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  position: relative;
  z-index: 1;
}`
);

html = html.replace(
  /\.sc-bar \{\n  flex: 1; height: 2px;\n  background: linear-gradient\(90deg, var\(--neon-red\), transparent\);\n  border-radius: 1px;\n\}/,
  `.sc-bar {
  flex: 1;
  height: 3px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
  position: relative;
}
.sc-bar::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    var(--user-color, var(--neon-red)) 0%,
    rgba(255, 255, 255, 0.55) 50%,
    var(--user-color, var(--neon-red)) 100%
  );
  background-size: 200% 100%;
  animation: scBarShimmer 2s linear infinite;
}`
);

html = html.replace(
  /\.sc-timer \{\n  width: 100px; height: 2px;\n  background: rgba\(255,255,255,0\.06\);\n  border-radius: 1px;\n  overflow: hidden;\n  flex-shrink: 0;\n\}/,
  `.sc-timer {
  width: 110px;
  height: 3px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
  flex-shrink: 0;
}`
);

html = html.replace(
  /\.sc-timer-fill \{\n  height: 100%; background: linear-gradient\(90deg, var\(--neon-red\), var\(--neon-blue\)\);\n  width: 100%;\n  transform-origin: left;\n  animation: timerShrink var\(--auto-dismiss, 12s\) linear forwards;\n\}/,
  `.sc-timer-fill {
  height: 100%;
  background: linear-gradient(
    90deg,
    var(--user-color, var(--neon-red)),
    rgba(255, 255, 255, 0.7)
  );
  width: 100%;
  transform-origin: left;
  animation: timerShrink var(--auto-dismiss, 12s) linear forwards;
  box-shadow: 0 0 10px var(--user-color, var(--neon-red));
  will-change: transform;
}`
);

html = html.replace(
  /\.sc-hint \{\n  font-size: 9px; color: rgba\(255,255,255,0\.1\);\n  font-weight: 600; letter-spacing: 0\.5px;\n  white-space: nowrap;\n\}/,
  `.sc-hint {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.22);
  font-weight: 600;
  letter-spacing: 0.6px;
  white-space: nowrap;
}`
);

// Update scCardIn keyframes
html = html.replace(
  /@keyframes scCardIn \{\n  0% \{ transform: translateX\(-30px\) scale\(0\.95\); opacity: 0; \}\n  100% \{ transform: translateX\(0\) scale\(1\); opacity: 1; \}\n\}/,
  `@keyframes scCardIn {
  0% { transform: translateX(-40px) scale(0.94); opacity: 0; }
  60% { transform: translateX(6px) scale(1.01); opacity: 1; }
  100% { transform: translateX(0) scale(1); opacity: 1; }
}`
);

// Add scBarShimmer keyframe
html = html.replace(
  /@keyframes shimmer \{\n  0% \{ transform: translateX\(-100%\); \}\n  100% \{ transform: translateX\(100%\); \}\n\}/,
  `@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

@keyframes scBarShimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}`
);

// ─────────────────────────────────────────────────────────────────────────────
// 13. Brand bar upgrade
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /#brand-bar \{\n  position: fixed; top: 16px; left: 24px; z-index: 30;\n  display: flex; align-items: center; gap: 12px;\n  background: rgba\(8, 6, 16, 0\.85\);\n  backdrop-filter: blur\(16px\);\n  border: 1px solid rgba\(255,255,255,0\.06\);\n  border-radius: 14px;\n  padding: 10px 18px 10px 12px;\n  pointer-events: none;\n\}/,
  `#brand-bar {
  position: fixed; top: 16px; left: 24px; z-index: 30;
  display: flex; align-items: center; gap: 12px;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 40%),
    linear-gradient(180deg, rgba(16, 14, 26, 0.74), rgba(8, 6, 16, 0.80));
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  padding: 10px 18px 10px 12px;
  pointer-events: none;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.05),
    0 10px 28px rgba(0,0,0,0.35);
}`
);

html = html.replace(
  /#brand-name \{\n  font-size: 13px; font-weight: 800; letter-spacing: -0\.2px; \}/,
  `#brand-name { font-size: 15px; font-weight: 800; letter-spacing: 0; }`
);

html = html.replace(
  /#brand-live \{ display: flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 800; color: var\(--neon-red\); letter-spacing: 2px; text-transform: uppercase; \}/,
  `#brand-live { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 800; color: var(--neon-red); letter-spacing: 1.8px; text-transform: uppercase; }`
);

// ─────────────────────────────────────────────────────────────────────────────
// 14. Scorecard typography upgrade
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /\.sc-t-name \{\n  font-size: 13px; font-weight: 800; color: var\(--text\);\n  margin-bottom: 6px; letter-spacing: 0;\n  text-shadow: 0 1px 2px rgba\(0,0,0,0\.3\);\n  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\n  max-width: 100%;\n\}/,
  `.sc-t-name {
  font-size: 15px; font-weight: 800; color: var(--text);
  margin-bottom: 8px; letter-spacing: 0.1px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 100%;
}`
);

html = html.replace(
  /\.sc-t-score \{\n  font-size: 28px; font-weight: 900;\n  background: linear-gradient\(135deg, var\(--gold\), #ff9500, var\(--gold\)\);\n  background-size: 200% 200%;\n  -webkit-background-clip: text; -webkit-text-fill-color: transparent;\n  background-clip: text; line-height: 1;\n  letter-spacing: -1px;\n  animation: scScoreShimmer 3s ease-in-out infinite;\n  filter: drop-shadow\(0 0 8px rgba\(255,215,0,0\.15\)\);\n  transition: filter 0\.3s;\n  white-space: nowrap;\n  font-variant-numeric: tabular-nums;\n\}/,
  `.sc-t-score {
  font-size: 30px; font-weight: 900;
  background: linear-gradient(135deg, var(--gold), var(--gold-dark), var(--gold));
  background-size: 200% 200%;
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text; line-height: 1.05;
  letter-spacing: -1px;
  animation: scScoreShimmer 3s ease-in-out infinite;
  filter: drop-shadow(0 0 8px rgba(255,215,0,0.15));
  transition: filter 0.3s;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}`
);

html = html.replace(
  /\.sc-t-score\.blank \{\n  font-size: 15px;\n  -webkit-text-fill-color: var\(--muted\);\n  background: none;\n  color: var\(--muted\);\n  letter-spacing: 0;\n  animation: none;\n\}/,
  `.sc-t-score.blank {
  font-size: 17px;
  -webkit-text-fill-color: var(--muted);
  background: none;
  color: var(--muted);
  letter-spacing: 0;
  animation: none;
}`
);

html = html.replace(
  /\.sc-t-ov \{\n  font-size: 10px; color: var\(--muted\); margin-top: 6px; font-weight: 700;\n  letter-spacing: 0\.5px;\n  min-height: 12px;\n\}/,
  `.sc-t-ov {
  font-size: 11px; color: var(--muted); margin-top: 7px; font-weight: 700;
  letter-spacing: 0.5px;
  min-height: 12px;
}`
);

html = html.replace(
  /\.sc-status \{\n  margin-top: 10px; padding-top: 10px;\n  border-top: 1px solid rgba\(255,45,85,0\.06\);\n  font-size: 12px; color: var\(--text2\); font-weight: 700;\n  text-align: center;\n  animation: scStatusFadeIn 0\.5s ease both;\n  overflow: hidden;\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n\}/,
  `.sc-status {
  margin-top: 12px; padding-top: 12px;
  border-top: 1px solid rgba(255,45,85,0.06);
  font-size: 14px; color: var(--text2); font-weight: 700;
  line-height: 1.5;
  text-align: center;
  animation: scStatusFadeIn 0.5s ease both;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}`
);

// Scorecard glass upgrade
html = html.replace(
  /#scorecard \{\n  position: fixed; top: 92px; left: 24px;\n  width: 420px;\n  max-height: calc\(1080px - 160px\);\n  background: linear-gradient\(160deg, rgba\(10,8,18,0\.96\), rgba\(6,4,14,0\.98\)\);\n  backdrop-filter: blur\(24px\) saturate\(1\.4\);\n  border: 1px solid rgba\(255,45,85,0\.1\);\n  border-radius: 18px;\n  overflow: hidden;\n  box-shadow:\n    0 8px 32px rgba\(0,0,0,0\.5\),\n    0 0 60px rgba\(0,0,0,0\.3\),\n    inset 0 1px 0 rgba\(255,255,255,0\.04\);\n  z-index: 20;\n  pointer-events: none;\n  transition: opacity 0\.5s cubic-bezier\(0\.22, 1, 0\.36, 1\), transform 0\.5s cubic-bezier\(0\.22, 1, 0\.36, 1\);\n  animation: scCardEntry 0\.8s cubic-bezier\(0\.34, 1\.56, 0\.64, 1\) both;\n\}/,
  `#scorecard {
  position: fixed; top: 92px; left: 24px;
  width: var(--scorecard-w);
  max-height: calc(var(--screen-h) - 160px);
  background:
    linear-gradient(160deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 30%),
    linear-gradient(160deg, rgba(16, 14, 26, 0.84), rgba(8, 6, 14, 0.90));
  backdrop-filter: blur(24px) saturate(1.3);
  -webkit-backdrop-filter: blur(24px) saturate(1.3);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  overflow: hidden;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.05),
    0 18px 50px rgba(0,0,0,0.5),
    0 0 0 1px rgba(255,45,85,0.04);
  z-index: 20;
  pointer-events: none;
  transition: opacity 0.5s var(--ease-out-expo), transform 0.5s var(--ease-out-expo);
  animation: scCardEntry 0.8s var(--ease-out-back) both;
}`
);

html = html.replace(
  /#scorecard::before \{\n  content: ''; position: absolute; inset: 0;\n  background: url\("data:image\/svg\+xml,%3Csvg viewBox='0 0 256 256' xmlns='http:\/\/www\.w3\.org\/2000\/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0\.9' numOctaves='4' stitchTiles='stitch'\/%3E%3C\/filter%3E%3Crect width='100%25' height='100%25' filter='url\(%23n\)' opacity='0\.03'\/%3E%3C\/svg%3E"\);\n  pointer-events: none; z-index: 0; border-radius: 18px;\n\}/,
  `#scorecard::before {
  content: ''; position: absolute; inset: 0;
  background: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
  pointer-events: none; z-index: 0; border-radius: inherit; opacity: 0.6;
}`
);

// ─────────────────────────────────────────────────────────────────────────────
// 15. Scorecard rotating border — GPU rotate instead of @property repaint
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /@property --sc-angle \{\n  syntax: '<angle>';\n  initial-value: 0deg;\n  inherits: false;\n\}\n\n#scorecard::after \{\n  content: ''; position: absolute; inset: -1px;\n  border-radius: 18px;\n  background: conic-gradient\(from var\(--sc-angle\), transparent 0%, rgba\(255,45,85,0\.15\) 25%, transparent 50%, rgba\(0,212,255,0\.15\) 75%, transparent 100%\);\n  animation: scBorderRotate 6s linear infinite;\n  pointer-events: none; z-index: -1;\n  mask: linear-gradient\(#fff 0 0\) content-box, linear-gradient\(#fff 0 0\);\n  mask-composite: exclude;\n  -webkit-mask-composite: xor;\n  padding: 1px;\n\}\n\n@keyframes scBorderRotate \{\n  to \{ --sc-angle: 360deg; \}\n\}/,
  `#scorecard::after {
  content: ''; position: absolute; inset: -1px;
  border-radius: 20px;
  background: conic-gradient(
    from 0deg,
    transparent 0%,
    rgba(255,45,85,0.15) 25%,
    transparent 50%,
    rgba(0,212,255,0.15) 75%,
    transparent 100%
  );
  animation: scBorderRotate 6s linear infinite;
  pointer-events: none; z-index: -1;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  -webkit-mask-composite: xor;
  padding: 1px;
  will-change: transform;
}

@keyframes scBorderRotate {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}`
);

// ─────────────────────────────────────────────────────────────────────────────
// 16. Bottom bar upgrade
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /#bottom-bar \{\n  position: fixed; bottom: 0; left: 0; width: 1920px;\n  z-index: 4; pointer-events: none;\n  padding: 20px 60px 28px;\n  background: linear-gradient\(0deg, rgba\(0,0,0,0\.5\), transparent\);\n  text-align: center;\n  display: flex; flex-direction: column; align-items: center;\n  gap: 4px;\n\}/,
  `#bottom-bar {
  position: fixed; bottom: 0; left: 0; width: var(--screen-w);
  z-index: 4; pointer-events: none;
  padding: 22px 60px 30px;
  background: linear-gradient(0deg, rgba(0,0,0,0.55), transparent);
  text-align: center;
  display: flex; flex-direction: column; align-items: center;
  gap: 7px;
}`
);

html = html.replace(
  /#bottom-bar \.bb-brand \{\n  font-size: 14px; font-weight: 800;\n  text-transform: uppercase; letter-spacing: 5px;\n  color: rgba\(255,215,0,0\.2\);\n  text-shadow: 0 0 20px rgba\(255,215,0,0\.05\);\n\}/,
  `#bottom-bar .bb-brand {
  font-size: 16px; font-weight: 800;
  text-transform: uppercase; letter-spacing: 3.5px;
  color: rgba(255, 215, 0, 0.55);
  text-shadow: 0 0 20px rgba(255, 215, 0, 0.12);
}`
);

html = html.replace(
  /#bottom-bar \.bb-social \{\n  font-size: 10px; color: rgba\(255,255,255,0\.1\);\n  font-weight: 700; letter-spacing: 2px;\n\}/,
  `#bottom-bar .bb-social {
  font-size: 11px; color: rgba(255, 255, 255, 0.35);
  font-weight: 700; letter-spacing: 1.5px;
}`
);

// ─────────────────────────────────────────────────────────────────────────────
// 17. Control panel — replace max-height with transform (safer visual)
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /#ctrl-body \{\n  width: 100%;\n  background: rgba\(4, 3, 10, 0\.98\);\n  border-top: 1px solid rgba\(255,45,85,0\.12\);\n  max-height: 0;\n  overflow: hidden;\n  transition: max-height 0\.4s cubic-bezier\(0\.22, 1, 0\.36, 1\);\n  display: flex; flex-direction: column;\n\}\n#ctrl-panel\.open #ctrl-body \{ max-height: 500px; \}/,
  `#ctrl-body {
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
    transform 0.4s var(--ease-out-expo),
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
    transform 0.4s var(--ease-out-expo),
    opacity 0.3s ease,
    visibility 0s;
}`
);

// ─────────────────────────────────────────────────────────────────────────────
// 18. Add containment to overlay roots for paint isolation
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /\/\* ════════════════════════════════════════\n   BOTTOM BAR\n   ════════════════════════════════════════ \*\//,
  `#right-panel,
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

/* ════════════════════════════════════════
   BOTTOM BAR
   ════════════════════════════════════════ */`
);

// ─────────────────────────────────────────────────────────────────────────────
// 19. Minimal JS change: expose --user-color on .sc-card for CSS
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /const card = document\.querySelector\('\.sc-card'\);\n  card\.style\.borderColor = c \+ '44';/,
  `const card = document.querySelector('.sc-card');
  card.style.setProperty('--user-color', c);
  card.style.borderColor = c + '44';`
);

// ─────────────────────────────────────────────────────────────────────────────
// 20. Add responsive media queries at the end of the style block
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  /(::-webkit-scrollbar-thumb:hover \{ background: rgba\(255,255,255,0\.2\); \}\n<\/style>)/,
  `$1\n<style>
/* ---------- Responsive scaling ---------- */
@media (max-width: 720px) {
  #right-panel { width: 320px; padding: 24px 16px 22px; }
  .msg { padding: 9px 12px 10px 13px; gap: 5px; }
  .msg .name, .msg .text { font-size: 13px; line-height: 1.5; }
  #scorecard { width: 300px; left: 14px; top: 78px; }
  .sc-t-name { font-size: 13px; }
  .sc-t-score { font-size: 22px; }
  .sc-status { font-size: 12px; }
  .sc-card { width: 88vw; max-width: 420px; padding-left: 70px; }
  .sc-avatar { width: 52px; height: 52px; left: -26px; font-size: 18px; }
  .sc-name { font-size: 16px; }
  .sc-msg { font-size: 22px; line-height: 1.45; }
  #brand-bar { top: 10px; left: 12px; padding: 8px 14px 8px 10px; }
  #brand-name { font-size: 13px; }
  #bottom-bar .bb-brand { font-size: 13px; letter-spacing: 2.5px; }
  #bottom-bar .bb-social { font-size: 9px; }
}

@media (max-aspect-ratio: 9/16) {
  #right-panel { width: 100%; height: auto; top: auto; bottom: 130px; right: 0; left: 0; padding: 0 16px; flex-direction: column-reverse; gap: 10px; }
  #chat-panel { max-height: 32vh; border-radius: 14px; }
  .msg .name, .msg .text { font-size: 14px; line-height: 1.55; }
  #scorecard, #brand-bar, #bottom-bar { display: none; }
  .sc-card { width: calc(100% - 32px); left: 16px; right: 16px; }
  .sc-msg { font-size: 24px; line-height: 1.45; }
}

@media (min-width: 1921px), (min-height: 1081px) {
  .msg .name, .msg .text { font-size: 17px; line-height: 1.6; }
  .sc-t-name { font-size: 17px; }
  .sc-t-score { font-size: 34px; }
  .sc-status { font-size: 16px; }
  .sc-msg { font-size: 34px; line-height: 1.5; }
  .sc-name { font-size: 20px; }
  #bottom-bar .bb-brand { font-size: 18px; letter-spacing: 4px; }
  #bottom-bar .bb-social { font-size: 13px; }
}
</style>`
);

// ─────────────────────────────────────────────────────────────────────────────
// Write result
// ─────────────────────────────────────────────────────────────────────────────
fs.writeFileSync(filePath, html, 'utf8');
console.log('Visual upgrade applied to', filePath);
