/* NOTE UDAANA v5: bottom-anchored cinematic emerald money shower.
 * Contact -> slide across top sheet -> edge release -> short follow-through.
 * The existing shared FIFO/WS contract is intentionally unchanged.
 */
(function () {
  'use strict';
  if (window.MoneyFX) return;
  const DURATION = 15000, W = 1920, H = 1080;
  const RIG = { width: 288, height: 416, left: 60, right: 1572, top: 660, scale: .8 };
  const clamp = n => Math.max(0, Math.min(1, n));
  const mix = (a, b, t) => a + (b - a) * t;
  const BUNDLE = { x: 211, y: 211, angle: -19, width: 76, contactY: 10 };
  function rotatePoint(x, y, degrees) {
    const a = degrees * Math.PI / 180;
    return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
  }
  const ease = n => 1 - Math.pow(1 - clamp(n), 3);
  const smooth = n => { n = clamp(n); return n * n * (3 - 2 * n); };
  const pop = n => {
    n = clamp(n);
    if (n < .55) return mix(.08, 1.17, ease(n / .55));
    if (n < .8) return mix(1.17, .96, smooth((n - .55) / .25));
    return mix(.96, 1, smooth((n - .8) / .2));
  };
  let root, world, canvas, ctx, donor, actors, emblem, label, nameEl, nameGlint, payment, thanks;
  let raf = 0, endTimer = 0, playing = false, started = 0, last = 0;
  const FRAME_INTERVAL = 1000 / 60;
  let lastDraw = 0;
  let frames = 0, longFrames = 0, maxGap = 0, reason = 'idle', time = 0;
  let releaseCount = 0, directionErrors = 0;
  let peakNotes = 0, maxRenderMs = 0;
  const frameGaps = [], renderCosts = [];
  const notes = Array.from({ length: 112 }, () => ({ active: false }));
  const releases = []; // bounded instrumentation, no DOM per banknote
  const seen = new Set(), storageKey = 'money-fx-seen-v1';
  try { JSON.parse(sessionStorage.getItem(storageKey) || '[]').slice(-2000).forEach(id => seen.add(id)); } catch (_) { /* optional storage */ }
  function remember(id) {
    if (!id) return;
    seen.add(id); while (seen.size > 2000) seen.delete(seen.values().next().value);
    try { sessionStorage.setItem(storageKey, JSON.stringify([...seen])); } catch (_) { /* file/private mode */ }
  }
  function emit(type, detail = {}) {
    document.dispatchEvent(new CustomEvent('money-fx', { detail: { type, ...detail } }));
  }

  /* Draw a high-resolution Indian-style prop note once, shared by the gaddi,
       * the sliding top sheet and the paper mesh. Not US dollars, not a blank rectangle.
   * Fictional issue/portrait and a visible PROP mark: not a banknote scan. */
  const sprite = document.createElement('canvas'); sprite.width = 360; sprite.height = 166;
  const pen = sprite.getContext('2d');
  const paper = pen.createLinearGradient(0, 0, 360, 166);
  paper.addColorStop(0, '#d8f5b9'); paper.addColorStop(.5, '#72b787'); paper.addColorStop(1, '#c9edb0');
  pen.fillStyle = paper; pen.fillRect(0, 0, 360, 166);
  pen.strokeStyle = '#687a72'; pen.lineWidth = 3; pen.strokeRect(5, 5, 350, 156);
  pen.lineWidth = 1; pen.strokeRect(11, 11, 338, 144);
  pen.save(); pen.beginPath(); pen.rect(14, 14, 332, 138); pen.clip();
  pen.strokeStyle = '#83988b'; pen.globalAlpha = .20;
  for (let j = 0; j < 10; j++) {
    pen.beginPath();
    for (let x = 0; x <= 360; x += 3) {
      const y = 25 + j * 12 + Math.sin(x * .045 + j * .6) * 4;
      if (!x) pen.moveTo(x, y); else pen.lineTo(x, y);
    }
    pen.stroke();
  }
  pen.restore();
  pen.fillStyle = '#dce1d4'; pen.beginPath(); pen.ellipse(174, 86, 46, 58, 0, 0, Math.PI * 2); pen.fill();
  // A fictional moustached wedding guest medallion (not a real currency portrait).
  pen.fillStyle = '#7e8b7d'; pen.beginPath(); pen.ellipse(174, 72, 20, 26, -.08, 0, 7); pen.fill();
  pen.beginPath(); pen.ellipse(174, 112, 31, 19, 0, Math.PI, Math.PI * 2); pen.fill();
  pen.fillStyle = '#dce1d4'; pen.fillRect(166, 64, 7, 3); pen.fillRect(179, 64, 7, 3);
  pen.strokeStyle = '#596e60'; pen.lineWidth = 3; pen.beginPath(); pen.moveTo(169, 84); pen.quadraticCurveTo(177, 90, 185, 81); pen.stroke();
  pen.fillStyle = '#416653'; pen.font = '900 43px Arial'; pen.fillText('₹500', 19, 68);
  pen.font = '900 31px Arial'; pen.fillText('५००', 264, 131);
  pen.fillStyle = '#2f5448'; pen.font = 'bold 13px Arial'; pen.fillText('मस्ती बैंक • CELEBRATION', 19, 27);
  pen.font = 'bold 10px Arial'; pen.fillText('FIVE HUNDRED • PROP ONLY', 20, 146);
  pen.font = '10px monospace'; pen.fillText('FUN 00500', 242, 147);
  pen.fillStyle = '#677e71'; pen.fillRect(232, 16, 6, 135);
  pen.fillStyle = '#c4ded5'; for (let y = 18; y < 148; y += 12) pen.fillRect(234, y, 2, 6);
  pen.strokeStyle = '#738a7b'; pen.lineWidth = 2;
  for (let j = 0; j < 4; j++) { pen.beginPath(); pen.ellipse(291, 67, 35 - j * 5, 30 - j * 4, 0, 0, 7); pen.stroke(); }
  pen.fillStyle = '#56715e'; pen.font = '900 22px Arial'; pen.fillText('₹', 283, 76);
  const noteURL = sprite.toDataURL();
  // Bake paper curvature once. One blit per flying note instead of eight
  // high-resolution texture slices per note per frame.
  const billFrames = Array.from({ length: 16 }, (_, index) => {
    const c = document.createElement('canvas'); c.width = 96; c.height = 50;
    const p = c.getContext('2d');
    for (let j = 0; j < 8; j++) {
      const bend = Math.sin(j / 8 * Math.PI * 2 + index / 16 * Math.PI * 2) * 1.5;
      p.drawImage(sprite, j * 45, 0, 45, 166, j * 12, 3 + bend, 12.5, 44);
    }
    return c;
  });

  // Bake translucent lighting once; no per-frame blur/filter or opaque wash.
  const lighting = document.createElement('canvas'); lighting.width = 960; lighting.height = 540;
  const light = lighting.getContext('2d');
  for (const [x, y, radius, color] of [[150, 440, 330, '40,220,130'], [810, 440, 330, '40,220,130'], [480, 310, 240, '255,200,80']]) {
    const glow = light.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `rgba(${color},.18)`); glow.addColorStop(.45, `rgba(${color},.08)`); glow.addColorStop(1, `rgba(${color},0)`);
    light.fillStyle = glow; light.fillRect(0, 0, 960, 540);
  }
  function backdrop(t) {
    const envelope = smooth(t / 1.5) * (1 - smooth((t - 13.4) / 1.6));
    const finale = t >= 10.5 && t < 13 ? .16 * Math.sin((t - 10.5) / 2.5 * Math.PI) : 0;
    ctx.save(); ctx.globalAlpha = envelope * (.84 + finale);
    ctx.drawImage(lighting, 0, 0, W, H);
    for (let side = 0; side < 2; side++) {
      const x = side ? 1780 : 140;
      for (let j = 0; j < 3; j++) {
        const end = 650 + j * 270 + Math.sin(t * .55 + j + side) * 90;
        ctx.fillStyle = j === 1 ? '#ffe09b' : '#7dffc2'; ctx.globalAlpha = envelope * (.025 + finale * .08);
        ctx.beginPath(); ctx.moveTo(x, 1060); ctx.lineTo(end - 70, 230 + j * 30); ctx.lineTo(end + 70, 230 + j * 30); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  /* Sculpted three-quarter rigs: visible side plane, projecting nose, pupils
   * turned inward, near/far legs and different personalities. Never rotate a
   * front-facing cardboard cutout and call that a diagonal pose. */
  function puppet(right) {
    const id = right ? 'r' : 'l';
    const main = right ? '#22c8bd' : '#ff9650', dark = right ? '#087c7e' : '#c64a39';
    return `<svg viewBox="0 0 360 520" aria-hidden="true"><defs>
      <linearGradient id="mfx-k-${id}" x2="1" y2=".6"><stop stop-color="${main}"/><stop offset=".65" stop-color="${main}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
      <linearGradient id="mfx-d-${id}" x2=".8" y2="1"><stop stop-color="#fffbed"/><stop offset=".55" stop-color="#f5e5bb"/><stop offset="1" stop-color="#d8bd86"/></linearGradient>
      <linearGradient id="mfx-s-${id}" x2="1" y2=".6"><stop stop-color="#ffc48c"/><stop offset="1" stop-color="#d98a54"/></linearGradient>
    </defs><g transform="${right ? 'translate(360 0) scale(-1 1)' : ''}"><g class="mfx-body" stroke="#42283a" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round">
      <g class="mfx-leg-b"><path d="M158 382l26 98 20-2-2-102" fill="#d99058"/>
        <path d="M150 365q72-14 76 34l-9 49q-17 18-47 2l-21-58" fill="url(#mfx-d-${id})"/>
        <path d="M168 390l23 47m7-51 7 47" fill="none" stroke="#c4a36b" stroke-width="3"/>
        <path d="M182 475q19-7 24 1 29 0 35 16-23 13-60 3z" fill="#723e33"/><path d="M183 491q33 8 54-1" stroke="#b67a4c" stroke-width="3"/></g>
      <g class="mfx-leg-a"><path d="M117 396l-3 85 23 1 18-88" fill="url(#mfx-s-${id})"/>
        <path d="M113 362q-35 32-18 73 12 30 51 19l24-63" fill="url(#mfx-d-${id})"/>
        <path d="M117 384q-12 33 0 57m24-49-11 50" fill="none" stroke="#c4a36b" stroke-width="3"/>
        <path d="M113 477q15-6 27 2l-1 18q-37 9-58-4 3-15 32-16" fill="#844637"/><path d="M84 493q29 7 53-1" stroke="#bd8751" stroke-width="3"/></g>
      <path d="M110 340q46-17 99-1l10 41-49 29-23-15-42-14Z" fill="url(#mfx-d-${id})"/>
      <path d="M114 350l53 48 36-47m-36 8v34m-41-25 22 21" fill="none" stroke="#c4a36b" stroke-width="3"/>
      <path d="M109 191q32-20 76 9 30 54 31 146-49 32-113 8-16-94 6-163" fill="url(#mfx-k-${id})"/>
      <path d="M179 204q18 84 11 148l26-8q0-103-31-144" fill="${dark}" stroke="none" opacity=".65"/>
      <path d="M111 343q51 20 101-8l4 13q-51 31-112 8Z" fill="#ffd68b" stroke-width="2"/>
      <path d="M136 193l20 24 23-16-9 37-16-15-19 6Z" fill="#ffe2a0" stroke-width="2"/>
      <path d="M155 223l16 92" fill="none" stroke="#f8cf85" stroke-width="3"/>
      <path d="M117 245l-3 64m77-61 7 54" stroke="#fff" opacity=".2" stroke-width="3"/>
      <circle cx="163" cy="245" r="3" fill="#ffedba" stroke="none"/><circle cx="167" cy="266" r="3" fill="#ffedba" stroke="none"/>
      ${right ? '<path d="M121 227l18 6-2 20-19-6Z" fill="#fff2c6" stroke-width="2"/>' : '<path d="M113 192q7-11 13-7l7 120-20 6q-7-65 0-119" fill="#ca3750" stroke-width="3"/><path d="M117 214l12-3m-11 19 13-3m-13 19 14-3m-13 19 14-3m-13 19 14-3" stroke="#ffd477" stroke-width="2"/>'}
      <path d="M137 169l1 26q17 19 37 6l-3-37" fill="#d98a54"/>
      <g class="mfx-head">
        <path d="M115 96q0-48 47-48 44 1 43 54l-5 18 21 18q3 8-15 9-3 35-34 42-39-3-48-38Z" fill="url(#mfx-s-${id})"/>
        <ellipse cx="119" cy="126" rx="13" ry="20" fill="#eaa16b"/><path d="M115 119q11-6 10 10l-7 5" fill="none" stroke="#b86f4c" stroke-width="3"/>
        ${right ? '<path d="M118 113q-25-39 5-58 17-21 44-16 29-1 38 30l-8 25-8-22q-31 7-52-3l-9 38Z" fill="#342637"/><path d="M137 53q32-16 53 6" fill="none" stroke="#73505a" stroke-width="5"/>' : '<path d="M115 112q-22-22-10-45 9-18 28-20 15-23 43-7 39-1 34 38-16 20-50 6l-24-9-9 35" fill="#3b2a3b"/><path d="M115 69q23-15 37-7m7-15q18 4 24 17" fill="none" stroke="#71505c" stroke-width="5"/>'}
        <path d="M143 106q12-11 24-2m11 1q10-9 19-1" fill="none" stroke-width="6"/>
        <ellipse cx="157" cy="119" rx="10" ry="12" fill="#fff7df" stroke-width="2"/><ellipse cx="188" cy="117" rx="7" ry="10" fill="#fff7df" stroke-width="2"/>
        <ellipse cx="161" cy="120" rx="4" ry="7" fill="#332336" stroke="none"/><ellipse cx="191" cy="118" rx="3.5" ry="6" fill="#332336" stroke="none"/>
        ${right ? '<path d="M141 114q0-11 19-9 15 1 14 17-3 14-20 10-14-2-13-18m35 0q1-11 13-10 14 1 13 13-1 12-13 12-14 0-13-15m-2 2h3m-36-2-13-5" fill="none" stroke="#73502c" stroke-width="3"/>' : ''}
        <path d="M183 123q-5 15 4 18" fill="none" stroke="#ba744b" stroke-width="3"/>
        <path d="M180 146q-17-12-29 3-13 2-15-8-5 18 14 23 19-1 30-12 9 10 21 3 8-6 6-13-7 12-27 4" fill="#362436" stroke="none"/>
        <g class="mfx-laugh" transform="translate(176 164)"><path d="M-20-3Q0 8 20-5Q17 27 0 25Q-18 23-20-3Z" fill="#552239" stroke-width="2.5"/><path d="M-17-1Q0 9 17-3L13 5Q0 13-14 6Z" fill="#fff9e4" stroke="none"/><path d="M-10 20Q0 10 10 20Q0 27-10 20" fill="#f6858a" stroke="none"/></g>
        <ellipse cx="140" cy="143" rx="10" ry="6" fill="#e77c63" opacity=".55" stroke="none"/>
      </g>
      <!-- Use the approved left actor's grip/arm silhouette on both sides.
           The right actor's outer SVG transform supplies the inward mirror. -->
      <g class="mfx-left-grip" data-hand="left">
      <path d="M182 220Q203 224 208 250L243 249" fill="none" stroke="#42283a" stroke-width="26"/>
      <path d="M182 220Q203 224 208 250L243 249" fill="none" stroke="url(#mfx-s-${id})" stroke-width="18"/>
      <path d="M178 204q26 3 32 33l-25 14-20-35" fill="${dark}"/>
      <g class="mfx-gaddi" transform="translate(${BUNDLE.x} ${BUNDLE.y}) rotate(${BUNDLE.angle})">
        <path d="M0 24H76V48H0Z" fill="#a3afa0" stroke-width="2"/>
        <path d="M1 30h73m-73 4h73m-73 4h73m-73 4h73m-73 4h73" stroke="#e5e7d8" stroke-width="1.5"/>
        <image href="${noteURL}" width="76" height="35"/>
        <image class="mfx-feed-note" href="${noteURL}" width="76" height="35"/>
        <!-- Palm under the stack, three curled fingers over its lower edge,
             thumb bracing the back. The outward feed edge stays unobstructed. -->
        <g class="mfx-grip-palm" fill="url(#mfx-s-${id})" stroke-width="2.5">
          <path d="M16 44Q17 55 35 54L57 49Q63 45 59 40L48 41 47 32Q43 28 40 33L39 43 35 34Q30 31 28 36L29 45 24 37Q19 35 18 40Z"/>
          <path d="M16 45L9 30Q7 21 12 18Q18 18 20 30L24 39"/>
          <path d="M29 45l4 5m6-7 3 5m6-7 3 4" fill="none" stroke="#bb744d" stroke-width="1.5"/>
        </g>
      </g>
      </g>
      <!-- Flicking arm copies the approved crossing pose, then drag-flicks. -->
      <g class="mfx-right-flick" data-hand="right">
      <path class="mfx-arm-outline" fill="none" stroke="#42283a" stroke-width="25"/>
      <path class="mfx-arm-skin" fill="none" stroke="#f4b078" stroke-width="17"/>
      <path class="mfx-sleeve-outline" fill="none" stroke="#42283a" stroke-width="34"/>
      <path class="mfx-sleeve" fill="none" stroke="${main}" stroke-width="26"/>
      <g class="mfx-wrist">
        <path class="mfx-hand" fill="#ffc28a" stroke-width="3"/>
        <path d="M-1 3l10 2" fill="none" stroke="#d08755" stroke-width="2"/>
        <path d="M-10-4l-3 13" stroke="#ffe1a1" stroke-width="5"/>
      </g>
      </g>
    </g></g></svg>`;
  }
  const crown = `<svg class="mfx-emblem" viewBox="0 0 120 100" aria-hidden="true"><path d="M18 30L36 47 59 16 84 47 104 28 91 74H29Z" fill="#ffd778" stroke="#6f3d42" stroke-width="4" stroke-linejoin="round"/><path d="M29 72H91V83Q61 94 29 83Z" fill="#f6a83d" stroke="#6f3d42" stroke-width="4"/><path d="M38 53l5 14m18-30v27m18-10-5 14" stroke="#fff4bb" stroke-width="5" stroke-linecap="round"/><circle cx="59" cy="16" r="6" fill="#fff2b0"/><circle cx="17" cy="27" r="5" fill="#fff2b0"/><circle cx="105" cy="25" r="5" fill="#fff2b0"/><path d="M60 64l7 8-7 8-7-8Z" fill="#ea6682"/><path d="M8 50l-3 10m105-5 6 7" stroke="#ffd778" stroke-width="3" stroke-linecap="round"/></svg>`;
  function build() {
    if (root) return;
    root = document.createElement('div'); root.id = 'money-fx'; root.setAttribute('aria-hidden', 'true');
    for (const key of ['width', 'height', 'left', 'right', 'top']) root.style.setProperty(`--mfx-rig-${key}`, `${RIG[key]}px`);
    root.innerHTML = `<div class="mfx-world"><canvas width="1920" height="1080"></canvas>
      <div class="mfx-actor">${puppet(false)}<div class="mfx-bubble"></div></div>
      <div class="mfx-actor mfx-actor-right">${puppet(true)}<div class="mfx-bubble"></div></div>
      <div class="mfx-hero-anchor"><div class="mfx-donor">${crown}<div class="mfx-label">SUPER CHAT</div>
        <div class="mfx-name-wrap"><div class="mfx-name"><span class="mfx-name-glint"></span></div></div>
        <div class="mfx-payment"><div class="mfx-amount"></div></div><div class="mfx-thanks">DIL KHUSH KAR DIYA!</div>
      </div></div></div>`;
    document.body.appendChild(root);
    world = root.querySelector('.mfx-world'); canvas = root.querySelector('canvas');
    ctx = canvas.getContext('2d', { alpha: true }); donor = root.querySelector('.mfx-donor');
    emblem = root.querySelector('.mfx-emblem'); label = root.querySelector('.mfx-label');
    nameEl = root.querySelector('.mfx-name'); nameGlint = root.querySelector('.mfx-name-glint'); payment = root.querySelector('.mfx-payment'); thanks = root.querySelector('.mfx-thanks');
    actors = [...root.querySelectorAll('.mfx-actor')].map((el, side) => ({ el, side,
      svg: el.querySelector('svg'), body: el.querySelector('.mfx-body'), head: el.querySelector('.mfx-head'),
      outline: el.querySelector('.mfx-arm-outline'), skin: el.querySelector('.mfx-arm-skin'),
      sleeveOutline: el.querySelector('.mfx-sleeve-outline'), sleeve: el.querySelector('.mfx-sleeve'),
      wrist: el.querySelector('.mfx-wrist'), hand: el.querySelector('.mfx-hand'), feed: el.querySelector('.mfx-feed-note'),
      legA: el.querySelector('.mfx-leg-a'), legB: el.querySelector('.mfx-leg-b'), bubble: el.querySelector('.mfx-bubble'),
      laugh: el.querySelector('.mfx-laugh'), shoulderX: 116,
      beat: -1, phase: 0, lastBubble: '', holding: false, strokeU: 15, wristX: 0, wristY: 0,
    }));
    resize();
  }
  function resize() {
    if (!world) return;
    const scale = Math.min(window.innerHeight / H, window.innerWidth / W);
    world.style.transform = `scale(${scale})`;
    world.style.left = `${(window.innerWidth - W * scale) / 2}px`;
    world.style.top = `${(window.innerHeight - H * scale) / 2}px`;
  }

  const beats = [[], []];
  for (let side = 0; side < 2; side++) {
    for (let t = 2.15; t < 12.55;) {
      const duration = t < 10.5 ? .34 : .24;
      beats[side].push({ start: t, duration }); t += duration;
    }
  }
  function bubble(actor, text, age, duration) {
    if (text !== actor.lastBubble) { actor.bubble.textContent = text; actor.lastBubble = text; }
    const p = clamp(age / .24), out = clamp((duration - age) / .2);
    actor.bubble.style.opacity = String(clamp(age / .08) * out);
    actor.bubble.style.transform = `scale(${pop(p) * (.9 + .1 * out)}) rotate(${actor.side ? 4 : -5}deg)`;
  }
  function pose(actor, t) {
    const side = actor.side, dir = side ? -1 : 1, local = t - side * .13;
    // Fast committed entrance, overshoot, heel brake, then a planted stance.
    let x = 0, y = 0, tilt = 0, sx = 1, sy = 1;
    if (local < .62) {
      const p = ease(local / .62); x = mix(-480, 28, p) * dir;
      y = -Math.abs(Math.sin(clamp(local / .62) * Math.PI * 3)) * 18;
      tilt = -dir * 12; sx = 1.08; sy = .96;
    } else if (local < 1.2) {
      const p = clamp((local - .62) / .58);
      x = 28 * Math.exp(-p * 4) * Math.cos(p * 7) * dir;
      y = Math.sin(p * Math.PI) * 11; tilt = dir * 13 * Math.sin(p * Math.PI) * (1 - p);
      sx = 1 + .1 * Math.sin(p * Math.PI); sy = 1 - .1 * Math.sin(p * Math.PI);
    }
    if (t > 13.65) {
      const p = clamp((t - 13.65) / 1.12); x = -dir * 500 * p * p;
      y = -Math.abs(Math.sin(p * 16)) * 16; tilt = dir * (8 + p * 9);
    }
    const groove = t > 1.2 && t < 12.65 ? Math.sin(t * (t < 10.5 ? 7.4 : 11)) : 0;
    actor.el.style.transform = `translate(${x}px,${y}px) rotate(${tilt}deg) scale(${sx},${sy})`;
    actor.el.style.transformOrigin = '50% 96%';
    actor.body.setAttribute('transform', `rotate(${groove * 2.4} 155 480) translate(0 ${Math.abs(groove) * -3})`);
    const bow = t >= 12.65 && t < 13.65 ? Math.sin(clamp((t - 12.65) / 1) * Math.PI) * 15 : 0;
    actor.head.setAttribute('transform', `rotate(${groove * 3.5 - 3 + bow} 153 183)`);
    actor.laugh.setAttribute('transform', `translate(176 164) scale(1 ${t > 2.15 && t < 12.65 ? .72 + .28 * Math.abs(Math.sin(t * 13 + side * .8)) : .48})`);
    const walking = local < .68 || t > 13.65;
    const step = walking ? Math.sin(t * 23 + side) * 16 : groove * 3;
    actor.legA.setAttribute('transform', `rotate(${step} 141 381)`);
    actor.legB.setAttribute('transform', `rotate(${-step} 185 382)`);

    let beat = -1, phase = 0;
    for (let i = 0; i < beats[side].length; i++) {
      const b = beats[side][i];
      if (t >= b.start && t < b.start + b.duration) { beat = i; phase = (t - b.start) / b.duration; break; }
    }
    actor.phase = phase;
    const shower = beat >= 0 && t < 12.65;
    let strokeU = 15, wristAngle = BUNDLE.angle;
    if (shower) {
      // Fingers stay on the top-sheet plane. No lifted note, wind-up or throw.
      if (phase < .23) strokeU = 15;
      else if (phase < .62) strokeU = mix(15, 73, Math.pow((phase - .23) / .39, 1.65));
      else if (phase < .76) strokeU = mix(73, 86, ease((phase - .62) / .14));
      else strokeU = mix(86, 15, smooth((phase - .76) / .24));
    }
    actor.strokeU = strokeU;
    const offset = rotatePoint(strokeU - 27, BUNDLE.contactY + 16, BUNDLE.angle);
    let wx = BUNDLE.x + offset.x, wy = BUNDLE.y + offset.y;
    if (t >= 12.65 && t < 13.65) {
      const p = ease((t - 12.65) / .3); wx = mix(wx, 175, p); wy = mix(wy, 229, p); wristAngle = mix(wristAngle, -80, p);
    } else if (walking) { wx += Math.sin(t * 18) * 8; wy += Math.cos(t * 18) * 8; }
    actor.wristX = wx; actor.wristY = wy;
    // Analytic two-bone IK: elbow follows the wrist instead of a detached prop.
    const shoulderX = actor.shoulderX, shoulderY = 220, upper = 86, lower = 100;
    const dx = wx - shoulderX, dy = wy - shoulderY, distance = Math.max(1, Math.min(upper + lower - .01, Math.hypot(dx, dy)));
    const angle = Math.atan2(dy, dx) + Math.acos(Math.max(-1, Math.min(1, (upper * upper + distance * distance - lower * lower) / (2 * upper * distance))));
    const ex = shoulderX + Math.cos(angle) * upper, ey = shoulderY + Math.sin(angle) * upper;
    const arm = `M${shoulderX} ${shoulderY}L${ex} ${ey}L${wx} ${wy}`;
    actor.outline.setAttribute('d', arm); actor.skin.setAttribute('d', arm);
    const sleeve = `M${shoulderX} ${shoulderY}L${mix(shoulderX, ex, .46)} ${mix(shoulderY, ey, .46)}`;
    actor.sleeveOutline.setAttribute('d', sleeve); actor.sleeve.setAttribute('d', sleeve);
    actor.wrist.setAttribute('transform', `translate(${wx} ${wy}) rotate(${wristAngle})`);
    actor.feed.style.opacity = !shower || phase < .62 ? '1' : '0';
    actor.feed.setAttribute('transform', `translate(${shower && phase < .62 ? Math.max(0, strokeU - 55) * .28 : 0} 0)`);
    actor.hand.setAttribute('d', 'M-11 0Q-6-10 3-8L12-9 25-18Q30-20 29-15L17-5 28-12Q33-12 30-7L17 4 21 5Q24 9 17 12L4 14Q-8 12-11 0Z');
    if (shower && phase >= .62 && actor.beat !== beat) {
      actor.beat = beat;
      // Match SVG and CSS transforms arithmetically: no synchronous layout
      // read after DOM writes, including during simultaneous releases.
      // Launch from the gaddi edge, not from the moving hand after follow-through.
      let tip = rotatePoint(BUNDLE.width, BUNDLE.contactY, BUNDLE.angle);
      tip = rotatePoint(tip.x + BUNDLE.x - 155, tip.y + BUNDLE.y - Math.abs(groove) * 3 - 480, groove * 2.4);
      tip.x += 155; tip.y += 480;
      if (side) tip.x = 360 - tip.x;
      const ox = RIG.width / 2, oy = RIG.height * .96;
      tip = rotatePoint((tip.x * RIG.scale - ox) * sx, (tip.y * RIG.scale - oy) * sy, tilt);
      const px = (side ? RIG.right : RIG.left) + ox + x + tip.x, py = RIG.top + oy + y + tip.y;
      const target = spawn(px, py, dir, beat, t);
      releaseCount++;
      if ((target.x - px) * dir <= 0) directionErrors++;
      releases.push({ side: side ? 'right' : 'left', hand: 'right', source: 'bundle-edge', count: 1, at: +t.toFixed(3), x: +px.toFixed(2), y: +py.toFixed(2), targetX: target.x, targetY: target.y });
      if (releases.length > 64) releases.shift();
    }
    if (side === 0 && t >= 1.0 && t < 2.1) bubble(actor, 'ARRE, SETH JI!', t - 1, 1.1);
    else if (side === 1 && t >= 9.55 && t < 10.7) bubble(actor, 'AUR HAI!', t - 9.55, 1.15);
    else if (side === 0 && t >= 10.75 && t < 11.7) bubble(actor, 'FULL IZZAT!', t - 10.75, .95);
    else if (side === 1 && t >= 13.2 && t < 14) bubble(actor, 'PHIR AANA!', t - 13.2, .8);
    else actor.bubble.style.opacity = '0';
  }

  function spawn(x, y, dir, index, t) {
    // Cheek / face / opposite shoulder lanes; fixed centre framing, no face
    // tracking or camera access. Opposing streams cross rather than stop dead.
    const target = { x: 960 + dir * [-170, 75, 190, -80, 140][index % 5], y: [330, 420, 510, 365, 470][index % 5] };
    const n = notes.find(n => !n.active); if (!n) return target;
    Object.assign(n, { active: true, x0: x, y0: y, x, y, dir, age: 0,
      tx: target.x, ty: target.y, born: t,
      flight: 1.25 + index % 3 * .12, arc: (y - target.y) / 4 + 65 + index % 3 * 12, life: 3.8,
      phase: index * 1.7 + (dir < 0 ? .9 : 0), width: [58, 82, 108][index % 3],
    });
    return target;
  }
  function drawBill(n, t) {
    const fold = .35 + .63 * Math.abs(Math.cos(n.age * 5 + n.phase));
    const turn = -.45 * n.dir + n.age * n.dir * 1.8 + Math.sin(n.age * 4 + n.phase) * .28;
    const w = n.width * (.75 + .25 * clamp(n.age / n.flight)), h = w * 166 / 360;
    ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(turn); ctx.scale(1, fold);
    ctx.globalAlpha = clamp((n.life - n.age) / .45) * clamp((14.95 - t) / .8);
    const image = billFrames[Math.floor((n.age * 7 + n.phase) / (Math.PI * 2) * 16) % 16];
    ctx.drawImage(image, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  function drawNotes(t) {
    let activeCount = 0;
    for (const n of notes) {
      if (!n.active) continue;
      n.age = t - n.born;
      if (n.age > n.life || n.y > H + 70) { n.active = false; continue; }
      const u = clamp(n.age / n.flight);
      if (n.age <= n.flight) {
        n.x = mix(n.x0, n.tx, 1.35 * u - .35 * u * u);
        n.y = mix(n.y0, n.ty, u) - 4 * n.arc * u * (1 - u);
        if (n.age < .15) {
          ctx.save(); ctx.globalAlpha = .35 * (1 - n.age / .15); ctx.strokeStyle = '#fff0ba'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(n.x - n.dir * 22, n.y + 20); ctx.lineTo(n.x - n.dir * 45, n.y + 45); ctx.stroke(); ctx.restore();
        }
      } else {
        const fall = n.age - n.flight, down = (n.ty - n.y0 + 4 * n.arc) / n.flight;
        n.x = n.tx + (n.tx - n.x0) * .65 / n.flight * .48 * (1 - Math.exp(-fall / .48)) + Math.sin(fall * 4 + n.phase) * 30 * Math.min(1, fall * 2);
        n.y = n.ty + down * fall + 175 * fall * fall;
      }
      drawBill(n, t);
      activeCount++;
    }
    peakNotes = Math.max(peakNotes, activeCount);
  }

  function star(x, y, r, alpha) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = '#ffe1a0';
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x + r * .16, y - r * .16, x + r, y);
    ctx.quadraticCurveTo(x + r * .16, y + r * .16, x, y + r); ctx.quadraticCurveTo(x - r * .16, y + r * .16, x - r, y);
    ctx.quadraticCurveTo(x - r * .16, y - r * .16, x, y - r); ctx.fill(); ctx.restore();
  }
  function accents(t) {
    // Side speed lines + little dust puffs sell the heel brake, not a backdrop.
    for (let side = 0; side < 2; side++) {
      const dir = side ? -1 : 1, local = t - side * .13;
      if (local >= .12 && local < .6) {
        ctx.save(); ctx.globalAlpha = .65 * Math.sin((local - .12) / .48 * Math.PI);
        ctx.strokeStyle = side ? '#75eee0' : '#ffc684'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        for (let j = 0; j < 3; j++) { ctx.beginPath(); const x = side ? W - 12 : 12; ctx.moveTo(x, 850 + j * 20); ctx.lineTo(x + dir * (100 + j * 20), 850 + j * 20); ctx.stroke(); }
        ctx.restore();
      }
      if (local >= .6 && local < 1.35) {
        const p = (local - .6) / .75, bx = side ? 1740 : 180;
        ctx.save(); ctx.fillStyle = '#ffedbe'; ctx.globalAlpha = .3 * (1 - p);
        for (let j = 0; j < 5; j++) { ctx.beginPath(); ctx.ellipse(bx - dir * (j * 15 + p * 48), 1060 - Math.sin(p * Math.PI) * (8 + j * 3), 5 + p * 14, 3 + p * 7, 0, 0, 7); ctx.fill(); }
        ctx.restore();
      }
    }
    // Like/member alert grammar: staggered expanding rings and a pop burst.
    for (let j = 0; j < 3; j++) {
      const p = (t - 1.42 - j * .12) / 1.05;
      if (p < 0 || p > 1) continue;
      ctx.save(); ctx.globalAlpha = (1 - p) * .55; ctx.strokeStyle = j === 1 ? '#83ebd9' : '#ffd278';
      ctx.lineWidth = 2 * (1 - p) + .5; ctx.beginPath(); ctx.ellipse(W / 2, H * .49, 50 + ease(p) * 440, 40 + ease(p) * 240, -.08, 0, 7); ctx.stroke(); ctx.restore();
    }
    const burst = (t - 1.5) / 1.15;
    if (burst >= 0 && burst < 1) for (let j = 0; j < 22; j++) {
      const a = j / 22 * Math.PI * 2, r = 70 + ease(burst) * (250 + j % 3 * 35);
      star(W / 2 + Math.cos(a) * r * 1.45, H * .49 + Math.sin(a) * r * .8, (1 - burst) * (4 + j % 4), (1 - burst) * .9);
    }
    if (t >= 2 && t < 14) for (let j = 0; j < 10; j++) {
      const pulse = Math.max(0, Math.sin(t * 2.8 + j * 1.7));
      star(430 + j * 118, 310 + (j % 3) * 180, 3 + pulse * 4, pulse * .65 * clamp((14 - t) / .7));
    }
  }
  function hero(t) {
    const p = (t - 1.38) / .78, out = clamp((t - 13.6) / 1.1);
    const breathing = t > 2.4 && t < 12.6 ? 1 + Math.sin((t - 2.4) * 2.1) * .012 : 1;
    const finale = t >= 12.65 && t < 13.45 ? Math.sin(clamp((t - 12.65) / .8) * Math.PI) * .055 : 0;
    donor.style.opacity = String(clamp(p * 4) * (1 - out));
    donor.style.transform = `translateY(${(1 - ease(p)) * 55 - out * 85}px) scale(${pop(p) * breathing * (1 + finale) * (1 - out * .5)}) rotate(${(1 - ease(p)) * -9 + Math.sin(out * Math.PI) * 5}deg)`;
    const iconPop = pop((t - 1.25) / .75);
    emblem.style.transform = `scale(${iconPop}) rotate(${Math.sin(t * 2) * 4}deg)`;
    label.style.opacity = String(clamp((t - 1.45) / .25));
    nameEl.style.transform = `translateY(${(1 - ease((t - 1.52) / .7)) * 30}px) scale(${pop((t - 1.52) / .7)})`;
    nameEl.style.opacity = String(clamp((t - 1.52) / .15));
    payment.style.opacity = String(clamp((t - 1.85) / .2));
    payment.style.transform = `scale(${pop((t - 1.85) / .6)})`;
    const tagline = t >= 12.65 ? 'SHUKRIYA, DIL SE!' : t >= 10.5 ? 'SETH JI OP!' : 'DIL KHUSH KAR DIYA!';
    if (thanks.textContent !== tagline) thanks.textContent = tagline;
    thanks.style.opacity = String(clamp((t - 2.05) / .25));
    thanks.style.transform = `translateY(${Math.sin(t * 2.8) * 2}px)`;
  }
  function frame(now) {
    if (!playing) return;
    // Some Chromium configurations schedule rAF above the stream refresh rate.
    // Keep phase on a 60Hz grid without letting the timeline run slower.
    const elapsed = now - lastDraw;
    if (elapsed < FRAME_INTERVAL - .1) { raf = requestAnimationFrame(frame); return; }
    lastDraw += Math.max(1, Math.floor((elapsed + .1) / FRAME_INTERVAL)) * FRAME_INTERVAL;
    try {
      const renderStart = performance.now();
      const gap = now - last; last = now;
      time = (now - started) / 1000;
      frames++; if (gap > 34) longFrames++; maxGap = Math.max(maxGap, gap);
      if (frameGaps.length < 4096) frameGaps.push(gap);
      if (time >= DURATION / 1000) { stop('complete'); return; }
      ctx.clearRect(0, 0, W, H);
      pose(actors[0], time); pose(actors[1], time);
      backdrop(time); accents(time); drawNotes(time); hero(time);
      const cost = performance.now() - renderStart;
      maxRenderMs = Math.max(maxRenderMs, cost);
      if (renderCosts.length < 4096) renderCosts.push(cost);
      raf = requestAnimationFrame(frame);
    } catch (err) {
      console.error('[MoneyFX] rendering failed', err); emit('error', { reason: String(err) }); stop('error');
    }
  }
  function stop(why = 'stopped') {
    const wasPlaying = playing; playing = false; reason = why;
    cancelAnimationFrame(raf); raf = 0; clearTimeout(endTimer); endTimer = 0;
    notes.forEach(n => { n.active = false; });
    if (ctx) ctx.clearRect(0, 0, W, H);
    root?.classList.remove('mfx-active');
    if (wasPlaying) emit('end', { reason, frames, longFrames, maxGap, releaseCount, directionErrors });
  }
  function start(opts) {
    build(); stop('restart');
    const displayName = String(opts.name || 'Viewer').slice(0, 160);
    nameGlint.textContent = displayName;
    nameEl.style.fontSize = `${displayName.length > 45 ? 44 : displayName.length > 28 ? 58 : 86}px`;
    root.querySelector('.mfx-amount').textContent = String(opts.amount || 'SUPER CHAT').slice(0, 64);
    actors.forEach(a => { a.beat = -1; a.lastBubble = ''; });
    releaseCount = directionErrors = 0; releases.length = 0; time = 0;
    peakNotes = maxRenderMs = 0; frameGaps.length = renderCosts.length = 0;
    pose(actors[0], 0); pose(actors[1], 0); hero(0);
    root.classList.add('mfx-active');
    playing = true; reason = 'playing'; frames = longFrames = maxGap = 0;
    started = last = performance.now(); resize();
    lastDraw = started - FRAME_INTERVAL;
    raf = requestAnimationFrame(frame); endTimer = setTimeout(() => stop('complete'), DURATION);
    emit('start', { name: opts.name, amount: opts.amount, version: 5 });
    return () => { if (playing) stop('stage-release'); };
  }
  function play(opts = {}) {
    if (!window.AnimationStage) { console.error('[MoneyFX] AnimationStage missing'); return false; }
    return window.AnimationStage.enqueue('superchat-money', () => start(opts), DURATION + 80);
  }
  window.MoneyFX = {
    play, stop,
    handleChat(msg) {
      if (!msg || msg.isHistory || (msg.msgType || msg.type) !== 'superchat') return false;
      const id = msg.id || msg.ytId;
      if (id && seen.has(id)) return false;
      const accepted = play({ name: msg.name, amount: msg.amount });
      if (accepted) remember(id);
      return accepted;
    },
    status() { const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) * p)] || 0; };
      return { version: 5, playing, reason, duration: DURATION, time, frames, longFrames,
      peakNotes, maxRenderMs, p95RenderMs: percentile(renderCosts, .95), p95FrameGap: percentile(frameGaps, .95),
      over60HzBudget: frameGaps.filter(gap => gap > 20).length,
      rigs: actors?.map(a => ({ side: a.side ? 'right' : 'left', gripHand: 'left', flickHand: 'right', shoulderX: a.shoulderX, phase: a.phase, holding: false, strokeU: a.strokeU, wristX: a.wristX, wristY: a.wristY })),
      maxGap, activeNotes: notes.filter(n => n.active).length, poolSize: notes.length, seen: seen.size, raf: !!raf,
      releaseCount, directionErrors, releases: releases.map(r => ({ ...r })),
      scene: time < 1.38 ? 'entrance' : time < 2.15 ? 'name-pop' : time < 10.5 ? 'shower' : time < 12.65 ? 'double-time' : time < 13.65 ? 'thanks' : 'exit' }; },
  };
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', () => stop('pagehide'));
  // Prepare the persistent hidden rigs at overlay load, not during a donation.
  // No idle rAF/timer, and no first-use SVG construction hitch in the scene.
  build();
})();
