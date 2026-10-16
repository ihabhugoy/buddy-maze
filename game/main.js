import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';
import { MeshoptSimplifier } from 'https://cdn.jsdelivr.net/npm/meshoptimizer@0.22.0/meshopt_simplifier.module.js';
await MeshoptSimplifier.ready;
// the stone models come at ~95k triangles: far too many for a phone. Keep ~12k (texture seams are kept intact).
function simplifyGeo(geo, ratio = 0.15, err = 0.02) {
  const P = geo.attributes.position, pos = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) { pos[i * 3] = P.getX(i); pos[i * 3 + 1] = P.getY(i); pos[i * 3 + 2] = P.getZ(i); }
  const idx = new Uint32Array(geo.index.array);
  // texture seams are open edges in the index: locking them keeps the surface closed (otherwise holes appear)
  const [out] = MeshoptSimplifier.simplify(idx, pos, 3, Math.floor(idx.length * ratio / 3) * 3, err, ['LockBorder']);
  geo.setIndex(new THREE.BufferAttribute(out, 1));
}

// ---------- config ----------
const params = new URLSearchParams(location.search);
const CFG = {
  tileW: 0.88,          // pillar width (pitch is 1, so 0.12 gap)
  wallH: 1.1,           // full wall rise
  stubH: 0.44,          // rise of walls between camera and character
  revealR: parseFloat(params.get('r') || '2.3'),
  clipY: -0.18,         // everything below this is cut, so the floor reads as a thin slab
  charH: 0.85,
  stepTime: 0.17,
};
const BG = new THREE.Color('#f5f1ea');
let STONE_DUST = ['#9d9a92', '#b3afa6', '#8c897f', '#c4c0b6']; // set per biome
const OLIVE = '#5d6b3f';

// ---------- worlds & levels ----------
const LEVELS_PER_WORLD = 25;
const WORLDS = [
  { name: 'Mossy Woods', biome: 'woods', icon: '🌿', color: '#6cc23a', land: '#dff1cc', map: 'assets/map/woods.webp', deco: ['🌳', '🌲', '🍄', '🌿', '🌼'], tint: [1, 1, 1], reveal: 2.3 },
  { name: 'Sunny Dunes', biome: 'desert', icon: '🌵', color: '#f2a53a', land: '#f7ecd6', deco: ['🌵', '🐪', '☀️', '🏜️', '🦂'], tint: [1.07, 0.96, 0.8], reveal: 2.1 },
  { name: 'Frost Peak', biome: 'snow', icon: '❄️', color: '#4fb3e8', land: '#e9f2fb', deco: ['❄️', '⛄', '🏔️', '🐧', '🌨️'], tint: [0.9, 0.97, 1.08], reveal: 1.9 },
  { name: 'Autumn Grove', biome: 'autumn', icon: '🍂', color: '#e0893a', land: '#f8e9dc', deco: ['🍂', '🍁', '🌰', '🍄', '🦔'], tint: [1, 1, 1], reveal: 1.7 },
];
const PILLARS = ['pillar.glb', 'pillar3.glb', 'pillar4.glb', 'pillar5.glb', 'pillar6.glb', 'pillar7.glb', 'pillar8.glb'];
// Biomes: each has its own stones, its own door block (a stone with a cave mouth and a tree on top) and its own
// light and color grade. The cave is the underground level the doors lead to: dark, lit by glowing moss.
const nb = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => `assets/biomes/n${String(a + k).padStart(2, '0')}.glb`);
const BIOMES = {
  woods: { puffs: ['#9d9a92', '#b3afa6', '#8c897f', '#c4c0b6'], stones: PILLARS.map(f => 'assets/' + f), door: 'assets/biomes/n04.glb', bg: '#f5f1ea', floor: '#f4efe7', mirror: 0xd8d0c4,
    hemi: ['#fff3e2', '#d9bf9c', 0.75], fill: ['#ffc792', 1.25], sun: ['#ffdcae', 2.9], glow: { hue: 0.25, width: 0.11, amt: 1 }, dust: '#fff2cc' },
  desert: { puffs: ['#e3c79a', '#d4b07c', '#efd9b4', '#c99e6a'], stones: nb(18, 23), door: 'assets/biomes/n04.glb', bg: '#f7efe3', floor: '#f6ecdc', mirror: 0xe0d2bd,
    hemi: ['#fff4e0', '#e6c79c', 0.8], fill: ['#ffc58a', 1.2], sun: ['#ffd59a', 3.0], glow: { hue: 0.25, width: 0.11, amt: 0.8 }, dust: '#fff0d0' },
  snow: { rockGain: 1.15, contrast: 0.5, tint: 0.9, puffs: ['#ffffff', '#eef4fb', '#dde8f4', '#f7fbff'], stones: nb(12, 17), door: 'assets/biomes/n02.glb', bg: '#eef3f8', floor: '#f2f6fb', mirror: 0xd2dce8,
    hemi: ['#f4f8ff', '#c9d6e6', 0.85], fill: ['#cfe3ff', 1.0], sun: ['#fff6ea', 2.6], glow: { hue: 0.25, width: 0.11, amt: 0.6 }, dust: '#ffffff' },
  autumn: { rockColor: [204, 186, 154], contrast: 0.45, puffs: ['#c98a4e', '#e0a35f', '#b0784a', '#d9b48c'], stones: nb(5, 11).filter(f => !f.endsWith('n08.glb')) /* n08 has a face and is crooked */, door: 'assets/biomes/n03.glb', bg: '#f6eee4', floor: '#f5ece0', mirror: 0xddc9b3,
    hemi: ['#fff1de', '#d9b48c', 0.75], fill: ['#ffb978', 1.3], sun: ['#ffcf95', 2.8], glow: { hue: 0.07, width: 0.08, amt: 0.7, sat: 0.5 }, moss: { hue: 0.07, width: 0.08, sat: 0.55 }, dust: '#ffd9a0' },
  cave: { puffs: ['#5fd8ff', '#4a8dff', '#7fe8ff', '#3b6fd8'], stones: nb(24, 28), door: 'assets/biomes/n01.glb', bg: '#0f1a2a', floor: '#132236', mirror: 0x1a2c44, dark: true,
    rockGain: 1.65, tint: 0.85, stepGlow: true, moss: { hue: 0.44, width: 0.07, sat: 0.3 },
    doorPlant: [255, 70, 185], doorGlow: { hue: 0.9, width: 0.12, amt: 4.5, sat: 0.35, cave: true },
    hemi: ['#6a8ed0', '#1c2a48', 1.1], fill: ['#58d0ff', 0.8], sun: ['#9cc4ff', 1.0], glow: { hue: 0.65, width: 0.5, amt: 0, sat: 0.45, cave: true }, dust: '#7df3ff' },
};
const TOTAL_LEVELS = WORLDS.length * LEVELS_PER_WORLD;
const levelCells = L => 4 + Math.min(11, Math.floor(L / 8)); // grows one step every 8 levels: 9x9 up to 31x31 tiles
const save = (() => {
  let data = { stars: {} };
  try { data = JSON.parse(localStorage.getItem('hidden-maze') || '') || data; } catch {}
  data.stars ||= {};
  return {
    stars: L => data.stars[L] || 0,
    set(L, n) { data.stars[L] = Math.max(n, data.stars[L] || 0); try { localStorage.setItem('hidden-maze', JSON.stringify(data)); } catch {} },
  };
})();
const unlocked = L => L === 0 || save.stars(L - 1) > 0;
const nextLevel = () => { for (let L = 0; L < TOTAL_LEVELS; L++) if (!save.stars(L)) return L; return TOTAL_LEVELS - 1; };
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // updated once per frame, not again for the reflection
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;
renderer.domElement.id = 'game';
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = BG;
scene.fog = new THREE.Fog(BG, 30, 60);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 200);
// miniature look: tilt-shift blur above and below a sharp band around Buddy
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const tiltH = new ShaderPass(HorizontalTiltShiftShader), tiltV = new ShaderPass(VerticalTiltShiftShader);
tiltH.uniforms.r.value = tiltV.uniforms.r.value = 0.42; // the sharp band, measured from the bottom of the screen
composer.addPass(tiltH); composer.addPass(tiltV);
composer.addPass(new OutputPass());
camera.layers.enable(1); // layer 1: scenery, seen by the camera but left out of the floor reflection

// warm sun from the far side of the maze (top of the screen), shadows fall toward the camera;
// a warm fill lights the faces turned toward the camera
const SUN_OFFSET = new THREE.Vector3(-6.5, 9, -6);
const FILL_POS = new THREE.Vector3(7, 3, 6);
function addLights(target, withShadow, B = BIOMES.woods) {
  const hemi = new THREE.HemisphereLight(B.hemi[0], B.hemi[1], B.hemi[2]);
  const fill = new THREE.DirectionalLight(B.fill[0], B.fill[1]);
  fill.position.copy(FILL_POS);
  const sun = new THREE.DirectionalLight(B.sun[0], B.sun[1]);
  sun.position.copy(SUN_OFFSET);
  target.add(hemi, fill, sun);
  sun.userData = { hemi, fill };
  if (withShadow) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 50 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    target.add(sun.target);
  }
  return sun;
}
const sun = addLights(scene, true);

// warm white floor at the maze's level (the maze sits in it): a faint mirror under a glossy cream layer
const GROUND_Y = CFG.clipY - 0.02;
const FLOOR_RGB = new THREE.Color('#f2efe9'); // how the floor reads on screen; scenery fades into it
const mirror = new Reflector(new THREE.PlaneGeometry(400, 400), { textureWidth: 512, textureHeight: 512, color: 0xd8d0c4, clipBias: 0.003 });
mirror.rotation.x = -Math.PI / 2;
mirror.position.y = GROUND_Y - 0.01;
scene.add(mirror);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: '#f4efe7', roughness: 0.3, metalness: 0, transparent: true, opacity: 0.86, depthWrite: false })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = GROUND_Y;
scene.add(ground);

// ---------- helpers ----------
function firstMesh(root) { let m; root.traverse(o => { if (!m && o.isMesh) m = o; }); return m; }
const rand = (a, b) => a + Math.random() * (b - a);
const easeOutBack = t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

// ---------- stone sounds ----------
// stone clips (sNN) cut from the first recording: 3 and 9 are the rise (8 was too scratchy), 10, 11 are impacts
// (settling into the floor), the rest are mixed in now and then. Footstep clips (fNN) come from the second
// recording, and a faint footstep is also layered under every stone sound. Pitch, volume and pan vary each play.
const sfx = (() => {
  const steps = Array.from({ length: 21 }, (_, k) => 'f' + String(k + 1).padStart(2, '0')).filter(n => n !== 'f19').map(n => [n, 1]);
  const POOLS = {
    rise: [['s03', 3], ['s09', 3], ['s01', 1], ['s02', 1], ['s04', 1], ['s05', 1]],
    land: [['s10', 3], ['s11', 3], ['s06', 1], ['s07', 1]],
    bump: [['bump', 1]],
    step: steps, layer: steps,
  };
  const GAP = { rise: 0.09, land: 0.12, step: 0.08, layer: 0.05, bump: 0.25 };
  const NAMES = [...new Set(Object.values(POOLS).flat().map(([n]) => n))];
  let ctx, master, musicGain, music, loading, duck = true;
  // sound settings, saved on this device
  const prefs = { music: 0.5, fx: 0.8, mute: false };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem('hidden-maze-sound') || '{}')); } catch {}
  function apply() {
    if (!ctx) return;
    const now = ctx.currentTime;
    master.gain.setTargetAtTime(prefs.mute ? 0 : prefs.fx * 0.6, now, 0.05);
    // music stays subtle even at full, and drops lower in the menus
    musicGain.gain.setTargetAtTime(prefs.mute ? 0 : prefs.music * 0.22 * (duck ? 0.45 : 1), now, 0.8);
  }
  function set(k, v) {
    prefs[k] = v;
    try { localStorage.setItem('hidden-maze-sound', JSON.stringify(prefs)); } catch {}
    apply();
  }
  const buffers = {}, last = {}, lastT = {};
  function init() { // needs a user gesture (browser autoplay rules)
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(ctx.destination);
    const soft = ctx.createBiquadFilter(); // takes the edge off for a soft, satisfying tone
    soft.type = 'lowpass'; soft.frequency.value = 6500;
    master.connect(soft).connect(ctx.destination);
    loading = Promise.all(NAMES.map(async n => {
      try { buffers[n] = await ctx.decodeAudioData(await (await fetch(`assets/sfx/${n}.m4a`)).arrayBuffer()); } catch {}
    }));
    apply();
    fetch('assets/music/cozy.mp3').then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)).then(buf => { music = buf; startMusic(); }).catch(() => {});
  }
  // background music: starts the first time you play, then loops (60 s track)
  let musicStarted = false, wantMusic = false;
  function startMusic() {
    if (!wantMusic || musicStarted || !music || !ctx) return;
    musicStarted = true;
    const src = ctx.createBufferSource();
    src.buffer = music; src.loop = true;
    src.connect(musicGain);
    src.start();
    apply();
  }
  function setScene(playing) { // called on every screen change
    if (playing) wantMusic = true;
    duck = !playing;
    startMusic();
    apply();
  }
  function pick(kind) {
    const pool = POOLS[kind].filter(([n]) => buffers[n] && (n !== last[kind] || POOLS[kind].length === 1));
    let r = pool.reduce((a, [, w]) => a + w, 0) * Math.random();
    for (const [n, w] of pool) if ((r -= w) < 0) return (last[kind] = n);
  }
  // maxDur cuts long clips short with a quick fade (footsteps come every ~0.17 s)
  function play(kind, vol, pan = 0, { rate = 1, maxDur = 0 } = {}) {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - (lastT[kind] || 0) < GAP[kind]) return;
    const n = pick(kind); if (!n) return;
    lastT[kind] = now;
    const src = ctx.createBufferSource();
    src.buffer = buffers[n];
    src.playbackRate.value = rate * (0.9 + Math.random() * 0.18);
    const g = ctx.createGain();
    g.gain.value = vol * (0.8 + Math.random() * 0.3);
    if (maxDur) g.gain.setTargetAtTime(0, now + maxDur * 0.6, maxDur * 0.2);
    let node = src.connect(g);
    if (kind === 'rise') { // darker and softer: less grinding friction, more of a low rumble
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1800; lp.Q.value = 0.5;
      node = node.connect(lp);
    }
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
    node.connect(master);
    src.start();
    if (maxDur) src.stop(now + maxDur + 0.15);
    // a faint footstep-texture layer under the stone sounds
    if (kind === 'rise' || kind === 'land') play('layer', vol * 0.18, pan, { rate: 0.8, maxDur: 0.45 });
  }
  return { init, play, set, prefs, setScene, get ready() { return !!ctx && ctx.state === 'running' && Object.keys(buffers).length; } };
})();
addEventListener('pointerdown', () => sfx.init());
addEventListener('keydown', () => sfx.init());
// left/right placement of a tile on screen (screen right is world +x/-z)
const panOf = (x, z) => THREE.MathUtils.clamp(((x - st.tx) - (z - st.tz)) / 5, -0.6, 0.6);

// ---------- puffs (Mario-style dust) ----------
const MAX_PUFFS = 400;
const puffMesh = new THREE.InstancedMesh(
  new THREE.IcosahedronGeometry(1, 2),
  new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 }),
  MAX_PUFFS
);
puffMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
puffMesh.frustumCulled = false;
puffMesh.count = 0;
scene.add(puffMesh);
const puffs = [];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color();

function spawnPuff(x, y, z, vx, vy, vz, size, color, life) {
  if (puffs.length >= MAX_PUFFS) puffs.shift();
  puffs.push({ p: new THREE.Vector3(x, y, z), v: new THREE.Vector3(vx, vy, vz), size, color: new THREE.Color(color), life: 0, max: life });
}
function updatePuffs(dt) {
  let n = 0;
  for (let i = puffs.length - 1; i >= 0; i--) {
    const f = puffs[i];
    f.life += dt;
    const t = f.life / f.max;
    if (t >= 1) { puffs.splice(i, 1); continue; }
    f.p.addScaledVector(f.v, dt);
    f.v.multiplyScalar(Math.exp(-5 * dt));
    f.v.y += 0.6 * dt;
    const s = f.size * (t < 0.18 ? easeOutBack(t / 0.18) : 1 - Math.pow((t - 0.18) / 0.82, 1.6));
    _s.setScalar(Math.max(s, 0.0001));
    _m.compose(f.p, _q, _s);
    puffMesh.setMatrixAt(n, _m);
    puffMesh.setColorAt(n, f.color);
    n++;
  }
  puffMesh.count = n;
  puffMesh.instanceMatrix.needsUpdate = true;
  if (puffMesh.instanceColor) puffMesh.instanceColor.needsUpdate = true;
}
function footPuffs(x, z, dx, dz, strength = 1) {
  for (let i = 0; i < 3; i++) {
    const side = rand(-1, 1);
    spawnPuff(
      x - dx * 0.12 + dz * side * 0.08, 0.06, z - dz * 0.12 - dx * side * 0.08,
      -dx * rand(0.4, 0.9) + dz * side * 0.4, rand(0.2, 0.5), -dz * rand(0.4, 0.9) - dx * side * 0.4,
      rand(0.09, 0.14) * strength, '#ffffff', rand(0.3, 0.42)
    );
  }
}
// dust color for a tile: in the cave, the glow color of that stone; elsewhere the biome's stone dust
function dustAt(x, z) {
  const vs = curSet && curSet.variants;
  if (vs && vs[0].glowColor && maze) {
    const i = Math.round(z + origin) * maze.N + Math.round(x + origin), v = vs[varIdx[i]];
    if (v && Math.random() < 0.75) return v.glowColor;
  }
  return STONE_DUST[Math.floor(Math.random() * STONE_DUST.length)];
}
function stonePuffs(x, z, big) {
  const count = big ? 14 : 7;
  for (let i = 0; i < count; i++) {
    const side = Math.floor(Math.random() * 4);
    const along = rand(-0.5, 0.5);
    const ox = [0.5, -0.5, along, along][side], oz = [along, along, 0.5, -0.5][side];
    const out = rand(0.6, 1.4) * (big ? 1 : 0.6);
    spawnPuff(
      x + ox * 1.02, rand(0.02, 0.12), z + oz * 1.02,
      Math.sign(ox) * (Math.abs(ox) > 0.49 ? out : 0) + rand(-0.2, 0.2),
      rand(0.3, 0.8),
      Math.sign(oz) * (Math.abs(oz) > 0.49 ? out : 0) + rand(-0.2, 0.2),
      rand(0.17, 0.3) * (big ? 1 : 0.7),
      dustAt(x, z),
      rand(0.35, 0.55)
    );
  }
}

// ---------- key ----------
function makeKey() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#f2c14e', metalness: 0.55, roughness: 0.3, emissive: '#ffae00', emissiveIntensity: 0.35 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 10, 24), mat);
  ring.position.y = 0.18;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 10), mat);
  shaft.position.y = -0.05;
  const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.04), mat);
  t1.position.set(0.055, -0.17, 0);
  const t2 = t1.clone(); t2.position.y = -0.1; t2.scale.x = 0.7; t2.position.x = 0.045;
  g.add(ring, shaft, t1, t2);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const grd = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,230,150,0.9)'); grd.addColorStop(0.35, 'rgba(255,215,120,0.35)'); grd.addColorStop(1, 'rgba(255,215,120,0)');
  x.fillStyle = grd; x.fillRect(0, 0, 128, 128);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(1.3);
  const root = new THREE.Group();
  root.add(g, glow);
  root.userData.spin = g;
  return root;
}

// ---------- maze ----------
function genMaze(cells, rnd) {
  const N = cells * 2 + 1;
  const g = new Uint8Array(N * N).fill(1);
  const stack = [[1, 1]];
  g[1 * N + 1] = 0;
  while (stack.length) {
    const [x, z] = stack[stack.length - 1];
    const opts = [[2, 0], [-2, 0], [0, 2], [0, -2]].filter(([dx, dz]) => {
      const nx = x + dx, nz = z + dz;
      return nx > 0 && nz > 0 && nx < N - 1 && nz < N - 1 && g[nz * N + nx] === 1;
    });
    if (!opts.length) { stack.pop(); continue; }
    const [dx, dz] = opts[Math.floor(rnd() * opts.length)];
    g[(z + dz / 2) * N + x + dx / 2] = 0;
    g[(z + dz) * N + x + dx] = 0;
    stack.push([x + dx, z + dz]);
  }
  // a few loops so there is more than one way and memory matters
  for (let k = 0; k < cells; k++) {
    const x = 1 + Math.floor(rnd() * (N - 2)), z = 1 + Math.floor(rnd() * (N - 2));
    if (g[z * N + x] === 1 && ((x % 2 === 1) !== (z % 2 === 1))) g[z * N + x] = 0;
  }
  return { N, g };
}

// Shaped mazes for later levels. A shape says which cells (cx, cz in 0..C-1) are inside; everything else is empty
// floor. u, v run -1..1 across the maze; on screen "up" is the -x/-z diagonal, so the heart is drawn in rotated axes.
const uv = (c, C) => ((c + 0.5) / C) * 2 - 1;
const SHAPES = {
  circle: { inside: (cx, cz, C) => uv(cx, C) ** 2 + uv(cz, C) ** 2 <= 0.95 },
  heart: {
    inside: (cx, cz, C) => {
      const u = uv(cx, C), v = uv(cz, C);
      const a = (u - v) / Math.SQRT2 * 1.22, b = -(u + v) / Math.SQRT2 * 1.22 + 0.18;
      return (a * a + b * b - 1) ** 3 - a * a * b ** 3 <= 0;
    },
  },
  // two squares side by side with a gap, joined by stone bridges (single-cell corridors)
  twin: {
    inside: (cx, cz, C) => cx < 0.4 * C ? cz < 0.72 * C : cx >= 0.6 * C ? cz >= 0.28 * C : SHAPES.twin.bridgeRows(C).includes(cz),
    bridgeRows: C => { const rows = []; for (let r = Math.ceil(0.28 * C); r < 0.72 * C; r += 2) rows.push(r); return rows; },
    bridges: C => SHAPES.twin.bridgeRows(C).map(r => { const cells = []; for (let c = 0; c < C; c++) if (c >= 0.4 * C - 1 && c < 0.6 * C + 1) cells.push([c, r]); return cells; }),
  },
  // three round rooms joined by narrow stone bridges
  circles: {
    rooms: [[-0.5, -0.5], [0.52, -0.42], [-0.02, 0.52]],
    inside: (cx, cz, C) => {
      const u = uv(cx, C), v = uv(cz, C), R = SHAPES.circles.rooms;
      if (R.some(([x, z]) => (u - x) ** 2 + (v - z) ** 2 <= 0.44 * 0.44)) return true;
      // bridges: cells right on the line between two room centers
      return [[0, 1], [1, 2], [2, 0]].some(([a, b]) => {
        const [ax, az] = R[a], [bx, bz] = R[b], dx = bx - ax, dz = bz - az;
        const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - az) * dz) / (dx * dx + dz * dz)));
        return Math.hypot(u - (ax + dx * t), v - (az + dz * t)) < 1.1 / C;
      });
    },
  },
};
// which shape a level uses: squares first, new shapes come in as the mazes get bigger
function levelShape(L) {
  if (L < 12) return null;
  const pool = ['circle'];
  if (L >= 18) pool.push('twin');
  if (L >= 24) pool.push('heart');
  if (L >= 30) pool.push('circles');
  return pool[L % pool.length];
}
function genShapedMaze(cells, rnd, shape) {
  const S = SHAPES[shape], C = cells, N = C * 2 + 1;
  const g = new Uint8Array(N * N).fill(1);
  const ok = (cx, cz) => cx >= 0 && cz >= 0 && cx < C && cz < C && S.inside(cx, cz, C);
  const cellsIn = [];
  for (let cz = 0; cz < C; cz++) for (let cx = 0; cx < C; cx++) if (ok(cx, cz)) cellsIn.push([cx, cz]);
  const [sx, sz] = cellsIn[Math.floor(rnd() * cellsIn.length)];
  const stack = [[sx, sz]];
  g[(2 * sz + 1) * N + 2 * sx + 1] = 0;
  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1];
    const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => ok(cx + dx, cz + dz) && g[(2 * (cz + dz) + 1) * N + 2 * (cx + dx) + 1] === 1);
    if (!opts.length) { stack.pop(); continue; }
    const [dx, dz] = opts[Math.floor(rnd() * opts.length)];
    g[(2 * cz + 1 + dz) * N + 2 * cx + 1 + dx] = 0;
    g[(2 * (cz + dz) + 1) * N + 2 * (cx + dx) + 1] = 0;
    stack.push([cx + dx, cz + dz]);
  }
  // every bridge is fully walkable, so there are several ways across
  for (const br of S.bridges ? S.bridges(C) : []) {
    const inBr = br.filter(([cx, cz]) => ok(cx, cz));
    for (let k = 1; k < inBr.length; k++) {
      const [ax, az] = inBr[k - 1], [bx, bz] = inBr[k];
      g[(az + bz + 1) * N + ax + bx + 1] = 0;
    }
  }
  // a few loops inside the shape
  for (let k = 0; k < C; k++) {
    const [cx, cz] = cellsIn[Math.floor(rnd() * cellsIn.length)];
    const [dx, dz] = [[1, 0], [0, 1]][Math.floor(rnd() * 2)];
    if (ok(cx + dx, cz + dz)) g[(2 * cz + 1 + dz) * N + 2 * cx + 1 + dx] = 0;
  }
  // empty floor: tiles that are not next to any open path stay empty (the walls hug the shape)
  const empty = new Uint8Array(N * N);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    let near = false;
    for (let dz = -1; dz <= 1 && !near; dz++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Z = z + dz;
      if (X >= 0 && Z >= 0 && X < N && Z < N && !g[Z * N + X]) { near = true; break; }
    }
    if (!near) empty[z * N + x] = 1;
  }
  // start on the open tile nearest the camera; the key goes on the open tile furthest away by walking distance
  let start = null;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) if (!g[z * N + x] && (!start || x + z > start[0] + start[1])) start = [x, z];
  const dist = new Int32Array(N * N).fill(-1), q = [start[1] * N + start[0]];
  dist[q[0]] = 0;
  let far = q[0];
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % N, z = (i / N) | 0;
    if (dist[i] > dist[far]) far = i;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const X = x + dx, Z = z + dz, j = Z * N + X;
      if (X >= 0 && Z >= 0 && X < N && Z < N && !g[j] && dist[j] < 0) { dist[j] = dist[i] + 1; q.push(j); }
    }
  }
  return { N, g, empty, start, goal: [far % N, (far / N) | 0] };
}
// race maze: one quarter is generated, then mirrored both ways, so every corner entry is exactly as far from the key
function genFairRaceMaze(cells) {
  const N = cells * 2 + 1, H = (N - 1) / 2, rnd = Math.random;
  const q = genMaze(Math.ceil(cells / 2), rnd); // a small maze for the quarter (covers tiles 0..H)
  const g = new Uint8Array(N * N).fill(1);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const qx = Math.min(x, N - 1 - x), qz = Math.min(z, N - 1 - z);
    if (qx < q.N && qz < q.N) g[z * N + x] = q.g[qz * q.N + qx];
  }
  // open the center lines where the quarters meet so they connect, then make sure the center is open
  for (let k = 1; k <= H; k += 2) {
    if (rnd() < 0.5) { g[H * N + k] = g[H * N + N - 1 - k] = 0; g[k * N + H] = g[(N - 1 - k) * N + H] = 0; }
  }
  g[H * N + H] = g[(H - 1) * N + H] = g[(H + 1) * N + H] = g[H * N + H - 1] = g[H * N + H + 1] = 0;
  return { N, g };
}
function shortestPath({ N, g }, sx, sz, tx, tz) {
  const dist = new Int32Array(N * N).fill(-1), q = [sz * N + sx];
  dist[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % N, z = (i / N) | 0;
    if (x === tx && z === tz) return dist[i];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = (z + dz) * N + x + dx;
      if (!g[j] && dist[j] < 0) { dist[j] = dist[i] + 1; q.push(j); }
    }
  }
  return 1;
}

// ---------- game state ----------
const $ = id => document.getElementById(id);
const ui = { level: $('level'), steps: $('steps'), time: $('time'), hint: $('hint') };
let assets, walls = [], caps = [], floor, floorShadow, player, silhouette, key;
let maze, heights, vels, targets, shake, rotIdx, varIdx, twist, nudge, tint, origin, optimal, tileGlow;
let L = 0, steps = 0, elapsed = 0, won = false, viewW = parseFloat(params.get('zoom') || '3'), peek = false;
let state = 'loading';
const st = { gx: 0, gz: 0, fx: 0, fz: 0, tx: 0, tz: 0, t: 1, moving: false, facing: 0, bumpT: -1, bdx: 0, bdz: 0 };
let heldDir = null, queued = null;

// a model's texture goes to a canvas (shrunk to keep phone memory in check) so its colors can be adjusted
function canvasTexture(tex, size) {
  const img = tex.image;
  const k = Math.min(1, size / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.flipY = tex.flipY; t.colorSpace = tex.colorSpace; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT; t.anisotropy = 4;
  tex.dispose();
  return t;
}
// 0 for rock, 1 for moss/grass: green hue with some saturation
// which hue counts as moss/grass/leaves (set per biome while its stones are prepared)
let MOSS = { hue: 0.27, width: 0.08 }, PROTECT_TRUNK = false, DOOR_MIN = 70;
function hueSat(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 1) return [0, 0];
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h < 0 ? h + 6 : h) / 6, d / mx];
}
function greenness(r, g, b) {
  const [h, sat] = hueSat(r, g, b);
  if (!sat) return 0;
  const dh = Math.min(Math.abs(h - MOSS.hue), 1 - Math.abs(h - MOSS.hue));
  const hueW = Math.max(0, Math.min(1, (MOSS.width - dh) / (MOSS.width * 0.64)));
  const s0 = MOSS.sat ?? 0.12;
  return hueW * Math.max(0, Math.min(1, (sat - s0) / 0.15));
}
// how much a pixel is bare rock (not moss, and on a door not the brown tree trunk)
function rockness(r, g, b) {
  let w = 1 - greenness(r, g, b);
  if (PROTECT_TRUNK) { const [h, sat] = hueSat(r, g, b); if (h > 0.02 && h < 0.13 && sat > 0.35) w *= Math.max(0, 1 - (sat - 0.35) / 0.1); }
  return w;
}
// repaint moss in one color, keeping its light and dark (a glowing moss needs one even, bright color)
function tintMoss(tex, ref, palette = null) {
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const W = tex.image.width;
  // with a palette, neighbouring patches of moss get different colors (blended softly between them)
  const pick = i => {
    if (!palette) return ref;
    const x = (i / 4) % W, y = Math.floor(i / 4 / W);
    const u = 0.5 + 0.5 * Math.sin(x * 0.011 + Math.sin(y * 0.008) * 2.2), v = 0.5 + 0.5 * Math.sin(y * 0.013 + x * 0.005 + 1.7);
    const [a, b, c, d] = palette;
    return [0, 1, 2].map(k => (a[k] * (1 - u) + b[k] * u) * (1 - v) + (c[k] * (1 - u) + d[k] * u) * v);
  };
  const c = tex.image, ctx = c.getContext('2d'), img = ctx.getImageData(0, 0, c.width, c.height), px = img.data;
  let sum = 0, n = 0;
  for (let i = 0; i < px.length; i += 16) { const w = greenness(px[i], px[i + 1], px[i + 2]); sum += lum(px[i], px[i + 1], px[i + 2]) * w; n += w; }
  if (n < 20) return;
  const Lm = sum / n;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2], w = greenness(r, g, b);
    if (w <= 0) continue;
    const L = Math.max(0.6, Math.min(1.25, lum(r, g, b) / Lm)), col = pick(i);
    px[i] = Math.min(255, r + (col[0] * L - r) * w);
    px[i + 1] = Math.min(255, g + (col[1] * L - g) * w);
    px[i + 2] = Math.min(255, b + (col[2] * L - b) * w);
  }
  ctx.putImageData(img, 0, 0);
  tex.needsUpdate = true;
}
// cave glow: which pixels are bioluminescent (bright and colorful, whatever the hue), and their original colors
function captureGlow(tex) {
  const c = tex.image, img = c.getContext('2d').getImageData(0, 0, c.width, c.height), px = img.data, mask = new Float32Array(px.length / 4);
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const r = px[i], g = px[i + 1], b = px[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 1) continue;
    mask[j] = sm(95, 150, mx) * sm(0.3, 0.5, (mx - mn) / mx);
  }
  return { orig: new Uint8ClampedArray(px), mask };
}
// put the glowing bits back in their own colors, and make the glow picture (just those bits) plus their average color
function restoreGlow(tex, { orig, mask }) {
  const c = tex.image, ctx = c.getContext('2d'), img = ctx.getImageData(0, 0, c.width, c.height), px = img.data;
  const gc = document.createElement('canvas'); gc.width = c.width; gc.height = c.height;
  const gctx = gc.getContext('2d'), gimg = gctx.createImageData(c.width, c.height), gp = gimg.data;
  const sum = [0, 0, 0]; let n = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const w = mask[j];
    gp[i + 3] = 255;
    if (w <= 0) continue;
    for (let k = 0; k < 3; k++) { px[i + k] += (orig[i + k] - px[i + k]) * w; gp[i + k] = orig[i + k] * w; sum[k] += orig[i + k] * w; }
    n += w;
  }
  ctx.putImageData(img, 0, 0); tex.needsUpdate = true;
  gctx.putImageData(gimg, 0, 0);
  const glowTex = new THREE.CanvasTexture(gc);
  glowTex.flipY = tex.flipY; glowTex.colorSpace = THREE.SRGBColorSpace;
  const col = new THREE.Color().setRGB(...sum.map(v => n ? v / n / 255 : 0.5), THREE.SRGBColorSpace);
  return { glowTex, glowColor: '#' + col.offsetHSL(0, 0.1, 0.12).getHexString() };
}
// the glowing bits light up only on the tile Buddy steps on (per-tile aGlow, 0..1), with a faint light the rest of the time
function addStepGlow(mat, glowTex) {
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, rr) => {
    base(sh, rr);
    sh.uniforms.uGlowMap = { value: glowTex };
    sh.vertexShader = 'attribute float aGlow;\nvarying float vGlow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = 'uniform sampler2D uGlowMap;\nvarying float vGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += texture2D(uGlowMap, vMapUv).rgb * (0.12 + 2.6 * vGlow);');
  };
  const key = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => key() + 'step';
}
// typical brightness of a stone's rock (the median, so dark cracks and the cave mouth don't count much)
function rockMedianL(tex) {
  const c = tex.image, px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, L = [];
  for (let i = 0; i < px.length; i += 16) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    if (Math.max(r, g, b) < 25 || rockness(r, g, b) < 0.5) continue;
    L.push(0.299 * r + 0.587 * g + 0.114 * b);
  }
  L.sort((m, n) => m - n);
  return L[Math.floor(L.length * 0.6)] || 1;
}
function scaleRock(tex, k) {
  k = Math.max(0.6, Math.min(1.6, k));
  const c = tex.image, ctx = c.getContext('2d'), img = ctx.getImageData(0, 0, c.width, c.height), px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const w = rockness(px[i], px[i + 1], px[i + 2]);
    if (w <= 0) continue;
    const f = 1 + (k - 1) * w;
    px[i] = Math.min(255, px[i] * f); px[i + 1] = Math.min(255, px[i + 1] * f); px[i + 2] = Math.min(255, px[i + 2] * f);
  }
  ctx.putImageData(img, 0, 0);
  tex.needsUpdate = true;
}
// pull every rock pixel toward one shared color, keeping only its light and dark: removes odd tints between stones
function tintRock(tex, ref, k, contrast = 0.65, lift = true) {
  const refL = 0.299 * ref[0] + 0.587 * ref[1] + 0.114 * ref[2];
  const c = tex.image, ctx = c.getContext('2d'), img = ctx.getImageData(0, 0, c.width, c.height), px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2], L0 = (0.299 * r + 0.587 * g + 0.114 * b) / refL;
    // softer light and dark: everything is pulled toward the middle, and near-black spots are fully repainted
    const L = lift ? Math.max(0.55, 1 + (L0 - 1) * contrast) : L0;
    const w = lift ? Math.max(rockness(r, g, b) * k, Math.min(1, Math.max(0, (0.55 - L0) / 0.3))) : rockness(r, g, b) * k * Math.min(1, L0 / 0.45);
    if (w <= 0) continue;
    px[i] = Math.min(255, r + (ref[0] * L - r) * w);
    px[i + 1] = Math.min(255, g + (ref[1] * L - g) * w);
    px[i + 2] = Math.min(255, b + (ref[2] * L - b) * w);
  }
  ctx.putImageData(img, 0, 0);
  tex.needsUpdate = true;
}
// Stone shader tweaks:
// - the scans have a few tiny folded triangles in their cracks that face inward and showed as black specks,
//   so stones are drawn double-sided and every surface is shaded as if it faces the camera
// - fake subsurface glow on moss and grass: green parts gently light up, more at grazing angles
const SUNU = { uSunView: { value: new THREE.Vector3() } }; // sun direction in view space, updated each frame
function addGrassGlow(mat, scale, rim = false, G = BIOMES.woods.glow) {
  mat.side = THREE.DoubleSide;
  mat.onBeforeCompile = sh => {
    if (rim) {
      sh.uniforms.uSunView = SUNU.uSunView;
      sh.fragmentShader = 'uniform vec3 uSunView;\n' + sh.fragmentShader;
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nif (dot(normal, normalize(vViewPosition)) < 0.0) normal = -normal;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 c = diffuseColor.rgb;
        float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn, hue = 0.0;
        if (d > 1e-4) {
          if (mx == c.r) hue = mod((c.g - c.b) / d, 6.0);
          else if (mx == c.g) hue = (c.b - c.r) / d + 2.0;
          else hue = (c.r - c.g) / d + 4.0;
          hue /= 6.0;
        }
        float grass = smoothstep(${G.width.toFixed(3)}, ${(G.width * 0.36).toFixed(3)}, abs(hue - ${G.hue.toFixed(3)})) * smoothstep(${(G.sat ?? 0.25).toFixed(2)}, ${((G.sat ?? 0.25) * 2).toFixed(2)}, d / max(mx, 1e-4));
        float rimF = pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 2.0);
        totalEmissiveRadiance += c * grass * (0.24 + 0.45 * rimF) * ${G.cave ? 'vec3(1.0, 1.05, 1.15)' : 'vec3(1.0, 1.15, 0.5)'} * ${(scale * G.amt).toFixed(2)};
        ${rim ? `// warm edge light where a rock side is turned away from the sun (backlit)
        float shade = 1.0 - max(dot(normal, uSunView), 0.0);
        float edge = pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 3.0);
        totalEmissiveRadiance += ${G.cave ? 'vec3(0.3, 0.62, 1.0) * edge * shade * 0.35' : 'vec3(1.0, 0.8, 0.52) * edge * shade * 0.75'};` : ''}
      }`);
  };
  mat.customProgramCacheKey = () => 'grass' + scale + rim + G.hue + G.width + G.amt + (G.sat ?? 0.25) + !!G.cave;
}
function rockMean(tex) {
  const c = tex.image, px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const sum = [0, 0, 0]; let n = 0;
  for (let i = 0; i < px.length; i += 16) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    if (Math.max(r, g, b) < (PROTECT_TRUNK ? DOOR_MIN : 25)) continue; // empty atlas space (and a door's dark cave mouth)
    const w = rockness(r, g, b);
    sum[0] += r * w; sum[1] += g * w; sum[2] += b * w; n += w;
  }
  return sum.map(v => v / n);
}
// shift a stone's rock colors toward the reference stone, leaving moss and grass untouched
// average moss/grass color of a stone (weighted by how green each pixel is)
function mossMean(tex) {
  const c = tex.image, px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const sum = [0, 0, 0]; let n = 0;
  for (let i = 0; i < px.length; i += 16) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const w = greenness(r, g, b);
    sum[0] += r * w; sum[1] += g * w; sum[2] += b * w; n += w;
  }
  return n > 50 ? sum.map(v => v / n) : null;
}
// shift a stone's moss and grass toward one shared green, leaving the rock untouched
function matchMoss(tex, target) {
  const mean = mossMean(tex); if (!mean) return;
  const gain = mean.map((m, k) => Math.max(0.6, Math.min(1.6, target[k] / m)));
  const c = tex.image, ctx = c.getContext('2d'), img = ctx.getImageData(0, 0, c.width, c.height), px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const w = greenness(r, g, b);
    if (w <= 0) continue;
    px[i] = Math.min(255, r * (1 + (gain[0] - 1) * w));
    px[i + 1] = Math.min(255, g * (1 + (gain[1] - 1) * w));
    px[i + 2] = Math.min(255, b * (1 + (gain[2] - 1) * w));
  }
  ctx.putImageData(img, 0, 0);
  tex.needsUpdate = true;
}
function matchRock(tex, target, strength = 1) {
  const mean = rockMean(tex);
  const gain = mean.map((m, k) => Math.max(0.6, Math.min(1.6, 1 + (target[k] / m - 1) * strength)));
  const c = tex.image, ctx = c.getContext('2d'), img = ctx.getImageData(0, 0, c.width, c.height), px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const w = rockness(r, g, b);
    if (w <= 0) continue;
    px[i] = Math.min(255, r * (1 + (gain[0] - 1) * w));
    px[i + 1] = Math.min(255, g * (1 + (gain[1] - 1) * w));
    px[i + 2] = Math.min(255, b * (1 + (gain[2] - 1) * w));
  }
  ctx.putImageData(img, 0, 0);
  tex.needsUpdate = true;
}
// every stone is sized by its body (moss and grass sticking out are ignored) to exactly one tile wide,
// with its flat top at y = 0 and tall enough to reach under the floor when raised
function prepPillar(gltf) {
  const pm = firstMesh(gltf.scene);
  pm.updateWorldMatrix(true, false);
  const raw = pm.geometry.clone().applyMatrix4(pm.matrixWorld);
  raw.computeBoundingBox();
  const bb = raw.boundingBox, h = bb.max.y - bb.min.y;
  // some models come slightly turned: find the turn that makes the body's footprint tightest and undo it
  {
    const P0 = raw.attributes.position, pts = [];
    for (let i = 0; i < P0.count; i += 3) { const y = P0.getY(i); if (y < bb.max.y - 0.15 * h && y > bb.max.y - 0.5 * h) pts.push(P0.getX(i), P0.getZ(i)); }
    let best = 0, bestS = Infinity;
    for (let d = -44; d <= 45; d++) {
      const a = d * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let k = 0; k < pts.length; k += 2) { const x = pts[k] * c - pts[k + 1] * sn, z = pts[k] * sn + pts[k + 1] * c; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const sz = Math.max(x1 - x0, z1 - z0);
      if (sz < bestS - 1e-6) { bestS = sz; best = a; }
    }
    if (best) { raw.rotateY(-best); raw.computeBoundingBox(); }
  }
  const P = raw.attributes.position, xs = [], zs = [], ys = [];
  const cx0 = (bb.min.x + bb.max.x) / 2, cz0 = (bb.min.z + bb.max.z) / 2, q = (bb.max.x - bb.min.x) * 0.25;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (y < bb.max.y - 0.15 * h && y > bb.max.y - 0.5 * h) { xs.push(x); zs.push(z); }
    if (Math.abs(x - cx0) < q && Math.abs(z - cz0) < q && y > bb.max.y - 0.2 * h) ys.push(y);
  }
  const pct = (a, t) => { a.sort((m, n) => m - n); return a[Math.floor((a.length - 1) * t)]; };
  const x0 = pct(xs, 0.02), x1 = pct(xs, 0.98), z0 = pct(zs, 0.02), z1 = pct(zs, 0.98);
  const top = ys.length ? pct(ys, 0.9) : bb.max.y;
  const S = CFG.tileW / Math.max(x1 - x0, z1 - z0);
  const SY = Math.max(S, 1.4 / (top - bb.min.y));
  raw.translate(-(x0 + x1) / 2, -top, -(z0 + z1) / 2);
  raw.scale(S, SY, S);
  if (!params.has("nosimp")) simplifyGeo(raw);
  const mat = new THREE.MeshStandardMaterial({ map: canvasTexture(pm.material.map, 1024), roughness: 0.92, metalness: 0 });
  return { raw, mat };
}

// a door block: a stone with a cave mouth and a tree on top. Sized by its stone body (the tree is left out of the
// measurement), so the stone part matches the other stones exactly and the tree sticks up above the floor.
function prepDoor(gltf) {
  const pm = firstMesh(gltf.scene);
  pm.updateWorldMatrix(true, false);
  const raw = pm.geometry.clone().applyMatrix4(pm.matrixWorld);
  raw.computeBoundingBox();
  const bb = raw.boundingBox, h = bb.max.y - bb.min.y, P = raw.attributes.position;
  const BINS = 40, ext = Array.from({ length: BINS }, () => [1e9, -1e9, 1e9, -1e9]);
  for (let i = 0; i < P.count; i++) {
    const k = Math.min(BINS - 1, Math.floor((P.getY(i) - bb.min.y) / h * BINS)), e = ext[k];
    e[0] = Math.min(e[0], P.getX(i)); e[1] = Math.max(e[1], P.getX(i)); e[2] = Math.min(e[2], P.getZ(i)); e[3] = Math.max(e[3], P.getZ(i));
  }
  const width = k => Math.max(ext[k][1] - ext[k][0], ext[k][3] - ext[k][2]);
  let w = 0, x0 = 0, x1 = 0, z0 = 0, z1 = 0;
  for (let k = Math.floor(BINS * 0.1); k < BINS * 0.35; k++) if (width(k) > w) { w = width(k); [x0, x1, z0, z1] = ext[k]; }
  let topK = Math.floor(BINS * 0.35);
  while (topK < BINS - 1 && width(topK + 1) > w * 0.8) topK++;
  const top = bb.min.y + (topK + 1) / BINS * h;
  const S = CFG.tileW / w, SY = Math.max(S, 1.4 / (top - bb.min.y));
  raw.translate(-(x0 + x1) / 2, -top, -(z0 + z1) / 2);
  raw.scale(S, SY, S);
  // the cave mouth is a hollow in one side: that side's middle sits furthest in toward the center
  const Q = raw.attributes.position, sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const bodyH = (top - bb.min.y) * SY;
  // map how far each side sticks out on an 8 x 8 grid of its face: the cave mouth is a hollow, so that side's average is lowest
  const reach = sides.map(([dx, dz]) => {
    const NU = 8, NY = 8, cells = new Float32Array(NU * NY), half = CFG.tileW * 0.4;
    for (let i = 0; i < Q.count; i++) {
      const x = Q.getX(i), y = Q.getY(i), z = Q.getZ(i), o = x * dx + z * dz;
      if (o < 0) continue;
      const cu = Math.floor(((x * dz - z * dx) + half) / (2 * half) * NU), cy = Math.floor((-y / bodyH - 0.05) / 0.9 * NY);
      if (cu < 0 || cu >= NU || cy < 0 || cy >= NY) continue;
      cells[cy * NU + cu] = Math.max(cells[cy * NU + cu], o);
    }
    return cells.reduce((m, v) => m + v, 0) / cells.length;
  });
  const arch = reach.indexOf(Math.min(...reach)), [ax, az] = sides[arch];
  const mat = new THREE.MeshStandardMaterial({ map: canvasTexture(pm.material.map, 1024), roughness: 0.92, metalness: 0 });
  return { raw, mat, reach, yaw: -Math.atan2(-az, ax) };
}
// flat floor tiles show a picture of each stone, lit by the biome's light and captured once (4 turns each)
function bakeFloor(variants, B) {
  const bakeScene = new THREE.Scene();
  addLights(bakeScene, false, B);
  bakeScene.traverse(o => { if (o.isLight) o.intensity *= 0.5; }); // baked at half brightness so it fits 8-bit, doubled when drawn
  bakeScene.environment = scene.environment;
  bakeScene.environmentIntensity = (B.dark ? 0.12 : 0.35) * 0.5;
  const bakeMeshes = variants.map(v => { const m = new THREE.Mesh(v.raw, v.mat); bakeScene.add(m); return m; });
  const atlas = (W, H, cells) => {
    const rt = new THREE.WebGLRenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    renderer.setClearColor(0x000000, 0);
    rt.scissorTest = false;
    renderer.setRenderTarget(rt);
    renderer.clear();
    rt.scissorTest = true;
    for (const c of cells) {
      bakeMeshes.forEach((m, i) => { m.visible = i === c.v; });
      bakeMeshes[c.v].rotation.y = c.rot * Math.PI / 2;
      rt.viewport.set(c.x, c.y, c.w, c.h);
      rt.scissor.set(c.x, c.y, c.w, c.h);
      renderer.setRenderTarget(rt);
      renderer.render(bakeScene, c.cam);
    }
    renderer.setRenderTarget(null);
    rt.texture.anisotropy = 4;
    return rt.texture;
  };
  const half = CFG.tileW / 2, slab = -CFG.clipY;
  const topCam = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 10);
  topCam.position.set(0, 2, 0); topCam.up.set(0, 0, -1); topCam.lookAt(0, 0, 0);
  const sideCams = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => {
    const cam = new THREE.OrthographicCamera(-half, half, 0, -slab, 0.01, 10);
    cam.position.set(dx * 2, 0, dz * 2); cam.lookAt(0, 0, 0);
    return cam;
  });
  // aVar = variant * 4 + rotation: top atlas is 8 x 4 cells, side atlas is 16 x 8 cells (4 sides per aVar)
  const TC = 384, SW = 256, SH = 64, V = variants.length;
  const topCells = [], sideCells = [];
  for (let v = 0; v < V; v++) for (let r = 0; r < 4; r++) {
    const a = v * 4 + r;
    topCells.push({ v, rot: r, cam: topCam, x: (a % 8) * TC, y: Math.floor(a / 8) * TC, w: TC, h: TC });
    sideCams.forEach((cam, d) => { const k = a * 4 + d; sideCells.push({ v, rot: r, cam, x: (k % 16) * SW, y: Math.floor(k / 16) * SH, w: SW, h: SH }); });
  }
  const topAtlas = atlas(8 * TC, 4 * TC, topCells);
  const sideAtlas = atlas(16 * SW, 8 * SH, sideCells);
  bakeMeshes.forEach(m => { m.rotation.y = 0; });
  const atlasMat = (map, key, uvGlsl) => {
    const m = new THREE.MeshBasicMaterial({ map, color: new THREE.Color(2, 2, 2), alphaTest: 0.5 }); // alpha cuts the stone's rounded corners
    m.onBeforeCompile = sh => {
      sh.vertexShader = 'attribute float aVar;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n' + uvGlsl);
    };
    m.customProgramCacheKey = () => key;
    return m;
  };
  const top = atlasMat(topAtlas, 'top8', 'vMapUv = (vMapUv + vec2(mod(aVar, 8.0), floor(aVar / 8.0))) / vec2(8.0, 4.0);');
  const side = d => atlasMat(sideAtlas, 'side8-' + d, `{ float k = aVar * 4.0 + ${d}.0; vMapUv = (vMapUv + vec2(mod(k, 16.0), floor(k / 16.0))) / vec2(16.0, 8.0); }`);
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  return [side(0), side(1), top, top, side(2), side(3)];
}
// each biome's stones and door block, loaded and prepared the first time the biome is needed
const stoneSets = {};
const stoneSetLoads = {};
function stoneSet(name) {
  return stoneSetLoads[name] ||= (async () => {
    const B = BIOMES[name], loader = new GLTFLoader();
    const [doorG, ...pgs] = await Promise.all([loader.loadAsync(B.door), ...B.stones.map(f => loader.loadAsync(f))]);
    const variants = pgs.map(prepPillar);
    const door = prepDoor(doorG);
    // cave: the bioluminescent bits (bright and colorful, any hue) keep their own colors; remember them before the rock is recolored
    const glows = B.stepGlow ? variants.map(v => captureGlow(v.mat.map)) : null;
    // within a biome, every stone and the door block get the same rock color and the same moss color
    MOSS = B.moss || { hue: B.glow.hue, width: Math.max(0.08, B.glow.width) };
    const means = variants.map(v => rockMean(v.mat.map));
    const rockRef = B.rockColor || means[0].map(v => v * (B.rockGain || 1)); // the first stone of each biome sets the color (unless the biome names one)
    variants.forEach(v => { matchRock(v.mat.map, rockRef); tintRock(v.mat.map, rockRef, B.tint ?? 0.75, B.contrast ?? 0.65); });
    // then every stone gets the same typical brightness as the first (averages are thrown off by dark cracks)
    const midL = rockMedianL(variants[0].mat.map);
    variants.slice(1).forEach(v => scaleRock(v.mat.map, midL / rockMedianL(v.mat.map)));
    PROTECT_TRUNK = true; DOOR_MIN = B.dark ? 25 : 70;
    tintRock(door.mat.map, rockRef, Math.max(0.85, B.tint ?? 0), 1, false); // doors keep their own shading and the dark cave mouth // the door's stone must read as the same rock
    scaleRock(door.mat.map, 0.9 * midL / rockMedianL(door.mat.map));
    PROTECT_TRUNK = false;
    const mosses = variants.map(v => mossMean(v.mat.map)).filter(Boolean);
    const mossRef = B.mossColor || (mosses.length ? [0, 1, 2].map(k => mosses.reduce((a, m) => a + m[k], 0) / mosses.length) : null);
    if (mossRef && !B.stepGlow) variants.forEach(v => B.mossColor ? tintMoss(v.mat.map, mossRef, B.mossPalette) : matchMoss(v.mat.map, mossRef));
    if (glows) variants.forEach((v, i) => Object.assign(v, restoreGlow(v.mat.map, glows[i])));
    // the door's plant: its own color when the biome names one (the cave's mushroom door glows pink), else the moss color
    if (mossRef) B.doorPlant ? tintMoss(door.mat.map, B.doorPlant) : B.mossColor ? tintMoss(door.mat.map, mossRef) : matchMoss(door.mat.map, mossRef);
    MOSS = { hue: 0.27, width: 0.08 };
    variants.forEach(v => addGrassGlow(v.mat, 0.5, false, B.glow)); // the bake renders at half light
    const clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -CFG.clipY)];
    const wallMats = variants.map(v => { const m = v.mat.clone(); m.clippingPlanes = clip; m.clipShadows = true; addGrassGlow(m, 1, true, B.glow); if (v.glowTex) addStepGlow(m, v.glowTex); return m; });
    // the visible top of each stone when it lies flat: only the triangles above the floor cut (much lighter to draw)
    for (const v of variants) {
      const src = v.raw.index.array, P = v.raw.attributes.position, idx = [];
      for (let t = 0; t < src.length; t += 3) {
        const y = Math.max(P.getY(src[t]), P.getY(src[t + 1]), P.getY(src[t + 2]));
        if (y > CFG.clipY - 0.05) idx.push(src[t], src[t + 1], src[t + 2]);
      }
      v.cap = v.raw.clone(); v.cap.setIndex(idx);
    }
    door.mat.clippingPlanes = clip; door.mat.clipShadows = true;
    addGrassGlow(door.mat, 1, true, B.doorGlow || B.glow);
    // the cave's mushroom door: everything above the stone (the mushroom) turns pink and glows, so it stands out
    if (B.doorPlant) {
      const base = door.mat.onBeforeCompile, P = new THREE.Color(...B.doorPlant.map(v => v / 255));
      door.mat.onBeforeCompile = (sh, rr) => {
        base(sh, rr);
        sh.uniforms.uPlant = { value: P };
        sh.vertexShader = 'varying float vPlantY;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlantY = position.y;');
        sh.fragmentShader = 'uniform vec3 uPlant;\nvarying float vPlantY;\n' + sh.fragmentShader
          .replace('#include <map_fragment>', '#include <map_fragment>\n{ float pl = smoothstep(0.01, 0.08, vPlantY); float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = mix(diffuseColor.rgb, uPlant * (0.3 + 0.7 * l), pl); }')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uPlant * uPlant * smoothstep(0.01, 0.08, vPlantY) * 0.6;');
      };
      door.mat.customProgramCacheKey = () => 'door-plant';
    }
    return (stoneSets[name] = { variants, wallMats, floorMat: bakeFloor(variants, B), door, rockRef, mossRef });
  })();
}

async function load() {
  const loader = new GLTFLoader();
  const cg = await loader.loadAsync('assets/character.glb');
  const woods = await stoneSet('woods');
  const slab = -CFG.clipY;
  const floorGeo = new THREE.BoxGeometry(CFG.tileW, slab, CFG.tileW).translate(0, -slab / 2, 0);
  const shadowGeo = new THREE.PlaneGeometry(CFG.tileW, CFG.tileW).rotateX(-Math.PI / 2).translate(0, 0.002, 0);
  const shadowMat = new THREE.ShadowMaterial({ color: '#6b5640', opacity: 0.16, depthWrite: false });
  assets = { floorGeo, shadowGeo, shadowMat, char: cg.scene, rockRef: woods.rockRef, mossRef: woods.mossRef };
}

let mode = 'levels', start = [0, 0], goal = [1, 1], rivals = [], raceSize = 3, raceTeam = false, keyDist = null;
// race setup, saved on this device: how many Buddies (2-4, one per corner), how many are your teammates, rival speed
const raceCfg = { racers: 3, mates: 0, speed: 1 };
try { Object.assign(raceCfg, JSON.parse(localStorage.getItem('hidden-maze-race') || '{}')); } catch {}
const RIVAL_PACE = [{ step: 2.2, detour: 0.42 }, { step: 1.8, detour: 0.3 }, { step: 1.45, detour: 0.18 }, { step: 1.2, detour: 0.07 }]; // easy, normal, hard, pro
// every two race wins the race maze grows (10 -> 16 cells)
let raceWins = 0;
try { raceWins = +localStorage.getItem('hidden-maze-race-wins') || 0; } catch {}
// race: a big maze with an entry near each corner and one key in the middle
function makeRaceMaze() {
  let m, N, d;
  // mirrored maze: all four corner entries are the same distance from the key (retry if the middle isn't reachable)
  for (let tries = 0; tries < 30; tries++) {
    m = genFairRaceMaze(10 + 2 * Math.min(3, Math.floor(raceWins / 2))); N = m.N;
    for (const [x, z] of [[1, 0], [N - 2, 0], [1, N - 1], [N - 2, N - 1]]) m.g[z * N + x] = 0;
    d = shortestPath(m, N - 2, N - 1, (N - 1) / 2, (N - 1) / 2);
    if (d > 10) break;
  }
  // yours is nearest the camera; with 3 racers the rivals take the two side corners, with 2 the far one;
  // in a team race your teammate starts in the far corner (listed last)
  const entries = raceSize === 2 ? [[N - 2, N - 1], [1, 0]] : raceSize === 3 ? [[N - 2, N - 1], [1, N - 1], [N - 2, 0]] : [[N - 2, N - 1], [1, N - 1], [N - 2, 0], [1, 0]];
  return { maze: m, entries, goal: [(N - 1) / 2, (N - 1) / 2] };
}
// ---------- door levels ----------
// From level 6, every 4th level is split in two: no way across on the surface. A door block in your half leads down
// to a small cave maze; a door there brings you back up in the key's half (like Mario's pipes).
const isGateway = L => L >= 5 && L % 4 === 1;
const levelBiome = L => WORLDS[Math.floor(L / LEVELS_PER_WORLD)].biome;
// two separate mazes, one above and one below a solid middle row; door A below it, door B above it
function genSplitMaze(C, rnd) {
  const N = C * 2 + 1, h = Math.floor(C / 2), zDiv = 2 * h, g = new Uint8Array(N * N).fill(1);
  for (const inHalf of [cz => cz < h, cz => cz >= h]) {
    const cells = [];
    for (let cz = 0; cz < C; cz++) for (let cx = 0; cx < C; cx++) if (inHalf(cz)) cells.push([cx, cz]);
    const ok = (cx, cz) => cx >= 0 && cx < C && cz >= 0 && cz < C && inHalf(cz);
    const [sx, sz] = cells[Math.floor(rnd() * cells.length)], stack = [[sx, sz]];
    g[(2 * sz + 1) * N + 2 * sx + 1] = 0;
    while (stack.length) {
      const [cx, cz] = stack[stack.length - 1];
      const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => ok(cx + dx, cz + dz) && g[(2 * (cz + dz) + 1) * N + 2 * (cx + dx) + 1] === 1);
      if (!opts.length) { stack.pop(); continue; }
      const [dx, dz] = opts[Math.floor(rnd() * opts.length)];
      g[(2 * cz + 1 + dz) * N + 2 * cx + 1 + dx] = 0;
      g[(2 * (cz + dz) + 1) * N + 2 * (cx + dx) + 1] = 0;
      stack.push([cx + dx, cz + dz]);
    }
  }
  const xA = N - 2 - 2 * Math.floor(rnd() * 2), xB = 1 + 2 * Math.floor(rnd() * 2);
  // pull the two halves apart: an open gap of GAP empty rows between them, so you can see they are not connected
  // (the grid stays square, so the extra width is split as empty columns on both sides)
  const GAP = 3, M = N + GAP + 1, ox = Math.floor((GAP + 1) / 2), dz = GAP + 1;
  const g2 = new Uint8Array(M * M).fill(1), empty = new Uint8Array(M * M).fill(1);
  const put = (x, z, x2, z2) => { g2[z2 * M + x2] = g[z * N + x]; empty[z2 * M + x2] = 0; };
  for (let z = 0; z <= zDiv; z++) for (let x = 0; x < N; x++) put(x, z, x + ox, z);
  for (let z = zDiv; z < N; z++) for (let x = 0; x < N; x++) put(x, z, x + ox, z + dz);
  return { N: M, g: g2, empty, start: [N - 2 + ox, N - 2 + dz], goal: [1 + ox, 1],
    doors: [{ id: 'A', x: xA + ox, z: zDiv + dz, out: [xA + ox, zDiv + dz + 1] }, { id: 'B', x: xB + ox, z: zDiv, out: [xB + ox, zDiv - 1] }] };
}
// the cave under a door level: door A near the bottom corner, door B at the far corner
function genCaveMaze(L) {
  const m = genMaze(4 + Math.min(4, Math.floor(L / 10)), mulberry32(L * 7919 + 3)), N = m.N;
  m.doors = [{ id: 'A', x: N - 2, z: N - 1, out: [N - 2, N - 2] }, { id: 'B', x: 1, z: 0, out: [1, 1] }];
  return m;
}
let biome = 'woods', curSet = null, stage = 'surface', doorMeshes = new Map();
// switch light, sky, floor, fog and color grade to a biome
function applyBiome(name) {
  const B = BIOMES[name];
  biome = name;
  sun.color.set(B.sun[0]); sun.intensity = B.sun[1];
  sun.userData.hemi.color.set(B.hemi[0]); sun.userData.hemi.groundColor.set(B.hemi[1]); sun.userData.hemi.intensity = B.hemi[2];
  sun.userData.fill.color.set(B.fill[0]); sun.userData.fill.intensity = B.fill[1];
  BG.set(B.bg); scene.fog.color.set(B.bg);
  ground.material.color.set(B.floor);
  ground.material.roughness = B.dark ? 1 : 0.3; // a glossy dark floor shows the sun as a bright spot
  mirror.material.uniforms.color.value.set(B.mirror);
  FLOOR_RGB.set(B.floor);
  scene.environmentIntensity = B.dark ? 0.12 : 0.35;
  sceneryGroup.visible = !B.dark;
  document.body.dataset.biome = name;
  atmosphere.setDust(B.dust, B.dark);
  atmosphere.setWeather(name);
  STONE_DUST = B.puffs;
}
function buildLevel(level, race = null, opts = {}) {
  L = level; mode = race ? 'race' : 'levels';
  stage = opts.stage || 'surface';
  const world = WORLDS[race ? 0 : Math.floor(L / LEVELS_PER_WORLD)];
  const bName = race ? 'woods' : stage === 'cave' ? 'cave' : world.biome;
  curSet = stoneSets[bName];
  applyBiome(bName);
  if (floor) { scene.remove(...walls, ...caps, floor, floorShadow, key); for (const m of [...walls, ...caps, floor, floorShadow]) m.dispose(); }
  for (const m of doorMeshes.values()) scene.remove(m);
  doorMeshes.clear();
  const shape = race || isGateway(L) ? null : levelShape(L);
  const rnd = mulberry32(L * 9973 + 17);
  maze = race ? race.maze : stage === 'cave' ? genCaveMaze(L) : isGateway(L) ? genSplitMaze(levelCells(L), rnd) : shape ? genShapedMaze(levelCells(L), rnd, shape) : genMaze(levelCells(L), rnd);
  // within a world you see less of the maze around you as the levels go on
  CFG.revealR = parseFloat(params.get('r') || (race ? world.reveal : world.reveal - 0.35 * (L % LEVELS_PER_WORLD) / (LEVELS_PER_WORLD - 1)));
  const { N } = maze, T = N * N;
  origin = (N - 1) / 2;
  heights = new Float32Array(T); vels = new Float32Array(T); targets = new Float32Array(T); shake = new Float32Array(T);
  varIdx = Uint8Array.from({ length: T }, () => Math.floor(Math.random() * curSet.variants.length));
  rotIdx = Uint8Array.from({ length: T }, () => Math.floor(Math.random() * 4));
  // hand-placed look: each stone slightly twisted and nudged
  twist = new Float32Array(T); // stones stay square to the grid
  nudge = Float32Array.from({ length: T * 2 }, () => rand(-0.012, 0.012));
  assets.floorGeo.setAttribute('aVar', new THREE.InstancedBufferAttribute(new Float32Array(T), 1));
  tint = [];
  for (let i = 0; i < T; i++) { const v = rand(0.92, 1); tint.push(new THREE.Color(v * world.tint[0], v * world.tint[1], v * world.tint[2])); }
  walls = curSet.variants.map((v, i) => {
    const m = new THREE.InstancedMesh(v.raw, curSet.wallMats[i], T);
    m.castShadow = true;
    m.setColorAt(0, tint[0]);
    return m;
  });
  // flat stones near the camera are drawn as the real stone top (no flattening); far ones use the lighter picture
  tileGlow = new Float32Array(T);
  caps = curSet.variants.map((v, i) => {
    const geo = new THREE.BufferGeometry();
    geo.setIndex(v.cap.index);
    for (const k in v.cap.attributes) geo.setAttribute(k, v.cap.attributes[k]);
    geo.boundingSphere = v.cap.boundingSphere; geo.boundingBox = v.cap.boundingBox;
    geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(T), 1));
    const m = new THREE.InstancedMesh(geo, curSet.wallMats[i], T);
    m.receiveShadow = true;
    m.setColorAt(0, tint[0]);
    return m;
  });
  floor = new THREE.InstancedMesh(assets.floorGeo, curSet.floorMat, T);
  floorShadow = new THREE.InstancedMesh(assets.shadowGeo, assets.shadowMat, T);
  floorShadow.receiveShadow = true;
  for (const m of [...walls, ...caps, floor, floorShadow]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
  }
  floor.setColorAt(0, tint[0]);
  // door blocks: their own meshes, rising and sinking with their tile; the cave mouth faces the side you come from
  for (const d of maze.doors || []) {
    const m = new THREE.Mesh(curSet.door.raw, curSet.door.mat);
    m.castShadow = true;
    m.rotation.y = curSet.door.yaw + Math.atan2(-(d.out[1] - d.z), d.out[0] - d.x); // cave mouth toward the side you arrive from
    m.userData = d;
    scene.add(m);
    doorMeshes.set(d.z * N + d.x, m);
  }
  placeScenery();
  if (mazeGrass) mazeGrass.visible = false;
  if (bName === 'woods') meadowReady.then(() => { if (maze && biome === 'woods') buildMazeGrass(meadow); });
  if (bName === 'autumn') buildMazeGrass(leafLitter(), 0.95, 3.6, 0.3);
  key = makeKey();
  start = opts.spawn || (race ? race.entries[0] : maze.start || [N - 2, N - 2]);
  goal = race ? race.goal : stage === 'cave' ? [-9, -9] : maze.goal || [1, 1]; // no key in the cave
  key.position.set(goal[0] - origin, 0.55, goal[1] - origin);
  key.visible = stage !== 'cave';
  scene.add(key);

  st.gx = st.tx = st.fx = start[0]; st.gz = st.tz = st.fz = start[1];
  st.t = 1; st.moving = false;
  if (!opts.keep) { st.facing = -Math.PI / 4; steps = 0; elapsed = 0; }
  won = false; heldDir = queued = null;
  if (opts.keep) { /* stats carry over through the doors */ }
  else if (isGateway(L) && !race) { // best path: to door A, through the cave, then from door B to the key
    const [a, b] = maze.doors, cave = genCaveMaze(L);
    optimal = shortestPath(maze, start[0], start[1], a.out[0], a.out[1]) + shortestPath(cave, cave.doors[0].out[0], cave.doors[0].out[1], cave.doors[1].out[0], cave.doors[1].out[1]) + shortestPath(maze, b.out[0], b.out[1], goal[0], goal[1]) + 4;
  } else optimal = shortestPath(maze, start[0], start[1], goal[0], goal[1]);
  ui.level.textContent = race ? 'RACE' : `${Math.floor(L / LEVELS_PER_WORLD) + 1}-${L % LEVELS_PER_WORLD + 1}`;
  ui.steps.textContent = steps;
  ui.hint.classList.toggle('on', !race && L === 0 && !opts.keep);
  for (const r of rivals) scene.remove(r.root);
  keyDist = null;
  if (race) { // walking distance from every tile to the key, for the live ranking
    keyDist = new Int32Array(N * N).fill(1e6);
    const q = [goal[1] * N + goal[0]]; keyDist[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % N, z = (i / N) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Z = z + dz, j = Z * N + X;
        if (X >= 0 && Z >= 0 && X < N && Z < N && !maze.g[j] && keyDist[j] > keyDist[i] + 1) { keyDist[j] = keyDist[i] + 1; q.push(j); }
      }
    }
  }
  rivals = race ? race.entries.slice(1).map((e, i) => makeRival(e, RIVAL_SKINS.filter(c => c !== skin)[i])) : [];
  for (let k = 0; race && k < raceCfg.mates; k++) rivals[rivals.length - 1 - k].team = true; // your teammates (the far corners first)
  updateTargets(true);
  for (let i = 0; i < T; i++) heights[i] = targets[i];
  camTarget.copy(worldPos(st.gx, st.gz));
  if (isGateway(L) && !race) stoneSet('cave'); // get the cave ready in the background
}

function worldPos(gx, gz) { return new THREE.Vector3(gx - origin, 0, gz - origin); }
const isWall = (x, z) => x < 0 || z < 0 || x >= maze.N || z >= maze.N || maze.g[z * maze.N + x] === 1; // empty tiles are walls too (g = 1)

function updateTargets(silent) {
  const { N, g } = maze;
  const cx = st.tx, cz = st.tz;
  let rising = 0, panSum = 0;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = z * N + x;
    if (!g[i] || (maze.empty && maze.empty[i])) { targets[i] = 0; continue; }
    const dx = x - cx, dz = z - cz;
    const prev = targets[i];
    let t = 0;
    if (Math.hypot(dx, dz) <= CFG.revealR) t = (dx + dz > 0) ? CFG.stubH : CFG.wallH; // camera sits on the +x+z side
    targets[i] = t;
    if (!silent && prev !== t) shake[i] = 1;
    if (!silent && prev === 0 && t > 0) { stonePuffs(x - origin, z - origin, true); rising++; panSum += panOf(x, z); }
    else if (!silent && prev > 0 && t === 0) stonePuffs(x - origin, z - origin, false);
  }
  if (rising) sfx.play('rise', Math.min(0.45, 0.26 + rising * 0.04), panSum / rising, { maxDur: 0.55 });
}

// ---------- scenery ----------
// Ruins, trees and rocks around the maze, sunk into the white floor. Architecture (arches, towers, walls) is big
// and sunk deep; trees, bushes and rocks are small. A white haze rises from the floor, so only their tops show.
// They are big files, so they load one by one in the background after the game starts.
// only the big structures (castles, towers, arches, gate, shrine, ruined walls), each on a soft patch of grass
const SCENERY = [[1, 'arch'], [2, 'arch'], [3, 'arch'], [4, 'arch'], [5, 'arch'], [7, 'arch'], [8, 'arch'], [15, 'arch'], [16, 'arch']];
const KIND = {
  arch: { size: [3.0, 4.4], sink: [0.1, 0.22], count: 6, gap: 6, inner: 3.4, outer: 11 },
};
const sceneryModels = { arch: [] };
const sceneryGroup = new THREE.Group();
scene.add(sceneryGroup);
const groundClip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND_Y)];
// fades a piece into the floor color from its base up to uHazeTop (world height above the floor)
function addHaze(mat) {
  const prev = mat.onBeforeCompile;
  mat.userData.haze = { uHazeTop: { value: 1 }, uHazeColor: { value: FLOOR_RGB }, uFloorY: { value: GROUND_Y } };
  mat.onBeforeCompile = sh => {
    prev(sh);
    Object.assign(sh.uniforms, mat.userData.haze);
    sh.vertexShader = 'varying float vWorldY;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = 'varying float vWorldY;\nuniform float uHazeTop, uFloorY;\nuniform vec3 uHazeColor;\n' + sh.fragmentShader.replace('#include <fog_fragment>',
      'gl_FragColor.rgb = mix(uHazeColor, gl_FragColor.rgb, smoothstep(0.0, uHazeTop, vWorldY - uFloorY));\n#include <fog_fragment>');
  };
  mat.customProgramCacheKey = () => 'scenery-haze';
}
async function loadScenery() {
  const loader = new GLTFLoader();
  for (const [n, kind] of SCENERY) {
    const url = `assets/decor/d${String(n).padStart(2, '0')}.glb`;
    try {
      const g = await loader.loadAsync(url);
      const pm = firstMesh(g.scene);
      pm.updateWorldMatrix(true, false);
      const geo = pm.geometry.clone().applyMatrix4(pm.matrixWorld);
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const s = 1 / Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z); // footprint 1 x 1, bottom at 0
      geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2).scale(s, s, s);
      const map = canvasTexture(pm.material.map, 512);
      matchRock(map, assets.rockRef, 0.7);
      matchMoss(map, assets.mossRef);
      const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, clippingPlanes: groundClip });
      addGrassGlow(mat, 1);
      sceneryModels[kind].push({ geo, mat, h: (bb.max.y - bb.min.y) * s });
      if (maze) placeScenery();
    } catch (e) { console.warn('scenery', url, e); }
  }
}
// grass cut from the open meadow in the middle of the painted map
const meadow = document.createElement('canvas'); meadow.width = meadow.height = 256;
const meadowReady = new Promise(res => {
  const img = new Image();
  img.onload = () => { meadow.getContext('2d').drawImage(img, 470, 640, 400, 400, 0, 0, 256, 256); res(); };
  img.src = 'assets/map/woods.webp';
});
// a round patch of grass under a structure: strongest at its base, fading out quickly to the white floor
const grassPatch = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  meadowReady.then(() => {
    const x = c.getContext('2d');
    x.drawImage(meadow, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(0,0,0,.9)'); g.addColorStop(0.3, 'rgba(0,0,0,.55)'); g.addColorStop(0.65, 'rgba(0,0,0,.15)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    tex.needsUpdate = true;
  });
  return { geo: new THREE.CircleGeometry(0.5, 48).rotateX(-Math.PI / 2), mat: new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }) };
})();
// grass under the maze itself: follows the maze's shape (square, circle, heart...), shows between the stones
// and fades out a little past the edges
let mazeGrass = null;
// autumn ground: a tileable carpet of fallen leaves over warm earth
let leafLitterC = null;
function leafLitter() {
  if (leafLitterC) return leafLitterC;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), rnd = mulberry32(4242);
  x.fillStyle = '#d6b07c'; x.fillRect(0, 0, S, S);
  // soft earthy blotches
  for (let i = 0; i < 40; i++) {
    const px = rnd() * S, py = rnd() * S, r = 10 + rnd() * 30;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      const g = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, r);
      g.addColorStop(0, rnd() < 0.5 ? 'rgba(190,140,90,.35)' : 'rgba(235,205,150,.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(px + ox - r, py + oy - r, r * 2, r * 2);
    }
  }
  const COLORS = ['#e8873a', '#f2a93b', '#d4602f', '#e9c24a', '#c9542a', '#f0b860', '#b8743a'];
  for (let i = 0; i < 230; i++) {
    const px = rnd() * S, py = rnd() * S, len = 7 + rnd() * 9, wid = len * (0.45 + rnd() * 0.2), a = rnd() * Math.PI * 2;
    const col = COLORS[Math.floor(rnd() * COLORS.length)];
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S], [S, S], [-S, -S], [S, -S], [-S, S]]) {
      if (px + ox < -20 || px + ox > S + 20 || py + oy < -20 || py + oy > S + 20) continue;
      x.save(); x.translate(px + ox, py + oy); x.rotate(a);
      x.fillStyle = 'rgba(120,70,30,.18)'; // a little shadow under each leaf
      x.beginPath(); x.ellipse(1.2, 1.5, len, wid, 0, 0, 7); x.fill();
      x.fillStyle = col;
      x.beginPath(); x.moveTo(-len, 0); x.quadraticCurveTo(0, -wid * 1.4, len, 0); x.quadraticCurveTo(0, wid * 1.4, -len, 0); x.fill();
      x.strokeStyle = 'rgba(255,240,210,.45)'; x.lineWidth = 0.8; // the middle vein
      x.beginPath(); x.moveTo(-len * 0.9, 0); x.lineTo(len * 0.9, 0); x.stroke();
      x.restore();
    }
  }
  return (leafLitterC = c);
}
function buildMazeGrass(pattern, opacity = 0.85, spread = 2.4, dab = 0.22) {
  if (mazeGrass) { scene.remove(mazeGrass); mazeGrass.material.map.dispose(); mazeGrass.material.dispose(); mazeGrass = null; }
  const { N } = maze, M = N + 8, PX = 512, k = PX / M, c = document.createElement('canvas');
  c.width = c.height = PX;
  const x = c.getContext('2d');
  // soft brush dabs on every tile of the maze build up the shape with feathered edges
  for (let z = 0; z < N; z++) for (let gx = 0; gx < N; gx++) {
    if (maze.empty && maze.empty[z * N + gx]) continue;
    const cx = (gx + 4.5) * k, cy = (z + 4.5) * k, r = spread * k;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${dab})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = x.createPattern(pattern, 'repeat');
  x.fillRect(0, 0, PX, PX);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  mazeGrass = new THREE.Mesh(new THREE.PlaneGeometry(M, M).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, toneMapped: false }));
  mazeGrass.position.set(0, GROUND_Y + 0.003, 0);
  mazeGrass.renderOrder = 1;
  mazeGrass.layers.set(1);
  scene.add(mazeGrass);
}
function placeScenery() {
  for (const m of sceneryGroup.children) if (m.material !== grassPatch.mat) m.material.dispose();
  sceneryGroup.clear();
  if (!maze) return;
  const rnd = mulberry32(L * 31 + 7), half = maze.N / 2, spots = [];
  for (const kind of ['arch']) {
    const K = KIND[kind], models = sceneryModels[kind];
    if (!models.length) continue;
    let placed = 0;
    for (let tries = 0; placed < K.count && tries < 600; tries++) {
      const R = half + K.outer, x = (rnd() * 2 - 1) * R, z = (rnd() * 2 - 1) * R;
      const size = K.size[0] + rnd() * (K.size[1] - K.size[0]);
      // stay clear of the maze (the whole footprint, not just the center) and of other pieces
      if (Math.max(Math.abs(x), Math.abs(z)) - size / 2 < half + K.inner - size / 2) continue;
      if (spots.some(p => Math.hypot(p[0] - x, p[1] - z) < (p[2] + size) / 2 + K.gap * 0.3)) continue;
      spots.push([x, z, size]);
      const m = models[Math.floor(rnd() * models.length)];
      const mat = m.mat.clone();
      mat.onBeforeCompile = m.mat.onBeforeCompile;
      addHaze(mat);
      const h = m.h * size, sink = K.sink[0] + rnd() * (K.sink[1] - K.sink[0]);
      mat.userData.haze.uHazeTop.value = h * (1 - sink) * 0.1; // the grass patch carries the fade now; just soften the very base
      const mesh = new THREE.Mesh(m.geo, mat);
      mesh.scale.setScalar(size);
      mesh.rotation.y = rnd() * Math.PI * 2;
      mesh.position.set(x, GROUND_Y - h * sink, z);
      mesh.layers.set(1);
      sceneryGroup.add(mesh);
      const patch = new THREE.Mesh(grassPatch.geo, grassPatch.mat);
      patch.scale.setScalar(size * (1.4 + rnd() * 0.35)); // hugs the base
      patch.rotation.y = rnd() * Math.PI * 2;
      patch.position.set(x, GROUND_Y + 0.004, z);
      patch.layers.set(1);
      patch.renderOrder = 1; // over the floor
      sceneryGroup.add(patch);
      placed++;
    }
  }
}

// ---------- outfit color ----------
// The character texture is messy, so instead of new textures we recolor its olive-green pixels (hood + jacket) in the shader.
const SKINS = ['#5d6b3f', '#2f6fe0', '#e2453a', '#ff8a1f', '#ff5fa8', '#8a55e0', '#ffd23f', '#1fb5a5', '#f4f1ea'];
const TINT = { uTint: { value: new THREE.Color() }, uTintOn: { value: 0 } };
const OUTFIT_GLSL = `
  {
    vec3 c = diffuseColor.rgb;
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn;
    float hue = 0.0;
    if (d > 1e-4) {
      if (mx == c.r) hue = mod((c.g - c.b) / d, 6.0);
      else if (mx == c.g) hue = (c.b - c.r) / d + 2.0;
      else hue = (c.r - c.g) / d + 4.0;
      hue /= 6.0;
    }
    float sat = d / max(mx, 1e-4);
    float m = smoothstep(0.075, 0.035, abs(hue - 0.2)) * smoothstep(0.25, 0.45, sat) * uTintOn;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    diffuseColor.rgb = mix(c, uTint * clamp(lum / 0.16, 0.0, 1.4), m);
  }`;
function addOutfit(sh, rim, T = TINT) {
  Object.assign(sh.uniforms, T);
  sh.fragmentShader = 'uniform vec3 uTint;\nuniform float uTintOn;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + OUTFIT_GLSL);
  // warm rim light so the character pops off the stone
  if (rim) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n{ float rimF = pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 2.5); totalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * rimF * 0.55; }');
}
let skin = 0;
try { skin = Math.min(SKINS.length - 1, +localStorage.getItem('hidden-maze-skin') || 0); } catch {}
function setSkin(i) {
  skin = i;
  TINT.uTint.value.set(SKINS[i]);
  TINT.uTintOn.value = i === 0 ? 0 : 1;
  // the logo wears the hood color, a little lighter so it reads like the lit hood
  document.documentElement.style.setProperty('--logo', '#' + new THREE.Color(SKINS[i]).offsetHSL(0, 0.08, 0.1).getHexString());
  if (silhouette) silhouette.traverse(o => { if (o.isMesh) o.material.color.set(SKINS[i]); });
  try { localStorage.setItem('hidden-maze-skin', i); } catch {}
  [...$('skins').children].forEach((b, k) => b.classList.toggle('on', k === i));
}
$('skins').innerHTML = SKINS.map((c, i) => `<button style="--c:${c}" aria-label="Outfit color ${i + 1}"></button>`).join('');
$('skins').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  setSkin([...$('skins').children].indexOf(b));
});

// ---------- player ----------
// procedural walk: the model has no skeleton, so legs and arms are swung in the vertex shader.
// Values are in the model's own space: height -0.5..0.5, facing +X, legs/arms split along Z.
const walkU = { uPhase: { value: 0 }, uAmp: { value: 0 }, uHurt: { value: 0 }, uHurtWig: { value: 0 }, uWave: { value: 0 }, uWaveT: { value: 0 } };
const newWalkU = () => ({ uPhase: { value: 0 }, uAmp: { value: 0 }, uHurt: { value: 0 }, uHurtWig: { value: 0 }, uWave: { value: 0 }, uWaveT: { value: 0 } });
function addWalk(mat, { outline = 0, outfit = false, U = walkU, T = TINT } = {}) {
  mat.onBeforeCompile = sh => {
    if (outfit) addOutfit(sh, true, T);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'uniform float uPhase;\nuniform float uAmp;\nuniform float uHurt;\nuniform float uHurtWig;\nuniform float uWave;\nuniform float uWaveT;\nvec2 rot2(vec2 p, float a) { return vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a)); }\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float sw = sin(uPhase) * uAmp;
        vec3 q = transformed;
        // legs: pivot at the hip, opposite legs swing opposite ways
        const float hip = -0.28;
        float wl = smoothstep(hip + 0.03, hip - 0.05, q.y) * clamp(q.z / 0.04, -1.0, 1.0);
        q.xy = rot2(q.xy - vec2(0.0, hip), 0.6 * sw * wl) + vec2(0.0, hip);
        // arms: drop them a bit from the A-pose, then swing opposite to the leg on the same side
        const float sho = 0.03;
        float side = sign(q.z);
        float wa = smoothstep(0.125, 0.16, abs(q.z)) * smoothstep(sho + 0.05, sho - 0.02, q.y) * step(-0.36, q.y);
        // uHurt throws both arms up and out; uWave raises one arm high and waves it
        float waveUp = uWave * step(0.0, side) * (2.3 + 0.4 * sin(uWaveT));
        vec2 yz = rot2(vec2(q.y - sho, abs(q.z) - 0.14), (0.28 - 1.2 * uHurt - waveUp) * wa);
        q.y = yz.x + sho; q.z = side * (yz.y + 0.14);
        float along = clamp((sho - q.y) / 0.36, 0.0, 1.0); // 0 at the shoulder, 1 at the hand
        float wig = sin(uPhase * 2.0 - along * 2.6) * along * uAmp;
        q.xy = rot2(q.xy - vec2(0.0, sho), (-0.85 * sw * side - 0.45 * wig + uHurtWig * side) * wa) + vec2(0.0, sho);
        vec2 fl = rot2(vec2(q.y - sho, abs(q.z) - 0.14), 0.22 * along * uAmp * (0.5 + 0.5 * sin(uPhase * 2.0 + 1.3)) * wa);
        q.y = fl.x + sho; q.z = side * (fl.y + 0.14);
        transformed = q${outline ? ` + normalize(normal) * ${outline.toFixed(4)}` : ''};
      }`);
  };
  mat.customProgramCacheKey = () => 'walk' + outline + outfit;
}

function setupPlayer() {
  player = new THREE.Group();
  const inner = assets.char.clone(true);
  const box = new THREE.Box3().setFromObject(inner);
  const s = CFG.charH / (box.max.y - box.min.y);
  inner.scale.setScalar(s);
  inner.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
  // drawn in the transparent pass after the silhouette, so the silhouette only shows where stone hides the character
  inner.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material.metalness = 0; o.material.transparent = true; o.renderOrder = 20; addWalk(o.material, { outfit: true }); } });
  // comic ink outline (inverted hull) so the character reads clearly against the stone
  const outline = inner.clone(true);
  const outMat = new THREE.MeshBasicMaterial({ color: '#161414', side: THREE.BackSide });
  addWalk(outMat, { outline: 0.016 });
  outline.traverse(o => { if (o.isMesh) { o.material = outMat; o.castShadow = false; } });
  const body = new THREE.Group(); body.add(inner, outline);
  player.add(body);
  player.userData.body = body;
  // silhouette that shows through stone
  silhouette = inner.clone(true);
  const silMat = new THREE.MeshBasicMaterial({ color: OLIVE, transparent: true, opacity: 0.55, depthFunc: THREE.GreaterDepth, depthWrite: false });
  addWalk(silMat);
  silhouette.traverse(o => { if (o.isMesh) { o.material = silMat; o.castShadow = false; o.renderOrder = 10; } });
  body.add(silhouette);
  scene.add(player);
}

function tryMove(dx, dz) {
  if (won || state !== 'play' || warp.t >= 0) return false; // also stops the race once someone has the key
  if (intro.t >= 0) { skipIntro(); return false; }
  if (st.moving) { queued = [dx, dz]; return false; }
  const nx = st.gx + dx, nz = st.gz + dz;
  st.facing = Math.atan2(-dz, dx); // the model faces +X
  const door = maze.doors && maze.doors.find(d => d.x === nx && d.z === nz);
  if (door) { startWarp(door); return false; }
  if (isWall(nx, nz)) {
    if (st.bumpT < 0 || st.bumpT > 0.45) { st.bumpT = 0; st.bdx = dx; st.bdz = dz; }
    return false;
  }
  st.fx = st.gx; st.fz = st.gz; st.tx = nx; st.tz = nz; st.t = 0; st.moving = true;
  steps++; ui.steps.textContent = steps;
  updateTargets(false);
  const p = worldPos(st.gx, st.gz);
  footPuffs(p.x, p.z, dx, dz);
  if (steps === 1) ui.hint.classList.remove('on');
  return true;
}

// ---------- going through a door ----------
// Buddy walks into the cave mouth and shrinks into it, the camera lifts and the view fades to dark; the other level
// is built, then the view fades back in and Buddy walks out of the matching door on the other side.
const warp = { t: -1, door: null, swapped: false, from: new THREE.Vector3(), to: new THREE.Vector3() };
const WARP_IN = 0.45, WARP_DARK = 1.05, WARP_END = 1.75;
function startWarp(door) {
  warp.t = 0; warp.door = door; warp.swapped = false; heldDir = queued = null;
  warp.from.copy(worldPos(st.gx, st.gz)); warp.to.copy(worldPos(door.x, door.z));
  st.facing = Math.atan2(-(door.z - st.gz), door.x - st.gx);
  sfx.play('step', 0.62, 0, { maxDur: 0.26 });
}
async function warpSwap() {
  const toCave = stage !== 'cave';
  const dest = toCave ? genCaveMaze(L).doors.find(d => d.id === warp.door.id) : null;
  if (toCave) await stoneSet('cave'); else await stoneSet(levelBiome(L));
  const back = !toCave ? genSplitMaze(levelCells(L), mulberry32(L * 9973 + 17)).doors.find(d => d.id === warp.door.id) : null;
  const d = dest || back;
  buildLevel(L, null, { stage: toCave ? 'cave' : 'surface', spawn: d.out, keep: true });
  warp.from.copy(worldPos(d.x, d.z)); warp.to.copy(worldPos(d.out[0], d.out[1]));
  st.facing = Math.atan2(-(d.out[1] - d.z), d.out[0] - d.x);
  camTarget.copy(warp.to);
}
function updateWarp(dt) {
  if (warp.t < 0) return;
  warp.t += Math.min(dt, 1 / 30);
  const t = warp.t, fader = $('fader'), body = player.userData.body;
  if (t < WARP_IN) { // walk into the door and shrink into it
    const k = t / WARP_IN;
    player.position.lerpVectors(warp.from, warp.to, k * 0.75);
    body.scale.setScalar(1 - 0.65 * k);
    walkU.uAmp.value = 1;
  } else if (t < WARP_DARK) { // lift and fade to dark
    fader.style.opacity = (t - WARP_IN) / (WARP_DARK - WARP_IN);
    body.scale.setScalar(0.001);
  } else if (!warp.swapped) {
    warp.swapped = true;
    warp.t = WARP_DARK; // hold the dark until the other level is ready
    warp.wait = true;
    warpSwap().then(() => { warp.wait = false; });
  } else if (warp.wait) {
    warp.t = WARP_DARK;
  } else if (t < WARP_END) { // fade in and walk out of the other door
    const k = (t - WARP_DARK) / (WARP_END - WARP_DARK);
    fader.style.opacity = 1 - k;
    player.position.lerpVectors(warp.from, warp.to, 0.25 + 0.75 * k);
    body.scale.setScalar(0.35 + 0.65 * k);
    walkU.uAmp.value = 1;
  } else {
    warp.t = -1; fader.style.opacity = 0; body.scale.setScalar(1);
  }
  // the camera lifts away while it's dark and comes back down on arrival
  const lift = t < WARP_IN ? 0 : t < WARP_DARK ? (t - WARP_IN) / (WARP_DARK - WARP_IN) : Math.max(0, 1 - (t - WARP_DARK) / (WARP_END - WARP_DARK));
  camera.userData.W = viewW * (1 + 1.2 * ease(lift));
}

function updatePlayer(dt, time) {
  if (warp.t >= 0) return; // the door animation drives Buddy
  const body = player.userData.body;
  let x, z, y = 0, sq = 1;
  if (st.moving) {
    st.t = Math.min(1, st.t + dt / CFG.stepTime);
    const e = st.t;
    x = st.fx + (st.tx - st.fx) * e; z = st.fz + (st.tz - st.fz) * e;
    y = Math.abs(Math.sin(walkU.uPhase.value)) * 0.05;
    if (st.t >= 1) {
      st.moving = false; st.gx = st.tx; st.gz = st.tz;
      sfx.play('step', 0.62, 0, { maxDur: 0.26 });
      const p = worldPos(st.gx, st.gz);
      footPuffs(p.x, p.z, st.tx - st.fx, st.tz - st.fz, 0.7);
      if (st.gx === goal[0] && st.gz === goal[1]) return mode === 'race' ? raceEnd(null) : win();
      const next = queued || heldDir; queued = null;
      if (next) tryMove(next[0], next[1]);
    }
  } else {
    x = st.gx; z = st.gz;
    sq = 1 + Math.sin(time * 3) * 0.015;
  }
  // walk cycle: one full stride every two tiles; eases out when the character stops
  // intro wave: faces the camera and waves while the camera comes down, then turns back to the maze
  walkU.uWave.value += ((intro.wave ? 1 : 0) - walkU.uWave.value) * Math.min(1, dt * 5);
  walkU.uWaveT.value += dt * 9;
  const walking = st.moving || (heldDir && st.bumpT < 0);
  walkU.uAmp.value += ((walking ? 1 : 0) - walkU.uAmp.value) * Math.min(1, dt * 12);
  if (walkU.uAmp.value > 0.01) walkU.uPhase.value += dt * Math.PI / CFG.stepTime;
  else walkU.uPhase.value = 0;
  const amp = walkU.uAmp.value;
  body.rotation.z = -0.12 * amp;                                   // lean forward
  body.rotation.x = Math.sin(walkU.uPhase.value) * 0.07 * amp;     // waddle
  // bumping into a wall: lunge, squash on impact, bounce back with a hop and flailing arms, then a dizzy wobble
  walkU.uHurt.value = walkU.uHurtWig.value = 0;
  if (st.bumpT >= 0) {
    const HIT = 0.08, prev = st.bumpT;
    st.bumpT += dt;
    const t = st.bumpT, u = Math.max(0, t - HIT);
    if (prev < HIT && t >= HIT) {
      sfx.play('bump', 0.55);
      const p = player.position, sx = -st.bdz, sz = st.bdx; // sideways along the wall face
      const fx = p.x + st.bdx * 0.42, fz = p.z + st.bdz * 0.42;
      for (const side of [-1, 0, 1]) { // three puffs off the wall face, same dust as the rising stones
        const back = rand(0.3, 0.7);
        spawnPuff(fx + sx * side * 0.2, rand(0.3, 0.55), fz + sz * side * 0.2,
          sx * side * 0.9 - st.bdx * back, rand(0.4, 0.8), sz * side * 0.9 - st.bdz * back,
          rand(0.11, 0.14), STONE_DUST[Math.floor(Math.random() * STONE_DUST.length)], 0.5);
      }
    }
    const off = t < HIT ? 0.17 * Math.sin((t / HIT) * Math.PI / 2) : 0.17 * Math.exp(-u * 9) - 0.05 * Math.sin(u * 9) * Math.exp(-u * 5);
    x += st.bdx * off; z += st.bdz * off;
    const hurt = u > 0 ? Math.exp(-u * 4) : (t / HIT) * 0.2;
    walkU.uHurt.value = hurt;
    walkU.uHurtWig.value = Math.sin(u * 30) * hurt * 0.5;
    if (u > 0) {
      y += u < 0.3 ? Math.sin(Math.PI * u / 0.3) * 0.08 : 0;
      sq *= 1 - 0.2 * Math.exp(-u * 18) + (u < 0.3 ? Math.sin(Math.PI * u / 0.3) * 0.05 : 0);
      body.rotation.z += 0.3 * Math.exp(-u * 7);                      // lean back from the hit
      body.rotation.x += 0.22 * Math.sin(u * 28) * Math.exp(-u * 4);   // dizzy wobble
    }
    if (t > 0.75) st.bumpT = -1;
  }
  player.position.set(x - origin, y, z - origin);
  body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
  let d = st.facing - player.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  player.rotation.y += d * Math.min(1, dt * 18);
}

// ---------- rival Buddies (race) ----------
// They don't see the maze either: they head for the key but sometimes wander down a side path and come back,
// stop to think now and then, and walk a bit slower than you.
const RIVAL_SKINS = [2, 1, 4, 7, 3];
function planRoute(from, to) {
  const { N, g } = maze, prev = new Int32Array(N * N).fill(-1), q = [to[1] * N + to[0]];
  prev[q[0]] = q[0];
  for (let h = 0; h < q.length; h++) { // search from the goal so each cell knows its next step toward it
    const i = q[h], x = i % N, z = (i / N) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, j = nz * N + nx;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N || g[j] || prev[j] >= 0) continue;
      prev[j] = i; q.push(j);
    }
  }
  const route = [];
  let i = from[1] * N + from[0];
  const goalI = to[1] * N + to[0];
  while (i !== goalI && prev[i] >= 0) {
    const nextI = prev[i], x = i % N, z = (i / N) | 0;
    // a wrong turn now and then: follow a side corridor a few steps, then come back
    if (Math.random() < RIVAL_PACE[raceCfg.speed].detour) {
      const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => (z + dz) * N + x + dx)
        .filter(j => j !== nextI && j >= 0 && j < N * N && !g[j] && !route.includes(j) && Math.abs((j % N) - x) <= 1);
      if (side.length) {
        const trail = [];
        let c = side[Math.floor(Math.random() * side.length)], p = i;
        for (let d = 0; d < 2 + Math.floor(Math.random() * 4); d++) {
          trail.push(c);
          const cx = c % N, cz = (c / N) | 0;
          const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => (cz + dz) * N + cx + dx)
            .filter(j => j !== p && j >= 0 && j < N * N && !g[j] && Math.abs((j % N) - cx) <= 1);
          if (!n.length) break;
          p = c; c = n[0];
        }
        route.push(...trail, ...trail.slice(0, -1).reverse(), i);
      }
    }
    route.push(nextI);
    i = nextI;
  }
  return route.map(j => [j % maze.N, (j / maze.N) | 0]);
}
function makeRival(entry, skinIdx) {
  const U = newWalkU(), T = { uTint: { value: new THREE.Color(SKINS[skinIdx]) }, uTintOn: { value: 1 } };
  const inner = assets.char.clone(true);
  const box = new THREE.Box3().setFromObject(inner);
  const s = CFG.charH / (box.max.y - box.min.y);
  inner.scale.setScalar(s);
  inner.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
  inner.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.metalness = 0; o.castShadow = true; addWalk(o.material, { outfit: true, U, T }); } });
  const outline = inner.clone(true);
  const outMat = new THREE.MeshBasicMaterial({ color: '#161414', side: THREE.BackSide });
  addWalk(outMat, { outline: 0.016, U });
  outline.traverse(o => { if (o.isMesh) { o.material = outMat; o.castShadow = false; } });
  const body = new THREE.Group(); body.add(inner, outline);
  const root = new THREE.Group(); root.add(body);
  root.position.set(entry[0] - origin, 0, entry[1] - origin);
  scene.add(root);
  return { root, body, U, skinIdx, color: SKINS[skinIdx], route: planRoute(entry, goal), i: 0, x: entry[0], z: entry[1], fx: entry[0], fz: entry[1], t: 1,
    facing: -Math.PI / 4, wait: 0.4 + Math.random() * 0.8, stepTime: CFG.stepTime * RIVAL_PACE[raceCfg.speed].step * (0.95 + Math.random() * 0.15) };
}
function updateRivals(dt, time) {
  const racing = mode === 'race' && state === 'play' && !won && intro.t < 0;
  for (const r of rivals) {
    let hop = 0;
    if (racing) {
      if (r.wait > 0) r.wait -= dt;
      else if (r.t >= 1 && r.i < r.route.length) { // start the next step
        r.fx = r.x; r.fz = r.z;
        [r.x, r.z] = r.route[r.i++];
        r.facing = Math.atan2(-(r.z - r.fz), r.x - r.fx);
        r.t = 0;
      }
      if (r.t < 1) {
        r.t = Math.min(1, r.t + dt / r.stepTime);
        hop = Math.abs(Math.sin(r.U.uPhase.value)) * 0.05;
        if (r.t >= 1) {
          if (r.x === goal[0] && r.z === goal[1]) { raceEnd(r); return; }
          if (Math.random() < 0.08) r.wait = 0.3 + Math.random() * 0.6; // stops to think
        }
      }
    }
    const e = Math.min(1, r.t);
    r.root.position.set(r.fx + (r.x - r.fx) * e - origin, hop, r.fz + (r.z - r.fz) * e - origin);
    const walking = racing && r.t < 1;
    r.U.uAmp.value += ((walking ? 1 : 0) - r.U.uAmp.value) * Math.min(1, dt * 12);
    if (r.U.uAmp.value > 0.01) r.U.uPhase.value += dt * Math.PI / r.stepTime; else r.U.uPhase.value = 0;
    r.body.rotation.z = -0.12 * r.U.uAmp.value;
    r.body.rotation.x = Math.sin(r.U.uPhase.value) * 0.07 * r.U.uAmp.value;
    let d = r.facing - r.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    r.root.rotation.y += d * Math.min(1, dt * 14);
  }
}
const COLOR_NAMES = ['Green', 'Blue', 'Red', 'Orange', 'Pink', 'Purple', 'Yellow', 'Teal', 'White'];
function raceEnd(winner) {
  won = true;
  heldDir = queued = null;
  const p = key.position;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    spawnPuff(p.x, 0.3, p.z, Math.cos(a) * 1.6, rand(0.5, 1.4), Math.sin(a) * 1.6, rand(0.06, 0.1), i % 2 ? '#f2c14e' : '#ffffff', 0.6);
  }
  const ranking = raceRanking(winner), place = ranking.findIndex(e => e.who === null);
  const teamWin = raceTeam && winner && winner.team;
  if (place === 0 || teamWin) { raceWins++; try { localStorage.setItem('hidden-maze-race-wins', raceWins); } catch {} }
  $('raceTitle').textContent = place === 0 ? (raceTeam ? 'Your team wins!' : 'You win!') : teamWin ? 'Your team wins!' : 'So close!';
  $('raceStats').textContent = `${fmt(Math.round(elapsed))}`;
  $('raceBadge').textContent = place === 0 || teamWin ? '🏆' : ['🥈', '🥉'][place - 1] || '💨';
  $('raceRank').innerHTML = ranking.map((e, i) => `<li class="${!e.who || e.who.team ? 'me' : ''}"><b>${ORD[i]}</b><i style="background:${e.who ? e.who.color : SKINS[skin]}"></i>` +
    `${e.who ? (e.who.team ? 'Teammate' : COLOR_NAMES[e.who.skinIdx] + ' Buddy') : 'You'}</li>`).join('');
  setTimeout(() => show('raceEnd'), 700);
}
// name tags over rivals you can see, and an arrow at the screen edge pointing to the ones you can't
function setupRaceUI() {
  const box = $('raceUI');
  box.innerHTML = rivals.map((r, i) => `<span class="rtag ${r.team ? 'team' : ''}" id="rtag${i}" style="--c:${r.color}">${r.team ? '♥ Teammate' : COLOR_NAMES[r.skinIdx]}</span>` +
    `<svg class="rarrow" id="rarrow${i}" viewBox="0 0 40 40"><path d="M34 20 L10 6 Q6 4 6 9 L6 31 Q6 36 10 34 Z" fill="${r.color}" stroke="#ffffff" stroke-width="4" stroke-linejoin="round"/></svg>`).join('');
}
const ORD = ['1st', '2nd', '3rd', '4th'];
// ranking: whoever has the key is first, the rest by walking distance left to the key
function raceRanking(winner) {
  const N = maze.N;
  const list = [{ who: null, d: keyDist[st.gz * N + st.gx] }, ...rivals.map(r => ({ who: r, d: keyDist[r.z * N + r.x] }))];
  return list.sort((a, b) => (a.who === winner ? -1 : b.who === winner ? 1 : 0) || a.d - b.d);
}
const _rp = new THREE.Vector3();
function updateRaceUI() {
  const on = mode === 'race' && (state === 'play' || state === 'pause');
  $('raceUI').style.display = on ? '' : 'none';
  if (!on) return;
  const place = raceRanking(undefined).findIndex(e => e.who === null);
  ui.level.textContent = `${ORD[place]} / ${rivals.length + 1}`;
  const W = innerWidth, H = innerHeight, cx = W / 2, cy = H / 2;
  const top = 86, bottom = H - 150, left = 26, right = W - 26;
  rivals.forEach((r, i) => {
    _rp.copy(r.root.position); _rp.y += CFG.charH + 0.25;
    _rp.project(camera);
    let x = (_rp.x + 1) / 2 * W, y = (1 - _rp.y) / 2 * H;
    if (_rp.z > 1) { x = W - x; y = H - y; } // behind the camera: flip
    const tag = $('rtag' + i), arrow = $('rarrow' + i);
    const inside = x > left && x < right && y > top && y < bottom && _rp.z <= 1;
    tag.style.display = inside ? '' : 'none';
    arrow.style.display = inside ? 'none' : '';
    if (inside) { tag.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`; return; }
    const dx = x - cx, dy = y - cy;
    const k = Math.min(Math.abs((dx > 0 ? right - cx : cx - left) / (dx || 1e-6)), Math.abs((dy > 0 ? bottom - cy : cy - top) / (dy || 1e-6)));
    arrow.style.transform = `translate(${cx + dx * k}px, ${cy + dy * k}px) translate(-50%, -50%) rotate(${Math.atan2(dy, dx)}rad)`;
  });
}
function startRace() { raceSize = raceCfg.racers; raceTeam = raceCfg.mates > 0; buildLevel(-1, makeRaceMaze()); setupRaceUI(); show('play'); intro.t = 0; intro.warm = 3; intro.wave = false; lastCount = -1; }

function win() {
  won = true;
  heldDir = queued = null;
  const p = key.position;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    spawnPuff(p.x, 0.3, p.z, Math.cos(a) * 1.6, rand(0.5, 1.4), Math.sin(a) * 1.6, rand(0.06, 0.1), i % 2 ? '#f2c14e' : '#ffffff', 0.6);
  }
  const ratio = steps / optimal;
  const stars = ratio <= 1.15 ? 3 : ratio <= 1.6 ? 2 : 1;
  const wasLocked = L + 1 < TOTAL_LEVELS && !unlocked(L + 1);
  save.set(L, stars);
  const newWorld = wasLocked && (L + 1) % LEVELS_PER_WORLD === 0 ? WORLDS[(L + 1) / LEVELS_PER_WORLD] : null;
  $('winStats').textContent = `${steps} steps · ${fmt(Math.round(elapsed))} · best path ${optimal}`;
  $('unlockText').textContent = newWorld ? `New world! ${newWorld.icon} ${newWorld.name}` : '';
  $('unlockMsg').classList.toggle('on', !!newWorld);
  $('nextBtn').firstChild.textContent = L + 1 < TOTAL_LEVELS ? 'Next' : 'Map';
  const starEls = [...$('winStars').children];
  starEls.forEach(e => e.classList.remove('on'));
  setTimeout(() => {
    show('win');
    starEls.forEach((e, i) => setTimeout(() => i < stars && e.classList.add('on'), 350 + i * 260));
  }, 700);
}
const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

// ---------- menus ----------
function show(name) {
  state = name;
  document.body.dataset.state = name;
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('show', el.id === name);
  if (name === 'worlds') renderMap();
  if (name === 'title') {
    const n = nextLevel();
    $('playSub').textContent = `Level ${Math.floor(n / LEVELS_PER_WORLD) + 1}-${n % LEVELS_PER_WORLD + 1}`;
    $('starCount').textContent = Array.from({ length: TOTAL_LEVELS }, (_, k) => save.stars(k)).reduce((a, b) => a + b, 0);
    const wd = WORLDS[Math.floor(n / LEVELS_PER_WORLD)];
    $('worldName').textContent = $('worldNameCard').textContent = wd.name;
    $('contArt').innerHTML = `<span>${wd.icon}</span>`;
    $('contArt').style.setProperty('--wc', { woods: '#a6dc8f', desert: '#ffd58a', snow: '#bfe0fb', autumn: '#ffb98a' }[wd.biome]);
  }
  if (name === 'title' || name === 'outfit') $(name).querySelector('.faceSlot').appendChild($('faceCanvas'));
  if ((name === 'settings' && settingsBack === 'title') || name === 'race') $('title').classList.add('show'); // these panels sit over the title
  if (name === 'race') renderRaceSetup();
  if (name === 'pause') $('pauseInfo').textContent = mode === 'race' ? (raceTeam ? `Team race · ${raceCfg.mates + 1} vs ${raceSize - raceCfg.mates - 1}` : `Race · ${raceSize} Buddies`) : `${WORLDS[Math.floor(L / LEVELS_PER_WORLD)].name} · level ${L % LEVELS_PER_WORLD + 1}`;
  if (name !== 'play') heldDir = queued = null;
  sfx.setScene(name === 'play' || name === 'pause' || name === 'win' || name === 'raceEnd');
}
async function play(level) {
  const b = levelBiome(level);
  if (!stoneSets[b]) { $('busy').classList.add('on'); await stoneSet(b); $('busy').classList.remove('on'); } // first visit to a biome
  warp.t = -1; $('fader').style.opacity = 0;
  buildLevel(level); show('play'); intro.t = 0; intro.warm = 3; intro.wave = false;
}

// adventure map: zones stacked bottom (world 1) to top. A world with a painted map shows it once, scaled to the
// zone's height with the meadow in the middle, fading to white at the top and bottom. A dirt path winds through the
// meadow with a worn dirt patch for each level.
const starSvg = on => `<svg class="${on ? 'on' : ''}"><use href="#i-star"/></svg>`;
function renderMap() {
  const map = $('map');
  const W = map.clientWidth || innerWidth;
  const STEP = 100, PAD_B = 140, PAD_T = 80;
  const zoneH = PAD_B + (LEVELS_PER_WORLD - 1) * STEP + PAD_T;
  const H = zoneH * WORLDS.length + 110;
  const next = nextLevel();
  const pos = L => { // gentle winding that stays inside the meadow
    const w = Math.floor(L / LEVELS_PER_WORLD), k = L % LEVELS_PER_WORLD;
    return [W / 2 + Math.sin(L * 0.75 + 0.4) * Math.min(W * 0.16, 230), H - w * zoneH - PAD_B - k * STEP];
  };
  let html = '';
  WORLDS.forEach((w, i) => {
    const locked = !unlocked(i * LEVELS_PER_WORLD);
    let deco = '';
    for (let d = 0; d < (w.map ? 0 : 9); d++) {
      const r = mulberry32(i * 100 + d)();
      const left = d % 2 ? 72 + r * 22 : 2 + r * 18;
      deco += `<span class="deco" style="left:${left}%;top:${8 + d * 10 + r * 5}%;transform:rotate(${(r - 0.5) * 24}deg) scale(${0.8 + r * 0.6})">${w.deco[d % w.deco.length]}</span>`;
    }
    const art = w.map ? `<div class="mapimg" style="background-image:url(${w.map})"></div>` : '';
    html += `<div class="zone ${locked ? 'locked' : ''}" style="top:${H - (i + 1) * zoneH}px;height:${zoneH}px;background:${w.map ? 'var(--white)' : w.land}">${art}${deco}
      <div class="banner"><span class="pill">${w.icon} ${w.name}</span></div>
      ${locked ? `<div class="lockveil"><span class="pill">🔒 Finish ${WORLDS[i - 1].name}</span></div>` : ''}</div>`;
  });
  let d = '';
  for (let k = 0; k < TOTAL_LEVELS; k++) {
    const [x, y] = pos(k);
    if (!k) { d += `M${x} ${y + 70}L${x} ${y}`; continue; }
    const [px, py] = pos(k - 1);
    d += `C${px} ${py - STEP / 2} ${x} ${y + STEP / 2} ${x} ${y}`;
  }
  // dirt path: soft dark edge, earth, lighter worn middle, a few pebbles
  html += `<svg class="path" width="${W}" height="${H}"><defs><filter id="soft" x="-20%" y="-5%" width="140%" height="110%"><feGaussianBlur stdDeviation="3"/></filter></defs>
    <path d="${d}" fill="none" stroke="#3e6b2c" stroke-opacity=".22" stroke-width="44" stroke-linecap="round" filter="url(#soft)"/>
    <path d="${d}" fill="none" stroke="#e9e2c4" stroke-width="34" stroke-linecap="round" stroke-dasharray="26 8"/>
    <path d="${d}" fill="none" stroke="#f6f1dc" stroke-width="22" stroke-linecap="round" stroke-dasharray="20 14" stroke-opacity=".8"/></svg>`;
  for (let k = 0; k < TOTAL_LEVELS; k++) {
    const [x, y] = pos(k), s = save.stars(k), open = unlocked(k);
    html += `<button class="node ${!open ? 'locked' : k === next ? 'next' : ''}" data-level="${k}" style="left:${x}px;top:${y}px">
      <span class="dot" style="--r:${(k * 37) % 360}deg">${open ? `<b>${k % LEVELS_PER_WORLD + 1}</b>` : '<svg class="ico"><use href="#i-lock"/></svg>'}</span>
      ${open ? `<span class="stars">${starSvg(s > 0) + starSvg(s > 1) + starSvg(s > 2)}</span>` : ''}</button>`;
  }
  const [, ny] = pos(next);
  map.innerHTML = `<div class="inner" style="height:${H}px">${html}</div>`;
  const totalStars = Array.from({ length: TOTAL_LEVELS }, (_, k) => save.stars(k)).reduce((a, b) => a + b, 0);
  $('mapTitle').textContent = `★ ${totalStars} / ${TOTAL_LEVELS * 3}`;
  map.scrollTop = ny - map.clientHeight * 0.6;
}
$('map').addEventListener('click', e => {
  const b = e.target.closest('[data-level]'); if (!b) return;
  if (b.classList.contains('locked')) { b.animate([{ transform: 'translate(-50%,-50%)' }, { transform: 'translate(calc(-50% - 6px),-50%)' }, { transform: 'translate(calc(-50% + 6px),-50%)' }, { transform: 'translate(-50%,-50%)' }], { duration: 240 }); return; }
  play(+b.dataset.level);
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]'); if (!b) return;
  show(b.dataset.go);
});
$('playBtn').addEventListener('click', () => show('worlds')); // adventure opens the map
$('contBtn').addEventListener('click', e => { e.stopPropagation(); play(nextLevel()); });
$('contCard').addEventListener('click', () => play(nextLevel()));
// title menu: the hovered item is the selected one; arrow keys / W S move it, Enter or Space picks it
const menuItems = [...document.querySelectorAll('#sideMenu .mitem')];
const selectItem = el => menuItems.forEach(m => m.classList.toggle('sel', m === el));
menuItems.forEach(m => m.addEventListener('pointerenter', () => selectItem(m)));
addEventListener('keydown', e => {
  if (state !== 'title') return;
  const i = menuItems.findIndex(m => m.classList.contains('sel'));
  if (e.code === 'ArrowDown' || e.code === 'KeyS') { selectItem(menuItems[(i + 1) % menuItems.length]); e.preventDefault(); }
  else if (e.code === 'ArrowUp' || e.code === 'KeyW') { selectItem(menuItems[(i - 1 + menuItems.length) % menuItems.length]); e.preventDefault(); }
  else if (e.code === 'Enter' || e.code === 'Space') { menuItems[Math.max(0, i)].click(); e.preventDefault(); }
});
// sound settings, opened from the title (gear) or the pause menu
let settingsBack = 'title';
function openSettings(from) {
  settingsBack = from;
  const sync = el => el.style.setProperty('--v', el.value + '%');
  $('musicVol').value = Math.round(sfx.prefs.music * 100); sync($('musicVol'));
  $('fxVol').value = Math.round(sfx.prefs.fx * 100); sync($('fxVol'));
  $('muteBtn').classList.toggle('on', sfx.prefs.mute);
  show('settings');
}
for (const [id, key] of [['musicVol', 'music'], ['fxVol', 'fx']]) {
  $(id).addEventListener('input', e => { e.target.style.setProperty('--v', e.target.value + '%'); sfx.set(key, e.target.value / 100); });
}
$('fxVol').addEventListener('change', () => sfx.play('step', 0.62, 0, { maxDur: 0.26 })); // preview the effects level
$('muteBtn').addEventListener('click', () => { sfx.set('mute', !sfx.prefs.mute); $('muteBtn').classList.toggle('on', sfx.prefs.mute); });
$('settingsBtn').addEventListener('click', () => openSettings('title'));
$('pauseSoundBtn').addEventListener('click', () => openSettings('pause'));
$('settingsDone').addEventListener('click', () => show(settingsBack));
$('outfitBtn').addEventListener('click', () => show('outfit'));
$('raceBtn').addEventListener('click', () => show('race'));
// race setup screen: steppers for Buddies and teammates, a choice of rival speed, and a preview of the teams
function renderRaceSetup() {
  raceCfg.racers = Math.max(2, Math.min(4, raceCfg.racers));
  raceCfg.mates = Math.max(0, Math.min(raceCfg.racers - 2, raceCfg.mates));
  $('rcRacers').textContent = raceCfg.racers;
  $('rcMates').textContent = raceCfg.mates;
  document.querySelectorAll('#rcSpeed button').forEach((b, i) => b.classList.toggle('on', i === raceCfg.speed));
  const others = RIVAL_SKINS.filter(c => c !== skin);
  const dot = c => `<i style="--c:${SKINS[c]}"></i>`;
  const team = [skin, ...others.slice(raceCfg.racers - 1 - raceCfg.mates, raceCfg.racers - 1)];
  const rivalsC = others.slice(0, raceCfg.racers - 1 - raceCfg.mates);
  $('rcPreview').innerHTML = `<span class="side mine">${team.map(dot).join('')}<b>${raceCfg.mates ? 'Your team' : 'You'}</b></span><span class="vs">vs</span><span class="side">${rivalsC.map(dot).join('')}<b>Rivals</b></span>`;
  try { localStorage.setItem('hidden-maze-race', JSON.stringify(raceCfg)); } catch {}
}
$('race').addEventListener('click', e => {
  const b = e.target.closest('[data-rc]'); if (!b) return;
  const [key, d] = b.dataset.rc.split(':');
  if (key === 'speed') raceCfg.speed = +d; else raceCfg[key] += +d;
  renderRaceSetup();
});
$('raceGo').addEventListener('click', () => startRace());
$('raceAgain').addEventListener('click', () => startRace());
$('pauseBtn').addEventListener('click', () => show('pause'));
$('resumeBtn').addEventListener('click', () => show('play'));
$('restartBtn').addEventListener('click', () => mode === 'race' ? startRace() : play(L));
$('nextBtn').addEventListener('click', () => {
  if (L + 1 >= TOTAL_LEVELS) return show('worlds');
  play(L + 1);
});
// logo: letters bent along an arch in the hood color (set by setSkin), with an ink outline behind
{
  const el = $('logoA'), letters = [...el.textContent], mid = (letters.length - 1) / 2;
  el.textContent = letters.join(''); // the word bobs as one piece
}

// ---------- title: the character's face peeking up, looking at the cursor or tilting its head ----------
const face = (() => {
  const canvas = $('faceCanvas');
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const sc = new THREE.Scene();
  sc.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
  sc.environmentIntensity = 0.55;
  sc.add(new THREE.HemisphereLight('#ffffff', '#dbe9cc', 0.8));
  const keyL = new THREE.DirectionalLight('#fff1dc', 2.1); keyL.position.set(-2, 3, 4);
  const fill = new THREE.DirectionalLight('#eaf6dc', 0.6); fill.position.set(3, 1, 3);
  const rim = new THREE.DirectionalLight('#ffffff', 1.5); rim.position.set(2, 3, -3);
  sc.add(keyL, fill, rim);
  // blink: the eyes are painted in the texture, so dark eye pixels are swapped for skin, leaving a thin closed-eye line
  const B = { uBlink: { value: 0 }, uEyeY: { value: 0 }, uEyeHalf: { value: 0 }, uSkin: { value: new THREE.Color() }, uEyeOn: { value: 0 } };
  let blinkIn = 1.5, blinkT = -1, doubleBlink = false;
  const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
  const U = { uYaw: { value: 0 }, uPitch: { value: 0 }, uRoll: { value: 0 }, uIdle: { value: 0 } };
  const cur = { yaw: 0, pitch: 0, roll: 0 };
  let group, sway, mouse = null, lastMouse = -1e9, w = 0, h = 0;
  // head turn in the model's own space: pivot at the neck, everything above it rotates (model faces +X)
  const headGlsl = `
    float hw = smoothstep(0.02, 0.12, position.y);
    mat3 hr = mat3(cos(uYaw*hw),0.,-sin(uYaw*hw), 0.,1.,0., sin(uYaw*hw),0.,cos(uYaw*hw))
            * mat3(cos(uPitch*hw),sin(uPitch*hw),0., -sin(uPitch*hw),cos(uPitch*hw),0., 0.,0.,1.)
            * mat3(1.,0.,0., 0.,cos(uRoll*hw),sin(uRoll*hw), 0.,-sin(uRoll*hw),cos(uRoll*hw));`;
  function init(src) {
    const model = src.clone(true);
    model.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.metalness = 0;
      o.material.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, U, B);
        sh.vertexShader = 'uniform float uYaw, uPitch, uRoll, uIdle;\nvarying vec3 vObjPos;\nvec2 rot2(vec2 p, float a) { return vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a)); }\n' + sh.vertexShader
          .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + headGlsl + '\nobjectNormal = hr * objectNormal;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
          vObjPos = position;
          {
            // waiting idle: arms down from the A-pose, swinging gently forward and back, opposite to each other
            const float sho = 0.03;
            vec3 q = transformed;
            float side = sign(q.z);
            float wa = smoothstep(0.125, 0.16, abs(q.z)) * smoothstep(sho + 0.05, sho - 0.02, q.y) * step(-0.36, q.y);
            vec2 yz = rot2(vec2(q.y - sho, abs(q.z) - 0.14), (0.3 + 0.06 * sin(uIdle * 3.2 + side)) * wa);
            q.y = yz.x + sho; q.z = side * (yz.y + 0.14);
            float along = clamp((sho - q.y) / 0.36, 0.0, 1.0);
            q.xy = rot2(q.xy - vec2(0.0, sho), (0.32 * sin(uIdle * 3.2) * side + 0.12 * sin(uIdle * 6.4 - along * 2.0) * along) * wa) + vec2(0.0, sho);
            transformed = q;
          }
          transformed = hr * (transformed - vec3(0., 0.06, 0.)) + vec3(0., 0.06, 0.);`);
        addOutfit(sh, false);
        sh.fragmentShader = 'uniform float uBlink, uEyeY, uEyeHalf, uEyeOn;\nuniform vec3 uSkin;\nvarying vec3 vObjPos;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          {
            float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            float eye = (1.0 - smoothstep(0.03, 0.09, lum)) * step(0.04, vObjPos.x) * step(uEyeY - 0.12, vObjPos.y) * step(vObjPos.y, uEyeY + 0.12);
            float open = max(uEyeHalf * (1.0 - uBlink), 0.0045);
            float hide = step(open, abs(vObjPos.y - uEyeY)) * step(0.02, uBlink) * uEyeOn;
            diffuseColor.rgb = mix(diffuseColor.rgb, uSkin, eye * hide);
          }`);
      };
      o.material.customProgramCacheKey = () => 'head';
    });
    const box = new THREE.Box3().setFromObject(model);
    const s = 1 / (box.max.y - box.min.y);
    model.scale.setScalar(s);
    model.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
    group = new THREE.Group();
    group.add(model);
    sway = new THREE.Group(); // rocks side to side from the feet
    sway.add(group);
    sc.add(sway);
    // a soft round pedestal to stand on, with a little contact shadow under the feet
    const sh = document.createElement('canvas'); sh.width = sh.height = 128;
    const sx = sh.getContext('2d'), sg = sx.createRadialGradient(64, 64, 0, 64, 64, 64);
    sg.addColorStop(0, 'rgba(110,80,40,.35)'); sg.addColorStop(1, 'rgba(110,80,40,0)'); sx.fillStyle = sg; sx.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false }));
    shadow.position.y = 0.002;
    sc.add(shadow);
    findEyes(firstMesh(src));
  }
  // locate the painted eyes: sample the texture across front-of-head triangles, collect the dark spots
  function findEyes(mesh) {
    const map = mesh.material.map; if (!map) return;
    const img = map.image, c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const g = mesh.geometry, P = g.attributes.position, UV = g.attributes.uv, idx = g.index ? g.index.array : null;
    const ys = [], skin = [0, 0, 0]; let ns = 0;
    const tri = idx ? idx.length / 3 : P.count / 3;
    const W = [[1/3, 1/3], [0.7, 0.15], [0.15, 0.7], [0.15, 0.15], [0.45, 0.45], [0.45, 0.1], [0.1, 0.45]];
    for (let t = 0; t < tri; t++) {
      const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, cc = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const cy = (P.getY(a) + P.getY(b) + P.getY(cc)) / 3, cx = (P.getX(a) + P.getX(b) + P.getX(cc)) / 3;
      if (cx < 0.05 || cy < 0.1) continue;
      for (const [u, v] of W) {
        const w = 1 - u - v;
        const tu = UV.getX(a) * u + UV.getX(b) * v + UV.getX(cc) * w, tv = UV.getY(a) * u + UV.getY(b) * v + UV.getY(cc) * w;
        const ix = Math.min(c.width - 1, Math.max(0, Math.floor(tu * c.width))), iy = Math.min(c.height - 1, Math.max(0, Math.floor((map.flipY ? 1 - tv : tv) * c.height)));
        const o = (iy * c.width + ix) * 4, l = (px[o] * 0.2126 + px[o + 1] * 0.7152 + px[o + 2] * 0.0722) / 255;
        const y = P.getY(a) * u + P.getY(b) * v + P.getY(cc) * w;
        if (l < 0.12) ys.push(y);
        else if (l > 0.45 && px[o] > px[o + 2]) { skin[0] += px[o]; skin[1] += px[o + 1]; skin[2] += px[o + 2]; ns++; }
      }
    }
    if (ys.length < 4 || !ns) return;
    ys.sort((m, n) => m - n);
    const q = k => ys[Math.floor((ys.length - 1) * k)];
    B.uEyeY.value = q(0.5);
    B.uEyeHalf.value = Math.max(0.01, (q(0.95) - q(0.05)) / 2 + 0.004);
    B.uSkin.value.setRGB(skin[0] / ns / 255, skin[1] / ns / 255, skin[2] / ns / 255, THREE.SRGBColorSpace);
    B.uEyeOn.value = 1;
  }
  function updateBlink(dt) {
    if (blinkT < 0) {
      blinkIn -= dt;
      if (blinkIn <= 0) { blinkT = 0; doubleBlink = Math.random() < 0.2; }
      B.uBlink.value = 0;
      return;
    }
    blinkT += dt;
    const close = 0.07, open = 0.11;
    B.uBlink.value = blinkT < close ? blinkT / close : Math.max(0, 1 - (blinkT - close) / open);
    if (blinkT > close + open) {
      blinkT = -1;
      blinkIn = doubleBlink ? 0.12 : 2 + Math.random() * 3.5;
      doubleBlink = false;
    }
  }
  addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { mouse = { x: e.clientX, y: e.clientY }; lastMouse = performance.now(); } });
  document.addEventListener('pointerleave', () => { lastMouse = -1e9; });
  function render(dt, t) {
    if (!group) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (cw !== w || ch !== h) {
      w = cw; h = ch;
      r.setSize(w, h, false);
      cam.aspect = w / h;
      // the whole character on its pedestal, a little from above
      const fit = Math.max(0.95 / 0.2126, 0.62 / (0.2126 * cam.aspect));
      cam.position.set(0, 0.9, fit);
      cam.lookAt(0, 0.62, 0); // a bit low in the frame, leaving the top for the logo
      cam.updateProjectionMatrix();
    }
    let ty, tp, tr;
    if (mouse && performance.now() - lastMouse < 3000) {
      const rc = canvas.getBoundingClientRect();
      const hx = rc.left + rc.width / 2, hy = rc.top + rc.height * 0.4;
      const dx = THREE.MathUtils.clamp((mouse.x - hx) / (innerWidth * 0.5), -1, 1);
      const dy = THREE.MathUtils.clamp((mouse.y - hy) / (innerHeight * 0.5), -1, 1);
      ty = dx * 0.75; tp = -dy * 0.4; tr = -dx * 0.12;
    } else { // idle: slow look around with a cute head tilt
      ty = Math.sin(t * 0.45) * 0.38;
      tp = Math.sin(t * 0.8) * 0.06;
      tr = Math.sin(t * 0.6 + 1.3) * 0.15;
    }
    const k = Math.min(1, dt * 3);
    cur.yaw += (ty - cur.yaw) * k; cur.pitch += (tp - cur.pitch) * k; cur.roll += (tr - cur.roll) * k;
    U.uYaw.value = cur.yaw; U.uPitch.value = cur.pitch; U.uRoll.value = cur.roll;
    group.rotation.y = -Math.PI / 2 + cur.yaw * 0.2; // the model faces +X; turn it to face the camera
    // cute waiting sway: rock from foot to foot with a tiny bounce on each side
    U.uIdle.value = t;
    sway.rotation.z = Math.sin(t * 1.6) * 0.06;
    group.position.y = Math.abs(Math.sin(t * 1.6)) * 0.018;
    updateBlink(dt);
    r.render(sc, cam);
  }
  return { init, render, blink: B };
})();

// ---------- pillars per frame ----------
function updatePillars(dt, time) {
  const T = heights.length, { N } = maze;
  const k = 220, damp = Math.exp(-15 * dt);
  const aVar = floor.geometry.attributes.aVar;
  const nw = new Array(walls.length).fill(0), nc = new Array(caps.length).fill(0);
  let nf = 0;
  // how far from the view center flat stones are drawn in full 3D (more when zoomed out)
  const near = THREE.MathUtils.clamp((camera.userData.W ?? viewW) * 0.4 + 1.5, 3.5, 6), ncx = camTarget.x, ncz = camTarget.z;
  const empty = maze.empty;
  const stepGlow = curSet.variants[0].glowTex, under = st.gz * N + st.gx;
  for (let i = 0; i < T; i++) {
    if (empty && empty[i]) continue; // outside the shape: just the white floor
    if (stepGlow) tileGlow[i] = i === under ? Math.min(1, tileGlow[i] + dt * 5) : tileGlow[i] * Math.exp(-dt * 0.7); // lights up underfoot, dims quietly after
    vels[i] += (targets[i] - heights[i]) * k * dt;
    vels[i] *= damp;
    heights[i] += vels[i] * dt;
    if (heights[i] < 0) {
      if (targets[i] === 0 && vels[i] < -0.4) sfx.play('land', 0.6, panOf(i % N, (i / N) | 0)); // settles into the floor
      heights[i] = 0; vels[i] = 0;
    }
    // very subtle grinding tremble while a stone moves
    shake[i] = Math.max(0, shake[i] - dt * 2.5);
    const a = 0.006 * shake[i] + 0.003 * Math.min(1, Math.abs(vels[i]) / 3);
    const jx = nudge[i * 2] + a * Math.sin(time * 71 + i * 12.9), jz = nudge[i * 2 + 1] + a * Math.cos(time * 63 + i * 7.3);
    const x = i % N, z = (i / N) | 0;
    const door = doorMeshes.get(i);
    if (door) { door.position.set(x - origin + jx, heights[i], z - origin + jz); continue; } // door blocks move as one piece
    if (heights[i] > 0.003) {
      _m.makeRotationY(rotIdx[i] * Math.PI / 2 + twist[i]);
      _m.setPosition(x - origin + jx, heights[i], z - origin + jz);
      const v = varIdx[i], m = walls[v];
      m.setMatrixAt(nw[v], _m); m.setColorAt(nw[v], tint[i]); nw[v]++;
    } else if (Math.abs(x - origin - ncx) < near && Math.abs(z - origin - ncz) < near) {
      _m.makeRotationY(rotIdx[i] * Math.PI / 2 + twist[i]);
      _m.setPosition(x - origin + jx, 0, z - origin + jz);
      const v = varIdx[i], m = caps[v];
      m.setMatrixAt(nc[v], _m); m.setColorAt(nc[v], tint[i]);
      if (stepGlow) m.geometry.attributes.aGlow.array[nc[v]] = tileGlow[i];
      nc[v]++;
    } else {
      _m.makeRotationY(twist[i]);
      _m.setPosition(x - origin + jx, 0, z - origin + jz);
      floor.setMatrixAt(nf, _m); floor.setColorAt(nf, tint[i]); floorShadow.setMatrixAt(nf, _m);
      aVar.array[nf] = varIdx[i] * 4 + rotIdx[i];
      nf++;
    }
  }
  walls.forEach((m, v) => { m.count = nw[v]; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; });
  caps.forEach((m, v) => { m.count = nc[v]; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; m.geometry.attributes.aGlow.needsUpdate = true; });
  floor.count = nf; floorShadow.count = nf;
  floor.instanceMatrix.needsUpdate = floorShadow.instanceMatrix.needsUpdate = true;
  floor.instanceColor.needsUpdate = true;
  aVar.needsUpdate = true;
}

// ---------- camera ----------
const camTarget = new THREE.Vector3();
const CAM_DIR = new THREE.Vector3(1, Math.tan(THREE.MathUtils.degToRad(54)) * Math.SQRT2, 1).normalize();
const AHEAD = new THREE.Vector3(-0.9, 0, -0.9); // keep more maze visible above the character
// level intro: start close on the key, pull out to the whole maze, then glide down to the character.
// Every move eases in and out, and the zoom changes at an even rate (interpolated in log space).
const intro = { t: -1, warm: 0, wave: false };
const INTRO = [1.2, 3.4, 3.9, 6.4]; // key hold | out to wide | wide hold | down to the character
const skipIntro = () => {
  if (intro.t < 0) return;
  if (mode === 'race') { const end = RACE_HOLD + rivals.length * RACE_SEG; if (intro.t < end) intro.t = end; } // straight to the countdown
  else if (intro.t < INTRO[2]) intro.t = INTRO[2];
  intro.warm = 0;
};
const _ka = new THREE.Vector3(), _kb = new THREE.Vector3();
const ease = k => k * k * k * (k * (k * 6 - 15) + 10); // smootherstep
const zoomLerp = (a, b, k) => Math.exp(THREE.MathUtils.lerp(Math.log(a), Math.log(b), k));
function introShot(dt) {
  if (intro.warm > 0) { intro.warm--; dt = 0; } // let the first heavy frames of a new level pass before moving
  intro.t += Math.min(dt, 1 / 30);
  const t = intro.t, wideW = maze.N * 1.3;
  const keyP = _ka.set(key.position.x, 0, key.position.z), wide = _kb.set(0, 0, 0);
  const playerP = player.position.clone().setY(0).add(AHEAD);
  const u = (a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  let W;
  intro.wave = t >= INTRO[2] && t < INTRO[3];
  if (t < INTRO[0]) { camTarget.copy(keyP); W = 3.2; }
  else if (t < INTRO[1]) { const k = ease(u(INTRO[0], INTRO[1])); camTarget.copy(keyP).lerp(wide, k); W = zoomLerp(3.2, wideW, k); }
  else if (t < INTRO[2]) { camTarget.copy(wide); W = wideW; }
  else if (t < INTRO[3]) {
    const k = ease(u(INTRO[2], INTRO[3])); camTarget.copy(wide).lerp(playerP, k); W = zoomLerp(wideW, viewW, k);
    st.facing = -Math.PI / 4; // look at the camera while waving
  }
  else { intro.t = -1; intro.wave = false; camTarget.copy(playerP); W = viewW; st.facing = Math.PI * 0.75; } // turn back to the maze
  camera.userData.W = W;
}
// race intro: the key, then each rival, then you; then a 3, 2, 1, GO! countdown. Same every race.
const RACE_HOLD = 1.0, RACE_MOVE = 1.2, RACE_SEG = 1.9, COUNT = ['3', '2', '1', 'GO!'], COUNT_T = 0.8;
let lastCount = -1;
function raceShots() {
  return [new THREE.Vector3(key.position.x, 0, key.position.z), ...rivals.map(r => r.root.position.clone().setY(0)), player.position.clone().setY(0).add(AHEAD)];
}
function raceShot(dt) {
  if (intro.warm > 0) { intro.warm--; dt = 0; }
  intro.t += Math.min(dt, 1 / 30);
  const shots = raceShots(), t = intro.t, moveEnd = RACE_HOLD + (shots.length - 1) * RACE_SEG;
  let W = 3.4;
  intro.wave = false;
  if (t < RACE_HOLD) camTarget.copy(shots[0]);
  else if (t < moveEnd) {
    const k = Math.floor((t - RACE_HOLD) / RACE_SEG) + 1, local = (t - RACE_HOLD) - (k - 1) * RACE_SEG;
    const e = ease(Math.min(1, local / RACE_MOVE));
    camTarget.copy(shots[k - 1]).lerp(shots[k], e);
    W = 3.4 + Math.sin(Math.PI * e) * 2.2; // a little swoop out between subjects
    if (k === shots.length - 1) { intro.wave = true; st.facing = -Math.PI / 4; }
  } else {
    camTarget.copy(shots[shots.length - 1]);
    const c = Math.floor((t - moveEnd) / COUNT_T);
    if (c !== lastCount && c < COUNT.length) { lastCount = c; showCount(COUNT[c]); }
    if (c >= COUNT.length) { intro.t = -1; lastCount = -1; showCount(''); st.facing = Math.PI * 0.75; }
  }
  camera.userData.W = W;
}
function showCount(text) {
  const el = $('countdown');
  el.textContent = text;
  el.classList.remove('pop'); void el.offsetWidth; el.classList.toggle('pop', !!text);
  if (text) sfx.play(text === 'GO!' ? 'land' : 'step', text === 'GO!' ? 0.7 : 0.5);
}
function updateCamera(dt) {
  if (intro.t >= 0 && state === 'play' && mode === 'race') raceShot(dt);
  else if (intro.t >= 0 && state === 'play') introShot(dt);
  else if (intro.t < 0) {
    const want = player.position.clone().setY(0).add(AHEAD);
    camTarget.lerp(want, 1 - Math.exp(-6 * dt));
    const W = peek ? Math.max(viewW, maze.N * 1.25) : viewW;
    if (warp.t < 0) camera.userData.W = THREE.MathUtils.lerp(camera.userData.W ?? W, W, 1 - Math.exp(-8 * dt));
  }
  const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max((camera.userData.W / 2) / (half * Math.min(camera.aspect, 1)), 7);
  camera.position.copy(camTarget).addScaledVector(CAM_DIR, dist);
  camera.lookAt(camTarget);
  scene.fog.near = dist * 0.95; scene.fog.far = dist * 2.2;
  sun.position.copy(camTarget).add(SUN_OFFSET);
  sun.target.position.copy(camTarget);
}

// ---------- atmosphere: floating dust around the player ----------
const atmosphere = (() => {
  const group = new THREE.Group();
  scene.add(group);

  // dust motes: soft glowing specks drifting slowly around the player
  const MOTES = 220, R = 4.5;
  const pos = new Float32Array(MOTES * 3), vel = [];
  for (let i = 0; i < MOTES; i++) {
    pos.set([rand(-R, R), rand(0.05, 2.2), rand(-R, R)], i * 3);
    vel.push([rand(-0.06, 0.06), rand(0.02, 0.1), rand(-0.06, 0.06), rand(0, 6.28)]);
  }
  const mc = document.createElement('canvas'); mc.width = mc.height = 64;
  const mx = mc.getContext('2d'), mg = mx.createRadialGradient(32, 32, 0, 32, 32, 32);
  mg.addColorStop(0, 'rgba(255,250,225,1)'); mg.addColorStop(0.3, 'rgba(255,236,180,.6)'); mg.addColorStop(1, 'rgba(255,236,180,0)');
  mx.fillStyle = mg; mx.fillRect(0, 0, 64, 64);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const motes = new THREE.Points(geo, new THREE.PointsMaterial({
    map: new THREE.CanvasTexture(mc), size: 0.07, sizeAttenuation: true, color: '#fff2cc', transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  motes.frustumCulled = false;
  group.add(motes);

  function update(dt, t) {
    group.visible = state === 'play' || state === 'pause' || state === 'win';
    if (!group.visible) return;
    const cx = camTarget.x, cz = camTarget.z;
    for (let i = 0; i < MOTES; i++) {
      const v = vel[i], k3 = i * 3;
      pos[k3] += (v[0] + Math.sin(t * 0.7 + v[3]) * 0.05) * dt;
      pos[k3 + 1] += v[1] * dt;
      pos[k3 + 2] += (v[2] + Math.cos(t * 0.6 + v[3]) * 0.05) * dt;
      // wrap around the camera target so the dust always surrounds the player
      if (pos[k3] - cx > R) pos[k3] -= 2 * R; else if (pos[k3] - cx < -R) pos[k3] += 2 * R;
      if (pos[k3 + 2] - cz > R) pos[k3 + 2] -= 2 * R; else if (pos[k3 + 2] - cz < -R) pos[k3 + 2] += 2 * R;
      if (pos[k3 + 1] > 2.3) pos[k3 + 1] = 0.05;
    }
    geo.attributes.position.needsUpdate = true;
    motes.material.opacity = (dustDark ? 0.95 : 0.65) + 0.25 * Math.sin(t * 1.3);
  }
  let dustDark = false;
  // in the cave the dust becomes glowing fireflies
  function setDust(color, dark) { motes.material.color.set(color); motes.material.size = dark ? 0.1 : 0.07; dustDark = dark; geo.setDrawRange(0, dark ? 80 : MOTES); }

  // weather: things slowly coming down from above, one kind per biome
  const sprite = draw => { const c = document.createElement('canvas'); c.width = c.height = 64; draw(c.getContext('2d')); return new THREE.CanvasTexture(c); };
  const soft = sprite(x => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 30); g.addColorStop(0, '#fff'); g.addColorStop(0.45, 'rgba(255,255,255,.85)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
  const leaf = sprite(x => { x.translate(32, 32); x.rotate(0.6); x.fillStyle = '#fff'; x.beginPath(); x.moveTo(0, -26); x.quadraticCurveTo(20, -4, 0, 26); x.quadraticCurveTo(-20, -4, 0, -26); x.fill(); });
  const flake = sprite(x => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 30); g.addColorStop(0, '#fff'); g.addColorStop(0.45, '#f4f8ff'); g.addColorStop(0.7, 'rgba(150,172,205,.85)'); g.addColorStop(1, 'rgba(150,172,205,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); }); // a faint cool edge so it shows on white snow
  const grain = sprite(x => { x.fillStyle = '#fff'; x.beginPath(); x.arc(32, 32, 14, 0, 7); x.fill(); });
  // fall: speed down, sway: side to side, wind: steady sideways drift
  const WEATHER = {
    woods: { tex: soft, colors: ['#ffffff', '#fff8e6'], size: 0.4, n: 90, fall: 0.18, sway: 0.25, wind: 0.08, opacity: 0.8 }, // dandelion fluff
    desert: { tex: grain, colors: ['#e8cfa0', '#d9b77f', '#f3e2c2'], size: 0.16, n: 260, fall: 0.12, sway: 0.1, wind: 1.1, opacity: 0.75 }, // blowing sand
    snow: { tex: flake, colors: ['#ffffff', '#f2f7ff'], size: 0.75, n: 320, fall: 0.38, sway: 0.22, wind: 0.06, opacity: 0.95 },
    autumn: { tex: leaf, colors: ['#e07a2e', '#f2a93b', '#c9542a', '#e9c24a'], size: 0.8, n: 35, fall: 0.16, sway: 0.35, wind: 0.15, opacity: 1 },
    cave: { tex: soft, colors: ['#7ff6e6', '#5fd8ff', '#c9a2ff', '#ff9ad8'], size: 0.4, n: 45, fall: 0.1, sway: 0.15, wind: 0, opacity: 0.9, glow: true }, // drifting spores
  };
  const WN = 320, WR = 6, TOP = 5;
  const wpos = new Float32Array(WN * 3), wcol = new Float32Array(WN * 3), wvar = [];
  for (let i = 0; i < WN; i++) { wpos.set([rand(-WR, WR), rand(0, TOP), rand(-WR, WR)], i * 3); wvar.push([rand(0.7, 1.3), rand(0, 6.28), rand(0.6, 1.4)]); }
  const wgeo = new THREE.BufferGeometry();
  wgeo.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
  wgeo.setAttribute('color', new THREE.BufferAttribute(wcol, 3));
  const wmat = new THREE.PointsMaterial({ size: 0.1, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, fog: false, alphaTest: 0.02 });
  const flakes = new THREE.Points(wgeo, wmat);
  flakes.frustumCulled = false;
  group.add(flakes);
  let W = WEATHER.woods;
  function setWeather(name) {
    W = WEATHER[name] || WEATHER.woods;
    wmat.map = W.tex; wmat.size = W.size; wmat.opacity = W.opacity;
    wmat.blending = W.glow ? THREE.AdditiveBlending : THREE.NormalBlending;
    wmat.needsUpdate = true;
    const c = new THREE.Color();
    for (let i = 0; i < WN; i++) { c.set(W.colors[i % W.colors.length]); wcol.set([c.r, c.g, c.b], i * 3); }
    wgeo.attributes.color.needsUpdate = true;
    wgeo.setDrawRange(0, W.n);
  }
  const baseUpdate = update;
  function updateAll(dt, t) {
    baseUpdate(dt, t);
    if (!group.visible) return;
    const cx = camTarget.x, cz = camTarget.z;
    for (let i = 0; i < W.n; i++) {
      const v = wvar[i], k3 = i * 3;
      wpos[k3] += (W.wind * v[2] + Math.sin(t * 0.9 * v[0] + v[1]) * W.sway) * dt;
      wpos[k3 + 1] -= W.fall * v[0] * dt;
      wpos[k3 + 2] += (W.wind * 0.35 * v[2] + Math.cos(t * 0.7 * v[0] + v[1]) * W.sway * 0.6) * dt;
      if (wpos[k3] - cx > WR) wpos[k3] -= 2 * WR; else if (wpos[k3] - cx < -WR) wpos[k3] += 2 * WR;
      if (wpos[k3 + 2] - cz > WR) wpos[k3 + 2] -= 2 * WR; else if (wpos[k3 + 2] - cz < -WR) wpos[k3 + 2] += 2 * WR;
      if (wpos[k3 + 1] < 0) wpos[k3 + 1] += TOP;
    }
    wgeo.attributes.position.needsUpdate = true;
  }
  return { update: updateAll, setDust, setWeather, flakes };
})();

// ---------- input ----------
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function screenToGrid(sx, sy) {
  const base = player.position.clone().project(camera);
  let best = null, bestDot = -2;
  const len = Math.hypot(sx, sy);
  for (const d of DIRS) {
    const p = player.position.clone().add(new THREE.Vector3(d[0], 0, d[1])).project(camera);
    let vx = (p.x - base.x) * innerWidth, vy = -(p.y - base.y) * innerHeight;
    const l = Math.hypot(vx, vy);
    const dot = (vx / l) * (sx / len) + (vy / l) * (sy / len);
    if (dot > bestDot) { bestDot = dot; best = d; }
  }
  return best;
}
const pointers = new Map();
let anchor = null, pinch0 = 0, viewW0 = viewW;
const cv = renderer.domElement;
cv.addEventListener('pointerdown', e => {
  if (intro.t >= 0) skipIntro();
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) anchor = { x: e.clientX, y: e.clientY };
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); viewW0 = viewW; anchor = null; heldDir = null; }
});
cv.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    viewW = THREE.MathUtils.clamp(viewW0 * pinch0 / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), 2.5, 30);
    return;
  }
  if (!anchor) return;
  const dx = e.clientX - anchor.x, dy = e.clientY - anchor.y;
  if (Math.hypot(dx, dy) > 22) {
    const d = screenToGrid(dx, dy);
    if (!heldDir || d[0] !== heldDir[0] || d[1] !== heldDir[1]) { heldDir = d; tryMove(d[0], d[1]); }
    anchor = { x: e.clientX, y: e.clientY };
  }
});
const endPointer = e => { pointers.delete(e.pointerId); if (pointers.size === 0) { heldDir = null; anchor = null; } };
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('wheel', e => { viewW = THREE.MathUtils.clamp(viewW * Math.exp(e.deltaY * 0.001), 2.5, 30); }, { passive: true });

// keys follow the screen: the camera looks down a diagonal, so each key takes the neighbouring tile that sits
// in its direction on screen (up = the tile up-left, right = up-right, down = down-right, left = down-left)
const KEYS = { ArrowUp: [-1, 0], KeyW: [-1, 0], ArrowRight: [0, -1], KeyD: [0, -1], ArrowDown: [1, 0], KeyS: [1, 0], ArrowLeft: [0, 1], KeyA: [0, 1] };
addEventListener('keydown', e => {
  if (e.code === 'Escape' && (state === 'play' || state === 'pause')) return show(state === 'play' ? 'pause' : 'play');
  const d = KEYS[e.code]; if (!d || state !== 'play') return;
  e.preventDefault();
  if (e.repeat) return;
  heldDir = d; tryMove(d[0], d[1]);
});
addEventListener('keyup', e => { const d = KEYS[e.code]; if (d && heldDir === d) heldDir = null; });

// camera distance button: close -> medium -> wide (wide is still much closer than the full zoom-out)
const CAM_STEPS = [4.4, 6.2, 8.6]; // the view's height in tiles (the screen is wide)
let camStep = 0;
try { camStep = Math.min(2, +localStorage.getItem('hidden-maze-cam') || 0); } catch {}
viewW = params.has('zoom') ? viewW : CAM_STEPS[camStep];
$('camZoomLbl').textContent = camStep + 1;
$('camZoom').addEventListener('click', () => {
  camStep = (camStep + 1) % CAM_STEPS.length;
  viewW = CAM_STEPS[camStep];
  $('camZoomLbl').textContent = camStep + 1;
  try { localStorage.setItem('hidden-maze-cam', camStep); } catch {}
});
const peekBtn = $('peek');
const setPeek = v => e => { e.preventDefault(); peek = v; };
peekBtn.addEventListener('pointerdown', setPeek(true));
peekBtn.addEventListener('pointerup', setPeek(false));
peekBtn.addEventListener('pointerleave', setPeek(false));

let fitW = 0, fitH = 0;
function fitView() {
  const w = innerWidth, h = innerHeight;
  if (w === fitW && h === fitH) return;
  fitW = w; fitH = h;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  tiltH.uniforms.h.value = 4.2 / w; tiltV.uniforms.v.value = 4.2 / h; // shallow focus: only the band around Buddy is sharp
  const pr = renderer.getPixelRatio() * 0.5;
  mirror.getRenderTarget().setSize(Math.round(w * pr), Math.round(h * pr));
}

// ---------- loop ----------
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20), time = clock.elapsedTime;
  fitView();
  updatePlayer(dt, time);
  updateRivals(dt, time);
  updateWarp(dt);
  updatePillars(dt, time);
  updatePuffs(dt);
  atmosphere.update(dt, time);
  SUNU.uSunView.value.copy(SUN_OFFSET).normalize().transformDirection(camera.matrixWorldInverse);
  key.userData.spin.rotation.y += dt * 1.8;
  key.position.y = 0.55 + Math.sin(time * 2.2) * 0.06 + (won ? Math.min(1.5, (key.userData.wt = (key.userData.wt || 0) + dt) * 2) : 0);
  if (state === 'play' && !won && intro.t < 0) { elapsed += dt; ui.time.textContent = fmt(Math.floor(elapsed)); }
  updateCamera(dt);
  updateRaceUI();
  if (state === 'title' || state === 'outfit' || state === 'race' || (state === 'settings' && settingsBack === 'title')) face.render(dt, time); // menus are opaque; skip the maze behind them
  else if (state === 'worlds') {} // the map is opaque too
  else {
    renderer.shadowMap.needsUpdate = true;
    composer.render();
  }
  requestAnimationFrame(frame);
}

await load();
setupPlayer();
face.init(assets.char);
loadScenery(); // in the background; pieces appear as they arrive
setSkin(skin);
await stoneSet(levelBiome(nextLevel()));
buildLevel(nextLevel());
show('title');
$('loading').remove();
frame();
window.__game = { st, stoneSet, async cave(L) { await stoneSet(levelBiome(L)); await stoneSet("cave"); buildLevel(L, null, { stage: "cave" }); show("play"); intro.t = -1; }, get atmosphere() { return atmosphere; }, scene, get maze() { return maze; }, tryMove, renderer, face, sfx, play, get assets() { return assets; } };
