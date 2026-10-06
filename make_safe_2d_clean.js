const fs = require('fs');

let css = fs.readFileSync('chat-overlay.html', 'utf8');

function replaceKeyframe(name, newContent) {
  const re = new RegExp('@keyframes\\\\s*' + name + '\\\\s*\\\\{[^}]+\\\\}', 'g');
  css = css.replace(re, newContent);
}

replaceKeyframe('a4', \`@keyframes a4_3d {
  0% { opacity: 0; transform: translateY(60px) scale(0.3) rotateX(40deg) rotateY(-20deg); }
  10% { opacity: 1; transform: translateY(-10px) scale(1.1) rotateX(-10deg) rotateY(10deg); }
  20% { transform: translateY(0) scale(0.95) rotateX(5deg) rotateY(-5deg); }
  30% { transform: translateY(0) scale(1) rotateX(0deg) rotateY(0deg); }
  75% { opacity: 1; transform: translateY(0) scale(1) rotateX(0deg) rotateY(0deg); }
  100% { opacity: 0; transform: translateY(-40px) scale(0.5) rotateX(-20deg) rotateY(15deg); }
}\`);

replaceKeyframe('a6', \`@keyframes a6_3d {
  0% { opacity: 0; transform: scale(1.8) rotateX(-60deg); }
  10% { opacity: 1; transform: scale(0.9) rotateX(15deg); }
  20% { transform: scale(1.05) rotateX(-5deg); }
  30% { transform: scale(1) rotateX(0deg); }
  75% { opacity: 1; transform: scale(1) rotateX(0deg); }
  100% { opacity: 0; transform: scale(0.5) rotateX(40deg); }
}\`);

replaceKeyframe('abold', \`@keyframes abold_3d {
  0% { opacity: 0; transform: scale(0.5) rotateY(-90deg); }
  15% { opacity: 1; transform: scale(1.1) rotateY(15deg); }
  25% { transform: scale(0.95) rotateY(-5deg); }
  35% { transform: scale(1) rotateY(0deg); }
  75% { opacity: 1; transform: scale(1) rotateY(0deg); }
  100% { opacity: 0; transform: scale(0.6) rotateY(90deg); }
}\`);

replaceKeyframe('acaught', \`@keyframes acaught_3d {
  0% { opacity: 0; transform: translateY(150px) scale(0.5) rotateX(-50deg); }
  12% { opacity: 1; transform: translateY(-20px) scale(1.1) rotateX(15deg); }
  22% { transform: translateY(10px) scale(0.95) rotateX(-5deg); }
  32% { transform: translateY(0) scale(1) rotateX(0deg); }
  75% { opacity: 1; transform: translateY(0) scale(1) rotateX(0deg); }
  100% { opacity: 0; transform: translateY(-100px) scale(0.6) rotateX(40deg); }
}\`);

replaceKeyframe('albw', \`@keyframes albw_3d {
  0% { opacity: 0; transform: scale(1.6) rotateX(60deg); }
  15% { opacity: 1; transform: scale(0.9) rotateX(-15deg); }
  25% { transform: scale(1.05) rotateX(5deg); }
  35% { transform: scale(1) rotateX(0deg); }
  75% { opacity: 1; transform: scale(1) rotateX(0deg); }
  100% { opacity: 0; transform: scale(0.6) rotateX(-40deg); }
}\`);

replaceKeyframe('arunout', \`@keyframes arunout_3d {
  0% { opacity: 0; transform: translateX(-200px) scale(0.5) rotateY(-50deg); }
  12% { opacity: 1; transform: translateX(20px) scale(1.1) rotateY(15deg); }
  22% { transform: translateX(-10px) scale(0.95) rotateY(-5deg); }
  32% { transform: translateX(0) scale(1) rotateY(0deg); }
  75% { opacity: 1; transform: translateX(0) scale(1) rotateY(0deg); }
  100% { opacity: 0; transform: translateX(200px) scale(0.6) rotateY(50deg); }
}\`);

replaceKeyframe('aduck', \`@keyframes aduck_3d {
  0% { opacity: 0; transform: translateY(-200px) scale(0.4) rotateZ(30deg); }
  12% { opacity: 1; transform: translateY(20px) scale(1.1) rotateZ(-10deg); }
  22% { transform: translateY(-10px) scale(0.95) rotateZ(5deg); }
  32% { transform: translateY(0) scale(1) rotateZ(0deg); }
  75% { opacity: 1; transform: translateY(0) scale(1) rotateZ(0deg); }
  100% { opacity: 0; transform: translateY(200px) scale(0.5) rotateZ(30deg); }
}\`);

replaceKeyframe('awicket', \`@keyframes awicket_3d {
  0% { opacity: 0; transform: scale(2) rotateX(-30deg) rotateY(30deg); }
  12% { opacity: 1; transform: scale(0.85) rotateX(10deg) rotateY(-10deg); }
  22% { transform: scale(1.05) rotateX(-5deg) rotateY(5deg); }
  32% { transform: scale(1) rotateX(0deg) rotateY(0deg); }
  75% { opacity: 1; transform: scale(1) rotateX(0deg) rotateY(0deg); }
  100% { opacity: 0; transform: scale(0.5) rotateX(45deg) rotateY(-45deg); }
}\`);

replaceKeyframe('msPop', \`@keyframes msPop {
  0% { opacity: 0; transform: scale(0.3) rotateX(-20deg) rotateY(15deg); }
  10% { opacity: 1; transform: scale(1.15) rotateX(10deg) rotateY(-5deg); }
  20% { transform: scale(0.95) rotateX(-5deg) rotateY(2deg); }
  30% { transform: scale(1) rotateX(0deg) rotateY(0deg); }
  75% { opacity: 1; transform: scale(1) rotateX(0deg) rotateY(0deg); }
  100% { opacity: 0; transform: scale(0.6) rotateX(20deg) rotateY(-15deg); }
}\`);

// Now replace animation names in the classes.
css = css.replace(/animation: a4 4s/g, 'animation: a4_3d 4s');
css = css.replace(/animation: a6 4s/g, 'animation: a6_3d 4s');
css = css.replace(/animation: abold 4s/g, 'animation: abold_3d 4s');
css = css.replace(/animation: acaught 4s/g, 'animation: acaught_3d 4s');
css = css.replace(/animation: albw 4s/g, 'animation: albw_3d 4s');
css = css.replace(/animation: arunout 4s/g, 'animation: arunout_3d 4s');
css = css.replace(/animation: aduck 4s/g, 'animation: aduck_3d 4s');
css = css.replace(/animation: awicket 4s/g, 'animation: awicket_3d 4s');

fs.writeFileSync('chat-overlay.html', css);
console.log('Fixed chat-overlay.html cleanly!');
