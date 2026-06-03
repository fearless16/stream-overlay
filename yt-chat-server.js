require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { google } = require('googleapis');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execSync } = require('child_process');

const VIDEO_ID = process.env.VIDEO_ID || 'Gtm65By2uwg';
const WS_PORT = parseInt(process.env.WS_PORT || '8765', 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '5000', 10);

const SEEN_PATH = path.join(__dirname, '.chat_seen.json');

// Try to use OAuth first (for private streams), fallback to API key
let auth = null;
let oauthAuth = null;
let apiKeyAuth = null;
let usingApiKey = false;

async function setupAuth() {
  const secretsPath = '/Users/prajwalbairagi/projects/yt-clips/client_secrets.json';
  const tokenPath = path.join(__dirname, '.youtube_token.json');
  const apiKey = process.env.YOUTUBE_API_KEY;

  // Store API key for fallback
  if (apiKey) apiKeyAuth = apiKey;

  // Try OAuth with client_secrets
  if (fs.existsSync(secretsPath)) {
    const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8')).installed;
    const oauth2 = new google.auth.OAuth2(
      secrets.client_id,
      secrets.client_secret,
      'http://localhost:3000/oauth2callback'
    );

    // Try loading existing token
    if (fs.existsSync(tokenPath)) {
      let token;
      try { token = JSON.parse(fs.readFileSync(tokenPath, 'utf8')); }
      catch(e) { fs.unlinkSync(tokenPath); console.log('Corrupted token file, deleted.'); return await setupAuth(); }
      oauth2.setCredentials(token);
      // Check if expired and refresh
      if (token.expiry_date && Date.now() > token.expiry_date) {
        try {
          const { credentials } = await oauth2.refreshAccessToken();
          fs.writeFileSync(tokenPath, JSON.stringify(credentials));
          oauth2.setCredentials(credentials);
          console.log('OAuth token refreshed');
        } catch(e) {
          console.log('Token refresh failed, will re-auth');
          fs.unlinkSync(tokenPath);
          return await setupAuth();
        }
      }
      oauthAuth = oauth2;
      auth = oauth2;
      console.log('Authenticated via OAuth');
      return;
    }

    // No token - start auth flow
    console.log('\n=== YouTube OAuth Required ===');
    console.log('Visit this URL to authorize:');
    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/youtube.readonly']
    });
    console.log(url);
    console.log('');

    // Open in browser
    try { execSync(`open "${url}"`); } catch(e) {}

    // Start temp server to catch callback
    const server = http.createServer(async (req, res) => {
      const parsed = new URL(req.url, 'http://localhost:3000');
      const code = parsed.searchParams.get('code');
      if (!code) { res.writeHead(200); res.end('Waiting for code...'); return; }
      const { tokens } = await oauth2.getToken(code);
      fs.writeFileSync(tokenPath, JSON.stringify(tokens));
      oauth2.setCredentials(tokens);
      oauthAuth = oauth2;
      auth = oauth2;
      console.log('OAuth token saved!');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Authorized!</h1><p>You can close this tab and return to terminal.</p>');
      server.close();
    });
    server.listen(3000, () => console.log('Waiting for OAuth callback on http://localhost:3000...'));

    // Wait for auth
    while (!auth) { await new Promise(r => setTimeout(r, 1000)); }
    return;
  }

  // Fallback to API key
  if (apiKey) {
    auth = apiKey;
    usingApiKey = true;
    console.log('Authenticated via API key');
    return;
  }

  console.error('No authentication method available.');
  console.error('Set YOUTUBE_API_KEY in .env or provide client_secrets.json');
  process.exit(1);
}

function switchToApiKey() {
  if (apiKeyAuth && !usingApiKey) {
    console.log('OAuth quota exceeded — switching to API key auth');
    auth = apiKeyAuth;
    usingApiKey = true;
    liveChatId = null; // reset so we re-fetch with new auth
  }
}

// ─── WebSocket Server ───
const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`WebSocket server on ws://localhost:${WS_PORT}`);

// ─── YouTube API Client ───
function getYouTube() {
  return google.youtube({
    version: 'v3',
    auth: auth,
  });
}

let seenIds = new Set();
let liveChatId = null;

// Load seen IDs from disk
if (fs.existsSync(SEEN_PATH)) {
  try { seenIds = new Set(JSON.parse(fs.readFileSync(SEEN_PATH, 'utf8'))); } catch(e) {}
}

function saveSeen() {
  try { fs.writeFileSync(SEEN_PATH, JSON.stringify([...seenIds].slice(-2000))); } catch(e) {}
}

function esc(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
}

async function findLiveChatId() {
  try {
    const yt = getYouTube();
    const res = await yt.videos.list({
      part: 'liveStreamingDetails',
      id: VIDEO_ID,
    });
    const video = res.data.items[0];
    if (!video || !video.liveStreamingDetails || !video.liveStreamingDetails.activeLiveChatId) {
      console.log('No active live chat found. Is the stream live?');
      return null;
    }
    console.log(`Found live chat ID: ${video.liveStreamingDetails.activeLiveChatId}`);
    return video.liveStreamingDetails.activeLiveChatId;
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('quota') || (err.response && err.response.data && JSON.stringify(err.response.data).includes('quota'))) {
      console.error('YouTube API quota exceeded. Quota resets daily at midnight Pacific Time.');
      if (err.response) console.error(err.response.data);
      switchToApiKey();
      if (usingApiKey) {
        console.log('Retrying with API key in 5s...');
        return 'QUOTA_EXCEEDED';
      }
      console.error('No API key fallback available. Retrying in 5 minutes...');
      return 'QUOTA_EXCEEDED';
    }
    console.error('Error finding live chat:', err.message);
    if (err.response) console.error(err.response.data);
    return null;
  }
}

async function pollChat() {
  if (!liveChatId) {
    liveChatId = await findLiveChatId();
    if (!liveChatId) {
      console.log('Retrying in 30s...');
      setTimeout(pollChat, 30000);
      return;
    }
    if (liveChatId === 'QUOTA_EXCEEDED') {
      liveChatId = null;
      const delay = usingApiKey ? 5000 : 5 * 60 * 1000;
      setTimeout(pollChat, delay);
      return;
    }
  }

  try {
    const yt = getYouTube();
    const res = await yt.liveChatMessages.list({
      liveChatId,
      part: 'snippet,authorDetails',
    });

    const messages = res.data.items || [];
    const newMessages = [];

    for (const msg of messages) {
      if (seenIds.has(msg.id)) continue;
      seenIds.add(msg.id);

      const snippet = msg.snippet || {};
      const author = msg.authorDetails || {};

      let msgType = 'chat';
      let amount = null;
      let profileImageUrl = author.profileImageUrl || null;

      if (snippet.type === 'superChatEvent') {
        msgType = 'superchat';
        amount = snippet.superChatDetails ? snippet.superChatDetails.amountDisplayString : null;
      } else if (snippet.type === 'newSponsorEvent') {
        msgType = 'membership';
      } else if (snippet.type === 'superStickerEvent') {
        msgType = 'superchat';
        amount = snippet.superStickerDetails ? snippet.superStickerDetails.amountDisplayString : null;
      }

      // Detect moderator
      if (msgType === 'chat' && (author.isChatModerator || author.isChatOwner)) {
        msgType = 'moderator';
      }

      // Handle sticker — use alt text if displayMessage is empty
      let text = snippet.displayMessage || '';
      if (!text && snippet.type === 'superStickerEvent' && snippet.superStickerDetails) {
        text = snippet.superStickerDetails.superStickerMetadata?.altText || '[Sticker]';
      }

      const data = {
        type: 'youtube-chat',
        name: author.displayName || 'Viewer',
        text,
        msgType,
        amount,
        channelId: author.channelId,
        isModerator: author.isChatModerator,
        isOwner: author.isChatOwner,
        profileImageUrl,
      };

      newMessages.push(data);

      const badge = msgType === 'superchat' ? ` [$${amount || 'SUPER'}]` :
                    msgType === 'membership' ? ' [MEMBER]' :
                    msgType === 'moderator' ? ' [MOD]' : '';
      console.log(`${author.displayName}${badge}: ${snippet.displayMessage}`);
    }

    // Stagger broadcasts so overlay doesn't get slammed
    if (newMessages.length > 0) {
      const staggerMs = 300;
      newMessages.forEach((data, i) => {
        setTimeout(() => {
          const payload = JSON.stringify(data);
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(payload);
          });
        }, i * staggerMs);
      });
      console.log(`Broadcasting ${newMessages.length} messages over ${newMessages.length * staggerMs}ms`);
    }

    if (seenIds.size > 3000) saveSeen();

    // Use API's pollingIntervalMillis if available, otherwise our configured interval
    const nextPoll = res.data.pollingIntervalMillis || POLL_INTERVAL;
    setTimeout(pollChat, nextPoll);
    return;
  } catch (err) {
    const msg = err.message || '';
    const isQuota = msg.includes('quota') || (err.response && JSON.stringify(err.response.data || '').includes('quota'));
    if (isQuota) {
      console.error('Quota exceeded during poll.');
      switchToApiKey();
      const delay = usingApiKey ? 5000 : 5 * 60 * 1000;
      console.log(`Retrying in ${delay/1000}s...`);
      liveChatId = null;
      setTimeout(pollChat, delay);
      return;
    }
    if (err.code === 403) console.error('API error 403:', err.message);
    else if (err.code === 404) { console.error('Live chat ended.'); liveChatId = null; }
    else console.error('Poll error:', err.message);
  }

  setTimeout(pollChat, POLL_INTERVAL);
}

// ─── Main ───
(async () => {
  await setupAuth();
  console.log(`Polling chat for video: ${VIDEO_ID}`);
  pollChat();

  wss.on('connection', ws => {
    console.log('Client connected');
    ws.send(JSON.stringify({ type: 'connected', message: 'YouTube Chat Bridge ready' }));
    // Rebroadcast incoming messages (e.g. from live-score-poller)
    ws.on('message', raw => {
      try {
        const data = JSON.parse(raw.toString());
        if (['score', 'goals', 'show-comment', 'hide-comment', 'youtube-chat'].includes(data.type)) {
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) client.send(raw.toString());
          });
          if (data.type !== 'youtube-chat') console.log('[Relay]', data.type, 'forwarded');
        }
      } catch (e) { /* ignore invalid JSON */ }
    });
  });

  console.log('Waiting for messages...');
})();
