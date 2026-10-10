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
    console.log(" - Video Encoder: NVIDIA NVENC H.264 (Crucial for GPU)");
    console.log("=======================================================\n");

    // Initialize and start the local RTMP server
    this.server = new MultistreamServer(
      // On Stream Start
      (streamPath) => {
        // e.g. /live/obs
        const targetPath = new URL(this.inputStreamUrl).pathname;
        if (streamPath === targetPath || targetPath.includes(streamPath)) {
          console.log(`[MultiStream] OBS feed detected! Starting external streams...`);
          this.startPlatforms();
        }
      },
      // On Stream Stop
      (streamPath) => {
        const targetPath = new URL(this.inputStreamUrl).pathname;
        if (streamPath === targetPath || targetPath.includes(streamPath)) {
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
  const manager = new MultiStreamManager();
  manager.startAll();

  process.on('SIGINT', () => {
    manager.stopAll();
    process.exit(0);
  });
}

module.exports = MultiStreamManager;
