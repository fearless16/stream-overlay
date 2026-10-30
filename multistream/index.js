const config = require('./config');
const TwitchPlatform = require('./platforms/twitch');
const KickPlatform = require('./platforms/kick');
const InstagramPlatform = require('./platforms/instagram');
const MultistreamServer = require('./server');

class MultiStreamManager {
  constructor() {
    this.inputStreamUrl = config.INPUT_STREAM_URL;
    this.platforms = [];
    this.server = null;

    this.initializePlatforms();
  }

  initializePlatforms() {
    if (config.PLATFORMS.TWITCH.enabled) {
      this.platforms.push(new TwitchPlatform(config.PLATFORMS.TWITCH, this.inputStreamUrl));
    }

    if (config.PLATFORMS.KICK.enabled) {
      this.platforms.push(new KickPlatform(config.PLATFORMS.KICK, this.inputStreamUrl));
    }

    if (config.PLATFORMS.INSTAGRAM.enabled) {
      this.platforms.push(new InstagramPlatform(config.PLATFORMS.INSTAGRAM, this.inputStreamUrl));
    }

    console.log(`[MultiStream] Configured ${this.platforms.length} platforms for streaming.`);
  }

  startPlatforms() {
    if (this.platforms.length === 0) {
      console.warn('[MultiStream] No platforms enabled. Check your .env file.');
      return;
    }

    // Guard: don't double-start if OBS reconnects while streams are already active
    const alreadyRunning = this.platforms.some(p => p.process !== null);
    if (alreadyRunning) {
      console.warn('[MultiStream] Platforms already running — ignoring duplicate OBS publish event.');
      return;
    }

    console.log(`[MultiStream] Triggering FFmpeg relays from ${this.inputStreamUrl}...`);
    this.platforms.forEach(platform => {
      platform.start();
    });
  }

  stopPlatforms() {
    console.log('[MultiStream] Stopping all FFmpeg streams...');
    this.platforms.forEach(platform => {
      platform.stop();
    });
  }

  startAll() {
    console.log("\n=======================================================");
    console.log(" MULTISTREAM MANAGER");
    console.log("-------------------------------------------------------");
    console.log(" IMPORTANT OBS SETTINGS:");
    console.log(" - Settings > Output > Recording");
    console.log(" - Type: Standard (or Custom Output)");
    console.log(" - Action: Start Recording will trigger Multistream.");
    console.log(" - Video Encoder: AMD HW H.264 (AMF) (Crucial for AMD GPUs)");
    console.log("=======================================================\n");

    // Initialize and start the local RTMP server
    this.server = new MultistreamServer(
      // On Stream Start
      (streamPath) => {
        // e.g. /live/obs
        const targetPath = new URL(this.inputStreamUrl).pathname;
        console.log(`[MultiStream] Stream event received: "${streamPath}" (expected target: "${targetPath}")`);
        if (streamPath === targetPath || (streamPath && targetPath.includes(streamPath)) || (streamPath && streamPath.includes(targetPath))) {
          console.log(`[MultiStream] OBS feed detected! Starting external streams...`);
          this.startPlatforms();
        } else {
          console.warn(`[MultiStream] Stream path mismatch: received "${streamPath}", expected "${targetPath}"`);
        }
      },
      // On Stream Stop
      (streamPath) => {
        const targetPath = new URL(this.inputStreamUrl).pathname;
        console.log(`[MultiStream] Stream stop event received: "${streamPath}"`);
        if (streamPath === targetPath || (streamPath && targetPath.includes(streamPath)) || (streamPath && streamPath.includes(targetPath))) {
          console.log(`[MultiStream] OBS feed lost! Stopping external streams...`);
          this.stopPlatforms();
        }
      }
    );

    this.server.start();
  }

  stopAll() {
    this.stopPlatforms();
    if (this.server) {
      this.server.stop();
    }
  }
}

// If run directly
if (require.main === module) {
  process.on('uncaughtException', (err) => {
    console.error('[MultiStream UNCAUGHT EXCEPTION]:', err);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[MultiStream UNHANDLED REJECTION]:', reason);
  });

  const manager = new MultiStreamManager();
  manager.startAll();

  process.on('SIGINT', () => {
    manager.stopAll();
    process.exit(0);
  });
}

module.exports = MultiStreamManager;
