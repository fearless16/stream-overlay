const OBSWebSocket = require('obs-websocket-js').default;
const fs = require('fs');
const path = require('path');

async function main() {
  const cfgPath = path.join(process.env.APPDATA, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const obs = new OBSWebSocket(); obs.on('error', () => {});
  await obs.connect('ws://localhost:4455', cfg.server_password || '', { rpcVersion: 1 });

  // Full moniker string
  const fullId = 'Iriun Webcam:\\\\\\\\?\\\\root\"devgen\"{04b0665d-70c2-244c-9e0d-2550c2ecf20e}\"{65e8773d-8f56-11d0-a3b9-00a0c9223196}\\\\8da4e6f4fd61466dbca9c8dc67dc7e77';

  // Remove old
  try { await obs.call('RemoveInput', { inputName: 'iPhone Camera' }); } catch(e) {}
  await new Promise(r => setTimeout(r, 500));

  await obs.call('CreateInput', {
    sceneName: 'Scene',
    inputName: 'iPhone Camera',
    inputKind: 'dshow_input',
    inputSettings: { video_device_id: fullId, resolution: '1920x1080', frame_interval: 166666, buffering: 2 },
    sceneItemEnabled: true,
  });
  console.log('Camera created');

  const items = await obs.call('GetSceneItemList', { sceneName: 'Scene' });
  const cam = items.sceneItems.find(i => i.sourceName === 'iPhone Camera');
  if (cam) {
    await obs.call('SetSceneItemTransform', {
      sceneName: 'Scene', sceneItemId: cam.sceneItemId,
      sceneItemTransform: { positionX: 0, positionY: 0, alignment: 0, scaleX: 1, scaleY: 1, boundsType: 'OBS_BOUNDS_NONE' },
    });
    await obs.call('SetSceneItemIndex', { sceneName: 'Scene', sceneItemId: cam.sceneItemId, sceneItemIndex: 3 });
    console.log('Camera positioned');
  }

  await obs.disconnect();
}

main().catch(e => console.error(e));
