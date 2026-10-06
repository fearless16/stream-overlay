const fs = require('fs');
let js = fs.readFileSync('particles.js', 'utf8');

const newShapes = `
    } else if (p.t === 9) { // Cyber Hexagon
      ctx.strokeStyle = p.c; ctx.lineWidth = 2 + alpha * 2;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.beginPath();
      for (let j = 0; j < 6; j++) {
        ctx.lineTo(sz * 1.5 * Math.cos(j * Math.PI / 3), sz * 1.5 * Math.sin(j * Math.PI / 3));
      }
      ctx.closePath(); ctx.stroke(); ctx.restore();
    } else if (p.t === 10) { // Sci-Fi HUD Ring
      ctx.strokeStyle = p.c; ctx.lineWidth = 1 + alpha * 3;
      ctx.save(); ctx.translate(p.x, p.y);
      ctx.beginPath(); ctx.arc(0, 0, sz * 2, p.rot, p.rot + Math.PI * 1.2);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, sz * 1.2, -p.rot, -p.rot + Math.PI * 0.8);
      ctx.stroke();
      ctx.restore();
    } else if (p.t === 11) { // Laser Streak
      ctx.fillStyle = p.c;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.fillRect(-sz * 3, -sz * 0.2, sz * 6, sz * 0.4);
      ctx.restore();
`;

// Inject into _scRender right after t === 6
js = js.replace(/(}\s*else if\s*\(p\.t === 6\)\s*\{[\s\S]*?ctx\.restore\(\);\s*\})/g, `$1${newShapes}`);

fs.writeFileSync('particles.js', js);
console.log('Fixed scRender injection');
