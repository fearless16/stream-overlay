const NodeMediaServer = require('node-media-server');

class MultistreamServer {
  constructor(onStreamStart, onStreamStop) {
    const config = {
      rtmp: {
        port: 1935,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60
      }
    };

    this.nms = new NodeMediaServer(config);
    this.onStreamStart = onStreamStart;
    this.onStreamStop = onStreamStop;

    this.setupEvents();
  }

  setupEvents() {
    this.nms.on('postPublish', (id, StreamPath, args) => {
      console.log(`[RTMP Server] Receiving stream at: ${StreamPath}`);
      // Usually StreamPath is /live/obs
      if (typeof this.onStreamStart === 'function') {
        this.onStreamStart(StreamPath);
      }
    });

    this.nms.on('donePublish', (id, StreamPath, args) => {
      console.log(`[RTMP Server] Stream stopped: ${StreamPath}`);
      if (typeof this.onStreamStop === 'function') {
        this.onStreamStop(StreamPath);
      }
    });
  }

  start() {
    this.nms.run();
    console.log('[RTMP Server] Started waiting for OBS feed on rtmp://127.0.0.1:1935/live/obs');
  }

  stop() {
    this.nms.stop();
  }
}

module.exports = MultistreamServer;
