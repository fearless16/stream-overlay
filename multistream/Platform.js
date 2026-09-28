const { spawn } = require('child_process');

class Platform {
  constructor(name, config, inputStreamUrl) {
    this.name = name;
    this.enabled = config.enabled;
    this.url = config.url;
    this.key = config.key;
    this.inputStreamUrl = inputStreamUrl;
    this.process = null;
    this.isIntentionalStop = false;
  }

  // Derived classes can override this to add custom FFmpeg arguments
  // e.g., Instagram requires 9:16 aspect ratio so it might need a scale filter
  getFfmpegArgs() {
    const streamUrl = `${this.url}/${this.key}`;
    return [
      '-i', this.inputStreamUrl, // Input stream
      '-c:v', 'copy',            // Copy video codec by default to save CPU
      '-c:a', 'copy',            // Copy audio codec by default
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

    if (this.process) {
      console.warn(`[${this.name}] Stream is already running.`);
      return false;
    }

    this.isIntentionalStop = false;
    const args = this.getFfmpegArgs();
    console.log(`[${this.name}] Starting stream to ${this.url}...`);
    
    this.process = spawn('ffmpeg', args);

    this.process.on('error', (err) => {
      console.error(`[${this.name}] Failed to start FFmpeg process:`, err.message);
    });

    this.process.stdout.on('data', (data) => {
      // ffmpeg typically logs to stderr, but capturing stdout just in case
    });

    this.process.stderr.on('data', (data) => {
      const msg = data.toString();
      // Uncomment for verbose logging
      // console.log(`[${this.name} FFmpeg]: ${msg.trim()}`);
    });

    this.process.on('close', (code) => {
      console.log(`[${this.name}] Stream process exited with code ${code}`);
      this.process = null;
      
      // Auto-restart logic
      if (!this.isIntentionalStop && code !== 0) {
        console.log(`[${this.name}] Attempting to reconnect in 5 seconds...`);
        setTimeout(() => this.start(), 5000);
      }
    });

    return true;
  }

  stop() {
    this.isIntentionalStop = true;
    if (this.process) {
      console.log(`[${this.name}] Stopping stream...`);
      this.process.kill('SIGINT');
    }
  }
}

module.exports = Platform;