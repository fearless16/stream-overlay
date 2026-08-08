const fs = require('fs');
const path = require('path');
const OBSWebSocket = require('obs-websocket-js').default;
const cfgPath = path.join(process.env.APPDATA, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
const password = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).server_password || '';
const SOURCE = 'Cricket Overlay';
const target = process.argv[2] || '';
const HTML = 'file:///C:/Users/user/stream-overlay/chat-overlay.html';
const newUrl = target ? `${HTML}?ws=${encodeURIComponent(target)}` : HTML;
(async () => {
  const obs = new OBSWebSocket();
  await obs.connect('ws://localhost:4455', password, { rpcVersion: 1 });
  const { inputSettings } = await obs.call('GetInputSettings', { inputName: SOURCE });
  const old = inputSettings.url;
  await obs.call('SetInputSettings', { inputName: SOURCE, inputSettings: { url: newUrl } });
  try { await obs.call('PressInputPropertiesButton', { inputName: SOURCE, propertyName: 'refreshnocache' }); } catch (e) { console.log('refresh skip:', e.message); }
  console.log('overlay URL:', old, '\n         ->', newUrl);
  await obs.disconnect();
})().catch(e => { console.log('ERR:', e.message); process.exit(1); });
