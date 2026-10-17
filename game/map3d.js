// Adventure map, in the game's own look: the warm white floor, and for each world a soft patch of its ground (meadow,
// sand, snow, fallen leaves) fading out into the white. The path is made of the world's own scanned stones: one stone
// top per level with small stepping stones between, the next level's stone risen like a maze wall. The world's door
// block (its tree) stands at the start and a few risen stones stand here and there. Worlds run left to right; the
// level buttons are HTML laid over the stones. Scroll, drag or A / D to move along.
import * as THREE from 'three';

const STEP = 1.7, GAP = 4.2, PAD = 2.4;

export function createMap3D({ canvas, renderer, layer, worlds, perWorld, stars, unlocked, next, starSvg, stoneSet, addLights, biomes, patterns, decor }) {
  // drawn by the game's own renderer when it's given (one WebGL context, so the stones' textures are on the GPU once);
  // the canvas then only catches the drags, and the game's canvas behind it shows the board
  const own = !renderer, r = renderer || new THREE.WebGLRenderer({ canvas, antialias: true });
  if (own) {
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
    r.localClippingEnabled = true;
  }
  const BG = new THREE.Color('#f5f1ea');
  const sc = new THREE.Scene();
  sc.background = BG; sc.fog = new THREE.Fog(BG, 16, 34);
  const sun = addLights(sc, true, biomes.woods);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 10, bottom: -10 });
  sun.shadow.camera.updateProjectionMatrix();
  const cam = new THREE.PerspectiveCamera(28, 1, 0.5, 120);
  // the floor reads as the same warm white as the background (unlit), with soft shadows laid on top
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 80).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: BG, toneMapped: false }));
  floor.position.y = -0.04; sc.add(floor);
  const shade = new THREE.Mesh(new THREE.PlaneGeometry(400, 80).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ color: '#6b5640', opacity: 0.16, depthWrite: false }));
  shade.position.y = -0.015; shade.receiveShadow = true; shade.renderOrder = 2; sc.add(shade);

  const total = worlds.length * perWorld;
  // where each level's stone sits: left to right, winding, with room between the worlds
  const nodePos = L => {
    const w = Math.floor(L / perWorld);
    return new THREE.Vector3(L * STEP + w * GAP, 0, Math.sin(L * 0.68) * 1.5 + Math.sin(L * 0.19 + 1) * 0.7);
  };
  const regions = worlds.map((w, i) => ({ x0: nodePos(i * perWorld).x - PAD, x1: nodePos((i + 1) * perWorld - 1).x + PAD, biome: w.biome, built: false }));
  // fades a piece into the floor color from y0 up to y1 (world heights): tall things far back melt into the white
  const haze = (mat, y0, y1) => {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, rr) => {
      prev && prev(sh, rr);
      sh.uniforms.uHazeCol = { value: BG }; sh.uniforms.uHaze = { value: new THREE.Vector2(y0, y1) };
      sh.vertexShader = 'varying float vHY;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvHY = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = 'varying float vHY;\nuniform vec3 uHazeCol;\nuniform vec2 uHaze;\n' + sh.fragmentShader.replace('#include <fog_fragment>', 'gl_FragColor.rgb = mix(uHazeCol, gl_FragColor.rgb, smoothstep(uHaze.x, uHaze.y, vHY));\n#include <fog_fragment>');
    };
    mat.customProgramCacheKey = () => 'map-haze' + y1.toFixed(2);
  };
  const seeded = s => () => (s = (s * 16807) % 2147483647) / 2147483647;

  // a soft patch of each world's ground: a fade mask (brush dabs along its path) over a finely tiled seamless texture
  regions.forEach((R, i) => {
    const pat = patterns[R.biome]; if (!pat) return;
    const W = R.x1 - R.x0 + 8, D = 18, PX = 512, k = PX / W, c = document.createElement('canvas');
    c.width = PX; c.height = Math.round(D * k);
    const x = c.getContext('2d'), rnd = seeded(i * 31 + 5);
    x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
    const dab = (px, pz, rad, a) => {
      const cx = (px - R.x0 + 4) * k, cy = (pz + D / 2) * k, g = x.createRadialGradient(cx, cy, 0, cx, cy, rad * k);
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(cx - rad * k, cy - rad * k, rad * 2 * k, rad * 2 * k);
    };
    for (let L = i * perWorld; L < (i + 1) * perWorld; L++) {
      const p = nodePos(L);
      dab(p.x, p.z, 3.4, 0.5);
      for (let n = 0; n < 2; n++) dab(p.x + (rnd() - 0.5) * 3, p.z + (rnd() - 0.5) * 4, 1.6 + rnd() * 1.6, 0.35);
    }
    const mask = new THREE.CanvasTexture(c);
    const tex = new THREE.CanvasTexture(pat); tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(W / 4.5, D / 4.5); tex.anisotropy = 8; // one tile every 4.5 units: fine, and no visible repeats
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, alphaMap: mask, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.92 }));
    m.position.set((R.x0 + R.x1) / 2, -0.02, 0); m.renderOrder = 1; sc.add(m);
  });

  // the stones of a world, built when its stone set is ready (they load one world at a time, as you scroll near)
  const stoneMeshes = new Array(total);
  // the map is lit warmly for every world, which turns the snow's pale stones grey: there they are brightened and cooled
  const LIFT = { snow: [1.3, 1.34, 1.42] };
  const matsFor = (set, b) => !LIFT[b] ? set.wallMats : set.wallMats.map(m0 => {
    const m = m0.clone(); m.onBeforeCompile = m0.onBeforeCompile; m.customProgramCacheKey = m0.customProgramCacheKey;
    m.color.setRGB(...LIFT[b]); return m;
  });
  function build(i) {
    const R = regions[i]; if (R.built) return; R.built = true;
    stoneSet(R.biome).then(set0 => {
      const set = { ...set0, wallMats: matsFor(set0, R.biome) };
      const V = set.variants, rnd = seeded(i * 977 + 3);
      for (let L = i * perWorld; L < (i + 1) * perWorld; L++) {
        const v = (L * 7) % V.length, p = nodePos(L);
        const m = new THREE.Mesh(V[v].raw, set.wallMats[v]); // a level: a real stone, its top flush with the floor
        m.position.set(p.x, 0, p.z); m.rotation.y = (L % 4) * Math.PI / 2;
        m.castShadow = m.receiveShadow = true; sc.add(m);
        stoneMeshes[L] = m;
        if (L + 1 < (i + 1) * perWorld) { // small stepping stones to the next level
          const q = nodePos(L + 1);
          for (const t of [0.35, 0.65]) {
            const sv = (L + (t > 0.5 ? 3 : 5)) % V.length, s = new THREE.Mesh(V[sv].cap, set.wallMats[sv]);
            s.scale.setScalar(0.4); s.position.set(p.x + (q.x - p.x) * t, -0.005, p.z + (q.z - p.z) * t); s.rotation.y = rnd() * 6.28;
            s.receiveShadow = true; sc.add(s);
          }
        }
      }
      // the world's door block (its tree) at the start of the path
      const d0 = nodePos(i * perWorld), door = new THREE.Mesh(set.door.raw, set.door.mat);
      door.position.set(d0.x - 1.4, 0.18, d0.z - 1.3); door.rotation.y = set.door.yaw + Math.PI * 0.25; door.scale.setScalar(1.3);
      door.castShadow = true; sc.add(door);
      // risen stones here and there, in little groups, like bits of maze poking out of the ground
      for (let n = 0, tries = 0; n < 7 && tries < 200; tries++) {
        const x = R.x0 + rnd() * (R.x1 - R.x0), z = (rnd() < 0.5 ? -1 : 1) * (2.6 + rnd() * 2.2);
        let near = false;
        for (let L = i * perWorld; L < (i + 1) * perWorld && !near; L++) { const p = nodePos(L); near = Math.hypot(p.x - x, p.z - z) < 1.6; }
        if (near) continue;
        const count = 1 + Math.floor(rnd() * 3);
        for (let c = 0; c < count; c++) {
          const v = Math.floor(rnd() * V.length), m = new THREE.Mesh(V[v].raw, set.wallMats[v]);
          m.position.set(x + (c % 2), 0.25 + rnd() * 0.7, z + Math.floor(c / 2)); m.rotation.y = Math.floor(rnd() * 4) * Math.PI / 2;
          m.castShadow = true; sc.add(m);
        }
        n++;
      }
      // big old ruins stand far back in every world (in that world's colors), their lower half fading into the white
      decor(R.biome).slice(0, 4).forEach((a, k) => {
        const mat = a.mat.clone(); mat.onBeforeCompile = a.mat.onBeforeCompile; haze(mat, 0, a.h * (3 + k % 2) * 0.55);
        const m = new THREE.Mesh(a.geo, mat), s = 3 + k % 2;
        m.scale.setScalar(s); m.position.set(R.x0 + 4 + k * 11 + rnd() * 3, -0.1, -7.5 - rnd() * 3); m.rotation.y = rnd() * 6.28;
        sc.add(m);
      });
      // the desert gets a few big cacti (the cactus door, its stone sunk under the sand)
      if (R.biome === 'desert') for (let n = 0, tries = 0; n < 6 && tries < 100; tries++) {
        const x = R.x0 + rnd() * (R.x1 - R.x0), z = (rnd() < 0.6 ? -1 : 1) * (2.4 + rnd() * 3);
        let near = false;
        for (let L = i * perWorld; L < (i + 1) * perWorld && !near; L++) { const p = nodePos(L); near = Math.hypot(p.x - x, p.z - z) < 1.8; }
        if (near) continue;
        const m = new THREE.Mesh(set.door.raw, set.door.mat), s = 1.6 + rnd() * 1.1;
        m.scale.setScalar(s); m.position.set(x, -0.04, z); m.rotation.y = rnd() * 6.28; m.castShadow = true; sc.add(m); n++;
      }
      refresh();
    });
  }

  // HTML: a small badge over every stone and a name under each world
  layer.innerHTML = Array.from({ length: total }, (_, L) => `<button class="node" data-level="${L}"><span class="dot"></span><span class="stars"></span></button>`).join('')
    + worlds.map((w, i) => `<div class="mbanner" data-w="${i}"><span class="chip"><i class="cbadge" style="background:${w.color}"><svg class="ico"><use href="#${w.icon}"/></svg></i>${w.name}</span></div>`).join('');
  const nodes = [...layer.querySelectorAll('.node')], banners = [...layer.querySelectorAll('.mbanner')];

  let camX = 0, wantX = 0, w = 0, h = 0;
  const minX = nodePos(0).x + 2, maxX = nodePos(total - 1).x - 2;
  function refresh() {
    const nx = next();
    for (let L = 0; L < total; L++) {
      const s = stars(L), open = unlocked(L), b = nodes[L];
      b.className = 'node' + (!open ? ' locked' : L === nx ? ' next' : s ? ' done' : '');
      b.querySelector('.dot').innerHTML = open ? `<b>${L % perWorld + 1}</b>` : '<svg class="ico"><use href="#i-lock"/></svg>';
      const st = b.querySelector('.stars');
      st.innerHTML = s ? starSvg(s > 0) + starSvg(s > 1) + starSvg(s > 2) : '';
      st.style.display = s ? '' : 'none';
      if (stoneMeshes[L]) stoneMeshes[L].userData.rise = L === nx ? 0.42 : 0;
    }
    banners.forEach((el, i) => el.classList.toggle('locked', !unlocked(i * perWorld)));
  }
  function focusNext() { wantX = camX = THREE.MathUtils.clamp(nodePos(next()).x + 1.5, minX, maxX); }
  canvas.addEventListener('wheel', e => { wantX = THREE.MathUtils.clamp(wantX + (e.deltaX + e.deltaY) * 0.012, minX, maxX); e.preventDefault(); }, { passive: false });
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, X: wantX }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (drag) wantX = THREE.MathUtils.clamp(drag.X - (e.clientX - drag.x) * 16 / Math.max(1, w), minX, maxX); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  addEventListener('keydown', e => {
    if (!layer.offsetParent) return;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') wantX = Math.min(maxX, wantX + 3);
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') wantX = Math.max(minX, wantX - 3);
  });

  const v = new THREE.Vector3();
  function render(dt, t) {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (cw !== w || ch !== h) { w = cw; h = ch; if (own) r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    camX += (wantX - camX) * Math.min(1, dt * 6);
    regions.forEach((R, i) => { if (!R.built && camX + 14 > R.x0 && camX - 14 < R.x1) build(i); });
    const far = Math.max(1, 1.5 / cam.aspect); // narrow windows pull back
    cam.position.set(camX + 3.2 * far, 10.5 * far, 10.5 * far); cam.lookAt(camX, 0, 0.3);
    const dist = 15.2 * far; sc.fog.near = dist * 1.05; sc.fog.far = dist * 2.1; // the far edge fades into the white
    sun.position.set(camX - 6.5, 9, -6); sun.target.position.set(camX, 0, 0); sun.target.updateMatrixWorld();
    // the next level's stone rises like a maze wall and breathes gently
    for (let L = 0; L < total; L++) {
      const m = stoneMeshes[L]; if (!m) continue;
      const want = m.userData.rise ? m.userData.rise + Math.sin(t * 2) * 0.03 : 0;
      m.position.y += (want - m.position.y) * Math.min(1, dt * 5);
    }
    if (!own) r.shadowMap.needsUpdate = true;
    r.render(sc, cam);
    for (let L = 0; L < total; L++) {
      const p = nodePos(L);
      if (Math.abs(p.x - camX) > 16) { nodes[L].style.display = 'none'; continue; }
      v.set(p.x, (stoneMeshes[L] ? stoneMeshes[L].position.y : 0) + 0.15, p.z).project(cam);
      nodes[L].style.display = '';
      nodes[L].style.left = ((v.x + 1) / 2 * w) + 'px';
      nodes[L].style.top = ((1 - v.y) / 2 * h) + 'px';
    }
    banners.forEach((el, i) => {
      v.set(regions[i].x0 + 3.2, 0, 4.6).project(cam);
      el.style.left = ((v.x + 1) / 2 * w) + 'px'; el.style.top = ((1 - v.y) / 2 * h) + 'px';
      el.style.display = v.x < -1.3 || v.x > 1.3 ? 'none' : '';
    });
  }
  return { render, refresh, focusNext };
}
