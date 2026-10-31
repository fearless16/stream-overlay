/* One FIFO for celebratory animations. Chat/score updates continue normally. */
(function () {
  'use strict';
  if (window.AnimationStage) return;
  const pending = [];
  let active = null;
  let timer = 0;
  let draining = false;
  const stats = { started: 0, completed: 0, failed: 0, rejected: 0, cancelled: 0 };
  const blocked = () => document.getElementById('brb-overlay')?.classList.contains('active');
  function emit(type, extra) {
    document.dispatchEvent(new CustomEvent('animation-stage', {
      detail: { type, kind: active?.kind || null, queued: pending.length, ...extra },
    }));
  }
  function finish(reason) {
    if (!active) return;
    clearTimeout(timer);
    timer = 0;
    const job = active;
    try { job.cleanup?.(); } catch (err) { console.error('[AnimationStage] cleanup', err); }
    active = null;
    if (reason === 'complete') stats.completed++;
    else if (reason === 'error') stats.failed++;
    else stats.cancelled++;
    emit('end', { kind: job.kind, reason });
    drain();
  }
  function drain() {
    if (active || draining || blocked()) return;
    draining = true;
    try {
      while (!active && pending.length && !blocked()) {
        active = pending.shift();
        stats.started++;
        emit('start');
        try {
          active.cleanup = active.run();
          // A deadline also releases the stage if a legacy animation fails to finish.
          timer = setTimeout(() => finish('complete'), active.duration);
        } catch (err) {
          console.error('[AnimationStage] animation failed', active.kind, err);
          finish('error');
        }
      }
    } finally { draining = false; }
  }
  window.AnimationStage = {
    enqueue(kind, run, duration) {
      if (typeof run !== 'function' || !Number.isFinite(duration) || duration < 1) return false;
      if (pending.length >= 1024) {
        stats.rejected++;
        console.error('[AnimationStage] Queue full; rejected:', kind);
        emit('error', { reason: 'queue-full', rejectedKind: kind });
        return false;
      }
      pending.push({ kind, run, duration: Math.min(60000, duration), cleanup: null });
      emit('queued', { added: kind });
      drain();
      return true;
    },
    cancelAll(reason = 'operator') {
      pending.length = 0;
      finish(reason);
    },
    isBusy() { return !!active; },
    status() {
      return { health: stats.failed || stats.rejected ? 'warning' : blocked() ? 'paused' : 'healthy',
        active: active?.kind || null, queued: pending.length, stats: { ...stats } };
    },
  };
  const brb = document.getElementById('brb-overlay');
  if (brb) new MutationObserver(() => {
    if (blocked()) finish('brb');
    else drain();
  }).observe(brb, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.AnimationStage.cancelAll('operator-escape');
  });
  window.addEventListener('pagehide', () => window.AnimationStage.cancelAll('pagehide'));
})();
