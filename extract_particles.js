const fs = require('fs');
const chatHtml = fs.readFileSync('chat-overlay.html', 'utf8');

const startStr = 'function _scCanvasInit()';
const endStr = 'function _msDemoScore(';

const startIdx = chatHtml.indexOf(startStr);
const endIdx = chatHtml.indexOf(endStr);

if (startIdx !== -1 && endIdx !== -1) {
  const particlesJS = chatHtml.substring(startIdx, endIdx);
  fs.writeFileSync('particles.js', particlesJS);
  console.log('Successfully extracted particles.js');
} else {
  console.log('Failed to find particle engine boundaries.');
}
