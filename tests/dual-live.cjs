'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const { launch } = require('puppeteer');
const { Feed, gate } = require('../dual-format/ops.cjs');
const { createGoLive, ARM_MS } = require('../dual-format/go-live.cjs');
const { createControlServer } = require('../dual-format/control.cjs');

const KEY_BLOCKER = /two distinct nonempty YouTube RTMPS keys/;
const BROWSER_OK = { status: 'healthy', browserAgeMs: 300 };

// Fake clock: waits advance time instantly so timeouts are exercised without sleeping.
function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: ms => { t += ms; }, pause: async ms => { t += ms; } };
}

// Fake OBS feed. StartStream takes `startDelay` samples to start sending; `startState`
// sets the state it reports once sending; `neverSends` acknowledges but never sends.
function fakeFeed(label, state, events) {
  const feed = {
    label, state, startsIn: 0, startDelay: 1, startState: 'Healthy', neverSends: false,
    rejectOn: new Set(), timeoutOn: new Set(), onCall: () => {},
    async inspect() {
      if (feed.startsIn > 0 && --feed.startsIn === 0) {
        feed.state.sending = true;
        feed.state.state = feed.startState;
      }
      return { ...feed.state };
    },
    async call(request) {
      feed.onCall(request);
      events.push(`${label}:${request}`);
      if (feed.timeoutOn.has(request)) throw Object.assign(new Error('OBS request timed out'), { code: 'timeout' });
      if (feed.rejectOn.has(request)) throw Object.assign(new Error('rejected'), { code: 'rejected' });
      if (request === 'StartStream' && !feed.neverSends) feed.startsIn = feed.startDelay;
      if (request === 'StopStream') { feed.state.sending = false; feed.state.state = 'Idle'; }
      return {};
    },
    async disconnect() {},
  };
  return feed;
}

const wide = (over = {}) => ({
  state: 'Idle', sending: false, profile: 'Untitled', collection: 'Untitled', scene: 'Scene',
  cameraInScene: true, virtualCam: true, micInScene: true, micMuted: false, ...over,
});
const tall = (over = {}) => ({
  state: 'Idle', sending: false, profile: 'Cricket Portrait', collection: 'Cricket Portrait', scene: 'Portrait · Live',
  canvas: [720, 1280], output: [720, 1280], targetFps: 30, cameraInScene: true, cameraGeometry: [2560, 1440],
  picture: 'picture present', fullBleed: true, browserInScene: true, micInScene: true, micMuted: false, virtualCam: false,
  ...over,
});

function rig({ wideState = wide(), tallState = tall(), wideOpts = {}, tallOpts = {}, browser = BROWSER_OK, keys = true } = {}) {
  const events = [];
  const c = clock();
  const H = Object.assign(fakeFeed('horizontal', wideState, events), wideOpts);
  const V = Object.assign(fakeFeed('vertical', tallState, events), tallOpts);
  const logs = [];
  let browserState = browser;
  let n = 0;
  const controller = createGoLive({
    horizontal: H, vertical: V, browserHealth: async () => browserState,
    gate, keysOk: () => keys, now: c.now, pause: c.pause,
    newToken: () => `token-${++n}`, log: line => logs.push(line),
  });
  return { controller, H, V, c, events, logs, setBrowser: value => { browserState = value; } };
}

test('go-live needs a fresh arm, and each confirmation works once', async () => {
  const r = rig();
  await assert.rejects(r.controller.goLive('anything'), { status: 409 });
  const { token } = r.controller.arm('go-live');
  await assert.rejects(r.controller.goLive('wrong-token'), { status: 409 });
  assert.deepEqual(r.events, []);
  const result = await r.controller.goLive(token);
  assert.equal(result.ok, true, result.message);
  await assert.rejects(r.controller.goLive(token), { status: 409 });
});

test('an armed confirmation expires after 20 seconds', async () => {
  const r = rig();
  const { token, expiresInMs } = r.controller.arm('go-live');
  assert.equal(expiresInMs, ARM_MS);
  r.c.advance(ARM_MS);
  await assert.rejects(r.controller.goLive(token), { status: 409 });
  assert.deepEqual(r.events, []);
});

test('blockers refuse the whole sequence before any OBS command is sent', async () => {
  const cases = [
    ['portrait not on Live', rig({ tallState: tall({ scene: 'Portrait · Starting' }) }), /Portrait Live/],
    ['portrait mic muted', rig({ tallState: tall({ micMuted: true }) }), /Portrait Live/],
    ['horizontal off Scene', rig({ wideState: wide({ scene: 'Game' }) }), /Horizontal must be on Scene/],
    ['stale portrait heartbeat', rig({ browser: { status: 'waiting', browserAgeMs: 30_000 } }), /heartbeat/],
    ['keys not distinct', rig({ keys: false }), KEY_BLOCKER],
    ['portrait Virtual Camera on', rig({ tallState: tall({ virtualCam: true }) }), /Virtual Camera/],
  ];
  for (const [label, r, pattern] of cases) {
    const { token } = r.controller.arm('go-live');
    const result = await r.controller.goLive(token);
    assert.equal(result.ok, false, label);
    assert.match(result.blockers.join('\n'), pattern, label);
    assert.deepEqual(r.events, [], label);
  }
});

test('gate blocks portrait Virtual Camera and passes when it is off', () => {
  assert.deepEqual(gate(wide(), tall(), BROWSER_OK), []);
  assert.match(gate(wide(), tall({ virtualCam: true }), BROWSER_OK).join('\n'), /Virtual Camera/);
});

test('happy path: horizontal starts first, portrait starts only after horizontal is Healthy', async () => {
  const r = rig();
  const seenWhenPortraitStarted = [];
  r.V.onCall = request => { if (request === 'StartStream') seenWhenPortraitStarted.push({ sending: r.H.state.sending, state: r.H.state.state }); };
  const { token } = r.controller.arm('go-live');
  const result = await r.controller.goLive(token);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(r.events, ['horizontal:StartStream', 'vertical:StartStream']);
  assert.deepEqual(seenWhenPortraitStarted, [{ sending: true, state: 'Healthy' }]);
  assert.match(result.message, /manual/);
  assert(result.steps.includes('Horizontal sending and Healthy'));
});

test('a horizontal that is already live and Healthy is left alone; only portrait starts', async () => {
  const r = rig({ wideState: wide({ sending: true, state: 'Healthy' }) });
  const { token } = r.controller.arm('go-live');
  const result = await r.controller.goLive(token);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(r.events, ['vertical:StartStream']);
});

test('horizontal that never reports Healthy blocks portrait and is left running', async () => {
  const r = rig({ wideOpts: { startState: 'Warning' } });
  const { token } = r.controller.arm('go-live');
  const result = await r.controller.goLive(token);
  assert.equal(result.ok, false);
  assert.match(result.message, /did not report Healthy/);
  assert.deepEqual(r.events, ['horizontal:StartStream']);
  assert.equal(r.H.state.sending, true);
});

test('a rejected horizontal start blocks portrait; nothing is retried', async () => {
  const r = rig({ wideOpts: { rejectOn: new Set(['StartStream']) } });
  const { token } = r.controller.arm('go-live');
  const result = await r.controller.goLive(token);
  assert.equal(result.ok, false);
  assert.deepEqual(r.events, ['horizontal:StartStream']);
});

test('a rejected portrait start is reported once, never retried, and horizontal is not stopped', async () => {
  const r = rig({ tallOpts: { rejectOn: new Set(['StartStream']) } });
  const { token } = r.controller.arm('go-live');
  const result = await r.controller.goLive(token);
  assert.equal(result.ok, false);
  assert.match(result.message, /do not retry blindly/);
  assert.deepEqual(r.events, ['horizontal:StartStream', 'vertical:StartStream']);
  assert.equal(r.H.state.sending, true);
});

test('portrait that acknowledges but never sends leaves horizontal running and reports it', async () => {
  const r = rig({ tallOpts: { neverSends: true } });
  const { token } = r.controller.arm('go-live');
  const result = await r.controller.goLive(token);
  assert.equal(result.ok, false);
  assert.match(result.message, /did not report sending/);
  assert.deepEqual(r.events, ['horizontal:StartStream', 'vertical:StartStream']);
  assert.equal(r.H.state.sending, true);
});

test('an already-sending portrait is never started twice', async () => {
  const r = rig({ tallState: tall({ sending: true, state: 'Healthy' }) });
  const { token } = r.controller.arm('go-live');
  const result = await r.controller.goLive(token);
  assert.equal(result.ok, false);
  assert.match(result.message, /already sending/);
  assert.deepEqual(r.events, []);
});

test('a second action is refused while one is running', async () => {
  const r = rig({ wideOpts: { startState: 'Warning' } });
  const { token } = r.controller.arm('go-live');
  const running = r.controller.goLive(token);
  assert.throws(() => r.controller.arm('stop-portrait'), { status: 409 });
  const result = await running;
  assert.equal(result.ok, false);
  assert.equal(r.controller.arm('stop-portrait').action, 'stop-portrait');
});

test('stop-portrait stops only the portrait feed', async () => {
  const r = rig({ wideState: wide({ sending: true, state: 'Healthy' }), tallState: tall({ sending: true, state: 'Healthy' }) });
  const { token } = r.controller.arm('stop-portrait');
  const result = await r.controller.stop('portrait', token);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(r.events, ['vertical:StopStream']);
  assert.equal(r.H.state.sending, true);
});

test('stop-all stops portrait first, then horizontal', async () => {
  const r = rig({ wideState: wide({ sending: true, state: 'Healthy' }), tallState: tall({ sending: true, state: 'Healthy' }) });
  const { token } = r.controller.arm('stop-all');
  const result = await r.controller.stop('all', token);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(r.events, ['vertical:StopStream', 'horizontal:StopStream']);
});

test('a stop confirmation cannot be reused for a different scope', async () => {
  const r = rig({ tallState: tall({ sending: true, state: 'Healthy' }) });
  const { token } = r.controller.arm('stop-portrait');
  await assert.rejects(r.controller.stop('all', token), { status: 409 });
  assert.deepEqual(r.events, []);
});

test('a timed-out horizontal StartStream may or may not be running, and portrait is not started', async () => {
  const r = rig({ wideOpts: { timeoutOn: new Set(['StartStream']) } });
  const { token } = r.controller.arm('go-live');
  const result = await r.controller.goLive(token);
  assert.equal(result.ok, false);
  assert.match(result.message, /may or may not be running/);
  assert.deepEqual(r.events, ['horizontal:StartStream']);
});

test('a timed-out portrait StartStream may or may not be running, and horizontal is left running', async () => {
  const r = rig({ tallOpts: { timeoutOn: new Set(['StartStream']) } });
  const { token } = r.controller.arm('go-live');
  const result = await r.controller.goLive(token);
  assert.equal(result.ok, false);
  assert.match(result.message, /may or may not be running/);
  assert.deepEqual(r.events, ['horizontal:StartStream', 'vertical:StartStream']);
  assert.equal(r.H.state.sending, true);
});

test('a rejected horizontal StartStream still says it did not start', async () => {
  const r = rig({ wideOpts: { rejectOn: new Set(['StartStream']) } });
  const { token } = r.controller.arm('go-live');
  const result = await r.controller.goLive(token);
  assert.match(result.message, /Horizontal did not start/);
  assert.doesNotMatch(result.message, /may or may not/);
});

test('stop-portrait sends StopStream when the portrait state is unreadable', async () => {
  const r = rig();
  r.V.inspect = async () => ({ state: 'Recovering', reason: 'No stable authenticated sample' });
  const { token } = r.controller.arm('stop-portrait');
  await r.controller.stop('portrait', token);
  assert.deepEqual(r.events, ['vertical:StopStream']);
});

test('an unreadable portrait state is never reported as idle or stopped', async () => {
  const r = rig({ tallOpts: { rejectOn: new Set(['StopStream']) } });
  r.V.inspect = async () => ({ state: 'Recovering' });
  const { token } = r.controller.arm('stop-portrait');
  const result = await r.controller.stop('portrait', token);
  assert.equal(result.ok, false);
  assert.match(result.message, /could not be confirmed/);
  assert.doesNotMatch(result.message, /Nothing was sending/);
});

test('StopStream acknowledged, then an unreadable sample, is not reported as stopped', async () => {
  const r = rig({ tallState: tall({ sending: true, state: 'Healthy' }) });
  let acknowledged = false;
  r.V.call = async request => { r.events.push(`vertical:${request}`); if (request === 'StopStream') acknowledged = true; return {}; };
  r.V.inspect = async () => (acknowledged ? { state: 'Recovering' } : { state: 'Healthy', sending: true });
  const { token } = r.controller.arm('stop-portrait');
  const result = await r.controller.stop('portrait', token);
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.message, /^Stopped/);
});

test('status offers stop while a feed state is unreadable, and not when both feeds are explicitly idle', async () => {
  const unreadable = rig();
  unreadable.V.inspect = async () => ({ state: 'Recovering' });
  const offered = await unreadable.controller.status();
  assert.equal(offered.controls.stopPortrait, true);
  assert.equal(offered.controls.stopAll, true);
  const idle = await rig().controller.status();
  assert.equal(idle.controls.stopPortrait, false);
  assert.equal(idle.controls.stopAll, false);
});

test('stop when nothing is sending changes nothing', async () => {
  const r = rig();
  const { token } = r.controller.arm('stop-all');
  const result = await r.controller.stop('all', token);
  assert.equal(result.ok, true);
  assert.match(result.message, /Nothing was sending/);
  assert.deepEqual(r.events, []);
});

test('status reports blockers and the last result without secrets', async () => {
  const r = rig({ tallState: tall({ scene: 'Portrait · Starting' }) });
  const before = await r.controller.status();
  assert.equal(before.last, null);
  assert.match(before.blockers.join('\n'), /Portrait Live/);
  assert.equal(before.browser, 'healthy');
  assert.equal(JSON.stringify(before).includes('password'), false);
  const { token } = r.controller.arm('go-live');
  await r.controller.goLive(token);
  const after = await r.controller.status();
  assert.equal(after.last.action, 'go-live');
  assert.equal(after.last.ok, false);
  assert.equal(after.armed, null);
});

// ---- Feed sampling ------------------------------------------------------
// A real Feed with a stubbed OBS client. Feed.connect is replaced so no socket opens; each
// connect() call is counted, and the stream object is read on every sample.

const idleStream = () => ({ outputActive: false, outputReconnecting: false, outputBytes: 0, outputTotalFrames: 0, outputSkippedFrames: 0 });

function stubbedFeed(label, stream = idleStream()) {
  const feed = new Feed(label, '', label === 'vertical' ? 4456 : 4455);
  feed.calls = { connect: 0, requests: [] };
  feed.stream = stream;
  const responses = {
    GetVersion: { obsVersion: '33.0.2' },
    GetVideoSettings: { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fpsNumerator: 30, fpsDenominator: 1 },
    GetStats: { activeFps: 30, cpuUsage: 10, memoryUsage: 500, outputSkippedFrames: 0, renderSkippedFrames: 0 },
    GetStreamStatus: () => ({ ...feed.stream }),
    GetRecordStatus: { outputActive: false },
    GetVirtualCamStatus: { outputActive: false },
    GetProfileList: { currentProfileName: 'Untitled' },
    GetSceneCollectionList: { currentSceneCollectionName: 'Untitled' },
    GetSceneList: { currentProgramSceneName: 'Scene' },
    GetInputList: { inputs: [] },
    GetSceneItemList: { sceneItems: [] },
  };
  feed.connect = async function connect() {
    feed.calls.connect += 1;
    this.obs = {
      async call(request) {
        feed.calls.requests.push(request);
        await new Promise(resolve => setTimeout(resolve, 5));
        const value = responses[request];
        return typeof value === 'function' ? value() : value;
      },
      async disconnect() {},
    };
  };
  return feed;
}

test('concurrent inspect() calls share one sample: one connect and one set of OBS requests', async () => {
  const feed = stubbedFeed('horizontal');
  const [a, b] = await Promise.all([feed.inspect(), feed.inspect()]);
  assert.equal(feed.calls.connect, 1);
  assert.equal(feed.calls.requests.filter(r => r === 'GetVersion').length, 1);
  assert.strictEqual(a, b);
});

test('sequential inspect() calls each take a fresh sample', async () => {
  const feed = stubbedFeed('horizontal');
  await feed.inspect();
  await feed.inspect();
  assert.equal(feed.calls.requests.filter(r => r === 'GetVersion').length, 2);
});

test('the first sample after StartStream with no bytes yet is not Healthy', async () => {
  const feed = stubbedFeed('horizontal');
  await feed.inspect();
  Object.assign(feed.stream, { outputActive: true });          // StartStream acknowledged, nothing sent yet
  const first = await feed.inspect();
  assert.notEqual(first.state, 'Healthy');
  assert.equal(first.reason, 'Throughput not measured yet');
});

test('Healthy needs measured throughput: a second sample with bytes flowing', async () => {
  const feed = stubbedFeed('horizontal');
  await feed.inspect();
  Object.assign(feed.stream, { outputActive: true, outputBytes: 0 });
  await feed.inspect();
  await new Promise(resolve => setTimeout(resolve, 20));
  Object.assign(feed.stream, { outputBytes: 60_000, outputTotalFrames: 60 });
  const second = await feed.inspect();
  assert.equal(second.state, 'Healthy');
  assert.ok(second.kbps > 0);
});

test('a new stream session starts its drop and frame counters from zero', async () => {
  const feed = stubbedFeed('horizontal');
  Object.assign(feed.stream, { outputActive: false, outputTotalFrames: 1000, outputSkippedFrames: 500 }); // previous session
  await feed.inspect();
  Object.assign(feed.stream, { outputActive: true, outputBytes: 0, outputTotalFrames: 300, outputSkippedFrames: 3 });
  const sample = await feed.inspect();
  assert.equal(sample.recentDropPct, 1);                       // 3 dropped of 300 frames
  assert.equal(sample.state, 'Warning');
});

// ---- HTTP surface -------------------------------------------------------

async function serve(t, options) {
  const r = rig(options);
  const svc = createControlServer({ controller: r.controller, port: 0 });
  const port = await svc.listen();
  t.after(() => svc.close());
  return { ...r, port, base: `http://127.0.0.1:${port}` };
}

function raw(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const control = { 'content-type': 'application/json', 'x-dual-control': '1' };

test('the control page is served with no-store and a strict CSP', async t => {
  const { port } = await serve(t);
  const res = await raw(port, { path: '/' });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.match(res.headers['content-security-policy'], /^default-src 'none'/);
  assert.match(res.text, /Dual stream · Go live/);
});

test('mutating requests need the control header, a same-origin Origin and JSON', async t => {
  const { port } = await serve(t);
  const body = JSON.stringify({ action: 'go-live' });
  assert.equal((await raw(port, { method: 'POST', path: '/api/arm', headers: { 'content-type': 'application/json' }, body })).status, 403);
  assert.equal((await raw(port, { method: 'POST', path: '/api/arm', headers: { ...control, origin: 'http://evil.example' }, body })).status, 403);
  assert.equal((await raw(port, { method: 'POST', path: '/api/arm', headers: { 'x-dual-control': '1', 'content-type': 'text/plain' }, body })).status, 415);
  const ok = await raw(port, { method: 'POST', path: '/api/arm', headers: { ...control, origin: `http://127.0.0.1:${port}` }, body });
  assert.equal(ok.status, 200);
  assert.match(ok.text, /"token":"token-1"/);
});

test('DNS-rebinding host names are refused on every route', async t => {
  const { port } = await serve(t);
  const res = await raw(port, { path: '/api/status', headers: { host: `evil.example:${port}` } });
  assert.equal(res.status, 403);
  assert.doesNotMatch(res.text, /horizontal/);
});

test('oversized bodies and unknown routes are refused', async t => {
  const { port } = await serve(t);
  const big = JSON.stringify({ action: 'go-live', padding: 'x'.repeat(2000) });
  const res = await raw(port, { method: 'POST', path: '/api/arm', headers: control, body: big });
  assert.equal(res.status, 413);
  assert.equal((await raw(port, { path: '/nope' })).status, 404);
});

test('bodies that are not a JSON object get 400, never a server error', async t => {
  const { port } = await serve(t);
  for (const body of ['null', '[]', '"go-live"', '5', '{bad json']) {
    const res = await raw(port, { method: 'POST', path: '/api/arm', headers: control, body });
    assert.equal(res.status, 400, `body ${body}`);
  }
});

test('arm and go-live work end to end over HTTP and report the sequence', async t => {
  const { port, base, events } = await serve(t);
  const origin = { origin: `http://127.0.0.1:${port}` };
  const armed = await fetch(`${base}/api/arm`, { method: 'POST', headers: { ...control, ...origin }, body: JSON.stringify({ action: 'go-live' }) }).then(r => r.json());
  assert.equal(armed.action, 'go-live');
  const done = await fetch(`${base}/api/go-live`, { method: 'POST', headers: { ...control, ...origin }, body: JSON.stringify({ token: armed.token }) });
  const result = await done.json();
  assert.equal(done.status, 200);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(events, ['horizontal:StartStream', 'vertical:StartStream']);
  const status = await fetch(`${base}/api/status`).then(r => r.json());
  assert.equal(status.last.ok, true);
  assert.equal(status.horizontal.sending, true);
  assert.equal(status.vertical.sending, true);
});

// ---- Operator page in a real browser --------------------------------------

async function openControlPage(t, controller) {
  const executablePath = process.env.CHROME_PATH || (process.platform === 'win32'
    ? path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe') : undefined);
  if (executablePath && !fs.existsSync(executablePath)) return null;
  const service = createControlServer({ controller, port: 0, log: () => {} });
  const port = await service.listen();
  const browser = await launch({ executablePath, headless: true, args: ['--no-first-run'] });
  t.after(async () => { await browser.close(); await service.close(); });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('v-state').textContent !== '…', { timeout: 5000 });
  page.controlService = service;                              // lets a test take the server down
  return page;
}

test('page stop buttons follow the server: offered while a state is unreadable, off when both feeds are idle', { timeout: 40_000 }, async t => {
  const unreadable = rig();
  unreadable.V.inspect = async () => ({ state: 'Recovering' });
  const offered = await openControlPage(t, unreadable.controller);
  if (!offered) return t.skip('Set CHROME_PATH to run the browser coverage');
  await offered.waitForFunction(() => document.getElementById('v-state').textContent === 'Recovering', { timeout: 5000 });
  assert.equal(await offered.$eval('#arm-stop-portrait', b => b.disabled), false);
  assert.equal(await offered.$eval('#arm-stop-all', b => b.disabled), false);

  const idle = await openControlPage(t, rig().controller);
  await idle.waitForFunction(() => document.getElementById('v-state').textContent === 'Idle', { timeout: 5000 });
  assert.equal(await idle.$eval('#arm-stop-portrait', b => b.disabled), true);
  assert.equal(await idle.$eval('#arm-stop-all', b => b.disabled), true);
});

test('page keeps a refused arm message visible past the next status poll', { timeout: 40_000 }, async t => {
  const r = rig();
  const controller = { ...r.controller, arm: () => { throw Object.assign(new Error('Another action is running: go-live'), { status: 409 }); } };
  const page = await openControlPage(t, controller);
  if (!page) return t.skip('Set CHROME_PATH to run the browser coverage');
  await page.click('#arm-live');
  await new Promise(resolve => setTimeout(resolve, 2500));   // longer than the 2 s status poll
  assert.match(await page.$eval('#error', el => el.textContent), /Another action is running/);
});

test('page keeps a refused confirmation message visible after the confirm request returns', { timeout: 40_000 }, async t => {
  const r = rig();
  const page = await openControlPage(t, r.controller);
  if (!page) return t.skip('Set CHROME_PATH to run the browser coverage');
  await page.click('#arm-live');
  await page.waitForFunction(() => !document.getElementById('confirm-row').hidden, { timeout: 5000 });
  r.c.advance(ARM_MS + 1);                                   // the armed confirmation has expired on the server
  await page.click('#confirm');
  await new Promise(resolve => setTimeout(resolve, 2500));
  assert.match(await page.$eval('#error', el => el.textContent), /Arm this action first/);
});

test('page reports an unreachable control server on its connection line', { timeout: 40_000 }, async t => {
  const page = await openControlPage(t, rig().controller);
  if (!page) return t.skip('Set CHROME_PATH to run the browser coverage');
  await page.controlService.close();
  await new Promise(resolve => setTimeout(resolve, 2500));
  assert.match(await page.$eval('#conn', el => el.textContent), /Control server unreachable/);
});
