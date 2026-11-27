'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { spawn, execFileSync } = require('node:child_process');

const mainRoot = path.join(process.env.APPDATA || '.', 'obs-studio');
const portable = path.join(process.env.LOCALAPPDATA || '.', 'StreamOverlay', 'OBS-Vertical-33.0.2');
const root = path.join(portable, 'config', 'obs-studio');
const name = 'Cricket Portrait';
const profileDir = 'Cricket_Portrait';
const scenes = ['Portrait · Starting', 'Portrait · Live', 'Portrait · Break', 'Portrait · End', 'Portrait · Technical'];
const micName = 'Portrait · Commentary Mic';
const camName = 'Portrait · OBS Virtual Camera';
const overlayName = 'Portrait · Graphics';
const canvas = { width: 720, height: 1280 };
const vcamId = 'OBS Virtual Camera:';
const exe = path.join(portable, 'bin', '64bit', 'obs64.exe');
const mainCollection = path.join(mainRoot, 'basic', 'scenes', 'Untitled.json');
const wsPath = base => path.join(base, 'plugin_config', 'obs-websocket', 'config.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
};

function source(name, id, settings, fields = {}) {
  return { name, uuid: randomUUID(), id, versioned_id: id, settings, volume: 1, enabled: true, ...fields };
}

function buildCollection(main) {
  const current = main.sources.find(s => s.name === 'Audio Input Capture' && s.id === 'wasapi_input_capture');
  if (!current?.settings?.device_id || current.settings.device_id === 'default') throw new Error('The named horizontal mic does not have a fixed device ID');
  const mic = source(micName, 'wasapi_input_capture', { device_id: current.settings.device_id }, {
    mixers: 1, muted: true, volume: current.volume ?? 1, sync: current.sync ?? 0,
    monitoring_type: 0, monitoring_enabled: false,
    filters: (current.filters || []).filter(f => f.id === 'noise_suppress_filter').map(f =>
      source(f.name, f.id, f.settings, { versioned_id: f.versioned_id, enabled: f.enabled })),
  });
  const camera = source(camName, 'dshow_input', { video_device_id: vcamId, deactivate_when_not_showing: false }, { mixers: 0, muted: true });
  const browser = (label, mode) => {
    const url = pathToFileURL(path.join(__dirname, 'portrait-overlay.html'));
    if (mode) url.searchParams.set('mode', mode);
    return source(label, 'browser_source', {
      url: url.href, ...canvas, shutdown: false, restart_when_active: false,
      reroute_audio: false, fps: 30, fps_custom: true,
    }, { mixers: 0, muted: true });
  };
  const layers = [
    [browser('Portrait · Starting Card', 'starting')],
    [camera, mic, browser(overlayName)],
    [browser('Portrait · Break Card', 'break')],
    [browser('Portrait · End Card', 'end')],
    [browser('Portrait · Technical Card', 'technical')],
  ];
  const item = (input, index) => ({
    name: input.name, source_uuid: input.uuid, id: index + 1, visible: true, locked: true, align: 5, rot: 0,
    pos: { x: 0, y: 0 },
    scale: { x: 1, y: 1 }, bounds_type: input === camera ? 3 : 0, bounds_align: 0,
    bounds_crop: input === camera, bounds: input === camera ? { x: canvas.width, y: canvas.height } : { x: 0, y: 0 },
  });
  return {
    name, version: 1, preview_locked: true, scene_order: scenes.map(name => ({ name })),
    current_scene: scenes[0], current_program_scene: scenes[0], current_transition: 'Cut',
    sources: [...layers.flat(), ...layers.map((inputs, i) => source(scenes[i], 'scene', {
      id_counter: inputs.length, items: inputs.map(item),
    }))],
  };
}

function setup() {
  if (!fs.existsSync(exe)) throw new Error(`Install the verified official OBS ZIP at ${portable} first`);
  if (fs.existsSync(root)) throw new Error(`Existing portable config was not touched: ${root}`);
  const main = read(mainCollection);
  const collection = buildCollection(main);
  const staged = `${root}-stage-${randomUUID()}`;
  write(path.join(staged, 'basic', 'scenes', `${profileDir}.json`), collection);
  const profile = path.join(staged, 'basic', 'profiles', profileDir);
  write(path.join(profile, 'basic.ini'), [
    '[General]', `Name=${name}`, '[Video]', 'BaseCX=720', 'BaseCY=1280', 'OutputCX=720', 'OutputCY=1280',
    'FPSType=0', 'FPSCommon=30', 'ColorFormat=NV12', 'ColorSpace=709', 'ColorRange=Partial',
    '[Audio]', 'SampleRate=48000', 'ChannelSetup=Stereo',
    '[Output]', 'Mode=Advanced', 'Reconnect=true', 'RetryDelay=2', 'MaxRetries=20',
    '[AdvOut]', 'Encoder=obs_x264', 'AudioEncoder=ffmpeg_aac', 'TrackIndex=1', 'Track1Bitrate=128', 'Rescale=false',
    '',
  ].join('\n'));
  write(path.join(profile, 'streamEncoder.json'), { rate_control: 'CBR', bitrate: 4000, keyint_sec: 2, preset: 'veryfast', profile: 'high' });
  write(path.join(profile, 'service.json'), { type: 'rtmp_common', settings: { service: 'YouTube - RTMPS', server: 'rtmps://a.rtmps.youtube.com:443/live2' } });
  write(path.join(staged, 'user.ini'), [
    '[General]', 'FirstRun=true', '[Basic]', `Profile=${name}`, `ProfileDir=${profileDir}`,
    `SceneCollection=${name}`, `SceneCollectionFile=${profileDir}`, '[BasicWindow]', 'PreviewEnabled=true', '',
  ].join('\n'));
  write(wsPath(staged), {
    server_enabled: true, server_port: 4456, auth_required: true,
    server_password: randomBytes(24).toString('base64url'), alerts_enabled: false, first_load: false,
  });
  fs.renameSync(staged, root);
  console.log(`Portable profile and five scenes installed at ${root}. No stream key configured.`);
}

function prepareCamera() {
  // Fail closed if any instance is open; OBS writes its scene files on shutdown.
  const processes = execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq obs64.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 8000 });
  if (/"obs64\.exe"/i.test(processes)) throw new Error('Close both OBS instances before preparing horizontal Virtual Camera');
  const main = read(mainCollection);
  if (main.name !== 'Untitled' || !main.sources.some(s => s.name === 'Camera' && s.id === 'dshow_input')) {
    throw new Error('The inspected horizontal collection/camera no longer matches; configure Virtual Camera manually');
  }
  const current = main['virtual-camera'];
  if (current?.type2 === 2 && current.source === 'Camera') return console.log('Horizontal Virtual Camera already targets Camera only.');
  const backup = `${mainCollection}.before-portrait-${new Date().toISOString().replace(/[:.]/g, '-')}.backup`;
  fs.copyFileSync(mainCollection, backup, fs.constants.COPYFILE_EXCL);
  main['virtual-camera'] = { type2: 2, source: 'Camera' };
  const staged = `${mainCollection}.${randomUUID()}.tmp`;
  write(staged, main);
  fs.renameSync(staged, mainCollection);
  console.log(`Horizontal Virtual Camera now targets Camera only. Backup: ${backup}`);
}

function launch() {
  if (!fs.existsSync(wsPath(root))) throw new Error('Set up the portable OBS profile first');
  const child = spawn(exe, ['--portable', '--multi', '--only-bundled-plugins', '--disable-shutdown-check',
    '--profile', name, '--collection', name, '--scene', scenes[0]], {
    cwd: path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: false,
  });
  child.on('error', error => { console.error(`Unable to launch portrait OBS (${error.code})`); process.exitCode = 1; });
  child.once('spawn', () => {
    console.log(`Portrait OBS launched (PID ${child.pid}); no output auto-started. Verify the active scene before sending.`);
    child.unref();
  });
}

if (require.main === module) {
  try {
    switch (process.argv[2]) {
      case 'setup': setup(); break;
      case 'prepare-camera': prepareCamera(); break;
      case 'launch': launch(); break;
      default: throw new Error('Usage: node dual-format/setup.cjs setup|prepare-camera|launch');
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { mainRoot, root, name, scenes, micName, camName, overlayName, canvas, wsPath, read, buildCollection };
