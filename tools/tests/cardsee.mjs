import { webkit } from 'playwright';
const b = await webkit.launch(); const p = await (await b.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.addInitScript(() => { const s = {}; for (const k of ['intro','first-door','first-wolf','card-light','card-smash','card-freeze','card-build','card-dash','fungus-wolf','arrive-desert','arrive-snow','arrive-autumn']) s[k] = 1; localStorage.setItem('buddy-story', JSON.stringify(s)); localStorage.setItem('buddy-gift-day', JSON.stringify(new Date().toDateString())); localStorage.setItem('buddy-jokers', JSON.stringify(['light', 'smash', 'freeze', 'build', 'dash'])); localStorage.setItem('buddy-taught', JSON.stringify(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [i, 1])))); });
await p.goto(process.argv[2], { waitUntil: 'load' }); await p.waitForFunction(() => window.__game && window.__game.play, null, { timeout: 90000 }); await p.waitForTimeout(1000);
const out = process.argv[3];
// a puzzle level with its card lying in a nook
const L = await p.evaluate(() => { const G = window.__game; for (let L = 7; L < 60; L++) if (G.levelPlan(L).floorCard) return L; });
console.log('floor card level', L + 1, await p.evaluate(L => window.__game.levelPlan(L).floorCard, L));
await p.evaluate(async L => { const G = window.__game; await G.play(L); for (let i = 0; i < 30 && (G.intro.t >= 0 || G.tour.shots); i++) { document.getElementById('tourCap').click(); if (!G.tour.shots) G.intro.t = -1; await new Promise(r => setTimeout(r, 150)); } }, L);
await p.waitForTimeout(800);
const c = await p.evaluate(() => window.__game.joker.firstCard && window.__game.joker.firstCard());
if (c) await p.evaluate(c => { const G = window.__game, N = G.maze.N; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]]) { const x = c[0] + dx, z = c[1] + dz; if (!G.maze.g[z * N + x]) { G.st.gx = G.st.tx = G.st.fx = x; G.st.gz = G.st.tz = G.st.fz = z; return; } } }, c);
await p.waitForTimeout(1200); await p.screenshot({ path: `${out}/cards_play.png` });
await p.evaluate(() => window.__game.joker.use('smash')); await p.waitForTimeout(500); await p.screenshot({ path: `${out}/cards_armed.png` });
await p.evaluate(() => { window.__game.joker.use('smash'); window.__game.joker.give('freeze', null, true); }); await p.waitForTimeout(420); await p.screenshot({ path: `${out}/cards_fly.png` });
await b.close();
