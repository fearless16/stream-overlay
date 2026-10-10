require('dotenv').config();
const { exec } = require('child_process');
const http = require('http');
const https = require('https');

// --- HACKER THEME & COLORS ---
const C = {
  RESET: '\x1b[0m',
  GREEN: '\x1b[32m',
  BRIGHT_GREEN: '\x1b[1;32m',
  RED: '\x1b[31m',
  BRIGHT_RED: '\x1b[1;31m',
  YELLOW: '\x1b[33m',
  CYAN: '\x1b[36m',
  BRIGHT_CYAN: '\x1b[1;36m',
  GRAY: '\x1b[90m',
};

const D = {
  OK: `${C.BRIGHT_GREEN}[ OK ]${C.RESET}`,
  FAIL: `${C.BRIGHT_RED}[FAIL]${C.RESET}`,
  WARN: `${C.YELLOW}[WARN]${C.RESET}`,
  INFO: `${C.CYAN}[INFO]${C.RESET}`,
  DIAG: `${C.GRAY}[SCAN]${C.RESET}`,
  WAIT: `${C.GRAY}[....]${C.RESET}`,
  FIX: `${C.YELLOW}[AUTO-FIX]${C.RESET}`
};

// --- CONFIGURATION FROM ENV ---
const TARGET_MIC = process.env.DIAG_MIC_NAME || 'Maono';
const TARGET_CAM = process.env.DIAG_CAM_NAME || 'Iriun';
const LLM_URL = process.env.DIAG_LLM_URL || 'http://127.0.0.1:11434'; // Default to Ollama
const LLM_START_CMD = process.env.DIAG_LLM_START_CMD || ''; // e.g. "ollama serve"
const POLL_INTERVAL_MS = 5000;

// Internal state tracking for the daemon
let sysState = {
  mic: false,
  cam: false,
  llm: false
};

const sleep = ms => new Promise(res => setTimeout(res, ms));

// Typewriter effect for authentic feel
async function printAnimated(text, speed = 15) {
  for (let char of text) {
    process.stdout.write(char);
    await sleep(speed);
  }
}

// Clears the line so we can replace [SCAN] with [ OK ] seamlessly
function overwriteLine(text) {
  process.stdout.write('\r\x1b[K' + text + '\n');
}

// ------------------------------------------------------------------
// SCANNING ROUTINES
// ------------------------------------------------------------------

// Powershell is a bulletproof way to get actively connected PnP devices on Windows
async function getConnectedDevices() {
  return new Promise((resolve) => {
    const cmd = `powershell -NoProfile -Command "Get-PnpDevice -Status OK | Select-Object -ExpandProperty FriendlyName"`;
    exec(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        resolve([]);
      } else {
        const devices = stdout.split('\n').map(l => l.trim().toLowerCase()).filter(l => l.length > 0);
        resolve(devices);
      }
    });
  });
}

// Ping the LLM to see if it responds (local or remote)
async function checkLLM(url) {
  return new Promise((resolve) => {
    try {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, (res) => {
        // Any response means the server is reachable
        if (res.statusCode) resolve(true);
        else resolve(false);
      }).on('error', () => {
        resolve(false);
      });
      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
    } catch(e) {
      resolve(false);
    }
  });
}

function executeCommand(cmd) {
  return new Promise((resolve) => {
    exec(cmd, (err) => {
      resolve(!err);
    });
  });
}

// ------------------------------------------------------------------
// INIT SEQUENCE (PRE-FLIGHT CHECK)
// ------------------------------------------------------------------
async function runPreFlightCheck() {
  console.clear();
  const banner = `
${C.BRIGHT_GREEN}     _____ ____  ______   ____  _____  ________ 
    / ___// __ \\/ ____/  / __ \\/ ___/ / ____/ |
    \\__ \\/ / / / /      / / / /\\__ \\ / /_ / /| |
   ___/ / /_/ / /___   / /_/ /___/ // __/_  _ |
  /____/\\____/\\____/   \\____//____//_/  |_||_| ${C.RESET}
  
  ${C.BRIGHT_CYAN}:: SYSTEM DIAGNOSTICS & HARDWARE DELIVERY POINT ::${C.RESET}
==================================================================
`;
  console.log(banner);
  await sleep(500);

  let allGreen = true;

  // 1. Microphone Check
  process.stdout.write(`${D.DIAG} Scanning audio endpoints for '${TARGET_MIC}'...`);
  let devices = await getConnectedDevices();
  let foundMic = devices.some(d => d.includes(TARGET_MIC.toLowerCase()));
  if (foundMic) {
    overwriteLine(`${D.OK} Audio Link Established -> [${TARGET_MIC} Microphone Connected]`);
    sysState.mic = true;
  } else {
    overwriteLine(`${D.FAIL} Audio Link Failed -> [${TARGET_MIC} Microphone MISSING]`);
    console.log(`${D.INFO} ${C.GRAY}Check USB connections or verify device manager.${C.RESET}`);
    allGreen = false;
  }
  await sleep(400);

  // 2. Camera Check
  process.stdout.write(`${D.DIAG} Scanning video endpoints for '${TARGET_CAM}'...`);
  // Re-fetch in case a device just plugged in
  let foundCam = devices.some(d => d.includes(TARGET_CAM.toLowerCase()));
  if (foundCam) {
    overwriteLine(`${D.OK} Video Link Established -> [${TARGET_CAM} Camera Connected]`);
    sysState.cam = true;
  } else {
    overwriteLine(`${D.FAIL} Video Link Failed -> [${TARGET_CAM} Camera MISSING]`);
    console.log(`${D.INFO} ${C.GRAY}Ensure camera app/hardware is active and unlocked.${C.RESET}`);
    allGreen = false;
  }
  await sleep(400);

  // 3. LLM Check
  process.stdout.write(`${D.DIAG} Pinging Local LLM Hivemind at ${LLM_URL}...`);
  let llmOk = await checkLLM(LLM_URL);
  if (llmOk) {
    overwriteLine(`${D.OK} Neural Uplink Verified -> [LLM is RESPONSIVE]`);
    sysState.llm = true;
  } else {
    overwriteLine(`${D.FAIL} Neural Uplink Offline -> [LLM is UNRESPONSIVE]`);
    allGreen = false;
    
    // Auto-fix attempt
    if (LLM_START_CMD) {
      console.log(`${D.FIX} Attempting autonomous recovery: executing '${LLM_START_CMD}'...`);
      await executeCommand(LLM_START_CMD);
      process.stdout.write(`${D.DIAG} Re-pinging LLM Network...`);
      await sleep(3000); // Wait for boot
      llmOk = await checkLLM(LLM_URL);
      if (llmOk) {
        overwriteLine(`${D.OK} Neural Uplink RESTORED -> [Auto-fix Successful]`);
        sysState.llm = true;
        allGreen = true; // Recovered!
      } else {
        overwriteLine(`${D.FAIL} Auto-fix failed. Network unresponsive.`);
      }
    } else {
      console.log(`${D.INFO} ${C.GRAY}No DIAG_LLM_START_CMD configured. Please start your LLM manually.${C.RESET}`);
      console.log(`${D.WARN} ${C.RED}FALLBACK PROTOCOL ENGAGED: Standard static bot responses will be used if LLM remains offline.${C.RESET}`);
    }
  }

  await sleep(400);
  console.log('==================================================================');
  if (allGreen) {
    await printAnimated(`${C.BRIGHT_GREEN}>>> CLEAR TO LAUNCH. ALL CHECKPOINTS PASSED. <<<${C.RESET}\n`);
    await sleep(400);
    console.log(`\n${D.INFO} Transferring control to background DAEMON mode...`);
  } else {
    await printAnimated(`${C.BRIGHT_RED}>>> LAUNCH WARNING. ONE OR MORE CHECKPOINTS FAILED. <<<${C.RESET}\n`);
    console.log(`\n${D.WARN} Transferring control to background DAEMON mode for continuous monitoring...`);
  }
  
  // Enter Daemon Loop
  runDaemon();
}

// ------------------------------------------------------------------
// DAEMON MONITORING
// ------------------------------------------------------------------
function runDaemon() {
  console.log(`${C.GRAY}[DAEMON] Active and watching system metrics (Tick: ${POLL_INTERVAL_MS}ms)${C.RESET}\n`);
  
  setInterval(async () => {
    // 1. Fetch hardware
    const devices = await getConnectedDevices();
    const micNow = devices.some(d => d.includes(TARGET_MIC.toLowerCase()));
    const camNow = devices.some(d => d.includes(TARGET_CAM.toLowerCase()));
    
    // 2. Fetch LLM
    let llmNow = await checkLLM(LLM_URL);

    // 3. Compare & Alert
    if (micNow !== sysState.mic) {
      if (micNow) console.log(`\n${D.OK} DAEMON ALERT: [${TARGET_MIC} Microphone] RECONNECTED!`);
      else console.log(`\n${D.FAIL} DAEMON ALERT: [${TARGET_MIC} Microphone] DISCONNECTED OR LOST!`);
      sysState.mic = micNow;
    }

    if (camNow !== sysState.cam) {
      if (camNow) console.log(`\n${D.OK} DAEMON ALERT: [${TARGET_CAM} Camera] RECONNECTED!`);
      else console.log(`\n${D.FAIL} DAEMON ALERT: [${TARGET_CAM} Camera] DISCONNECTED OR LOST!`);
      sysState.cam = camNow;
    }

    if (llmNow !== sysState.llm) {
      if (llmNow) {
        console.log(`\n${D.OK} DAEMON ALERT: [LLM Network] RESTORED AND RESPONSIVE!`);
        sysState.llm = true;
      } else {
        console.log(`\n${D.FAIL} DAEMON ALERT: [LLM Network] CONNECTION LOST!`);
        sysState.llm = false;

        if (LLM_START_CMD) {
          console.log(`${D.FIX} Auto-initiating backend recovery...`);
          await executeCommand(LLM_START_CMD);
        } else {
          console.log(`${D.WARN} ${C.RED}FALLBACK PROTOCOL ACTIVE: Utilizing local saved bot responses!${C.RESET}`);
        }
      }
    }
  }, POLL_INTERVAL_MS);
}

// Start
runPreFlightCheck();
