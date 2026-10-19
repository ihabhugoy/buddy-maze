import { webkit } from 'playwright';
const b = await webkit.launch(); const p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.addInitScript(() => { const s = {}; for (const k of ['intro','first-door','first-wolf','card-light','card-smash','card-freeze','card-build','card-dash','fungus-wolf','arrive-desert','arrive-snow','arrive-autumn']) s[k] = 1; localStorage.setItem('buddy-story', JSON.stringify(s)); localStorage.setItem('buddy-gift-day', JSON.stringify(new Date().toDateString())); });
await p.goto(process.argv[2], { waitUntil: 'load' }); await p.waitForFunction(() => window.__game && window.__game.play, null, { timeout: 90000 }); await p.waitForTimeout(1000);
for (const L of [6, 11, 16, 21, 26]) console.log(L, JSON.stringify(await p.evaluate(async L => {
  const G = window.__game, ok = [];
  for (let k = 0; k < 40 && ok.length < 6; k++) {
    window.__seedOff = k; await G.play(L); await new Promise(r => setTimeout(r, 900));
    const P = G.levelPlan(L), N = G.maze.N, wayLen = G.optimal;
    const good = P.tutorial === 'build' ? !!G.puzzles.den && G.puzzles.den.route.length >= 5 : P.tutorial === 'smash' ? !!G.puzzles.firstCrack() : P.tutorial === 'freeze' || P.tutorial === 'dash' ? G.wolves.length === 1 : true;
    if (good) ok.push([k, wayLen, N, P.shape]);
  }
  return ok;
}, L)));
await b.close();
