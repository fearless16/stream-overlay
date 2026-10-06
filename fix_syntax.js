const fs = require('fs');
let js = fs.readFileSync('particles.js', 'utf8');
js = js.replace(/}\n    } else if \(p\.t === 9\)/g, '} else if (p.t === 9)');
fs.writeFileSync('particles.js', js);
console.log('Fixed syntax error in particles.js');
