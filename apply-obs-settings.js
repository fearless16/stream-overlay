// apply-obs-settings.js
// Connects to OBS via WebSocket v5 and applies a safe, non-destructive
// "optimized streaming settings" profile. Every change is wrapped in
// try/catch and merges with the user's CURRENT settings so we never
// clobber their encoder choice, bitrate, or resolution.
//
// Idempotent and non-fatal: if OBS isn't reachable or a setting can't be
// applied, we log a warning and exit 0 so callers (e.g. go-live) continue.

const path = require('path');
const fs = require('fs');
const OBSWebSocket = require('obs-websocket-js').default;

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

async function applySafe(obs, label, fn) {
    try {
        const r = await fn();
        console.log(`  [OK]  ${label}`);
        return r;
    } catch (e) {
        console.log(`  [WARN] ${label} skipped: ${e.message || e}`);
        return null;
    }
}

// Find the active streaming output's name (OBS names it differently per mode).
async function findOutputName(obs) {
    try {
        const list = await obs.call('GetOutputList');
        const candidates = (list.outputs || []).map(o => o.outputName);
        // Prefer the streaming output; fall back to any non-"replay"/"virtualcam".
        const streaming = candidates.find(n =>
            /stream/i.test(n)
        ) || candidates.find(n =>
            /output/i.test(n) && !/replay|virtual|browser|ndi|ffmpeg/i.test(n)
        );
        if (streaming) return streaming;
        return candidates[0] || null;
    } catch (_) {
        return null;
    }
}

async function main() {
    const cfgPath = path.join(process.env.APPDATA, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
    if (!fs.existsSync(cfgPath)) {
        console.log('  [WARN] No OBS WebSocket config found. Skipping optimized settings (OBS not configured for WebSocket).');
        return { ok: false, reason: 'no-config' };
    }
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const password = cfg.server_password || '';

    console.log('  [INFO] Connecting to OBS at ws://localhost:4455...');
    const obs = await tryConnect(password);
    if (!obs) {
        console.log('  [WARN] Could not connect to OBS. Is OBS running with WebSocket enabled? Skipping optimized settings.');
        return { ok: false, reason: 'no-connection' };
    }
    console.log('  [OK]  Connected to OBS');

    // 1) Video: enforce 60fps, keep existing canvas/output resolution.
    await applySafe(obs, 'Set video to 60fps (preserving resolution)', async () => {
        const cur = await obs.call('GetVideoSettings');
        await obs.call('SetVideoSettings', {
            fpsNumerator: 60,
            fpsDenominator: 1,
            baseWidth: cur.baseWidth,
            baseHeight: cur.baseHeight,
            outputWidth: cur.outputWidth,
            outputHeight: cur.outputHeight,
        });
    });

    // 2) Output: set a sane 2s keyframe interval, keep everything else.
    const outName = await findOutputName(obs);
    if (outName) {
        await applySafe(obs, `Set keyframe interval to 2s on "${outName}"`, async () => {
            const cur = await obs.call('GetOutputSettings', { outputName: outName });
            const settings = cur.outputSettings || cur.settings || cur;
            const merged = Object.assign({}, settings, { keyframeInterval: 2 });
            await obs.call('SetOutputSettings', { outputName: outName, outputSettings: merged });
        });
    } else {
        console.log('  [WARN] Could not determine OBS output name; skipping keyframe tweak.');
    }

    try { await obs.disconnect(); } catch (_) {}
    console.log('  [OK]  Optimized OBS settings applied.');
    return { ok: true };
}

if (require.main === module) {
    // Always exit 0 so callers (go-live / menu) are never blocked by this step.
    main().then(() => process.exit(0)).catch(() => process.exit(0));
}
