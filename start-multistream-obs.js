const path = require('path');
const fs = require('fs');
const OBSWebSocket = require('obs-websocket-js').default;

const obs = new OBSWebSocket();

async function startFeed() {
    console.log("==================================================");
    console.log(" Waiting for OBS to launch (Timeout in ~60 sec)");
    console.log("==================================================\n");
    
    // 1) Read OBS websocket config to get the password
    const cfgPath = path.join(process.env.APPDATA, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
    let password = undefined;
    
    if (fs.existsSync(cfgPath)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            password = cfg.server_password || undefined;
        } catch (e) {
            console.log("[WARN] Could not parse OBS WebSocket config.");
        }
    } else {
        console.log("[WARN] No OBS WebSocket config found. Assuming no password.");
    }

    let connected = false;
    let attempts = 0;
    const maxAttempts = 20;

    while (!connected && attempts < maxAttempts) {
        attempts++;
        try {
            await obs.connect('ws://localhost:4455', password, { rpcVersion: 1 });
            connected = true;
        } catch (e) {
            // Wait 3 seconds before retrying
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    if (!connected) {
        console.error("\n[ERROR] Could not connect to OBS. Are you sure OBS is running and WebSocket Server is enabled on port 4455?");
        setTimeout(() => process.exit(1), 5000);
        return;
    }

    console.log("[SUCCESS] Connected to OBS WebSocket!");
    
    // Wait a brief moment after connecting so OBS fully initialized its outputs
    await new Promise(r => setTimeout(r, 2000));

    try {
        await obs.call('StartRecord');
        console.log("\n[🚀 SUCCESS] OBS is now pushing the feed to the MultiStream Manager!");
        console.log("This window will close automatically...");
    } catch (err) {
        const errorMsg = String(err.message || err.error || err);
        if (errorMsg.toLowerCase().includes('active') || errorMsg.toLowerCase().includes('running')) {
            console.log("\n[INFO] Feed is already running in OBS. Everything is good!");
        } else {
            console.error("\n[ERROR] Failed to start feed in OBS.", err);
            console.error("Make sure Custom FFmpeg Output is properly set in the Recording tab.");
        }
    }

    // Exit cleanly
    setTimeout(() => process.exit(0), 4000);
}

startFeed();
