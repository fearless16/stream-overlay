import { WebSocketServer } from 'ws';
import { chromium } from 'playwright';

const PAYLOAD = {
  type: 'hockey',
  updatedAt: new Date().toISOString(),
  teamFilter: 'USA',
  total: 3,
  liveMatches: [{
    id: 'g1', tournament: 'Pro League', stage: 'Pool A', matchNo: 'Match 5',
    date: '2026-08-22', startTime: '19:00', venue: 'Bhubaneswar',
    state: 'L', live: true, finished: false, status: 'Live', period: 'Q2',
    home: { name: 'Netherlands', short: 'NED', score: 2 },
    away: { name: 'India', short: 'IND', score: 1 },
    clock: { minute: 21, seconds: 1265, plus: false, status: 'Q2' },
  }, {
    id: 'g2', tournament: 'Pro League', stage: '', matchNo: '',
    date: '2026-08-22', startTime: '21:30', venue: 'Berlin',
    state: 'L', live: true, finished: false, status: 'Live', period: '',
    home: { name: 'Germany', short: 'GER', score: 0 },
    away: { name: 'Spain', short: 'ESP', score: 0 },
  }, {
    id: 'g5', tournament: 'World Cup', stage: 'Pool H', matchNo: 'Match 9',
    date: '2026-08-22', startTime: '20:00', venue: 'Wavre',
    state: 'L', live: true, finished: false, status: 'Live', period: 'Q1',
    home: { name: 'United States', short: 'USA', score: 0 },
    away: { name: 'New Zealand', short: 'NZL', score: 1 },
  }],
  upcoming: [{
    id: 'g3', tournament: 'Pro League', date: '2026-08-23', startTime: '18:00',
    venue: 'Antwerp', state: '', live: false, finished: false, status: '',
    home: { name: 'Belgium', short: 'BEL', score: null },
    away: { name: 'India', short: 'IND', score: null },
  }],
  results: [{
    id: 'g4', tournament: 'Pro League', date: '2026-08-20', startTime: '19:00',
    venue: 'Bhubaneswar', state: 'R', live: false, finished: true, status: 'FT',
    home: { name: 'India', short: 'IND', score: 4 },
    away: { name: 'Japan', short: 'JPN', score: 0 },
  }],
};

const wss = new WebSocketServer({ port: 8791 });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify(PAYLOAD));
});

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 500, height: 700 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
let failures = [];
const expect = async (condFn, label) => {
  // Poll instead of single-shot: DOM/WS updates land asynchronously.
  const deadline = Date.now() + 10000;
  let last = null;
  while (Date.now() < deadline) {
    try { if (await condFn()) { console.log(`PASS: ${label}`); return; } }
    catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 250));
  }
  failures.push(label);
  console.log(`FAIL: ${label}${last ? ` (${last})` : ''}`);
};

// 1. No team param, but payload carries .env teamFilter -> auto-filter to USA.
await page.goto('file:///C:/Users/user/stream-overlay/hockey-overlay.html?ws=ws://localhost:8791', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.match-card', { timeout: 20000 });
await expect(async () => (await page.locator('.match-card.live').count()) === 1, 'env teamFilter auto-filters to one card');
await expect(async () => /team: usa/i.test(await page.locator('#hb-state').textContent()), 'header shows env filter');
await expect(async () => {
  const srcs = await page.locator('.flag img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('src')));
  return srcs.some((s) => /\/USA\.png$/.test(s)) && srcs.some((s) => /\/NZL\.png$/.test(s));
}, 'flag imgs from FIH CDN');

// 2. URL param overrides env teamFilter.
await page.goto('file:///C:/Users/user/stream-overlay/hockey-overlay.html?ws=ws://localhost:8791&team=germany', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await expect(async () => /Germany/.test(await page.locator('.tname').first().textContent() || ''), 'URL param overrides env filter');

// 3. Default (no team param, no env filter) — old behavior: both live cards.
PAYLOAD.teamFilter = null;
await page.goto('file:///C:/Users/user/stream-overlay/hockey-overlay.html?ws=ws://localhost:8791', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await expect(async () => (await page.locator('.match-card.live').count()) === 3, 'default shows all three live cards');
await expect(async () => /3 matches/.test(await page.locator('#hb-state').textContent()), 'default header shows match count');

// 2. Team filter — only Netherlands live card.
await page.goto('file:///C:/Users/user/stream-overlay/hockey-overlay.html?ws=ws://localhost:8791&team=netherlands', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await expect(async () => (await page.locator('.match-card.live').count()) === 1, 'team filter shows exactly one live card');
await expect(async () => /Netherlands/.test(await page.locator('.tname').first().textContent()), 'card belongs to filtered team');
await expect(async () => /team: netherlands/.test(await page.locator('#hb-state').textContent()), 'header shows team filter');

// 3. Short code filter, case-insensitive.
await page.goto('file:///C:/Users/user/stream-overlay/hockey-overlay.html?ws=ws://localhost:8791&team=ind', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await expect(async () => (await page.locator('.match-card.live').count()) === 1, 'short-code filter works');

// 4. Team with no live match -> next scheduled fallback.
await page.goto('file:///C:/Users/user/stream-overlay/hockey-overlay.html?ws=ws://localhost:8791&team=belgium', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
const body = await page.locator('#live-section').textContent();
await expect(async () => /next/i.test(body) && /18:00/.test(body), 'no-live team falls back to next fixture');

// 5. Unknown team -> clear message.
await page.goto('file:///C:/Users/user/stream-overlay/hockey-overlay.html?ws=ws://localhost:8791&team=atlantis', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await expect(async () => /nahi mila/i.test(await page.locator('#live-section').textContent()), 'unknown team message');

// Screenshots for eyeballing.
await page.goto('file:///C:/Users/user/stream-overlay/hockey-overlay.html?ws=ws://localhost:8791&team=netherlands', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await page.screenshot({ path: '_tmp-hockey-team-filter.png' });

await browser.close();
wss.close();
console.log(failures.length ? `SMOKE FAIL (${failures.length})` : 'SMOKE PASS');
process.exitCode = failures.length ? 1 : 0;
