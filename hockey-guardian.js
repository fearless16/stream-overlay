// hockey-guardian.js — self-healing supervisor for hockey-score-poller.js.
// Same contract as guardian.js but fully isolated: its own stop flag
// (logs/hockey-stop.flag), its own restart window. Never touches the
// cricket chat pipeline.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SCRIPT = path.join(ROOT, 'hockey-score-poller.js');
const LOGDIR = path.join(ROOT, 'logs');
if (!fs.existsSync(LOGDIR)) fs.mkdirSync(LOGDIR, { recursive: true });
const stopFlag = path.join(LOGDIR, 'hockey-stop.flag');

const MAX_RESTARTS = 20;
const WINDOW_MS = 120000;
let restarts = [];
let current = null;
let stopping = false;

function shouldStop() {
  try { return fs.existsSync(stopFlag); } catch { return false; }
}
function clearStop() {
  try { if (fs.existsSync(stopFlag)) fs.unlinkSync(stopFlag); } catch {}
}

function start() {
  if (stopping || shouldStop()) { clearStop(); console.log('[hockey-guardian] stop flag set — exiting'); process.exit(0); }
  console.log('[hockey-guardian] launching', SCRIPT);
  const child = spawn(process.execPath, [SCRIPT], { cwd: ROOT, stdio: 'inherit' });
  current = child;
  child.on('exit', (code) => {
    current = null;
    if (stopping || shouldStop()) { clearStop(); console.log('[hockey-guardian] stop flag set — exiting'); process.exit(0); }
    const now = Date.now();
    restarts.push(now);
    restarts = restarts.filter((t) => now - t < WINDOW_MS);
    console.log(`[hockey-guardian] child exited (code ${code}) — restarting in 2s (${restarts.length}/${MAX_RESTARTS})`);
    if (restarts.length >= MAX_RESTARTS) {
      console.log('[hockey-guardian] too many restarts in window — stopping to avoid crash loop.');
      process.exit(1);
    }
    setTimeout(start, 2000);
  });
  child.on('error', (e) => {
    console.error('[hockey-guardian] spawn error:', e.message);
    setTimeout(start, 2000);
  });
}

setInterval(() => {
  if (!stopping && shouldStop()) {
    stopping = true;
    console.log('[hockey-guardian] stop flag detected — stopping');
    if (current) current.kill();
  }
}, 1000).unref();

console.log('[hockey-guardian] supervisor started');
start();
