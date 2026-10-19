// the card tutorials: the card is in your hand, the guide points at the right thing at each step, and the card works
import { webkit } from 'playwright';
const b = await webkit.launch(); const p = await (await b.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.addInitScript(() => { const s = {}; for (const k of ['intro','first-door','first-wolf','card-light','card-smash','card-freeze','card-build','card-dash','fungus-wolf','arrive-desert','arrive-snow','arrive-autumn','found-frog','found-fennec','found-bear','found-cat','the-end']) s[k] = 1; localStorage.setItem('buddy-story', JSON.stringify(s)); localStorage.setItem('buddy-gift-day', JSON.stringify(new Date().toDateString())); localStorage.setItem('buddy-jokers', '[]'); });
await p.goto(process.argv[2], { waitUntil: 'load' }); await p.waitForFunction(() => window.__game && window.__game.play, null, { timeout: 90000 }); await p.waitForTimeout(1200);
const shot = async n => p.screenshot({ path: `${process.argv[3] || '.'}/tut_${n}.png` });
const g = () => p.evaluate(() => ({ on: document.getElementById('guide').classList.contains('on'), text: document.getElementById('guideBub').textContent }));
const start = async L => p.evaluate(async L => { const G = window.__game; await G.play(L); await new Promise(r => setTimeout(r, 1500)); for (let i = 0; i < 20 && (G.intro.t >= 0 || G.tour.shots); i++) { document.getElementById('tourCap').click(); if (!G.tour.shots) G.intro.t = -1; await new Promise(r => setTimeout(r, 150)); } return { plan: (({ tutorial, puzzle, wolves, cells, handCard }) => ({ tutorial, puzzle, wolves, cells, handCard }))(G.levelPlan(L)), bag: G.joker.bag.slice(), wolves: G.wolves.length, crack: G.puzzles.firstCrack(), den: !!G.puzzles.den }; }, L);
const tp = (x, z) => p.evaluate(([x, z]) => { const G = window.__game; G.st.gx = G.st.tx = G.st.fx = x; G.st.gz = G.st.tz = G.st.fz = z; G.st.moving = false; }, [x, z]);
const out = {};
// level 1: the very first thing
out.L0 = await start(0); await p.waitForTimeout(600); out.L0.guide = await g(); await shot('L0');
// Lantern
out.L6 = await start(6); await p.waitForTimeout(800); out.L6.g1 = await g(); await shot('L6a');
await p.evaluate(() => window.__game.joker.use('light')); await p.waitForTimeout(700); out.L6.g2 = await g(); out.L6.trail = await p.evaluate(() => window.__game.joker.trailOn); await shot('L6b');
// Hammer
out.L11 = await start(11); await p.waitForTimeout(800); out.L11.g1 = await g(); await shot('L11a');
const c = out.L11.crack;
if (c) {
  const adj = await p.evaluate(c => { const G = window.__game, N = G.maze.N; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = c[0] + dx, z = c[1] + dz; if (!G.maze.g[z * N + x] && !(x === G.keyAt[0] && z === G.keyAt[1])) return [x, z, -dx, -dz]; } }, c);
  await tp(adj[0], adj[1]); await p.waitForTimeout(500); out.L11.g2 = await g(); await shot('L11b');
  await p.evaluate(() => window.__game.joker.use('smash')); await p.waitForTimeout(500); out.L11.g3 = await g(); out.L11.ghosts = await p.evaluate(() => window.__game.scene.children.filter(o => o.isMesh && o.material && o.material.blending === 2 && o.visible).length); await shot('L11c');
  await p.evaluate(d => window.__game.joker.aim([[d[0], d[1]]]), [adj[2], adj[3]]); await p.waitForTimeout(500); out.L11.g4 = await g(); out.L11.crackAfter = await p.evaluate(() => window.__game.puzzles.firstCrack());
}
// Snowflake
out.L16 = await start(16); await p.waitForTimeout(800);
const w = await p.evaluate(() => { const w = window.__game.wolves[0]; return w && [w.x, w.z]; });
if (w) { await p.evaluate(w => { const G = window.__game, N = G.maze.N; for (let r = 2; r <= 5; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { if (Math.abs(dx) + Math.abs(dz) !== r) continue; const x = w[0] + dx, z = w[1] + dz; if (x > 0 && z > 0 && x < N && z < N && !G.maze.g[z * N + x]) { G.st.gx = G.st.tx = G.st.fx = x; G.st.gz = G.st.tz = G.st.fz = z; return; } } }, w); }
await p.evaluate(() => window.__game.wolves.forEach(w => { w.wait = 99; })); await p.waitForTimeout(500); out.L16.g1 = await g(); await shot('L16a');
await p.evaluate(() => window.__game.joker.use('freeze')); await p.waitForTimeout(900); out.L16.g2 = await g(); out.L16.iced = await p.evaluate(() => window.__game.wolves.map(w => !!w.iced)); await shot('L16b');
// Wall
out.L21 = await start(21); await p.waitForTimeout(800);
const D = await p.evaluate(() => { const d = window.__game.puzzles.den; return d && { j: d.junction, m: d.mouth, route: d.route }; });
if (D) { await tp(D.j[0] + (D.j[0] === D.route[D.route.length - 1][0] ? 0 : 0), D.j[1]); await p.evaluate(() => window.__game.wolves.forEach(w => { w.wait = 0; }));
  await p.evaluate(D => { const w = window.__game.wolves.find(w => w.angry); if (w) { w.x = w.fx = D.route[0][0]; w.z = w.fz = D.route[0][1]; w.t = 1; w.wait = 99; } }, D);
  // stand two steps back on the way first: the guide says hurry to the door
  await p.waitForTimeout(400); out.L21.g1 = await g(); await shot('L21a');
  await p.evaluate(() => window.__game.joker.use('build')); await p.waitForTimeout(500); out.L21.g2 = await g(); await shot('L21b');
  await p.evaluate(D => window.__game.joker.aim([[D.m[0] - D.j[0], D.m[1] - D.j[1]]]), D); await p.waitForTimeout(500); out.L21.g3 = await g(); await shot('L21c');
}
// Boots
out.L26 = await start(26); await p.waitForTimeout(800);
const w2 = await p.evaluate(() => { const w = window.__game.wolves[0]; return w && [w.x, w.z]; });
if (w2) await p.evaluate(w => { const G = window.__game, N = G.maze.N; for (let r = 3; r <= 6; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { if (Math.abs(dx) + Math.abs(dz) !== r) continue; const x = w[0] + dx, z = w[1] + dz; if (x > 0 && z > 0 && x < N && z < N && !G.maze.g[z * N + x]) { G.st.gx = G.st.tx = G.st.fx = x; G.st.gz = G.st.tz = G.st.fz = z; return; } } }, w2);
await p.evaluate(() => window.__game.wolves.forEach(w => { w.wait = 99; })); await p.waitForTimeout(500); out.L26.g1 = await g(); await shot('L26a');
await p.evaluate(() => window.__game.joker.use('dash')); await p.waitForTimeout(500); out.L26.g2 = await g();
for (const [k, v] of Object.entries(out)) console.log(k, JSON.stringify(v));
await b.close();
