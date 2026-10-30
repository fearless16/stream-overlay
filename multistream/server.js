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
      },
      http: {
        port: 8000,        // Health/stats endpoint: http://localhost:8000/api/streams
        allow_origin: '*'
      }
    };

    this.nms = new NodeMediaServer(config);
    this.onStreamStart = onStreamStart;
    this.onStreamStop = onStreamStop;

    this.setupEvents();
  }

  setupEvents() {
    this.nms.on('postPublish', (session, StreamPath, args) => {
      const streamPath = (session && session.streamPath) || StreamPath || (typeof session === 'string' ? session : null);
      console.log(`[RTMP Server] Receiving stream at: ${streamPath}`);

      if (typeof this.onStreamStart === 'function') {
        this.onStreamStart(streamPath);
      }
    });

    this.nms.on('donePublish', (session, StreamPath, args) => {
      const streamPath = (session && session.streamPath) || StreamPath || (typeof session === 'string' ? session : null);
      console.log(`[RTMP Server] Stream stopped: ${streamPath}`);
      if (typeof this.onStreamStop === 'function') {
        this.onStreamStop(streamPath);
      }
    });
  }

  start() {
    this.nms.run();
    console.log('[RTMP Server] Started — waiting for OBS feed on rtmp://127.0.0.1:1935/live/obs');
    console.log('[RTMP Server] Health/stats: http://localhost:8000/api/streams');
  }

  stop() {
    this.nms.stop();
  }
}

module.exports = MultistreamServer;
