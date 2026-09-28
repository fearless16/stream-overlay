import { spawn } from 'child_process';
import { chromium } from 'playwright';

// Start the real poller (it hosts ws://localhost:8790 and fetches FIH live).
const poller = spawn(process.execPath, ['hockey-score-poller.js'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let pollerLog = '';
poller.stdout.on('data', (d) => { pollerLog += d; });
poller.stderr.on('data', (d) => { pollerLog += d; });

const waitFor = async (fn, ms, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await fn()) return true; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for ${label}\npoller log:\n${pollerLog}`);
};

try {
  // Wait until the WS server is accepting connections.
  await waitFor(async () => {
    const { WebSocket } = await import('ws');
    const ws = new WebSocket('ws://localhost:8790');
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    ws.close();
    return true;
  }, 20000, 'WS server on 8790');

  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('file:///C:/Users/user/stream-overlay/hockey-overlay.html', { waitUntil: 'domcontentloaded' });

  // Wait for first payload to render.
  await waitFor(async () =>
    /\d+ matches/.test(await page.locator('#hb-state').textContent()), 30000, 'first payload');

  const liveCards = await page.locator('.match-card').count();
  const stateText = await page.locator('#hb-state').textContent();
  const upcomingRows = await page.locator('#upcoming-list .mini-row').count();
  const resultRows = await page.locator('#results-list .mini-row').count();

  console.log(`live cards: ${liveCards} | state: "${stateText}"`);
  console.log(`upcoming rows: ${upcomingRows} | result rows: ${resultRows}`);

  await page.screenshot({ path: 'hockey-overlay-check.png' });

  const ok = upcomingRows > 0 && resultRows > 0 && /\d+ matches/.test(stateText);
  console.log(ok ? 'E2E PASS' : 'E2E FAIL');
  await browser.close();
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  poller.kill();
}
