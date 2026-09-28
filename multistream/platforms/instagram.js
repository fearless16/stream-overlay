const Platform = require('../Platform');

class InstagramPlatform extends Platform {
  constructor(config, inputStreamUrl) {
    super('Instagram', config, inputStreamUrl);
  }

  getFfmpegArgs() {
    const streamUrl = `${this.url}/${this.key}`;
    
    // Instagram prefers 9:16 vertical video.
    // We will re-encode for Instagram to crop the 16:9 video into 9:16 (center crop).
    // If CPU is an issue, users can change this back to '-c:v copy'.
    return [
      '-i', this.inputStreamUrl,
      '-vf', 'crop=ih*(9/16):ih', // Center crop to 9:16 aspect ratio
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-maxrate', '3000k',
      '-bufsize', '6000k',
      '-pix_fmt', 'yuv420p',
      '-g', '60', // Keyframe interval
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-f', 'flv',
      streamUrl
    ];
  }
}

module.exports = InstagramPlatform;