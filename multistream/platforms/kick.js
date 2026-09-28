const Platform = require('../Platform');

class KickPlatform extends Platform {
  constructor(config, inputStreamUrl) {
    super('Kick', config, inputStreamUrl);
  }

  // Uses default copy behavior since Kick accepts standard 16:9 RTMP
}

module.exports = KickPlatform;