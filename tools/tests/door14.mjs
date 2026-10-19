// level 1-14: walk into door A, come back up through door B: Buddy must stand on an open tile inside the map
import { webkit } from 'playwright';
const b = await webkit.launch(); const p = await (await b.newContext({ viewport: { width: 900, height: 700 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(process.argv[2], { waitUntil: 'load' }); await p.waitForFunction(() => window.__game && window.__game.play, null, { timeout: 90000 }); await p.waitForTimeout(1500);
const res = [];
for (const L of [8, 13, 18, 33, 58, 83]) {
  const r = await p.evaluate(async L => {
    const G = window.__game, wait = ms => new Promise(r => setTimeout(r, ms));
    await G.play(L); await wait(800); G.intro.t = -1; document.querySelectorAll('#story button').forEach(b => b.click()); G.wolves.forEach(w => { w.rest = 999; w.wait = 999; });
    const into = d => { G.st.gx = G.st.tx = G.st.fx = d.out[0]; G.st.gz = G.st.tz = G.st.fz = d.out[1]; G.st.moving = false; return G.tryMove(d.x - d.out[0], d.z - d.out[1]); };
    into(G.maze.doors[0]); await wait(2600);
    const inCave = G.maze.doors && G.maze.N; G.wolves.forEach(w => { w.rest = 999; w.wait = 999; });
    into(G.maze.doors.find(d => d.id === 'B')); await wait(2600);
    const m = G.maze, N = m.N, i = G.st.gz * N + G.st.gx;
    return { L, at: [G.st.gx, G.st.gz], open: !m.g[i], drawn: !(m.empty && m.empty[i]), reachesPortal: (() => { const d = new Int32Array(N * N).fill(-1), q = [i]; d[i] = 0; for (let h = 0; h < q.length; h++) { const k = q[h], x = k % N, z = (k / N) | 0; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Z = z + dz, j = Z * N + X; if (X >= 0 && Z >= 0 && X < N && Z < N && !m.g[j] && d[j] < 0) { d[j] = 1; q.push(j); } } } return d[G.goal[1] * N + G.goal[0]] >= 0; })() };
  }, L);
  res.push(r);
}
console.log(JSON.stringify(res), 'errors', errs.slice(0, 3)); await b.close();
