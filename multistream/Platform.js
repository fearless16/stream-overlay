const { spawn } = require('child_process');

// Maximum reconnect delay: 60 seconds
const MAX_RECONNECT_DELAY_MS = 60000;
const BASE_RECONNECT_DELAY_MS = 5000;

class Platform {
  constructor(name, config, inputStreamUrl) {
    this.name = name;
    this.enabled = config.enabled;
    this.url = config.url;
    this.key = config.key;
    this.inputStreamUrl = inputStreamUrl;
    this.process = null;
    this.isIntentionalStop = false;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
  }

  // Derived classes can override this to add custom FFmpeg arguments
  // e.g., Instagram requires 9:16 aspect ratio so it might need a scale filter
  getFfmpegArgs() {
    const streamUrl = `${this.url}/${this.key}`;
    return [
      '-i', this.inputStreamUrl, // Input stream
      '-c:v', 'copy',            // Copy video codec — no re-encode needed for Twitch/Kick
      '-c:a', 'copy',            // Copy audio codec
      '-f', 'flv',               // Output format
      streamUrl                  // Output destination
    ];
  }

  start() {
    if (!this.enabled) {
      console.log(`[${this.name}] Platform is disabled.`);
      return false;
    }

    if (!this.key) {
      console.error(`[${this.name}] Missing stream key! Cannot start.`);
      return false;
    }

    // Guard: already running
    if (this.process) {
      console.warn(`[${this.name}] Stream is already running.`);
      return false;
    }

    // Clear any pending reconnect timer
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    this.isIntentionalStop = false;
    const args = this.getFfmpegArgs();
    console.log(`[${this.name}] Starting stream relay to ${this.url}...`);

    this.process = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    this.process.on('error', (err) => {
      console.error(`[${this.name}] Failed to start FFmpeg process:`, err.message);
      this.process = null;
      this._scheduleReconnect();
    });

    // Surface genuine warnings/errors while suppressing repetitive frame= progress lines
    this.process.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (!msg) return;
      // Skip frame progress updates
      if (msg.startsWith('frame=') || /^size=\s*\d+/i.test(msg)) {
        return;
      }
      if (/error|failed|invalid|no such|refused|connection timed|fatal/i.test(msg)) {
        console.error(`[${this.name} ERROR]: ${msg}`);
      }
    });

    this.process.on('close', (code, signal) => {
      console.log(`[${this.name}] Stream process stopped (code: ${code})`);
      this.process = null;

      if (!this.isIntentionalStop) {
        this._scheduleReconnect();
      } else {
        this._reconnectAttempts = 0;
      }
    });

    return true;
  }

  _scheduleReconnect() {
    if (this.isIntentionalStop) return;

    this._reconnectAttempts++;
    // Exponential backoff capped at MAX_RECONNECT_DELAY_MS
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * Math.pow(1.5, this._reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS
    );
    console.log(`[${this.name}] Reconnect attempt #${this._reconnectAttempts} in ${Math.round(delay / 1000)}s...`);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (!this.isIntentionalStop) this.start();
    }, delay);
  }

  stop() {
    this.isIntentionalStop = true;
    this._reconnectAttempts = 0;

    // Cancel any pending reconnect
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this.process) {
      console.log(`[${this.name}] Stopping stream...`);
      this.process.kill('SIGINT');
      this.process = null;
    }
  }
}

module.exports = Platform;
