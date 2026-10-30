const Platform = require('../Platform');

class InstagramPlatform extends Platform {
  constructor(config, inputStreamUrl) {
    super('Instagram', config, inputStreamUrl);
  }

  getFfmpegArgs() {
    const streamUrl = `${this.url}/${this.key}`;

    // Instagram prefers 9:16 vertical video.
    // Re-encodes a 16:9 input into 9:16 via center crop, using AMD GPU (h264_amf).
    return [
      '-i', this.inputStreamUrl,
      '-vf', 'crop=ih*(9/16):ih',   // Center-crop to 9:16 aspect ratio
      '-c:v', 'h264_amf',           // AMD GPU encoder (AMF)
      '-usage', 'ultralowlatency',  // AMF usage for live streaming (low latency)
      '-rc', 'cbr',                 // Constant Bitrate — required for stable RTMP
      '-b:v', '3000k',              // Target bitrate
      '-maxrate', '3000k',
      '-bufsize', '6000k',
      '-pix_fmt', 'yuv420p',
      '-g', '60',                   // Keyframe interval (~2s at 30fps)
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-f', 'flv',
      streamUrl
    ];
  }
}

module.exports = InstagramPlatform;
