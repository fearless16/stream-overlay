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
  OK: `${C.BRIGHT_GREEN}[ \u2714 ]${C.RESET}`,
  FAIL: `${C.BRIGHT_RED}[ \u2718 ]${C.RESET}`,
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

// Check whether a specific process is running (e.g. to see if Iriun app is actually open)
async function isProcessRunning(processName) {
  return new Promise((resolve) => {
    exec(`tasklist | findstr /I "${processName}"`, (err, stdout) => {
      resolve(stdout.toLowerCase().includes(processName.toLowerCase()));
    });
  });
}

// Combines Powershell PnP query with FFmpeg DirectShow query for bulletproof device hunting
async function getConnectedDevices() {
  const p1 = new Promise((resolve) => {
    const cmd = `powershell -NoProfile -Command "Get-PnpDevice -PresentOnly | Select-Object -ExpandProperty FriendlyName"`;
    exec(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 }, (err, stdout) => resolve(stdout || ""));
  });

  const p2 = new Promise((resolve) => {
    // FFmpeg dshow outputs exactly what OBS sees in the Windows media foundation
    exec('ffmpeg -list_devices true -f dshow -i dummy', (err, stdout, stderr) => resolve(stdout + stderr));
  });

  const [wmiOut, ffmpegOut] = await Promise.all([p1, p2]);
  return (wmiOut + "\n" + ffmpegOut).toLowerCase();
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
        // Request error handles the resolve(false)
      });
    } catch(e) {
      resolve(false);
    }
  });
}

// Execute a command, but timeout after 3 seconds so we don't freeze the daemon
// if the user provided a blocking server command instead of a background launch.
function executeCommand(cmd) {
  return new Promise((resolve) => {
    let settled = false;
    const proc = exec(cmd, (err) => {
      if (!settled) {
        settled = true;
        resolve(!err);
      }
    });
    
    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(true); // Assume it's a long-running process that successfully started
      }
    }, 3000);
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
  let deviceString = await getConnectedDevices();
  let foundMic = deviceString.includes(TARGET_MIC.toLowerCase());
  
  if (foundMic) {
    overwriteLine(`${D.OK} Audio Link Established -> [${TARGET_MIC} Microphone Connected]`);
    sysState.mic = true;
  } else {
    overwriteLine(`${D.FAIL} Audio Link Failed -> [${TARGET_MIC} Microphone MISSING]`);
    console.log(`${D.INFO} ${C.GRAY}Make sure the mic isn't disabled in Windows Sound Control Panel.${C.RESET}`);
    console.log(`${D.INFO} ${C.GRAY}If the name changed (e.g. "USB Audio"), update DIAG_MIC_NAME in .env${C.RESET}`);
    allGreen = false;
  }
  await sleep(400);

  // 2. Camera Check
  process.stdout.write(`${D.DIAG} Scanning video endpoints for '${TARGET_CAM}'...`);
  deviceString = await getConnectedDevices(); // Re-fetch in case a device just plugged in
  let foundCam = deviceString.includes(TARGET_CAM.toLowerCase());
  
  // Advanced check: If it's a virtual camera like Iriun, the driver always exists. 
  // We MUST check if the actual application is running to know if the phone is linked.
  if (foundCam && TARGET_CAM.toLowerCase().includes('iriun')) {
    process.stdout.write(`\r\x1b[K${D.DIAG} Driver found. Verifying Iriun app is actively running...`);
    let iriunActive = await isProcessRunning('iriun');
    if (!iriunActive) {
      foundCam = false;
      overwriteLine(`${D.FAIL} Video Link Failed -> [Iriun App is CLOSED - Phone cannot route video]`);
      console.log(`${D.INFO} ${C.GRAY}Please open the Iriun Webcam application on Windows.${C.RESET}`);
      allGreen = false;
    }
  }

  if (foundCam) {
    overwriteLine(`${D.OK} Video Link Established -> [${TARGET_CAM} Camera Active]`);
    sysState.cam = true;
  } else if (!TARGET_CAM.toLowerCase().includes('iriun')) {
    // We only print the standard missing message if it wasn't Iriun 
    // (since Iriun already printed its custom missing message above)
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
  
  // Verify final aggregate state
  const isAllGreen = sysState.mic && sysState.cam && sysState.llm;

  if (isAllGreen) {
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
  
  let isPolling = false;

  setInterval(async () => {
    if (isPolling) return;
    isPolling = true;

    try {
      // 1. Fetch hardware
      const deviceString = await getConnectedDevices();
      let micNow = deviceString.includes(TARGET_MIC.toLowerCase());
      let camNow = deviceString.includes(TARGET_CAM.toLowerCase());
      
      // Advanced check for Virtual Cameras (like Iriun)
      if (camNow && TARGET_CAM.toLowerCase().includes('iriun')) {
        let iriunActive = await isProcessRunning('iriun');
        if (!iriunActive) camNow = false;
      }
      
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
    } catch (err) {
      // Catch any unexpected polling errors to keep daemon alive
    } finally {
      isPolling = false;
    }
  }, POLL_INTERVAL_MS);
}

// Start
runPreFlightCheck();
