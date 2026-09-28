const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const VIDEO_ID = process.env.VIDEO_ID;
let authCookies = process.env.YOUTUBE_COOKIES || '';

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml',
  'Origin': 'https://www.youtube.com',
  'Referer': `https://www.youtube.com/live_chat?v=${VIDEO_ID}`,
  'Cookie': authCookies
};

async function testScrape() {
  const url = `https://www.youtube.com/live_chat?v=${VIDEO_ID}`;
  console.log('Fetching', url);
  const res = await fetch(url, { headers: FETCH_HEADERS });
  const html = await res.text();
  fs.writeFileSync('test_html.txt', html);
  
  const match = html.match(/(?:var\s+)?(?:window\[")?ytInitialData(?:"\])?\s*=\s*({[\s\S]+?});\s*(?:\n|<)/);
  if (match) {
    fs.writeFileSync('test_initial.json', match[1]);
    
    const keyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
    const ctxMatch = html.match(/"INNERTUBE_CONTEXT"\s*:\s*({[\s\S]+?}),\s*"INNERTUBE_/);
    console.log('API Key:', keyMatch ? keyMatch[1] : null);
    console.log('Context:', ctxMatch ? 'FOUND' : null);
  } else {
    console.log('No initial data');
  }
}
testScrape();