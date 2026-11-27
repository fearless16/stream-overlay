'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');
const { WebSocket } = require('ws');
const { createPortraitFeed, COMMENT_MS } = require('../dual-format/feed.cjs');
const { buildCollection, scenes, micName, camName, overlayName } = require('../dual-format/setup.cjs');
const { identity, gate, framing, fullBleed } = require('../dual-format/ops.cjs');
const { cameraSample } = require('../dual-format/camera.cjs');
const { deflateSync } = require('node:zlib');

const local = '127.0.0.1';
const comment = (override = {}) => ({ type: 'portrait-comment', id: 'one', name: 'Viewer', text: 'Great last over', ...override });
async function service(t) {
  let now = 1_000_000;
  const feed = createPortraitFeed({ port: 0, now: () => now, onError: msg => assert.fail(msg) });
  t.after(() => feed.close());
  await once(feed.server, 'listening');
  return { feed, port: feed.server.address().port, tick: ms => { now += ms; } };
}
function connect(port) {
  const client = new WebSocket(`ws://127.0.0.1:${port}/feed`, { origin: `http://127.0.0.1:${port}` });
  return { client, next: () => once(client, 'message').then(([m]) => JSON.parse(m)) };
}

test('loopback WS is healthy with no score or chat, rehydrates a selected comment, and serves only portrait assets', async t => {
  const { feed, port } = await service(t);
  const health = () => fetch(`http://${local}:${port}/health`).then(r => r.json());
  assert.equal((await health()).status, 'waiting');
  const a = connect(port);
  assert.deepEqual(await a.next(), { type: 'portrait', now: 1_000_000, comment: null });
  a.client.send('rendered');
  assert.deepEqual(await health(), { status: 'healthy', browserAgeMs: 0, browsers: 1 });
  const packet = a.next();
  feed.ingest(local, comment());
  assert.equal((await packet).comment.text, 'Great last over');
  const b = connect(port);
  assert.equal((await b.next()).comment.id, 'one');
  assert.equal((await fetch(`http://${local}:${port}/.env`)).status, 404);
  assert.equal((await fetch(`http://${local}:${port}/portrait-overlay.html`)).status, 200);
});

test('only explicit local selections: 50,000 raw messages, six-hour clock, expiry, dismiss and retraction', async t => {
  const { feed, tick } = await service(t);
  for (let i = 0; i < 50_000; i++) feed.ingest(local, comment({ type: 'youtube-chat' }));
  for (const type of ['score', 'portrait-source', 'portrait-score', 'replay', 'show-comment']) feed.ingest(local, comment({ type }));
  feed.ingest('192.0.2.1', comment());
  feed.ingest(local, comment({ isHistory: true }));
  feed.ingest(local, comment({ id: '' }));
  assert.equal(feed.snapshot().comment, null);
  feed.ingest(local, comment({ name: '  Cricket\u202e Fan  ', text: '🏏'.repeat(160) }));
  assert.equal(feed.snapshot().comment.name, 'Cricket Fan');
  assert.equal(Array.from(feed.snapshot().comment.text).length, 96);
  tick(COMMENT_MS - 1);
  feed.ingest(local, comment());
  assert(feed.snapshot().comment);
  tick(1);
  assert.equal(feed.snapshot().comment, null);
  for (let i = 0; i < 3600; i++) {
    feed.ingest(local, comment());
    feed.ingest(local, comment({ id: 'two' }));
    feed.ingest(local, { type: 'portrait-hide-comment', id: 'one' });
    assert.equal(feed.snapshot().comment.id, 'two');
    feed.retract('two');
    assert.equal(feed.snapshot().comment, null);
    tick(6000);
  }
  feed.ingest(local, comment());
  feed.ingest(local, { type: 'portrait-hide-comment' });
  assert.equal(feed.snapshot().comment, null);
});

test('OBS setup has only one muted mic in Live, clean Virtual Camera, portrait bounds and silent slates', () => {
  const c = buildCollection({ sources: [{ name: 'Audio Input Capture', id: 'wasapi_input_capture', settings: { device_id: 'test microphone' } }] });
  const get = name => c.sources.find(item => item.name === name);
  assert.equal(c.current_program_scene, scenes[0]);
  assert.equal(get(micName).muted, true);
  assert.equal(get(micName).mixers, 1);
  assert.equal(get(camName).settings.video_device_id, 'OBS Virtual Camera:');
  assert.equal(get(overlayName).settings.height, 1280);
  for (const s of scenes.filter(s => s !== scenes[1])) assert.equal(get(s).settings.items.length, 1);
  assert.deepEqual(get(scenes[1]).settings.items[0].bounds, { x: 720, y: 1280 });
  assert.deepEqual(get(scenes[1]).settings.items[0].pos, { x: 0, y: 0 });
  assert.equal(get(scenes[1]).settings.items[0].bounds_crop, true);
});

test('portrait cover centers by default and pans without truncating the top or bottom', () => {
  const centered = framing(.5, 2560, 1440);
  assert(fullBleed(centered));
  assert.deepEqual([centered.cropLeft, centered.cropRight], [0, 0]);
  const panned = framing(.69, 2560, 1440);
  assert(fullBleed(panned));
  assert.deepEqual([panned.cropLeft, panned.cropRight, panned.cropTop, panned.cropBottom], [1361, 389, 0, 0]);
  assert.equal(framing(0, 2560, 1440).cropRight, 1750);
  assert.equal(framing(1, 2560, 1440).cropLeft, 1750);
  assert.throws(() => framing(.69, 0, 1440));
  assert(!fullBleed({ ...centered, boundsHeight: 560 }));
});

test('send gate fails closed on wrong profile, muted mic, missing render or wrong landscape scene', () => {
  const wide = { collection: 'Untitled', scene: 'Scene', cameraInScene: true, virtualCam: true, micInScene: true, micMuted: false };
  const tall = { profile: 'Cricket Portrait', collection: 'Cricket Portrait', scene: scenes[1], output: [720, 1280], canvas: [720, 1280],
    targetFps: 30, cameraInScene: true, cameraGeometry: [2560, 1440], picture: 'picture present', fullBleed: true, browserInScene: true, micInScene: true, micMuted: false };
  const browser = { status: 'healthy', browserAgeMs: 200 };
  assert(identity(tall));
  assert.deepEqual(gate(wide, tall, browser), []);
  assert.equal(gate({ ...wide, scene: 'Game Live' }, { ...tall, profile: 'wrong', micMuted: true }, null).length, 4);
  assert.match(gate(wide, { ...tall, picture: 'solid green frame' }, browser)[0], /green/);
});

test('thumbnail sampling rejects black and solid green without storing images', () => {
  function image(pixel) {
    const head = Buffer.alloc(33);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(head);
    head.writeUInt32BE(13, 8);
    head.write('IHDR', 12);
    head.writeUInt32BE(8, 16);
    head.writeUInt32BE(8, 20);
    head[24] = 8;
    head[25] = 6;
    const row = Buffer.from([0, ...Array.from({ length: 8 }, () => [...pixel, 255]).flat()]);
    const data = deflateSync(Buffer.concat(Array(8).fill(row)));
    const chunk = Buffer.alloc(data.length + 12);
    chunk.writeUInt32BE(data.length);
    chunk.write('IDAT', 4);
    data.copy(chunk, 8);
    return `data:image/png;base64,${Buffer.concat([head, chunk]).toString('base64')}`;
  }
  assert.equal(cameraSample(image([0, 150, 57])), 'solid green frame');
  assert.equal(cameraSample(image([0, 0, 0])), 'black/empty frame');
  assert.equal(cameraSample(image([80, 110, 100])), 'picture present');
  assert.equal(cameraSample('not an image'), 'unverified');
});
