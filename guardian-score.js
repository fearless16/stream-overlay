const { spawn } = require('child_process');
const path = require('path');

const ROOT = __dirname;
const SCRIPT = path.join(ROOT, 'live-score-poller.js');

const MAX_RESTARTS = 30;
const WINDOW_MS = 180000;
let restarts = [];
let stopping = false;

process.on('SIGINT', () => { stopping = true; process.exit(0); });
process.on('SIGTERM', () => { stopping = true; process.exit(0); });

function start() {
  if (stopping) return;
  console.log('[guardian-score] launching live-score-poller.js');
  const child = spawn(process.execPath, [SCRIPT], { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', (code) => {
    if (stopping) return;
    const now = Date.now();
    restarts.push(now);
    restarts = restarts.filter(t => now - t < WINDOW_MS);
    console.log(`[guardian-score] child exited (code ${code}) — restarting in 2s (${restarts.length}/${MAX_RESTARTS})`);
    if (restarts.length >= MAX_RESTARTS) {
      console.error('[guardian-score] too many restarts — giving up');
      process.exit(1);
    }
    setTimeout(start, 2000);
  });
  child.on('error', (e) => {
    console.error('[guardian-score] spawn error:', e.message);
    if (!stopping) setTimeout(start, 2000);
  });
}

console.log('[guardian-score] supervisor started');
start();
