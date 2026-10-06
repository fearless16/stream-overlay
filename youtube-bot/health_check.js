require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

console.log("\n=============================================");
console.log("     YOUTUBE BOT SYSTEM HEALTH CHECK       ");
console.log("=============================================\n");

let allGood = true;

// 1. Check configs
const configs = ['greetings.json', 'global-users.json', 'session-users.json'];
console.log("[1/2] Checking configuration files...");
for (const file of configs) {
    const fullPath = path.join(__dirname, file);
    if (!fs.existsSync(fullPath)) {
        if (file === 'session-users.json' || file === 'global-users.json') {
            fs.writeFileSync(fullPath, "{}"); // create empty if missing
            console.log(`  [OK] Created missing ${file}`);
        } else {
            console.error(`  [ERROR] Missing required file: ${file}`);
            allGood = false;
        }
    } else {
        try {
            JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            console.log(`  [OK] ${file} is valid JSON.`);
        } catch (e) {
            console.error(`  [ERROR] ${file} is corrupted or invalid JSON!`);
            allGood = false;
        }
    }
}

// 2. Check LLM Server
const llmUrlStr = process.env.LLM_API_URL || 'http://127.0.0.1:8080/v1/chat/completions';
const llmUrl = new URL(llmUrlStr);
const healthUrl = `${llmUrl.protocol}//${llmUrl.host}/health`;

console.log(`\n[2/2] Checking Local AI (LLM) Server at ${healthUrl}...`);

const protocol = llmUrl.protocol === 'https:' ? https : http;

const req = protocol.get(healthUrl, (res) => {
    if (res.statusCode >= 200 && res.statusCode < 600) {
        // Any HTTP response means the server is UP
        console.log("  [OK] LLM Server is ONLINE. Dynamic AI greetings are active!");
    } else {
        console.log(`  [WARN] LLM Server responded with status ${res.statusCode}.`);
    }
    finalize();
}).on('error', (err) => {
    console.log("  [WARN] LLM Server is OFFLINE! (Did you run start-llm-server.bat?)");
    console.log("  [INFO] The bot will automatically fallback to static greetings.json");
    finalize();
});

req.setTimeout(1500, () => {
    console.log("  [WARN] LLM Server ping timed out!");
    req.destroy();
    finalize();
});

function finalize() {
    console.log("\n=============================================");
    if (allGood) {
        console.log("  ✅ EVERYTHING IS IN ORDER! Starting Bot...");
    } else {
        console.log("  ❌ WARNING: Some critical files are missing or broken!");
    }
    console.log("=============================================\n");
    process.exit(allGood ? 0 : 1);
}
