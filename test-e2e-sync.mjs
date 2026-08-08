// E2E sync test: real live-score-poller.js (child process) + real chat-overlay.html
// (Playwright) over a WS relay that mirrors yt-chat-server's forward logic.
//
// Fixture: _crex-live-current.html is served from a local HTTP server whose
// content can be flipped between coherent and torn states on demand. We prove:
//   1. A coherent snapshot renders on the overlay (score + players).
//   2. A torn snapshot (feed ahead of top-level score) is HELD server-side —
//      the overlay never renders the stale glued score.
//   3. Recovery to a new coherent snapshot flows through immediately.
//   4. A delivery advance WITHOUT player data is held too (player coherence),
//      so stale batter/bowler figures never glue onto a fresh score.

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(path.join(ROOT, '_crex-live-current.html'), 'utf8');

const WS_PORT = 8799;
const HTTP_PORT = 8901;
const POLL_MS = 400;

let pass = 0, fail = 0;
const t = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
};

// --- Fixture transforms (HTML uses &q; as escaped quote) ---
const Q = '&q;';
const SCORE_OLD = `${Q}score1${Q}:${Q}83-5${Q}`;
const SCORE_NEW = `${Q}score1${Q}:${Q}84-5${Q}`;
const FEED_OLD = `${Q}s${Q}:${Q}83/5${Q}`;
const FEED_NEW = `${Q}s${Q}:${Q}84/5${Q}`;

function stripPlayers(html) {
  const fields = [
    `${Q}player_full_name1${Q}:${Q}Marcus Stoinis${Q}`,
    `${Q}player_full_name2${Q}:${Q}David Miller${Q}`,
    `${Q}run1${Q}:${Q}50${Q}`,
    `${Q}ball1${Q}:${Q}(35)${Q}`,
    `${Q}run2${Q}:${Q}4${Q}`,
    `${Q}ball2${Q}:${Q}(5)${Q}`,
    `${Q}bname${Q}:${Q}L Ferguson${Q}`,
    `${Q}bowler_full_name${Q}:${Q}Lockie Ferguson${Q}`,
    `${Q}bwr${Q}:${Q}0-14${Q}`,
    `${Q}bover${Q}:${Q}2.2${Q}`,
  ];
  let out = html;
  for (const f of fields) out = out.split(f).join('');
  return out;
}

function advanceCoherent(html, delivery) {
  let out = html.split(SCORE_OLD).join(SCORE_NEW);
  out = out.split(FEED_OLD).join(FEED_NEW);
  if (delivery) out = out.split(`${Q}delivery${Q}:79`).join(`${Q}delivery${Q}:${delivery}`);
  return out;
}

let mode = 'coherent';
const serveContent = () => {
  switch (mode) {
    case 'torn-score': return FIXTURE.split(SCORE_OLD).join(`${Q}score1${Q}:${Q}81-5${Q}`);
    case 'advance-coherent': return advanceCoherent(FIXTURE, 80);
    case 'no-players': return stripPlayers(advanceCoherent(FIXTURE, 81));
    default: return FIXTURE;
  }
};

let httpServer = null, wss = null, poller = null, browser = null, page = null;
const pollerLog = [];
try {
  // --- 1. Fixture HTTP server ---
  httpServer = http.createServer((req, res) => {
    if (req.url.startsWith('/mode')) {
      const next = new URL(req.url, 'http://x').searchParams.get('set');
      mode = next || mode;
      res.end(`mode=${mode}`);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(serveContent());
  });
  await new Promise(r => httpServer.listen(HTTP_PORT, '127.0.0.1', r));
  console.log(`[fixture] http://127.0.0.1:${HTTP_PORT}/live (mode=${mode})`);

// --- 2. WS relay (mirrors yt-chat-server forward logic + score replay) ---
let lastScore = null;
let relayScoreCount = 0;
wss = new WebSocketServer({ port: WS_PORT });
wss.on('connection', ws => {
  if (lastScore) ws.send(lastScore);
  ws.on('message', raw => {
    try {
      const data = JSON.parse(raw.toString());
      if (['score', 'goals', 'show-comment', 'hide-comment', 'youtube-chat', 'replay', 'score-visible'].includes(data.type)) {
        if (data.type === 'score') { lastScore = raw.toString(); relayScoreCount++; }
        wss.clients.forEach(c => {
          if (c !== ws && c.readyState === c.OPEN) c.send(raw.toString());
        });
      }
    } catch (_) {}
  });
});

// --- 3. Real poller child process ---
poller = spawn(process.execPath, ['live-score-poller.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    SCORE_URLS: `http://127.0.0.1:${HTTP_PORT}/crex.com/live`,
    WS_URL: `ws://127.0.0.1:${WS_PORT}`,
    SCORE_POLL_INTERVAL: String(POLL_MS),
    POLL_INTERVAL: String(POLL_MS),
  },
});
poller.stdout.on('data', d => pollerLog.push(d.toString()));
poller.stderr.on('data', d => pollerLog.push(d.toString()));

// --- 4. Overlay via Playwright ---
browser = await chromium.launch({ headless: true });
page = await browser.newPage();
const pageConsole = [];
page.on('console', m => pageConsole.push(m.text()));
  await page.goto(`file:///${ROOT.replace(/\\/g, '/')}/chat-overlay.html?ws=ws://127.0.0.1:${WS_PORT}`);
  await page.waitForFunction(() => document.querySelector('.sc-t-score') !== null, null, { timeout: 15000 });
  console.log('[overlay] connected, scorecard rendered');

const overlay = {
  teamScore: () => page.evaluate(() => document.querySelector('.sc-t:first-child .sc-t-score')?.textContent.trim() || ''),
  batterCount: () => page.evaluate(() => document.querySelectorAll('.sc-bm').length),
  bowler: () => page.evaluate(() => document.querySelector('.sc-bowler-name')?.textContent.trim() || ''),
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitForScore = async (want, label, timeoutMs = 8000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await overlay.teamScore()).includes(want)) return true;
    await sleep(150);
  }
  return (await overlay.teamScore()).includes(want);
};
const holdWarnCount = () => pollerLog.join('').split('holding torn snapshot').length - 1;

  // ---- S1: coherent baseline flows through ----
  console.log('\nS1: coherent baseline');
  const s1 = await waitForScore('83/5', 'baseline 83/5');
  t('overlay shows 83/5 from coherent fixture', s1, `got "${await overlay.teamScore()}"`);
  const b1 = await overlay.batterCount();
  const bow1 = await overlay.bowler();
  t('both batters rendered', b1 === 2, `batters=${b1}`);
  t('bowler rendered', bow1.includes('Lockie Ferguson'), `bowler="${bow1}"`);

  // ---- S2: torn snapshot held server-side ----
  console.log('\nS2: torn score (feed 83/5 vs top-level 81-5)');
  const c2a = relayScoreCount;
  await fetch(`http://127.0.0.1:${HTTP_PORT}/mode?set=torn-score`);
  const holdsBefore = holdWarnCount();
  await sleep(POLL_MS * 4);
  const s2 = await overlay.teamScore();
  t('overlay unchanged (still 83/5, no stale 81-5)', s2 === '83/5', `got "${s2}"`);
  const b2 = await overlay.batterCount();
  t('batters still intact during hold', b2 === 2, `batters=${b2}`);
  t('no broadcast during torn window', relayScoreCount === c2a, `relay score msgs=${relayScoreCount}`);
  t('poller logged hold warning', holdWarnCount() > holdsBefore, `holds=${holdWarnCount()}`);

  // ---- S3: recovery to new coherent snapshot flows through ----
  console.log('\nS3: advance coherent (score+feed → 84/5)');
  const c3a = relayScoreCount;
  await fetch(`http://127.0.0.1:${HTTP_PORT}/mode?set=advance-coherent`);
  const s3 = await waitForScore('84/5', 'recover to 84/5');
  t('overlay updated to 84/5 after recovery', s3, `got "${await overlay.teamScore()}"`);
  t('exactly one new broadcast on recovery', relayScoreCount === c3a + 1, `relay score msgs=${relayScoreCount}`);

  // ---- S4: torn again → held at last good, no regression ----
  console.log('\nS4: torn score again (81-5)');
  const c4a = relayScoreCount;
  await fetch(`http://127.0.0.1:${HTTP_PORT}/mode?set=torn-score`);
  await sleep(POLL_MS * 4);
  const s4 = await overlay.teamScore();
  t('overlay still 84/5 (no regression)', s4 === '84/5', `got "${s4}"`);
  t('no broadcast during torn window', relayScoreCount === c4a, `relay score msgs=${relayScoreCount}`);

  // ---- S5: delivery advance without player data → player coherence hold ----
  console.log('\nS5: advance delivery, players stripped');
  const c5a = relayScoreCount;
  await fetch(`http://127.0.0.1:${HTTP_PORT}/mode?set=no-players`);
  await sleep(POLL_MS * 4);
  const s5 = await overlay.teamScore();
  const b5 = await overlay.batterCount();
  const bow5 = await overlay.bowler();
  t('score held at 84/5 (no fresh score glued to stale players)', s5 === '84/5', `got "${s5}"`);
  t('no broadcast while players missing on new delivery', relayScoreCount === c5a, `relay score msgs=${relayScoreCount}`);
  t('batters never dropped', b5 === 2, `batters=${b5}`);
  t('bowler never dropped', bow5.includes('Lockie Ferguson'), `bowler="${bow5}"`);

  // ---- S6: full coherent again → normal updates resume ----
  console.log('\nS6: back to coherent');
  const c6a = relayScoreCount;
  await fetch(`http://127.0.0.1:${HTTP_PORT}/mode?set=coherent`);
  const s6 = await waitForScore('83/5', 'back to 83/5');
  t('overlay back to 83/5 on coherent', s6, `got "${await overlay.teamScore()}"`);
  t('broadcast resumed after coherent', relayScoreCount > c6a, `relay score msgs=${relayScoreCount}`);
  const b6 = await overlay.batterCount();
  t('batters rendered again', b6 === 2, `batters=${b6}`);
} finally {
  const warnings = pollerLog.join('').split('\n').filter(l => /hold|torn/.test(l));
  if (warnings.length) console.log('\n[poller] hold warnings:\n' + warnings.map(w => '  ' + w).join('\n'));
  try { if (poller) poller.kill(); } catch (_) {}
  try { if (browser) await browser.close(); } catch (_) {}
  try { if (wss) wss.close(); } catch (_) {}
  try { if (httpServer) httpServer.close(); } catch (_) {}
}

console.log(`\n=== E2E sync: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
