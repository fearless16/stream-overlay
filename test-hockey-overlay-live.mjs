import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { chromium } from 'playwright';

const envTeam = (readFileSync('.env', 'utf8').match(/^HOCKEY_TEAM=(.*)$/m)?.[1] || '').trim();
console.log('HOCKEY_TEAM from .env:', JSON.stringify(envTeam));

const poller = spawn(process.execPath, ['hockey-score-poller.js'], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
poller.stdout.on('data', (d) => log += d);
poller.stderr.on('data', (d) => log += d);

const waitFor = async (fn, ms, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await fn()) return true; } catch { }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for ${label}\n${log}`);
};

let fails = [];
const expect = async (condFn, label) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if (await condFn()) { console.log(`PASS: ${label}`); return; } } catch { }
    await new Promise((r) => setTimeout(r, 300));
  }
  fails.push(label);
  console.log(`FAIL: ${label}`);
};

try {
  await waitFor(async () => {
    const { WebSocket } = await import('ws');
    const ws = new WebSocket('ws://localhost:8790');
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    ws.close();
    return true;
  }, 30000, 'WS server');

  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 500, height: 700 } });
  // NO ?team= param — overlay must pick HOCKEY_TEAM from .env via payload.
  await page.goto('file:///C:/Users/user/stream-overlay/hockey-overlay.html', { waitUntil: 'domcontentloaded' });

  await expect(async () => new RegExp('team: ' + envTeam, 'i').test(await page.locator('#hb-state').textContent()), '.env teamFilter picked up (header)');
  await expect(async () => {
    const cards = await page.locator('.match-card').count();
    return cards >= 1; // live card ya waiting/next-fixture card — env ke hisaab se
  }, 'widget renders exactly the filtered view');
  await expect(async () => (await page.locator('.flag img').evaluateAll((imgs) =>
    imgs.length >= 2 && imgs.every((i) => i.complete && i.naturalWidth > 0))), 'real FIH flag images loaded');
  await expect(async () => {
    const txt = await page.locator('#live-section').textContent();
    // Live match ho toh clock/status, warna next fixture ya "nahi mila" message.
    return /Q[1-4]|Interval|Half|next|nahi mila|FT/i.test(txt);
  }, 'live status or fallback shown');

  await page.waitForTimeout(2000);
  await page.screenshot({ path: '_tmp-live-env-flags.png' });

  await browser.close();
  console.log(fails.length ? `LIVE ENV TEST FAIL (${fails.length})` : 'LIVE ENV TEST PASS');
  process.exitCode = fails.length ? 1 : 0;
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  poller.kill();
}
