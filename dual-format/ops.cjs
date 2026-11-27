'use strict';

const path = require('node:path');
const OBSWebSocket = require('obs-websocket-js').default;
const { mainRoot, root, name, scenes, micName, camName, overlayName, canvas, wsPath, read } = require('./setup.cjs');
const { cameraSample } = require('./camera.cjs');

const live = scenes[1];
const technical = scenes[4];
const outer = 'OBS_BOUNDS_SCALE_OUTER';
const fullBleed = t => t?.boundsType === outer && t.cropToBounds &&
  t.boundsWidth === canvas.width && t.boundsHeight === canvas.height &&
  t.positionX === 0 && t.positionY === 0 && t.rotation === 0 && t.alignment === 5;

function framing(center, width, height) {
  if (!Number.isFinite(center) || center < 0 || center > 1 ||
      !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Expected a center between 0 and 1 and valid Virtual Camera dimensions');
  }
  // Default to OBS's resolution-independent centered cover; only use pixel crop for an off-center shot.
  const visible = Math.min(width, Math.round(height * canvas.width / canvas.height));
  const left = Math.min(width - visible, Math.max(0, Math.round(width * center - visible / 2)));
  return {
    positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, alignment: 5, rotation: 0,
    boundsType: outer, boundsAlignment: 0, boundsWidth: canvas.width, boundsHeight: canvas.height, cropToBounds: true,
    cropLeft: center === .5 ? 0 : left, cropRight: center === .5 ? 0 : width - visible - left, cropTop: 0, cropBottom: 0,
  };
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(action, ms = 3500) {
  let timer;
  try { return await Promise.race([action, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('OBS request timed out'), { code: 'timeout' })), ms);
  })]); }
  finally { clearTimeout(timer); }
}

class Feed {
  constructor(label, base, port) {
    Object.assign(this, { label, base, port, obs: null, retryAt: 0, failures: 0, last: null, changed: false });
  }
  async disconnect() {
    const obs = this.obs;
    this.obs = null;
    this.picture = null;
    if (obs) await bounded(obs.disconnect(), 800).catch(() => {});
  }
  async connect() {
    if (this.obs) return;
    const config = read(wsPath(this.base));
    if (!config.auth_required || !config.server_password || config.server_port !== this.port) {
      throw new Error('Expected authenticated WebSocket on a distinct configured port');
    }
    const obs = new OBSWebSocket();
    this.obs = obs;
    obs.once('ConnectionClosed', () => { if (this.obs === obs) this.obs = null; });
    for (const event of ['CurrentProgramSceneChanged', 'CurrentSceneCollectionChanged', 'CurrentProfileChanged',
      'StreamStateChanged', 'RecordStateChanged', 'InputMuteStateChanged', 'SceneItemEnableStateChanged',
      'InputRemoved', 'SceneItemRemoved', 'VirtualcamStateChanged']) obs.on(event, () => { this.changed = true; });
    await bounded(obs.connect(`ws://127.0.0.1:${this.port}`, config.server_password, { rpcVersion: 1 }));
  }
  call(request, data) { return bounded(this.obs.call(request, data)); }
  async inspect() {
    if (Date.now() < this.retryAt) return this.last;
    const before = this.last;
    try {
      await this.connect();
      this.changed = false;
      const portrait = this.label === 'vertical';
      const microphone = portrait ? micName : 'Audio Input Capture';
      const camera = portrait ? camName : 'Camera';
      const [version, video, stats, stream, record, virtual, profile, collection, scene, inputs] = await Promise.all([
        this.call('GetVersion'), this.call('GetVideoSettings'), this.call('GetStats'), this.call('GetStreamStatus'),
        this.call('GetRecordStatus'), this.call('GetVirtualCamStatus'), this.call('GetProfileList'), this.call('GetSceneCollectionList'),
        this.call('GetSceneList'), this.call('GetInputList'),
      ]);
      const input = inputName => inputs.inputs.find(item => item.inputName === inputName);
      const at = Date.now();
      const [items, mute, volume] = await Promise.all([
        this.call('GetSceneItemList', { sceneName: scene.currentProgramSceneName }),
        input(microphone) ? this.call('GetInputMute', { inputName: microphone }) : null,
        input(microphone) ? this.call('GetInputVolume', { inputName: microphone }) : null,
      ]);
      if (this.changed) throw Object.assign(new Error('OBS state changed during sample'), { code: 'unstable' });
      const find = source => items.sceneItems.find(item => item.sourceName === source && item.sceneItemEnabled);
      const cam = find(camera);
      if (portrait && cam && (!this.picture || at - this.picture.at >= 5000)) {
        const sample = await this.call('GetSourceScreenshot', { sourceName: camera, imageFormat: 'png', imageWidth: 64 });
        this.picture = { at, state: cameraSample(sample.imageData) };
      } else if (portrait && !cam) this.picture = null;
      if (this.changed) throw Object.assign(new Error('OBS state changed during sample'), { code: 'unstable' });
      const total = Math.max(0, stream.outputTotalFrames - (before?.frames ?? stream.outputTotalFrames));
      const drops = Math.max(0, stream.outputSkippedFrames - (before?.drops ?? stream.outputSkippedFrames));
      const bytes = stream.outputBytes;
      const kbps = before?.sending && stream.outputActive && before.bytes <= bytes && at > before.at
        ? Math.round((bytes - before.bytes) * 8 / (at - before.at)) : null;
      const frameSkips = stats.outputSkippedFrames > (before?.encoderSkipped ?? stats.outputSkippedFrames) ||
        stats.renderSkippedFrames > (before?.renderSkipped ?? stats.renderSkippedFrames);
      const state = stream.outputReconnecting ? 'Recovering' : drops > 0 || frameSkips || (stream.outputActive && kbps === 0) ? 'Warning'
        : stream.outputActive ? 'Healthy' : 'Idle';
      this.failures = 0;
      this.retryAt = 0;
      return this.last = { state, at, version: version.obsVersion, profile: profile.currentProfileName,
        collection: collection.currentSceneCollectionName, scene: scene.currentProgramSceneName,
        canvas: [video.baseWidth, video.baseHeight], output: [video.outputWidth, video.outputHeight],
        targetFps: video.fpsNumerator / video.fpsDenominator, fps: Math.round(stats.activeFps * 10) / 10,
        cpu: stats.cpuUsage, ramMiB: Math.round(stats.memoryUsage), sending: stream.outputActive, recording: record.outputActive,
        virtualCam: virtual.outputActive, bytes, kbps, frames: stream.outputTotalFrames, drops: stream.outputSkippedFrames,
        recentDropPct: total ? Number((100 * drops / total).toFixed(2)) : null, renderSkipped: stats.renderSkippedFrames,
        encoderSkipped: stats.outputSkippedFrames, cameraInScene: !!cam && !!input(camera),
        cameraGeometry: cam && [cam.sceneItemTransform.sourceWidth, cam.sceneItemTransform.sourceHeight], picture: this.picture?.state,
        ...(portrait && { fullBleed: !!fullBleed(cam?.sceneItemTransform) }),
        browserInScene: !!find(portrait ? overlayName : 'Cricket Overlay'), micInScene: !!find(microphone),
        micMuted: mute?.inputMuted ?? null, micVolumeDb: volume?.inputVolumeDb ?? null };
    } catch (err) {
      if (err.code === 'unstable') {
        this.retryAt = 0;
        return this.last = { state: 'Recovering', reason: 'OBS scene or input just changed' };
      }
      await this.disconnect();
      this.retryAt = Date.now() + Math.min(24_000, 750 * 2 ** Math.min(this.failures++, 6)) + Math.random() * 500;
      return this.last = { state: before ? 'Recovering' : 'Offline', reason: 'No stable authenticated sample', lastGoodAt: before?.at ?? before?.lastGoodAt };
    }
  }
}

async function browserHealth() {
  try {
    const res = await fetch('http://127.0.0.1:8767/health', { signal: AbortSignal.timeout(1100) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
const identity = vertical => vertical?.profile === name && vertical.collection === name &&
  vertical.canvas?.join('x') === '720x1280' && vertical.output?.join('x') === '720x1280' && vertical.targetFps === 30;
function gate(horizontal, vertical, browser) {
  const issues = [];
  if (!identity(vertical)) issues.push('Wrong or unavailable portrait profile, collection or 720×1280/30 video');
  if (horizontal?.collection !== 'Untitled' || horizontal.scene !== 'Scene' || !horizontal.cameraInScene ||
      !horizontal.virtualCam || horizontal.micMuted !== false || !horizontal.micInScene) {
    issues.push('Horizontal must be on Scene with its camera-only Virtual Camera running and commentary mic unmuted');
  }
  if (vertical?.scene !== live || !vertical.cameraInScene || !vertical.cameraGeometry?.every(n => n > 0) ||
      !vertical.browserInScene || !vertical.micInScene || vertical.micMuted !== false) {
    issues.push('Portrait Live needs its camera, graphics and explicitly unmuted commentary mic');
  }
  if (vertical?.scene === live && vertical.picture !== 'picture present') issues.push(`Portrait camera: ${vertical.picture || 'unverified'}`);
  if (vertical?.scene === live && !vertical.fullBleed) issues.push('Portrait Live camera does not cover the full canvas');
  if (!browser || browser.browserAgeMs == null || browser.browserAgeMs > 12_000 || browser.status !== 'healthy') {
    issues.push('Portrait chat overlay heartbeat is missing or stale');
  }
  return issues;
}

function distinctYouTubeKeys() {
  function get(base, profileDir) {
    const info = read(path.join(base, 'basic', 'profiles', profileDir, 'service.json')).settings;
    try {
      const endpoint = new URL(info.server);
      if (endpoint.protocol === 'rtmps:' && /^(?:a|b)\.rtmps\.youtube\.com$/i.test(endpoint.hostname) &&
          endpoint.pathname.replace(/\/$/, '') === '/live2' && !endpoint.username && !endpoint.password && !endpoint.search) {
        return typeof info.key === 'string' ? info.key.trim() : '';
      }
    } catch { /* malformed or blank server */ }
    return '';
  }
  try {
    const a = get(mainRoot, 'Untitled');
    const b = get(root, 'Cricket_Portrait');
    return !!a && !!b && a !== b;
  } catch { return false; }
}

async function frame(vertical, value) {
  if (value !== undefined && !/^(?:0(?:\.\d+)?|1(?:\.0+)?|\.\d+)$/.test(value)) throw new Error('Usage: npm run portrait -- frame [center from 0 to 1]');
  const state = await vertical.inspect();
  if (!identity(state) || state.sending || state.recording || state.virtualCam || state.scene !== live || !state.cameraInScene) {
    throw new Error('Open Portrait · Live with a working Virtual Camera and keep portrait streaming/recording off before reframing');
  }
  const { sceneItemId } = await vertical.call('GetSceneItemId', { sceneName: live, sourceName: camName });
  const center = value === undefined ? .5 : Number(value);
  const sceneItemTransform = framing(center, ...state.cameraGeometry);
  if (vertical.changed) throw new Error('Portrait OBS changed during framing; retry once idle');
  await vertical.call('SetSceneItemTransform', { sceneName: live, sceneItemId, sceneItemTransform });
  const { sceneItemTransform: applied } = await vertical.call('GetSceneItemTransform', { sceneName: live, sceneItemId });
  if (!fullBleed(applied) || applied.cropLeft !== sceneItemTransform.cropLeft || applied.cropRight !== sceneItemTransform.cropRight) {
    throw new Error('OBS did not confirm the requested full-screen framing');
  }
  console.log(`Portrait camera fills ${canvas.width}×${canvas.height}; crop center ${center}. Check face/headroom in the preview.`);
}

async function run(mode, ack) {
  const horizontal = new Feed('horizontal', mainRoot, 4455);
  const vertical = new Feed('vertical', root, 4456);
  let stopped = false;
  const stop = () => { stopped = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    if (mode === 'frame') return await frame(vertical, ack);
    if (!['status', 'watch', 'guard', 'send-vertical'].includes(mode)) throw new Error('Usage: node dual-format/ops.cjs status|watch|guard|frame|send-vertical');
    if (mode === 'send-vertical' && ack !== '--studio-ready') {
      throw new Error('Confirm an unlisted same-event Encoder rehearsal with Auto-start/stop off, both distinct keys, checked framing/audio, then pass --studio-ready');
    }
    let previous = '';
    let unsafe = 0;
    let lastSafetyAttempt = 0;
    let lastRefresh = 0;
    let browserMissingAt = 0;
    do {
      const [wide, tall, browser] = await Promise.all([horizontal.inspect(), vertical.inspect(), browserHealth()]);
      const issues = gate(wide, tall, browser);
      if (mode === 'send-vertical') {
        if (!wide.sending || wide.state !== 'Healthy') issues.push('Start the horizontal Studio test ingest manually and verify its preview first');
        if (tall.sending || tall.virtualCam) issues.push('Portrait is already sending or is incorrectly broadcasting Virtual Camera');
        if (!distinctYouTubeKeys()) issues.push('Profile files do not show two distinct nonempty YouTube RTMPS keys (save Settings in OBS)');
        if (issues.length) throw new Error(issues.join('\n'));
        try { await vertical.call('StartStream'); }
        catch { throw new Error('Start acknowledgment failed. Check portable OBS and Studio; do not retry blindly.'); }
        console.log('Portrait OBS accepted StartStream. Verify Studio ingest; this is not confirmation that YouTube is live.');
      } else if (mode === 'guard' && identity(tall) && tall.sending && tall.scene === live) {
        // A brief unsettled RPC sample is not grounds to cut a working feed.
        // Repeated loss of the shared camera or mic fails closed on portrait only.
        const valid = wide.collection === 'Untitled' && wide.scene === 'Scene' && wide.virtualCam && wide.sending &&
          wide.cameraInScene && wide.micInScene && wide.micMuted === false &&
          tall.micMuted === false && tall.micInScene && tall.cameraInScene &&
           tall.cameraGeometry?.every(n => n > 0) &&
          !['black/empty frame', 'solid green frame'].includes(tall.picture);
        unsafe = valid ? 0 : unsafe + 1;
        if (unsafe >= 2 && Date.now() - lastSafetyAttempt > 8000) {
          lastSafetyAttempt = Date.now();
          const [muted, slate] = await Promise.allSettled([
            vertical.call('SetInputMute', { inputName: micName, inputMuted: true }),
            vertical.call('SetCurrentProgramScene', { sceneName: technical }),
          ]);
          console.warn(`[Portrait safety] mute: ${muted.status}, slate: ${slate.status}. Inspect OBS; manual re-arm only.`);
        }
      } else unsafe = 0;
      if (mode === 'guard' && identity(tall) && tall.scene === live && tall.browserInScene && browser &&
          (browser.browserAgeMs == null || browser.browserAgeMs > 12_000)) {
        browserMissingAt ||= Date.now();
        if (Date.now() - browserMissingAt > 15_000 && Date.now() - lastRefresh > 120_000) {
          lastRefresh = Date.now();
          await vertical.call('PressInputPropertiesButton', { inputName: overlayName, propertyName: 'refreshnocache' })
            .then(() => console.warn('[Portrait recovery] Refreshed only the portrait graphics source.'))
            .catch(() => console.warn('[Portrait recovery] Graphics refresh failed; inspect the portrait browser source.'));
        }
      } else browserMissingAt = 0;
      const summary = JSON.stringify({ horizontal: wide, vertical: tall, browser, rehearsalBlockers: issues, ingest: 'Check YouTube Studio separately' });
      const state = JSON.stringify([wide.state, tall.state, tall.scene, browser?.status, issues]);
      if (mode === 'status') console.log(JSON.stringify(JSON.parse(summary), null, 2));
      else if (mode === 'watch' || (mode === 'guard' && previous !== state)) console.log(summary);
      previous = state;
      if (!['watch', 'guard'].includes(mode) || stopped) break;
      await sleep(2000);
    } while (!stopped);
  } finally {
    await Promise.all([horizontal.disconnect(), vertical.disconnect()]);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

if (require.main === module) run(process.argv[2], process.argv[3]).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
module.exports = { Feed, gate, identity, framing, fullBleed, browserHealth, distinctYouTubeKeys };
