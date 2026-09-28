require('dotenv').config();

module.exports = {
  // Input stream configuration (e.g., from OBS local RTMP or UDP)
  // By default, assuming OBS streams to a local RTMP server or UDP port
  INPUT_STREAM_URL: process.env.INPUT_STREAM_URL || 'rtmp://127.0.0.1/live/obs',

  // Platforms configuration
  PLATFORMS: {
    TWITCH: {
      enabled: process.env.ENABLE_TWITCH === 'true',
      url: process.env.TWITCH_RTMP_URL || 'rtmp://live.twitch.tv/app',
      key: process.env.TWITCH_STREAM_KEY,
    },
    KICK: {
      enabled: process.env.ENABLE_KICK === 'true',
      url: process.env.KICK_RTMP_URL || 'rtmps://fa723fc1b171.global-contribute.live-video.net:443/app',
      key: process.env.KICK_STREAM_KEY,
    },
    INSTAGRAM: {
      enabled: process.env.ENABLE_INSTAGRAM === 'true',
      url: process.env.INSTAGRAM_RTMP_URL || 'rtmps://live-upload.instagram.com:443/rtmp',
      key: process.env.INSTAGRAM_STREAM_KEY,
    }
    // Add more platforms easily via ENV
  }
};