/* ═══════════════════════════════════════════════════════════════════════════
   STICKER FX — "DISGUSTING" fullscreen sticker moment
   ---------------------------------------------------------------------------
   Self-contained module. Loaded once from chat-overlay.html:

     <link rel="stylesheet" href="sticker-fx/sticker-fx.css">
     <script src="sticker-fx/assets/disgusting-cloud.js"></script>
     <script src="sticker-fx/sticker-fx.js"></script>

   The script tags are intentionally synchronous and placed at the end of
   <body>, so window.StickerFX exists before the first WebSocket message.

   Performance, in four beats:
     1. embers settle on the floor while the hellgate fades up
     2. 4.6k particles lift off and stream into the sticker silhouette
     3. the artwork condenses out of them and solidifies with a flash
     4. it inhales, then ROARS: lunge, screen shake, shockwave, spark blast

   A silent performance at boot warms the compositor so the first real trigger
   does not pay the layer/rasterisation cost.

   Public API (window.StickerFX):
     handleChat(message)   inspect a parsed YouTube chat message
     play(options)         force a play (name, amount, source)
     stop(reason)          abort immediately
     isBusy()              true while the fullscreen stage is claimed
     status()              diagnostics snapshot
     configure({...})      triggers / duration / cooldown

   Stage contract: while isBusy() is true no other fullscreen overlay may
   start; when a sticker starts it pre-empts the transient like / new-viewer
   / member-join overlays so two animations are never on screen together.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (window.StickerFX) return;

  // Resolve the artwork relative to this script, so the module works from the
  // repo root (chat-overlay.html) and from sticker-fx/preview.html alike.
  function resolveAsset(rel) {
    try {
      const el = document.currentScript ||
        document.querySelector('script[src*="sticker-fx.js"]');
      if (el && el.src) return new URL(rel, el.src).href;
    } catch (_) { /* fall through */ }
    return 'sticker-fx/' + rel;
  }

  const CONFIG = {
    asset: resolveAsset('assets/disgusting.png'),
    triggers: ['disgusting', 'disguxting'],
    // Beat sheet, ms. Mirrored into CSS custom properties so the keyframes and
    // the JS timers can never drift apart.
    timeline: {
      condense: 1720,
      solidify: 2420,
      roar: 3020,
      kicker: 3120,
      name: 3550,
      sub: 3750,
      float: 4000,
      duration: 7600,
    },
    outroLead: 620,       // ms of fade before duration ends
    cooldown: 1400,       // ms between performances (anti-spam)
    maxSeen: 240,
    particlePool: 280,
    ambientRate: 30,      // embers per second
    debug: new URLSearchParams(location.search).has('stickerDebug'),
  };

  const TL = CONFIG.timeline;

  const state = {
    playing: false,
    warming: false,
    warmed: false,
    pending: null,
    seen: new Set(),
    seenOrder: [],
    cooldownUntil: 0,
    raf: 0,
    timers: { out: 0, end: 0, pending: 0, burst: 0, pop: 0, warm: 0 },
    stats: { frames: 0, longFrames: 0, maxGap: 0, startedAt: 0 },
    lastReason: 'init',
  };

  let root = null;
  let canvas = null;
  let ctx = null;
  let cloudCanvas = null;
  let cloudCtx = null;
  let nameEl = null;
  let subEl = null;
  let stickerImg = null;
  let echoImg = null;
  let brbObserver = null;

  const W = 1920;
  const H = 1080;
  const pool = [];
  let ambientAcc = 0;

  /* ── tiny helpers ─────────────────────────────────────────────────────── */
  function log() {
    if (!CONFIG.debug) return;
    console.info('[StickerFX]', ...arguments);
  }

  function emit(type, detail) {
    try {
      document.dispatchEvent(new CustomEvent('sticker-fx', {
        detail: Object.assign({ type, at: Date.now() }, detail || {}),
      }));
    } catch (_) { /* older Chromium */ }
  }

  function clearTimers() {
    for (const key of Object.keys(state.timers)) {
      if (state.timers[key]) {
        clearTimeout(state.timers[key]);
        state.timers[key] = 0;
      }
    }
  }

  function brbActive() {
    const el = document.getElementById('brb-overlay');
    return !!(el && el.classList.contains('active'));
  }

  function escapeText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ── ember particle system (single canvas, fixed pool, no allocations) ── */
  function makeGlowSprite(r, g, b) {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g2 = c.getContext('2d');
    const grad = g2.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, 'rgba(255,241,196,0.95)');
    grad.addColorStop(0.42, `rgba(${r},${g},${b},0.72)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    g2.fillStyle = grad;
    g2.fillRect(0, 0, size, size);
    return c;
  }

  const SPRITES = [
    makeGlowSprite(255, 122, 24),  // ember orange
    makeGlowSprite(255, 210, 90),  // gold
    makeGlowSprite(255, 48, 18),   // deep red
    makeGlowSprite(255, 246, 224), // white-hot spark
  ];

  function initPool() {
    for (let i = 0; i < CONFIG.particlePool; i++) {
      pool.push({
        active: false, kind: 0, sprite: 0,
        x: 0, y: 0, vx: 0, vy: 0,
        age: 0, life: 1, size: 4, sway: 0, phase: 0, gravity: 0,
      });
    }
  }

  function acquire() {
    for (let i = 0; i < pool.length; i++) {
      if (!pool[i].active) return pool[i];
    }
    return null;
  }

  function spawnEmber(p, scatter) {
    p.active = true;
    p.kind = 0;
    p.sprite = Math.random() < 0.6 ? 0 : (Math.random() < 0.5 ? 1 : 2);
    p.x = Math.random() * W;
    p.y = scatter ? Math.random() * (H + 80) : H + 40 + Math.random() * 120;
    p.vx = (Math.random() - 0.5) * 26;
    p.vy = -(36 + Math.random() * 110);
    p.age = 0;
    p.life = 3.2 + Math.random() * 3.6;
    p.size = 3.5 + Math.random() * 9;
    p.sway = 14 + Math.random() * 34;
    p.phase = Math.random() * Math.PI * 2;
    p.gravity = 0;
  }

  function spawnSpark(p) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 260 + Math.random() * 780;
    p.active = true;
    p.kind = 1;
    p.sprite = Math.random() < 0.55 ? 3 : 1;
    p.x = W / 2 + (Math.random() - 0.5) * 90;
    p.y = H * 0.45 + (Math.random() - 0.5) * 90;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed - 120;
    p.age = 0;
    p.life = 0.55 + Math.random() * 0.95;
    p.size = 2.5 + Math.random() * 6;
    p.sway = 0;
    p.phase = 0;
    p.gravity = 520;
  }

  function seedEmbers(n) {
    for (let i = 0; i < n; i++) {
      const p = acquire();
      if (!p) break;
      spawnEmber(p, true);
      p.age = Math.random() * p.life * 0.7; // stagger so the field starts alive
    }
  }

  function burstSparks(n) {
    for (let i = 0; i < n; i++) {
      const p = acquire();
      if (!p) break;
      spawnSpark(p);
    }
  }

  function updateAndDraw(dt) {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (!p.active) continue;

      p.age += dt;
      if (p.age >= p.life) { p.active = false; continue; }

      p.vy += p.gravity * dt;
      p.x += (p.vx + (p.sway ? Math.sin(p.age * 1.7 + p.phase) * p.sway : 0)) * dt;
      p.y += p.vy * dt;

      if (p.y < -140 || p.x < -140 || p.x > W + 140) { p.active = false; continue; }

      const t = p.age / p.life;
      const fade = t < 0.16 ? t / 0.16 : (1 - t) * (1 - t);
      const size = p.size * (1 - t * 0.45) * (p.kind === 1 ? 1.9 : 2.6);

      ctx.globalAlpha = Math.max(0, Math.min(0.92, fade));
      ctx.drawImage(SPRITES[p.sprite], p.x - size / 2, p.y - size / 2, size, size);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function frame(now) {
    if (!state.playing && !state.warming) return;
    const gap = now - (frame.last || now);
    frame.last = now;
    const dt = Math.min(0.05, gap / 1000);

    if (state.stats.frames > 0) {
      if (gap > 25) state.stats.longFrames++;
      if (gap > state.stats.maxGap) state.stats.maxGap = gap;
    }
    state.stats.frames++;

    if (!document.hidden) {
      ambientAcc += dt * CONFIG.ambientRate;
      while (ambientAcc >= 1) {
        ambientAcc -= 1;
        const p = acquire();
        if (p) spawnEmber(p, false);
      }
      updateAndDraw(dt);
      drawCloud(now);
    }

    state.raf = requestAnimationFrame(frame);
  }

  /* ── boot warm-up ───────────────────────────────────────────────────────
     The first real performance used to stall ~500 ms while the compositor
     allocated the two fullscreen canvases, the blend layers and the image.
     Run the actual timeline once at boot behind an almost-invisible root so
     the first viewer trigger is warm. It is cancelled the moment a real
     performance (or stop) arrives. */
  function warm() {
    if (state.warmed || state.playing || state.warming || document.hidden) return;
    build();
    if (!root || !stickerImg) return;
    if (!stickerImg.complete || !stickerImg.naturalWidth) {
      stickerImg.addEventListener('load', () => setTimeout(warm, 250), { once: true });
      return;
    }

    state.warmed = true;
    state.warming = true;
    root.style.setProperty('--sfx-t-condense', TL.condense + 'ms');
    root.style.setProperty('--sfx-t-solidify', TL.solidify + 'ms');
    root.style.setProperty('--sfx-t-roar', TL.roar + 'ms');
    root.style.setProperty('--sfx-t-kicker', TL.kicker + 'ms');
    root.style.setProperty('--sfx-t-name', TL.name + 'ms');
    root.style.setProperty('--sfx-t-sub', TL.sub + 'ms');
    root.style.setProperty('--sfx-t-float', TL.float + 'ms');

    // Rasterise real text too: the gradient-clipped name carries two
    // drop-shadow filters, and warming an empty node misses that cost.
    nameEl.textContent = '@Warmup';
    subEl.innerHTML = 'SENT THE <b>DISGUSTING</b> STICKER';

    root.classList.add('sfx-warm');
    root.classList.remove('sfx-out', 'sfx-active');
    void root.offsetWidth;
    root.classList.add('sfx-active');
    void root.offsetWidth;

    startParticles();
    startCloud();
    // Runs through the roar and the name/caption entrance (4.0 s).
    state.timers.warm = setTimeout(endWarm, 4300);
  }

  function endWarm() {
    if (!state.warming) return;
    state.warming = false;
    if (state.timers.warm) { clearTimeout(state.timers.warm); state.timers.warm = 0; }
    stopParticles();
    if (root) root.classList.remove('sfx-active', 'sfx-warm');
    if (nameEl) nameEl.textContent = '';
  }

  function startParticles() {
    ambientAcc = 0;
    frame.last = 0;
    state.stats = { frames: 0, longFrames: 0, maxGap: 0, startedAt: performance.now() };
    for (let i = 0; i < pool.length; i++) pool[i].active = false;
    seedEmbers(120);
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(frame);
  }

  function stopParticles() {
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
    if (ctx) ctx.clearRect(0, 0, W, H);
    if (cloudCtx) cloudCtx.clearRect(0, 0, W, H);
    cloud.active = false;
    for (let i = 0; i < pool.length; i++) pool[i].active = false;
  }

  /* ── assembly cloud ───────────────────────────────────────────────────────
     ~4.6k particles sampled from the artwork (assets/disgusting-cloud.js).
     They wait on the floor, then fly curved paths into their pixel, so the
     silhouette builds up bottom-up before the PNG condenses out of it.
     Everything lives in typed arrays: no allocation during a performance. */
  const cloud = {
    ready: false, active: false, n: 0, start: 0,
    tu: null, tv: null, bucket: null, groups: null,
    sx: null, sy: null, ex: null, ey: null,
    tx: null, ty: null, px: null, py: null, qx: null, qy: null,
    delay: null, dur: null, phase: null, state: null,
  };

  function initCloud() {
    const data = window.StickerFXCloud;
    if (!data || !data.data || !data.buckets) return false;

    let bin;
    try { bin = atob(data.data); } catch (_) { return false; }
    const n = (bin.length / 3) | 0;
    if (!n) return false;

    cloud.n = n;
    cloud.groups = data.buckets.map(() => []);
    cloud.tu = new Float32Array(n);
    cloud.tv = new Float32Array(n);
    cloud.bucket = new Uint8Array(n);
    cloud.sx = new Float32Array(n);
    cloud.sy = new Float32Array(n);
    cloud.ex = new Float32Array(n);
    cloud.ey = new Float32Array(n);
    cloud.tx = new Float32Array(n);
    cloud.ty = new Float32Array(n);
    cloud.px = new Float32Array(n);
    cloud.py = new Float32Array(n);
    cloud.qx = new Float32Array(n);
    cloud.qy = new Float32Array(n);
    cloud.delay = new Float32Array(n);
    cloud.dur = new Float32Array(n);
    cloud.phase = new Float32Array(n);
    cloud.state = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
      cloud.tu[i] = bin.charCodeAt(i * 3) / 255;
      cloud.tv[i] = bin.charCodeAt(i * 3 + 1) / 255;
      const b = bin.charCodeAt(i * 3 + 2);
      const bucket = b < data.buckets.length ? b : 0;
      cloud.bucket[i] = bucket;
      cloud.groups[bucket].push(i);
    }

    cloud.css = data.buckets.map(([r, g, b]) => `rgb(${r},${g},${b})`);
    cloud.ready = true;
    return true;
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function startCloud() {
    if (!cloud.ready || !cloudCtx || !stickerImg) return;

    // Map the sticker's on-screen box into canvas pixels (the stage sits inside
    // a scaled world, so measure instead of assuming layout).
    const cr = cloudCanvas.getBoundingClientRect();
    const sr = stickerImg.getBoundingClientRect();
    if (!cr.width || !sr.width) return;
    cloud.active = true;
    cloud.start = performance.now();
    cloudCanvas.style.visibility = 'visible';
    const k = W / cr.width;
    const size = sr.width * k;
    const cx = (sr.left + sr.width / 2 - cr.left) * k;
    const cy = (sr.top + sr.height / 2 - cr.top) * k;

    for (let i = 0; i < cloud.n; i++) {
      const tx = cx + (cloud.tu[i] - 0.5) * size;
      const ty = cy + (cloud.tv[i] - 0.5) * size;
      cloud.tx[i] = tx;
      cloud.ty[i] = ty;

      // Start on the floor (most of them) or as low haze, never mid-air.
      const r = Math.random();
      let gx = Math.random() * W;
      let gy;
      if (r < 0.7) gy = H * 0.84 + Math.random() * H * 0.18;
      else if (r < 0.92) gy = H * 0.66 + Math.random() * H * 0.18;
      else gy = H * 0.5 + Math.random() * H * 0.16;

      cloud.sx[i] = gx;
      cloud.sy[i] = gy;
      cloud.px[i] = gx;
      cloud.py[i] = gy;
      cloud.qx[i] = gx;
      cloud.qy[i] = gy;

      // Curved approach: half-way point pushed sideways + a dip, so particles
      // sweep in from the sides instead of sliding up in straight lines.
      const dx = tx - gx;
      const dy = ty - gy;
      const len = Math.hypot(dx, dy) || 1;
      const swirl = (Math.random() - 0.5) * 300;
      cloud.ex[i] = gx + dx * 0.52 + (-dy / len) * swirl;
      cloud.ey[i] = gy + dy * 0.5 + (dx / len) * swirl + 70;

      // Bottom of the sticker lands first, so it builds upward.
      cloud.delay[i] = 0.15 + (1 - cloud.tv[i]) * 0.42 + Math.random() * 0.55;
      cloud.dur[i] = 0.8 + Math.random() * 0.45;
      cloud.phase[i] = Math.random() * Math.PI * 2;
      cloud.state[i] = 0;
    }
  }

  function drawCloud(now) {
    if (!cloud.active || !cloudCtx) return;
    const p = now - cloud.start;
    if (p < 0) return;

    const fadeIn = Math.min(1, p / 220);
    const fadeOut = Math.max(0, Math.min(1, (p - TL.solidify) / 340));
    const alpha = fadeIn * (1 - fadeOut);

    // Once the cloud has faded into the artwork, stop paying for a full-screen
    // blend layer for the remaining 4.8 s of the performance.
    if (alpha <= 0.002) {
      cloudCtx.globalCompositeOperation = 'source-over';
      cloudCtx.clearRect(0, 0, W, H);
      cloudCanvas.style.visibility = 'hidden';
      cloud.active = false;
      return;
    }

    cloudCtx.globalCompositeOperation = 'lighter';
    cloudCtx.clearRect(0, 0, W, H);

    const t = p / 1000;

    // Pass 1: integrate positions.
    for (let i = 0; i < cloud.n; i++) {
      const local = (t - cloud.delay[i]) / cloud.dur[i];
      let x, y, st;
      if (local <= 0) {
        st = 0;
        x = cloud.sx[i] + Math.sin(t * 1.4 + cloud.phase[i]) * 3;
        y = cloud.sy[i] - t * 9;
      } else if (local < 1) {
        st = 1;
        const e = easeInOutCubic(local);
        const inv = 1 - e;
        x = inv * inv * cloud.sx[i] + 2 * inv * e * cloud.ex[i] + e * e * cloud.tx[i];
        y = inv * inv * cloud.sy[i] + 2 * inv * e * cloud.ey[i] + e * e * cloud.ty[i];
      } else {
        st = 2;
        x = cloud.tx[i] + Math.sin(now * 0.005 + cloud.phase[i]) * 0.9;
        y = cloud.ty[i] + Math.cos(now * 0.004 + cloud.phase[i]) * 0.9;
      }
      cloud.qx[i] = cloud.px[i];
      cloud.qy[i] = cloud.py[i];
      cloud.px[i] = x;
      cloud.py[i] = y;
      cloud.state[i] = st;
    }

    // Pass 2: motion streaks for anything in flight.
    cloudCtx.globalAlpha = 0.20 * alpha;
    cloudCtx.fillStyle = '#ff8a3c';
    for (let i = 0; i < cloud.n; i++) {
      if (cloud.state[i] !== 1) continue;
      cloudCtx.fillRect(cloud.qx[i] - 1, cloud.qy[i] - 1, 2.2, 2.2);
    }

    // Pass 3: the particles themselves, one fillStyle per palette bucket.
    cloudCtx.globalAlpha = 0.9 * alpha;
    for (let b = 0; b < cloud.groups.length; b++) {
      const idx = cloud.groups[b];
      cloudCtx.fillStyle = cloud.css[b];
      for (let j = 0; j < idx.length; j++) {
        const i = idx[j];
        const st = cloud.state[i];
        if (st === 0) {
          cloudCtx.fillRect(cloud.px[i] - 1.3, cloud.py[i] - 1.3, 2.6, 2.6);
        } else if (st === 1) {
          cloudCtx.fillRect(cloud.px[i] - 1.7, cloud.py[i] - 1.7, 3.4, 3.4);
        } else {
          cloudCtx.fillRect(cloud.px[i] - 1.9, cloud.py[i] - 1.9, 3.8, 3.8);
          // halo, so the formed silhouette glows before the PNG lands
          cloudCtx.globalAlpha = 0.10 * alpha;
          cloudCtx.fillRect(cloud.px[i] - 4.5, cloud.py[i] - 4.5, 9, 9);
          cloudCtx.globalAlpha = 0.9 * alpha;
        }
      }
    }

    cloudCtx.globalAlpha = 1;
    cloudCtx.globalCompositeOperation = 'source-over';
  }

  /* ── DOM ──────────────────────────────────────────────────────────────── */
  function build() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'sfx-root';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <div class="sfx-world">
        <div class="sfx-backdrop">
          <div class="sfx-hellgate"></div>
          <div class="sfx-ground"></div>
          <div class="sfx-aura"></div>
          <div class="sfx-edge"></div>
          <div class="sfx-vignette"></div>
        </div>
        <canvas class="sfx-cloud"></canvas>
        <canvas class="sfx-canvas"></canvas>
        <div class="sfx-heatring sfx-heatring-1"></div>
        <div class="sfx-heatring sfx-heatring-2"></div>
        <div class="sfx-stage">
          <div class="sfx-kicker">Sticker Unleashed</div>
          <div class="sfx-sticker-wrap">
            <img class="sfx-echo" alt="" aria-hidden="true" draggable="false">
            <img class="sfx-sticker" alt="Disgusting sticker" draggable="false">
            <div class="sfx-fallback">DISGUSTING</div>
          </div>
          <div class="sfx-caption">
            <div class="sfx-name"></div>
            <div class="sfx-sub">SENT THE <b>DISGUSTING</b> STICKER</div>
          </div>
        </div>
        <div class="sfx-scream"></div>
        <div class="sfx-flash"></div>
      </div>
    `;
    document.body.appendChild(root);

    canvas = root.querySelector('.sfx-canvas');
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });

    cloudCanvas = root.querySelector('.sfx-cloud');
    cloudCanvas.width = W;
    cloudCanvas.height = H;
    cloudCtx = cloudCanvas.getContext('2d', { alpha: true });

    nameEl = root.querySelector('.sfx-name');
    subEl = root.querySelector('.sfx-sub');
    stickerImg = root.querySelector('.sfx-sticker');
    echoImg = root.querySelector('.sfx-echo');

    stickerImg.addEventListener('error', onAssetError);
    echoImg.addEventListener('error', () => { /* main image handles the fallback */ });

    stickerImg.src = CONFIG.asset;
    echoImg.src = CONFIG.asset;

    // BRB is an operator state, not an animation: never cover it.
    const brb = document.getElementById('brb-overlay');
    if (brb && typeof MutationObserver === 'function') {
      brbObserver = new MutationObserver(() => {
        if (brb.classList.contains('active') && state.playing) stop('brb-activated');
      });
      brbObserver.observe(brb, { attributes: true, attributeFilter: ['class'] });
    }
  }

  function onAssetError() {
    if (!root) return;
    root.classList.add('sfx-no-image');
    console.error('[StickerFX] Sticker asset failed to load:', CONFIG.asset);
    emit('error', { reason: 'asset-load', asset: CONFIG.asset });
  }

  /* ── stage exclusivity ────────────────────────────────────────────────── */
  function preemptTransientOverlays() {
    // Like animation owns a canvas + rAF; use its own dismisser when present.
    try {
      if (typeof window.dismissLikeAnimation === 'function') window.dismissLikeAnimation(true);
    } catch (_) { /* ignore */ }

    const like = document.getElementById('like-overlay');
    if (like) like.classList.remove('active', 'dismissing');

    const member = document.getElementById('member-join-overlay');
    if (member) member.classList.remove('active');

    const alert = document.getElementById('user-alert-overlay');
    if (alert) alert.classList.remove('active');

    log('pre-empted transient overlays');
  }

  /* ── performance lifecycle ────────────────────────────────────────────── */
  function start(req) {
    build();
    if (!root || state.playing) return false;

    preemptTransientOverlays();

    const rawName = (req && req.name) || 'Viewer';
    const displayName = /^@/.test(rawName) ? rawName : '@' + rawName;
    nameEl.textContent = displayName;

    if (req && req.amount) {
      subEl.innerHTML = `${escapeText(req.amount)} SUPER CHAT &middot; <b>DISGUSTING</b> STICKER`;
    } else {
      subEl.innerHTML = 'SENT THE <b>DISGUSTING</b> STICKER';
    }

    // One source of truth for the beat sheet: CSS keyframes read these.
    root.style.setProperty('--sfx-t-condense', TL.condense + 'ms');
    root.style.setProperty('--sfx-t-solidify', TL.solidify + 'ms');
    root.style.setProperty('--sfx-t-roar', TL.roar + 'ms');
    root.style.setProperty('--sfx-t-kicker', TL.kicker + 'ms');
    root.style.setProperty('--sfx-t-name', TL.name + 'ms');
    root.style.setProperty('--sfx-t-sub', TL.sub + 'ms');
    root.style.setProperty('--sfx-t-float', TL.float + 'ms');

    root.classList.remove('sfx-out', 'sfx-active');
    void root.offsetWidth;
    root.classList.add('sfx-active');
    void root.offsetWidth;

    state.playing = true;
    state.warmed = true;
    state.lastReason = (req && req.source) || 'manual';
    emit('start', { name: rawName, amount: (req && req.amount) || null, source: state.lastReason });
    log('start', rawName, state.lastReason);

    startParticles();
    startCloud();

    // Solidify pop: a small spark ring as the artwork condenses.
    state.timers.pop = setTimeout(() => {
      if (!state.playing) return;
      burstSparks(36);
      emit('solidify');
    }, TL.solidify);

    // The roar itself: 180 sparks blow out from the face.
    state.timers.burst = setTimeout(() => {
      if (!state.playing) return;
      burstSparks(180);
      emit('roar');
    }, TL.roar);

    state.timers.out = setTimeout(() => {
      if (!state.playing) return;
      root.classList.add('sfx-out');
      emit('outro');
    }, Math.max(300, TL.duration - CONFIG.outroLead));

    state.timers.end = setTimeout(() => finish('complete'), TL.duration);
    return true;
  }

  function finish(reason) {
    if (!state.playing) return;
    state.playing = false;
    clearTimers();
    stopParticles();

    if (root) {
      root.classList.remove('sfx-active', 'sfx-out');
      nameEl.textContent = '';
    }

    const stats = {
      frames: state.stats.frames,
      longFrames: state.stats.longFrames,
      maxGap: Math.round(state.stats.maxGap * 10) / 10,
      ms: Math.round(performance.now() - state.stats.startedAt),
    };
    state.cooldownUntil = performance.now() + CONFIG.cooldown;
    emit('end', { reason, stats });
    log('end', reason, stats);

    if (state.pending) schedulePending(CONFIG.cooldown);
  }

  function stop(reason) {
    if (state.warming) endWarm();
    state.lastReason = reason || 'stopped';
    state.pending = null;
    if (state.timers.pending) {
      clearTimeout(state.timers.pending);
      state.timers.pending = 0;
    }
    finish(state.lastReason);
  }

  function schedulePending(delay) {
    if (state.timers.pending) clearTimeout(state.timers.pending);
    state.timers.pending = setTimeout(() => {
      state.timers.pending = 0;
      const next = state.pending;
      state.pending = null;
      if (next) request(next);
    }, Math.max(0, delay));
  }

  function request(req) {
    if (state.warming) endWarm();
    if (state.playing) {
      state.pending = req; // latest wins; one queued performance max
      log('busy — queued', req.name);
      emit('queued', { name: req.name });
      return false;
    }

    const wait = state.cooldownUntil - performance.now();
    if (wait > 0) {
      state.pending = req;
      schedulePending(wait);
      log('cooldown — deferred', Math.round(wait), 'ms');
      return false;
    }

    if (brbActive()) {
      log('skipped — BRB active');
      emit('skipped', { reason: 'brb' });
      return false;
    }

    return start(req);
  }

  /* ── trigger detection ────────────────────────────────────────────────── */
  function matchesTrigger(value) {
    if (!value) return false;
    const s = String(value).toLowerCase();
    return CONFIG.triggers.some(t => s.indexOf(t) !== -1);
  }

  function isStickerSegment(seg) {
    if (!seg || seg.type !== 'emoji') return false;
    return matchesTrigger(seg.value) ||
           matchesTrigger(seg.emojiId) ||
           matchesTrigger(seg.name) ||
           matchesTrigger(seg.shortcut);
  }

  function alreadySeen(id) {
    return id ? state.seen.has(id) : false;
  }

  function remember(id) {
    if (!id) return;
    state.seen.add(id);
    state.seenOrder.push(id);
    while (state.seenOrder.length > CONFIG.maxSeen) {
      state.seen.delete(state.seenOrder.shift());
    }
  }

  // Text fallback must not fire on prose ("that shot was disgusting").
  // Only an emoji shortcut such as :disgusting: qualifies.
  function textHasShortcut(text) {
    if (typeof text !== 'string' || text.indexOf(':') === -1) return false;
    const lower = text.toLowerCase();
    return CONFIG.triggers.some(t => lower.indexOf(':' + t + ':') !== -1);
  }

  function handleChat(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.isHistory) return false; // never replay fullscreen moments on refresh

    const id = message.id || message.ytId || null;
    if (alreadySeen(id)) return false;

    let matched = false;
    if (Array.isArray(message.segments)) {
      matched = message.segments.some(isStickerSegment);
    }
    if (!matched && textHasShortcut(message.text)) {
      matched = true;
    }
    if (!matched) return false;
    remember(id);

    return request({
      name: message.name || 'Viewer',
      amount: message.amount || null,
      source: 'chat',
      id,
    });
  }

  /* ── boot ─────────────────────────────────────────────────────────────── */
  function init() {
    if (!document.body || root) return;
    initPool();
    if (!initCloud()) log('particle cloud missing — assemble phase disabled');
    build();

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.playing) stop('operator-escape');
    });

    document.addEventListener('visibilitychange', () => {
      frame.last = 0;
    });

    // One invisible boot performance so the first real moment never stalls.
    setTimeout(warm, 250);

    // Manual verification hook: ?sticker=test delays a demo performance so a
    // browser source refresh can be checked end to end.
    const params = new URLSearchParams(location.search);
    const demo = params.get('sticker');
    if (demo === 'test' || demo === '1') {
      setTimeout(() => {
        window.StickerFX.play({ name: params.get('name') || 'TestViewer', source: 'demo' });
      }, 1200);
    }
  }

  window.StickerFX = {
    version: '2.0.0',
    handleChat,
    play(options) {
      const opts = options || {};
      return request({
        name: opts.name || 'Viewer',
        amount: opts.amount || null,
        source: opts.source || 'manual',
      });
    },
    stop,
    isBusy() { return state.playing; },
    status() {
      return {
        version: '2.0.0',
        playing: state.playing,
        warming: state.warming,
        warmed: state.warmed,
        pending: !!state.pending,
        cooldownMs: Math.max(0, Math.round(state.cooldownUntil - performance.now())),
        lastReason: state.lastReason,
        triggers: CONFIG.triggers.slice(),
        asset: CONFIG.asset,
        cloud: cloud.ready ? cloud.n : 0,
        stats: Object.assign({}, state.stats),
      };
    },
    configure(partial) {
      if (!partial || typeof partial !== 'object') return;
      if (Array.isArray(partial.triggers) && partial.triggers.length) {
        CONFIG.triggers = partial.triggers
          .map(t => String(t).toLowerCase().trim())
          .filter(Boolean);
      }
      if (Number.isFinite(partial.duration) && partial.duration >= 4500) {
        TL.duration = Math.round(partial.duration);
      }
      if (Number.isFinite(partial.cooldown) && partial.cooldown >= 0) {
        CONFIG.cooldown = Math.round(partial.cooldown);
      }
      log('configured', CONFIG);
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
