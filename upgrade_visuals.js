const fs = require('fs');

let css = fs.readFileSync('chat-overlay.html', 'utf8');

// 1. Inject Google Fonts for futuristic typography
const fontImport = `@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@900&family=Montserrat:ital,wght@0,900;1,900&display=swap');\n`;
if (!css.includes('Orbitron')) {
  css = css.replace('<style>', '<style>\n' + fontImport);
}

// 2. Update base font families
css = css.replace(/font-family:\s*'Impact',\s*'Arial Black',\s*system-ui,\s*sans-serif;/g, 
  "font-family: 'Orbitron', 'Montserrat', 'Arial Black', sans-serif; text-transform: uppercase;");

// 3. Futuristic Color Grading & 3D Extrusion for Milestones

// 50: Cyan / Electric Blue (Cyberpunk)
const ms50CSS = `.sc-ms-item.sc-ms-50 {
  font-size: 150px; letter-spacing: 5px;
  background: linear-gradient(to bottom, #ffffff 0%, #b3e5fc 30%, #03a9f4 50%, #0277bd 51%, #00e5ff 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  text-shadow: 
    0px 1px 0px #01579b, 0px 2px 0px #014377, 0px 3px 0px #013259, 
    0px 4px 0px #01223d, 0px 5px 0px #001322, 
    0px 10px 20px rgba(0, 229, 255, 0.8), 0px 20px 40px rgba(0,0,0,0.9);
}`;
css = css.replace(/\.sc-ms-item\.sc-ms-50\s*\{[^}]+\}/, ms50CSS);

// 100: Gold / Plasma (Champion)
const ms100CSS = `.sc-ms-item.sc-ms-100 {
  font-size: 138px; letter-spacing: 5px;
  background: linear-gradient(to bottom, #ffffff 0%, #fff9c4 30%, #ffd600 50%, #f57f17 51%, #ffea00 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  text-shadow: 
    0px 1px 0px #b28900, 0px 2px 0px #997500, 0px 3px 0px #806200, 
    0px 4px 0px #664e00, 0px 5px 0px #4d3b00, 
    0px 10px 20px rgba(255, 214, 0, 0.8), 0px 20px 40px rgba(0,0,0,0.9);
}`;
css = css.replace(/\.sc-ms-item\.sc-ms-100\s*\{[^}]+\}/, ms100CSS);

// 150: Neon Purple / Pink (Synthwave)
const ms150CSS = `.sc-ms-item.sc-ms-150 {
  font-size: 138px; letter-spacing: 5px;
  background: linear-gradient(to bottom, #ffffff 0%, #f3e5f5 30%, #d500f9 50%, #aa00ff 51%, #ff00ea 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  text-shadow: 
    0px 1px 0px #6a0080, 0px 2px 0px #550066, 0px 3px 0px #40004d, 
    0px 4px 0px #2a0033, 0px 5px 0px #15001a, 
    0px 10px 20px rgba(213, 0, 249, 0.8), 0px 20px 40px rgba(0,0,0,0.9);
}`;
css = css.replace(/\.sc-ms-item\.sc-ms-150\s*\{[^}]+\}/, ms150CSS);

// 200: Platinum / Diamond (Hyper-modern)
const ms200CSS = `.sc-ms-item.sc-ms-200, .sc-ms-item.sc-ms-250 {
  font-size: 138px; letter-spacing: 5px;
  background: linear-gradient(to bottom, #ffffff 0%, #e0f7fa 30%, #00e5ff 50%, #00b8d4 51%, #b2ebf2 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  text-shadow: 
    0px 1px 0px #006064, 0px 2px 0px #004d40, 0px 3px 0px #00332c, 
    0px 4px 0px #001a16, 0px 5px 0px #000000, 
    0px 10px 20px rgba(0, 229, 255, 0.9), 0px 20px 50px rgba(255,255,255,0.4);
}`;
css = css.replace(/\.sc-ms-item\.sc-ms-200\s*\{[^}]+\}/, ms200CSS);
css = css.replace(/\.sc-ms-item\.sc-ms-250\s*\{[^}]+\}/, ""); // Merged with 200

// Hauls (Wickets)
const msHaulCSS = `.sc-ms-item.sc-ms-3, .sc-ms-item.sc-ms-4, .sc-ms-item.sc-ms-5 {
  font-size: 138px; letter-spacing: 5px;
  background: linear-gradient(to bottom, #ffffff 0%, #ffcdd2 30%, #ff1744 50%, #d50000 51%, #ff5252 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  text-shadow: 
    0px 1px 0px #8e0000, 0px 2px 0px #730000, 0px 3px 0px #590000, 
    0px 4px 0px #400000, 0px 5px 0px #260000, 
    0px 10px 20px rgba(255, 23, 68, 0.8), 0px 20px 40px rgba(0,0,0,0.9);
}`;
css = css.replace(/\.sc-ms-item\.sc-ms-3\s*\{[^}]+\}/, msHaulCSS);
css = css.replace(/\.sc-ms-item\.sc-ms-4\s*\{[^}]+\}/, "");
css = css.replace(/\.sc-ms-item\.sc-ms-5\s*\{[^}]+\}/, "");

// 4. Update the "CONGRATULATIONS" sub-text to look like a Sci-Fi HUD element
const congratsCSS = `#scorecard .sc-ms-congrats-line {
  position: relative;
  flex-shrink: 0;
  margin-top: 18px;
  font-family: 'Orbitron', 'Montserrat', sans-serif;
  font-size: 28px; font-weight: 900; letter-spacing: 12px; line-height: 1;
  color: #fff;
  text-transform: uppercase;
  background: none;
  -webkit-background-clip: initial; -webkit-text-fill-color: initial; background-clip: initial;
  text-shadow: 0 0 10px rgba(255,255,255,0.8), 0 0 20px rgba(255,255,255,0.4);
  border-top: 2px solid rgba(255,255,255,0.5);
  border-bottom: 2px solid rgba(255,255,255,0.5);
  padding: 10px 0;
  box-shadow: 0 5px 15px rgba(0,0,0,0.5);
}`;
css = css.replace(/#scorecard \.sc-ms-congrats-line\s*\{[\s\S]*?\}(?=\s*[\/*\.#@])/m, congratsCSS);

// 5. Add a "Cyber Glitch / Shine" animation for the text
const shineCSS = `
/* Holographic Sweep */
#scorecard .sc-ms-item::after, #scorecard .sc-anim-item::after {
  content: "";
  position: absolute;
  top: 0; left: -100%;
  width: 50%; height: 100%;
  background: linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.8) 50%, rgba(255,255,255,0) 100%);
  transform: skewX(-25deg);
  animation: cyberShine 4s infinite;
  pointer-events: none;
  z-index: 10;
}
@keyframes cyberShine {
  0% { left: -100%; }
  15% { left: 200%; }
  100% { left: 200%; }
}
`;

if (!css.includes('cyberShine')) {
    css = css.replace('/* ================== SAFE 2.5D HARDWARE ANIMATIONS ================== */', shineCSS + '\n/* ================== SAFE 2.5D HARDWARE ANIMATIONS ================== */');
}

// 6. Overhaul 4 and 6 typography to match the futuristic vision
const fourCSS = `#scorecard.sc-cricket-4 .sc-anim-4 {
  display: block; font-size: 140px; letter-spacing: 5px;
  background: linear-gradient(to bottom, #ffffff 0%, #ff80ab 30%, #ff1744 50%, #d50000 51%, #ff5252 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  text-shadow: 
    0px 1px 0px #8e0000, 0px 2px 0px #730000, 0px 3px 0px #590000, 
    0px 4px 0px #400000, 0px 5px 0px #260000, 
    0px 10px 20px rgba(255, 23, 68, 0.8), 0px 20px 40px rgba(0,0,0,0.9);
  animation: a4_3d 4s cubic-bezier(0.16,1,0.3,1) forwards;
}`;
css = css.replace(/#scorecard\.sc-cricket-4 \.sc-anim-4\s*\{[^}]+\}/, fourCSS);

const sixCSS = `#scorecard.sc-cricket-6 .sc-anim-6 {
  display: block; font-size: 160px; letter-spacing: 8px;
  background: linear-gradient(to bottom, #ffffff 0%, #b9f6ca 30%, #00e676 50%, #00c853 51%, #69f0ae 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  text-shadow: 
    0px 1px 0px #006b2b, 0px 2px 0px #005422, 0px 3px 0px #003e19, 
    0px 4px 0px #002810, 0px 5px 0px #001207, 
    0px 10px 20px rgba(0, 230, 118, 0.8), 0px 20px 40px rgba(0,0,0,0.9);
  animation: a6_3d 4s cubic-bezier(0.16,1,0.3,1) forwards;
}`;
css = css.replace(/#scorecard\.sc-cricket-6 \.sc-anim-6\s*\{[^}]+\}/, sixCSS);

fs.writeFileSync('chat-overlay.html', css);
console.log('Visual typography and color grading completely redesigned.');
