'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const { launch } = require('puppeteer');
const { WebSocketServer } = require('ws');
const { createPortraitFeed, COMMENT_MS } = require('../dual-format/feed.cjs');

test('phone layout, real Show/Escape controls, expiry, refresh, browser crash and bridge restart', { timeout: 40_000 }, async t => {
  const executablePath = process.env.CHROME_PATH || (process.platform === 'win32'
    ? path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe') : undefined);
  if (executablePath && !fs.existsSync(executablePath)) return t.skip('Set CHROME_PATH to run Chromium coverage');
  const browser = await launch({ executablePath, headless: true, args: ['--no-first-run'] });
  t.after(() => browser.close());
  let server;
  let now = Date.now();
  const start = async port => {
    server = createPortraitFeed({ port, now: () => now });
    await once(server.server, 'listening');
    return server.server.address().port;
  };
  t.after(() => server?.close());
  const port = await start(0);
  const host = `http://127.0.0.1:${port}`;
  const errors = [];
  async function phone() {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    await page.setViewport({ width: 360, height: 640 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(`${host}/portrait-overlay.html`, { waitUntil: 'load' });
    return page;
  }
  const blank = page => page.waitForFunction(() => document.getElementById('comment').hidden);
  const shown = page => page.waitForSelector('#comment:not([hidden])');
  let page = await phone();
  await blank(page);
  assert.equal(await page.$('#board, .camera-frame, .matte, footer'), null);
  assert.deepEqual(await page.evaluate(() => [document.body, document.getElementById('canvas')].map(el => getComputedStyle(el).backgroundColor)),
    ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);

  const controls = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  t.after(() => {
    for (const peer of controls.clients) peer.terminate();
    return new Promise(resolve => controls.close(resolve));
  });
  await once(controls, 'listening');
  const connected = once(controls, 'connection');
  const operator = await browser.newPage();
  await operator.setRequestInterception(true);
  operator.on('request', req => /^https:/.test(req.url()) ? req.abort() : req.continue());
  const operatorUrl = pathToFileURL(path.resolve(__dirname, '../chat-overlay.html'));
  operatorUrl.searchParams.set('ws', `ws://127.0.0.1:${controls.address().port}`);
  await operator.goto(operatorUrl.href, { waitUntil: 'load' });
  const [peer] = await connected;
  peer.on('message', raw => server.ingest('127.0.0.1', JSON.parse(raw)));
  const sourceText = '<b>Safe text</b> क्या ज़बरदस्त ओवर था! 🏏';
  peer.send(JSON.stringify({ type: 'youtube-chat', id: 'one', name: 'प्रशंसक', text: sourceText }));
  const row = '[data-yt-id="one"]';
  await operator.waitForSelector(row);
  assert.equal(server.snapshot().comment, null);
  const show = () => operator.$eval(`${row} .msg-action-btn.show`, button => button.click());
  await show();
  await page.bringToFront();
  await shown(page);
  const layout = await page.evaluate(() => {
    const text = document.getElementById('comment-text');
    return { bounds: text.getBoundingClientRect().toJSON(), font: getComputedStyle(text).fontSize, text: text.textContent };
  });
  assert(layout.bounds.left >= 24 && layout.bounds.right <= 288 && layout.bounds.bottom <= 471);
  assert(layout.bounds.top >= 390 && parseFloat(layout.font) >= 38 && layout.text === sourceText);
  assert.equal(await page.$('#comment-text b'), null);
  await page.reload();
  await shown(page);
  assert.notEqual((await fetch(`${host}/health`).then(r => r.json())).browserAgeMs, null);
  await operator.keyboard.press('Escape');
  await blank(page);
  await show();
  await shown(page);
  now += COMMENT_MS;
  await page.waitForFunction(() => document.getElementById('comment').hidden, { timeout: 8000 });
  await show();
  await shown(page);
  await server.close();
  await blank(page);
  await start(port);
  // A fresh payload after a server crash proves the page actually reconnected.
  await show();
  await shown(page);
  const cdp = await page.createCDPSession();
  await Promise.race([cdp.send('Page.crash').catch(() => {}), once(page, 'error')]);
  await page.close().catch(() => {});
  page = await phone();
  await shown(page);
  server.retract('one');
  await blank(page);
  assert.deepEqual(errors, []);
});
