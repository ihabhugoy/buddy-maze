// Buddy's card packs: a holographic foil pack drops into a calm pale studio (like the Pokemon packs' screen), a little hand shows how to swipe
// its top seal, and the swipe (or a tap) tears it open: the strip flies off, the cards slide out face-down and flip
// over in a pillar of their own color, then the game's candy buttons ask what's next. It's its own overlay with its
// own CSS, so main.js only calls open() and waits for the answer.
const STAR4 = 'M12 0C13 8 16 11 24 12 16 13 13 16 12 24 11 16 8 13 0 12 8 11 11 8 12 0z'; // a soft 4-point sparkle
const SPRING = 'cubic-bezier(.25, 1.35, .45, 1)', GLIDE = 'cubic-bezier(.2, .8, .3, 1)';
// where a card sits, in card widths from the middle of the stage: x, y, scale, tilt (deg)
const SPOT = {
  inside: { x: 0, y: 0.12, s: 0.85, r: 0 }, // tucked in the pack, behind its front
  out: { x: 0, y: -0.55, s: 0.85, r: 0 }, // slid up out of the torn top
  out2: { x: 0.07, y: -0.43, s: 0.82, r: 5 },
  center: { x: 0, y: 0, s: 1, r: 0 },
  behind: { x: 0.09, y: -0.03, s: 0.93, r: 5 }, // the second card waiting under the first
  away: { x: -1.5, y: 0.08, s: 0.7, r: -14 }, // the first card stepping aside for the second
  left: { x: -0.56, y: 0, s: 0.84, r: -3 },
  right: { x: 0.56, y: 0, s: 0.84, r: 3 },
};
// foil colors: common = candy green, rare = pearly white (an iridescent film moves over it)
const FOIL = {
  common: { top: '#c8f7ec', mid: '#7fdccf', low: '#46aebd', seal: '#a6ece0', sealLow: '#5cbcc6', dots: '#f0fffb', rim: '#e6fffa', jelly: ['#fff1b8', '#ffc85a', '#f0962a'], starShade: '#2f7f8f' },
  rare: { top: '#f3f1fb', mid: '#d3cdee', low: '#aaa2d8', seal: '#ece8fa', sealLow: '#c3bce6', dots: '#ffffff', rim: '#ffffff', jelly: ['#fff1b8', '#ffc85a', '#f0962a'], starShade: '#5a3cb8' },
};
const TEAR = 15; // % of the pack's height where the top strip tears off (just under the seal)
let packCount = 0, active = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

// crimped seal edge: teeth from xa to xb, pointing from the base line out to the tip line
function teeth(xa, xb, base, tip, n = 17) {
  const w = (xb - xa) / n, ctrl = base + (tip - base) * 1.9; let d = '';
  for (let i = 0; i < n; i++) d += ` Q${(xa + w * (i + 0.5)).toFixed(1)} ${ctrl.toFixed(1)} ${(xa + w * (i + 1)).toFixed(1)} ${base}`;
  return d;
}
function star5(cx, cy, R, r) {
  let d = '';
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r : R; d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * q).toFixed(1)} ${(cy + Math.sin(a) * q).toFixed(1)}`; }
  return d + 'Z';
}
// the pack itself (viewBox 200 x 280): crimped seals with a dotted seal line, glossy foil with a diagonal swirl band,
// and a gold-framed jelly emblem holding a star. Drawn twice (top strip + body), so ids carry a per-copy prefix.
const OUTLINE = `M3 11${teeth(3, 197, 11, 4)} L197 32 Q197 37 191 39 C195 100 195 180 191 241 Q197 243 197 248 L197 269${teeth(197, 3, 269, 276)} L3 248 Q3 243 9 241 C5 180 5 100 9 39 Q3 37 3 32Z`;
// the holo foil is masked to the pack's own outline (the same path, stretched over the same box)
const svgUrl = body => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 280' preserveAspectRatio='none'>${body}</svg>`)}") 0 0 / 100% 100% no-repeat`;
const FOIL_MASK = svgUrl(`<path d='${OUTLINE}'/>`), EMBLEM_HOLE = svgUrl(`<rect x='58' y='94' width='84' height='92' rx='25'/>`);
function packSvg(u, rare) {
  const P = rare ? FOIL.rare : FOIL.common;
  const outline = OUTLINE;
  const star = star5(100, 141, 23, 10.5); // (a little sparkle star on the paw coin)
  return `<svg class="pk-svg" viewBox="0 0 200 280" aria-hidden="true"><defs>
<linearGradient id="${u}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.top}"/><stop offset=".45" stop-color="${P.mid}"/><stop offset="1" stop-color="${P.low}"/></linearGradient>
<linearGradient id="${u}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.seal}"/><stop offset="1" stop-color="${P.sealLow}"/></linearGradient>
<linearGradient id="${u}x" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".15" stop-color="#fff" stop-opacity="0"/><stop offset=".78" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${rare ? 0.1 : 0.2}"/></linearGradient>
<linearGradient id="${u}d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="${rare ? 0.08 : 0.16}"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
<linearGradient id="${u}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6be"/><stop offset=".42" stop-color="#ffd34f"/><stop offset=".8" stop-color="#e59f22"/><stop offset="1" stop-color="#c98118"/></linearGradient>
<linearGradient id="${u}j" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="${P.jelly[0]}"/><stop offset=".5" stop-color="${P.jelly[1]}"/><stop offset="1" stop-color="${P.jelly[2]}"/></linearGradient>
<linearGradient id="${u}w" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="${u}i" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffa8d6" stop-opacity=".9"/><stop offset=".22" stop-color="#ffffff" stop-opacity=".2"/><stop offset=".4" stop-color="#a6d6ff"/><stop offset=".58" stop-color="#ffffff" stop-opacity=".2"/><stop offset=".76" stop-color="#cdb5ff"/><stop offset="1" stop-color="#b5f0db" stop-opacity=".9"/></linearGradient>
<pattern id="${u}c" width="4" height="40" patternUnits="userSpaceOnUse"><rect width="1.3" height="40" fill="#fff" fill-opacity=".2"/><rect x="2.3" width=".9" height="40" fill="#000" fill-opacity="${rare ? 0.03 : 0.05}"/></pattern>
<clipPath id="${u}k"><path d="${outline}"/></clipPath></defs>
<path d="${outline}" fill="url(#${u}f)"/>
<g clip-path="url(#${u}k)">
${rare ? `<rect class="pk-iri" x="-200" y="-160" width="600" height="600" fill="url(#${u}i)" opacity=".8"/>` : ''}
<rect width="200" height="35" fill="url(#${u}s)"/><rect y="245" width="200" height="35" fill="url(#${u}s)"/>
<rect y="8" width="200" height="25" fill="url(#${u}c)"/><rect y="247" width="200" height="25" fill="url(#${u}c)"/>
<path d="M-30 262C40 178 146 214 236 30" stroke="#fff" stroke-opacity="${rare ? 0.45 : 0.2}" stroke-width="36" fill="none" stroke-linecap="round"/>
<ellipse cx="100" cy="141" rx="86" ry="52" transform="rotate(-48 100 141)" fill="none" stroke="#fff" stroke-opacity="${rare ? 0.4 : 0.22}" stroke-width="15"/>
<rect y="34" width="200" height="14" fill="url(#${u}d)"/><rect y="232" width="200" height="14" fill="url(#${u}d)" transform="rotate(180 100 239)"/>
<rect width="200" height="280" fill="url(#${u}x)"/>
<rect x="19" y="46" width="9" height="186" rx="4.5" fill="#fff" opacity=".32"/>
<g transform="skewX(-18)"><rect class="pk-sweep" x="-80" y="-10" width="44" height="300" fill="url(#${u}w)"/></g>
</g>
<line x1="12" y1="24.5" x2="190" y2="24.5" stroke="${P.dots}" stroke-opacity=".9" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="0 7.4"/>
<line x1="12" y1="256" x2="190" y2="256" stroke="${P.dots}" stroke-opacity=".9" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="0 7.4"/>
<rect x="60" y="100" width="80" height="88" rx="24" fill="#000" opacity=".16"/>
<rect x="60" y="96" width="80" height="88" rx="24" fill="url(#${u}g)"/>
<rect x="61.5" y="97.5" width="77" height="85" rx="22.5" fill="none" stroke="#fffbe0" stroke-opacity=".8" stroke-width="1.6"/>
<rect x="68" y="104" width="64" height="72" rx="17" fill="url(#${u}j)"/>
<rect x="68" y="104" width="64" height="72" rx="17" fill="none" stroke="#7a4a0c" stroke-opacity=".22" stroke-width="2"/>
<circle cx="100" cy="143" r="25" fill="#7a4a12" opacity=".22"/>
<g fill="#6b3f17" opacity=".92"><ellipse cx="100" cy="149" rx="11.5" ry="9.5"/><ellipse cx="86" cy="134" rx="4.6" ry="6" transform="rotate(-20 86 134)"/><ellipse cx="95" cy="127.5" rx="4.6" ry="6.2" transform="rotate(-6 95 127.5)"/><ellipse cx="105" cy="127.5" rx="4.6" ry="6.2" transform="rotate(6 105 127.5)"/><ellipse cx="114" cy="134" rx="4.6" ry="6" transform="rotate(20 114 134)"/></g>
<path d="${star}" transform="translate(16 20) scale(.32)" fill="#fffdf0" opacity=".9"/>
<path d="M76 121c1-7 6-11 13-11.5" stroke="#fff" stroke-opacity=".75" stroke-width="4" stroke-linecap="round" fill="none"/>
<path d="${outline}" fill="none" stroke="${P.rim}" stroke-opacity=".55" stroke-width="1.6"/>
</svg>`;
}
// a cartoon pointing hand (outline pass under a fill pass, so the shapes merge into one silhouette)
const HAND = (() => {
  const parts = '<rect x="20" y="3" width="13" height="40" rx="6.5"/><rect x="14" y="29" width="38" height="36" rx="15"/><rect x="32" y="26" width="10.5" height="19" rx="5.2"/><rect x="41.5" y="29.5" width="10" height="17" rx="5"/><rect x="5" y="36" width="21" height="11" rx="5.5" transform="rotate(32 15 41)"/><rect x="19" y="58" width="28" height="15" rx="5"/>';
  return `<svg viewBox="0 0 60 76" aria-hidden="true"><g fill="#8a5a3c" stroke="#8a5a3c" stroke-width="5" stroke-linejoin="round">${parts}</g><g fill="#ffe3c8">${parts}</g>
<rect x="19" y="58" width="28" height="15" rx="5" fill="#7fb6f2"/><rect x="19" y="58" width="28" height="4" rx="2" fill="#a9d0ff"/>
<path d="M37 28v9M46.5 32v8" stroke="#e2b994" stroke-width="2.2" stroke-linecap="round"/><rect x="23" y="6" width="5" height="9" rx="2.5" fill="#fff" opacity=".6"/></svg>`;
})();

const CSS = `
.pk-layer { position: fixed; inset: 0; z-index: 40; display: grid; grid-template-rows: auto auto auto auto; grid-template-areas: "head" "stage" "info" "acts";
  justify-items: center; align-content: center; row-gap: 1vh; padding: max(14px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom)); overflow: hidden; outline: none;
  touch-action: none; user-select: none; -webkit-user-select: none; color: #fff; font-family: "Nunito", ui-rounded, system-ui, sans-serif; font-weight: 800;
  --cw: min(27vh, 44vw, 240px); --ch: calc(var(--cw) * 1.389); --deep: #6f7fb2; animation: pk-fade-in .35s ease-out both; }
.pk-layer.out { animation: pk-fade-out .28s ease-in forwards; pointer-events: none; }
.pk-bg { position: absolute; inset: 0; z-index: 0; /* a calm studio like the Pokemon packs' screen: pale lavender-blue, a soft floor glow, no rays */
  background: radial-gradient(70% 38% at 50% 92%, rgba(255,255,255,.95), rgba(255,255,255,0) 70%), linear-gradient(180deg, #e9eefb 0%, #dde4f6 48%, #cdd6ef 100%); }
.pk-layer.rare .pk-bg { background: radial-gradient(70% 38% at 50% 92%, rgba(255,255,255,.95), rgba(255,255,255,0) 70%), linear-gradient(180deg, #f1ecfb 0%, #e3dcf6 48%, #d3cbef 100%); }
.pk-rays, .pk-mote { display: none; }
.pk-mote { position: absolute; z-index: 0; bottom: -20px; width: var(--m); height: var(--m); border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,.9), rgba(200,225,255,.35) 55%, rgba(200,225,255,0) 72%);
  animation: pk-mote var(--d) linear var(--w) infinite; }
.pk-head, .pk-stage, .pk-info, .pk-acts { position: relative; z-index: 1; }
.pk-head { grid-area: head; text-align: center; animation: pk-drop-in .6s ${SPRING} .1s both; }
.pk-title { margin: 0; font-family: var(--title, "Bagel Fat One", sans-serif); font-weight: 400; font-size: clamp(28px, 5.6vh, 46px); line-height: 1.05; letter-spacing: .01em; color: #fff;
  text-shadow: 0 3px 0 var(--deep), 2px 2px 0 var(--deep), -2px 2px 0 var(--deep), 2px -1px 0 var(--deep), -2px -1px 0 var(--deep), 0 8px 18px rgba(60,35,10,.35); }
.pk-sub { margin: 4px 0 0; color: #5d6a8f; font-size: clamp(14px, 2.2vh, 18px); }
.pk-rarity { display: inline-block; margin-bottom: 6px; padding: 3px 14px 4px; border-radius: 999px; font-size: 13px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; color: #5a3cb8;
  background: linear-gradient(100deg, #ffd1ea, #cfe8ff 40%, #e2d4ff 70%, #d3f7ea); box-shadow: inset 0 -3px 0 rgba(90,60,184,.18), 0 4px 12px rgba(10,20,70,.25); }
.pk-stage { grid-area: stage; width: 100%; height: calc(var(--cw) * 1.72); }
.pk-anchor { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
.pk-rays { position: absolute; width: 150vmax; height: 150vmax; left: -75vmax; top: -75vmax; opacity: .85; animation: pk-fade-in .8s ease-out both, pk-spin 60s linear infinite; }
.pk-halo { position: absolute; width: calc(var(--cw) * 3.4); height: calc(var(--cw) * 3.4); left: calc(var(--cw) * -1.7); top: calc(var(--cw) * -1.7); border-radius: 50%;
  background: radial-gradient(circle, rgba(255,240,190,.42), rgba(255,240,190,.12) 42%, rgba(255,240,190,0) 68%); animation: pk-fade-in .8s ease-out both; }
.pk-layer.rare .pk-halo { background: radial-gradient(circle, rgba(255,225,250,.5), rgba(200,215,255,.16) 42%, rgba(200,215,255,0) 68%); }

/* the pack: drops in on a spring, then idles with a little wobble */
.pk-pack { position: absolute; width: calc(var(--cw) * 1.12); height: calc(var(--cw) * 1.568); left: calc(var(--cw) * -.56); top: calc(var(--cw) * -.784); z-index: 4;
  animation: pk-pack-drop .9s both; }
.pk-pack.gone { animation: pk-pack-sink .55s cubic-bezier(.5, 0, .8, .4) forwards; }
.pk-shadow { position: absolute; left: 6%; right: 6%; bottom: -9%; height: 12%; border-radius: 50%; background: radial-gradient(closest-side, rgba(70,80,130,.3), rgba(8,20,60,0)); }
.pk-wob { position: absolute; inset: 0; }
.pk-pack.idle .pk-wob { animation: pk-idle 2.6s ease-in-out infinite; }
.pk-pack.tear .pk-wob { animation: pk-shake .34s linear; }
.pk-pack.torn .pk-wob { animation: pk-squash .45s ${SPRING}; }
.pk-glow { position: absolute; left: -45%; right: -45%; top: -32%; bottom: -32%; border-radius: 50%; background: radial-gradient(closest-side, rgba(255,246,200,.75), rgba(255,236,160,.25) 45%, rgba(255,236,160,0)); animation: pk-breathe 2.6s ease-in-out infinite; }
.pk-layer.rare .pk-glow { background: radial-gradient(closest-side, rgba(255,235,255,.85), rgba(210,200,255,.3) 45%, rgba(210,200,255,0)); }
.pk-pack.torn .pk-glow { animation: pk-fade-out .4s forwards; }
.pk-half { position: absolute; inset: 0; }
.pk-half svg { display: block; width: 100%; height: 100%; overflow: visible; }
.pk-body { visibility: hidden; }
.pk-pack.torn .pk-body { visibility: visible; }
.pk-pack.torn .pk-top { animation: pk-strip-fly .85s cubic-bezier(.2, .75, .35, 1) forwards; }
.pk-sweep { animation: pk-sweep 3.4s ease-in-out 1s infinite; }
/* holographic foil, the web way: a rainbow band and glitter that slide with the pointer (--hx/--hy), fine diffraction
   lines, and a glare spot where the light hits (--gx/--gy). Without a pointer (phones) the light drifts on its own */
.pk-pack { perspective: 900px; --hx: 50%; --hy: 50%; --gx: 35%; --gy: 25%; }
.pk-wob { transition: rotate .25s ease-out; }
.pk-foil, .pk-glare { position: absolute; inset: 0; pointer-events: none; -webkit-mask: ${FOIL_MASK}; mask: ${FOIL_MASK}; }
.pk-foil { -webkit-mask: ${FOIL_MASK}, ${EMBLEM_HOLE}; -webkit-mask-composite: xor; mask: ${FOIL_MASK}, ${EMBLEM_HOLE}; mask-composite: exclude; } /* (the paw coin stays crisp) */
.pk-foil { mix-blend-mode: hard-light; opacity: .55;
  background-image: var(--glitter, none),
    repeating-linear-gradient(115deg, #ff5c9a 0%, #ffc44d 6%, #5cf5a8 12%, #3cc8ff 18%, #a274ff 24%, #ff5c9a 30%),
    repeating-linear-gradient(-45deg, rgba(255,255,255,0) 0 5px, rgba(255,255,255,.2) 5px 6px);
  background-size: 140px 140px, 400% 400%, 100% 100%;
  background-position: var(--gx) var(--gy), var(--hx) var(--hy), 0 0;
  animation: pk-holo-drift 7s ease-in-out infinite alternate; }
.pk-layer.rare .pk-foil { opacity: .75; }
.pk-glare { mix-blend-mode: overlay; opacity: .75;
  background: radial-gradient(farthest-corner circle at var(--gx) var(--gy), rgba(255,255,255,.85) 0%, rgba(255,255,255,.2) 28%, rgba(0,0,0,.22) 95%); }
.pk-pack.aim .pk-foil { animation: none; } /* (the pointer leads the light) */
@keyframes pk-holo-drift { 0% { background-position: 0% 10%, 0% 0%, 0 0; } 100% { background-position: 100% 90%, 100% 100%, 0 0; } }
.pk-iri { animation: pk-iri 5s ease-in-out infinite alternate; }
.pk-spk { position: absolute; width: var(--z); height: var(--z); margin: calc(var(--z) / -2) 0 0 calc(var(--z) / -2); fill: #fff; filter: drop-shadow(0 0 4px rgba(255,255,255,.9));
  animation: pk-twinkle 1.9s ease-in-out var(--w) infinite; }
.pk-pack.torn .pk-spk { animation: pk-fade-out .25s forwards; }
.pk-slice { position: absolute; left: -4%; right: -4%; top: calc(${TEAR}% - 2px); height: 4px; border-radius: 4px; opacity: 0; transform-origin: var(--from, left) 50%;
  background: linear-gradient(90deg, rgba(255,255,255,0), #fff 12%, #fff 88%, rgba(255,255,255,0)); box-shadow: 0 0 10px 3px rgba(255,244,200,.9), 0 0 26px 8px rgba(255,230,150,.5); }
.pk-pack.tear .pk-slice { animation: pk-slice .6s ease-out forwards; }
.pk-mouth { position: absolute; left: 4%; right: 4%; top: calc(${TEAR}% - 9%); height: 18%; border-radius: 50%; opacity: 0;
  background: radial-gradient(closest-side, rgba(255,255,255,.95), rgba(255,240,180,.55) 45%, rgba(255,240,180,0)); }
.pk-pack.torn .pk-mouth { animation: pk-mouth 1.6s ease-out forwards; }

/* the swipe hint: a hand drags across the top seal under a little label */
.pk-hint { position: absolute; left: 0; top: calc(var(--cw) * .9); z-index: 7; transform: translateX(-50%); white-space: nowrap; pointer-events: none; opacity: 0;
  font-family: var(--title, "Bagel Fat One", sans-serif); font-weight: 400; font-size: clamp(20px, 3.8vh, 30px); color: #fff;
  text-shadow: 0 3px 0 var(--deep), 2px 2px 0 var(--deep), -2px 2px 0 var(--deep), 2px -1px 0 var(--deep), -2px -1px 0 var(--deep); }
.pk-hint span { display: inline-block; }
.pk-layer.hinted .pk-hint { animation: pk-hint-in .5s ${SPRING} both; }
.pk-layer.hinted .pk-hint span { animation: pk-bob 1.4s ease-in-out .5s infinite; }
.pk-hand { position: absolute; z-index: 8; width: calc(var(--cw) * .42); left: calc(var(--cw) * -.185); top: calc(var(--cw) * -.63); pointer-events: none; opacity: 0;
  transform-origin: 34% 4%; filter: drop-shadow(0 6px 6px rgba(60,35,10,.35)); }
.pk-hand svg { display: block; width: 100%; }
.pk-layer.hinted .pk-hand { animation: pk-hand 1.9s ease-in-out .25s infinite; }
.pk-trail { position: absolute; z-index: 6; left: calc(var(--cw) * -.42); width: calc(var(--cw) * .88); top: calc(var(--cw) * -.615); height: 6px; border-radius: 6px; opacity: 0; transform-origin: left center; pointer-events: none;
  background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.95)); }
.pk-layer.hinted .pk-trail { animation: pk-trail 1.9s ease-in-out .25s infinite; }
.pk-layer.opened :is(.pk-hint, .pk-hand, .pk-trail) { visibility: hidden; }

/* light: a burst where the pack tears, sparkle confetti, a quick screen flash */
.pk-burst { position: absolute; z-index: 6; width: calc(var(--cw) * 1.5); height: calc(var(--cw) * 1.5); left: calc(var(--cw) * -.75); top: calc(var(--cw) * -1.3); border-radius: 50%; pointer-events: none;
  background: radial-gradient(closest-side, #fff, rgba(255,246,200,.85) 30%, rgba(255,226,140,.3) 62%, rgba(255,226,140,0)); animation: pk-burst .75s ease-out forwards; }
.pk-burst.ring { background: radial-gradient(closest-side, rgba(255,255,255,0) 58%, rgba(255,255,255,.9) 70%, rgba(255,200,240,.5) 80%, rgba(190,220,255,0)); animation-duration: .9s; }
.pk-bit { position: absolute; z-index: 9; left: 0; top: 0; width: var(--z); height: var(--z); margin: calc(var(--z) / -2) 0 0 calc(var(--z) / -2); pointer-events: none; opacity: 0;
  animation: pk-bit var(--d) cubic-bezier(.12, .75, .3, 1) var(--w, 0s) forwards; }
.pk-bit svg { display: block; width: 100%; height: 100%; fill: var(--c); }
.pk-bit.dot { border-radius: 50%; background: var(--c); }
.pk-bit.rib { width: calc(var(--z) * .5); border-radius: 3px; background: var(--c); }
.pk-flash { position: absolute; inset: 0; z-index: 5; background: #fff; pointer-events: none; opacity: 0; animation: pk-flash .5s ease-out forwards; }

/* cards: a flip in 3D from the back to the face, with a pillar of light in the card's color behind */
.pk-card, .pk-beam { transition: transform var(--t, .6s) var(--e, ${SPRING}), opacity .35s; }
.pk-card { position: absolute; width: var(--cw); height: var(--ch); left: calc(var(--cw) * -.5); top: calc(var(--ch) * -.5); opacity: 0;
  transform: translate(calc(var(--x) * var(--cw)), calc(var(--y) * var(--cw))) rotate(calc(var(--r) * 1deg)) scale(var(--s)); }
.pk-card.shown { opacity: 1; }
.pk-card.hide { opacity: 0; }
.pk-cshadow { position: absolute; left: 8%; right: 8%; bottom: -7%; height: 10%; border-radius: 50%; background: radial-gradient(closest-side, rgba(70,80,130,.32), rgba(8,20,60,0)); }
.pk-float { position: absolute; inset: 0; perspective: 900px; }
.pk-card.lit .pk-float { animation: pk-float 3.4s ease-in-out .9s infinite; }
.pk-spin { position: absolute; inset: 0; transform-style: preserve-3d; transform: rotateY(180deg); }
.pk-card.charge .pk-spin { animation: pk-charge .42s ease-in-out; }
.pk-card.flip .pk-spin { animation: pk-flip .8s cubic-bezier(.3, .8, .35, 1) both; }
.pk-face { position: absolute; inset: 0; border-radius: 9% / 6.5%; overflow: hidden; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.pk-face img { display: block; width: 100%; height: 100%; pointer-events: none; -webkit-user-drag: none; }
.pk-back { transform: rotateY(180deg); }
.pk-gloss { position: absolute; top: -10%; bottom: -10%; left: 0; width: 45%; transform: translateX(-130%) skewX(-16deg); background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.75), rgba(255,255,255,0)); }
.pk-card.lit .pk-gloss { animation: pk-gloss 1.1s ease-in-out .15s both; }
.pk-holo { position: absolute; left: -60%; top: -60%; width: 220%; height: 220%; opacity: 0; pointer-events: none;
  background: linear-gradient(125deg, rgba(255,160,220,0) 30%, rgba(255,160,220,.4) 38%, rgba(160,215,255,.42) 46%, rgba(200,170,255,.4) 54%, rgba(170,255,220,.35) 60%, rgba(170,255,220,0) 68%); }
.pk-layer.rare .pk-card.lit .pk-holo { animation: pk-holo 3.2s ease-in-out .4s infinite; }
.pk-cflash { position: absolute; inset: -2%; border-radius: 10% / 7%; background: #fff; opacity: 0; pointer-events: none; }
.pk-card.lit .pk-cflash { animation: pk-cflash .5s ease-out both; }
.pk-new { position: absolute; z-index: 2; left: -9%; top: 3%; padding: .12em .5em .18em; border-radius: 10px; opacity: 0; pointer-events: none;
  font-family: var(--title, "Bagel Fat One", sans-serif); font-weight: 400; font-size: calc(var(--cw) * .13); letter-spacing: .03em; color: #fff;
  background: linear-gradient(180deg, #ffa3c9, #f27ba6 55%, #e55d93); box-shadow: inset 0 -3px 0 #c9467b, 0 4px 10px rgba(120,20,70,.35); text-shadow: 0 2px 0 rgba(150,30,80,.35); }
.pk-card.isnew .pk-new { animation: pk-new .55s ${SPRING} both; }
.pk-label { position: absolute; left: 50%; top: 104%; white-space: nowrap; transform: translateX(-50%); opacity: 0;
  font-family: var(--title, "Bagel Fat One", sans-serif); font-weight: 400; font-size: calc(var(--cw) * .17); color: var(--c); text-shadow: var(--sticker, 0 2px 0 #fff); }
.pk-layer.duo .pk-label { opacity: 1; animation: pk-drop-in .45s ${SPRING} .25s both; }
.pk-beam { position: absolute; width: calc(var(--cw) * 1.5); height: 160vh; left: calc(var(--cw) * -.75); top: -80vh; pointer-events: none;
  transform: translateX(calc(var(--x) * var(--cw))) scale(var(--s)); }
.pk-beam i { position: absolute; inset: 0; opacity: 0; transform-origin: 50% 50%; }
.pk-beam .b1 { background: radial-gradient(50% 50% at 50% 50%, var(--ca) 0%, var(--ca) 18%, var(--cb) 52%, rgba(255,255,255,0) 100%); }
.pk-beam .b2 { left: 30%; right: 30%; background: radial-gradient(50% 50% at 50% 50%, #fff, rgba(255,255,255,.9) 22%, rgba(255,255,255,.3) 55%, rgba(255,255,255,0)); }
.pk-beam .b3 { background: radial-gradient(50% 50% at 50% 50%, rgba(255,200,240,.6), rgba(190,215,255,.3) 45%, rgba(255,255,255,0)); }
.pk-beam.on .b1 { animation: pk-beam .7s ease-out both, pk-beam-pulse 2.4s ease-in-out .9s infinite; }
.pk-beam.on .b2 { animation: pk-beam-core .9s ease-out both; }
.pk-beam.on .b3 { animation: pk-beam .8s ease-out .1s both; --tilt: 10deg; }
.pk-beam.on .b4 { animation: pk-beam .8s ease-out .1s both; --tilt: -10deg; }
.pk-layer.duo .pk-beam { opacity: .6; }
.pk-beams { position: absolute; z-index: 1; }
.pk-cards { position: absolute; z-index: 2; }

.pk-info { grid-area: info; text-align: center; min-height: clamp(74px, 13vh, 104px); max-width: min(560px, 92vw); }
.pk-name { margin: 0; font-family: var(--title, "Bagel Fat One", sans-serif); font-weight: 400; font-size: clamp(28px, 5.4vh, 42px); line-height: 1.1; color: var(--c);
  text-shadow: var(--sticker, 0 2px 0 #fff); animation: pk-pop .5s ${SPRING} both; }
.pk-tip { margin: 6px 0 0; color: #4f5b7d; font-size: clamp(15px, 2.3vh, 19px); line-height: 1.3; animation: pk-rise .45s ease-out .12s both; }
.pk-more { margin: 8px 0 0; color: #6a55c2; font-size: 15px; letter-spacing: .02em; animation: pk-rise .4s ease-out .3s both, pk-blink 1.6s ease-in-out .8s infinite; }
.pk-acts { grid-area: acts; display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; min-height: 62px; align-items: center; }
.pk-acts .btn { white-space: nowrap; animation: pk-btn-in .55s ${SPRING} backwards;
  background-image: linear-gradient(180deg, rgba(255,255,255,.3), rgba(255,255,255,0) 55%, rgba(0,0,0,.04)); }
.pk-acts .btn:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
.pk-main .ico { animation: pk-gem 1.8s ease-in-out 1s infinite; }
.pk-ring { position: absolute; inset: -3px; border-radius: 22px; border: 3px solid rgba(255,255,255,.85); opacity: 0; pointer-events: none; animation: pk-ring 1.8s ease-out 1s infinite; }

/* phone landscape: the cards on the left, the words and buttons on the right */
@media (max-height: 520px) and (min-aspect-ratio: 4/3) {
  .pk-layer { --cw: min(35vh, 24vw, 230px); grid-template-columns: 1.15fr 1fr; grid-template-rows: auto auto auto; grid-template-areas: "stage head" "stage info" "stage acts"; align-items: center; row-gap: 10px; }
  .pk-head { align-self: end; }
  .pk-stage { height: 100%; }
  .pk-info { min-height: 0; align-self: center; }
  .pk-title { font-size: clamp(24px, 8vh, 36px); }
  .pk-name { font-size: clamp(24px, 8vh, 34px); }
  .pk-tip { font-size: 15px; }
  .pk-acts { align-self: start; }
  .pk-acts .btn { padding: 11px 20px 14px; font-size: 17px; }
}

@keyframes pk-fade-in { from { opacity: 0; } }
@keyframes pk-fade-out { to { opacity: 0; } }
@keyframes pk-spin { to { transform: rotate(360deg); } }
@keyframes pk-mote { from { transform: translate(0, 0); opacity: 0; } 15% { opacity: .8; } 85% { opacity: .8; } to { transform: translate(var(--dx), -110vh); opacity: 0; } }
@keyframes pk-drop-in { from { opacity: 0; transform: translateY(-18px) scale(.9); } }
@keyframes pk-pop { from { opacity: 0; transform: scale(.6); } 60% { opacity: 1; transform: scale(1.08); } }
@keyframes pk-rise { from { opacity: 0; transform: translateY(10px); } }
@keyframes pk-blink { 50% { opacity: .55; } }
@keyframes pk-pack-drop {
  0% { transform: translateY(-120vh) rotate(-9deg); animation-timing-function: cubic-bezier(.55, 0, .9, .45); }
  58% { transform: translateY(0) rotate(1deg) scale(1.06, .93); animation-timing-function: ease-out; }
  74% { transform: translateY(-5%) rotate(-1deg) scale(.97, 1.04); animation-timing-function: ease-in-out; }
  88% { transform: translateY(0) scale(1.02, .98); }
  100% { transform: none; } }
@keyframes pk-pack-sink { 0% { transform: none; } 25% { transform: translateY(-3%) rotate(-1deg); } 80% { opacity: 1; } 100% { transform: translateY(85vh) rotate(7deg); opacity: 0; } }
@keyframes pk-idle { 0%, 100% { transform: rotate(-2.2deg) translateY(0); } 50% { transform: rotate(2.2deg) translateY(-2.5%); } }
@keyframes pk-breathe { 0%, 100% { transform: scale(.94); opacity: .85; } 50% { transform: scale(1.05); opacity: 1; } }
@keyframes pk-shake { 0%, 100% { transform: none; } 20% { transform: translateX(-2.5%) rotate(-2.5deg); } 40% { transform: translateX(2.5%) rotate(2deg); } 60% { transform: translateX(-2%) rotate(-1.5deg); } 80% { transform: translateX(1.5%) rotate(1deg); } }
@keyframes pk-squash { 0% { transform: scale(1.04, .95); } 50% { transform: scale(.98, 1.03); } 100% { transform: none; } }
@keyframes pk-strip-fly { 0% { transform: none; opacity: 1; } 22% { transform: translate(calc(var(--dir) * 4%), -7%) rotate(calc(var(--dir) * 6deg)); opacity: 1; }
  100% { transform: translate(calc(var(--dir) * var(--cw) * 1.45), calc(var(--cw) * -.75)) rotate(calc(var(--dir) * 60deg)); opacity: 0; } }
@keyframes pk-sweep { 0% { transform: translateX(0); } 38%, 100% { transform: translateX(330px); } }
@keyframes pk-iri { from { transform: translate(-90px, -50px); } to { transform: translate(70px, 40px); } }
@keyframes pk-twinkle { 0%, 100% { transform: scale(.35) rotate(0); opacity: .35; } 45% { transform: scale(1.1) rotate(30deg); opacity: 1; } }
@keyframes pk-slice { 0% { transform: scaleX(var(--p, 0)); opacity: 1; } 40% { transform: scaleX(1); opacity: 1; } 100% { transform: scaleX(1) scaleY(.4); opacity: 0; } }
@keyframes pk-mouth { 0% { opacity: 0; transform: scale(.5, .3); } 20% { opacity: 1; transform: scale(1.15, 1.2); } 70% { opacity: .85; transform: none; } 100% { opacity: 0; } }
@keyframes pk-hint-in { from { opacity: 0; transform: translateX(-50%) translateY(12px) scale(.6); } to { opacity: 1; transform: translateX(-50%); } }
@keyframes pk-bob { 50% { transform: translateY(-5px); } }
@keyframes pk-hand {
  0% { opacity: 0; transform: translate(calc(var(--cw) * -.42), 30%) scale(1.15); }
  14% { opacity: 1; transform: translate(calc(var(--cw) * -.42), 0) scale(1); }
  22% { transform: translate(calc(var(--cw) * -.42), 4%) scale(.9); }
  62% { opacity: 1; transform: translate(calc(var(--cw) * .42), 4%) scale(.9); }
  72% { opacity: 1; transform: translate(calc(var(--cw) * .46), -6%) scale(1); }
  86%, 100% { opacity: 0; transform: translate(calc(var(--cw) * .48), -10%) scale(1); } }
@keyframes pk-trail { 0%, 21% { opacity: 0; transform: scaleX(0); } 26% { opacity: .95; } 62% { opacity: .95; transform: scaleX(.92); } 80%, 100% { opacity: 0; transform: scaleX(.92); } }
@keyframes pk-burst { 0% { transform: scale(.15); opacity: 1; } 55% { opacity: .9; } 100% { transform: scale(var(--k, 2.2)); opacity: 0; } }
@keyframes pk-bit { 0% { opacity: 1; transform: translate(0, 0) scale(.3) rotate(0); } 12% { opacity: 1; }
  65% { opacity: 1; transform: translate(var(--dx), var(--dy)) scale(1) rotate(var(--rot)); }
  100% { opacity: 0; transform: translate(var(--dx), calc(var(--dy) + var(--fall))) scale(.5) rotate(calc(var(--rot) * 1.4)); } }
@keyframes pk-flash { 0% { opacity: 0; } 18% { opacity: var(--fl, .55); } 100% { opacity: 0; } }
@keyframes pk-flip {
  0% { transform: rotateY(180deg) scale(1); }
  45% { transform: rotateY(84deg) scale(1.14); }
  78% { transform: rotateY(-12deg) scale(1.06); }
  100% { transform: rotateY(0) scale(1); } }
@keyframes pk-charge { 0%, 100% { transform: rotateY(180deg); } 25% { transform: rotateY(180deg) rotate(-3deg) scale(1.03); } 50% { transform: rotateY(180deg) rotate(3deg) scale(1.05); } 75% { transform: rotateY(180deg) rotate(-2deg) scale(1.04); } }
@keyframes pk-float { 0%, 100% { transform: translateY(0) rotate(-.8deg); } 50% { transform: translateY(-2.5%) rotate(.8deg); } }
@keyframes pk-gloss { from { transform: translateX(-130%) skewX(-16deg); } to { transform: translateX(260%) skewX(-16deg); } }
@keyframes pk-holo { 0% { opacity: 0; transform: translate(-25%, -25%); } 25% { opacity: 1; } 75% { opacity: 1; } 100% { opacity: 0; transform: translate(25%, 25%); } }
@keyframes pk-cflash { 0% { opacity: .95; } 100% { opacity: 0; } }
@keyframes pk-new { from { opacity: 0; transform: rotate(-12deg) scale(.2); } 60% { opacity: 1; transform: rotate(-12deg) scale(1.25); } to { opacity: 1; transform: rotate(-12deg) scale(1); } }
@keyframes pk-beam { 0% { opacity: 0; transform: rotate(var(--tilt, 0deg)) scale(.35, .2); } 30% { opacity: 1; } 100% { opacity: 1; transform: rotate(var(--tilt, 0deg)) scale(1); } }
@keyframes pk-beam-core { 0% { opacity: 0; transform: scale(.4, .2); } 25% { opacity: 1; transform: scale(1.2, 1); } 100% { opacity: .55; transform: scale(.8, 1); } }
@keyframes pk-beam-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .75; transform: scale(.92, 1); } }
@keyframes pk-btn-in { from { opacity: 0; transform: translateY(26px) scale(.7); } }
@keyframes pk-gem { 0%, 30%, 100% { transform: none; } 10% { transform: scale(1.35) rotate(-12deg); } 20% { transform: scale(.95) rotate(6deg); } }
@keyframes pk-ring { 0% { opacity: .85; transform: scale(1); } 45%, 100% { opacity: 0; transform: scale(1.18, 1.4); } }

/* calm (reduced motion): the same beats, shorter and without the big moves */
.pk-layer.calm :is(.pk-rays, .pk-mote, .pk-pack.idle .pk-wob, .pk-glow, .pk-spk, .pk-sweep, .pk-iri, .pk-card.lit .pk-float, .pk-hint span, .pk-main .ico, .pk-ring) { animation: none !important; }
.pk-layer.calm .pk-pack { animation: pk-fade-in .3s both; }
.pk-layer.calm .pk-pack.torn .pk-top { animation: pk-fade-out .25s forwards; }
.pk-layer.calm .pk-pack.gone { animation: pk-fade-out .3s forwards; }
.pk-layer.calm .pk-pack.tear .pk-wob { animation: none; }
.pk-layer.calm :is(.pk-bit, .pk-flash, .pk-trail) { display: none; }
.pk-layer.calm.hinted .pk-hand { opacity: 1; animation: pk-fade-in .3s both; transform: translateX(calc(var(--cw) * -.2)); }
.pk-layer.calm .pk-card.flip .pk-spin { animation: pk-flip-calm .3s ease-out both; }
@keyframes pk-flip-calm { from { transform: rotateY(90deg); } to { transform: none; } }
`;

// the foil's glitter: a tile of tiny pastel specks, drawn once on a canvas
let glitter = '';
function glitterTile() {
  if (glitter) return glitter;
  const c = document.createElement('canvas'); c.width = c.height = 140; const x = c.getContext('2d');
  for (let i = 0; i < 280; i++) {
    const a = Math.random(); x.fillStyle = `hsla(${Math.random() * 360 | 0}, 100%, ${82 + Math.random() * 18 | 0}%, ${(0.2 + 0.7 * a * a).toFixed(2)})`;
    x.beginPath(); x.arc(Math.random() * 140, Math.random() * 140, Math.random() < 0.12 ? 1.5 : 0.7, 0, 7); x.fill();
  }
  return glitter = `url(${c.toDataURL()})`;
}
export function createPacks({ sfx, art, jokers } = {}) {
  const cardArt = typeof art === 'function' ? art : k => `${art || 'assets/cards/'}${k}.webp`;
  const ui = (name, vol) => { try { sfx?.ui?.(name, vol); } catch {} };

  function open({ cards = [], rarity = 'common', title = 'A pack for you!', sub = '', isNew = () => false, actions = [] } = {}) {
    active?.close(''); // (only one pack at a time)
    if (!document.getElementById('packs-css')) { // one <style> for the whole feature keeps it in this one file
      const st = document.createElement('style'); st.id = 'packs-css'; st.textContent = CSS; document.head.append(st);
    }
    const kinds = cards.filter(k => jokers?.[k]).slice(0, 2);
    if (!actions.length) actions = [{ id: 'ok', label: 'Yay!', color: 'green', primary: true }];
    const primary = actions.find(a => a.primary) || actions[actions.length - 1];
    const rare = rarity === 'rare';
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pace = calm ? 0.6 : 1;
    const uid = `pk${++packCount}`;

    // ---- the overlay ----
    const layer = document.createElement('div');
    layer.className = `pk-layer${rare ? ' rare' : ''}${calm ? ' calm' : ''}`;
    layer.tabIndex = -1; layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-modal', 'true'); layer.setAttribute('aria-label', title);
    const motes = Array.from({ length: 7 }, (_, i) => `<i class="pk-mote" style="left:${8 + i * 13 + Math.random() * 6}%;--m:${5 + Math.random() * 7}px;--d:${11 + Math.random() * 7}s;--w:${-Math.random() * 12}s;--dx:${Math.random() * 60 - 30}px"></i>`).join('');
    const sparkles = [[18, 27, 0.2], [80, 69, 0.24], [77, 21, 0.1], [24, 77, 0.09], ...(rare ? [[58, 88, 0.14], [36, 12, 0.08]] : [])]
      .map(([x, y, z], i) => `<svg class="pk-spk" viewBox="0 0 24 24" style="left:${x}%;top:${y}%;--z:calc(var(--cw) * ${z});--w:${-i * 0.47}s"><path d="${STAR4}"/></svg>`).join('');
    // the tear: a jagged line; the body is cut below it from the start (hidden under the whole pack), the strip above it on tearing
    const jag = Array.from({ length: 13 }, (_, i) => `${(i / 12 * 100).toFixed(1)}% ${(TEAR + (i % 2 ? 1.2 : -0.7)).toFixed(1)}%`);
    const topClip = `polygon(-6% -6%, 106% -6%, 106% ${TEAR}%, ${[...jag].reverse().join(', ')}, -6% ${TEAR}%)`;
    layer.innerHTML = `<div class="pk-bg"></div>${motes}
<div class="pk-head">${rare ? '<span class="pk-rarity">Rare pack</span>' : ''}<h2 class="pk-title">${esc(title)}</h2>${sub ? `<p class="pk-sub">${esc(sub)}</p>` : ''}</div>
<div class="pk-stage"><div class="pk-anchor">
  <div class="pk-halo"></div><div class="pk-beams"></div><div class="pk-cards"></div>
  <div class="pk-pack" style="--dir:1"><div class="pk-shadow"></div><div class="pk-wob">
    <div class="pk-glow"></div>
    <div class="pk-half pk-body" style="clip-path:polygon(-6% ${TEAR}%, ${jag.join(', ')}, 106% ${TEAR}%, 106% 106%, -6% 106%)">${packSvg(uid + 'b', rare)}<i class="pk-foil"></i><i class="pk-glare"></i></div>
    <div class="pk-half pk-top">${packSvg(uid + 't', rare)}<i class="pk-foil"></i><i class="pk-glare"></i></div>
    <i class="pk-mouth"></i><i class="pk-slice"></i>${sparkles}
  </div></div>
  <i class="pk-trail"></i><div class="pk-hand">${HAND}</div><div class="pk-hint"><span>Swipe to open!</span></div>
</div></div>
<div class="pk-info" aria-live="polite"></div>
<div class="pk-acts"></div>`;
    const $ = s => layer.querySelector(s);
    layer.style.setProperty('--glitter', glitterTile());
    const wob = $('.pk-wob');
    const anchor = $('.pk-anchor'), pack = $('.pk-pack'), top = $('.pk-top'), slice = $('.pk-slice'), infoEl = $('.pk-info'), actsEl = $('.pk-acts');
    anchor.prepend(rays(rare));

    // the cards (face-down inside the pack) and their pillars of light
    const deck = kinds.map((k, i) => {
      const J = jokers[k], el = document.createElement('div'), beam = document.createElement('div');
      el.className = 'pk-card'; el.style.setProperty('--c', J.color); el.style.zIndex = 2 - i;
      el.innerHTML = `<div class="pk-cshadow"></div><div class="pk-float"><div class="pk-spin">
<div class="pk-face pk-back"><img alt="" draggable="false" src="${esc(cardArt('back'))}"></div>
<div class="pk-face pk-front"><img alt="${esc(J.name)}" draggable="false" src="${esc(cardArt(k))}"><i class="pk-holo"></i><i class="pk-gloss"></i></div>
</div><i class="pk-cflash"></i><b class="pk-new">NEW</b></div><div class="pk-label">${esc(J.name)}</div>`;
      beam.className = 'pk-beam'; beam.style.setProperty('--ca', rgba(J.color, 0.85)); beam.style.setProperty('--cb', rgba(J.color, 0.32));
      beam.innerHTML = `${rare ? '<i class="b3"></i><i class="b4"></i>' : ''}<i class="b1"></i><i class="b2"></i>`;
      $('.pk-cards').append(el); $('.pk-beams').append(beam);
      const c = { k, J, el, beam, fresh: !!safe(() => isNew(k)) };
      place(c, SPOT.inside, 0);
      return c;
    });
    document.body.append(layer);
    layer.focus({ preventScroll: true });

    // ---- timing: beats that a tap can rush through, and gates that wait for a tap ----
    let phase = 'drop', rush = false, skipAll = false, rushed = false, closed = false, wake = null, gateOpen = null;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    const beat = ms => {
      if (rush || closed) { finishAll(); return Promise.resolve(); }
      return new Promise(res => { const t = later(go, ms * pace); wake = go; function go() { clearTimeout(t); timers.delete(t); wake = null; res(); } });
    };
    // resting points: wait for a tap (true) or the timeout (false); a rush stops here unless Escape asked to skip it all
    const gate = (ms = 0) => {
      if (rush) { finishAll(); if (rushed) { ui('chime', 0.35); rushed = false; } }
      if (skipAll || closed) return Promise.resolve(true);
      rush = false;
      return new Promise(res => { const t = ms && later(() => go(false), ms); gateOpen = go; function go(v) { if (t) clearTimeout(t); gateOpen = null; res(v); } });
    };
    const ping = (name, vol) => { if (!rush && !closed) ui(name, vol); };
    function finishAll() {
      if (!layer.getAnimations) return;
      for (const a of layer.getAnimations({ subtree: true })) {
        try { if (a.effect.getComputedTiming().endTime !== Infinity) a.finish(); } catch {}
      }
    }
    function tap(skip = false) {
      if (closed || phase === 'choose') return;
      if (skip) skipAll = true; // (Escape: rush through every beat and gate up to the choice)
      if (gateOpen && !skip) return gateOpen(true);
      rush = rushed = true; finishAll(); wake?.(); gateOpen?.(true);
    }

    function place(c, p, t = 0.6, ease = SPRING) {
      for (const el of [c.el, c.beam]) {
        const s = el.style;
        s.setProperty('--x', p.x); s.setProperty('--y', p.y); s.setProperty('--s', p.s); s.setProperty('--r', p.r);
        s.setProperty('--t', `${t * pace}s`); s.setProperty('--e', ease);
      }
    }
    function burstAt(y, { n, spread, colors, big }) { // light + sparkle confetti at (0, y) in card widths
      const frag = document.createDocumentFragment(), made = [];
      const add = (cls, html, style) => { const e = document.createElement('i'); e.className = cls; e.innerHTML = html; e.style.cssText = style; frag.append(e); made.push(e); };
      add('pk-burst', '', `top:calc(var(--cw) * ${y - 0.75});--k:${big ? 3.2 : 2.2}`);
      if (big) add('pk-burst ring', '', `top:calc(var(--cw) * ${y - 0.75});--k:3.6`);
      if (!calm) for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.9, d = spread * (0.45 + Math.random() * 0.75), kind = i % 3;
        const z = kind === 0 ? 0.11 + Math.random() * 0.1 : 0.045 + Math.random() * 0.04;
        add(`pk-bit${kind === 1 ? ' dot' : kind === 2 ? ' rib' : ''}`, kind === 0 ? `<svg viewBox="0 0 24 24"><path d="${STAR4}"/></svg>` : '',
          `top:calc(var(--cw) * ${y});--c:${colors[i % colors.length]};--z:calc(var(--cw) * ${z.toFixed(3)});--dx:calc(var(--cw) * ${(Math.cos(a) * d * 1.25).toFixed(2)});` +
          `--dy:calc(var(--cw) * ${(Math.sin(a) * d).toFixed(2)});--fall:calc(var(--cw) * ${(0.15 + Math.random() * 0.25).toFixed(2)});--rot:${Math.round(Math.random() * 360 - 180)}deg;` +
          `--d:${(0.9 + Math.random() * 0.5).toFixed(2)}s;--w:${(Math.random() * 0.08).toFixed(2)}s`);
      }
      anchor.append(frag);
      later(() => made.forEach(e => e.remove()), 1700);
    }
    function flash(strength) {
      if (calm) return;
      const f = document.createElement('i'); f.className = 'pk-flash'; f.style.setProperty('--fl', strength); layer.append(f);
      later(() => f.remove(), 600);
    }
    function say(html) { infoEl.innerHTML = html; } // fresh nodes, so their entry animations play again

    // ---- input: swipe across the pack (or tap) to open; taps fast-forward; Space / Enter = tap ----
    let drag = null, dir = 1;
    function onDown(e) {
      if (closed || e.target.closest('button') || (e.button ?? 0) !== 0) return;
      if (phase === 'idle' || phase === 'drop') {
        const r = pack.getBoundingClientRect(); // (one read per touch, not per frame)
        drag = { x0: e.clientX, w: r.width, p: 0 };
        try { layer.setPointerCapture(e.pointerId); } catch {}
        if (phase === 'drop') tap(); // (lands the pack right away)
        return;
      }
      tap();
    }
    let box = null, boxT = 0;
    function lean(e) { // (the rect is measured at most every 0.4 s, not on every move)
      if (e.pointerType === 'touch' || drag || phase !== 'idle' || pack.classList.contains('torn')) return;
      const now = performance.now(); if (!box || now - boxT > 400) { box = pack.getBoundingClientRect(); boxT = now; }
      const nx = Math.max(-1, Math.min(1, (e.clientX - box.left - box.width / 2) / (box.width * 0.9)));
      const ny = Math.max(-1, Math.min(1, (e.clientY - box.top - box.height / 2) / (box.height * 0.9)));
      pack.classList.add('aim');
      pack.style.setProperty('--hx', `${50 + nx * 45}%`); pack.style.setProperty('--hy', `${50 + ny * 45}%`);
      pack.style.setProperty('--gx', `${50 + nx * 55}%`); pack.style.setProperty('--gy', `${50 + ny * 55}%`);
      wob.style.rotate = `${(-ny).toFixed(3)} ${nx.toFixed(3)} 0 ${(Math.hypot(nx, ny) * 13).toFixed(1)}deg`;
    }
    function unlean() { pack.classList.remove('aim'); wob.style.rotate = ''; }
    function onMove(e) {
      lean(e);
      if (!drag || phase !== 'idle') return;
      const dx = e.clientX - drag.x0, p = Math.min(1, Math.abs(dx) / (drag.w * 0.75));
      if (p < 0.06) return;
      dir = dx < 0 ? -1 : 1; drag.p = p;
      slice.style.setProperty('--from', dir > 0 ? 'left' : 'right');
      slice.style.transform = `scaleX(${p.toFixed(3)})`; slice.style.opacity = 1;
      if (p >= 1) { drag = null; tap(); }
    }
    function onUp() {
      if (!drag) return;
      drag = null;
      if (phase === 'idle') tap(); // a tap opens it too
    }
    function onKey(e) {
      if (closed) return;
      const k = e.code;
      if (k === 'Space' || k === 'Enter' || k === 'NumpadEnter') {
        e.stopImmediatePropagation();
        if (phase === 'choose') { if (!actsEl.contains(document.activeElement)) { e.preventDefault(); actsEl.querySelector('.pk-main')?.click(); } return; }
        e.preventDefault(); if (!e.repeat) tap(); return;
      }
      if (k === 'Escape') { // skips the show, never the choice
        e.preventDefault(); e.stopImmediatePropagation();
        if (phase !== 'choose') tap(true);
        return;
      }
      if (k === 'Tab' || k.startsWith('Arrow')) { // keep focus on our buttons
        e.preventDefault(); e.stopImmediatePropagation();
        const bs = [...actsEl.querySelectorAll('button')]; if (!bs.length) return;
        const i = bs.indexOf(document.activeElement), back = k === 'ArrowLeft' || k === 'ArrowUp' || (k === 'Tab' && e.shiftKey);
        bs[(i < 0 ? bs.indexOf(actsEl.querySelector('.pk-main')) : i + (back ? bs.length - 1 : 1)) % bs.length]?.focus();
      }
    }
    layer.addEventListener('pointerdown', onDown);
    layer.addEventListener('pointermove', onMove);
    layer.addEventListener('pointerleave', unlean);
    layer.addEventListener('pointerup', onUp);
    layer.addEventListener('pointercancel', onUp);
    addEventListener('keydown', onKey, true);

    let resolveChoice;
    const answer = new Promise(res => { resolveChoice = res; });
    function close(id) {
      if (closed) return;
      closed = true; phase = 'done'; gateOpen?.(true); wake?.();
      removeEventListener('keydown', onKey, true);
      layer.removeEventListener('pointerdown', onDown); layer.removeEventListener('pointermove', onMove); layer.removeEventListener('pointerleave', unlean);
      layer.removeEventListener('pointerup', onUp); layer.removeEventListener('pointercancel', onUp);
      timers.forEach(clearTimeout); timers.clear();
      layer.classList.add('out');
      setTimeout(() => layer.remove(), 300);
      if (active?.layer === layer) active = null;
      resolveChoice(id);
    }
    active = { layer, close };
    actsEl.addEventListener('click', e => { const b = e.target.closest('button[data-id]'); if (b && phase === 'choose') close(b.dataset.id); });

    // ---- the show ----
    async function run() {
      // 1. the pack drops in on its spring and settles into a wobble
      ping('whoosh', 0.22);
      await beat(520); ping('pop', 0.35);
      await beat(380);
      phase = 'idle'; pack.classList.add('idle');
      const early = rush; // (tapped while it fell: open it straight away, but let the tear play)
      if (!skipAll) rush = rushed = false;
      // 2. after a moment, the hand shows the swipe
      if (!early && !(await gate(1200))) { layer.classList.add('hinted'); ui('hover', 0.25); await gate(); }
      if (closed) return;
      // 3. tear: a slice runs along the seal, a shake, the strip flies off in a burst of light
      phase = 'open'; layer.classList.add('opened');
      pack.style.setProperty('--dir', dir);
      slice.style.setProperty('--p', parseFloat(slice.style.transform.replace('scaleX(', '')) || 0);
      slice.style.transform = ''; slice.style.opacity = '';
      pack.classList.remove('idle'); pack.classList.add('tear'); ping('whoosh', 0.45);
      await beat(320);
      unlean(); top.style.clipPath = topClip; pack.classList.add('torn'); ping('pop', 0.42);
      burstAt(-0.55, { n: rare ? 30 : 18, spread: rare ? 1.9 : 1.45, big: rare, colors: rare ? ['#ffffff', '#ffd0ea', '#c9e6ff', '#ddd0ff', '#ffe27a'] : ['#ffffff', '#ffe27a', '#fff3b8', '#b9f28f', '#ffd166'] });
      flash(rare ? 0.7 : 0.45);
      await beat(360);
      // 4. the cards slide up out of the pack, face-down; the pack sinks away and they settle in the middle
      deck.forEach((c, i) => { c.el.classList.add('shown'); place(c, i ? SPOT.out2 : SPOT.out, 0.6, GLIDE); });
      ping('whoosh', 0.25);
      await beat(640);
      pack.classList.add('gone');
      deck.forEach((c, i) => place(c, i ? SPOT.behind : SPOT.center, 0.65));
      await beat(480);
      later(() => pack.remove(), 700);
      // 5. one card at a time: flip, pillar, name; two cards: tap for the next, then both side by side
      for (let i = 0; i < deck.length; i++) {
        if (i) {
          say(cardInfo(deck[0]) + '<p class="pk-more">Tap for the next card</p>');
          await gate(); if (closed) return;
          ping('whoosh', 0.3);
          place(deck[0], SPOT.away, 0.55, GLIDE); deck[0].el.classList.add('hide'); deck[0].beam.style.opacity = 0;
          deck[1].el.style.zIndex = 3; place(deck[1], SPOT.center, 0.55);
          await beat(380);
        }
        await reveal(deck[i]);
      }
      if (deck.length > 1) {
        await gate(1500); if (closed) return;
        deck[0].el.classList.remove('hide'); deck[0].beam.style.opacity = '';
        place(deck[0], SPOT.left, 0.65); place(deck[1], SPOT.right, 0.65);
        layer.classList.add('duo'); ping('whoosh', 0.25);
        const [a, b] = deck;
        say(`<h3 class="pk-name" style="--c:#ffd34f">Two cards!</h3><p class="pk-tip">${a.k === b.k ? `Two ${esc(a.J.name)} cards are` : `${esc(a.J.name)} and ${esc(b.J.name)} are`} in your bag.</p>`);
        await beat(520);
      }
      // 6. the choice: candy buttons spring in, the main one calls for a tap
      await gate(1); // (a pending rush ends here)
      phase = 'choose';
      actsEl.innerHTML = actions.map((a, i) => {
        const icon = a.icon ? `<svg class="ico"><use href="#${esc(a.icon)}"/></svg>` : '';
        return `<button class="btn ${esc(a.color || 'green')}${a === primary ? ' pk-main' : ''}" data-id="${esc(a.id)}" style="animation-delay:${i * 90}ms">${a === primary ? '<i class="pk-ring"></i>' : ''}${a === primary ? '' : icon}${esc(a.label)}${a === primary ? icon : ''}</button>`;
      }).join('');
      ui('toggle', 0.2);
      actsEl.querySelector('.pk-main')?.focus({ preventScroll: true });
    }
    async function reveal(c) {
      c.el.classList.add('charge'); ping('hover', 0.3);
      await beat(420);
      c.el.classList.add('flip');
      await beat(330);
      c.el.classList.add('lit'); c.beam.classList.add('on'); ping('chime', 0.45);
      burstAt(-0.2, { n: rare ? 16 : 10, spread: 1.05, big: false, colors: ['#ffffff', c.J.color, '#fff3b8'] });
      await beat(320);
      say(cardInfo(c));
      if (c.fresh) { c.el.classList.add('isnew'); later(() => ping('pop', 0.25), 120); }
      await beat(800);
    }
    const cardInfo = c => `<h3 class="pk-name" style="--c:${c.J.color}">${esc(c.J.name)}</h3><p class="pk-tip">${esc(c.J.tip ? c.J.tip[0].toUpperCase() + c.J.tip.slice(1) + '.' : '')}</p>`;

    if (!deck.length) { later(() => close(primary.id), 0); return answer; } // (nothing to show)
    run().catch(err => { console.error(err); close(primary.id); });
    return answer;
  }
  return { open };
}

const safe = fn => { try { return fn(); } catch { return false; } };
// soft light rays drawn once on a small canvas: scaled up and spun by CSS, it costs one tiny texture, not a screenful
function rays(rare) {
  const c = document.createElement('canvas'), S = 256; c.className = 'pk-rays'; c.width = c.height = S;
  const g = c.getContext('2d'); if (!g) return c;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, rare ? 'rgba(255,235,255,.42)' : 'rgba(255,250,225,.4)'); grad.addColorStop(0.45, 'rgba(255,255,255,.13)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, w = Math.PI / n * (i % 2 ? 0.32 : 0.55);
    g.beginPath(); g.moveTo(S / 2, S / 2); g.arc(S / 2, S / 2, S / 2, a - w, a + w); g.closePath(); g.fill();
  }
  return c;
}
