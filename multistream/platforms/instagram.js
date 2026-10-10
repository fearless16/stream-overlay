const Platform = require('../Platform');

class InstagramPlatform extends Platform {
  constructor(config, inputStreamUrl) {
    super('Instagram', config, inputStreamUrl);
  }

  getFfmpegArgs() {
    const streamUrl = `${this.url}/${this.key}`;

    // Instagram prefers 9:16 vertical video.
    // We re-encode for Instagram to crop the 16:9 video into 9:16 (center crop).
    // Using h264_nvenc (Zero-CPU GPU encode) instead of libx264.
    return [
      '-i', this.inputStreamUrl,
      '-vf', 'crop=ih*(9/16):ih', // Center crop to 9:16 aspect ratio
      '-c:v', 'h264_nvenc',       // Use GPU encoding
      '-preset', 'p4',            // NVENC preset (p4 is a good balance of quality/performance)
      '-b:v', '3000k',            // Similar to maxrate
      '-maxrate', '3000k',
      '-bufsize', '6000k',
      '-pix_fmt', 'yuv420p',
      '-g', '60',                 // Keyframe interval
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-f', 'flv',
      streamUrl
    ];
  }
}

module.exports = InstagramPlatform;
