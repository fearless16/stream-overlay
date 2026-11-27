'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const query = new URLSearchParams(location.search);
  const slates = {
    starting: ['FIRST BALL', 'Starting soon', 'Get settled. The watch-along is about to begin.'],
    break: ['PLAY PAUSED', 'Back shortly', 'The watch-along will resume in a moment.'],
    end: ['THAT’S STUMPS', 'Thanks for watching', 'See you at the next match.'],
    technical: ['QUICK PAUSE', 'Technical pause', 'We’re checking the feed. Hang tight.'],
  };
  const mode = query.get('mode');
  const resize = () => $('canvas').style.setProperty('--scale', Math.min(innerWidth / 720, innerHeight / 1280));
  addEventListener('resize', resize, { passive: true });
  resize();
  document.querySelector('.guides').hidden = query.get('guides') !== '1';
  if (Object.hasOwn(slates, mode)) {
    document.body.dataset.mode = mode;
    [$('slate-kicker').textContent, $('slate-title').textContent, $('slate-copy').textContent] = slates[mode];
    return;
  }

  const overlay = $('comment');
  let snapshot = null;
  let ws;
  let retry;
  let watchdog;
  let frame;
  let attempts = 0;
  let lastFrame = 0;
  let lastMessage = 0;
  let received = 0;
  let stopped = false;
  const set = (id, value) => {
    const node = $(id);
    if (node.textContent !== value) node.textContent = value;
  };

  function render(time) {
    frame = null;
    const serverNow = snapshot ? snapshot.now + (time - received) : 0;
    const connected = ws?.readyState === WebSocket.OPEN;
    const comment = connected && snapshot?.comment?.until > serverNow ? snapshot.comment : null;
    overlay.hidden = !comment;
    set('comment-name', comment?.name || '');
    set('comment-text', comment?.text || '');
    if (connected && ws.bufferedAmount < 128 && (!lastFrame || time - lastFrame > 3300)) {
      ws.send('rendered');
      lastFrame = time;
    }
  }

  function update() { if (frame == null) frame = requestAnimationFrame(render); }
  function connect() {
    if (stopped) return;
    const host = location.protocol === 'http:' && location.hostname === '127.0.0.1' ? location.host : '127.0.0.1:8767';
    ws = new WebSocket(`ws://${host}/feed`);
    lastMessage = performance.now();
    ws.onmessage = ({ data }) => {
      try {
        const incoming = JSON.parse(data);
        if (incoming.type !== 'portrait' || !Number.isFinite(incoming.now)) return;
        snapshot = incoming;
        received = lastMessage = performance.now();
        attempts = 0;
        update();
      } catch { /* ignore malformed data */ }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      snapshot = null;
      lastFrame = 0;
      if (stopped) return;
      update();
      retry = setTimeout(connect, Math.min(24_000, 700 * 2 ** Math.min(attempts++, 6)) + Math.random() * 500);
    };
  }
  connect();
  watchdog = setInterval(() => {
    if (ws && ws.readyState <= WebSocket.OPEN && performance.now() - lastMessage > 14_000) ws.close();
    update();
  }, 1000);
  addEventListener('pagehide', () => {
    stopped = true;
    clearInterval(watchdog);
    clearTimeout(retry);
    if (frame != null) cancelAnimationFrame(frame);
    ws?.close();
  }, { once: true });
})();
