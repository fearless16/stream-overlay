function _scCanvasInit() {
  const c = document.getElementById('sc-canvas');
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const layer = document.getElementById('sc-anim-layer');
  const r = layer.getBoundingClientRect();
  c.width = r.width * dpr; c.height = r.height * dpr;
  c.style.width = r.width + 'px'; c.style.height = r.height + 'px';
  _scCtx = c.getContext('2d'); _scCtx.scale(dpr, dpr);
  _scW = r.width; _scH = r.height;
}

function _scP(x, y, o) {
  const a = o.a != null ? o.a + (Math.random() - 0.5) * 0.5 : Math.random() * 6.283;
  const sp = o.sp != null ? o.sp * (0.5 + Math.random()) : 2 + Math.random() * 8;
  const clr = Array.isArray(o.c) ? o.c[Math.floor(Math.random() * o.c.length)] : (o.c || '#fff');
  const tArr = Array.isArray(o.t) ? o.t : [o.t || 0];
  const scatter = o.scatter || 0;
  return {
    x: x + (Math.random() - 0.5) * scatter,
    y: y + (Math.random() - 0.5) * scatter,
    vx: Math.cos(a) * sp + (o.dx || 0) * (0.7 + Math.random() * 0.6),
    vy: Math.sin(a) * sp + (o.dy || 0) * (0.7 + Math.random() * 0.6),
    l: (o.l || 1.5) * (0.7 + Math.random() * 0.6),
    ml: o.l || 1.5,
    s: (o.s || (2 + Math.random() * 6)) * (0.4 + Math.random() * 1.2),
    c: clr,
    d: (o.d || 0.97) * (0.96 + Math.random() * 0.04),
    g: (o.g || 0) * (0.5 + Math.random()),
    gl: o.gl || 0, op: (o.op || 0.85) * (0.5 + Math.random() * 0.5),
    t: tArr[Math.floor(Math.random() * tArr.length)],
    rot: Math.random() * 6.283,
    rotV: (Math.random() - 0.5) * 0.25,
    txt: o.txt || '',
  };
}

function _scSpawn(cx, cy, n, o) {
  for (let i = 0; i < n; i++) _scParts.push(_scP(cx, cy, o));
}

function _scRender() {
  const ctx = _scCtx;
  if (!ctx) return;
  ctx.clearRect(0, 0, _scW, _scH);
  let alive = false;
  for (let i = 0; i < _scParts.length; i++) {
    const p = _scParts[i];
    if (p.l <= 0) continue;
    alive = true;
    p.x += p.vx; p.y += p.vy;
    p.vx *= p.d; p.vy *= p.d;
    p.vy += p.g;
    p.rot += p.rotV;
    p.l -= 0.016;
    if (p.x < -50 || p.x > _scW + 50 || p.y < -50 || p.y > _scH + 50) { p.vx *= 0.98; p.vy *= 0.98; }
    const alpha = Math.max(0, p.l / p.ml);
    const sz = p.s * (0.3 + 0.7 * alpha);
    ctx.globalAlpha = alpha * p.op;
    ctx.fillStyle = p.c;
    if (p.gl) { ctx.shadowColor = p.c; ctx.shadowBlur = p.gl * alpha; }
    if (p.t === 1) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-sz, -sz * 0.3, sz * 2, sz * 0.6);
      ctx.restore();
    } else if (p.t === 2) {
      ctx.strokeStyle = p.c;
      ctx.lineWidth = 1.5 + 2 * alpha;
      ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, 6.283); ctx.stroke();
    } else if (p.t === 3) {
      ctx.font = (sz * 2.5) + 'px Impact,system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = p.c;
      ctx.shadowBlur = (p.gl || 10) * alpha;
      ctx.fillText(p.txt || '✦', p.x, p.y);
    } else if (p.t === 4) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.moveTo(0, -sz);
      ctx.lineTo(-sz * 0.866, sz * 0.5);
      ctx.lineTo(sz * 0.866, sz * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (p.t === 5) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.moveTo(0, -sz);
      ctx.lineTo(sz * 0.7, 0);
      ctx.lineTo(0, sz);
      ctx.lineTo(-sz * 0.7, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (p.t === 6) {
      const s2 = sz * 0.4;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-s2, -s2, s2 * 2, s2 * 2);
      ctx.beginPath();
      ctx.arc(s2 * 1.5, 0, s2 * 0.5, 0, 6.283);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-s2 * 1.5, 0, s2 * 0.5, 0, 6.283);
      ctx.fill();
      ctx.restore();
    } else if (p.t === 9) { // Cyber Hexagon
      ctx.strokeStyle = p.c; ctx.lineWidth = 2 + alpha * 2;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.beginPath();
      for (let j = 0; j < 6; j++) {
        ctx.lineTo(sz * 1.5 * Math.cos(j * Math.PI / 3), sz * 1.5 * Math.sin(j * Math.PI / 3));
      }
      ctx.closePath(); ctx.stroke(); ctx.restore();
    } else if (p.t === 10) { // Sci-Fi HUD Ring
      ctx.strokeStyle = p.c; ctx.lineWidth = 1 + alpha * 3;
      ctx.save(); ctx.translate(p.x, p.y);
      ctx.beginPath(); ctx.arc(0, 0, sz * 2, p.rot, p.rot + Math.PI * 1.2);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, sz * 1.2, -p.rot, -p.rot + Math.PI * 0.8);
      ctx.stroke();
      ctx.restore();
    } else if (p.t === 11) { // Laser Streak
      ctx.fillStyle = p.c;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.fillRect(-sz * 3, -sz * 0.2, sz * 6, sz * 0.4);
      ctx.restore();
    } else {
      ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, 6.283); ctx.fill();
    }
  }
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  if (alive) _scAnimFrame = requestAnimationFrame(_scRender);
  else { _scParts = []; _scAnimFrame = null; }
}

function _scSpawnEvent(eventType) {
  _scCanvasInit();
  _scParts = [];
  if (_scAnimFrame) { cancelAnimationFrame(_scAnimFrame); _scAnimFrame = null; }
  const cx = _scW / 2, cy = _scH / 2;
  if (eventType === '4') {
    _scSpawn(cx, cy, 80, { c: ['#ff2d95','#ff66b2','#ff3399','#ff0066'], l: 3.5, sp: 5 + Math.random() * 20, scatter: 80, g: 0.05, d: 0.96, gl: 14, t: [9, 10, 11, 11, 1, 4] });
    setTimeout(() => _scSpawn(cx, cy, 80, { c: ['#ff2d95','#ff66b2','#ff3399','#ff0066'], l: 3.5, sp: 5 + Math.random() * 20, scatter: 80, g: 0.05, d: 0.96, gl: 14, t: [9, 10, 11, 11, 1, 4] }), 250);
    setTimeout(() => _scSpawn(cx, cy, 30, { c: '#ff66b2', l: 2.5, sp: 1 + Math.random() * 5, scatter: 20, g: 0.08, d: 0.97, gl: 8, t: [1,4,5] }), 500);
  } else if (eventType === '6') {
    const cols = ['#00ff88','#00e676','#00c853','#69f0ae','#a7ffb8'];
    _scSpawn(cx, cy, 150, { c: cols, l: 3.8, sp: 8 + Math.random() * 25, scatter: 120, g: 0.03, d: 0.97, gl: 18, t: [9, 9, 10, 11, 11] });
    setTimeout(() => _scSpawn(cx, cy, 60, { c: '#00ff88', l: 3, sp: 2 + Math.random() * 8, scatter: 30, g: 0.06, d: 0.97, gl: 22, t: [0,1,4,5,6] }), 250);
    setTimeout(() => _scSpawn(cx, cy, 60, { c: ['#00ff88','#fff','#69f0ae'], l: 3, sp: 1 + Math.random() * 4, scatter: 60, g: 0.02, d: 0.99, gl: 10, t: 3, txt: '✦' }), 600);
  } else if (eventType === 'bold') {
    _scSpawn(cx, cy, 60, { c: ['#ff2d55','#cc0022','#ff6b6b','#ff1744'], l: 3 + Math.random(), sp: 2 + Math.random() * 10, scatter: 35, g: 0.06, d: 0.95, gl: 12, t: [9, 10, 11, 11, 2, 7] });
    setTimeout(() => _scSpawn(cx, cy, 60, { c: ['#ff2d55','#cc0022','#ff6b6b','#ff1744'], l: 3 + Math.random(), sp: 2 + Math.random() * 10, scatter: 35, g: 0.06, d: 0.95, gl: 12, t: [9, 10, 11, 11, 2, 7] }), 150);
    setTimeout(() => _scSpawn(cx, cy, 60, { c: ['#ff2d55','#cc0022','#ff6b6b','#ff1744'], l: 3 + Math.random(), sp: 2 + Math.random() * 10, scatter: 35, g: 0.06, d: 0.95, gl: 12, t: [9, 10, 11, 11, 2, 7] }), 300);
    setTimeout(() => _scSpawn(cx, cy, 30, { c: '#ff2d55', l: 2, sp: 4 + Math.random() * 8, scatter: 25, g: 0.1, d: 0.93, gl: 10, t: [1,4,5] }), 500);
  } else if (eventType === 'caught') {
    _scSpawn(cx, cy, 120, { c: ['#ff6348','#ff4757','#ff2d55','#ff9f43','#e17055'], l: 3.2, sp: 2 + Math.random() * 7, scatter: 45, g: 0.07, d: 0.97, gl: 10, t: [0,0,0,1,4,5], dy: -3 });
    setTimeout(() => _scSpawn(cx, cy, 60, { c: '#ff6348', l: 2.8, sp: 1 + Math.random() * 4, scatter: 120, g: 0.04, d: 0.98, gl: 8, t: 3, txt: '⚡', dy: -4 }), 350);
  } else if (eventType === 'lbw') {
    _scSpawn(cx, cy, 110, { c: ['#eab308','#ff6348','#fbbf24','#fff','#f59e0b'], l: 3.5, sp: 3 + Math.random() * 10, scatter: 80, g: 0.06, d: 0.97, gl: 14, t: [0,0,0,1,4,5,5] });
    setTimeout(() => _scSpawn(cx, cy, 40, { c: '#eab308', l: 2.5, sp: 2 + Math.random() * 6, scatter: 25, g: 0.06, d: 0.97, gl: 12, t: [0,1,4,5] }), 300);
    setTimeout(() => _scSpawn(cx, cy, 20, { c: '#fff', l: 2, sp: 1 + Math.random() * 3, scatter: 80, g: 0.02, d: 0.99, gl: 22, t: 3, txt: '⚖' }), 500);
  } else if (eventType === 'runout') {
    _scSpawn(cx, cy, 150, { c: ['#ff2d55','#ff6b35','#cc0022','#ff1744','#ff8a80'], l: 3.2, sp: 5 + Math.random() * 20, scatter: 120, g: 0.05, d: 0.95, gl: 12, t: [0,0,0,1,4,4,5,6] });
    setTimeout(() => _scSpawn(cx, cy, 50, { c: '#ff2d55', l: 2.5, sp: 1 + Math.random() * 5, scatter: 30, g: 0.07, d: 0.96, gl: 10, t: [1,4,5,6] }), 200);
    setTimeout(() => _scSpawn(cx, cy, 30, { c: '#ff6b35', l: 2.5, sp: 3 + Math.random() * 8, scatter: 35, g: 0.1, d: 0.94, gl: 8, t: [1,4,5] }), 500);
  } else if (eventType === 'duck') {
    _scSpawn(cx, cy, 100, { c: ['#ffa502','#ff6348','#ff8c00','#f59e0b','#ffd93d'], l: 3.2, sp: 2 + Math.random() * 8, scatter: 80, g: 0.05, d: 0.97, gl: 10, t: [0,0,0,1,4,5], dy: -1 });
    setTimeout(() => _scSpawn(cx, cy, 40, { c: '#ffa502', l: 2.5, sp: 1 + Math.random() * 4, scatter: 35, g: 0.04, d: 0.98, t: 3, txt: '🦆', dy: -3, gl: 8 }), 300);
    setTimeout(() => _scSpawn(cx, cy, 30, { c: '#ff6348', l: 2, sp: 3 + Math.random() * 6, scatter: 30, g: 0.08, d: 0.95, gl: 8, t: [1,4,5] }), 600);
  } else if (eventType === 'wicket') {
    const cols = ['#8b5cf6','#ff2d55','#a78bfa','#c084fc','#ff6b6b'];
    _scSpawn(cx, cy, 110, { c: cols, l: 3.4, sp: 3 + Math.random() * 11, scatter: 42, g: 0.06, d: 0.96, gl: 12, t: [0,0,0,1,4,5] });
    setTimeout(() => _scSpawn(cx, cy, 70, { c: ['#8b5cf6','#fff','#a78bfa'], l: 2.8, sp: 2 + Math.random() * 7, scatter: 38, g: 0.05, d: 0.97, gl: 10, t: [1,4,5] }), 200);
    setTimeout(() => _scSpawn(cx, cy, 30, { c: '#fff', l: 2.2, sp: 1 + Math.random() * 4, scatter: 45, g: 0.03, d: 0.99, gl: 16, t: 3, txt: '⚡' }), 500);
  }
  _scRender();
}

function _triggerCricketAnim(card, eventType) {
  // A milestone celebration owns the screen — queue this classic event and
  // play it the moment the milestone ends, so the two never overlap.
  if (_msAnimTimer) { _scQueued = eventType; return; }
  __animFireCount++;
  const layer = $('sc-anim-layer');
  const cls = 'sc-cricket-' + eventType;
  if (_cricketAnimTimer) { clearTimeout(_cricketAnimTimer); _cricketAnimTimer = null; }
  card.classList.remove('sc-flash-boundary', 'sc-flash-wicket', 'sc-shake', 'sc-update',
    'sc-cricket-4', 'sc-cricket-6',
    'sc-cricket-bold', 'sc-cricket-caught',
    'sc-cricket-lbw', 'sc-cricket-runout',
    'sc-cricket-duck', 'sc-cricket-wicket');
  layer.classList.remove('active');
  void card.offsetWidth;
  card.classList.add(cls);
  layer.classList.add('active');
  if (eventType === 'bold' || eventType === 'caught' || eventType === 'lbw' || eventType === 'runout' || eventType === 'duck' || eventType === 'wicket') {
    card.classList.add('sc-flash-wicket', 'sc-shake');
  } else {
    card.classList.add('sc-flash-boundary');
  }
  _scSpawnEvent(eventType);
  _cricketAnimTimer = setTimeout(() => {
    card.classList.remove(cls,
      'sc-cricket-4', 'sc-cricket-6',
      'sc-cricket-bold', 'sc-cricket-caught',
      'sc-cricket-lbw', 'sc-cricket-runout',
      'sc-cricket-duck', 'sc-cricket-wicket',
      'sc-flash-wicket', 'sc-flash-boundary', 'sc-shake');
    layer.classList.remove('active');
    _cricketAnimTimer = null;
    // A milestone that arrived mid-celebration plays the moment this ends.
    if (_msQueued) { const q = _msQueued; _msQueued = null; _triggerMilestoneAnim(card, q.type, q.name); }
  }, 4000);
}

function _scDemoLoop() {
  const events = ['4','6','bold','caught','lbw','runout','duck'];
  let i = 0;
  function next() {
    const card = document.getElementById('scorecard');
    if (!card) return;
    _triggerCricketAnim(card, events[i % events.length]);
    i++;
    setTimeout(next, 4200);
  }
  next();
}

/* ════════════════════════════════════════
   MILESTONE ENGINE — batter 50/100/150/200/250, bowler 3/4/5-wicket haul
   Fires off live score deltas in updateScore (never on the first
   snapshot), renders on its own sc-ms-layer (2 lines: milestone
   label + CONGRATULATIONS) so the classic cricket celebrations
   are untouched.
   ════════════════════════════════════════ */
let _msCtx = null, _msW = 0, _msH = 0, _msParts = [], _msFrame = null;
let _msAnimTimer = null;
let _msQueued = null;   // milestone held while a classic celebration runs
let _scQueued = null;   // classic celebration held while a milestone runs
let _msBatter = {};        // batter name -> Set of milestone runs already celebrated
let _msBowler = null;      // { name, lastWk, fired: Set }

const _glowCache = {};
const _textSpriteCache = {};
const _MAX_PARTS = 320;
const _TEXT_SPRITE_PX = 96;
const _TEXT_SPRITE_FONT = 64;
function _glowSprite(color) {
  let s = _glowCache[color];
  if (s) return s;
  s = document.createElement('canvas');
  const S = 64;
  s.width = S; s.height = S;
  const g = s.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.55, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  _glowCache[color] = s;
  return s;
}
// Pre-renders a glowing text/emoji glyph ONCE (per color+text) so the render
// loop only does a cheap scaled drawImage instead of per-frame fillText
// (rasterizing an emoji glyph each frame was ~1.3ms — the haul jank source).
function _textSprite(color, txt) {
  const key = color + '|' + txt;
  let s = _textSpriteCache[key];
  if (s) return s;
  const S = _TEXT_SPRITE_PX;
  s = document.createElement('canvas');
  s.width = S; s.height = S;
  const g = s.getContext('2d');
  const F = _TEXT_SPRITE_FONT;
  const grad = g.createRadialGradient(S / 2, S / 2, F * 0.2, S / 2, S / 2, S / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.55, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.font = F + 'px Impact,system-ui';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.fillText(txt, S / 2, S / 2);
  _textSpriteCache[key] = s;
  return s;
}

function _msCanvasInit() {
  const c = document.getElementById('sc-ms-canvas');
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const layer = document.getElementById('sc-ms-layer');
  const r = layer.getBoundingClientRect();
  c.width = Math.max(10, r.width * dpr); c.height = Math.max(10, r.height * dpr);
  c.style.width = r.width + 'px'; c.style.height = r.height + 'px';
  _msCtx = c.getContext('2d'); _msCtx.scale(dpr, dpr);
  _msW = r.width; _msH = r.height;
}

function _msSpawn(cx, cy, n, o) {
  for (let i = 0; i < n && _msParts.length < _MAX_PARTS; i++) _msParts.push(_scP(cx, cy, o));
}

function _msRender() {
  const ctx = _msCtx;
  if (!ctx) return;
  ctx.clearRect(0, 0, _msW, _msH);
  let alive = false;
  for (let i = 0; i < _msParts.length; i++) {
    const p = _msParts[i];
    if (p.l <= 0) continue;
    alive = true;
    p.x += p.vx; p.y += p.vy;
    p.vx *= p.d; p.vy *= p.d;
    p.vy += p.g;
    p.rot += p.rotV;
    p.l -= 0.016;
    if (p.x < -60 || p.x > _msW + 60 || p.y < -60 || p.y > _msH + 60) { p.vx *= 0.98; p.vy *= 0.98; }
    const alpha = Math.max(0, p.l / p.ml);
    const sz = p.s * (0.3 + 0.7 * alpha);
    ctx.globalAlpha = alpha * p.op;
    ctx.fillStyle = p.c;
    if (p.gl) { const gr = sz * 3.4; ctx.drawImage(_glowSprite(p.c), p.x - gr, p.y - gr, gr * 2, gr * 2); }
    if (p.t === 1) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillRect(-sz, -sz * 0.3, sz * 2, sz * 0.6); ctx.restore();
    } else if (p.t === 2) {
      ctx.strokeStyle = p.c; ctx.lineWidth = 1.5 + 2 * alpha;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.moveTo(0, -sz); ctx.lineTo(sz, 0); ctx.lineTo(0, sz); ctx.lineTo(-sz, 0);
      ctx.closePath(); ctx.stroke(); ctx.restore();
    } else if (p.t === 3) {
      const spr = _textSprite(p.c, p.txt || '0');
      const target = sz * 2.2 / _TEXT_SPRITE_FONT * _TEXT_SPRITE_PX;
      ctx.drawImage(spr, p.x - target / 2, p.y - target / 2, target, target);
    } else if (p.t === 4) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.moveTo(0, -sz); ctx.lineTo(-sz * 0.866, sz * 0.5); ctx.lineTo(sz * 0.866, sz * 0.5);
      ctx.closePath(); ctx.fill(); ctx.restore();
    } else if (p.t === 5) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.7, 0); ctx.lineTo(0, sz); ctx.lineTo(-sz * 0.7, 0);
      ctx.closePath(); ctx.fill(); ctx.restore();
    } else if (p.t === 7) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 === 0 ? sz : sz * 0.45;
        const ang = -Math.PI / 2 + k * Math.PI / 5;
        const px = Math.cos(ang) * r, py = Math.sin(ang) * r;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.restore();
    } else if (p.t === 9) { // Cyber Hexagon
      ctx.strokeStyle = p.c; ctx.lineWidth = 2 + alpha * 2;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.beginPath();
      for (let j = 0; j < 6; j++) {
        ctx.lineTo(sz * 1.5 * Math.cos(j * Math.PI / 3), sz * 1.5 * Math.sin(j * Math.PI / 3));
      }
      ctx.closePath(); ctx.stroke(); ctx.restore();
    } else if (p.t === 10) { // Sci-Fi HUD Ring
      ctx.strokeStyle = p.c; ctx.lineWidth = 1 + alpha * 3;
      ctx.save(); ctx.translate(p.x, p.y);
      ctx.beginPath(); ctx.arc(0, 0, sz * 2, p.rot, p.rot + Math.PI * 1.2);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, sz * 1.2, -p.rot, -p.rot + Math.PI * 0.8);
      ctx.stroke();
      ctx.restore();
    } else if (p.t === 11) { // Laser Streak
      ctx.fillStyle = p.c;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.fillRect(-sz * 3, -sz * 0.2, sz * 6, sz * 0.4);
      ctx.restore();
    } else {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillRect(-sz, -sz, sz * 2, sz * 2); ctx.restore();
    }
  }
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  if (alive) _msFrame = requestAnimationFrame(_msRender);
  else { _msParts = []; _msFrame = null; }
}

function _msSpawnEvent(type) {
  _msCanvasInit();
  _msParts = [];
  if (_msFrame) { cancelAnimationFrame(_msFrame); _msFrame = null; }
  const cx = _msW / 2, cy = _msH / 2;
  const burst = (n, cols, opts) => _msSpawn(cx, cy, n, Object.assign({ scatter: 55, g: 0.03, d: 0.97 }, opts, { c: cols }));
  // Color identity per event — matches the CSS gradients
  const C50  = ['#00e5ff', '#2979ff', '#00c8ff', '#7b4dff', '#a7f3ff'];
  const C100 = ['#ff2ec4', '#ff0080', '#ff8adf', '#c084fc', '#ff00a0'];
  const C150 = ['#c6ff00', '#aaff00', '#00e676', '#4caf50', '#d9ff4d'];
  const C200 = ['#ffd700', '#ffb300', '#ff9100', '#ff6d00', '#ffe45c'];
  const C250 = ['#b06bff', '#8b5cf6', '#6d28d9', '#c4a0ff', '#7c3aed'];
  const C3   = ['#00ffa3', '#00e676', '#00c853', '#5cffb0', '#a7ffdc'];
  const C4   = ['#ff5252', '#ff1744', '#d50000', '#ff8a80', '#ff6b6b'];
  const C5   = ['#ff9100', '#ffab40', '#ff3d00', '#ff6d00', '#ffcc80'];
  if (type === 50) {
    burst(150, C50, { l: 3.6, sp: 3 + Math.random() * 13, gl: 16, t: [7,0,0,0,1,4,5] });
    setTimeout(() => burst(80, [C50[0], C50[4]], { l: 2.6, sp: 2 + Math.random() * 7, gl: 12, t: [1,4,5,7] }), 250);
    setTimeout(() => _msSpawn(cx, cy, 60, { c: [C50[0], C50[3], '#fff'], l: 2.4, sp: 1 + Math.random() * 4, g: 0.02, d: 0.99, gl: 14, t: 3, txt: Math.random() > 0.5 ? '0' : '1', scatter: 70 }), 550);
    setTimeout(() => burst(26, [C50[0], C50[3]], { l: 2.8, sp: 1 + Math.random() * 3, g: 0, d: 0.99, gl: 10, t: 7, s: 8 + Math.random() * 12, scatter: 20 }), 800);
  } else if (type === 100) {
    burst(170, C100, { l: 3.8, sp: 4 + Math.random() * 15, gl: 18, t: [7,0,0,0,1,4,5] });
    setTimeout(() => burst(90, [C100[2], C100[0]], { l: 2.8, sp: 2 + Math.random() * 8, gl: 14, t: [1,4,5,7] }), 250);
    setTimeout(() => _msSpawn(cx, cy, 70, { c: [C100[0], '#fff', C100[3]], l: 2.4, sp: 1 + Math.random() * 4, g: 0.02, d: 0.99, gl: 16, t: 3, txt: '✦', scatter: 70 }), 550);
    setTimeout(() => burst(20, [C100[2], C100[0]], { l: 3, sp: 1 + Math.random() * 3, g: 0, d: 0.99, gl: 12, t: 7, s: 10 + Math.random() * 14, scatter: 24 }), 800);
  } else if (type === 150) {
    burst(190, C150, { l: 4, sp: 4 + Math.random() * 16, gl: 18, t: [7,0,0,0,1,4,5] });
    setTimeout(() => burst(110, [C150[0], C150[2]], { l: 3, sp: 2 + Math.random() * 9, gl: 14, t: [1,4,5,7] }), 250);
    setTimeout(() => _msSpawn(cx, cy, 80, { c: [C150[0], C150[2], '#fff'], l: 2.6, sp: 1 + Math.random() * 5, g: 0.02, d: 0.99, gl: 16, t: 3, txt: '✦', scatter: 80 }), 550);
    setTimeout(() => burst(30, [C150[0], C150[2]], { l: 3.2, sp: 1 + Math.random() * 3, g: 0, d: 0.99, gl: 12, t: 7, s: 9 + Math.random() * 14, scatter: 24 }), 800);
  } else if (type === 200) {
    burst(210, C200, { l: 4, sp: 4 + Math.random() * 16, gl: 18, t: [7,0,0,0,1,4,5] });
    setTimeout(() => burst(120, [C200[0], C200[2]], { l: 3, sp: 2 + Math.random() * 9, gl: 14, t: [1,4,5,7] }), 250);
    setTimeout(() => _msSpawn(cx, cy, 90, { c: [C200[0], C200[3], '#fff'], l: 2.6, sp: 1 + Math.random() * 5, g: 0.02, d: 0.99, gl: 16, t: 3, txt: '✦', scatter: 80 }), 550);
    setTimeout(() => burst(34, [C200[2], C200[0]], { l: 3.2, sp: 1 + Math.random() * 3, g: 0, d: 0.99, gl: 12, t: 7, s: 9 + Math.random() * 14, scatter: 24 }), 800);
  } else if (type === 250) {
    burst(230, C250, { l: 4.2, sp: 4 + Math.random() * 17, gl: 20, t: [7,0,0,0,1,4,5] });
    setTimeout(() => burst(130, [C250[0], C250[2]], { l: 3, sp: 2 + Math.random() * 10, gl: 15, t: [1,4,5,7] }), 250);
    setTimeout(() => _msSpawn(cx, cy, 100, { c: [C250[0], C250[3], '#fff'], l: 2.8, sp: 1 + Math.random() * 5, g: 0.02, d: 0.99, gl: 18, t: 3, txt: '✦', scatter: 90 }), 550);
    setTimeout(() => burst(38, [C250[1], C250[0]], { l: 3.4, sp: 1 + Math.random() * 3, g: 0, d: 0.99, gl: 13, t: 7, s: 10 + Math.random() * 15, scatter: 26 }), 800);
  } else if (type === 'haul3') {
    burst(160, C3, { l: 3.6, sp: 3 + Math.random() * 14, gl: 16, t: [7,0,0,0,1,4,5] });
    setTimeout(() => burst(100, [C3[0], C3[1]], { l: 2.8, sp: 2 + Math.random() * 8, gl: 14, t: [1,4,5,7] }), 200);
    setTimeout(() => _msSpawn(cx, cy, 60, { c: [C3[0], C3[1], '#fff'], l: 2.5, sp: 2 + Math.random() * 5, g: 0.03, d: 0.98, gl: 16, t: 3, txt: '⚡', scatter: 60 }), 450);
    setTimeout(() => burst(40, [C3[1], C3[0]], { l: 3, sp: 1 + Math.random() * 3, g: 0, d: 0.99, gl: 12, t: 7, s: 10 + Math.random() * 16, scatter: 20 }), 700);
  } else if (type === 'haul4') {
    burst(185, C4, { l: 3.8, sp: 3 + Math.random() * 15, gl: 18, t: [7,0,0,0,1,4,5] });
    setTimeout(() => burst(110, [C4[0], C4[2]], { l: 3, sp: 2 + Math.random() * 9, gl: 15, t: [1,4,5,7] }), 200);
    setTimeout(() => _msSpawn(cx, cy, 70, { c: [C4[0], C4[3], '#fff'], l: 2.6, sp: 2 + Math.random() * 5, g: 0.03, d: 0.98, gl: 18, t: 3, txt: '⚡', scatter: 65 }), 450);
    setTimeout(() => burst(45, [C4[1], C4[0]], { l: 3.1, sp: 1 + Math.random() * 3, g: 0, d: 0.99, gl: 13, t: 7, s: 11 + Math.random() * 16, scatter: 22 }), 700);
  } else if (type === 'haul5') {
    burst(210, C5, { l: 4, sp: 4 + Math.random() * 16, gl: 20, t: [7,0,0,0,1,4,5] });
    setTimeout(() => burst(125, [C5[0], C5[2]], { l: 3, sp: 2 + Math.random() * 10, gl: 16, t: [1,4,5,7] }), 200);
    setTimeout(() => _msSpawn(cx, cy, 80, { c: [C5[0], C5[1], '#fff'], l: 2.7, sp: 2 + Math.random() * 5, g: 0.03, d: 0.98, gl: 18, t: 3, txt: '⚡', scatter: 70 }), 450);
    setTimeout(() => burst(50, [C5[2], C5[0]], { l: 3.2, sp: 1 + Math.random() * 3, g: 0, d: 0.99, gl: 14, t: 7, s: 11 + Math.random() * 17, scatter: 24 }), 700);
  }
  _msRender();
}

function _triggerMilestoneAnim(card, type, name) {
  const layer = document.getElementById('sc-ms-layer');
  if (!card || !layer) return;
  // A classic celebration owns the screen — hold this milestone and play it
  // the moment that animation ends, so the two never overlap.
  if (_cricketAnimTimer) { _msQueued = { type, name }; return; }
  const cls = type === 'haul3' ? 'sc-ms-3'
    : type === 'haul4' ? 'sc-ms-4'
    : type === 'haul5' ? 'sc-ms-5'
    : 'sc-ms-' + type;
  if (_msAnimTimer) { clearTimeout(_msAnimTimer); _msAnimTimer = null; }
  card.classList.remove('sc-ms-50', 'sc-ms-100', 'sc-ms-150', 'sc-ms-200', 'sc-ms-250', 'sc-ms-3', 'sc-ms-4', 'sc-ms-5');
  layer.classList.remove('active');
  void card.offsetWidth;
  card.classList.add(cls);
  layer.classList.add('active');
  _msSpawnEvent(type);
  _msAnimTimer = setTimeout(() => {
    card.classList.remove('sc-ms-50', 'sc-ms-100', 'sc-ms-150', 'sc-ms-200', 'sc-ms-250', 'sc-ms-3', 'sc-ms-4', 'sc-ms-5');
    layer.classList.remove('active');
    _msAnimTimer = null;
    // A classic celebration that arrived mid-milestone plays the moment this ends.
    if (_scQueued) { const q = _scQueued; _scQueued = null; _triggerCricketAnim(card, q); }
  }, 4000);
}

// Returns the biggest milestone crossed this update, or null. Never fires on
// the first snapshot (the caller gates on prev) so a half-watched match does
// not celebrate milestones that fell before the overlay opened.
function _detectMilestones(merged) {
  if (!merged || !Array.isArray(merged.batsmen)) return null;
  let out = null;
  (merged.batsmen || []).forEach(b => {
    if (!b || !b.name) return;
    const runs = parseInt(b.runs, 10);
    if (isNaN(runs)) return;
    const set = _msBatter[b.name] || (_msBatter[b.name] = new Set());
    // Same name back below 30 = a fresh innings, allow the milestone again.
    if (runs < 30 && set.has(50)) set.clear();
    const crossed = [50, 100, 150, 200, 250].filter(m => runs >= m && !set.has(m));
    if (crossed.length) {
      const m = crossed[crossed.length - 1];
      set.add(m);
      out = { type: m, name: b.name };
    }
  });
  const bw = merged.bowler;
  if (bw && bw.name) {
    const wk = parseInt(bw.wickets, 10);
    const wkNum = isNaN(wk) ? 0 : wk;
    if (!_msBowler || _msBowler.name !== bw.name) {
      _msBowler = { name: bw.name, lastWk: wkNum, fired: new Set() };
    } else {
      const prevWk = _msBowler.lastWk;
      // Only celebrate hauls actually crossed this update (baseline on first
      // sighting never fires) and each haul exactly once per bowler spell.
      const hauls = [3, 4, 5].filter(h => wkNum >= h && h > prevWk && !_msBowler.fired.has(h));
      if (hauls.length) {
        const h = hauls[hauls.length - 1];
        _msBowler.fired.add(h);
        out = { type: 'haul' + h, name: bw.name };
      }
      _msBowler.lastWk = Math.max(_msBowler.lastWk, wkNum);
    }
  }
  return out;
}

/* ── milestone demo mode (?mode=milestone-demo) ──────────────────────────── */
const _msDemoBatter = 'Virat Kohli';
const _msDemoBowler = 'Jasprit Bumrah';
let _msDemoTimer = null;
let _msDemoRunning = false;

