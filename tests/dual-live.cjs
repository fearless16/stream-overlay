'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { gate } = require('../dual-format/ops.cjs');
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
    rejectOn: new Set(), onCall: () => {},
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
  ];
  for (const [label, r, pattern] of cases) {
    const { token } = r.controller.arm('go-live');
    const result = await r.controller.goLive(token);
    assert.equal(result.ok, false, label);
    assert.match(result.blockers.join('\n'), pattern, label);
    assert.deepEqual(r.events, [], label);
  }
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
