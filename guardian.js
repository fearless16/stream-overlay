// guardian.js — self-healing supervisor for yt-chat-server.js
// Spawns the chat server as a child node process and automatically respawns it
// on any exit (crash/error). A stop flag (logs/stop.flag) makes it exit instead
// of restarting, so `start.ps1 stop` works. The flag is checked both when the
// child exits and on a 1s watcher, so stopping works even without a crash.
// Restart storms are capped.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SCRIPT = path.join(ROOT, 'yt-chat-server.js');
const LOGDIR = path.join(ROOT, 'logs');
if (!fs.existsSync(LOGDIR)) fs.mkdirSync(LOGDIR, { recursive: true });
const stopFlag = path.join(LOGDIR, 'stop.flag');

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
  if (stopping || shouldStop()) { clearStop(); console.log('[guardian] stop flag set — exiting'); process.exit(0); }
  console.log('[guardian] launching', SCRIPT);
  const child = spawn(process.execPath, [SCRIPT], { cwd: ROOT, stdio: 'inherit' });
  current = child;
  child.on('exit', (code) => {
    current = null;
    if (stopping || shouldStop()) { clearStop(); console.log('[guardian] stop flag set — exiting'); process.exit(0); }
    const now = Date.now();
    restarts.push(now);
    restarts = restarts.filter((t) => now - t < WINDOW_MS);
    console.log(`[guardian] child exited (code ${code}) — restarting in 2s (${restarts.length}/${MAX_RESTARTS})`);
    if (restarts.length >= MAX_RESTARTS) {
      console.log('[guardian] too many restarts in window — stopping to avoid crash loop. Check logs/server.log');
      process.exit(1);
    }
    setTimeout(start, 2000);
  });
  child.on('error', (e) => {
    console.error('[guardian] spawn error:', e.message);
    setTimeout(start, 2000);
  });
}

// Watcher: stop promptly when the flag appears, even if the child is healthy.
setInterval(() => {
  if (!stopping && shouldStop()) {
    stopping = true;
    console.log('[guardian] stop flag detected — stopping');
    if (current) current.kill();
  }
}, 1000).unref();

console.log('[guardian] supervisor started');
start();
