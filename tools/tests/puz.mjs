// the card puzzles: plan over the game; misty level 6 (Lantern in hand, glowing trail); sealed level 8 (key walled
// in, Hammer opens it); den level 15 (grumpy wolf, Wall traps it)
import { webkit, devices } from 'playwright';
const b = await webkit.launch(); const p = await (await b.newContext(devices['iPhone 13'])).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message + ' ' + (e.stack || '').split('\n')[1]));
await p.addInitScript(() => { const s = {}; for (const k of ['intro', 'first-door', 'first-wolf', 'card-light', 'card-smash', 'card-build', 'card-freeze', 'card-dash', 'fungus-wolf', 'found-frog']) s[k] = 1; localStorage.setItem('buddy-story', JSON.stringify(s)); localStorage.setItem('buddy-gift-day', JSON.stringify(new Date().toDateString())); localStorage.setItem('buddy-jokers', '[]'); });
await p.goto(process.argv[2], { waitUntil: 'load' }); await p.waitForFunction(() => window.__game && window.__game.play, null, { timeout: 90000 }); await p.waitForTimeout(1200);
const out = await p.evaluate(async () => { const G = window.__game, wait = ms => new Promise(r => setTimeout(r, ms)), res = {};
  res.plan = Array.from({ length: 60 }, (_, L) => G.levelPlan(L)).map((P, L) => P.puzzle ? `${L + 1}:${P.puzzle}${P.handCard ? '*' : ''}` : null).filter(Boolean).join(' ');
  const skip = async () => { await wait(1500); while (document.getElementById('tourCap').classList.contains('on')) { document.getElementById('tourCap').click(); await wait(80); } G.intro.t = -1; await wait(300); };
  // misty
  G.play(5); await skip(); await wait(1300);
  res.misty = { reveal: G.levelPlan(5).reveal, bag: G.joker.bag.slice() };
  document.querySelector('[data-j="light"]')?.click(); await wait(600);
  res.misty.trail = G.scene.children.filter(o => o.isGroup && o.children.length && o.children[0].isSprite && o.children[0].material.blending === 2).map(o => o.children.length)[0] || 0;
  // sealed
  G.play(7); await skip(); await wait(1300);
  const crack = G.puzzles.firstCrack(), m = G.maze, N = m.N;
  const reach = () => { const d = new Int32Array(N * N).fill(-1), q = [G.st.gz * N + G.st.gx]; d[q[0]] = 0; for (let h = 0; h < q.length; h++) { const i = q[h], x = i % N, z = (i / N) | 0; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Z = z + dz, j = Z * N + X; if (X >= 0 && Z >= 0 && X < N && Z < N && !m.g[j] && d[j] < 0) { d[j] = 1; q.push(j); } } } return d[G.keyAtNow[1] * N + G.keyAtNow[0]] >= 0; };
  res.sealed = { crack, keyReachableBefore: reach(), bag: G.joker.bag.slice() };
  if (crack) { G.joker.smashAt(crack[0], crack[1], false); res.sealed.keyReachableAfter = reach(); }
  // den
  G.play(14); await skip(); await wait(2500);
  const D = G.puzzles.den; res.den = { found: !!D, wolves: G.wolves.map(w => (w.angry ? 'angry:' : '') + w.route.length), bag: G.joker.bag.slice() };
  if (D) { const w = G.wolves.find(w => w.angry); w.x = w.fx = D.route[0][0]; w.z = w.fz = D.route[0][1]; w.t = 1; const ok = G.joker.buildAt(D.mouth[0], D.mouth[1], false); await wait(4000); res.den.wallUp = ok; res.den.wolfStayedIn = !D.route.slice(-2).some(([x, z]) => x === w.x && z === w.z); }
  return res; });
console.log(JSON.stringify(out, null, 1), errs.slice(0, 3)); await b.close();
