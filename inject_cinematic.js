const fs = require('fs');

let css = fs.readFileSync('chat-overlay.html', 'utf8');

const newEffectsCSS = `
/* ========================================================================= */
/* ================== TRUE CINEMATIC REDESIGN EFFECTS ====================== */
/* ========================================================================= */

/* 1. The Global Stream Dimmer */
body::after {
  content: "";
  position: absolute;
  top: 0; left: 0; width: 100vw; height: 100vh;
  background: radial-gradient(circle at center, transparent 30%, rgba(0,0,0,0.85) 100%);
  opacity: 0;
  pointer-events: none;
  z-index: 800; /* Behind scorecard, above chat */
  transition: opacity 0.3s cubic-bezier(0.16,1,0.3,1);
}
#scorecard[class*="sc-cricket-"] ~ body::after,
#scorecard[class*="sc-ms-"] ~ body::after {
  opacity: 1; /* Dim stream when active */
}

/* 2. Supersonic Impact Shockwave */
#scorecard::before {
  content: "";
  position: absolute;
  top: 50%; left: 50%;
  width: 10px; height: 10px;
  background: transparent;
  border: 10px solid rgba(255, 255, 255, 0);
  border-radius: 50%;
  transform: translate(-50%, -50%) scale(1);
  pointer-events: none;
  z-index: 10;
}
@keyframes cinematicShockwave {
  0% { transform: translate(-50%, -50%) scale(0.1); border-width: 40px; border-color: rgba(255, 255, 255, 0.8); box-shadow: 0 0 100px rgba(255,255,255,0.6); }
  20% { transform: translate(-50%, -50%) scale(15); border-width: 10px; border-color: rgba(255, 255, 255, 0.3); box-shadow: 0 0 50px rgba(255,255,255,0.2); }
  100% { transform: translate(-50%, -50%) scale(40); border-width: 0px; border-color: rgba(255, 255, 255, 0); box-shadow: 0 0 0px rgba(255,255,255,0); }
}
#scorecard[class*="sc-cricket-"]::before,
#scorecard[class*="sc-ms-"]::before {
  animation: cinematicShockwave 1.2s cubic-bezier(0.16,1,0.3,1) forwards;
}

/* 3. Rotating Stadium Spotlights Behind Scorecard */
#scorecard::after {
  content: "";
  position: absolute;
  top: -100%; left: -100%;
  width: 300%; height: 300%;
  background: conic-gradient(from 0deg, 
    transparent 0%, 
    rgba(255, 255, 255, 0.05) 5%, 
    rgba(255, 255, 255, 0.4) 10%, 
    rgba(255, 255, 255, 0.05) 15%, 
    transparent 20%, 
    transparent 50%, 
    rgba(255, 255, 255, 0.05) 55%, 
    rgba(255, 255, 255, 0.4) 60%, 
    rgba(255, 255, 255, 0.05) 65%, 
    transparent 70%
  );
  opacity: 0;
  pointer-events: none;
  z-index: -1;
}
@keyframes stadiumLights {
  0% { transform: rotate(0deg) scale(1); opacity: 0; }
  10% { opacity: 1; transform: rotate(20deg) scale(1.5); }
  90% { opacity: 1; }
  100% { transform: rotate(180deg) scale(2); opacity: 0; }
}
#scorecard[class*="sc-cricket-"]::after,
#scorecard[class*="sc-ms-"]::after {
  animation: stadiumLights 4s linear forwards;
}
#scorecard.sc-cricket-6::after { background: conic-gradient(from 0deg, transparent 0%, rgba(0, 255, 136, 0.5) 10%, transparent 20%, transparent 50%, rgba(0, 255, 136, 0.5) 60%, transparent 70%); }
#scorecard.sc-flash-wicket::after { background: conic-gradient(from 0deg, transparent 0%, rgba(255, 45, 85, 0.6) 10%, transparent 20%, transparent 50%, rgba(255, 45, 85, 0.6) 60%, transparent 70%); }

/* 4. Chromatic Aberration & Lens Flare Impact on the 3D Text */
@keyframes impactFlare {
  0% { filter: brightness(3) saturate(2) drop-shadow(0 0 100px #fff); transform: scale(0.5); }
  10% { filter: brightness(1.5) saturate(1.5) drop-shadow(0 0 40px #fff); transform: scale(1.15); }
  20% { filter: brightness(1) saturate(1) drop-shadow(0 0 0px transparent); transform: scale(0.95); }
  100% { filter: brightness(1) saturate(1) drop-shadow(0 0 0px transparent); transform: scale(1); }
}

/* Base style adjustments for the new effects */
#scorecard {
  z-index: 1000; /* Ensure scorecard is above the dimmer */
}
`;

// Inject the new effects CSS right before the closing style tag
if (!css.includes('cinematicShockwave')) {
    css = css.replace('</style>', newEffectsCSS + '\n</style>');
    fs.writeFileSync('chat-overlay.html', css);
    console.log('Cinematic redesign effects successfully injected into chat-overlay.html');
} else {
    console.log('Cinematic effects already present.');
}
