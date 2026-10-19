// level 1-14: which walkable tiles are drawn as empty floor (outside the map)?
import { webkit } from 'playwright';
const b = await webkit.launch(); const p = await (await b.newContext({ viewport: { width: 900, height: 700 } })).newPage();
await p.goto(process.argv[2] + '&zoom=26&r=99', { waitUntil: 'load' }); await p.waitForFunction(() => window.__game && window.__game.play, null, { timeout: 90000 }); await p.waitForTimeout(1500);
const out = await p.evaluate(async () => { const G = window.__game, res = [];
  for (let L = 0; L < 100; L++) { const P = G.levelPlan(L); await G.play(L); for (const cave of P.gateway ? [0, 1] : [0]) { if (cave) await G.cave(L); const m = G.maze, N = m.N, bad = []; if (m.empty) for (let i = 0; i < N * N; i++) if (!m.g[i] && m.empty[i]) bad.push([i % N, (i / N) | 0]); if (bad.length) res.push({ L, cave, shape: P.shape, gw: P.gateway, bad: bad.slice(0, 5) }); } }
  return res; });
console.log(JSON.stringify(out));
await b.close();
