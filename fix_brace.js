const fs = require('fs');
let js = fs.readFileSync('particles.js', 'utf8');
js = js.replace(/ctx\.restore\(\);\r?\n else \{/g, 'ctx.restore();\n    } else {');
fs.writeFileSync('particles.js', js);
console.log('Fixed missing closing brace');
