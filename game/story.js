// Buddy's little story: told in Ooblets-style speech bubbles (a name tag, a portrait window, text that types in).
// Wolves with glowing mushroom eyes stormed Buddy's village and scattered his four friends across the worlds; each
// world's last level is where its friend is found. Scenes play once (remembered in localStorage); found friends show
// as stickers on the map, and tapping a sticker plays that meeting again.
const A = 'assets/story/';
export const FRIENDS = [ // one per world, in world order
  { id: 'frog', name: 'Frog', color: '#5fb54f', sticker: A + 'sticker-frog.webp' },
  { id: 'fennec', name: 'Fennec', color: '#eb9a2c', sticker: A + 'sticker-fennec.webp' },
  { id: 'bear', name: 'Bear', color: '#58aee0', sticker: A + 'sticker-bear.webp' },
  { id: 'cat', name: 'Cat', color: '#e8823a', sticker: A + 'sticker-cat.webp' },
];
const WHO = {
  buddy: { name: 'Buddy', color: '#9c84ee' }, // (his picture is a render of the 3D model, handed in by the game)
  wolf: { name: 'Wolves', color: '#6f7f95', pic: A + 'sticker-wolf.webp' },
  frog: { ...FRIENDS[0], pic: A + 'portrait-frog.webp' },
  fennec: { ...FRIENDS[1], pic: A + 'portrait-fennec.webp' },
  bear: { ...FRIENDS[2], pic: A + 'sticker-bear.webp' },
  cat: { ...FRIENDS[3], pic: A + 'portrait-cat.webp' },
};
// a line: [who, text, picture or clip override]. 'who' null = the storyteller (no name tag)
export const SCENES = {
  intro: [
    ['wolf', 'One misty night, wolves with glowing mushroom eyes stormed Buddy’s quiet village…'],
    [null, 'By morning, his four best friends were gone, scattered across the worlds.'],
    ['buddy', 'Frog… Fennec… Bear… Cat… Hold on, everyone. I’m coming to find you!'],
    ['buddy', 'The paths here hide under the ground. I’ll have to remember the way.'],
  ],
  'found-frog': [
    ['frog', 'Buddy! Over here! I hid under the moss for three whole days!'],
    ['buddy', 'Frog! You’re safe!'],
    ['frog', 'I saw Fennec running toward the Sunny Dunes. Let’s go find her!'],
  ],
  'arrive-desert': [['frog', 'So much sand… my feet are toasty! Fennec must be close.']],
  'found-fennec': [
    ['fennec', 'Psst! Buddy! I knew these big ears would hear you coming.', 'clip-fennec-wave.mp4'],
    ['fennec', 'The wolves dug tunnels under the sand. Their mushrooms glow down there.'],
    ['buddy', 'Then we stay up here in the sun. Have you seen Bear?'],
    ['fennec', 'Up on Frost Peak. He looked so cold…'],
  ],
  'arrive-snow': [['fennec', 'Brrr! My ears are freezing. Bear has to be up here somewhere.']],
  'found-bear': [
    ['bear', 'Buddy…? I got so lost in the snow. Every path looked the same.', 'clip-bear-sad.mp4'],
    ['buddy', 'That’s okay. We’ll remember the way together.'],
    ['bear', '…Thank you. Cat went to the Autumn Grove. She’ll be hiding somewhere cozy.'],
  ],
  'arrive-autumn': [['bear', 'Crunchy leaves everywhere. Cat loves crunchy leaves.']],
  'found-cat': [
    ['cat', 'Took you long enough! I was just about to come rescue YOU.', 'clip-cat-tilt.mp4'],
    ['buddy', 'Cat! Now everyone’s together again!'],
    ['cat', 'Hmm… but those glowing mushrooms came from deep under the ground. Something’s still down there.', 'portrait-cat-think.webp'],
    ['buddy', 'Then we’ll go and see. All five of us, together!'],
  ],
};
// which scene a level starts with (first time only), and which one its win brings
export const startScene = (L, perWorld) => L === 0 ? 'intro' : L % perWorld === 0 ? ['', 'arrive-desert', 'arrive-snow', 'arrive-autumn'][L / perWorld] || null : null;
export const winScene = (L, perWorld) => (L + 1) % perWorld === 0 ? `found-${FRIENDS[(L + 1) / perWorld - 1]?.id}` : null;

export function createStory({ layer, sfx, buddyPic }) {
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem('buddy-story') || '{}') || {}; } catch {}
  const remember = id => { seen[id] = 1; try { localStorage.setItem('buddy-story', JSON.stringify(seen)); } catch {} };
  const calm = matchMedia('(prefers-reduced-motion: reduce)');

  layer.innerHTML = `<div class="talk" role="dialog" aria-live="polite">
      <div class="tpic"><img alt=""><video muted playsinline loop preload="none"></video></div>
      <div class="tbub"><span class="tname"></span><p class="ttext"></p><i class="tnext"></i></div>
    </div><button class="tskip" type="button">Skip<svg class="ico"><use href="#i-next"/></svg></button>`;
  const $ = s => layer.querySelector(s), talk = $('.talk'), pic = $('.tpic'), img = $('.tpic img'), vid = $('.tpic video');
  const nameEl = $('.tname'), textEl = $('.ttext');

  let lines = null, i = 0, shown = 0, full = '', timer = 0, done = null;
  function setPic(src) {
    const clip = src && src.endsWith('.mp4');
    pic.classList.toggle('none', !src);
    if (clip) { // (its first frame is shown as a still while the clip loads, or if the phone won't play it)
      if (!vid.src.endsWith(src)) { vid.poster = A + src.replace('.mp4', '.webp'); vid.src = A + src; }
      vid.style.display = ''; img.style.display = 'none'; vid.play().catch(() => {});
    }
    else { vid.pause(); vid.style.display = 'none'; img.style.display = ''; if (src) img.src = src; }
  }
  function line() {
    const [who, text, over] = lines[i], W = who ? WHO[who] : null;
    talk.classList.toggle('narr', !W);
    talk.style.setProperty('--who', W ? W.color : '#cdbba3');
    nameEl.textContent = W ? W.name : '';
    const src = over ? (over.includes('/') ? over : (over.endsWith('.mp4') ? over : A + over)) : who === 'buddy' ? buddyPic() : W && W.pic;
    setPic(src);
    talk.classList.remove('pop'); void talk.offsetWidth; talk.classList.add('pop'); // (a little bounce for every new line)
    full = text; shown = calm.matches ? full.length : 0; type();
  }
  function type() { // letters type in; a soft tick every few letters
    clearTimeout(timer);
    textEl.textContent = full.slice(0, shown);
    talk.classList.toggle('typing', shown < full.length);
    if (shown >= full.length) return;
    if (shown % 4 === 0 && full[shown] !== ' ') sfx.ui('hover', 0.12);
    shown++; timer = setTimeout(type, /[.,!?…]/.test(full[shown - 2]) ? 120 : 26);
  }
  function next() {
    if (!lines) return;
    if (shown < full.length) { shown = full.length; type(); return; } // first tap shows the whole line
    if (++i < lines.length) return line();
    end();
  }
  function end() {
    clearTimeout(timer); vid.pause(); lines = null;
    layer.classList.remove('on'); document.body.classList.remove('talking'); sfx.ui('whoosh', 0.3);
    const d = done; done = null; d && d();
  }
  layer.addEventListener('click', e => { e.stopPropagation(); if (e.target.closest('.tskip')) end(); else next(); });
  // while a scene is open it owns the keyboard (no walking, no pausing underneath)
  addEventListener('keydown', e => {
    if (!lines) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') end(); else if (['Space', 'Enter', 'NumpadEnter', 'KeyE', 'ArrowRight', 'KeyD'].includes(e.code)) next();
  }, true);

  return {
    get open() { return !!lines; },
    seen: id => !!seen[id],
    // plays a scene (once, unless replay) and resolves when it's closed
    play(id, { replay = false } = {}) {
      if (!SCENES[id] || (seen[id] && !replay) || lines) return Promise.resolve(false);
      remember(id);
      lines = SCENES[id]; i = 0;
      layer.classList.add('on'); document.body.classList.add('talking'); sfx.ui('pop', 0.4);
      line();
      return new Promise(res => { done = () => res(true); });
    },
  };
}
