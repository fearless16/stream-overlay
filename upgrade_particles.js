const fs = require('fs');

let js = fs.readFileSync('particles.js', 'utf8');

// 1. Add new futuristic particle types to the render loop
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

// Insert the new shapes before the final else block in BOTH renders
js = js.replace(/\} else if \(p\.t === 7\)[^}]+}[^}]+}/g, match => match + newShapes);
// I'll use a safer approach:
js = js.replace(/(}\s*else if\s*\(p\.t === 8\)\s*\{[\s\S]*?ctx\.restore\(\);\s*\})/g, `$1${newShapes}`);

// 2. Upgrade _scSpawnEvent (Events: 4, 6, Wickets)
js = js.replace(/t: \[0,0,0,0,1,4,5\]/g, "t: [9, 10, 11, 11, 1, 4]"); // Make 4 runs more cyber
js = js.replace(/t: \[0,0,0,0,1,4,5,6\]/g, "t: [9, 9, 10, 11, 11]"); // Make 6 runs more cyber
js = js.replace(/t: \[0,0,0,1,4,4,5\]/g, "t: [9, 10, 11, 11, 2, 7]"); // Wickets get rings and streaks

// Upgrade 4 runs explosion math (faster, bigger scatter)
js = js.replace(/sp: 3 \+ Math\.random\(\) \* 12/g, "sp: 5 + Math.random() * 20");
js = js.replace(/scatter: 40/g, "scatter: 80");

// Upgrade 6 runs explosion math
js = js.replace(/sp: 4 \+ Math\.random\(\) \* 14/g, "sp: 8 + Math.random() * 25");
js = js.replace(/scatter: 50/g, "scatter: 120");

// 3. Upgrade _msSpawnEvent (Milestones: 50, 100, Wicket Hauls)
// The milestones previously spawned generic confetti bursts. We want a massive cyber-bloom.
js = js.replace(/burst\(180[^;]+;/g, "burst(250, [C50[0], C50[2], '#fff'], { l: 4, sp: 8 + Math.random() * 20, g: 0.05, t: [9, 10, 11], scatter: 100 });"); // 50 bloom
js = js.replace(/burst\(220[^;]+;/g, "burst(350, [C100[1], C100[2], '#fff'], { l: 4.5, sp: 10 + Math.random() * 25, g: 0.05, t: [9, 10, 11], scatter: 150 });"); // 100 bloom
js = js.replace(/burst\(280[^;]+;/g, "burst(400, [C150[1], '#fff'], { l: 5, sp: 12 + Math.random() * 30, g: 0.05, t: [9, 10, 11], scatter: 200 });"); // 150 bloom

fs.writeFileSync('particles.js', js);
console.log('Particles upgraded to futuristic cyber-physics');
