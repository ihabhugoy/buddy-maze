// The moment Buddy picks up a card while playing (like an item-get in mobile games): the card pops out of the world
// spinning, a light pillar in its color shoots up behind it, it flips to its face with a flash, shows its name and
// what it does for a breath, then flies in an arc into the card dock. Short on purpose (~1.9 s, the game waits while
// it plays) and a tap, Space, Enter or Escape skips ahead to the fly-out. Only transform / opacity animate (phones), the
// overlay and its CSS are removed when it ends, and reduced motion gets a calm cross-fade instead.
//
//   const cardFx = createCardFx({ sfx, art: CARD_ART, jokers: JOKERS });
//   await cardFx.reveal({ kind: 'light', from: { x, y }, to: () => slot.getBoundingClientRect(), isNew, gold });

const CSS = `
.cfx { position: fixed; inset: 0; z-index: 35; overflow: hidden; contain: strict; cursor: pointer; touch-action: none;
  -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; font-family: Nunito, ui-rounded, system-ui, sans-serif; }
.cfx :where(div, b, i, img, svg) { position: absolute; display: block; pointer-events: none; box-sizing: border-box; }
.cfx-dim { inset: 0; opacity: 0; background: radial-gradient(ellipse 70% 62% at 50% 46%, rgba(48,28,10,.22), rgba(48,28,10,.55)); }
.cfx-stage { width: 0; height: 0; }
/* soft light behind the card, the slowly turning rays and the pillar: all in the card's color (gold for a golden card) */
.cfx-glow { left: calc(var(--cw) * -1.7); top: calc(var(--ch) * -1.25); width: calc(var(--cw) * 3.4); height: calc(var(--ch) * 2.5); opacity: 0;
  background: radial-gradient(closest-side, var(--bA), var(--bB) 55%, transparent); }
.cfx-raysW { left: calc(var(--r) / -2); top: calc(var(--r) / -2); width: var(--r); height: var(--r); opacity: 0; }
.cfx-rays { inset: 0; background: repeating-conic-gradient(from 4deg, var(--ray) 0deg 7deg, transparent 9deg 20deg, var(--ray) 22.5deg);
  -webkit-mask: radial-gradient(closest-side, transparent 22%, #000 36%, rgba(0,0,0,.6) 62%, transparent 100%);
  mask: radial-gradient(closest-side, transparent 22%, #000 36%, rgba(0,0,0,.6) 62%, transparent 100%); }
.cfx-pillar { left: calc(var(--cw) * -.7); width: calc(var(--cw) * 1.4); transform-origin: 50% 100%; opacity: 0;
  -webkit-mask: linear-gradient(to top, transparent, #000 10%, #000 62%, transparent); mask: linear-gradient(to top, transparent, #000 10%, #000 62%, transparent); }
.cfx-beam { inset: 0; background: linear-gradient(90deg, transparent, var(--bP) 22%, var(--b) 40%, var(--bL) 50%, var(--b) 60%, var(--bP) 78%, transparent); opacity: .85; }
.cfx-core { left: 34%; width: 32%; top: 0; bottom: 0; background: linear-gradient(90deg, rgba(255,255,255,0), #fff 30%, #fff 70%, rgba(255,255,255,0)); opacity: 0; }
.cfx-mote { left: 50%; bottom: 0; width: 8px; height: 8px; margin-left: -4px; border-radius: 50%; background: radial-gradient(#fff 35%, rgba(255,255,255,0) 70%); opacity: 0; }
/* the card: three wrappers so the flight's x, y and size can each ease their own way (that makes the arc) */
.cfx-scale { left: calc(var(--cw) / -2); top: calc(var(--ch) / -2); width: var(--cw); height: var(--ch); perspective: 900px; }
.cfx-card { inset: 0; transform-style: preserve-3d; }
.cfx-side { inset: 0; -webkit-backface-visibility: hidden; backface-visibility: hidden; transform: translateZ(3px); }
.cfx-side img { inset: 0; width: 100%; height: 100%; -webkit-user-drag: none; }
.cfx-rev { transform: rotateY(180deg) translateZ(3px); }
.cfx-slab { inset: 1.5%; border-radius: 15% / 11%; background: var(--cD); } /* (two slabs between the faces: the card has a thickness when it turns edge-on) */
.cfx-face { opacity: 0; }
.cfx-shine { inset: 0; overflow: hidden; -webkit-mask-size: 100% 100%; mask-size: 100% 100%; }
.cfx-shine i { top: -10%; height: 120%; left: 0; width: 55%; transform: translateX(-120%);
  background: linear-gradient(105deg, rgba(255,255,255,0) 15%, rgba(255,255,255,.75) 46%, rgba(255,255,255,.95) 50%, rgba(255,255,255,.75) 54%, rgba(255,255,255,0) 85%); }
.cfx-halo { inset: -5px; border-radius: 17% / 12.5%; opacity: 0; box-shadow: 0 0 0 4px rgba(255,222,110,.95), 0 0 26px 8px rgba(255,196,50,.75); } /* (a golden card wears a gold rim) */
.cfx-new { left: -12px; top: 5%; padding: 5px 9px 6px; border-radius: 10px; font: 400 15px/1 var(--title, "Bagel Fat One"), system-ui; color: #fff; letter-spacing: .04em;
  background: linear-gradient(180deg, #ff9fb8, #f26b93 60%, #e2557f); box-shadow: 0 0 0 3px #fff, 0 6px 12px rgba(120,40,60,.3); text-shadow: 0 1.5px 0 #c94470;
  transform: rotate(-12deg); opacity: 0; }
.cfx-trX, .cfx-trY { left: 0; top: 0; }
.cfx-dot { left: -14px; top: -14px; width: 28px; height: 28px; border-radius: 50%; opacity: 0; background: radial-gradient(#fff 22%, var(--bS) 46%, rgba(255,255,255,0) 70%); }
.cfx-flash { left: calc(var(--cw) * -.85); top: calc(var(--ch) * -.72); width: calc(var(--cw) * 1.7); height: calc(var(--ch) * 1.44); opacity: 0;
  background: radial-gradient(closest-side, #fff 45%, rgba(255,255,255,.7) 68%, rgba(255,255,255,0)); }
.cfx-ring { left: calc(var(--ch) * -.5); top: calc(var(--ch) * -.5); width: var(--ch); height: var(--ch); border-radius: 50%; opacity: 0;
  border: 5px solid #fff; box-shadow: 0 0 22px var(--b), inset 0 0 22px var(--b); }
.cfx-p { left: -7px; top: -7px; width: 14px; height: 14px; border-radius: 50%; opacity: 0; background: radial-gradient(#fff 30%, var(--pc) 58%, rgba(255,255,255,0) 72%); }
.cfx-p.star { left: -10px; top: -10px; width: 20px; height: 20px; border-radius: 0; background: none; color: var(--pc); }
.cfx-tw { width: 26px; height: 26px; margin: -13px 0 0 -13px; color: #fff; opacity: 0; }
.cfx-tw::before { content: ""; position: absolute; inset: -10px; border-radius: 50%; background: radial-gradient(closest-side, var(--bA), transparent); }
.cfx svg { position: relative; width: 100%; height: 100%; fill: currentColor; }
/* the words: the card's name on a candy pill (light top, deeper bottom), what it does on a cream tag */
.cfx-lab { left: -50vw; width: 100vw; display: flex; flex-direction: column; align-items: center; gap: 7px; }
.cfx-lab > * { position: relative; }
.cfx-top { bottom: calc(var(--ch) / 2 + 14px); }
.cfx-bot { top: calc(var(--ch) / 2 + 14px); }
.cfx-hd { display: flex; align-items: center; gap: .3em; padding: .34em .9em .44em; border-radius: 999px; opacity: 0;
  font: 400 clamp(16px, 2.9vh, 22px)/1 var(--title, "Bagel Fat One"), system-ui; color: #fff; text-shadow: 0 2px 0 #cf4f78;
  background: linear-gradient(180deg, #ffb0c4, #f6789c 55%, #e65b85); box-shadow: inset 0 -3px 0 rgba(150,30,70,.18), inset 0 2px 0 rgba(255,255,255,.45), 0 6px 14px rgba(70,40,15,.25); }
.cfx-hd svg { width: 1em; height: 1em; }
.cfx.gold .cfx-hd { color: #6b4706; text-shadow: 0 1.5px 0 rgba(255,255,255,.55);
  background: linear-gradient(180deg, #fff1ad, #ffd34f 55%, #f2ab1f); box-shadow: inset 0 -3px 0 rgba(160,95,0,.25), inset 0 2px 0 rgba(255,255,255,.6), 0 6px 14px rgba(120,80,10,.3); }
.cfx-name { padding: .12em .8em .24em; border-radius: 999px; opacity: 0; white-space: nowrap;
  font: 400 clamp(22px, 4.6vh, 34px)/1.1 var(--title, "Bagel Fat One"), system-ui; color: #fff; text-shadow: 0 2px 0 var(--cD);
  background: linear-gradient(180deg, var(--cL), var(--c) 56%, var(--cM)); box-shadow: inset 0 -4px 0 var(--cD), inset 0 2px 0 rgba(255,255,255,.5), 0 8px 18px rgba(70,40,15,.28); }
.cfx-tip { max-width: min(86vw, 400px); padding: 6px 14px 8px; border-radius: 14px; opacity: 0; text-align: center;
  font: 800 clamp(13px, 2.2vh, 16px)/1.25 Nunito, ui-rounded, system-ui, sans-serif; color: var(--ink, #5b4535);
  background: var(--card, #fffcf6); box-shadow: inset 0 -3px 0 var(--lip, #ead7b6), 0 6px 14px rgba(70,40,15,.22); }
@media (max-height: 460px) { .cfx-lab { gap: 5px; } .cfx-top { bottom: calc(var(--ch) / 2 + 10px); } .cfx-bot { top: calc(var(--ch) / 2 + 10px); } .cfx-tip { padding: 4px 12px 6px; } }
/* reduced motion: no turning, the face fades in over the back */
.cfx.calm :is(.cfx-side, .cfx-rev) { transform: none; } .cfx.calm .cfx-slab { display: none; } .cfx.calm .cfx-side { -webkit-backface-visibility: visible; backface-visibility: visible; }
`;

const STAR = '<svg viewBox="0 0 24 24"><path d="M11.1 2.6a1 1 0 0 1 1.8 0l2.4 4.9 5.4.8a1 1 0 0 1 .6 1.7l-3.9 3.8.9 5.4a1 1 0 0 1-1.5 1L12 17.7l-4.8 2.5a1 1 0 0 1-1.5-1l.9-5.4-3.9-3.8a1 1 0 0 1 .6-1.7l5.4-.8z"/></svg>';
const SPARKLE = '<svg viewBox="0 0 24 24"><path d="M12 1c.7 6 4.2 9.6 10.5 11-6.3 1.4-9.8 5-10.5 11-.7-6-4.2-9.6-10.5-11C7.8 10.6 11.3 7 12 1z"/></svg>';
const SKIP_RATE = 4; // a tap before the flip fast-forwards to it (the face still shows for a blink), after it goes straight to the fly-out
const KEYS = ['Space', 'Enter', 'NumpadEnter', 'Escape'];

const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const mix = (a, b, t) => '#' + rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
const rgba = (hex, a) => `rgba(${rgb(hex).join(',')},${a})`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createCardFx({ sfx, art, jokers }) {
  const artOf = k => new URL(typeof art === 'function' ? art(k) : `${art || 'assets/cards/'}${k}.webp`, location.href).href;
  // warm the images now (and keep hold of them), so the face is ready the moment it flips
  const warm = ['back', ...Object.keys(jokers || {})].map(k => Object.assign(new Image(), { src: artOf(k) }));
  const ui = (name, vol) => { try { sfx?.ui?.(name, vol); } catch {} };
  let queue = Promise.resolve(); // (two pickups in a row play one after the other)

  function reveal(opts) {
    const run = queue.then(() => play(opts || {}));
    queue = run.catch(() => {});
    return run;
  }

  async function play({ kind, from, to, isNew = false, gold = false }) {
    const J = jokers?.[kind] || { name: 'Card', color: '#ffc43d', tip: '' };
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const W = innerWidth, H = innerHeight;
    // the card's size: as big as fits with its words, never huge on a big screen
    const ch = Math.round(clamp(Math.min(H * .44, W * .5 / .72), 130, 300)), cw = Math.round(ch * .72);
    const sx = Math.round(W / 2), sy = Math.round(H / 2 - (isNew || gold ? 14 : 26));
    const beam = gold ? '#ffc93d' : J.color, face = artOf(kind), back = artOf('back');
    const tip = J.tip ? J.tip[0].toUpperCase() + J.tip.slice(1) : '';

    if (!document.getElementById('cardfx-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'cardfx-css', textContent: CSS }));
    const root = document.createElement('div');
    root.className = 'cfx' + (calm ? ' calm' : '') + (gold ? ' gold' : '');
    root.setAttribute('role', 'status');
    root.setAttribute('aria-label', `${gold ? 'Golden card' : isNew ? 'New card' : 'Card'}: ${J.name}. ${tip}`);
    const vars = { cw: cw + 'px', ch: ch + 'px', r: Math.round(Math.min(W, H) * 1.3) + 'px', c: J.color, cL: mix(J.color, '#ffffff', .4), cM: mix(J.color, '#7a4a22', .14), cD: mix(J.color, '#5b3418', .34),
      b: rgba(beam, .78), bS: beam, bL: rgba(mix(beam, '#ffffff', .55), .95), bP: rgba(beam, .3), bA: rgba(mix(beam, '#ffffff', .25), .62), bB: rgba(beam, .22), ray: rgba(mix(beam, '#ffffff', .6), .42) };
    root.style.cssText = Object.entries(vars).map(([k, v]) => `--${k}:${v}`).join(';');

    // little bursts of light around the flip: dots and stars thrown outward (more, and gold, for a golden card)
    const nBurst = calm ? 0 : gold ? 22 : 14, burstCols = gold ? ['#ffd34f', '#ffffff', '#fff1ad'] : [J.color, '#ffffff', mix(J.color, '#ffffff', .5)];
    const burst = Array.from({ length: nBurst }, (_, i) => `<i class="cfx-p${i % 3 === 0 ? ' star' : ''}" style="--pc:${burstCols[i % 3]}">${i % 3 === 0 ? SPARKLE : ''}</i>`).join('');
    // twinkles around the card while it shows (spots in card sizes, so they hug it at any size)
    const twinkleAt = [[-.66, -.34], [.62, -.44], [.7, .16], [-.6, .3], [.18, -.62], [-.24, .58], [.5, .5], [-.5, -.6]].slice(0, gold ? 8 : 6);
    const twinkles = twinkleAt.map(([x, y]) => `<i class="cfx-tw" style="left:calc(var(--cw) * ${x});top:calc(var(--ch) * ${y})">${SPARKLE}</i>`).join('');
    // a comet tail of light dots that follows the card into the dock
    const trail = calm ? '' : '<i class="cfx-trX"><i class="cfx-trY"><i class="cfx-dot"></i></i></i>'.repeat(5);
    const motes = calm ? '' : Array.from({ length: 6 }, (_, i) => `<i class="cfx-mote" style="left:${30 + (i * 37) % 42}%"></i>`).join('');
    root.innerHTML = `<div class="cfx-dim"></div>
      <div class="cfx-stage" style="left:${sx}px;top:${sy}px">
        <div class="cfx-glow"></div>
        <div class="cfx-raysW"><div class="cfx-rays"></div></div>
        <div class="cfx-pillar" style="top:${-sy - 40}px;height:${H + 80}px"><div class="cfx-beam"></div><div class="cfx-core"></div>${motes}</div>
        <div class="cfx-ring"></div>${burst}${trail}
        <div class="cfx-fly"><div class="cfx-flyY"><div class="cfx-scale">
          <div class="cfx-card">
            <div class="cfx-slab" style="transform:translateZ(-1.5px)"></div><div class="cfx-slab" style="transform:translateZ(1.5px)"></div>
            <div class="cfx-side"><img alt="" draggable="false" src="${back}"></div>
            <div class="cfx-side cfx-rev"><img alt="" draggable="false" src="${back}"><img class="cfx-face" alt="" draggable="false" src="${face}"><div class="cfx-shine" style="-webkit-mask-image:url('${face}');mask-image:url('${face}')"><i></i></div></div>
          </div>
          ${gold ? '<div class="cfx-halo"></div>' : ''}${isNew ? '<b class="cfx-new">NEW</b>' : ''}
        </div></div></div>
        <div class="cfx-flash"></div>${twinkles}
        ${isNew || gold ? `<div class="cfx-lab cfx-top"><div class="cfx-hd">${gold ? STAR : SPARKLE}${gold ? 'Golden card!' : 'New card!'}</div></div>` : ''}
        <div class="cfx-lab cfx-bot"><div class="cfx-name">${J.name}</div>${tip ? `<div class="cfx-tip">${tip}</div>` : ''}</div>
      </div>`;
    const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
    const el = { dim: $('.cfx-dim'), glow: $('.cfx-glow'), raysW: $('.cfx-raysW'), rays: $('.cfx-rays'), pillar: $('.cfx-pillar'), beam: $('.cfx-beam'), core: $('.cfx-core'),
      ring: $('.cfx-ring'), fly: $('.cfx-fly'), flyY: $('.cfx-flyY'), scale: $('.cfx-scale'), card: $('.cfx-card'), face: $('.cfx-face'), shine: $('.cfx-shine i'),
      newTag: $('.cfx-new'), halo: $('.cfx-halo'), flash: $('.cfx-flash'), hd: $('.cfx-hd'), name: $('.cfx-name'), tip: $('.cfx-tip') };
    const words = [el.hd, el.name, el.tip, el.newTag].filter(Boolean);

    // ---- timing: every step's animations are tracked, so a tap can fast-forward them; loops (rays, motes) are not ----
    const live = new Set(), loops = [];
    let fast = false, leaving = false, rushed = false, wake = null;
    const run = (node, frames, o) => {
      const a = node.animate(frames, { fill: 'both', ...o });
      if (rushed) a.finish(); else if (fast) a.playbackRate = SKIP_RATE;
      live.add(a); a.finished.catch(() => {}).then(() => live.delete(a));
      return a;
    };
    const loop = (node, frames, o) => { const a = node.animate(frames, { iterations: Infinity, ...o }); loops.push(a); return a; };
    const done = a => a.finished.catch(() => {});
    const hold = ms => fast || rushed ? Promise.resolve() : new Promise(r => { const t = setTimeout(r, ms); wake = () => { clearTimeout(t); r(); }; });
    const t0 = performance.now();
    const skip = () => {
      if (leaving || fast || performance.now() - t0 < 200) return; // (a swipe that was already under way doesn't skip it)
      fast = true;
      for (const a of live) a.updatePlaybackRate(SKIP_RATE);
      wake?.();
    };
    const onKey = e => { if (!KEYS.includes(e.code)) return; e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) skip(); }; // (the game never sees them meanwhile)
    const onPointer = e => { e.preventDefault(); e.stopPropagation(); skip(); };
    const stop = e => e.stopPropagation();
    addEventListener('keydown', onKey, true);
    root.addEventListener('pointerdown', onPointer); root.addEventListener('click', stop);
    // (a hidden tab barely runs animations: never leave the game waiting behind it)
    const watchdog = setTimeout(() => { rushed = true; for (const a of [...live]) try { a.finish(); } catch {} wake?.(); }, 4500);
    document.body.appendChild(root);

    const known = from && isFinite(from.x) && isFinite(from.y), fx = known ? from.x - sx : 0, fy = known ? from.y - sy : H * .12; // (no 'from': it rises from below)
    const faceReady = (el.face.decode?.() || Promise.resolve()).catch(() => {});

    if (calm) {
      // ---- reduced motion: fade in, cross-fade to the face, hold, fade out ----
      run(el.dim, [{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
      run(el.glow, [{ opacity: 0 }, { opacity: .8 }], { duration: 260 });
      run(el.pillar, [{ opacity: 0 }, { opacity: .8 }], { duration: 260 });
      run(el.raysW, [{ opacity: 0 }, { opacity: .45 }], { duration: 300 });
      await done(run(el.scale, [{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' }));
      await Promise.race([faceReady, new Promise(r => setTimeout(r, 300))]);
      ui('chime', gold ? .45 : .38);
      run(el.flash, [{ opacity: 0 }, { opacity: .55 }, { opacity: 0 }], { duration: 360 });
      run(el.face, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 80 });
      if (el.halo) run(el.halo, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 80 });
      words.forEach((w, i) => run(w, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 120 + i * 40 }));
      await hold(260 + 650);
      leaving = true; fast = false;
      const fade = [{ opacity: 1 }, { opacity: 0 }];
      for (const n of [el.dim, el.glow, el.pillar, el.raysW, ...words]) run(n, fade, { duration: 220 });
      await done(run(el.scale, fade, { duration: 220 }));
      dockPop(rectOf(to), beam, true);
    } else {
      // ---- 1. out of the world: the back spins toward you, growing, while the light rises behind ----
      ui('whoosh', .3);
      run(el.dim, [{ opacity: 0 }, { opacity: 1 }], { duration: 340, easing: 'ease-out' });
      run(el.glow, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 420, delay: 120, easing: 'cubic-bezier(.2,.8,.3,1)' });
      run(el.pillar, [{ opacity: 0, transform: 'scale(.35, 0)' }, { opacity: 1, transform: 'scale(1.25, .6)', offset: .45 }, { opacity: 1, transform: 'scale(1, 1)' }], { duration: 380, delay: 110, easing: 'cubic-bezier(.2,.75,.3,1)' });
      run(el.core, [{ opacity: 0 }, { opacity: 1, offset: .35 }, { opacity: .55 }], { duration: 520, delay: 110 });
      run(el.raysW, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: gold ? 1 : .85, transform: 'scale(1)' }], { duration: 640, delay: 200, easing: 'cubic-bezier(.2,.8,.3,1)' });
      loop(el.rays, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 18000 });
      $$('.cfx-mote').forEach((m, i) => loop(m, [{ transform: 'translateY(0) scale(.6)', opacity: 0 }, { opacity: .9, offset: .25 }, { transform: `translateY(${-(H * .75) | 0}px) scale(1.1)`, opacity: 0 }],
        { duration: 1100 + (i % 3) * 260, delay: 200 + i * 170, easing: 'cubic-bezier(.3,.5,.6,1)' }));
      const hop = Math.min(fy, 0) * .5 - ch * .3; // (a little hop up first, like the key's)
      run(el.fly, [{ transform: `translateX(${fx}px)` }, { transform: 'translateX(0)' }], { duration: 480, easing: 'cubic-bezier(.3,.7,.3,1)' });
      run(el.flyY, [{ transform: `translateY(${fy}px)`, easing: 'cubic-bezier(.25,.6,.45,1)' }, { transform: `translateY(${hop}px)`, offset: .32, easing: 'cubic-bezier(.4,0,.3,1)' }, { transform: 'translateY(0)' }], { duration: 480 });
      run(el.card, [{ transform: 'rotateX(16deg) rotateY(-720deg)' }, { transform: 'rotateX(0deg) rotateY(0deg)' }], { duration: 520, easing: 'cubic-bezier(.2,.6,.25,1)' });
      const grow = run(el.scale, [{ transform: 'scale(.18) rotate(-16deg)', opacity: 0 }, { opacity: 1, offset: .12 }, { transform: 'scale(1.1) rotate(3deg)', offset: .62 }, { transform: 'scale(.97) rotate(-1deg)', offset: .82 }, { transform: 'scale(1) rotate(0)', opacity: 1 }],
        { duration: 520, easing: 'cubic-bezier(.3,.6,.4,1)' });
      await done(grow);
      await Promise.race([faceReady, new Promise(r => setTimeout(r, 300))]);

      // ---- 2. the flip: a squash, the turn, a white flash when it's edge-on, the face ----
      el.face.style.opacity = 1; // (the face is on the far side right now: nobody sees it switch on)
      const flipMs = 300;
      const flip = run(el.card, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }], { duration: flipMs, easing: 'cubic-bezier(.5,0,.3,1)' });
      run(el.scale, [{ transform: 'scale(1)' }, { transform: 'scale(.93, 1.04)', offset: .18 }, { transform: 'scale(1.16)', offset: .55 }, { transform: 'scale(1)' }], { duration: flipMs + 80, easing: 'ease-out' });
      run(el.flyY, [{ transform: 'translateY(0)' }, { transform: 'translateY(-12px)', offset: .5 }, { transform: 'translateY(0)' }], { duration: flipMs + 80, easing: 'ease-in-out' });
      const edge = flipMs * .5; // (when it's edge-on)
      setTimeout(() => ui('chime', gold ? .5 : .42), fast ? 0 : edge - 40);
      run(el.flash, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1.05)', offset: .4 }, { opacity: 0, transform: 'scale(1.35)' }], { duration: 520, delay: edge - 160, easing: 'ease-out' });
      run(el.ring, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, offset: .12 }, { opacity: 0, transform: `scale(${gold ? 2.6 : 2.1})` }], { duration: gold ? 760 : 620, delay: edge - 30, easing: 'cubic-bezier(.15,.7,.3,1)' });
      run(el.beam, [{ transform: 'scaleX(1)' }, { transform: `scaleX(${gold ? 1.7 : 1.45})`, offset: .3 }, { transform: 'scaleX(1)' }], { duration: 560, delay: edge - 60, easing: 'ease-out' });
      run(el.core, [{ opacity: .55 }, { opacity: 1, offset: .3 }, { opacity: .6 }], { duration: 560, delay: edge - 60 });
      run(el.glow, [{ transform: 'scale(1)' }, { transform: `scale(${gold ? 1.35 : 1.22})`, offset: .3 }, { transform: 'scale(1.05)' }], { duration: 620, delay: edge - 60, easing: 'ease-out' });
      $$('.cfx-p').forEach((p, i) => {
        const a = (i / nBurst) * 360 + (i % 2 ? 9 : -9), d = ch * (gold ? .75 : .62) * (.7 + ((i * 7) % 5) / 8), s = p.classList.contains('star') ? 1.1 : .9 + (i % 3) * .2;
        run(p, [{ opacity: 1, transform: `rotate(${a}deg) translateX(${ch * .12}px) scale(.3)` }, { opacity: 1, transform: `rotate(${a}deg) translateX(${d * .8}px) scale(${s})`, offset: .55 }, { opacity: 0, transform: `rotate(${a + 14}deg) translateX(${d}px) scale(0)` }],
          { duration: 640 + (i % 4) * 60, delay: edge - 20, easing: 'cubic-bezier(.15,.75,.3,1)' });
      });
      // the words pop in as the face settles
      const pop = [{ opacity: 0, transform: 'translateY(10px) scale(.6)' }, { opacity: 1, transform: 'translateY(0) scale(1.08)', offset: .6 }, { opacity: 1, transform: 'translateY(0) scale(1)' }];
      if (el.hd) run(el.hd, pop, { duration: 380, delay: edge + 40, easing: 'cubic-bezier(.3,.7,.4,1)' });
      run(el.name, pop, { duration: 400, delay: edge + 100, easing: 'cubic-bezier(.3,.7,.4,1)' });
      if (el.tip) run(el.tip, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 320, delay: edge + 200, easing: 'ease-out' });
      if (el.newTag) run(el.newTag, [{ opacity: 0, transform: 'rotate(-30deg) scale(0)' }, { opacity: 1, transform: 'rotate(-8deg) scale(1.25)', offset: .6 }, { opacity: 1, transform: 'rotate(-12deg) scale(1)' }], { duration: 420, delay: edge + 140, easing: 'cubic-bezier(.3,.7,.4,1)' });
      if (el.halo) run(el.halo, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: edge + 40, easing: 'ease-out' });
      $$('.cfx-tw').forEach((t, i) => loop(t, [{ opacity: 0, transform: 'scale(.2) rotate(0deg)' }, { opacity: 1, transform: 'scale(1) rotate(45deg)', offset: .4 }, { opacity: 0, transform: 'scale(.2) rotate(90deg)' }],
        { duration: 760, delay: edge + 80 + i * 120, easing: 'ease-in-out' }));
      await done(flip);

      // ---- 3. a breath to read it, with a gloss sweeping across the card ----
      run(el.shine, [{ transform: 'translateX(-120%)' }, { transform: 'translateX(220%)' }], { duration: 640, delay: 60, easing: 'cubic-bezier(.45,.1,.35,1)' });
      await hold(isNew ? 700 : 600); // (a first-time card stays a little longer: that's when its tip matters)

      // ---- 4. into the dock: a small lift, then an arc down into its slot ----
      leaving = true; fast = false;
      const slot = rectOf(to);
      const fade = (n, ms, delay = 0) => run(n, [{ opacity: 1 }, { opacity: 0 }], { duration: ms, delay, easing: 'ease-in' });
      words.forEach(w => run(w, [{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(6px) scale(.92)' }], { duration: 160, easing: 'ease-in' }));
      for (const t of $$('.cfx-tw')) t.style.visibility = 'hidden';
      run(el.pillar, [{ opacity: 1, transform: 'scale(1, 1)' }, { opacity: 0, transform: 'scale(0, 1)' }], { duration: 280, easing: 'cubic-bezier(.4,0,.6,1)' });
      run(el.raysW, [{ opacity: gold ? 1 : .85, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.12)' }], { duration: 300, easing: 'ease-in' });
      fade(el.glow, 320); fade(el.dim, 360, 60);
      const out = 400;
      let flight;
      if (slot) {
        const tx = slot.left + slot.width / 2 - sx, ty = slot.top + slot.height / 2 - sy, s = clamp(slot.height / ch, .1, 1);
        const pathX = [{ transform: 'translateX(0)' }, { transform: `translateX(${tx}px)` }], pathXo = { duration: out, easing: 'cubic-bezier(.45,0,.4,1)' };
        const pathY = [{ transform: 'translateY(0)', easing: 'cubic-bezier(.3,.6,.5,1)' }, { transform: `translateY(${-ch * .16}px)`, offset: .26, easing: 'cubic-bezier(.55,0,.75,.5)' }, { transform: `translateY(${ty}px)` }];
        flight = run(el.fly, pathX, pathXo);
        run(el.flyY, pathY, { duration: out });
        $$('.cfx-trX').forEach((t, i) => { // (each dot takes the card's path a beat later, smaller and fainter)
          const delay = 50 + i * 26;
          run(t, pathX, { ...pathXo, delay }); run(t.firstChild, pathY, { duration: out, delay });
          run(t.firstChild.firstChild, [{ opacity: 0, transform: `scale(${1.3 - i * .16})` }, { opacity: 1 - i * .1, offset: .2 }, { opacity: 0, transform: 'scale(.3)', offset: .85 }, { opacity: 0, transform: 'scale(.3)' }], { duration: out, delay });
        });
        run(el.scale, [{ transform: 'scale(1) rotate(0)' }, { transform: 'scale(1.05) rotate(4deg)', offset: .2 }, { transform: `scale(${(1 + s) * .45}) rotate(-10deg)`, offset: .6 }, { transform: `scale(${s}) rotate(0)` }], { duration: out, easing: 'ease-in-out' });
        run(el.card, [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(205deg)', offset: .5 }, { transform: 'rotateY(180deg)' }], { duration: out, easing: 'ease-in-out' });
      } else { // (no dock to fly to: it floats up and fades)
        flight = run(el.flyY, [{ transform: 'translateY(0)' }, { transform: `translateY(${-ch * .9}px)` }], { duration: out, easing: 'cubic-bezier(.4,0,.6,1)' });
        run(el.scale, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.55)', opacity: 0 }], { duration: out, easing: 'ease-in' });
      }
      await done(flight);
      ui('pop', .38);
      dockPop(slot, beam, false);
    }

    // ---- 5. gone: everything we added goes away, the game carries on ----
    clearTimeout(watchdog);
    removeEventListener('keydown', onKey, true);
    for (const a of [...live, ...loops]) try { a.cancel(); } catch {}
    root.remove();
    document.getElementById('cardfx-css')?.remove();
  }

  function rectOf(to) {
    try { const r = to?.(); return r && r.width > 0 && r.height > 0 ? r : null; } catch { return null; }
  }

  // the card lands: a glow, a ring and a few sparks pop at its slot (on their own, so the game carries on meanwhile)
  function dockPop(r, color, calm) {
    if (!r) return;
    const x = r.left + r.width / 2, y = r.top + r.height / 2, d = Math.max(r.width, r.height) * 1.3;
    const make = (size, css) => { const n = document.createElement('div'); n.style.cssText = `position:fixed;left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;z-index:36;pointer-events:none;${css}`; document.body.appendChild(n); return n; };
    const parts = [[make(d, `border-radius:50%;background:radial-gradient(closest-side,rgba(255,255,255,.95),${rgba(color, .6)} 50%,${rgba(color, 0)})`),
      calm ? [{ opacity: 0 }, { opacity: .9 }, { opacity: 0 }] : [{ opacity: 1, transform: 'scale(.6)' }, { opacity: .9, transform: 'scale(1.1)', offset: .3 }, { opacity: 0, transform: 'scale(1.6)' }], 460]];
    if (!calm) {
      parts.push([make(d, `border-radius:50%;border:5px solid ${color};box-shadow:0 0 0 2px rgba(255,255,255,.9),inset 0 0 0 2px rgba(255,255,255,.9)`), [{ opacity: 1, transform: 'scale(.3)' }, { opacity: 0, transform: 'scale(1.45)' }], 440]);
      for (let i = 0; i < 6; i++) {
        const a = i * 60 + 30, far = d * .62;
        parts.push([make(16, `color:${color}`), [{ opacity: 1, transform: `rotate(${a}deg) translateX(${d * .25}px) scale(.4)` }, { opacity: 1, transform: `rotate(${a}deg) translateX(${far * .85}px) scale(1)`, offset: .5 }, { opacity: 0, transform: `rotate(${a + 20}deg) translateX(${far}px) scale(0)` }], 480]);
        parts.at(-1)[0].innerHTML = SPARKLE.replace('<svg', '<svg style="display:block;width:100%;height:100%;fill:currentColor"');
      }
    }
    for (const [n, frames, ms] of parts) {
      const a = n.animate(frames, { duration: ms, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
      const gone = () => n.remove(); a.finished.then(gone, gone); setTimeout(gone, ms + 600); // (also if the tab hides mid-way)
    }
  }

  return { reveal };
}
