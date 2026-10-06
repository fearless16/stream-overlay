const fs = require('fs');

let chatHtml = fs.readFileSync('chat-overlay.html', 'utf8');
const particlesJS = fs.readFileSync('particles.js', 'utf8');

const startStr = 'function _scCanvasInit()';
const endStr = 'function _msDemoScore(';
const startIdx = chatHtml.indexOf(startStr);
const endIdx = chatHtml.indexOf(endStr);

if (startIdx !== -1 && endIdx !== -1) {
  chatHtml = chatHtml.substring(0, startIdx) + particlesJS + '\n' + chatHtml.substring(endIdx);
  fs.writeFileSync('chat-overlay.html', chatHtml);
  console.log('chat-overlay.html upgraded with futuristic particles!');
}
