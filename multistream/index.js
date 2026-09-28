const config = require('./config');
const TwitchPlatform = require('./platforms/twitch');
const KickPlatform = require('./platforms/kick');
const InstagramPlatform = require('./platforms/instagram');

class MultiStreamManager {
  constructor() {
    this.inputStreamUrl = config.INPUT_STREAM_URL;
    this.platforms = [];

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

    console.log(`[MultiStream] Initialized ${this.platforms.length} platforms for streaming.`);
  }

  startAll() {
    if (this.platforms.length === 0) {
      console.warn('[MultiStream] No platforms enabled. Check your .env file.');
      return;
    }

    console.log(`[MultiStream] Waiting for input stream at: ${this.inputStreamUrl}`);
    
    this.platforms.forEach(platform => {
      platform.start();
    });
  }

  stopAll() {
    console.log('[MultiStream] Stopping all streams...');
    this.platforms.forEach(platform => {
      platform.stop();
    });
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