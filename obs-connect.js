// obs-connect.js
// Connects to OBS via WebSocket v5, ensures the browser source exists,
// and adds it to the current scene. Idempotent.

const path = require('path');
const fs = require('fs');
const OBSWebSocket = require('obs-websocket-js').default;

const HTML_PATH = path.join(__dirname, 'chat-overlay.html');
const FILE_URL = 'file:///' + HTML_PATH.replace(/\\/g, '/');
const SOURCE_NAME = 'Cricket Overlay';

async function tryConnect(password, timeoutMs = 4000) {
    const obs = new OBSWebSocket();
    obs.on('error', () => {}); // swallow — we report on close
    try {
        await Promise.race([
            obs.connect('ws://localhost:4455', password, { rpcVersion: 1 }),
            new Promise((_, r) => setTimeout(() => r(new Error('connect-timeout')), timeoutMs)),
        ]);
        return obs;
    } catch (e) {
        try { obs.disconnect(); } catch (_) {}
        return null;
    }
}

async function ensureSceneItem(obs, sceneName) {
    // 1) Wipe any existing source so the new one gets fresh defaults.
    //    Previously, sources created with stale state had width/height = 0,
    //    which made the browser invisible. Recreating forces a clean state.
    const items = await obs.call('GetSceneItemList', { sceneName });
    for (const it of items.sceneItems) {
        if (it.sourceName === SOURCE_NAME) {
            await obs.call('RemoveSceneItem', { sceneName, sceneItemId: it.sceneItemId });
        }
    }
    const inputs = await obs.call('GetInputList');
    for (const inp of inputs.inputs) {
        if (inp.inputName === SOURCE_NAME) {
            await obs.call('RemoveInput', { inputName: SOURCE_NAME });
        }
    }
    // small breather so the CEF instance fully tears down
    await new Promise(r => setTimeout(r, 600));

    // 2) Create fresh. The browser source's own width/height (1920x1080) are used
    //    as the scene item's intrinsic size. Scale to fill 2560×1440 canvas.
    const created = await obs.call('CreateInput', {
        sceneName,
        inputName: SOURCE_NAME,
        inputKind: 'browser_source',
        inputSettings: {
            url: FILE_URL,
            width: 1920,
            height: 1080,
            fps: 60,
            shutdown: false,
            restart_when_active: true,
            reroute_audio: false,
            persist: true,
        },
        sceneItemEnabled: true,
    });
    const scale = 3840 / 1920; // 2.0
    await obs.call('SetSceneItemTransform', {
        sceneName,
        sceneItemId: created.sceneItemId,
        sceneItemTransform: {
            scaleX: scale,
            scaleY: scale,
            positionX: 0,
            positionY: 0,
        },
    });
    return created.sceneItemId;
}

async function main() {
    // 1) Read OBS websocket config
    const cfgPath = path.join(process.env.APPDATA, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
    if (!fs.existsSync(cfgPath)) {
        console.log('  [WARN] No OBS WebSocket config found.');
        return { ok: false, reason: 'no-config' };
    }
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (!cfg.server_enabled) {
        cfg.server_enabled = true;
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
        console.log('  [INFO] Enabled OBS WebSocket. OBS must be restarted once to apply.');
        return { ok: false, reason: 'needs-restart' };
    }
    const password = cfg.server_password || '';

    console.log('  [INFO] Connecting to OBS at ws://localhost:4455...');
    const obs = await tryConnect(password);
    if (!obs) {
        console.log('  [WARN] Could not connect to OBS. Is OBS running?');
        return { ok: false, reason: 'no-connection' };
    }
    console.log('  [OK] Connected to OBS');

    let sceneName = 'Scene';
    try {
        const sceneResp = await obs.call('GetCurrentProgramScene');
        sceneName = sceneResp.currentProgramSceneName || 'Scene';
    } catch (_) {}

    try {
        const id = await ensureSceneItem(obs, sceneName);
        // verify the source actually has dimensions
        await new Promise(r => setTimeout(r, 800));
        const items = await obs.call('GetSceneItemList', { sceneName });
        const me = items.sceneItems.find(it => it.sourceName === SOURCE_NAME);
        if (me) {
            const t = await obs.call('GetSceneItemTransform', { sceneName, sceneItemId: me.sceneItemId });
            const w = t.sceneItemTransform.width;
            const h = t.sceneItemTransform.height;
            if (w === 0 || h === 0) {
                console.log(`  [WARN] Source created but has 0x0 size — browser may have failed to load. Try refreshing the source in OBS.`);
            } else {
                console.log(`  [OK] 'Cricket Overlay' is in scene '${sceneName}' (${w}x${h}, item id ${id})`);
            }
        } else {
            console.log(`  [OK] 'Cricket Overlay' added to scene '${sceneName}' (item id ${id})`);
        }
        await obs.disconnect();
        return { ok: true };
    } catch (e) {
        console.log('  [FAIL] Could not add source:', e.message || e);
        try { await obs.disconnect(); } catch (_) {}
        return { ok: false, reason: 'create-failed' };
    }
}

if (require.main === module) {
    main().then(r => process.exit(r.ok ? 0 : 1));
}

module.exports = { main };
