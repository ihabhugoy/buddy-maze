import { webkit } from 'playwright';
const b = await webkit.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.addInitScript(() => { const s = {}; for (const k of ['intro','first-door','first-wolf','card-light','card-smash','card-freeze','card-build','card-dash','fungus-wolf','arrive-desert','arrive-snow','arrive-autumn','found-frog','found-fennec','found-bear','found-cat','the-end']) s[k] = 1; localStorage.setItem('buddy-story', JSON.stringify(s)); localStorage.setItem('buddy-gift-day', JSON.stringify(new Date().toDateString())); });
await p.goto(process.argv[2], { waitUntil: 'load' }); await p.waitForFunction(() => window.__game && window.__game.play, null, { timeout: 90000 }); await p.waitForTimeout(1000);
for (const L of process.argv[3].split(',').map(Number)) console.log(L, JSON.stringify(await p.evaluate(async L => {
  const G = window.__game; await G.play(L); for (let i = 0; i < 30 && (G.intro.t >= 0 || G.tour.shots); i++) { document.getElementById('tourCap').click(); if (!G.tour.shots) G.intro.t = -1; await new Promise(r => setTimeout(r, 150)); }
  await new Promise(r => setTimeout(r, 1500)); const i = G.renderer.info; i.autoReset = false; i.reset(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); await new Promise(r => setTimeout(r, 40)); const fr = i.render.frame; i.autoReset = true; let inst = 0, plain = 0; G.scene.traverseVisible(o => { if (!o.isMesh || !o.geometry) return; const t = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; if (o.isInstancedMesh) inst += t * o.count; else plain += t; });
  return { N: G.maze.N, cells: G.levelPlan(L).cells, sceneTris: Math.round(inst + plain), inst: Math.round(inst), calls: i.render.calls, geos: i.memory.geometries, tex: i.memory.textures };
}, L)));
await b.close();
