// every door level: walk start -> A0 -> cave 0 -> B0 -> A1 -> cave 1 -> ... -> portal; check each step lands right
import { webkit } from 'playwright';
const b = await webkit.launch(); const p = await (await b.newContext({ viewport: { width: 900, height: 700 } })).newPage();
const errs = []; p.on('pageerror', e => { errs.push(e.message); console.log('PAGEERR', e.message); });
await p.addInitScript(() => { const s = {}; for (const k of ['intro','first-door','first-wolf','card-light','card-smash','card-freeze','card-build','card-dash','fungus-wolf','arrive-desert','arrive-snow','arrive-autumn','found-frog','found-fennec','found-bear','found-cat','the-end']) s[k] = 1; localStorage.setItem('buddy-story', JSON.stringify(s)); localStorage.setItem('buddy-gift-day', JSON.stringify(new Date().toDateString())); });
await p.goto(process.argv[2], { waitUntil: 'load' }); await p.waitForFunction(() => window.__game && window.__game.play, null, { timeout: 90000 }); await p.waitForTimeout(1500);
const Ls = process.argv[3] ? process.argv[3].split(',').map(Number) : Array.from({ length: 12 }, (_, i) => 3 + 5 * i);
for (const L of Ls) {
  const r = await Promise.race([new Promise(r => setTimeout(() => r({ L, bad: ['TIMEOUT'] }), 90000)), p.evaluate(async L => {
    const G = window.__game, wait = ms => new Promise(r => setTimeout(r, ms)), bad = [];
    const calm = () => { document.querySelectorAll('#story button, #tourCap button').forEach(b => b.click()); G.intro.t = -1; G.wolves.forEach(w => { w.rest = 999; w.wait = 999; }); };
    const reach = (m, a, c) => { const N = m.N, d = new Int32Array(N * N).fill(-1), q = [a[1] * N + a[0]]; d[q[0]] = 0; for (let h = 0; h < q.length; h++) { const k = q[h], x = k % N, z = (k / N) | 0; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Z = z + dz, j = Z * N + X; if (X >= 0 && Z >= 0 && X < N && Z < N && !m.g[j] && !(m.empty && m.empty[j]) && d[j] < 0) { d[j] = 1; q.push(j); } } } return d[c[1] * N + c[0]] >= 0; };
    const into = d => { G.st.gx = G.st.tx = G.st.fx = d.out[0]; G.st.gz = G.st.tz = G.st.fz = d.out[1]; G.st.moving = false; return G.tryMove(d.x - d.out[0], d.z - d.out[1]); };
    const here = () => [G.st.gx, G.st.gz], onOpen = () => { const m = G.maze, i = G.st.gz * m.N + G.st.gx; return !m.g[i] && !(m.empty && m.empty[i]); };
    await G.play(L); await wait(900); calm();
    const P = G.levelPlan(L), parts = P.parts, S = G.maze, D = id => S.doors.find(d => d.id === id);
    const info = { L, parts, cells: P.cells, N: S.N, optimal: G.optimal };
    if (S.doors.length !== 2 * (parts - 1)) bad.push('doors ' + S.doors.length);
    if (!reach(S, G.start, D('A0').out)) bad.push('start->A0');
    if ((G.doorAhead() || {}).id !== 'A0') bad.push('arrow at start');
    for (let t = 0; t < parts - 1; t++) {
      into(D('A' + t)); await wait(2700); calm();
      if (G.stage !== 'cave' || G.caveIdx !== t) { bad.push(`cave ${t}: stage ${G.stage} idx ${G.caveIdx}`); break; }
      if (!onOpen()) bad.push(`cave ${t} landing`);
      const C = G.maze, [ca, cb] = C.doors, hasKey = !!G.keyAt;
      if (hasKey !== (t === parts - 2)) bad.push(`cave ${t} key ${hasKey}`);
      if (!reach(C, ca.out, cb.out)) bad.push(`cave ${t} A->B`);
      if (G.keyAt && !reach(C, ca.out, G.keyAt)) bad.push(`cave ${t} key unreachable`);
      if (t === 1 || parts === 2) { // round trip back up the way you came
        into(ca); await wait(2700); calm();
        if (G.stage !== 'surface' || here()[0] !== D('A' + t).out[0] || here()[1] !== D('A' + t).out[1]) bad.push(`back up ${t} at ${here()}`);
        into(D('A' + t)); await wait(2700); calm();
        if (G.caveIdx !== t) bad.push(`down again ${t}`);
      }
      into(G.maze.doors[1]); await wait(2700); calm();
      const B = D('B' + t);
      if (G.stage !== 'surface' || here()[0] !== B.out[0] || here()[1] !== B.out[1]) bad.push(`up ${t} at ${here()} want ${B.out}`);
      if (!onOpen()) bad.push(`up ${t} landing`);
      const next = t < parts - 2 ? D('A' + (t + 1)).out : G.goal;
      if (!reach(G.maze, here(), next)) bad.push(`B${t}->next`);
      if (t < parts - 2 && (G.doorAhead() || {}).id !== 'A' + (t + 1)) bad.push(`arrow after B${t}`);
      if (t === parts - 2 && (G.doorAhead() || {}).id !== (G.hasKey ? undefined : 'B' + t)) bad.push('arrow in last part ' + (G.doorAhead() || {}).id);
    }
    return { ...info, bad };
  }, L)]);
  console.log(JSON.stringify(r));
}
console.log('errors', errs.slice(0, 3)); await b.close();
