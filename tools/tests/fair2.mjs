// a player who reads the dotted patrol lines: before stepping it checks where each wolf will be over the next few
// steps (along its line) and only goes when it won't meet one; if a wolf chases it, it runs and turns corners
import { webkit } from 'playwright';
const b = await webkit.launch(); const p = await (await b.newContext({ viewport: { width: 900, height: 700 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(() => { const s = {}; for (const k of ['intro','first-door','first-wolf','card-light','card-smash','card-freeze','card-build','card-dash','fungus-wolf','arrive-desert','arrive-snow','arrive-autumn','found-frog','found-fennec','found-bear','found-cat','the-end']) s[k] = 1; localStorage.setItem('buddy-story', JSON.stringify(s)); localStorage.setItem('buddy-gift-day', JSON.stringify(new Date().toDateString())); });
await p.goto(process.argv[2], { waitUntil: 'load' }); await p.waitForFunction(() => window.__game && window.__game.play, null, { timeout: 90000 }); await p.waitForTimeout(1500);
const out = [];
for (const L of process.argv[3].split(',').map(Number)) {
  out.push(await p.evaluate(async L => {
    const G = window.__game, wait = ms => new Promise(r => setTimeout(r, ms));
    await G.play(L); await wait(700); G.intro.t = -1; document.querySelectorAll('#story button').forEach(b => b.click()); await wait(1500);
    let m = G.maze, N = m.N, catches = 0, waited = 0; const t0 = performance.now();
    const poll = setInterval(() => { if (G.wolfOver && !poll.c) { catches++; poll.c = 1; } if (!G.wolfOver) poll.c = 0; }, 30);
    const dist = b => { const d = new Int32Array(N * N).fill(-1), q = [b[1] * N + b[0]]; d[q[0]] = 0; for (let h = 0; h < q.length; h++) { const i = q[h], x = i % N, z = (i / N) | 0; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Z = z + dz, j = Z * N + X; if (X >= 0 && Z >= 0 && X < N && Z < N && !m.g[j] && d[j] < 0) { d[j] = d[i] + 1; q.push(j); } } } return d; };
    // where a patrolling wolf will be after t seconds (walking its line back and forth)
    const wolfAt = (w, t) => {
      const o = (N - 1) / 2, cur = [w.root.position.x + o, w.root.position.z + o];
      if (w.state === 'chase' || !w.route || w.route.length < 2) return cur;
      let i = w.route.findIndex(([x, z]) => x === w.x && z === w.z); if (i < 0) return cur;
      let dir = w.rdir, left = t - Math.max(0, w.wait) - (1 - Math.min(1, w.t)) * w.stepTime; let pos = w.route[i];
      while (left > 0) { if (i + dir < 0 || i + dir >= w.route.length) { dir = -dir; left -= 0.6; continue; } i += dir; pos = w.route[i]; left -= 0.34; }
      return pos;
    };
    const step = async (dx, dz) => { G.tryMove(dx, dz); await wait(40); while (G.st.moving) await wait(15); };
    for (const target of [G.keyAt, G.goal]) {
      for (let guard = 0; guard < 2000 && G.state === 'play'; guard++) {
        if (G.wolfOver) { await wait(300); m = G.maze; N = m.N; continue; }
        const here = [G.st.gx, G.st.gz]; if (here[0] === target[0] && here[1] === target[1]) break;
        const chased = G.wolves.find(w => w.state === 'chase');
        const d = dist(target), nbs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [here[0] + dx, here[1] + dz]).filter(([x, z]) => x >= 0 && z >= 0 && x < N && z < N && !m.g[z * N + x]);
        if (chased) { // run: the neighbour furthest from the chasing wolf
          const o = (N - 1) / 2, wp = [chased.root.position.x + o, chased.root.position.z + o];
          const best = nbs.sort((a, c) => Math.hypot(c[0] - wp[0], c[1] - wp[1]) - Math.hypot(a[0] - wp[0], a[1] - wp[1]))[0];
          if (best) await step(best[0] - here[0], best[1] - here[1]); continue;
        }
        // the next three steps toward the target, and a check against every wolf's line
        const plan = []; let cur = here;
        for (let k = 0; k < 3; k++) { const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [cur[0] + dx, cur[1] + dz]).find(([x, z]) => x >= 0 && z >= 0 && x < N && z < N && d[z * N + x] === d[cur[1] * N + cur[0]] - 1); if (!n) break; plan.push(n); cur = n; }
        if (!plan.length) break;
        const safe = plan.every((t, k) => G.wolves.every(w => { for (const dt of [0, 0.17, 0.34]) { const wp = wolfAt(w, (k + 1) * 0.17 + dt); if (Math.hypot(wp[0] - t[0], wp[1] - t[1]) < 1.2) return false; } return true; }));
        const stayOk = G.wolves.every(w => { const wp = wolfAt(w, 0.4); return Math.hypot(wp[0] - here[0], wp[1] - here[1]) >= 1.2; });
        if (safe) await step(plan[0][0] - here[0], plan[0][1] - here[1]);
        else if (!stayOk) { // the wolf is coming through here: step back along the way it isn't
          const back = nbs.filter(t => G.wolves.every(w => { const wp = wolfAt(w, 0.4); return Math.hypot(wp[0] - t[0], wp[1] - t[1]) >= 1.5; }))[0];
          if (back) await step(back[0] - here[0], back[1] - here[1]); else { waited += 0.1; await wait(100); }
        } else { waited += 0.1; await wait(100); }
      }
    }
    await wait(1600); clearInterval(poll);
    return { L: L + 1, wolves: G.wolves.length, result: G.state, atGoal: G.st.gx === G.goal[0] && G.st.gz === G.goal[1], key: G.hasKey, story: (document.getElementById('story') || {}).textContent?.slice(0, 60), catches, secs: Math.round((performance.now() - t0) / 1000), waited: Math.round(waited) };
  }, L));
}
console.log(JSON.stringify(out), 'errors', errs.slice(0, 3)); await b.close();
