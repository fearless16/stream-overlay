// Deterministic JS timeline for scene geometry tests. Not an FPS benchmark.
module.exports = function virtualClock() {
  let now = 0, id = 0;
  const jobs = new Map();
  Object.defineProperty(performance, 'now', { value: () => now });
  window.setTimeout = (fn, ms = 0, ...args) => {
    const key = ++id; jobs.set(key, { at: now + Math.max(1, Number(ms) || 0), fn: () => fn(...args) }); return key;
  };
  window.clearTimeout = key => jobs.delete(key);
  window.requestAnimationFrame = fn => {
    const key = ++id; jobs.set(key, { at: now + 1000 / 60, fn: () => fn(now) }); return key;
  };
  window.cancelAnimationFrame = key => jobs.delete(key);
  window.__advance = ms => {
    const target = now + ms;
    let count = 0;
    while (jobs.size) {
      let key, next;
      for (const [k, j] of jobs) if (!next || j.at < next.at) { key = k; next = j; }
      if (next.at > target) break;
      if (++count > 1000000) throw Error('Runaway timer');
      now = next.at; jobs.delete(key); next.fn();
    }
    now = target;
  };
  window.__clockJobs = () => jobs.size;
};
