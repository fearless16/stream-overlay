const Platform = require('../Platform');

class TwitchPlatform extends Platform {
  constructor(config, inputStreamUrl) {
    super('Twitch', config, inputStreamUrl);
  }

  // Uses default copy behavior since Twitch accepts standard 16:9 RTMP
}

module.exports = TwitchPlatform;