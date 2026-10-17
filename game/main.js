import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createMap3D } from './map3d.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MeshoptSimplifier } from 'https://cdn.jsdelivr.net/npm/meshoptimizer@0.22.0/meshopt_simplifier.module.js';
await MeshoptSimplifier.ready;
// the models ship meshopt-compressed (quantized, a fraction of the download); the game reshapes geometry in place, so
// every attribute is widened back to plain floats on load
function floatify(g) {
  for (const k in g.attributes) {
    const a = g.attributes[k]; if (a.array instanceof Float32Array && !a.normalized && !a.isInterleavedBufferAttribute) continue;
    const n = a.itemSize, f = new Float32Array(a.count * n), get = [a.getX, a.getY, a.getZ, a.getW];
    for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) f[i * n + c] = get[c].call(a, i);
    g.setAttribute(k, new THREE.BufferAttribute(f, n));
  }
}
class GLB extends GLTFLoader {
  constructor() { super(); this.setMeshoptDecoder(MeshoptDecoder); }
  loadAsync(url) { return super.loadAsync(url).then(g => { g.scene.traverse(o => { if (o.isMesh) floatify(o.geometry); }); return g; }); }
}
// the stone models come at ~95k triangles: far too many for a phone. Keep ~12k (texture seams are kept intact).
MeshoptSimplifier.useExperimentalFeatures = true; // (for simplifyWithAttributes)
function simplifyGeo(geo, ratio = 0.15, err = 0.02) {
  const P = geo.attributes.position, pos = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) { pos[i * 3] = P.getX(i); pos[i * 3 + 1] = P.getY(i); pos[i * 3 + 2] = P.getZ(i); }
  // the normals count as error too: a collapse that turns a face away from its neighbours showed as a dark hole
  const Nm = geo.attributes.normal, nrm = new Float32Array(P.count * 3);
  if (Nm) for (let i = 0; i < P.count; i++) { nrm[i * 3] = Nm.getX(i); nrm[i * 3 + 1] = Nm.getY(i); nrm[i * 3 + 2] = Nm.getZ(i); }
  const idx = new Uint32Array(geo.index.array), want = Math.floor(idx.length * ratio / 3) * 3;
  const run = (ix, flags, w) => w ? MeshoptSimplifier.simplifyWithAttributes(ix, pos, 3, nrm, 3, [w, w, w], null, want, err, flags)[0] : MeshoptSimplifier.simplify(ix, pos, 3, want, err, flags)[0];
  // texture seams are open edges in the index: locking them keeps the surface closed (otherwise holes appear)
  let out = run(idx, ['LockBorder'], Nm ? 0.6 : 0);
  // a scan cut into many texture islands is nearly all "border", so locking it can leave it at full size (one snow
  // stone stayed at 35k): then the seams may move too (the simplifier keeps both sides of a seam together)
  if (out.length > want * 1.5) out = run(out, [], 0);
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
  { name: 'Mossy Woods', biome: 'woods', icon: 'i-w-woods', color: '#6cc15a', card: '#cfe9b8', tint: [1, 1, 1], reveal: 2.3 },
  { name: 'Sunny Dunes', biome: 'desert', icon: 'i-w-desert', color: '#f2a53a', card: '#f8dfae', tint: [1.07, 0.96, 0.8], reveal: 2.1 },
  { name: 'Frost Peak', biome: 'snow', icon: 'i-w-snow', color: '#58b4e8', card: '#d3e9fa', tint: [0.9, 0.97, 1.08], reveal: 1.9 },
  { name: 'Autumn Grove', biome: 'autumn', icon: 'i-w-autumn', color: '#e8823a', card: '#f8d4b4', tint: [1, 1, 1], reveal: 1.7 },
];
const PILLARS = ['pillar.glb', 'pillar3.glb', /* pillar4 has dark stains painted on its top */ 'pillar5.glb', 'pillar6.glb', 'pillar7.glb', 'pillar8.glb'];
// Biomes: each has its own stones, its own door block (a stone with a cave mouth and a tree on top) and its own
// light and color grade. The cave is the underground level the doors lead to: dark, lit by glowing moss.
const nb = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => `assets/biomes/n${String(a + k).padStart(2, '0')}.glb`);
const BIOMES = {
  woods: { puffs: ['#9d9a92', '#b3afa6', '#8c897f', '#c4c0b6'], stones: PILLARS.map(f => 'assets/' + f), door: 'assets/biomes/n04.glb', bg: '#f5f1ea', floor: '#f4efe7', mirror: 0xd8d0c4,
    hemi: ['#fff3e2', '#d9bf9c', 0.75], fill: ['#ffc792', 1.25], sun: ['#ffdcae', 2.9], glow: { hue: 0.25, width: 0.11, amt: 1 }, dust: '#fff2cc' },
  desert: { tint: 0.12, contrast: 0.9, matchStrength: 0.45, doorTint: 0.15, moss: { hue: 0.3, width: 0.14, sat: 0.14 }, // keep the sandstone's colored layers; only even out brightness; cactus stays green
    puffs: ['#e3c79a', '#d4b07c', '#efd9b4', '#c99e6a'], stones: nb(18, 23), door: 'assets/biomes/n29.glb' /* cactus doorway */, bg: '#f7efe3', floor: '#f6ecdc', mirror: 0xe0d2bd,
    hemi: ['#fff4e0', '#e6c79c', 0.8], fill: ['#ffc58a', 1.2], sun: ['#ffd59a', 3.0], glow: { hue: 0.25, width: 0.11, amt: 0.8 }, dust: '#fff0d0' },
  snow: { rockGain: 1.15, contrast: 0.5, tint: 0.9, puffs: ['#ffffff', '#eef4fb', '#dde8f4', '#f7fbff'], stones: nb(12, 17), door: 'assets/biomes/n02.glb', bg: '#eef3f8', floor: '#f2f6fb', mirror: 0xd2dce8,
    hemi: ['#f4f8ff', '#c9d6e6', 0.85], fill: ['#cfe3ff', 1.0], sun: ['#fff6ea', 2.6], glow: { hue: 0.25, width: 0.11, amt: 0.6 }, dust: '#ffffff' },
  autumn: { rockColor: [204, 186, 154], contrast: 0.45, puffs: ['#c98a4e', '#e0a35f', '#b0784a', '#d9b48c'], stones: nb(5, 11).filter(f => !f.endsWith('n08.glb')) /* n08 has a face and is crooked */, door: 'assets/biomes/n03.glb', bg: '#f6eee4', floor: '#f5ece0', mirror: 0xddc9b3,
    hemi: ['#fff1de', '#d9b48c', 0.75], fill: ['#ffb978', 1.3], sun: ['#ffcf95', 2.8], glow: { hue: 0.07, width: 0.08, amt: 0.7, sat: 0.5 }, moss: { hue: 0.07, width: 0.08, sat: 0.55 }, dust: '#ffd9a0' },
  cave: { puffs: ['#5fd8ff', '#4a8dff', '#7fe8ff', '#3b6fd8'], stones: nb(24, 28), door: 'assets/biomes/n01.glb', bg: '#0f1a2a', floor: '#132236', mirror: 0x1a2c44, dark: true,
    rockGain: 1.65, tint: 0.85, stepGlow: true, moss: { hue: 0.44, width: 0.07, sat: 0.3 },
    glowHues: [0.36, 0.45, 0.3, 0.41, 0.33], // fluorescent greens to teal, one per stone (no purple or blue)
    doorPlant: true,
    hemi: ['#6a8ed0', '#1c2a48', 1.1], fill: ['#58d0ff', 0.8], sun: ['#9cc4ff', 1.0], glow: { hue: 0.65, width: 0.5, amt: 0, sat: 0.45, cave: true }, dust: '#7df3ff' },
};
const TOTAL_LEVELS = WORLDS.length * LEVELS_PER_WORLD;
const save = (() => {
  let data = { stars: {} };
  try { data = JSON.parse(localStorage.getItem('hidden-maze') || '') || data; } catch {}
  data.stars ||= {};
  return {
    stars: L => data.stars[L] || 0,
    set(L, n) { data.stars[L] = Math.max(n, data.stars[L] || 0); try { localStorage.setItem('hidden-maze', JSON.stringify(data)); } catch {} },
  };
})();
const BETA_ALL_OPEN = ['localhost', '127.0.0.1', ''].includes(location.hostname); // every level is open only when you run it locally (editing); online, levels unlock in order
const unlocked = L => BETA_ALL_OPEN || L === 0 || save.stars(L - 1) > 0;
const nextLevel = () => { for (let L = 0; L < TOTAL_LEVELS; L++) if (!save.stars(L)) return L; return TOTAL_LEVELS - 1; };
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Crash black box: what the game is doing is saved every second. If the page dies without saying goodbye (iOS closes
// pages that run out of memory), the next visit shows it on a card that can be screenshotted and sent
const BB_KEY = 'buddy-blackbox', bb = { errs: [], lost: 0, start: Date.now() };
let bbPrev = null;
try { bbPrev = JSON.parse(localStorage.getItem(BB_KEY) || 'null'); } catch {}
addEventListener('error', e => { bb.errs.push(String(e.message || e).slice(0, 160)); });
addEventListener('unhandledrejection', e => { bb.errs.push('promise: ' + String(e.reason && (e.reason.message || e.reason)).slice(0, 160)); });
addEventListener('pagehide', () => { if (bb.lostAt && Date.now() - bb.lostAt < 30000) return; try { const d = JSON.parse(localStorage.getItem(BB_KEY) || '{}'); d.clean = 1; localStorage.setItem(BB_KEY, JSON.stringify(d)); } catch {} });
// count every byte the game asks the graphics chip for (textures, render buffers, vertex data), so memory
// problems can be measured instead of guessed; window.__gpu() returns the totals in MB
{ // (always on: it only adds a little bookkeeping to allocation calls)
  const P = WebGL2RenderingContext.prototype, sizes = new Map(), bound = new Map(), kind = {};
  const bpp = f => ({ 0x8058: 4, 0x881A: 8, 0x8814: 16, 0x8C43: 4, 0x81A5: 2, 0x81A6: 3, 0x88F0: 4, 0x8CAC: 4, 0x8229: 1, 0x822B: 2, 0x8D48: 1, 0x1908: 4, 0x1907: 3 }[f] || 4);
  const set = (o, k, b, d = '') => { const old = sizes.get(o); if (old) kind[old.k] -= old.b; sizes.set(o, { k, b, d }); kind[k] = (kind[k] || 0) + b; };
  const del = o => { const old = sizes.get(o); if (old) { kind[old.k] -= old.b; sizes.delete(o); } };
  const wrap = (n, f) => { const g = P[n]; P[n] = function (...a) { f.call(this, ...a); return g.apply(this, a); }; };
  wrap('bindTexture', function (t, tex) { bound.set(this, Object.assign(bound.get(this) || {}, { ['t' + t]: tex })); });
  wrap('bindBuffer', function (t, b) { bound.set(this, Object.assign(bound.get(this) || {}, { ['b' + t]: b })); });
  wrap('bindRenderbuffer', function (t, r) { bound.set(this, Object.assign(bound.get(this) || {}, { r })); });
  wrap('texStorage2D', function (t, lv, f, w, h) { let b = 0; for (let i = 0; i < lv; i++) b += Math.max(1, w >> i) * Math.max(1, h >> i) * bpp(f); set((bound.get(this) || {})['t' + t], 'textures', b, w + 'x' + h + ' f' + f.toString(16) + ' L' + lv); });
  wrap('texImage2D', function (t, lv, f, w, h) { if (lv === 0 && typeof w === 'number' && typeof h === 'number') set((bound.get(this) || {})['t' + t] || (bound.get(this) || {})['t3553'], 'textures', w * h * 4 * 1.33); else if (lv === 0 && w && w.width) set((bound.get(this) || {})['t' + t], 'textures', w.width * w.height * 4 * 1.33); });
  wrap('renderbufferStorageMultisample', function (t, n, f, w, h) { set((bound.get(this) || {}).r, 'renderbuffers', w * h * bpp(f) * Math.max(1, n), w + 'x' + h + ' x' + n); });
  wrap('renderbufferStorage', function (t, f, w, h) { set((bound.get(this) || {}).r, 'renderbuffers', w * h * 4); });
  wrap('bufferData', function (t, d) { set((bound.get(this) || {})['b' + t], 'buffers', typeof d === 'number' ? d : d ? d.byteLength : 0); });
  wrap('deleteTexture', function (o) { del(o); }); wrap('deleteBuffer', function (o) { del(o); }); wrap('deleteRenderbuffer', function (o) { del(o); });
  window.__gpuTop = (n = 25) => [...sizes.values()].sort((a, b) => b.b - a.b).slice(0, n).map(e => e.k[0] + ' ' + e.d + ' ' + (e.b / 1e6).toFixed(1) + 'MB');
  window.__gpu = () => Object.fromEntries(Object.entries(kind).map(([k, v]) => [k, Math.round(v / 1e6)]).concat([['canvases', Math.round([...document.querySelectorAll('canvas')].reduce((m, c) => m + c.width * c.height * 4 * 2, 0) / 1e6)]]));
}
// ---------- renderer / scene ----------
// phones get a lighter setup: smaller shadows and no composer (the composer does its own antialiasing)
const PHONE = matchMedia('(pointer: coarse)').matches;
// (1.5 on Retina laptops too: 2x is ~1.8 times the pixels through MSAA, tilt-shift and the reflection, which kept the
// GPU flat out and the fans on, for a difference the soft tilt-shift look hides)
const PR_MAX = Math.min(devicePixelRatio, PHONE ? 1.25 : 1.5); // (phones: fixed, see adaptRes)
if (PHONE) document.documentElement.classList.add('phone');
// (phones draw straight to the screen, so they use the canvas's own antialiasing and skip the composer's big buffers)
const renderer = new THREE.WebGLRenderer({ antialias: PHONE, powerPreference: 'high-performance' });
renderer.setPixelRatio(PR_MAX);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // updated once per frame, not again for the reflection
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;
renderer.domElement.id = 'game';
// if the phone's graphics chip resets, keep the page alive and reload it once the context is back (your progress is saved)
// When a phone's graphics chip stalls, the browser resets it ("context lost"). The page used to reload here, which
// threw you back to the menu; now three.js restores the context in place (it re-uploads every texture and mesh by
// itself) and only what lived purely on the GPU is made again: the light environment and the baked floor atlases.
renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); bb.lost++; bb.lostAt = Date.now(); bb.save && bb.save(); }, false);
renderer.domElement.addEventListener('webglcontextrestored', () => {
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  for (const set of Object.values(stoneSets)) if (set && set.floorMat) { new Set(set.floorMat.map(m => m.map)).forEach(t => t.userData.rt && t.userData.rt.dispose()); set.floorMat = null; }
  if (floor && curSet) floor.material = floorMatOf(curSet);
  stillDrawn = false;
}, false);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = BG;
scene.fog = new THREE.Fog(BG, 30, 60);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 200);
// miniature look: tilt-shift blur above and below a sharp band around Buddy
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: PHONE ? 2 : 4 }));
composer.addPass(new RenderPass(scene, camera));
// tilt-shift with a sharp band (not a single sharp line) centered on Buddy's height on screen each frame, so he is never
// in the blur; the blur grows gently above and below the band. Two passes: across, then down.
const tiltShader = dir => ({
  uniforms: { tDiffuse: { value: null }, amt: { value: 0.004 }, r: { value: 0.45 }, band: { value: 0.16 }, grade: { value: new THREE.Vector4(1, 1, 1, 0) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amt, r, band; uniform vec4 grade; varying vec2 vUv;
    // (phones: the warm color grade and vignette are done here, rgb = tint, a = vignette strength)
    vec4 graded(vec4 c) { if (grade.a <= 0.0) return c; c.rgb *= grade.rgb; float v = smoothstep(0.45, 1.0, length((vUv - vec2(0.5, 0.42)) * vec2(1.1, 1.0)) * 1.25); c.rgb *= 1.0 - v * grade.a; return c; }
    void main() {
      float d = smoothstep(0.0, 0.55, max(0.0, abs(vUv.y - r) - band));
      if (d <= 0.0) { gl_FragColor = graded(texture2D(tDiffuse, vUv)); return; } // the sharp band: one read
      vec2 o = ${dir} * amt * d;
      ${PHONE ? `vec4 s = texture2D(tDiffuse, vUv) * 0.227;
      s += (texture2D(tDiffuse, vUv - o * 1.385) + texture2D(tDiffuse, vUv + o * 1.385)) * 0.3162;
      s += (texture2D(tDiffuse, vUv - o * 3.231) + texture2D(tDiffuse, vUv + o * 3.231)) * 0.0703;` : `vec4 s = texture2D(tDiffuse, vUv) * 0.1633;
      s += (texture2D(tDiffuse, vUv - o * 1.0) + texture2D(tDiffuse, vUv + o * 1.0)) * 0.1531;
      s += (texture2D(tDiffuse, vUv - o * 2.0) + texture2D(tDiffuse, vUv + o * 2.0)) * 0.12245;
      s += (texture2D(tDiffuse, vUv - o * 3.0) + texture2D(tDiffuse, vUv + o * 3.0)) * 0.0918;
      s += (texture2D(tDiffuse, vUv - o * 4.0) + texture2D(tDiffuse, vUv + o * 4.0)) * 0.051;`}
      gl_FragColor = graded(s);
    }`,
});
const tiltH = new ShaderPass(tiltShader('vec2(1.0, 0.0)')), tiltV = new ShaderPass(tiltShader('vec2(0.0, 1.0)'));
composer.addPass(tiltH); composer.addPass(tiltV);
const _focus = new THREE.Vector3();
function updateFocus() { // the sharp band sits on Buddy (or, during the level intro, on what the camera looks at)
  _focus.copy(intro.t >= 0 ? camTarget : player.position).setY(0.4).project(camera);
  const y = THREE.MathUtils.clamp((_focus.y + 1) / 2, 0.15, 0.85);
  tiltH.uniforms.r.value += (y - tiltH.uniforms.r.value) * 0.2;
  tiltV.uniforms.r.value = tiltH.uniforms.r.value;
}
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
    sun.shadow.mapSize.set(PHONE ? 1024 : 2048, PHONE ? 1024 : 2048);
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
// phones: no reflection (it draws the whole scene a second time every frame); the cream floor is simply opaque
if (PHONE) { mirror.visible = false; ground.material.transparent = false; ground.material.opacity = 1; }
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
  const nn = (p, a, b) => Array.from({ length: b - a + 1 }, (_, k) => [p + String(a + k).padStart(2, '0'), 1]);
  const POOLS = {
    rise: [['s03', 3], ['s09', 3], ['s01', 1], ['s02', 1], ['s04', 1], ['s05', 1]],
    land: [['s10', 3], ['s11', 3], ['s06', 1], ['s07', 1]],
    bump: [['bump', 1]],
    step: steps, layer: steps,
    snow: nn('sn', 1, 20), sand: nn('sd', 1, 5), gravel: nn('g', 1, 10), pebble: nn('pb', 1, 13), leaf: nn('lf', 1, 6),
    // soft UI sounds (the sharp ones in the pack are left out)
    hover: [['ui_hover', 1]], pop: [['ui_pop', 1]], modal: [['ui_modal', 1]], toggle: [['ui_toggle', 1]],
    whoosh: [['ui_whoosh', 1]], chime: [['ui_chime', 1]], nope: [['ui_error', 1]],
  };
  const GAP = { rise: 0.09, land: 0.12, step: 0.08, layer: 0.05, bump: 0.25, snow: 0.07, sand: 0.08, gravel: 0.12, pebble: 0.12, leaf: 0.07,
    hover: 0.06, pop: 0.05, modal: 0.2, toggle: 0.05, whoosh: 0.3, chime: 0.3, nope: 0.4 };
  // each biome mixes its own layers into the basic sounds: [pool, volume, playback rate]
  const MIX = {
    desert: { step: [['step', 0.8], ['sand', 0.5, 1.15]], rise: [['rise', 0.85], ['pebble', 0.35]], land: [['land', 0.9], ['sand', 0.35, 0.9]] },
    snow: { step: [['snow', 0.5, 0.92], ['step', 0.5]], rise: [['rise', 0.95], ['snow', 0.22, 0.8], ['gravel', 0.18]], land: [['land', 0.95], ['snow', 0.25, 0.78]] }, // snow softly on top of the stone sounds
    autumn: { step: [['step', 0.75], ['leaf', 0.5]], rise: [['rise', 0.9], ['pebble', 0.2], ['leaf', 0.22, 0.8]], land: [['land', 0.9], ['leaf', 0.3, 0.85]] },
    cave: { rise: [['rise', 0.8], ['pebble', 0.4, 0.85]], land: [['land', 0.85], ['gravel', 0.3, 0.8]] },
  };
  let mixBiome = 'woods';
  const UI_KINDS = new Set(['hover', 'pop', 'modal', 'toggle', 'whoosh', 'chime', 'nope']);
  const NAMES = [...new Set(Object.values(POOLS).flat().map(([n]) => n))];
  let ctx, master, musicGain, music, loading, duck = true, ambGain, echo, soft, dim;
  // sound settings, saved on this device
  const prefs = { music: 0.5, fx: 0.8, mute: false, amb: 0.5, ambOn: true };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem('hidden-maze-sound') || '{}')); } catch {}
  function apply() {
    if (!ctx) return;
    const now = ctx.currentTime;
    master.gain.setTargetAtTime(prefs.mute ? 0 : prefs.fx * 0.6, now, 0.05);
    // music stays subtle even at full, and drops lower in the menus
    musicGain.gain.setTargetAtTime(prefs.mute ? 0 : prefs.music * 0.22 * (duck ? 0.45 : 1), now, 0.8);
    // ambience: barely there, like a quiet room tone (and softer still in the menus)
    ambGain.gain.setTargetAtTime(prefs.mute || !prefs.ambOn ? 0 : prefs.amb * 0.16 * (duck ? 0.5 : 1), now, 1.2);
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
    soft = ctx.createBiquadFilter(); // takes the edge off for a soft, satisfying tone (and muffles more in the cave)
    soft.type = 'lowpass'; soft.frequency.value = 6500;
    dim = ctx.createGain(); // the cave turns everything down a little
    master.connect(dim).connect(soft).connect(ctx.destination);
    // the cave adds a soft echo to the stone sounds
    echo = { send: ctx.createGain(), delay: ctx.createDelay(1), fb: ctx.createGain(), lp: ctx.createBiquadFilter() };
    echo.send.gain.value = 0; echo.delay.delayTime.value = 0.16; echo.fb.gain.value = 0.12; echo.lp.type = 'lowpass'; echo.lp.frequency.value = 1400;
    echo.send.connect(echo.delay).connect(echo.lp).connect(echo.fb).connect(echo.delay);
    echo.lp.connect(soft);
    // a second, longer tap so the echo sounds like a hollow space rather than a single slap
    const d2 = ctx.createDelay(1), f2 = ctx.createGain(), l2 = ctx.createBiquadFilter();
    d2.delayTime.value = 0.3; f2.gain.value = 0; l2.type = 'lowpass'; l2.frequency.value = 1000;
    echo.send.connect(d2).connect(l2).connect(f2).connect(d2); l2.connect(soft);
    ambGain = ctx.createGain(); ambGain.gain.value = 0; ambGain.connect(ctx.destination);
    for (const n of Object.keys(AMB_FILES)) fetch(`assets/ambience/${n}.m4a`).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)).then(buf => { ambBuf[n] = buf; setAmbience(ambWant); }).catch(() => {});
    // dry leaves underfoot (autumn): made here, not loaded: a soft rustle under an envelope with little crackles
    for (let k = 1; k <= 6; k++) {
      const sr = ctx.sampleRate, n = Math.floor(sr * 0.24), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
      let r = k * 7919 + 13; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < n; i++) { const t = i / n; d[i] = (rnd() * 2 - 1) * 0.22 * Math.min(1, t * 40) * Math.pow(1 - t, 2.4); }
      for (let c = 0; c < 24; c++) {
        const at = Math.floor(Math.pow(rnd(), 1.7) * n * 0.75), len = 30 + Math.floor(rnd() * 140), amp = (0.25 + rnd() * 0.75) * (1 - at / n);
        for (let j = 0; j < len && at + j < n; j++) d[at + j] += (rnd() * 2 - 1) * amp * Math.exp(-j / (len * 0.22));
      }
      let prev = 0, peak = 0;
      for (let i = 0; i < n; i++) { const v = d[i]; d[i] = v - prev * 0.9; prev = v; peak = Math.max(peak, Math.abs(d[i])); } // gentle high-pass: no rumble
      for (let i = 0; i < n; i++) d[i] *= 0.6 / peak;
      buffers['lf0' + k] = b;
    }
    loading = Promise.all(NAMES.filter(n => !n.startsWith('lf')).map(async n => {
      try { buffers[n] = await ctx.decodeAudioData(await (await fetch(`assets/sfx/${n}.m4a`)).arrayBuffer()); } catch {}
    }));
    apply();
    wantMusic = true; // the music starts with the game (quietly under the menus), not only once you play
    // (streamed from an <audio> element through the mixer, not decoded whole into memory)
    try { music = new Audio('assets/music/cozy.mp3'); music.loop = true; music.preload = 'auto'; ctx.createMediaElementSource(music).connect(musicGain); startMusic(); } catch { music = null; }
  }
  // background music: starts the first time you play, then loops (60 s track)
  let musicStarted = false, wantMusic = false;
  function startMusic() {
    if (!wantMusic || musicStarted || !music || !ctx) return;
    musicStarted = true;
    music.play().catch(() => { musicStarted = false; }); // (tried again on the next tap if the browser said no)
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
  // ambience per biome: a long quiet loop, filtered to suit the place; crossfades when the biome changes
  const AMB_FILES = { wind: 1 };
  const AMB = {
    woods: ['wind', 'lowpass', 2200, 0.8], autumn: ['wind', 'lowpass', 4000, 1], snow: ['wind', 'highpass', 250, 1],
    desert: ['wind', 'bandpass', 700, 0.9], cave: ['wind', 'lowpass', 420, 1.4], // desert: only a soft airy wind (no animals)
  };
  const ambBuf = {}; let ambWant = 'woods', ambNow = null, trickle = 0;
  function setAmbience(name) {
    ambWant = name;
    const A = AMB[name] || AMB.woods;
    if (!ctx || !ambBuf[A[0]] || (ambNow && ambNow.name === name)) return;
    const now = ctx.currentTime;
    if (ambNow) { const o = ambNow; o.g.gain.setTargetAtTime(0, now, 0.8); setTimeout(() => o.src.stop(), 4000); }
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = ambBuf[A[0]]; src.loop = true;
    src.loopStart = 0; src.loopEnd = src.buffer.duration;
    f.type = A[1]; f.frequency.value = A[2]; g.gain.value = 0;
    src.connect(f).connect(g).connect(ambGain);
    src.start(0, Math.random() * src.buffer.duration);
    g.gain.setTargetAtTime(A[3], now, 1.2);
    ambNow = { name, src, g };
  }
  function setBiome(name) {
    mixBiome = name;
    setAmbience(name);
    if (!echo) return;
    const cave = name === 'cave', now = ctx.currentTime;
    echo.send.gain.setTargetAtTime(cave ? 0.12 : 0, now, 0.3); // just a hint of a hollow space
    dim.gain.setTargetAtTime(cave ? 0.78 : 1, now, 0.3);
    soft.frequency.setTargetAtTime(cave ? 1700 : 6500, now, 0.3);
  }
  // now and then in the cave, a few pebbles trickle somewhere in the dark
  function tick(dt) {
    if (mixBiome !== 'cave' || !ctx) return;
    if ((trickle -= dt) < 0) { trickle = 7 + Math.random() * 9; play1('pebble', 0.07, Math.random() * 1.2 - 0.6, { rate: 0.8 + Math.random() * 0.2 }); }
  }
  function play(kind, vol, pan = 0, o = {}) {
    const mix = (MIX[mixBiome] || {})[kind];
    if (!mix) return play1(kind, vol, pan, o);
    for (const [pool, k, rate = 1] of mix) play1(pool, vol * k, pan, { ...o, rate: (o.rate || 1) * rate });
  }
  // maxDur cuts long clips short with a quick fade (footsteps come every ~0.17 s)
  function play1(kind, vol, pan = 0, { rate = 1, maxDur = 0 } = {}) {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - (lastT[kind] || 0) < GAP[kind]) return;
    const n = pick(kind); if (!n) return;
    lastT[kind] = now;
    const src = ctx.createBufferSource();
    src.buffer = buffers[n];
    src.playbackRate.value = rate * (UI_KINDS.has(kind) ? 0.97 + Math.random() * 0.06 : 0.9 + Math.random() * 0.18);
    const g = ctx.createGain();
    g.gain.value = vol * (0.8 + Math.random() * 0.3);
    if (maxDur) g.gain.setTargetAtTime(0, now + maxDur * 0.6, maxDur * 0.2);
    let node = src.connect(g);
    if (kind === 'snow') { // the snow recordings are crisp: round them off
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.4;
      node = node.connect(lp);
    }
    if (kind === 'rise') { // darker and softer: less grinding friction, more of a low rumble
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1800; lp.Q.value = 0.5;
      node = node.connect(lp);
    }
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
    node.connect(master);
    if (echo && !UI_KINDS.has(kind) && (mixBiome === 'cave' || (kind !== 'step' && kind !== 'snow' && kind !== 'sand'))) node.connect(echo.send); // in the cave, footsteps echo too
    src.start();
    if (maxDur) src.stop(now + maxDur + 0.15);
    // a faint footstep-texture layer under the stone sounds
    if (kind === 'rise' || kind === 'land') play1('layer', vol * 0.18, pan, { rate: 0.8, maxDur: 0.45 });
  }
  const ui = (kind, vol = 0.5) => play1(kind, vol);
  return { init, play, ui, set, prefs, setScene, setBiome, tick, get ready() { return !!ctx && ctx.state === 'running' && Object.keys(buffers).length; } };
})();
addEventListener('pointerdown', () => sfx.init());
addEventListener('keydown', () => sfx.init());
// left/right placement of a tile on screen (screen right is world +x/-z)
const panOf = (x, z) => THREE.MathUtils.clamp(((x - st.tx) - (z - st.tz)) / 5, -0.6, 0.6);

// ---------- puffs (Mario-style dust) ----------
// soft round billboards (always facing the camera), not solid balls: solid spheres cut through the stones and read
// as lumpy geometry. The picture is a cartoon cloud puff, lit from above with a soft edge.
const MAX_PUFFS = 400;
const puffTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(56, 50, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(236,236,236,.95)'); g.addColorStop(0.8, 'rgba(214,214,214,.55)'); g.addColorStop(1, 'rgba(210,210,210,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const puffMat = new THREE.MeshBasicMaterial({ map: puffTex, transparent: true, depthWrite: false, toneMapped: false });
puffMat.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mvPosition.xy += position.xy * length(instanceMatrix[0].xyz) * 2.0;
    gl_Position = projectionMatrix * mvPosition;`);
};
puffMat.customProgramCacheKey = () => 'puff-billboard';
const puffMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), puffMat, MAX_PUFFS);
puffMesh.renderOrder = 5;
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
  if (n === 0 && puffMesh.count === 0) return; // (no dust in the air: nothing to send)
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
// dust is the color of the level's own stone (a few shades of it)
function dustAt() {
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

// the cave doors' haze: a soft violet-cyan glow behind the mushrooms
const doorHaloMat = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(210,120,255,.55)'); g.addColorStop(0.45, 'rgba(90,200,255,.2)'); g.addColorStop(1, 'rgba(90,200,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
})();
// glowing spores drift up from the mushroom doors now and then
const SPORES = ['#ff5fd2', '#5ff2ff', '#b47dff', '#7dff9a'];
function doorSpores(dt) {
  if (biome !== 'cave') return;
  for (const m of doorMeshes.values()) if (Math.random() < dt * 5)
    spawnPuff(m.position.x + rand(-0.25, 0.25), m.position.y + rand(0.3, 0.8), m.position.z + rand(-0.25, 0.25), rand(-0.1, 0.1), rand(0.25, 0.5), rand(-0.1, 0.1), rand(0.025, 0.05), SPORES[Math.floor(Math.random() * SPORES.length)], rand(1.2, 2));
}

// ---------- key ----------
function makeKey() {
  // a chunky little golden key lying flat, slowly turning, with a soft shadow under it (no glow)
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#f4c24a', metalness: 0.35, roughness: 0.32, emissive: '#ffae00', emissiveIntensity: 0.12 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.036, 14, 32).rotateX(Math.PI / 2), mat);
  ring.position.x = -0.13;
  const shaft = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.05, 0.05, 2, 0.02), mat);
  shaft.position.x = 0.07;
  const t1 = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.05, 0.075, 2, 0.02), mat); t1.position.set(0.17, 0, 0.055);
  const t2 = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.05, 0.055, 2, 0.018), mat); t2.position.set(0.105, 0, 0.045);
  g.add(ring, shaft, t1, t2);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.rotation.x = 0.35; // tipped a little toward the camera so it reads as a key from above
  const spin = new THREE.Group(); spin.add(g);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(90,60,20,.3)'); grd.addColorStop(1, 'rgba(90,60,20,0)'); x.fillStyle = grd; x.fillRect(0, 0, 64, 64);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  // a soft warm glow behind it, faint and slowly breathing
  const gc = document.createElement('canvas'); gc.width = gc.height = 64;
  const gx = gc.getContext('2d'), gg = gx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gg.addColorStop(0, 'rgba(255,226,150,.9)'); gg.addColorStop(0.4, 'rgba(255,210,120,.35)'); gg.addColorStop(1, 'rgba(255,210,120,0)');
  gx.fillStyle = gg; gx.fillRect(0, 0, 64, 64);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.3 }));
  glow.scale.setScalar(0.95);
  const root = new THREE.Group();
  root.add(spin, shadow, glow);
  root.userData.spin = spin; root.userData.shadow = shadow; root.userData.glow = glow;
  return root;
}

// ---------- portal ----------
// The way out of each level, built from the level's own stones (so it matches the scans): a sunk plinth, two pillars
// of two upright stones and a lintel of three stones laid on their side, all at their true proportions, with a calm
// swirl inside in the biome's colors. It sleeps (dim, slow) until Buddy has the key, then wakes up and turns.
const PORTAL_TINTS = { // soft, milky versions of each biome's colors (the swirl should feel calm, not neon)
  woods: ['#dcefcf', '#fbf8ec', '#bfe0a8'], desert: ['#f8e6c2', '#fffaf0', '#efcf96'], snow: ['#e3f0fb', '#ffffff', '#c6def3'],
  autumn: ['#f8dcc0', '#fff6ea', '#efb787'], cave: ['#c4efe2', '#f2fffa', '#94dcc8'],
};
function makePortal(set, biomeName) {
  const root = new THREE.Group(), frame = new THREE.Group(), V = set.variants, box = new THREE.Box3();
  // a stone at its true proportions (uniform scale), standing or laid on its side, placed by its measured box: its
  // bottom at y0 (or its top at topAt), centered on x. Returns its top so the next stone can sit right on it.
  const stone = (vi, geo, s, x, y0, { lying = false, turn = 0, topAt = null } = {}) => {
    const m = new THREE.Mesh(geo(V[vi % V.length]), set.wallMats[vi % V.length]);
    m.scale.setScalar(s);
    m.rotation.set(0, turn * Math.PI / 2, lying ? Math.PI / 2 : 0);
    m.updateMatrixWorld(true);
    // measured from the vertices the stone actually uses (a stone's top shares the whole stone's vertex list)
    const g = m.geometry, P = g.attributes.position, ix = g.index.array, vv = new THREE.Vector3();
    box.makeEmpty();
    for (let i = 0; i < ix.length; i += 7) box.expandByPoint(vv.fromBufferAttribute(P, ix[i]).applyMatrix4(m.matrixWorld));
    if (topAt !== null) y0 = topAt - (box.max.y - box.min.y);
    m.position.set(x - (box.min.x + box.max.x) / 2, y0 - box.min.y, -(box.min.z + box.max.z) / 2);
    m.castShadow = true; frame.add(m);
    return { top: y0 + box.max.y - box.min.y, w: box.max.x - box.min.x };
  };
  const raw = v => v.raw, cap = v => v.cap;
  const H = v => { const b = new THREE.Box3().setFromBufferAttribute(v.raw.attributes.position); return b.max.y - b.min.y; }; // (the stored box is from before the stone was sized)
  const base = stone(0, cap, 1.15, 0, 0, { topAt: 0.08 }).top; // plinth: a stone's top, sunk so only its top shows
  const PX = 0.33, PS = 0.27;
  let pillarTop = 0;
  for (const [k, sgn] of [[0, -1], [1, 1]]) {
    const lower = stone(1 + k, raw, PS, sgn * PX, base, { turn: k });
    const upper = stone(3 + k, raw, PS * 0.97, sgn * PX, lower.top, { turn: k + 2 });
    pillarTop = Math.max(pillarTop, upper.top);
  }
  // lintel: three stones laid on their side, end to end, spanning past the pillars' outer edges
  const span = 2 * PX + 0.24 + 0.1;
  for (const [k, x] of [[5, -span / 3], [6, 0], [2, span / 3]]) stone(k, raw, (span / 3) / H(V[k % V.length]), x, pillarTop - 0.01, { lying: true, turn: k % 2 * 2 });
  root.add(frame);
  const T = (PORTAL_TINTS[biomeName] || PORTAL_TINTS.woods).map(c => new THREE.Color(c));
  const U = { uTime: { value: 0 }, uOn: { value: 0 }, uA: { value: T[0] }, uB: { value: T[1] }, uC: { value: T[2] }, uRock: { value: new THREE.Color().setRGB(...set.rockRef.map(v => v / 255), THREE.SRGBColorSpace) } };
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.72), new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float uTime, uOn; uniform vec3 uA, uB, uC, uRock;
      void main() {
        vec2 sz = vec2(0.42, 0.72), q = abs(vUv - 0.5) * sz - (sz * 0.5 - 0.1);
        float d = length(max(q, 0.0)) - 0.1, a = smoothstep(0.008, -0.008, d);
        vec2 p = (vUv - vec2(0.5, 0.45)) * sz; float r = length(p), ang = atan(p.y, p.x);
        float spin = uTime * (0.4 + 1.8 * uOn);
        float s = 0.5 + 0.5 * sin(ang * 2.0 + r * 22.0 - spin * 2.0);
        vec3 col = mix(uA, uC, s);
        col = mix(col, uB, smoothstep(0.5, 1.0, sin(ang * 3.0 - r * 16.0 + spin * 1.4)) * 0.6);
        col += uB * exp(-r * r * 70.0) * (0.3 + 0.7 * uOn);
        vec3 sleep = uRock * (0.62 + 0.1 * s);
        gl_FragColor = vec4(mix(sleep, col, uOn), a * (0.92 + 0.08 * uOn));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`, // (so it reads the same drawn straight to the screen, as on phones)
  }));
  disc.scale.y = (pillarTop - base) / 0.72; disc.position.y = (base + pillarTop) / 2; // fills the opening
  disc.renderOrder = 3;
  root.add(disc);
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,.75)'); g.addColorStop(0.5, 'rgba(255,255,255,.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color: T[2], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  glow.position.y = 0.45; glow.scale.setScalar(1.5);
  root.add(glow);
  root.userData = { U, glow, on: 0, tint: T };
  root.scale.setScalar(0.84); // fits inside its own tile, so it never pokes into the neighbouring walls
  return root;
}
function updatePortal(dt, time) {
  if (!portal || !portal.visible) return;
  const P = portal.userData, want = hasKey ? 1 : 0;
  P.on += (want - P.on) * Math.min(1, dt * 3);
  P.U.uTime.value = time; P.U.uOn.value = P.on;
  P.glow.material.opacity = P.on * (0.35 + 0.1 * Math.sin(time * 3));
  // once awake, soft motes drift out of the swirl
  if (P.on > 0.5 && Math.random() < dt * 6) {
    const a = portal.rotation.y, side = rand(-0.15, 0.15);
    spawnPuff(portal.position.x + Math.cos(a) * side, rand(0.2, 0.7), portal.position.z - Math.sin(a) * side, Math.sin(a) * 0.25, rand(0.15, 0.35), Math.cos(a) * 0.25, rand(0.02, 0.04), '#' + P.tint[Math.floor(Math.random() * 3)].getHexString(), 1.4);
  }
}
// where the key waits: a dead end off the way from a to b, so you have to go and look for it. Picks the one whose
// detour is closest to `detour` x the a-to-b distance (bigger later in the game).
function keyTile(m, a, b, detour = 0.5) {
  const bfs = ([sx, sz]) => {
    const { N, g } = m, d = new Int32Array(N * N).fill(-1), q = [sz * N + sx]; d[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % N, z = (i / N) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Z = z + dz, j = Z * N + X;
        if (X >= 0 && Z >= 0 && X < N && Z < N && !g[j] && d[j] < 0) { d[j] = d[i] + 1; q.push(j); }
      }
    }
    return d;
  };
  const da = bfs(a), db = bfs(b), { N, g } = m, D = da[b[1] * N + b[0]];
  let best = null, bestS = Infinity;
  for (let i = 0; i < N * N; i++) {
    if (g[i] || da[i] < 3 || db[i] < 3) continue;
    const x = i % N, z = (i / N) | 0;
    const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => { const X = x + dx, Z = z + dz; return X >= 0 && Z >= 0 && X < N && Z < N && !g[Z * N + X]; }).length;
    const sc = Math.abs(da[i] + db[i] - D - detour * D) + (open === 1 ? 0 : 6); // dead ends first
    if (sc < bestS) { bestS = sc; best = [x, z]; }
  }
  return best || [b[0], b[1]];
}
// which way the portal faces: toward its open neighbour (the tile you walk in from)
function portalYaw([x, z]) {
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (!isWall(x + dx, z + dz)) return Math.atan2(dx, dz);
  return Math.PI / 4;
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
// More shapes, drawn in screen space: X to the right, Y up the screen (the maze grid shows as a diamond, so a shape
// has to stay inside |X| + |Y| <= 1.41). Thin parts that don't connect are trimmed by the maze generator.
const scr = (cx, cz, C) => { const u = uv(cx, C), v = uv(cz, C); return [(u - v) / Math.SQRT2, -(u + v) / Math.SQRT2]; };
const shape2 = f => ({ inside: (cx, cz, C) => f(...scr(cx, cz, C)) });
const disc = (X, Y, x, y, r) => (X - x) ** 2 + (Y - y) ** 2 <= r * r;
// a line between two points, about one cell wide: bridges between rooms
const link = (X, Y, [ax, ay], [bx, by], C) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((X - ax) * dx + (Y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(X - (ax + dx * t), Y - (ay + dy * t)) < 1.3 / C;
};
Object.assign(SHAPES, {
  gem: shape2((X, Y) => Math.abs(X) <= 0.72 && Math.abs(Y) <= 0.72),                                   // a square standing straight on screen
  plus: shape2((X, Y) => (Math.abs(X) < 0.32 && Math.abs(Y) < 0.98) || (Math.abs(Y) < 0.32 && Math.abs(X) < 0.98)),
  tree: shape2((X, Y) => (Y > -0.55 && Math.abs(X) <= (1.05 - Y) * 0.62 && Y < 1.02) || (Math.abs(X) < 0.2 && Y <= -0.55 && Y > -0.98)), // a pine
  flower: shape2((X, Y) => disc(X, Y, 0, 0, 0.36) || [0, 1, 2, 3, 4].some(k => { const a = Math.PI / 2 + k * 1.2566; return disc(X, Y, Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0.3); })),
  triangle: shape2((X, Y) => Y >= -0.62 && Math.abs(X) <= (0.98 - Y) * 0.6),                          // a pyramid
  hourglass: shape2((X, Y) => Math.abs(Y) <= 0.95 && Math.abs(X) <= 0.22 + 0.62 * Math.abs(Y)),
  cactus: shape2((X, Y) => (Math.abs(X) < 0.27 && Y > -0.98 && Y < 0.95)
    || (X < 0 && X > -0.78 && Y > -0.32 && Y < 0.04) || (X > -0.8 && X < -0.44 && Y > -0.32 && Y < 0.58)
    || (X > 0 && X < 0.78 && Y > -0.06 && Y < 0.3) || (X > 0.44 && X < 0.8 && Y > -0.06 && Y < 0.6)),
  crescent: shape2((X, Y) => disc(X, Y, 0, 0, 0.98) && !disc(X, Y, 0.42, 0.3, 0.66)),
  ring: shape2((X, Y) => disc(X, Y, 0, 0, 0.98) && !disc(X, Y, 0, 0, 0.4)),                            // a frozen lake in the middle
  snowflake: shape2((X, Y) => disc(X, Y, 0, 0, 0.98) && (disc(X, Y, 0, 0, 0.3) || Math.abs(X) < 0.17 || Math.abs(Y) < 0.17 || Math.abs(Math.abs(X) - Math.abs(Y)) < 0.2)),
  frame: { inside: (cx, cz, C) => Math.max(Math.abs(uv(cx, C)), Math.abs(uv(cz, C))) >= 0.42 },
  islands: shape2((X, Y) => { const R = [[0, 0.68], [0.68, 0], [0, -0.68], [-0.68, 0]], C2 = 14;
    return R.some(([x, y]) => disc(X, Y, x, y, 0.42)) || R.some((r, k) => link(X, Y, r, R[(k + 1) % 4], C2)); }),
  star: shape2((X, Y) => { const r = Math.hypot(X, Y), a = Math.atan2(Y, X) - Math.PI / 2; return r <= 0.42 + 0.56 * Math.pow(0.5 + 0.5 * Math.cos(5 * a), 1.6); }),
  mushroom: shape2((X, Y) => (Y >= -0.05 && disc(X, Y, 0, -0.05, 0.98)) || (Math.abs(X) < 0.3 && Y < 0 && Y > -0.95)),
  snake: shape2((X, Y) => Math.abs(X) < 0.98 && Math.abs(Y - 0.5 * Math.sin(X * 2.8)) < 0.4),
  leaf: shape2((X, Y) => { const a = (X + Y) / Math.SQRT2, b = (Y - X) / Math.SQRT2; return disc(a, b, 0, 0.42, 0.97) && disc(a, b, 0, -0.42, 0.97); }), // pointed both ends, tilted
});
// ---------- level plan ----------
// Each world is 5 chapters of 5 levels, in a saw-tooth: a gentle level to breathe, a mix of what you know, the
// chapter's new shape, a door level, then a bigger challenge with the new shape. Maze size, how far you can see and
// how far off the way the key hides all grow with the chapter and the world; the last level of a world is the biggest.
const WORLD_SHAPES = {
  woods: ['circle', 'gem', 'plus', 'tree', 'flower'],
  desert: ['triangle', 'hourglass', 'cactus', 'crescent', 'twin'],
  snow: ['ring', 'snowflake', 'frame', 'islands', 'star'],
  autumn: ['mushroom', 'heart', 'snake', 'circles', 'leaf'],
};
const BASE_CELLS = [4, 5, 6, 7];
const levelPlan = (() => {
  const cache = {};
  return L => cache[L] ||= (() => {
    const w = Math.floor(L / LEVELS_PER_WORLD), k = L % LEVELS_PER_WORLD, c = Math.floor(k / 5), p = k % 5;
    const world = WORLDS[w], shapes = WORLD_SHAPES[world.biome], rnd = mulberry32(L * 131 + 7);
    let cells = BASE_CELLS[w] + c + (p === 4 ? 1 : 0) - (p === 0 && c > 0 ? 1 : 0);
    if (w === 0 && c === 0) cells = [3, 4, 4, 5, 5][p]; // the very first levels are tiny
    if (k === LEVELS_PER_WORLD - 1) cells += 1;          // the world's finale
    let shape = null, gateway = false;
    if (p === 3 && (w > 0 || c > 0)) gateway = true;
    else if (p === 2 || p === 4) shape = shapes[c];
    else if (p === 1 && (c > 0 || w > 0)) { const known = w > 0 ? shapes.slice(0, c + 1).concat(WORLD_SHAPES[WORLDS[w - 1].biome]) : shapes.slice(0, c); shape = known.length ? known[Math.floor(rnd() * known.length)] : null; }
    if (shape && cells < 5) cells = 5;                    // shapes need room to read
    const reveal = Math.max(1.4, world.reveal - 0.08 * c - (p === 4 ? 0.12 : 0) + (p === 0 ? 0.15 : 0));
    const detour = p === 0 ? 0.15 : Math.min(0.85, 0.2 + 0.1 * c + 0.06 * w + (p === 4 ? 0.1 : 0));
    return { cells, shape, gateway, reveal, detour, chapter: c };
  })();
})();
function genShapedMaze(cells, rnd, shape) {
  const S = SHAPES[shape], C = cells, N = C * 2 + 1;
  const g = new Uint8Array(N * N).fill(1);
  const ok = (cx, cz) => cx >= 0 && cz >= 0 && cx < C && cz < C && S.inside(cx, cz, C);
  const cellsIn = [];
  for (let cz = 0; cz < C; cz++) for (let cx = 0; cx < C; cx++) if (ok(cx, cz)) cellsIn.push([cx, cz]);
  // grow the maze in the shape's biggest connected part (thin bits that don't connect are left out)
  const comp = new Int32Array(C * C).fill(-1), sizes = [];
  for (const [x0, z0] of cellsIn) {
    if (comp[z0 * C + x0] >= 0) continue;
    const id = sizes.length, q = [[x0, z0]]; comp[z0 * C + x0] = id;
    for (let h = 0; h < q.length; h++) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = q[h][0] + dx, z = q[h][1] + dz;
      if (ok(x, z) && comp[z * C + x] < 0) { comp[z * C + x] = id; q.push([x, z]); }
    }
    sizes.push(q.length);
  }
  const big = sizes.indexOf(Math.max(...sizes)), main = cellsIn.filter(([x, z]) => comp[z * C + x] === big);
  const [sx, sz] = main[Math.floor(rnd() * main.length)];
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
    const [cx, cz] = main[Math.floor(rnd() * main.length)];
    const [dx, dz] = [[1, 0], [0, 1]][Math.floor(rnd() * 2)];
    if (ok(cx + dx, cz + dz) && comp[(cz + dz) * C + cx + dx] === big) g[(2 * cz + 1 + dz) * N + 2 * cx + 1 + dx] = 0;
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
// race maze: one quarter is generated, then mirrored both ways, so every corner entry is exactly as far from the key.
// A shape (one that looks the same from all four corners) can trim it: the quarter is grown inside the shape.
const RACE_SHAPES = ['square', 'circle', 'gem', 'plus', 'snowflake'];
function genFairRaceMaze(cells, rnd = Math.random, shape = 'square') {
  const N = cells * 2 + 1, H = (N - 1) / 2, Cq = Math.ceil(cells / 2);
  let q;
  if (shape === 'square' || !SHAPES[shape]) q = genMaze(Cq, rnd); // a small maze for the quarter (covers tiles 0..H)
  else { SHAPES.__quarter = { inside: (cx, cz) => SHAPES[shape].inside(cx, cz, cells) }; q = genShapedMaze(Cq, rnd, '__quarter'); }
  const g = new Uint8Array(N * N).fill(1);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const qx = Math.min(x, N - 1 - x), qz = Math.min(z, N - 1 - z);
    if (qx < q.N && qz < q.N) g[z * N + x] = q.g[qz * q.N + qx];
  }
  // open the center lines where the quarters meet so they connect (only between open tiles), then open the center
  for (let k = 1; k <= H; k += 2) {
    if (rnd() < 0.5 && (shape === 'square' || !g[(H - 1) * N + k])) { g[H * N + k] = g[H * N + N - 1 - k] = 0; g[k * N + H] = g[(N - 1 - k) * N + H] = 0; }
  }
  g[H * N + H] = g[(H - 1) * N + H] = g[(H + 1) * N + H] = g[H * N + H - 1] = g[H * N + H + 1] = 0;
  let empty = null;
  if (shape !== 'square') { // tiles away from any open path stay empty floor, so the walls hug the shape
    empty = new Uint8Array(N * N);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      let near = false;
      for (let dz = -1; dz <= 1 && !near; dz++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Z = z + dz; if (X >= 0 && Z >= 0 && X < N && Z < N && !g[Z * N + X]) { near = true; break; } }
      if (!near) empty[z * N + x] = 1;
    }
  }
  return { N, g, empty };
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
const ui = { level: $('level'), steps: $('steps'), time: $('time') };
let assets, walls = [], caps = [], floor, floorShadow, player, silhouette, key, portal, keyAt = null, hasKey = false;
let maze, heights, vels, targets, shake, rotIdx, varIdx, twist, nudge, tint, origin, optimal, tileGlow;
let L = 0, steps = 0, elapsed = 0, won = false, viewW = parseFloat(params.get('zoom') || '3'), peek = false;
let state = 'loading';
const st = { gx: 0, gz: 0, fx: 0, fz: 0, tx: 0, tz: 0, t: 1, moving: false, facing: 0, bumpT: -1, bdx: 0, bdz: 0, idle: 0 };
let heldDir = null, queued = null;

// a model's texture goes to a canvas (shrunk to keep phone memory in check) so its colors can be adjusted
function canvasTexture(tex, size) {
  if (PHONE) size /= 2; // phones: a quarter of the texture memory (the stones are small on a phone screen anyway)
  const img = tex.image;
  const k = Math.min(1, size / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const cx = c.getContext('2d', { willReadFrequently: true });
  // opaque first: some scans have see-through specks, which drop any color painted into them and render black
  cx.fillStyle = '#000'; cx.fillRect(0, 0, c.width, c.height);
  cx.drawImage(img, 0, 0, c.width, c.height);
  if (img.close) img.close(); // (a decoded ImageBitmap holds its pixels until closed)
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
// cave glow: which pixels are bioluminescent. The scans paint them as specks and moss in many shades (teal, mint,
// purple, sage), some quite dull, so anything that stands apart from the stone's own rock color and isn't darker
// than the rock counts. Measured on the untouched texture, before the rock is recolored.
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function captureGlow(tex) {
  const c = tex.image, px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, mask = new Float32Array(px.length / 4);
  const ch = [[], [], []];
  for (let i = 0; i < px.length; i += 16) if (Math.max(px[i], px[i + 1], px[i + 2]) > 20) for (let k = 0; k < 3; k++) ch[k].push(px[i + k]);
  const rock = ch.map(a => { a.sort((m, n) => m - n); return a[a.length >> 1] || 0; });
  const rockL = 0.3 * rock[0] + 0.59 * rock[1] + 0.11 * rock[2];
  const hues = [];
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const r = px[i], g = px[i + 1], b = px[i + 2], l = 0.3 * r + 0.59 * g + 0.11 * b, [h, sat] = hueSat(r, g, b);
    const w = smooth(28, 60, Math.hypot(r - rock[0], g - rock[1], b - rock[2])) * smooth(rockL * 0.7, rockL * 1.05, l) * smooth(0.14, 0.28, sat);
    mask[j] = w;
    if (w > 0.5 && (j & 7) === 0) hues.push(h);
  }
  return { mask, hues };
}
// paint the glowing bits fluorescent: each stone gets its own glow hue (cyan, magenta, lime...), keeping a little of
// the original hue variety, at full saturation. Makes the glow picture (just those bits) and the stone's glow color.
function neonGlow(tex, { mask, hues }, hue, ref) {
  const refL = 0.3 * ref[0] + 0.59 * ref[1] + 0.11 * ref[2];
  const c = tex.image, ctx = c.getContext('2d'), img = ctx.getImageData(0, 0, c.width, c.height), px = img.data;
  const gc = document.createElement('canvas'); gc.width = c.width; gc.height = c.height;
  const gctx = gc.getContext('2d'), gimg = gctx.createImageData(c.width, c.height), gp = gimg.data;
  // circular mean of the original glow hues: each pixel keeps its offset from it (squeezed), around the new hue
  const sx = hues.reduce((a, h) => a + Math.cos(h * 6.283), 0), sy = hues.reduce((a, h) => a + Math.sin(h * 6.283), 0);
  const mean = Math.atan2(sy, sx) / 6.283;
  const col = new THREE.Color();
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const w = mask[j];
    gp[i + 3] = 255;
    if (w <= 0) continue;
    const [h] = hueSat(px[i], px[i + 1], px[i + 2]);
    let dh = h - mean; dh -= Math.round(dh);
    col.setHSL((hue + dh * 0.25 + 1) % 1, 1, 0.6);
    // the stone itself stays plain rock (the moss was already recolored to rock); only the glow picture gets the
    // color, keeping the moss's own light and dark so the lit specks show detail
    const det = Math.max(0.3, Math.min(1.4, (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / 110));
    for (let k = 0; k < 3; k++) gp[i + k] = col[['r', 'g', 'b'][k]] * 255 * w * det;
    // unlit, the moss is just a lighter patch of the same rock
    const L = Math.max(0.7, Math.min(1.25, (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / refL));
    for (let k = 0; k < 3; k++) px[i + k] += (ref[k] * L - px[i + k]) * w * 0.9;
  }
  ctx.putImageData(img, 0, 0); tex.needsUpdate = true;
  gctx.putImageData(gimg, 0, 0);
  const glowTex = new THREE.CanvasTexture(gc);
  glowTex.flipY = tex.flipY; glowTex.colorSpace = THREE.SRGBColorSpace;
  return { glowTex, glowColor: '#' + col.setHSL(hue, 1, 0.7).getHexString() };
}
// the scans have baked white highlights (shiny blobs): in the dark cave they read as frost, so pull them to the rock
function flattenHighlights(tex, ref) {
  const refL = 0.3 * ref[0] + 0.59 * ref[1] + 0.11 * ref[2];
  const c = tex.image, ctx = c.getContext('2d'), img = ctx.getImageData(0, 0, c.width, c.height), px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2], l = 0.3 * r + 0.59 * g + 0.11 * b, [, sat] = hueSat(r, g, b);
    const w = smooth(refL * 1.25, refL * 1.7, l) * (1 - smooth(0.2, 0.35, sat));
    if (w <= 0) continue;
    for (let k = 0; k < 3; k++) px[i + k] += (ref[k] * 1.1 - px[i + k]) * w;
  }
  ctx.putImageData(img, 0, 0); tex.needsUpdate = true;
}
// the glowing bits are always softly lit, and blaze up on the tile Buddy steps on (per-tile aGlow, 0..1);
// a slow shimmer runs across them so the cave feels alive
const GLOW_TIME = { value: 0 };
function addStepGlow(mat, glowTex) {
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, rr) => {
    base(sh, rr);
    sh.uniforms.uGlowMap = { value: glowTex };
    sh.uniforms.uGlowTime = GLOW_TIME;
    sh.vertexShader = 'attribute float aGlow;\nvarying float vGlow;\nvarying vec3 vGlowW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGlowW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform sampler2D uGlowMap;\nuniform float uGlowTime;\nvarying float vGlow;\nvarying vec3 vGlowW;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      { // dark until stepped on; then the specks light up and pulse, each part a little out of step with the others
        vec3 gl = texture2D(uGlowMap, vMapUv).rgb;
        float pulse = 0.65 + 0.35 * sin(uGlowTime * 4.0 + vGlowW.x * 9.0 + vGlowW.z * 7.0 + dot(gl, vec3(6.0)));
        totalEmissiveRadiance += gl * vGlow * 3.2 * pulse; }`);
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
function scaleRock(tex, k, skip = null) {
  k = Math.max(0.6, Math.min(1.6, k));
  const c = tex.image, ctx = c.getContext('2d'), img = ctx.getImageData(0, 0, c.width, c.height), px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    if (skip && skip[i >> 2]) continue;
    const w = rockness(px[i], px[i + 1], px[i + 2]);
    if (w <= 0) continue;
    const f = 1 + (k - 1) * w;
    px[i] = Math.min(255, px[i] * f); px[i + 1] = Math.min(255, px[i + 1] * f); px[i + 2] = Math.min(255, px[i + 2] * f);
  }
  ctx.putImageData(img, 0, 0);
  tex.needsUpdate = true;
}
// pull every rock pixel toward one shared color, keeping only its light and dark: removes odd tints between stones
function tintRock(tex, ref, k, contrast = 0.65, lift = true, skip = null) {
  const refL = 0.299 * ref[0] + 0.587 * ref[1] + 0.114 * ref[2];
  const c = tex.image, ctx = c.getContext('2d'), img = ctx.getImageData(0, 0, c.width, c.height), px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    if (skip && skip[i >> 2]) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2], L0 = (0.299 * r + 0.587 * g + 0.114 * b) / refL;
    // softer light and dark: everything is pulled toward the middle, and near-black spots are fully repainted
    // (dark crust where moss meets rock, half green and half brown, slipped past both recolors: dark pixels are
    // repainted whatever their hue)
    // near-black is empty texture (holes, gaps between UV islands), not shading: it gets the plain rock tone, or it
    // shows as muddy stains on the stone tops
    const Lc = Math.max(0.62, 1 + (L0 - 1) * contrast), hole = Math.max(0, Math.min(1, (0.28 - L0) / 0.18));
    // without the lift (door stones keep their dark cave mouth) only true holes, near black, are filled
    const voidK = Math.max(0, Math.min(1, (0.12 - L0) / 0.08));
    const L = lift ? Lc + (0.95 - Lc) * hole : L0 + (0.85 - L0) * voidK;
    const w = lift ? Math.max(rockness(r, g, b) * k, Math.min(1, Math.max(0, (0.68 - L0) / 0.25))) : Math.max(voidK, rockness(r, g, b) * k * Math.min(1, L0 / 0.45));
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
        totalEmissiveRadiance += ${G.cave ? 'vec3(0.3, 0.62, 1.0) * edge * shade * 0.12' : 'vec3(1.0, 0.8, 0.52) * edge * shade * 0.75'};` : ''}
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
function matchMoss(tex, target, skip = null) {
  const mean = mossMean(tex); if (!mean) return;
  const gain = mean.map((m, k) => Math.max(0.6, Math.min(1.6, target[k] / m)));
  const c = tex.image, ctx = c.getContext('2d'), img = ctx.getImageData(0, 0, c.width, c.height), px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    if (skip && skip[i >> 2]) continue;
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
// some scans have dark, muddy moss (it read as a glitch on the stone tops): moss darker than the shared moss color
// is brought up to it, keeping a little of its own light and dark
function liftDarkMoss(tex, ref) {
  const refL = 0.299 * ref[0] + 0.587 * ref[1] + 0.114 * ref[2];
  const c = tex.image, ctx = c.getContext('2d'), img = ctx.getImageData(0, 0, c.width, c.height), px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2], w = greenness(r, g, b);
    if (w <= 0) continue;
    const L = (0.299 * r + 0.587 * g + 0.114 * b) / refL;
    if (L >= 0.8) continue;
    const k = w * Math.min(1, (0.8 - L) / 0.35), Lt = 0.72 + 0.2 * L;
    px[i] += (ref[0] * Lt - r) * k; px[i + 1] += (ref[1] * Lt - g) * k; px[i + 2] += (ref[2] * Lt - b) * k;
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
// which texture pixels belong to a door's plant (the tree / cactus above the stone): every triangle above the stone's
// top is drawn into a mask by its UVs. Colors can't tell a tree's shaded leaves from rock, but height can.
function plantMask(geo, tex) {
  const W = tex.image.width, H = tex.image.height, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), P = geo.attributes.position, UV = geo.attributes.uv, ix = geo.index ? geo.index.array : null;
  x.fillStyle = x.strokeStyle = '#fff'; x.lineWidth = 2; x.lineJoin = 'round';
  const n = ix ? ix.length : P.count, flip = tex.flipY;
  for (let t = 0; t < n; t += 3) {
    const a = ix ? ix[t] : t, b = ix ? ix[t + 1] : t + 1, d = ix ? ix[t + 2] : t + 2;
    if (Math.min(P.getY(a), P.getY(b), P.getY(d)) < 0.012) continue; // part of the stone
    x.beginPath();
    for (const v of [a, b, d]) { const u = UV.getX(v) * W, w = (flip ? 1 - UV.getY(v) : UV.getY(v)) * H; v === a ? x.moveTo(u, w) : x.lineTo(u, w); }
    x.closePath(); x.fill(); x.stroke();
  }
  const px = x.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H);
  for (let i = 0; i < m.length; i++) m[i] = px[i * 4 + 3] > 100 ? 1 : 0;
  return m;
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
  if (!params.has("nosimp") && raw.index.count > 150000) simplifyGeo(raw); // (the shipped models are already simplified)
  // phones: a stone is ~80 px tall on screen, so a fifth of the triangles looks the same (a level draws ~5x less)
  if (PHONE && !params.has("nosimp")) simplifyGeo(raw, Math.min(1, 9000 / raw.index.count), 0.04);
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
  if (PHONE && !params.has("nosimp")) simplifyGeo(raw, Math.min(1, 30000 / raw.index.count), 0.015); // (phones: ~10k triangles)
  const mat = new THREE.MeshStandardMaterial({ map: canvasTexture(pm.material.map, 2048), roughness: 0.92, metalness: 0 });
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
    rt.texture.anisotropy = 4; rt.texture.userData.rt = rt; // (kept so the whole target can be freed later)
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
  // (phones: half size, a quarter of the memory; a flat stone is only ~60 px across on a phone screen)
  const TC = PHONE ? 192 : 384, SW = PHONE ? 128 : 256, SH = PHONE ? 32 : 64, V = variants.length;
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
// the flat stones' picture atlas (~60 MB of graphics memory on a laptop, ~15 MB on a phone) is baked when a level of
// that world is played, not when the map loads the world's stones (scrolling the map used to bake every world)
function floorMatOf(set) { return (set.floorMat ||= bakeFloor(set.variants, set.B)); }
// each biome's stones and door block, loaded and prepared the first time the biome is needed
const stoneSets = {};
const stoneSetLoads = {};
function stoneSet(name) {
  return stoneSetLoads[name] ||= (async () => {
    const B = BIOMES[name], loader = new GLB();
    const [doorG, ...pgs] = await Promise.all([loader.loadAsync(B.door), ...B.stones.map(f => loader.loadAsync(f))]);
    const variants = pgs.map(prepPillar);
    const door = prepDoor(doorG);
    // cave: the bioluminescent bits (bright and colorful, any hue) keep their own colors; remember them before the rock is recolored
    const glows = B.stepGlow ? variants.map(v => captureGlow(v.mat.map)) : null;
    // within a biome, every stone and the door block get the same rock color and the same moss color
    MOSS = B.moss || { hue: B.glow.hue, width: Math.max(0.08, B.glow.width) };
    const means = variants.map(v => rockMean(v.mat.map));
    const rockRef = B.rockColor || means[0].map(v => v * (B.rockGain || 1)); // the first stone of each biome sets the color (unless the biome names one)
    variants.forEach(v => { matchRock(v.mat.map, rockRef, B.matchStrength ?? 1); tintRock(v.mat.map, rockRef, B.tint ?? 0.75, B.contrast ?? 0.65); });
    // then every stone gets the same typical brightness as the first (averages are thrown off by dark cracks)
    const midL = rockMedianL(variants[0].mat.map);
    variants.slice(1).forEach(v => scaleRock(v.mat.map, midL / rockMedianL(v.mat.map)));
    PROTECT_TRUNK = true; DOOR_MIN = B.dark ? 25 : 70;
    // the door's stone must read as the same rock (doors keep their own shading and the dark cave mouth); the cave's
    // mushroom door is left as it is, so its mushrooms keep their own colors
    // only the stone part is recolored (the plant is found by height, see plantMask): it reads as the same rock as
    // the walls, while the tree keeps its own colors and shading
    const plant = B.doorPlant ? null : plantMask(door.raw, door.mat.map);
    if (!B.doorPlant) {
      tintRock(door.mat.map, rockRef, B.doorTint ?? 0.95, 1, false, plant);
      PROTECT_TRUNK = false;
      scaleRock(door.mat.map, midL / rockMedianL(door.mat.map), plant);
    }
    PROTECT_TRUNK = false;
    const mosses = variants.map(v => mossMean(v.mat.map)).filter(Boolean);
    const mossRef = B.mossColor || (mosses.length ? [0, 1, 2].map(k => mosses.reduce((a, m) => a + m[k], 0) / mosses.length) : null);
    if (mossRef && !B.stepGlow) variants.forEach(v => { B.mossColor ? tintMoss(v.mat.map, mossRef, B.mossPalette) : matchMoss(v.mat.map, mossRef); liftDarkMoss(v.mat.map, mossRef); });
    if (glows) variants.forEach((v, i) => {
      flattenHighlights(v.mat.map, rockRef);
      Object.assign(v, neonGlow(v.mat.map, glows[i], B.glowHues[i % B.glowHues.length], rockRef));
    });
    // the door's plant: its own color when the biome names one (the cave's mushroom door glows pink), else the moss color
    if (mossRef && !B.doorPlant) matchMoss(door.mat.map, mossRef, plant); // moss on the door's stone matches the walls; the tree is left alone
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
      v.raw.userData.shared = v.cap.userData.shared = true; // (the portal's stones use them too: never freed with a level)
    }
    door.mat.clippingPlanes = clip; door.mat.clipShadows = true;
    // the door's tree is a big leafy mass: the moss glow made it look flat and haloed, so it gets only a touch
    addGrassGlow(door.mat, 1, true, B.doorGlow || { ...B.glow, amt: B.glow.amt * 0.15 });
    // the cave's mushroom door: the mushrooms above the stone keep their own colors (teal, violet, pink) pushed to
    // fluorescent, and glow; a soft wave of light runs up the stalks into the caps, which shine brightest
    if (B.doorPlant) {
      const base = door.mat.onBeforeCompile;
      door.mat.onBeforeCompile = (sh, rr) => {
        base(sh, rr);
        sh.uniforms.uGlowTime = GLOW_TIME;
        sh.vertexShader = 'varying float vPlantY;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlantY = position.y;');
        sh.fragmentShader = 'uniform float uGlowTime;\nvarying float vPlantY;\nvec3 neonOf(vec3 c) { float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)); vec3 h = (c - mn) / max(mx - mn, 1e-3); h.g *= 0.85; return h * 1.15 + 0.04; }\n' + sh.fragmentShader
          .replace('#include <map_fragment>', '#include <map_fragment>\nfloat pl = smoothstep(0.01, 0.06, vPlantY); vec3 neon = neonOf(diffuseColor.rgb); diffuseColor.rgb = mix(diffuseColor.rgb, neon * 0.3, pl);')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          { float up = smoothstep(0.05, 0.45, vPlantY);
            float wave = 0.5 + 0.5 * sin(uGlowTime * 2.4 - vPlantY * 14.0);
            totalEmissiveRadiance += neon * neon * neon * pl * (0.2 + 0.45 * up + 0.3 * wave) * (0.85 + 0.15 * sin(uGlowTime * 1.3)); }`);
      };
      door.mat.customProgramCacheKey = () => 'door-neon';
    }
    return (stoneSets[name] = { variants, wallMats, floorMat: null, B, door, rockRef, mossRef });
  })();
}

async function load() {
  const loader = new GLB();
  const cg = { scene: (await loadChar('buddy')).scene };
  charCache.buddyLoaded = await loadChar('buddy');
  const woods = await stoneSet('woods');
  const slab = -CFG.clipY;
  const floorGeo = new THREE.BoxGeometry(CFG.tileW, slab, CFG.tileW).translate(0, -slab / 2, 0);
  const shadowGeo = new THREE.PlaneGeometry(CFG.tileW, CFG.tileW).rotateX(-Math.PI / 2).translate(0, 0.002, 0);
  const shadowMat = new THREE.ShadowMaterial({ color: '#6b5640', opacity: 0.16, depthWrite: false });
  assets = { floorGeo, shadowGeo, shadowMat, char: cg.scene, rockRef: woods.rockRef, mossRef: woods.mossRef };
}

let mode = 'levels', start = [0, 0], goal = [1, 1], rivals = [], raceSize = 3, raceTeam = false, keyDist = null;
// race setup, saved on this device: how many Buddies (2-4, one per corner), how many are your teammates, rival speed
const raceCfg = { racers: 3, mates: 0, speed: 1, biome: 'woods', shape: 'square', size: 2, mode: 'ffa', bots: false };
try { Object.assign(raceCfg, JSON.parse(localStorage.getItem('hidden-maze-race') || '{}')); } catch {}
const RIVAL_PACE = [{ step: 2.2, detour: 0.42 }, { step: 1.8, detour: 0.3 }, { step: 1.45, detour: 0.18 }, { step: 1.2, detour: 0.07 }]; // easy, normal, hard, pro
// every two race wins the race maze grows (10 -> 16 cells)
let raceWins = 0;
try { raceWins = +localStorage.getItem('hidden-maze-race-wins') || 0; } catch {}
// race: a big maze with an entry near each corner and one key in the middle
function makeRaceMaze(rnd = Math.random, shape = raceCfg.shape, cells = 10 + 2 * Math.min(3, Math.floor(raceWins / 2))) {
  let m, N, d, ends;
  // mirrored maze: all four entries are the same distance from the key (retry if the middle isn't reachable)
  for (let tries = 0; tries < 30; tries++) {
    m = genFairRaceMaze(cells, rnd, shape); N = m.N;
    if (shape === 'square') {
      ends = [[N - 2, N - 1], [1, N - 1], [N - 2, 0], [1, 0]];
      for (const [x, z] of ends) m.g[z * N + x] = 0;
    } else { // in a shape, everyone starts on the open tile furthest from the middle in their own quarter
      let best = null, bd = -1; const H = (N - 1) / 2;
      for (let z = 0; z < H; z++) for (let x = 0; x < H; x++) if (!m.g[z * N + x]) { const dd = (x - H) ** 2 + (z - H) ** 2; if (dd > bd) { bd = dd; best = [x, z]; } }
      const [ex, ez] = best || [1, 1];
      ends = [[N - 1 - ex, N - 1 - ez], [ex, N - 1 - ez], [N - 1 - ex, ez], [ex, ez]];
    }
    d = shortestPath(m, ends[0][0], ends[0][1], (N - 1) / 2, (N - 1) / 2);
    if (d > 10) break;
  }
  // yours is nearest the camera; with 3 racers the rivals take the two side corners, with 2 the far one;
  // in a team race your teammate starts in the far corner (listed last)
  const entries = raceSize === 2 ? [ends[0], ends[3]] : raceSize === 3 ? [ends[0], ends[1], ends[2]] : ends;
  return { maze: m, entries, goal: [(N - 1) / 2, (N - 1) / 2], cells };
}
// ---------- door levels ----------
// Door levels (see the level plan) are split in two: no way across on the surface. A door block in your half leads down
// to a small cave maze; a door there brings you back up in the key's half (like Mario's pipes).
const levelCells = L => levelPlan(L).cells;
const isGateway = L => L >= 0 && levelPlan(L).gateway;
const keyDetour = L => levelPlan(L).detour;
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
  if (PHONE) tiltV.uniforms.grade.value.set(...({ desert: [1.07, 1.0, 0.91], snow: [0.96, 1.0, 1.06], cave: [1, 1, 1] }[name] || [1.05, 1.01, 0.95]), name === 'cave' ? 0.1 : 0.2);
  atmosphere.setDust(B.dust, B.dark);
  atmosphere.setWeather(name);
  // dust in this level's rock color, a little lighter (dust reads paler than the stone), in four shades
  const rc = (curSet && curSet.rockRef) || [200, 190, 170];
  STONE_DUST = [1.18, 1.08, 1.28, 0.98].map(k => '#' + new THREE.Color().setRGB(...rc.map(v => Math.min(255, v * k) / 255), THREE.SRGBColorSpace).getHexString());
  sfx.setBiome(name);
  puffMat.opacity = B.dark ? 0.8 : 1;
}
// a finished level's own objects (portal stones, key, stone tops, ground) are freed from the GPU when the next one is
// built; the stone sets' shared materials and textures stay
function freeTree(o) {
  const keep = new Set(); for (const set of Object.values(stoneSets)) if (set && set.wallMats) { set.wallMats.forEach(m => keep.add(m)); keep.add(set.floorMat); if (set.door) keep.add(set.door.mat); }
  o.traverse(c => {
    if (c.geometry && !c.geometry.userData.shared) c.geometry.dispose();
    for (const m of c.material ? [].concat(c.material) : []) if (!keep.has(m)) { for (const k of ['map', 'alphaMap', 'emissiveMap']) if (m[k] && !m[k].userData.shared) m[k].dispose(); m.dispose(); }
  });
}
// A world's stone meshes are built the first time one of its levels is played and then reused by every level after
// it (only rebuilt, larger, if a maze is bigger than any before). Rebuilding them per level made phones send every
// stone to the graphics chip again each level; iPhones don't hand that memory back quickly and closed the page.
const WHITE = new THREE.Color(1, 1, 1);
const roomFor = T => Math.max(625, Math.ceil(T * 1.25)); // a little headroom so the next, bigger maze fits too
function setMeshes(set, T) {
  if (set.meshes && set.meshes.room >= T) return set.meshes;
  if (set.meshes) for (const m of [...set.meshes.walls, ...set.meshes.caps]) m.dispose(); // (frees only their instance data)
  const room = roomFor(T);
  const walls = set.variants.map((v, i) => {
    const m = new THREE.InstancedMesh(v.raw, set.wallMats[i], room);
    m.castShadow = true;
    return m;
  });
  // flat stones near the camera are drawn as the real stone top (no flattening); far ones use the lighter picture
  const caps = set.variants.map((v, i) => {
    const geo = new THREE.BufferGeometry();
    geo.setIndex(v.cap.index);
    for (const k in v.cap.attributes) geo.setAttribute(k, v.cap.attributes[k]);
    geo.boundingSphere = v.cap.boundingSphere; geo.boundingBox = v.cap.boundingBox;
    geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(room), 1));
    const m = new THREE.InstancedMesh(geo, set.wallMats[i], room);
    m.receiveShadow = true;
    return m;
  });
  for (const m of [...walls, ...caps]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, WHITE); }
  return (set.meshes = { walls, caps, room });
}
// the flat tiles' pictures and their soft shadows: one pair for every world (each world swaps in its own atlas)
let floorRoom = 0;
function floorMeshes(T) {
  if (floorRoom >= T) return;
  if (floor) { scene.remove(floor, floorShadow); floor.dispose(); floorShadow.dispose(); }
  floorRoom = roomFor(T);
  if (assets.floorGeo.attributes.aVar) assets.floorGeo.dispose(); // (the old, smaller per-tile attribute leaves the GPU)
  assets.floorGeo.setAttribute('aVar', new THREE.InstancedBufferAttribute(new Float32Array(floorRoom), 1));
  floor = new THREE.InstancedMesh(assets.floorGeo, floorMatOf(curSet), floorRoom);
  floorShadow = new THREE.InstancedMesh(assets.shadowGeo, assets.shadowMat, floorRoom);
  floorShadow.receiveShadow = true;
  for (const m of [floor, floorShadow]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
  floor.setColorAt(0, WHITE);
}
// the cave doors' mushroom glow: two lights that always stay in the scene (dark when unused), because adding or
// removing a light makes the browser rebuild every material's shader, a long stall on phones
const doorLights = [0, 1].map(() => { const l = new THREE.PointLight('#c77dff', 0, 3, 1.5); scene.add(l); return l; });
// the other worlds' stones leave the GPU while you play (three.js uploads them again by itself if the map shows
// them later), so only the level's own world is held in graphics memory
function trimGPU() { // (every device: laptops held ~110 MB per world visited otherwise)
  for (const [b, set] of Object.entries(stoneSets)) {
    if (!set || !set.variants || set === curSet || b === 'cave') continue;
    for (const m of [...(set.wallMats || []), set.door && set.door.mat]) if (m) for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
    if (set.floorMat) { new Set(set.floorMat.map(m => m.map)).forEach(t => t.userData.rt.dispose()); set.floorMat = null; } // (a render target: baked again on return)
    for (const v of set.variants) { if (v.raw) v.raw.dispose(); if (v.cap) v.cap.dispose(); }
    if (set.door && set.door.raw) set.door.raw.dispose();
  }
}
function buildLevel(level, race = null, opts = {}) {
  L = level; mode = race ? 'race' : 'levels'; pillarsDirty = true;
  stage = opts.stage || 'surface';
  const world = race ? (WORLDS.find(w => w.biome === race.biome) || { tint: [1, 1, 1], reveal: 2.1, icon: 'i-w-cave' }) : WORLDS[Math.floor(L / LEVELS_PER_WORLD)];
  const bName = race ? race.biome || 'woods' : stage === 'cave' ? 'cave' : world.biome;
  curSet = stoneSets[bName];
  applyBiome(bName);
  scene.remove(...walls, ...caps); // (the previous world's meshes stay built for next time)
  for (const l of doorLights) { l.intensity = 0; scene.add(l); } // back from the old doors: the scene keeps its light count
  for (const m of doorMeshes.values()) scene.remove(m);
  doorMeshes.clear();
  const shape = race || isGateway(L) ? null : levelPlan(L).shape;
  const rnd = mulberry32(L * 9973 + 17);
  maze = race ? race.maze : stage === 'cave' ? genCaveMaze(L) : isGateway(L) ? genSplitMaze(levelCells(L), rnd) : shape ? genShapedMaze(levelCells(L), rnd, shape) : genMaze(levelCells(L), rnd);
  // within a world you see less of the maze around you as the levels go on
  CFG.revealR = parseFloat(params.get('r') || (race ? world.reveal : levelPlan(L).reveal));
  const { N } = maze, T = N * N;
  origin = (N - 1) / 2;
  heights = new Float32Array(T); vels = new Float32Array(T); targets = new Float32Array(T); shake = new Float32Array(T);
  varIdx = Uint8Array.from({ length: T }, () => Math.floor(Math.random() * curSet.variants.length));
  rotIdx = Uint8Array.from({ length: T }, () => Math.floor(Math.random() * 4));
  // hand-placed look: each stone slightly twisted and nudged
  twist = new Float32Array(T); // stones stay square to the grid
  nudge = Float32Array.from({ length: T * 2 }, () => rand(-0.012, 0.012));
  tint = [];
  for (let i = 0; i < T; i++) { const v = rand(0.92, 1); tint.push(new THREE.Color(v * world.tint[0], v * world.tint[1], v * world.tint[2])); }
  tileGlow = new Float32Array(T);
  ({ walls, caps } = setMeshes(curSet, T));
  floorMeshes(T);
  floor.material = floorMatOf(curSet);
  scene.add(...walls, ...caps);
  // door blocks: their own meshes, rising and sinking with their tile; the cave mouth faces the side you come from
  for (const d of maze.doors || []) {
    const m = new THREE.Mesh(curSet.door.raw, curSet.door.mat);
    m.castShadow = true;
    m.rotation.y = curSet.door.yaw + Math.atan2(-(d.out[1] - d.z), d.out[0] - d.x); // cave mouth toward the side you arrive from
    m.userData = d;
    if (bName === 'cave' && doorMeshes.size < doorLights.length) { // the glowing mushrooms light the stones around them
      const glow = doorLights[doorMeshes.size];
      glow.intensity = 1.4; glow.position.set(0, 0.7, 0); m.add(glow);
      const halo = new THREE.Sprite(doorHaloMat); // a soft magical haze around the mushrooms
      halo.position.y = 0.55; halo.scale.setScalar(1.6); m.add(halo);
    }
    scene.add(m);
    doorMeshes.set(d.z * N + d.x, m);
  }
  placeScenery();
  if (mazeGrass) mazeGrass.visible = false;
  // every biome's own ground, faded out around the maze (grass, sand, snow, golden grass, dark cave rock)
  buildMazeGrass(groundTexture(bName), bName === 'cave' ? 0.7 : bName === 'snow' ? 0.75 : 0.85);
  key ||= makeKey(); // one key for the whole game
  key.userData.wt = 0; key.scale.setScalar(1);
  start = opts.spawn || (race ? race.entries[0] : maze.start || [N - 2, N - 2]);
  goal = race ? race.goal : stage === 'cave' ? [-9, -9] : maze.goal || [1, 1]; // the portal (none in the cave)
  if (!opts.keep) hasKey = false;
  // the key: in a race it's the prize in the middle; on a door level it waits in the cave; elsewhere down a side path
  keyAt = race ? goal : isGateway(L) ? (stage === 'cave' ? keyTile(maze, maze.doors[0].out, maze.doors[1].out, keyDetour(L)) : null) : keyTile(maze, start, goal, keyDetour(L));
  key.visible = !!keyAt && !hasKey;
  key.userData.grab = -1;
  if (keyAt) key.position.set(keyAt[0] - origin, 0.55, keyAt[1] - origin);
  scene.add(key);
  if (portal) scene.remove(portal);
  portal = curSet.portal ||= makePortal(curSet, bName); // built once per world from its stones, then reused
  portal.visible = !race && stage !== 'cave';
  portal.position.set(goal[0] - origin, 0, goal[1] - origin);
  portal.rotation.y = portalYaw(goal);
  portal.userData.on = hasKey ? 1 : 0;
  scene.add(portal);
  trimGPU();
  if (renderer.compileAsync) renderer.compileAsync(scene, camera).catch(() => {}); // (shaders ready before you start walking)
  $('keyHud').style.display = race ? 'none' : '';
  $('keyHud').classList.toggle('got', hasKey);

  st.gx = st.tx = st.fx = start[0]; st.gz = st.tz = st.fz = start[1];
  st.t = 1; st.moving = false;
  if (!opts.keep) { st.facing = -Math.PI / 4; steps = 0; elapsed = 0; }
  won = false; heldDir = queued = null;
  if (opts.keep) { /* stats carry over through the doors */ }
  else if (isGateway(L) && !race) { // best path: to door A, through the cave by way of the key, then from door B to the portal
    const [a, b] = maze.doors, cave = genCaveMaze(L), [ca, cb] = cave.doors, k = keyTile(cave, ca.out, cb.out, keyDetour(L));
    optimal = shortestPath(maze, start[0], start[1], a.out[0], a.out[1]) + shortestPath(cave, ca.out[0], ca.out[1], k[0], k[1]) + shortestPath(cave, k[0], k[1], cb.out[0], cb.out[1]) + shortestPath(maze, b.out[0], b.out[1], goal[0], goal[1]) + 4;
  } else optimal = race ? shortestPath(maze, start[0], start[1], goal[0], goal[1]) : shortestPath(maze, start[0], start[1], keyAt[0], keyAt[1]) + shortestPath(maze, keyAt[0], keyAt[1], goal[0], goal[1]);
  ui.level.textContent = race ? 'RACE' : `${Math.floor(L / LEVELS_PER_WORLD) + 1}-${L % LEVELS_PER_WORLD + 1}`;
  ui.steps.textContent = steps;
  $('worldBadgeIco').setAttribute('href', '#' + (stage === 'cave' || bName === 'cave' ? 'i-w-cave' : world.icon));
  coach.level(race ? -1 : L, stage, opts.keep);
  for (const r of rivals) { scene.remove(r.root); r.root.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.dispose()); }); } // (their textures are shared)
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
  rivals = race ? race.entries.slice(1).map((e, i) => makeRival(e, race.online ? race.others[i].skin : RIVAL_SKINS.filter(c => c !== skin)[i], race.online ? race.others[i].ch : undefined)) : [];
  // your friends are moved by the network; computer Buddies are run by the host (and sent to everyone)
  if (race && race.online) rivals.forEach((r, i) => { const o = race.others[i]; r.pid = o.pid; r.team = o.team; r.bot = o.bot; r.remote = !(o.bot && race.host); });
  for (let k = 0; race && !race.online && k < raceCfg.mates; k++) rivals[rivals.length - 1 - k].team = true; // your teammates (the far corners first)
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
  arch: { size: [3.0, 4.4], sink: [0.1, 0.22], count: PHONE ? 3 : 6, gap: 6, inner: 3.4, outer: 11 }, // (phones: fewer, it's background)
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
  const loader = new GLB();
  for (const [n, kind] of PHONE ? SCENERY.slice(0, 4) : SCENERY) { // (phones: 4 ruin models, not 9; they're far, hazy background)
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
      if (PHONE && geo.index) simplifyGeo(geo, Math.min(1, 9000 / geo.index.count), 0.03); // far and hazy: ~3k triangles is plenty
      const map = canvasTexture(pm.material.map, 512);
      const orig = document.createElement('canvas'); orig.width = map.image.width; orig.height = map.image.height;
      orig.getContext('2d').drawImage(map.image, 0, 0); // kept untouched: each biome recolors its own copy
      matchRock(map, assets.rockRef, 0.7);
      matchMoss(map, assets.mossRef);
      const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, clippingPlanes: groundClip });
      addGrassGlow(mat, 1);
      sceneryModels[kind].push({ geo, mat, orig, mats: { woods: mat }, h: (bb.max.y - bb.min.y) * s });
      if (maze) placeScenery();
    } catch (e) { console.warn('scenery', url, e); }
  }
}
// grass cut from the open meadow in the middle of the painted map
const meadow = document.createElement('canvas'); meadow.width = meadow.height = 256;
const meadowReady = new Promise(res => {
  const img = new Image();
  img.onload = () => { meadow.getContext('2d').drawImage(img, 470, 640, 400, 400, 0, 0, 256, 256); meadow.dataset.ok = '1'; res(); };
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
const grassMask = document.createElement('canvas'); grassMask.width = grassMask.height = 512;
const grassTex = new Map(); // ground pattern canvas -> its texture (one per world, made once)
function buildMazeGrass(pattern, opacity = 0.85, spread = 2.4, dab = 0.22) {
  // the same mesh, mask and textures every level: only the mask is redrawn (no new GPU textures per level)
  const { N } = maze, M = N + 10, c = grassMask, PX = c.width, k = PX / M;
  const x = c.getContext('2d');
  x.globalCompositeOperation = 'source-over';
  x.fillStyle = '#000'; x.fillRect(0, 0, PX, PX);
  // soft brush dabs on every tile of the maze build up the shape, feathering out past its edges
  for (let z = 0; z < N; z++) for (let gx = 0; gx < N; gx++) {
    if (maze.empty && maze.empty[z * N + gx]) continue;
    const cx = (gx + 5.5) * k, cy = (z + 5.5) * k, r = spread * k;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${dab})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  let tex = grassTex.get(pattern);
  if (!tex) { tex = new THREE.CanvasTexture(pattern); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 8; grassTex.set(pattern, tex); } // fine, never blurry
  tex.repeat.set(M / 3.2, M / 3.2);
  if (mazeGrass) {
    mazeGrass.material.map = tex; mazeGrass.material.opacity = opacity;
    mazeGrass.material.alphaMap.needsUpdate = true;
    mazeGrass.scale.set(M, 1, M); mazeGrass.visible = true;
    return;
  }
  mazeGrass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tex, alphaMap: new THREE.CanvasTexture(c), transparent: true, opacity, depthWrite: false, toneMapped: false }));
  mazeGrass.scale.set(M, 1, M);
  mazeGrass.position.set(0, GROUND_Y + 0.003, 0);
  mazeGrass.renderOrder = 1;
  mazeGrass.layers.set(1);
  scene.add(mazeGrass);
}
// the old ruins in each biome's own colors: the stone takes the biome's rock color, and the moss becomes snow on the
// peaks, orange in the autumn grove and dry grass in the dunes
const DECOR_MOSS = { desert: [196, 178, 108], snow: [238, 242, 249], autumn: [216, 130, 58] };
function decorMat(m, b) {
  if (m.mats[b]) return m.mats[b];
  const set = stoneSets[b]; if (!set) return m.mat;
  const c = document.createElement('canvas'); c.width = m.orig.width; c.height = m.orig.height;
  c.getContext('2d', { willReadFrequently: true }).drawImage(m.orig, 0, 0);
  const map = new THREE.CanvasTexture(c); map.flipY = m.mat.map.flipY; map.colorSpace = m.mat.map.colorSpace; map.anisotropy = 4;
  const keep = MOSS; MOSS = { hue: 0.27, width: 0.1 }; // the scans' moss is green, whatever the biome
  matchRock(map, set.rockRef, 0.85);
  tintRock(map, set.rockRef, 0.6, 0.7);
  if (DECOR_MOSS[b]) tintMoss(map, DECOR_MOSS[b]); else if (set.mossRef) matchMoss(map, set.mossRef);
  MOSS = keep;
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, clippingPlanes: groundClip });
  addGrassGlow(mat, 1, false, b === 'snow' ? { hue: 0.6, width: 0.01, amt: 0 } : BIOMES[b].glow);
  return (m.mats[b] = mat);
}
// the soft patch of ground under each ruin, in the biome's own ground
const patchMats = {};
function patchMat(b) {
  if (patchMats[b]) return patchMats[b];
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.drawImage(groundTexture(b), 0, 0, 256, 256);
  x.globalCompositeOperation = 'destination-in';
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,.9)'); g.addColorStop(0.3, 'rgba(0,0,0,.55)'); g.addColorStop(0.65, 'rgba(0,0,0,.15)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return (patchMats[b] = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
}
// each arch slot keeps its hazed material per model and world: made once, reused by every level (making and freeing
// them per level made the phone compile their shaders again each time)
const hazeMats = {};
function placeScenery() {
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
      const mi = Math.floor(rnd() * models.length), m = models[mi];
      const mat = hazeMats[`${kind}${mi}|${biome}|${placed}`] ||= (() => {
        const base = decorMat(m, biome), mm = base.clone();
        mm.onBeforeCompile = base.onBeforeCompile;
        addHaze(mm);
        return mm;
      })();
      const h = m.h * size, sink = K.sink[0] + rnd() * (K.sink[1] - K.sink[0]);
      mat.userData.haze.uHazeTop.value = h * (1 - sink) * 0.1; // the grass patch carries the fade now; just soften the very base
      const mesh = new THREE.Mesh(m.geo, mat);
      mesh.scale.setScalar(size);
      mesh.rotation.y = rnd() * Math.PI * 2;
      mesh.position.set(x, GROUND_Y - h * sink, z);
      mesh.layers.set(1);
      sceneryGroup.add(mesh);
      const patch = new THREE.Mesh(grassPatch.geo, patchMat(biome));
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
  if (silhouette && charId === 'buddy') silhouette.traverse(o => { if (o.isMesh) o.material.color.set(SKINS[i]); });
  try { localStorage.setItem('hidden-maze-skin', i); } catch {}
  [...$('skins').children].forEach((b, k) => b.classList.toggle('on', k === i));
}
$('skins').innerHTML = SKINS.map((c, i) => `<button style="--c:${c}" aria-label="Outfit color ${i + 1}"></button>`).join('');
$('skins').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  setSkin([...$('skins').children].indexOf(b));
});

// ---------- characters ----------
// Buddy and four animal friends, one unlocked with each world (all open for now). The animal scans stand facing +Z in a
// T-pose; they are baked into Buddy's own space (facing +X, height -0.5..0.5) and their hips, shoulders and arms are
// measured, so the same walk, idle and bump animations drive every character.
const CHARS = [
  { id: 'buddy', name: 'Buddy', file: 'assets/character.glb', world: -1 },
  { id: 'frog', name: 'Frog', file: 'assets/chars/frog.glb', world: 0 },
  { id: 'fennec', name: 'Fennec', file: 'assets/chars/fennec.glb', world: 1 },
  { id: 'bear', name: 'Polar Bear', file: 'assets/chars/bear.glb', world: 2 },
  { id: 'cat', name: 'Cat', file: 'assets/chars/cat.glb', world: 3 },
];
const CHARS_ALL_OPEN = true; // for now every character is unlocked
const charUnlocked = c => CHARS_ALL_OPEN || c.world < 0 || unlocked(c.world * LEVELS_PER_WORLD);
const BUDDY_P = { hip: -0.28, sho: 0.03, armZ: 0.14, drop: 0.28, top: 0.08, bot: -0.36, neck: 0.06, ears: 0 };
let charId = 'buddy';
try { charId = localStorage.getItem('hidden-maze-char') || 'buddy'; } catch {}
const charCache = {};
function loadChar(id) {
  const C = CHARS.find(c => c.id === id) || CHARS[0];
  return charCache[C.id] ||= new GLB().loadAsync(C.file).then(g => {
    if (PHONE) g.scene.traverse(o => { if (o.isMesh && o.material.map && o.material.map.image && o.material.map.image.width > 1024) o.material.map = canvasTexture(o.material.map, 2048); if (o.isMesh) o.material.metalnessMap = o.material.roughnessMap = null; });
    if (C.id === 'buddy') return { id: 'buddy', scene: g.scene, P: BUDDY_P };
    g.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g.scene), h = box.max.y - box.min.y;
    const M = new THREE.Matrix4().makeScale(1 / h, 1 / h, 1 / h).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))
      .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y - h / 2, -(box.min.z + box.max.z) / 2));
    const root = new THREE.Group(), pts = [];
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld).applyMatrix4(M), mat = o.material.clone();
      mat.metalness = 0; mat.roughness = Math.max(0.65, mat.roughness ?? 1);
      root.add(new THREE.Mesh(geo, mat));
      const P = geo.attributes.position; for (let i = 0; i < P.count; i++) pts.push(P.getX(i), P.getY(i), P.getZ(i));
    });
    const P = measureBody(pts);
    Object.assign(P, poseArms(root.children.map(m => m.geometry)));
    return { id: C.id, scene: root, P };
  });
}
// smooth shading for low-poly models: every vertex takes the average normal of all the corners at its position
// (texture seams split vertices, so they are matched by position, not by index)
function smoothNormals(geo) {
  const g = geo.clone(), P = g.attributes.position, sum = new Map(), key = i => `${Math.round(P.getX(i) * 1e4)},${Math.round(P.getY(i) * 1e4)},${Math.round(P.getZ(i) * 1e4)}`;
  const flat = g.index ? g.toNonIndexed() : g; // face normals from the triangles
  const FP = flat.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < FP.count; i += 3) {
    a.fromBufferAttribute(FP, i); b.fromBufferAttribute(FP, i + 1); c.fromBufferAttribute(FP, i + 2);
    n.subVectors(c, b).cross(a.clone().sub(b)); // area-weighted
    for (const v of [a, b, c]) { const k = `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`; const s = sum.get(k); if (s) s.add(n); else sum.set(k, n.clone()); }
  }
  const N = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) { const s = sum.get(key(i)); if (s) { s.clone().normalize().toArray(N, i * 3); } }
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  return g;
}
// The animals come T-posed. Each arm is found by growing outward from its paw over the mesh (so the head is never
// caught), then lowered once as a rigid piece turning at the top of the shoulder: it keeps its own thickness, the
// armpit folds away inside the body, and it hangs as low as it can without sinking into the belly.
function poseArms(geos) {
  const key = (x, y, z) => `${Math.round(x * 2e3)},${Math.round(y * 2e3)},${Math.round(z * 2e3)}`;
  const V = [], ids = new Map(), vid = [], adj = [];
  geos.forEach((g, gi) => {
    const P = g.attributes.position; vid[gi] = new Int32Array(P.count);
    for (let i = 0; i < P.count; i++) {
      const k = key(P.getX(i), P.getY(i), P.getZ(i));
      let id = ids.get(k); if (id === undefined) { id = V.length; ids.set(k, id); V.push([P.getX(i), P.getY(i), P.getZ(i)]); adj.push(new Set()); }
      vid[gi][i] = id;
    }
    const ix = g.index ? g.index.array : null, n = ix ? ix.length : P.count;
    for (let t = 0; t < n; t += 3) {
      const a = vid[gi][ix ? ix[t] : t], b = vid[gi][ix ? ix[t + 1] : t + 1], c = vid[gi][ix ? ix[t + 2] : t + 2];
      adj[a].add(b).add(c); adj[b].add(a).add(c); adj[c].add(a).add(b);
    }
  });
  const W = new Float32Array(V.length), sides = [];
  for (const s of [1, -1]) {
    let maxU = 0; for (const v of V) if (v[1] < 0.12) maxU = Math.max(maxU, s * v[2]);
    let yLo = 1, yHi = -1; // the forearm and paw
    for (const v of V) if (v[1] < 0.12 && s * v[2] > maxU * 0.75) { yLo = Math.min(yLo, v[1]); yHi = Math.max(yHi, v[1]); }
    let zR = 0; // the arm meets the body as wide as the belly is just under the armpit
    for (const v of V) if (v[1] > yLo - 0.05 && v[1] < yLo - 0.01 && Math.abs(v[0]) < 0.12) zR = Math.max(zR, s * v[2]);
    const yTop = yHi + 0.05, inArm = new Uint8Array(V.length), stack = [];
    V.forEach((v, i) => { if (s * v[2] > maxU * 0.9 && v[1] < 0.12) { inArm[i] = 1; stack.push(i); } });
    while (stack.length) for (const j of adj[stack.pop()]) if (!inArm[j] && s * V[j][2] > zR && V[j][1] < yTop) { inArm[j] = 1; stack.push(j); }
    let rootTop = yLo; V.forEach((v, i) => { if (inArm[i] && s * v[2] < zR + 0.05) rootTop = Math.max(rootTop, v[1]); });
    const h = Math.max(0.04, rootTop - yLo), yP = rootTop - h * 0.15, uP = zR - h * 0.2;
    V.forEach((v, i) => { if (inArm[i]) W[i] = s * Math.min(1, Math.max(0, (s * v[2] - zR) / 0.008)); });
    // the body's width at each height (beside the arm), so the arm can lie along it
    const T0 = new Float32Array(60 * 20).fill(-1), T = new Float32Array(60 * 20).fill(-1); // (height, depth) bins
    V.forEach((v, i) => { if (!inArm[i] && v[1] < yLo + 0.02) { const b = Math.floor((v[1] + 0.6) * 50), xb = Math.floor((v[0] + 0.4) * 25); if (b >= 0 && b < 60 && xb >= 0 && xb < 20) T0[b * 20 + xb] = Math.max(T0[b * 20 + xb], s * v[2]); } });
    for (let b = 0; b < 60; b++) for (let xb = 0; xb < 20; xb++) { let m = -1; for (let db = -1; db <= 1; db++) for (let dx = -1; dx <= 1; dx++) { const bb = b + db, xx = xb + dx; if (bb >= 0 && bb < 60 && xx >= 0 && xx < 20) m = Math.max(m, T0[bb * 20 + xx]); } T[b * 20 + xb] = m; }
    sides.push({ s, yP, uP, T, h, len: maxU - zR });
  }
  // each arm swings down as one rigid piece (never bent, so it keeps its own shape), and a little forward if that lets
  // it hang lower, until it rests against the body: it may press into the soft tummy a little, never sink in
  // (the forearm also bends in at a soft elbow, half way down: the upper arm leans out a little and the paw comes back
  // in to rest by the tummy, the relaxed bow of a plush toy's arm)
  const BEND = 0.7, ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const NV = V.map(v => v.slice()), rot = (S, a, f, v) => {
    const du = S.s * v[2] - S.uP, dy = v[1] - S.yP;
    let u = S.uP + du * Math.cos(a) + dy * Math.sin(a), dy2 = -du * Math.sin(a) + dy * Math.cos(a);
    const el = S.len * 0.5, b = BEND * ss(el - 0.04, el + 0.04, du) * Math.min(1, a / 0.7);
    if (b) {
      const ey = -S.h * 0.45, eu = S.uP + el * Math.cos(a) + ey * Math.sin(a), ed = -el * Math.sin(a) + ey * Math.cos(a);
      const pu = u - eu, pd = dy2 - ed;
      u = eu + pu * Math.cos(b) + pd * Math.sin(b); dy2 = ed - pu * Math.sin(b) + pd * Math.cos(b);
    }
    return [u, S.yP + v[0] * Math.sin(f) + dy2 * Math.cos(f), v[0] * Math.cos(f) - dy2 * Math.sin(f), du, b];
  };
  const pose = S => {
    const arm = []; V.forEach((v, i) => { if (W[i] * S.s > 0.99) arm.push(i); });
    for (let a = 1.1; a >= 0.6; a -= 0.02) for (let f = 0; f <= 0.42; f += 0.06) {
      let pen = 0;
      for (const i of arm) {
        const [u, y, x, du] = rot(S, a, f, V[i]); if (du < S.len * 0.45) continue; // (the armpit end may tuck into the body)
        const b = Math.floor((y + 0.6) * 50), xb = Math.floor((x + 0.4) * 25);
        if (b >= 0 && b < 60 && xb >= 0 && xb < 20 ) { const t = S.T[b * 20 + xb]; if (t > 0) pen = Math.max(pen, t - u); }
        if (pen > S.h * 0.3) break;
      }
      if (pen <= S.h * 0.3) return [a, f];
    }
    return [0.7, 0];
  };
  const P0 = pose(sides[0]), P1 = pose(sides[1]), ang = Math.min(P0[0], P1[0]), fwd = Math.max(P0[0] <= P1[0] ? P0[1] : P1[1], 0); // both arms alike
  for (const S of sides) {
    S.ang = ang; S.fwd = fwd;
    S.bend = []; V.forEach((v, i) => { const w = W[i] * S.s; if (w > 0) { const r = rot(S, ang * w, fwd * w, v); NV[i][0] = r[2]; NV[i][1] = r[1]; NV[i][2] = S.s * r[0]; S.bend[i] = r[4] * w; } });
  }
  const sd = sides[0], sw = sides[1];
  geos.forEach((g, gi) => {
    const P = g.attributes.position, N = g.attributes.normal, A = new Float32Array(P.count);
    for (let i = 0; i < P.count; i++) {
      const id = vid[gi][i], w = W[id]; A[i] = w; if (!w) continue;
      P.setXYZ(i, NV[id][0], NV[id][1], NV[id][2]);
      if (N) { const s = Math.sign(w), S = sides[w > 0 ? 0 : 1], a = S.ang * Math.abs(w) + (S.bend[id] || 0), f = S.fwd * Math.abs(w), nu = s * N.getZ(i), ny = N.getY(i), nx = N.getX(i), ny2 = -nu * Math.sin(a) + ny * Math.cos(a); N.setXYZ(i, nx * Math.cos(f) - ny2 * Math.sin(f), nx * Math.sin(f) + ny2 * Math.cos(f), s * (nu * Math.cos(a) + ny * Math.sin(a))); }
    }
    P.needsUpdate = true; if (N) N.needsUpdate = true;
    g.setAttribute('aArm', new THREE.BufferAttribute(A, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
  });
  return { baked: 1, drop: 0, sho: (sd.yP + sw.yP) / 2, armZ: (sd.uP + sw.uP) / 2, len: Math.max(0.15, (sd.len + sw.len) / 2), ang: (sd.ang + sw.ang) / 2 };
}
// where a T-posed body's parts are: arms are the parts furthest out sideways, the torso just under them, and the hip
// is where the legs meet (the lowest point on the middle line, front half, so a tail doesn't count)
function measureBody(pts) {
  let maxZ = 0, ys = [], tz = 0, lo = 1;
  // (only below the head: a fennec's big ears stick out further than its arms)
  for (let i = 0; i < pts.length; i += 3) if (pts[i + 1] < 0.12) maxZ = Math.max(maxZ, Math.abs(pts[i + 2]));
  for (let i = 0; i < pts.length; i += 3) if (pts[i + 1] < 0.12 && Math.abs(pts[i + 2]) > maxZ * 0.75) ys.push(pts[i + 1]);
  const sho = ys.reduce((a, b) => a + b, 0) / Math.max(1, ys.length) + 0.02;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = Math.abs(pts[i + 2]);
    if (y > sho - 0.17 && y < sho - 0.09) tz = Math.max(tz, z);
    if (z < 0.02 && x > -0.05 && y > -0.47) lo = Math.min(lo, y);
  }
  const armZ = Math.min(tz * 1.03, maxZ * 0.6);
  return { hip: Math.max(-0.42, Math.min(-0.18, lo)), sho, armZ, drop: 1.18, top: sho + 0.1, bot: sho - 0.15, neck: sho + 0.07, ears: 1 };
}

// ---------- player ----------
// procedural walk: the model has no skeleton, so legs and arms are swung in the vertex shader.
// Values are in the model's own space: height -0.5..0.5, facing +X, legs/arms split along Z.
const walkU = { uPhase: { value: 0 }, uAmp: { value: 0 }, uHurt: { value: 0 }, uHurtWig: { value: 0 }, uWave: { value: 0 }, uWaveT: { value: 0 } };
const newWalkU = () => ({ uPhase: { value: 0 }, uAmp: { value: 0 }, uHurt: { value: 0 }, uHurtWig: { value: 0 }, uWave: { value: 0 }, uWaveT: { value: 0 } });
function addWalk(mat, { outline = 0, outfit = false, U = walkU, T = TINT, P = BUDDY_P, key = 'buddy' } = {}) {
  const f = v => v.toFixed(3);
  mat.onBeforeCompile = sh => {
    if (outfit) addOutfit(sh, true, T);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = (P.baked ? 'attribute float aArm;\n' : '') + 'uniform float uPhase;\nuniform float uAmp;\nuniform float uHurt;\nuniform float uHurtWig;\nuniform float uWave;\nuniform float uWaveT;\nvec2 rot2(vec2 p, float a) { return vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a)); }\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float sw = sin(uPhase) * uAmp;
        vec3 q = transformed;
        // legs: pivot at the hip, opposite legs swing opposite ways
        const float hip = ${f(P.hip)};
        float wl = smoothstep(hip + 0.03, hip - 0.05, q.y) * clamp(q.z / 0.04, -1.0, 1.0);
        q.xy = rot2(q.xy - vec2(0.0, hip), 0.6 * sw * wl) + vec2(0.0, hip);
        ${P.ears ? `// ears and head trail a little behind when walking, and bob on each step
        float ear = smoothstep(${f(P.neck + 0.1)}, ${f(P.neck + 0.32)}, q.y);
        q.x -= 0.035 * uAmp * ear; q.z += sin(uPhase * 2.0 - 1.1) * 0.022 * uAmp * ear;` : ''}
        // arms: lowered from the rest pose, then swing opposite to the leg on the same side
        const float sho = ${f(P.sho)}, az = ${f(P.armZ)};
        ${P.baked ? 'float side = sign(aArm + q.z * 1e-4), wa = abs(aArm); // arms already hang down: only swung here' : `float side = sign(q.z);
        float wa = smoothstep(az - 0.015, az + 0.02, abs(q.z)) * smoothstep(${f(P.top)}, ${f(P.top - 0.07)}, q.y) * step(${f(P.bot)}, q.y);`}
        // uHurt throws both arms up and out; uWave raises one arm high and waves it
        float waveUp = uWave * step(0.0, side) * (2.3 + 0.4 * sin(uWaveT));
        vec2 yz = rot2(vec2(q.y - sho, abs(q.z) - az), (${f(P.drop)} - 1.2 * uHurt - waveUp) * wa);
        q.y = yz.x + sho; q.z = side * (yz.y + az);
        float along = clamp((sho - q.y) / ${f(P.len || 0.36)}, 0.0, 1.0); // 0 at the shoulder, 1 at the hand
        float wig = sin(uPhase * 2.0 - along * 2.6) * along * uAmp;
        q.xy = rot2(q.xy - vec2(0.0, sho), (-0.85 * sw * side - 0.45 * wig + uHurtWig * side) * wa) + vec2(0.0, sho);
        vec2 fl = rot2(vec2(q.y - sho, abs(q.z) - az), 0.22 * along * uAmp * (0.5 + 0.5 * sin(uPhase * 2.0 + 1.3)) * wa);
        q.y = fl.x + sho; q.z = side * (fl.y + az);
        transformed = q${outline ? ` + normalize(normal) * ${outline.toFixed(4)}` : ''};
      }`);
  };
  mat.customProgramCacheKey = () => 'walk' + outline + outfit + key;
}

// dizzy stars: three little stars circle Buddy's head after he bumps into a wall
const dizzy = { t: -1, group: new THREE.Group() };
{
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.translate(32, 32); x.beginPath();
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 11 : 26; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  x.closePath(); x.lineJoin = 'round'; x.lineWidth = 7; x.strokeStyle = '#fff'; x.stroke(); x.fillStyle = '#ffcf3d'; x.fill();
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false });
  for (let i = 0; i < 3; i++) { const sp = new THREE.Sprite(mat); sp.scale.setScalar(0.13); dizzy.group.add(sp); }
  dizzy.group.visible = false; dizzy.group.renderOrder = 30;
}
function updateDizzy(dt) {
  const g = dizzy.group;
  if (dizzy.t < 0) { g.visible = false; return; }
  dizzy.t += dt;
  const k = dizzy.t / 1.2;
  if (k >= 1) { dizzy.t = -1; g.visible = false; return; }
  g.visible = true;
  g.position.set(player.position.x, player.position.y + CFG.charH + 0.2, player.position.z);
  const pop = k < 0.15 ? easeOutBack(k / 0.15) : k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
  g.children.forEach((sp, i) => {
    const a = dizzy.t * 7 + i * Math.PI * 2 / 3;
    sp.position.set(Math.cos(a) * 0.24, Math.sin(a * 2) * 0.03, Math.sin(a) * 0.24);
    sp.scale.setScalar(0.13 * Math.max(0.001, pop));
    sp.material.rotation = dizzy.t * 4;
  });
}
function setupPlayer(ch) {
  const old = player;
  player = new THREE.Group();
  const inner = ch.scene.clone(true), P = ch.P, buddy = ch.id === 'buddy';
  const box = new THREE.Box3().setFromObject(inner);
  const s = CFG.charH / (box.max.y - box.min.y);
  inner.scale.setScalar(s);
  inner.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
  // drawn in the transparent pass after the silhouette, so the silhouette only shows where stone hides the character
  inner.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.castShadow = true; o.material.metalness = 0; o.material.transparent = true; o.renderOrder = 20; addWalk(o.material, { outfit: buddy, P, key: ch.id }); } });
  // comic ink outline (inverted hull) so the character reads clearly against the stone
  const outline = inner.clone(true);
  const outMat = new THREE.MeshBasicMaterial({ color: '#161414', side: THREE.BackSide });
  addWalk(outMat, { outline: 0.016, P, key: ch.id });
  outline.traverse(o => { if (o.isMesh) { o.material = outMat; o.castShadow = false; } });
  const body = new THREE.Group(); body.add(inner, outline);
  player.add(body);
  player.userData.body = body;
  // silhouette that shows through stone
  silhouette = inner.clone(true);
  const silMat = new THREE.MeshBasicMaterial({ color: buddy ? SKINS[skin] : '#8a6a4a', transparent: true, opacity: 0.55, depthFunc: THREE.GreaterDepth, depthWrite: false });
  addWalk(silMat, { P, key: ch.id });
  silhouette.traverse(o => { if (o.isMesh) { o.material = silMat; o.castShadow = false; o.renderOrder = 10; } });
  body.add(silhouette);
  if (old) { player.position.copy(old.position); player.rotation.copy(old.rotation); scene.remove(old); }
  scene.add(player);
  scene.add(dizzy.group);
}
// pick a character: the player, the title screen and the outfit screen all change to it
async function setChar(id) {
  const ch = await loadChar(id);
  charId = ch.id;
  try { localStorage.setItem('hidden-maze-char', charId); } catch {}
  setupPlayer(ch);
  face.init(ch);
  document.body.dataset.char = charId;
  renderChars();
}

// a short message over the game (throttled so walking into the same thing doesn't spam it)
let toastT = 0;
function toast(text) {
  const now = performance.now(); if (now - toastT < 1500) return; toastT = now;
  const el = $('toast'); el.firstChild.textContent = text;
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
}
let enterT = 0;
// the key leaves the 3D world as a little icon and arcs up into its slot in the HUD, which pops when it lands
function flyKeyToHud() {
  const p = key.position.clone().project(camera);
  key.visible = false; key.scale.setScalar(1);
  const x0 = (p.x + 1) / 2 * innerWidth, y0 = (1 - p.y) / 2 * innerHeight;
  const slot = $('keyHud').getBoundingClientRect(), x1 = slot.left + slot.width / 2, y1 = slot.top + slot.height / 2;
  const el = document.createElement('div'); el.className = 'keyfly';
  el.innerHTML = '<svg class="ico"><use href="#i-key"/></svg>';
  document.body.appendChild(el);
  const mx = (x0 + x1) / 2 + 80, my = Math.min(y0, y1) - 90; // the arc's high point
  const frames = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20, e = t * t * (3 - 2 * t), u = 1 - e;
    const x = u * u * x0 + 2 * u * e * mx + e * e * x1, y = u * u * y0 + 2 * u * e * my + e * e * y1;
    frames.push({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${-25 + 385 * e}deg) scale(${1.5 - 0.6 * e})`, opacity: t < 0.08 ? t / 0.08 : 1 });
  }
  el.animate(frames, { duration: 750, easing: 'linear' }).onfinish = () => {
    el.remove();
    $('keyHud').classList.add('got');
    sfx.ui('toggle', 0.4);
  };
}
const _pp = new THREE.Vector3();
function collectKey() {
  hasKey = true;
  key.userData.grab = 0;
  sfx.ui('chime', 0.45);
  const p = key.position;
  for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; spawnPuff(p.x, 0.5, p.z, Math.cos(a) * 1.2, rand(0.3, 1), Math.sin(a) * 1.2, rand(0.05, 0.08), i % 2 ? '#ffd04d' : '#ffffff', 0.55); }
  toast('Got the key! Now find the portal');
  coach.keyGot();
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
  if (mode === 'race') net.send({ t: 'pos', x: nx, z: nz });
  updateTargets(false);
  const p = worldPos(st.gx, st.gz);
  footPuffs(p.x, p.z, dx, dz);
  coach.step(steps);
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
  if (won && mode !== 'race') { // hop into the portal: drift to its middle, spin and shrink away
    const k = Math.min(1, (enterT += dt) / 0.7), e = k * k;
    player.position.lerp(_pp.set(portal.position.x, 0.25 * Math.sin(Math.PI * k), portal.position.z), Math.min(1, dt * 8));
    player.rotation.y += dt * (4 + 14 * e);
    body.scale.setScalar(Math.max(0.001, 1 - e));
    return;
  }
  let x, z, y = 0, sq = 1;
  if (st.moving) {
    st.t = Math.min(1, st.t + dt / CFG.stepTime);
    const e = st.t;
    x = st.fx + (st.tx - st.fx) * e; z = st.fz + (st.tz - st.fz) * e;
    // springy steps: a hop each step, stretched at the top and squashed on landing
    const ph = walkU.uPhase.value;
    y = Math.abs(Math.sin(ph)) * 0.075;
    sq = 1 - 0.06 * Math.cos(2 * ph);
    st.idle = 0;
    if (st.t >= 1) {
      st.moving = false; st.gx = st.tx; st.gz = st.tz;
      sfx.play('step', 0.62, 0, { maxDur: 0.26 });
      const p = worldPos(st.gx, st.gz);
      footPuffs(p.x, p.z, st.tx - st.fx, st.tz - st.fz, 0.7);
      if (mode !== 'race' && keyAt && !hasKey && st.gx === keyAt[0] && st.gz === keyAt[1]) collectKey();
      if (st.gx === goal[0] && st.gz === goal[1]) {
        if (mode === 'race') return raceEnd(null);
        if (hasKey) return win();
        toast('The portal is asleep. Find the key!'); sfx.ui('nope', 0.3);
      }
      const next = queued || heldDir; queued = null;
      if (next) tryMove(next[0], next[1]);
    }
  } else {
    x = st.gx; z = st.gz;
    sq = 1 + Math.sin(time * 3) * 0.02; // breathing
    if (st.bumpT < 0 && intro.t < 0 && !won) st.idle += dt;
  }
  // after a while of waiting, he turns to you and waves now and then
  const idleWave = false; // (no waving while waiting)
  // walk cycle: one full stride every two tiles; eases out when the character stops
  // intro wave: faces the camera and waves while the camera comes down, then turns back to the maze
  walkU.uWave.value += ((intro.wave || idleWave ? 1 : 0) - walkU.uWave.value) * Math.min(1, dt * 5);
  if (intro.wave || idleWave) y += Math.abs(Math.sin(time * 6.5)) * 0.045; // bouncing while waving
  walkU.uWaveT.value += dt * 9;
  const walking = st.moving || (heldDir && st.bumpT < 0);
  walkU.uAmp.value += ((walking ? 1 : 0) - walkU.uAmp.value) * Math.min(1, dt * 12);
  if (walkU.uAmp.value > 0.01) walkU.uPhase.value += dt * Math.PI / CFG.stepTime;
  else walkU.uPhase.value = 0;
  const amp = walkU.uAmp.value;
  body.rotation.z = -0.12 * amp + (1 - amp) * Math.sin(time * 1.7) * 0.035; // lean forward when walking, a gentle sway when not
  body.rotation.x = Math.sin(walkU.uPhase.value) * 0.07 * amp;     // waddle
  // bumping into a wall: lunge, squash on impact, bounce back with a hop and flailing arms, then a dizzy wobble
  walkU.uHurt.value = walkU.uHurtWig.value = 0;
  if (st.bumpT >= 0) {
    const HIT = 0.08, prev = st.bumpT;
    st.bumpT += dt;
    const t = st.bumpT, u = Math.max(0, t - HIT);
    if (prev < HIT && t >= HIT) {
      sfx.play('bump', 0.55);
      dizzy.t = 0;
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
      y += u < 0.32 ? Math.sin(Math.PI * u / 0.32) * 0.15 : u < 0.5 ? Math.sin(Math.PI * (u - 0.32) / 0.18) * 0.04 : 0; // a hop and a little rebound
      sq *= 1 - 0.3 * Math.exp(-u * 16) + (u < 0.32 ? Math.sin(Math.PI * u / 0.32) * 0.08 : 0);
      body.rotation.z += 0.3 * Math.exp(-u * 7);                      // lean back from the hit
      body.rotation.x += 0.22 * Math.sin(u * 28) * Math.exp(-u * 4);   // dizzy wobble
    }
    if (t > 0.75) st.bumpT = -1;
  }
  player.position.set(x - origin, y, z - origin);
  body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
  updateDizzy(dt);
  let d = (idleWave ? -Math.PI / 4 : st.facing) - player.rotation.y;
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
function makeRival(entry, skinIdx, ch = charCache.buddyLoaded) {
  const U = newWalkU(), T = { uTint: { value: new THREE.Color(SKINS[skinIdx]) }, uTintOn: { value: 1 } };
  const inner = ch.scene.clone(true), P = ch.P, buddy = ch.id === 'buddy';
  const box = new THREE.Box3().setFromObject(inner);
  const s = CFG.charH / (box.max.y - box.min.y);
  inner.scale.setScalar(s);
  inner.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
  inner.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.metalness = 0; o.castShadow = true; addWalk(o.material, { outfit: buddy, U, T, P, key: ch.id }); } });
  const outline = inner.clone(true);
  const outMat = new THREE.MeshBasicMaterial({ color: '#161414', side: THREE.BackSide });
  addWalk(outMat, { outline: 0.016, U, P, key: ch.id });
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
    if (racing && r.remote) { if (r.t < 1) { r.t = Math.min(1, r.t + dt / r.stepTime); hop = Math.abs(Math.sin(r.U.uPhase.value)) * 0.05; } }
    else if (racing) {
      if (r.wait > 0) r.wait -= dt;
      else if (r.t >= 1 && r.i < r.route.length) { // start the next step
        r.fx = r.x; r.fz = r.z;
        [r.x, r.z] = r.route[r.i++];
        if (r.bot) net.send({ t: 'pos', x: r.x, z: r.z, p: r.pid });
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
  if (won) return;
  won = true;
  if (!winner) net.send({ t: 'win' }); else if (winner.bot && !winner.remote) net.send({ t: 'win', p: winner.pid });
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
  $('raceStats').innerHTML = chip('i-clock', fmt(Math.round(elapsed))) + chip('i-steps', `${steps} steps`);
  $('raceBadge').classList.toggle('gold', place === 0 || !!teamWin);
  $('raceBadge').innerHTML = `<svg class="ico"><use href="#${place === 0 || teamWin ? 'i-trophy' : 'i-flag'}"/></svg>`;
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
// a race: on your own against computer Buddies, or online against a friend (same seed, same maze, opposite corners)
async function startRace(online = null) {
  raceSize = online ? online.players.length : raceCfg.racers; raceTeam = online ? online.mode === 'teams' : raceCfg.mates > 0;
  const b = online ? online.biome : raceCfg.biome;
  if (!stoneSets[b]) { $('busy').classList.add('on'); await stoneSet(b); $('busy').classList.remove('on'); }
  const rm = online ? makeRaceMaze(mulberry32(online.seed), online.shape, online.cells) : makeRaceMaze();
  rm.biome = b;
  if (online) { // my corner first; the others, in player order, are moved by the network
    rm.online = true;
    const order = online.players.map((_, i) => i).filter(i => i !== online.me);
    rm.others = order.map(i => ({ pid: i, bot: !!online.players[i].bot, team: online.mode === 'teams' && online.players[i].team === online.players[online.me].team,
      skin: online.players[i].skin === skin ? (online.players[i].skin + 1 + i) % SKINS.length : online.players[i].skin }));
    rm.host = online.me === 0;
    for (let i = 0; i < rm.others.length; i++) rm.others[i].ch = await loadChar(online.players[rm.others[i].pid].char || 'buddy');
    rm.entries = [rm.entries[online.me], ...order.map(i => rm.entries[i])];
  }
  warp.t = -1; $('fader').style.opacity = 0;
  buildLevel(-1, rm); setupRaceUI(); show('play'); intro.t = 0; intro.warm = 3; intro.wave = false; lastCount = -1;
  intro.online = !!online; intro.hold = !!online && !intro.goAt; // (a late phone may already have its 'go')
  if (online) { net.ready(); toast('Waiting for everyone to be ready…'); }
}

function win() {
  won = true; enterT = 0;
  sfx.ui('whoosh', 0.45);
  heldDir = queued = null;
  const p = portal.position.clone().setY(0.45);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    spawnPuff(p.x, 0.3, p.z, Math.cos(a) * 1.6, rand(0.5, 1.4), Math.sin(a) * 1.6, rand(0.06, 0.1), i % 2 ? '#f2c14e' : '#ffffff', 0.6);
  }
  const ratio = steps / optimal;
  const stars = ratio <= 1.15 ? 3 : ratio <= 1.6 ? 2 : 1;
  const wasLocked = L + 1 < TOTAL_LEVELS && !unlocked(L + 1);
  save.set(L, stars);
  const newWorld = wasLocked && (L + 1) % LEVELS_PER_WORLD === 0 ? WORLDS[(L + 1) / LEVELS_PER_WORLD] : null;
  $('winStats').innerHTML = chip('i-steps', `${steps} steps`) + chip('i-clock', fmt(Math.round(elapsed))) + chip('i-flag', `best ${optimal}`);
  $('unlockText').innerHTML = newWorld ? `<svg class="ico"><use href="#${newWorld.icon}"/></svg>New world: ${newWorld.name}` : '';
  confetti();
  coach.done();
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
const chip = (icon, text) => `<span class="chip"><svg class="ico"><use href="#${icon}"/></svg>${text}</span>`;
// a little burst of paper confetti behind the win card
function confetti() {
  const COL = ['#6cc15a', '#ffc64a', '#ff8c6b', '#6dbef0', '#f27ba6', '#9c84ee'];
  $('confetti').innerHTML = Array.from({ length: 26 }, (_, i) => {
    const a = (i / 26) * Math.PI * 2 + Math.random() * 0.3, d = 140 + Math.random() * 120;
    return `<i style="--c:${COL[i % COL.length]};--x:${Math.cos(a) * d * 1.3}px;--y:${Math.sin(a) * d - 60}px;--r:${Math.random() * 720 - 360}deg;--w:${0.75 + Math.random() * 0.2}s"></i>`;
  }).join('');
}

// ---------- playing with a friend: a short code (or a link) connects two browsers directly (PeerJS) ----------
// The host picks the world and maze; both race the same maze from opposite corners. Moves and the win are sent as
// small messages; your friend's Buddy walks where they walk.
// When two networks can't connect directly (phones on mobile data often can't), the game talks through public MQTT
// brokers instead: a tiny MQTT-over-WebSocket client (connect, subscribe, publish, keepalive), on two brokers at once
// so one being down doesn't matter (messages carry an id, so the copy from the second broker is dropped).
function makeRelay(base, mine, onMsg) {
  const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
  const enc = new TextEncoder(), dec = new TextDecoder(), seen = new Set(), me = Math.random().toString(36).slice(2, 10);
  const str = t => { const b = enc.encode(t); return [b.length >> 8, b.length & 255, ...b]; };
  const pkt = (type, body) => { const len = []; let n = body.length; do { let d = n & 127; n >>= 7; if (n) d |= 128; len.push(d); } while (n); return new Uint8Array([type, ...len, ...body]); };
  let ended = false, seq = 0;
  const links = BROKERS.map(url => {
    const L = { ws: null, ready: false, buf: new Uint8Array(0), ping: 0 };
    const open = () => {
      if (ended) return;
      const ws = L.ws = new WebSocket(url, 'mqtt'); ws.binaryType = 'arraybuffer';
      ws.onopen = () => ws.send(pkt(0x10, [...str('MQTT'), 4, 2, 0, 60, ...str('bm' + me + Math.random().toString(36).slice(2, 6))]));
      ws.onmessage = e => {
        const nb = new Uint8Array(L.buf.length + e.data.byteLength); nb.set(L.buf); nb.set(new Uint8Array(e.data), L.buf.length); L.buf = nb;
        for (;;) {
          let len = 0, mul = 1, i = 1;
          for (; i < 5 && i < L.buf.length; i++) { len += (L.buf[i] & 127) * mul; mul *= 128; if (!(L.buf[i] & 128)) break; }
          if (i >= L.buf.length || L.buf.length < i + 1 + len) break;
          const type = L.buf[0] >> 4, body = L.buf.subarray(i + 1, i + 1 + len); L.buf = L.buf.slice(i + 1 + len);
          if (type === 2) { L.ready = true; ws.send(pkt(0x82, [0, 1, ...str(base + mine), 0])); clearInterval(L.ping); L.ping = setInterval(() => ws.readyState === 1 && ws.send(new Uint8Array([0xc0, 0])), 30000); }
          else if (type === 3) {
            const tl = (body[0] << 8) | body[1];
            try { const env = JSON.parse(dec.decode(body.subarray(2 + tl))); const k = env.f + ':' + env.i; if (!seen.has(k)) { seen.add(k); if (seen.size > 500) seen.clear(); onMsg(env); } } catch {}
          }
        }
      };
      ws.onclose = () => { L.ready = false; clearInterval(L.ping); if (!ended) setTimeout(open, 1500); };
      ws.onerror = () => {};
    };
    open();
    return L;
  });
  return {
    get ready() { return links.some(L => L.ready); },
    pub(to, m, from) { const body = enc.encode(JSON.stringify({ f: from, i: me + seq++, m })); for (const L of links) if (L.ready) L.ws.send(pkt(0x30, [...str(base + to), ...body])); },
    end() { ended = true; for (const L of links) { clearInterval(L.ping); try { if (L.ws.readyState === 1) L.ws.send(new Uint8Array([0xe0, 0])); L.ws.close(); } catch {} } },
  };
}
// a relayed friend looks just like a direct connection to the lobby code: open, send(), close(), on(data/open/close)
function relayConn(out) {
  const h = { data: [], open: [], close: [] };
  return { open: false, relay: true, on(ev, f) { h[ev].push(f); }, send(m) { if (this.open) out(m); },
    close() { if (this.gone) return; this.gone = true; if (this.open) out({ t: 'bye' }); this.open = false; h.close.forEach(f => f()); },
    emit(ev, x) { h[ev].forEach(f => f(x)); } };
}
const net = (() => {
  // A small lobby: the host holds a code, up to 3 friends join it (a star: every message goes through the host), the
  // host presses Start. Everyone gets the same maze and their own corner; moves and the win are relayed to all.
  let peer = null, host = false, code = '', conns = [], hostConn = null, players = [], me = 0, waitTimer = 0, pending = [], mode = 'ffa';
  let relay = null, relayTimer = 0, knockTimer = 0;
  const gid = Math.random().toString(36).slice(2, 9), topic = () => 'buddymaze/v1/' + code.toLowerCase() + '/';
  const MAX = 4, TEAM = ['#5bb2f2', '#ff8c6b'], TEAM_NAME = ['Blue', 'Orange'];
  const dbg = (...a) => { if (params.has('peerdebug')) console.log('[net]', ...a); };
  const status = t => { $('friendStatus').textContent = t; dbg(t); };
  const loadPeer = () => window.Peer ? Promise.resolve() : new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc);
  });
  const idOf = c => 'buddy-maze-' + c.toLowerCase();
  // direct connection first (STUN); if a network blocks that, the call goes through a free relay (TURN)
  const PEER_OPTS = { config: { iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
  ] } };
  const newCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
  const link = () => location.origin + location.pathname.replace(/index\.html$/, '') + '?join=' + code;
  const live = () => conns.filter(c => c.open);
  function toAll(m, except) { for (const c of live()) if (c !== except) c.send(m); }
  function send(m) { if (m.p === undefined) m.p = me; if (host) toAll(m); else if (hostConn && hostConn.open) hostConn.send(m); }
  // the lobby list: who's in, and (for the host) the Start button
  function lobby() {
    const size = host ? raceCfg.size : Math.max(players.length, 2), humans = players.filter(p => !p.bot).length;
    $('friend').classList.toggle('teams', mode === 'teams');
    const others = players.filter((_, i) => i !== me);
    Promise.all(others.map(p => loadChar(p.char || 'buddy'))).then(chs => { if (state === 'friend') face.setCrew(chs.map((ch, k) => ({ ch, skin: others[k].skin }))); });
    $('lobby').innerHTML = players.map((p, i) => `<span class="lp" data-pi="${i}"><i style="--c:${SKINS[p.skin]}"></i>${i === me ? 'You' : p.bot ? 'Computer' : i === 0 ? 'Host' : 'Friend'}${mode === 'teams' ? `<em style="--t:${TEAM[p.team]}">${TEAM_NAME[p.team]}</em>` : ''}</span>`).join('')
      + Array.from({ length: Math.max(0, size - players.length) }, () => '<span class="lp empty"><i></i>…</span>').join('');
    $('friendStart').disabled = !(host && players.length > 1);
    $('friendStart').style.display = host ? '' : 'none';
    if (host) status(humans > 1 ? `${humans - 1} friend${humans > 2 ? 's' : ''} joined! Press Start when everyone is in.` : players.length > 1 ? 'Invite friends, or press Start to play with computer Buddies.' : 'Press Invite friends and send the link.');
    else status('Waiting for the host to start…');
  }
  // the host's lobby: you, the friends who joined, then computer Buddies for the empty spots (if wanted); teams alternate
  function syncLobby() {
    if (!host) return;
    const keep = players.map(p => p.team);
    const humans = [{ skin, char: charId }, ...live().map(c => ({ skin: c.skin ?? 1, char: c.char || 'buddy' }))].slice(0, raceCfg.size);
    const bots = raceCfg.bots ? Array.from({ length: raceCfg.size - humans.length }, (_, k) => ({ skin: RIVAL_SKINS[k % RIVAL_SKINS.length], bot: true, char: 'buddy' })) : [];
    mode = raceCfg.mode;
    players = [...humans, ...bots].map((p, i) => ({ ...p, team: keep[i] ?? i % 2 }));
    lobby();
    live().forEach((c, i) => c.send({ t: 'lobby', players, you: i + 1, mode }));
  }
  function toggleTeam(i) { if (!host || mode !== 'teams' || !players[i]) return; players[i].team ^= 1; lobby(); live().forEach((c, k) => c.send({ t: 'lobby', players, you: k + 1, mode })); }
  // the host measures each friend's round trip all along, so the start can make up for it
  let readyAt = new Set(), goTimer = 0;
  setInterval(() => { if (host) for (const c of live()) c.send({ t: 'ping', s: performance.now() }); }, 2000);
  function checkGo() {
    if (!host || !goTimer) return;
    const humans = players.map((p, i) => i).filter(i => !players[i].bot);
    if (humans.every(i => readyAt.has(i))) go();
  }
  // start everyone's countdown at the same moment: the host picks a moment a little ahead and tells each friend when
  // that is on their own clock (from the clock offset its pings measured, NTP style: the fastest round trip wins)
  function go() {
    clearTimeout(goTimer); goTimer = 0;
    const now = performance.now(), L = Math.max(350, ...live().map(c => (c.rtt || 250) / 2 + 200)), T = now + L;
    live().forEach(c => c.send({ t: 'go', at: c.off !== undefined ? T + c.off : null, wait: L - (c.rtt || 250) / 2 }));
    raceGo(T);
  }
  function start() { // host: everyone gets the same maze; player i starts in corner i
    if (players.length < 2) return;
    readyAt = new Set(); clearTimeout(goTimer); goTimer = setTimeout(go, 20000); // (nobody waits forever for a stuck phone)
    const setup = { t: 'setup', seed: (Math.random() * 1e9) | 0, biome: raceCfg.biome, shape: raceCfg.shape, cells: 10, players, mode };
    live().forEach((c, i) => c.send({ ...setup, you: i + 1 }));
    begin({ ...setup, you: 0 });
  }
  function begin(m) { me = m.you; players = m.players; intro.goAt = 0; startRace({ ...m, me }); }
  function onData(c, m) {
    dbg('got', m.t);
    if (host) {
      if (m.t === 'hello') { if (live().length > raceCfg.size - 1) { c.send({ t: 'full' }); return; } c.skin = m.skin; c.char = m.char; syncLobby(); for (let k = 1; k <= 5; k++) setTimeout(() => c.open && c.send({ t: 'ping', s: performance.now() }), k * 300); }
      else if (m.t === 'pos' || m.t === 'win') { toAll(m, c); remote(m); } // pass it on to the others too
      else if (m.t === 'pong') {
        const r = performance.now() - m.s; c.rtt = c.rtt ? c.rtt * 0.7 + r * 0.3 : r;
        if (!(c.best <= r * 1.2)) { c.best = r; c.off = m.g - (m.s + r / 2); } // their clock minus mine
      }
      else if (m.t === 'ready') { readyAt.add(live().indexOf(c) + 1); checkGo(); }
      else if (m.t === 'again') start();
    } else {
      if (m.t === 'lobby') { players = m.players; me = m.you; mode = m.mode; lobby(); }
      else if (m.t === 'setup') begin(m);
      else if (m.t === 'ping') c.send({ t: 'pong', s: m.s, g: performance.now() });
      else if (m.t === 'go') raceGo(m.at != null && m.at > performance.now() - 2000 ? m.at : performance.now() + Math.max(0, m.wait));
      else if (m.t === 'full') status('That game is full.');
      else remote(m);
    }
  }
  function remote(m) { // someone else moved or won
    const r = rivals.find(o => o.pid === m.p); if (!r) return;
    if (m.t === 'pos') { r.fx = r.x; r.fz = r.z; r.x = m.x; r.z = m.z; r.t = 0; r.stepTime = CFG.stepTime; r.facing = Math.atan2(-(r.z - r.fz), r.x - r.fx); }
    else if (m.t === 'win' && !won) raceEnd(r);
  }
  function wire(c) {
    c.on('data', m => onData(c, m));
    c.on('open', () => { c.wasOpen = true; });
    c.on('close', () => {
      conns = conns.filter(o => o !== c);
      if (host && c.wasOpen) { if (state === 'friend') syncLobby(); else toast('A friend left the game'); }
      if (!host && c === hostConn && c.wasOpen) { hostConn = null; toast('The host left the game'); status('The host left.'); }
    });
  }
  function reset() {
    clearTimeout(waitTimer); clearTimeout(relayTimer); clearInterval(knockTimer);
    for (const c of conns) c.close();
    if (peer) peer.destroy(); if (relay) setTimeout(relay.end, 300); // (let the goodbyes go out first)
    peer = hostConn = relay = null; conns = []; players = []; me = 0;
  }
  // host: friends who couldn't connect directly knock on the relay; each becomes a relayed connection
  function hostRelay() {
    const rc = new Map();
    relay = makeRelay(topic(), 'h', ({ f, m }) => {
      let c = rc.get(f);
      if (m.t === 'knock') {
        if (!c) {
          if (live().length >= raceCfg.size - 1 || state !== 'friend') return relay.pub('g/' + f, { t: 'full' }, 'h');
          c = relayConn(x => relay && relay.pub('g/' + f, x, 'h')); rc.set(f, c); conns.push(c); wire(c); c.open = true; c.emit('open');
        }
        relay.pub('g/' + f, { t: 'welcome' }, 'h');
      } else if (m.t === 'bye') { if (c) { rc.delete(f); c.open = false; c.gone = true; c.emit('close'); } }
      else if (c) c.emit('data', m);
    });
  }
  // guest: if no direct connection is up after a few seconds, knock on the relay until the host answers
  function guestRelay() {
    if (relay || (hostConn && hostConn.open)) return;
    const c = relayConn(x => relay && relay.pub('h', x, gid));
    relay = makeRelay(topic(), 'g/' + gid, ({ m }) => {
      if (m.t === 'welcome') { if (!c.open && !(hostConn && hostConn.open)) { clearInterval(knockTimer); conns.push(c); wire(c); c.open = true; c.emit('open'); joined(c); } }
      else if (m.t === 'full') { clearInterval(knockTimer); status('That game is full.'); }
      else if (m.t === 'bye') { c.open = false; c.gone = true; c.emit('close'); }
      else c.emit('data', m);
    });
    knockTimer = setInterval(() => { if (relay && relay.ready) relay.pub('h', { t: 'knock' }, gid); }, 1500);
  }
  function joined(cc) {
    clearTimeout(waitTimer); clearTimeout(relayTimer); hostConn = cc;
    for (const o of pending) if (o !== cc) o.close();
    if (!cc.relay && relay) { clearInterval(knockTimer); setTimeout(relay.end, 300); relay = null; }
    cc.send({ t: 'hello', skin, char: charId });
    status('Joined! Waiting for the host to start…');
  }
  addEventListener('pagehide', () => { if (peer || relay) reset(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && peer && !peer.destroyed && peer.disconnected) peer.reconnect(); });
  const softErr = e => ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(e.type);
  return {
    get online() { return host ? live().length > 0 : !!(hostConn && hostConn.open); },
    send,
    async host() {
      reset(); host = true; code = newCode(); me = 0; players = [];
      $('friendCode').textContent = code; syncLobby(); status('Getting ready…');
      hostRelay();
      try { await loadPeer(); } catch { return lobby(); } // (the relay still works)
      peer = new Peer(idOf(code), PEER_OPTS);
      peer.on('open', () => lobby());
      peer.on('connection', c => {
        if (live().length >= raceCfg.size - 1 || state !== 'friend') { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); }); return; } // full, or already racing
        conns.push(c); wire(c);
      });
      peer.on('disconnected', () => { if (peer && !peer.destroyed) peer.reconnect(); });
      peer.on('error', e => {
        if (e.type === 'unavailable-id') return status('That code is taken, try again.');
        if (softErr(e)) { setTimeout(() => { if (peer && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 1500); return; }
        if (!relay) status('Connection problem: ' + e.type);
      });
    },
    async join(c) {
      reset(); host = false; code = c.trim().toUpperCase();
      if (code.length < 4) return status('Type the 5-letter code from your friend.');
      status('Looking for your friend…');
      relayTimer = setTimeout(guestRelay, 4500); // no direct connection by then: go through the relay
      if (params.has('relayonly')) return guestRelay(); // (testing the relay)
      try { await loadPeer(); } catch { return guestRelay(); }
      peer = new Peer(PEER_OPTS);
      // keep trying for about a minute: the host may be away from the game for a moment (sending you the link)
      let tries = 0;
      const attempt = () => {
        if (!peer || peer.destroyed || (hostConn && hostConn.open)) return;
        if (++tries > 12) return relay ? null : status('Could not reach your friend. Ask them for a new invite.');
        if (tries > 2) status('Still looking for your friend… keep the game open on both sides.');
        const cc = peer.connect(idOf(code), { reliable: true });
        if (tries === 1) pending = []; pending.push(cc); conns.push(cc);
        wire(cc);
        cc.on('open', () => { if (hostConn && hostConn.open) cc.close(); else joined(cc); });
        clearTimeout(waitTimer); waitTimer = setTimeout(attempt, 5000);
      };
      peer.on('open', attempt);
      peer.on('error', e => {
        if (e.type === 'peer-unavailable') { clearTimeout(waitTimer); waitTimer = setTimeout(attempt, 4000); return; }
        if (softErr(e)) { setTimeout(() => { if (peer && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 1500); return; }
        guestRelay();
      });
    },
    ready() { if (host) { readyAt.add(0); checkGo(); } else send({ t: 'ready' }); },
    start, syncLobby, toggleTeam,
    get isHost() { return host; },
    again() { if (host) start(); else { send({ t: 'again' }); toast('Asked the host for a rematch'); } },
    copy() { // the share sheet where there is one (phones, Macs), else copy the link
      // inside a game page (itch.io) the link can't carry the code: send the page and the code instead
      const framed = window.top !== window, page = framed ? (document.referrer || '') : '';
      const url = framed ? page : link(), text = framed ? `Race me in Buddy! Open ${page} then Friends, Join with code ${code}` : 'Race me in Buddy!';
      if (navigator.share) navigator.share(framed ? { title: 'Buddy', text } : { title: 'Buddy', text, url }).catch(() => {});
      else navigator.clipboard.writeText(framed ? text : url).then(() => toast('Invite copied! Paste it to your friends'), () => toast(framed ? text : url));
    },
    leave: reset,
  };
})();
const openFriend = () => { $('friend').classList.remove('guest', 'joining'); document.querySelectorAll('#frTabs span').forEach((t, i) => t.classList.toggle('on', i === 0)); $('friendTitle').textContent = 'Play with friends'; renderRaceSetup(); show('friend'); net.host(); };
$('friendBtn').addEventListener('click', openFriend);
$('friendMenuBtn').addEventListener('click', openFriend);
$('friend').addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { // Invite (host) or Join with code
    const join = tab.dataset.tab === 'join';
    document.querySelectorAll('#frTabs span').forEach(t => t.classList.toggle('on', t === tab));
    $('friend').classList.toggle('joining', join);
    if (join) { net.leave(); status2('Type your friend\'s code, then press Join.'); $('lobby').innerHTML = ''; setTimeout(() => $('friendInput').focus(), 50); }
    else net.host();
    return;
  }
  const lp = e.target.closest('.lp[data-pi]'); if (lp) return net.toggleTeam(+lp.dataset.pi);
  const b = e.target.closest('[data-rc], [data-fr]'); if (!b) return;
  if (b.dataset.rc) { const [k, v] = b.dataset.rc.split(':'); raceCfg[k] = v; }
  else {
    const [k, v] = b.dataset.fr.split(':');
    if (k === 'size') raceCfg.size = Math.max(2, Math.min(4, raceCfg.size + +v));
    else if (k === 'mode') raceCfg.mode = v;
    else if (k === 'bots') raceCfg.bots = !raceCfg.bots;
  }
  renderRaceSetup(); net.syncLobby();
});
const status2 = t => { $('friendStatus').textContent = t; };
$('friendCopy').addEventListener('click', () => net.copy());
$('friendStart').addEventListener('click', () => net.start());
const joinTyped = () => { const v = $('friendInput').value.trim(); if (v.length < 4) return status2('Type the 5-letter code from your friend.'); $('friend').classList.add('guest'); $('friend').classList.remove('joining'); $('friendTitle').textContent = 'Joining your friend…'; net.join(v); };
$('friendJoin').addEventListener('click', joinTyped);
$('friendInput').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') joinTyped(); });
$('friendBack').addEventListener('click', () => { net.leave(); show('title'); });

// the race page shows the computer Buddies you'll race standing behind you
function raceCrew() {
  if (state !== 'race') return;
  const others = RIVAL_SKINS.filter(c => c !== skin).slice(0, raceCfg.racers - 1);
  face.setCrew(others.map(k => ({ ch: charCache.buddyLoaded, skin: k })));
}
// the outfit screen's characters: a little picture of each, locked ones greyed with the world that unlocks them
const charPics = {};
// character card pictures: drawn once each by a small renderer of their own (smooth, antialiased, same light as the
// menus), with the same model the menus use
let picR = null, picEnv = null, picFree = 0;
function charPreview(id) {
  return charPics[id] ||= loadChar(id).then(ch => {
    const S = 256;
    if (!picR) {
      picR = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      picR.setPixelRatio(1); picR.setSize(S, S, false);
      picR.outputColorSpace = THREE.SRGBColorSpace; picR.toneMapping = THREE.ACESFilmicToneMapping;
      picEnv = new THREE.PMREMGenerator(picR).fromScene(new RoomEnvironment(), 0.04).texture;
    }
    const sc = new THREE.Scene();
    sc.environment = picEnv; sc.environmentIntensity = 0.55;
    sc.add(new THREE.HemisphereLight('#ffffff', '#dbe9cc', 0.8));
    const kl = new THREE.DirectionalLight('#fff1dc', 2.1); kl.position.set(-2, 3, 4);
    const rim = new THREE.DirectionalLight('#ffffff', 1.2); rim.position.set(2, 3, -3); sc.add(kl, rim);
    const z = () => ({ value: 0 });
    const m = face.makeModel(ch, { uYaw: z(), uPitch: z(), uRoll: z(), uIdle: z(), uLean: z(), uArm: z(), uWave: z(), uWaveT: z() },
      { uBlink: z(), uEyeY: z(), uEyeHalf: z(), uSkin: { value: new THREE.Color() }, uEyeOn: z() }, TINT);
    m.rotation.y = -Math.PI / 2 + 0.3; sc.add(m);
    const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 20); cam.position.set(0, 0.72, 2.75); cam.lookAt(0, 0.5, 0);
    picR.render(sc, cam);
    const url = picR.domElement.toDataURL();
    clearTimeout(picFree); picFree = setTimeout(() => { picR.dispose(); picR.forceContextLoss(); picR = picEnv = null; }, 2000); // (one WebGL context less)
    return url;
  });
}
function renderChars() {
  $('outfit').classList.toggle('buddy', charId === 'buddy');
  $('chars').innerHTML = CHARS.map(c => {
    const open = charUnlocked(c), lock = c.world >= 0 ? 'Unlock in ' + WORLDS[c.world].name : '';
    return `<button class="charcard ${c.id === charId ? 'on' : ''} ${open ? '' : 'locked'}" data-char="${c.id}" data-lock="${lock}"><img alt="" data-pic="${c.id}">${c.name}</button>`;
  }).join('');
  for (const c of CHARS) charPreview(c.id).then(u => { const im = document.querySelector(`[data-pic="${c.id}"]`); if (im) im.src = u; });
}
$('chars').addEventListener('click', e => {
  const b = e.target.closest('[data-char]'); if (!b) return;
  const c = CHARS.find(o => o.id === b.dataset.char);
  if (!charUnlocked(c)) { toast(b.dataset.lock); return; }
  setChar(c.id);
});

// ---------- the continue card's picture: the world's doorway, rendered once into an image ----------
const previews = {};
function doorPreview(b) {
  return previews[b] ||= stoneSet(b).then(set => {
    const S = 512, sc = new THREE.Scene();
    addLights(sc, false, BIOMES[b]);
    sc.traverse(o => { if (o.isLight) o.intensity *= 0.85; }); // (no tone mapping off-screen: a little less light)
    sc.environment = scene.environment; sc.environmentIntensity = 0.3;
    const m = new THREE.Mesh(set.door.raw, set.door.mat); m.rotation.y = set.door.yaw - 0.55; sc.add(m); // the stone is cut at the floor, like in the maze
    const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 30); cam.position.set(2.4, 2.1, 2.9); cam.lookAt(0, 0.38, 0);
    const rt = new THREE.WebGLRenderTarget(S, S, { colorSpace: THREE.SRGBColorSpace });
    renderer.setClearColor(0x000000, 0); renderer.setRenderTarget(rt); renderer.clear(); renderer.render(sc, cam);
    const px = new Uint8Array(S * S * 4); renderer.readRenderTargetPixels(rt, 0, 0, S, S, px);
    renderer.setRenderTarget(null); renderer.setClearColor(0x000000, 1); rt.dispose();
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d'), img = x.createImageData(S, S);
    for (let y = 0; y < S; y++) img.data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4); // flip: GL rows go up
    x.putImageData(img, 0, 0);
    const out = document.createElement('canvas'); out.width = out.height = 256; // drawn down for smooth edges
    out.getContext('2d').drawImage(c, 0, 0, 256, 256);
    return out.toDataURL();
  });
}

// ---------- first steps: a friendly guide on the first level (and the first door and cave) ----------
const coach = (() => {
  const el = $('coach');
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem('hidden-maze-tut') || '{}'); } catch {}
  const remember = id => { seen[id] = 1; try { localStorage.setItem('hidden-maze-tut', JSON.stringify(seen)); } catch {} };
  const ico = id => `<svg class="ico"><use href="#${id}"/></svg>`;
  const TIPS = {
    move: matchMedia('(pointer: coarse)').matches
      ? { pic: ico('i-steps'), title: 'Hello, explorer!', text: 'Swipe the way you want to walk. Keep your finger down to keep walking.' }
      : { pic: '<div class="keys"><b>W</b><b>A</b><b>S</b><b>D</b></div>', title: 'Hello, explorer!', text: 'Walk with <kbd>W A S D</kbd> or the arrow keys. Hold a key to keep walking.' },
    hidden: { pic: ico('i-eye'), title: 'The maze is hidden', text: 'Walls only rise around you, then sink back down. Remember the way you came!' },
    key: { pic: ico('i-key'), title: 'Find the golden key', text: 'It waits at the end of a side path somewhere in the maze.' },
    portal: { pic: ico('i-portal'), title: 'Now, the portal!', text: 'The stone portal woke up. Walk into it to finish the level.' },
    door: { pic: ico('i-w-woods'), title: 'A tree doorway', text: 'This maze is in two halves. Step into the doorway to go underground.' },
    cave: { pic: ico('i-w-cave'), title: 'Under the ground', text: 'The moss glows where you step. Find the key, then the other door back up.' },
  };
  const BASICS = ['move', 'hidden', 'key', 'portal'];
  let cur = null, pending = null, basics = false, until = 0;
  function show(id, secs = 0) {
    cur = id; const T = TIPS[id];
    $('coachPic').innerHTML = T.pic; $('coachTitle').textContent = T.title; $('coachText').innerHTML = T.text;
    $('coachDots').innerHTML = basics ? BASICS.map(b => `<i class="${b === id ? 'on' : ''}"></i>`).join('') : '';
    until = secs ? performance.now() + secs * 1000 : 0;
    el.classList.remove('on'); void el.offsetWidth;
  }
  return {
    level(L, stage, keep) {
      if (keep) { if (stage === 'cave' && !seen.cave) { pending = 'cave'; remember('cave'); } else if (cur === 'door') cur = null; return; }
      cur = pending = null; basics = false;
      if (L === 0 && !seen.basics) { basics = true; pending = 'move'; }
      else if (L >= 0 && isGateway(L) && !seen.door) { pending = 'door'; remember('door'); }
    },
    step(n) {
      if (!basics) return;
      if (cur === 'move' && n >= 4) show('hidden');
      else if (cur === 'hidden' && n >= 14) show('key');
    },
    keyGot() { if (basics) show('portal'); },
    done() { if (basics) remember('basics'); basics = false; cur = pending = null; },
    tick() {
      if (pending && state === 'play' && intro.t < 0 && warp.t < 0) { show(pending, pending === 'door' ? 9 : pending === 'cave' ? 8 : 0); pending = null; }
      if (until && performance.now() > until) { cur = null; until = 0; }
      el.classList.toggle('on', !!cur && state === 'play' && intro.t < 0 && warp.t < 0 && !won);
    },
  };
})();

// ---------- menus ----------
function show(name) {
  if (name !== state) { if (['pause', 'settings', 'race', 'win', 'raceEnd'].includes(name)) sfx.ui('modal', 0.4); else if (name === 'worlds' || name === 'outfit') sfx.ui('whoosh', 0.3); }
  state = name;
  document.body.dataset.state = name;
  if (['play', 'worlds', 'pause', 'win', 'raceEnd'].includes(name)) face.sleep();
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('show', el.id === name);
  if (name === 'worlds') renderMap();
  if (name === 'title') {
    const n = nextLevel();
    $('playSub').textContent = $('playSub2').textContent = `Level ${Math.floor(n / LEVELS_PER_WORLD) + 1}-${n % LEVELS_PER_WORLD + 1}`;
    $('starCount').textContent = Array.from({ length: TOTAL_LEVELS }, (_, k) => save.stars(k)).reduce((a, b) => a + b, 0);
    const wd = WORLDS[Math.floor(n / LEVELS_PER_WORLD)];
    $('worldNameCard').textContent = wd.name;
    $('contArt').style.setProperty('--wc', wd.card);
    doorPreview(wd.biome).then(url => { $('contArt').innerHTML = `<img alt="" src="${url}">`; });
  }
  if (['title', 'outfit', 'race', 'friend'].includes(name)) $(name).querySelector('.faceSlot').appendChild($('faceCanvas'));
  if (name === 'title' || name === 'outfit') face.setCrew([]);
  if (name === 'race') raceCrew();
  if (name === 'outfit') renderChars();
  if ((name === 'settings' || name === 'help') && (name === 'settings' ? settingsBack : helpBack) === 'title') $('title').classList.add('show'); // these panels sit over the title
  if (name === 'race') renderRaceSetup();
  if (name === 'pause') $('pauseInfo').textContent = mode === 'race' ? (raceTeam ? `Team race · ${raceCfg.mates + 1} vs ${raceSize - raceCfg.mates - 1}` : `Race · ${raceSize} Buddies`) : `${WORLDS[Math.floor(L / LEVELS_PER_WORLD)].name} · level ${L % LEVELS_PER_WORLD + 1}`;
  if (name !== 'play') heldDir = queued = null;
  sfx.setScene(name === 'play' || name === 'pause' || name === 'win' || name === 'raceEnd');
}
async function play(level) {
  const b = levelBiome(level);
  if (!stoneSets[b]) { $('busy').classList.add('on'); await stoneSet(b); $('busy').classList.remove('on'); } // first visit to a biome
  warp.t = -1; $('fader').style.opacity = 0;
  buildLevel(level); show('play'); intro.t = 0; intro.warm = 3; intro.wave = false; intro.online = intro.hold = false;
}

// adventure map: a 3D board of floating islands, one per world, left to right (see map3d.js)
const starSvg = on => `<svg class="${on ? 'on' : ''}"><use href="#i-star"/></svg>`;
let map3d = null;
function renderMap() {
  if (!map3d) {
    map3d = createMap3D({ canvas: $('mapCanvas'), renderer, layer: $('mapNodes'), worlds: WORLDS, perWorld: LEVELS_PER_WORLD,
      stars: save.stars, unlocked, next: nextLevel, starSvg, stoneSet, addLights, biomes: BIOMES,
      patterns: { woods: groundTexture('woods'), autumn: groundTexture('autumn'), desert: groundTexture('desert'), snow: groundTexture('snow') },
      decor: b => sceneryModels.arch.map(m => ({ geo: m.geo, mat: decorMat(m, b), h: m.h })) });
    map3d.focusNext();
  }
  map3d.refresh();
  const totalStars = Array.from({ length: TOTAL_LEVELS }, (_, k) => save.stars(k)).reduce((a, b) => a + b, 0);
  $('mapTitle').textContent = `${totalStars} / ${TOTAL_LEVELS * 3}`;
}
// seamless ground textures (map, and the autumn floor in play): tileable noise, so no seams and no blotches
function tileNoise(S, cells, seed) { // smooth value noise that wraps around at the edges
  const rnd = mulberry32(seed), g = Array.from({ length: cells * cells }, rnd), out = new Float32Array(S * S);
  const at = (x, y) => g[((y % cells) + cells) % cells * cells + ((x % cells) + cells) % cells];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fx = x / S * cells, fy = y / S * cells, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    out[y * S + x] = (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
  }
  return out;
}
const groundCache = {};
function groundTexture(kind) {
  if (groundCache[kind]) return groundCache[kind];
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  if (kind === 'woods' || kind === 'autumn') { // soft grass: gentle light and dark drifts, then fine blades (green, or golden for autumn)
    const n1 = tileNoise(S, 5, 41), n2 = tileNoise(S, 20, 53), img = x.createImageData(S, S), px = img.data;
    const base = kind === 'autumn' ? [216, 184, 108] : [160, 196, 104], warm = kind === 'autumn' ? [226, 160, 84] : [182, 204, 110];
    for (let i = 0; i < S * S; i++) {
      const v = 0.07 * (n1[i] - 0.5) + 0.05 * (n2[i] - 0.5), t = Math.max(0, Math.min(1, n1[i] * 1.6 - 0.3));
      for (let k = 0; k < 3; k++) px[i * 4 + k] = (base[k] * (1 - t * 0.5) + warm[k] * t * 0.5) * (1 + v);
      px[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const rnd = mulberry32(kind === 'autumn' ? 77 : 66);
    const blades = kind === 'autumn' ? ['rgba(240,205,130,.5)', 'rgba(190,140,70,.35)', 'rgba(230,170,90,.45)'] : ['rgba(200,228,140,.5)', 'rgba(110,160,70,.35)', 'rgba(170,210,110,.45)'];
    x.lineCap = 'round';
    for (let n = 0; n < 2600; n++) {
      const bx = rnd() * S, by = rnd() * S, len = 3 + rnd() * 5, a = -Math.PI / 2 + (rnd() - 0.5) * 0.9;
      x.strokeStyle = blades[n % 3]; x.lineWidth = 1 + rnd() * 0.8;
      for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) { // drawn wrapped, so the tile has no seam
        x.beginPath(); x.moveTo(bx + ox, by + oy); x.lineTo(bx + ox + Math.cos(a) * len, by + oy + Math.sin(a) * len); x.stroke();
      }
    }
    return (groundCache[kind] = c);
  }
  const img = x.createImageData(S, S), px = img.data;
  const n1 = tileNoise(S, 6, 11), n2 = tileNoise(S, 24, 23), n3 = tileNoise(S, 96, 37);
  const rnd = mulberry32(kind === 'desert' ? 5 : kind === 'cave' ? 13 : 9);
  for (let y = 0; y < S; y++) for (let xx = 0; xx < S; xx++) {
    const i = y * S + xx, k = i * 4;
    let base, v;
    if (kind === 'desert') { // warm sand with soft wind ripples and a fine grain
      const rip = Math.sin((y / S * 22 + n1[i] * 3.2 + n2[i] * 0.6) * Math.PI * 2);
      v = 0.02 * rip + 0.04 * (n1[i] - 0.5) + 0.035 * (n3[i] - 0.5) + (rnd() - 0.5) * 0.025;
      base = [236, 212, 164];
    } else if (kind === 'cave') { // dark slate with faint cool mottling
      v = 0.1 * (n1[i] - 0.5) + 0.08 * (n2[i] - 0.5) + 0.06 * (n3[i] - 0.5);
      base = [30, 44, 64];
    } else { // snow: pale, a cool shading in the hollows, and a little sparkle
      v = 0.03 * (n1[i] - 0.5) + 0.03 * (n2[i] - 0.5) + (rnd() < 0.004 ? 0.06 : 0);
      base = [244, 247, 251];
      const cool = (0.5 - n1[i]) * 10; base = [base[0] - cool * 1.4, base[1] - cool * 0.6, base[2]];
    }
    px[k] = Math.min(255, base[0] * (1 + v)); px[k + 1] = Math.min(255, base[1] * (1 + v)); px[k + 2] = Math.min(255, base[2] * (1 + v)); px[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return (groundCache[kind] = c);
}
$('map').addEventListener('click', e => {
  const b = e.target.closest('[data-level]'); if (!b) return;
  if (b.classList.contains('locked')) { b.animate([{ transform: 'translate(-50%,-50%)' }, { transform: 'translate(calc(-50% - 6px),-50%)' }, { transform: 'translate(calc(-50% + 6px),-50%)' }, { transform: 'translate(-50%,-50%)' }], { duration: 240 }); return; }
  play(+b.dataset.level);
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]'); if (!b) return;
  if (b.dataset.go === 'title' && mode === 'race') net.leave();
  show(b.dataset.go);
});
$('playBtn').addEventListener('click', () => show('worlds')); // adventure opens the map
$('contBtn').addEventListener('click', e => { e.stopPropagation(); play(nextLevel()); });
$('contCard').addEventListener('click', () => play(nextLevel()));
// soft UI sounds: a little pop on every button, a breath of a hover on menu items
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.classList.contains('toggle') || b.closest('#skins')) return sfx.ui('toggle', 0.45);
  if (b.classList.contains('locked')) return sfx.ui('nope', 0.35);
  sfx.ui('pop', 0.45);
}, true);
document.addEventListener('pointerover', e => {
  const b = e.target.closest('.mitem, .pitem, .btn, .round, .node, .cont'); if (!b || b.contains(e.relatedTarget)) return;
  sfx.ui('hover', 0.22);
});
// the 3D menu panels sway a little toward the mouse
addEventListener('pointermove', e => {
  const r = document.documentElement.style;
  r.setProperty('--mx', (e.clientX / innerWidth * 2 - 1).toFixed(3));
  r.setProperty('--my', (e.clientY / innerHeight * 2 - 1).toFixed(3));
});
// Netlify's free plan pins a small badge to a bottom corner: lift the bottom buttons above it so it never covers them
function clearBadge() {
  const f = document.getElementById('nl-badge-frame') || document.getElementById('nl-hud-frame'), r = f && f.getBoundingClientRect();
  document.documentElement.style.setProperty('--badge-h', r && r.height && r.top > innerHeight * 0.6 ? Math.ceil(innerHeight - r.top + 6) + 'px' : '0px');
}
setTimeout(clearBadge, 2500); setTimeout(clearBadge, 7000); addEventListener('resize', () => setTimeout(clearBadge, 300));
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
  $('ambVol').value = Math.round(sfx.prefs.amb * 100); sync($('ambVol'));
  $('ambBtn').classList.toggle('on', sfx.prefs.ambOn);
  $('muteBtn').classList.toggle('on', sfx.prefs.mute);
  show('settings');
}
for (const [id, key] of [['musicVol', 'music'], ['fxVol', 'fx'], ['ambVol', 'amb']]) {
  $(id).addEventListener('input', e => { e.target.style.setProperty('--v', e.target.value + '%'); sfx.set(key, e.target.value / 100); });
}
$('fxVol').addEventListener('change', () => sfx.play('step', 0.62, 0, { maxDur: 0.26 })); // preview the effects level
$('ambBtn').addEventListener('click', () => { sfx.set('ambOn', !sfx.prefs.ambOn); $('ambBtn').classList.toggle('on', sfx.prefs.ambOn); });
$('muteBtn').addEventListener('click', () => { sfx.set('mute', !sfx.prefs.mute); $('muteBtn').classList.toggle('on', sfx.prefs.mute); });
$('settingsBtn').addEventListener('click', () => openSettings('title'));
// how to play: from the title or the pause menu, back to where you came from
let helpBack = 'title';
$('helpBtn').addEventListener('click', () => { helpBack = 'title'; show('help'); });
$('pauseHelpBtn').addEventListener('click', () => { helpBack = 'pause'; show('help'); });
$('helpDone').addEventListener('click', () => show(helpBack));
// fullscreen: the F key, or the toggle in settings
const toggleFull = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
$('fullBtn').addEventListener('click', toggleFull);
$('hudFull').addEventListener('click', toggleFull);
if (!document.documentElement.requestFullscreen) $('hudFull').style.display = 'none'; // iPhone: use Add to Home Screen instead
document.addEventListener('fullscreenchange', () => $('fullBtn').classList.toggle('on', !!document.fullscreenElement));
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'KeyF') toggleFull();
  // Esc steps back out of any menu
  if (e.code === 'Escape' && !['play', 'pause', 'title', 'loading'].includes(state)) {
    const back = { settings: settingsBack, help: helpBack, worlds: 'title', outfit: 'title', race: 'title', friend: 'title', raceEnd: 'title', win: 'worlds' }[state];
    if (back) { if (state === 'friend') net.leave(); show(back); }
  }
});
// the game pauses itself when the window loses focus (not in an online race: the friend keeps going)
addEventListener('blur', () => { if (state === 'play' && !net.online) show('pause'); });
$('pauseSoundBtn').addEventListener('click', () => openSettings('pause'));
$('settingsDone').addEventListener('click', () => show(settingsBack));
$('outfitBtn').addEventListener('click', () => show('outfit'));
$('raceBtn').addEventListener('click', () => show('race'));
// race setup screen: steppers for Buddies and teammates, a choice of rival speed, and a preview of the teams
function renderRaceSetup() {
  raceCfg.racers = Math.max(2, Math.min(4, raceCfg.racers));
  raceCrew();
  raceCfg.mates = Math.max(0, Math.min(raceCfg.racers - 2, raceCfg.mates));
  $('rcRacers').textContent = raceCfg.racers;
  $('rcMates').textContent = raceCfg.mates;
  document.querySelectorAll('#rcSpeed button').forEach((b, i) => b.classList.toggle('on', i === raceCfg.speed));
  $('frSize').textContent = raceCfg.size;
  document.querySelectorAll('#frMode button').forEach(b => b.classList.toggle('on', b.dataset.fr === 'mode:' + raceCfg.mode));
  $('frBots').classList.toggle('on', !!raceCfg.bots);
  document.querySelectorAll('#rcBiome button, #frBiome button').forEach(b => b.classList.toggle('on', b.dataset.rc === 'biome:' + raceCfg.biome));
  document.querySelectorAll('#rcShape button, #frShape button').forEach(b => b.classList.toggle('on', b.dataset.rc === 'shape:' + raceCfg.shape));
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
  if (key === 'speed') raceCfg.speed = +d; else if (key === 'biome' || key === 'shape') raceCfg[key] = d; else raceCfg[key] += +d;
  renderRaceSetup();
});
$('raceGo').addEventListener('click', () => startRace());
$('raceAgain').addEventListener('click', () => net.online ? net.again() : startRace());
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
  // the word bobs as one piece; each letter sits on a gentle arch, tilted outward
  el.innerHTML = letters.map((ch, i) => `<span style="transform:translateY(${(0.035 * (i - mid) ** 2).toFixed(3)}em) rotate(${((i - mid) * 2.5).toFixed(1)}deg)"><i style="--i:${i}">${ch}${i === 0 ? '<svg class="sprout"><use href="#i-sprout"/></svg>' : ''}</i></span>`).join(''); // a sprout growing out of the B, moving with it
}

// ---------- title: the character's face peeking up, looking at the cursor or tilting its head ----------
const face = (() => {
  const canvas = $('faceCanvas');
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  r.setPixelRatio(Math.min(devicePixelRatio, PHONE ? 1.5 : 2));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const sc = new THREE.Scene();
  sc.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
  canvas.addEventListener('webglcontextrestored', () => { sc.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture; w = 0; }, false);
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
  const U = { uYaw: { value: 0 }, uPitch: { value: 0 }, uRoll: { value: 0 }, uIdle: { value: 0 }, uLean: { value: 0 }, uArm: { value: 0 }, uWave: { value: 0 }, uWaveT: { value: 0 } };
  const cur = { yaw: 0, pitch: 0, roll: 0 };
  let group, sway, mouse = null, lastMouse = -1e9, w = 0, h = 0;
  // head turn in the model's own space: pivot at the neck, everything above it rotates (model faces +X)
  const headGlsl = `
    float hw = smoothstep(0.02, 0.12, position.y);
    mat3 hr = mat3(cos(uYaw*hw),0.,-sin(uYaw*hw), 0.,1.,0., sin(uYaw*hw),0.,cos(uYaw*hw))
            * mat3(cos(uPitch*hw),sin(uPitch*hw),0., -sin(uPitch*hw),cos(uPitch*hw),0., 0.,0.,1.)
            * mat3(1.,0.,0., 0.,cos(uRoll*hw),sin(uRoll*hw), 0.,-sin(uRoll*hw),cos(uRoll*hw));`;
  // one character for the menus: the chibi idle and head turn, with that body's own shoulders, hips and neck
  function makeModel(ch, Uo, Bo, T) {
    const P = ch.P, f = v => v.toFixed(3), model = ch.scene.clone(true);
    if (ch.id !== 'buddy') { // the animals keep exactly their model's shape here (no bending), shaded smooth
      model.traverse(o => { if (o.isMesh) { o.geometry = smoothNormals(o.geometry); o.material = o.material.clone(); o.material.metalness = 0; } });
      const box = new THREE.Box3().setFromObject(model), s = 1 / (box.max.y - box.min.y);
      model.scale.setScalar(s);
      model.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
      const g = new THREE.Group(); g.add(model); g.userData.animal = true;
      return g;
    }
    model.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.metalness = 0;
      o.material.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, Uo, Bo);
        const head = `
    float hw = smoothstep(${f(P.neck - 0.04)}, ${f(P.neck + 0.06)}, position.y);
    mat3 hr = mat3(cos(uYaw*hw),0.,-sin(uYaw*hw), 0.,1.,0., sin(uYaw*hw),0.,cos(uYaw*hw))
            * mat3(cos(uPitch*hw),sin(uPitch*hw),0., -sin(uPitch*hw),cos(uPitch*hw),0., 0.,0.,1.)
            * mat3(1.,0.,0., 0.,cos(uRoll*hw),sin(uRoll*hw), 0.,-sin(uRoll*hw),cos(uRoll*hw));`;
        sh.vertexShader = 'uniform float uYaw, uPitch, uRoll, uIdle, uLean, uArm, uWave, uWaveT;\nvarying vec3 vObjPos;\nvec2 rot2(vec2 p, float a) { return vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a)); }\n' + sh.vertexShader
          .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + head + '\nobjectNormal = hr * objectNormal;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
          vObjPos = position;
          {
            // chibi idle: arms relaxed a little away from the body, swinging a beat behind the body's sway; the upper
            // body leans side to side from the hips, so the feet stay on the ground
            const float sho = ${f(P.sho)}, hip = ${f(P.hip)}, az = ${f(P.armZ)};
            vec3 q = transformed;
            float side = sign(q.z);
            float wa = smoothstep(az - 0.015, az + 0.02, abs(q.z)) * smoothstep(${f(P.top)}, ${f(P.top - 0.07)}, q.y) * step(${f(P.bot)}, q.y);
            vec2 yz = rot2(vec2(q.y - sho, abs(q.z) - az), (${f(P.drop + 0.02)} - ${P.baked ? '0.0' : '0.16'} + side * uArm) * wa);
            q.y = yz.x + sho; q.z = side * (yz.y + az);
            ${P.baked ? '' : `// a soft elbow half way down: the forearm curves back in, the relaxed bow of a plush toy's arm
            float elY = sho - 0.15, we = smoothstep(sho - 0.11, sho - 0.2, q.y) * wa;
            vec2 eb = rot2(vec2(q.y - elY, abs(q.z) - az - 0.035), 0.3 * we);
            q.y = eb.x + elY; q.z = side * (eb.y + az + 0.035);`}
            float along = clamp((sho - q.y) / 0.36, 0.0, 1.0);
            q.xy = rot2(q.xy - vec2(0.0, sho), (0.1 * sin(uIdle * 1.5) * side + 0.08 * sin(uIdle * 3.0 - along * 2.0) * along) * wa) + vec2(0.0, sho);
            float wl = smoothstep(hip - 0.02, hip + 0.16, q.y);
            vec2 lz = rot2(vec2(q.y - hip, q.z), uLean * wl);
            q.y = lz.x + hip; q.z = lz.y;
            transformed = q;
          }
          transformed = hr * (transformed - vec3(0., ${f(P.neck)}, 0.)) + vec3(0., ${f(P.neck)}, 0.);`);
        if (ch.id === 'buddy') addOutfit(sh, false, T);
        sh.fragmentShader = 'uniform float uBlink, uEyeY, uEyeHalf, uEyeOn;\nuniform vec3 uSkin;\nvarying vec3 vObjPos;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          {
            float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            float eye = (1.0 - smoothstep(0.03, 0.09, lum)) * step(0.04, vObjPos.x) * step(uEyeY - 0.12, vObjPos.y) * step(vObjPos.y, uEyeY + 0.12);
            float open = max(uEyeHalf * (1.0 - uBlink), 0.0045);
            float hide = step(open, abs(vObjPos.y - uEyeY)) * step(0.02, uBlink) * uEyeOn;
            diffuseColor.rgb = mix(diffuseColor.rgb, uSkin, eye * hide);
          }`);
      };
      o.material.customProgramCacheKey = () => 'head-' + ch.id + (T === TINT ? '' : 'crew');
    });
    const box = new THREE.Box3().setFromObject(model);
    const s = 1 / (box.max.y - box.min.y);
    model.scale.setScalar(s);
    model.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
    const g = new THREE.Group(); g.add(model);
    return g;
  }
  let shadow = null, spin = 0, spinWant = 0;
  // drag sideways on the menu (not on a panel) to spin the character around
  let drag = null;
  addEventListener('pointerdown', e => {
    if (!['title', 'outfit', 'race', 'friend'].includes(state) || e.target.closest('button, .card, .cont, .side-menu, input, .panel, .pagehead')) return;
    drag = { x: e.clientX, s: spinWant };
  });
  addEventListener('pointermove', e => { if (drag) spinWant = drag.s + (e.clientX - drag.x) * 0.012; });
  addEventListener('pointerup', () => { drag = null; });
  function init(ch) {
    if (sway) sc.remove(sway);
    spin = spinWant = 0;
    group = makeModel(ch, U, B, TINT);
    sway = new THREE.Group(); // rocks side to side from the feet
    sway.add(group);
    sc.add(sway);
    if (!shadow) { // a little contact shadow under the feet
      const sh = document.createElement('canvas'); sh.width = sh.height = 128;
      const sx = sh.getContext('2d'), sg = sx.createRadialGradient(64, 64, 0, 64, 64, 64);
      sg.addColorStop(0, 'rgba(100,70,35,.55)'); sg.addColorStop(0.45, 'rgba(100,70,35,.25)'); sg.addColorStop(1, 'rgba(100,70,35,0)'); sx.fillStyle = sg; sx.fillRect(0, 0, 128, 128);
      shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.42).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false }));
      shadow.position.y = 0.002;
      sc.add(shadow);
    }
    B.uEyeOn.value = 0;
    findEyes(firstMesh(ch.scene));
    if (B.uEyeHalf.value > 0.06) B.uEyeOn.value = 0; // no clear eyes found: no blink rather than a smudge
  }
  // friends in the lobby stand behind you, a little apart (Fortnite-style), each with its own little idle
  const crew = [];
  const SPOTS = [[-0.58, -0.42], [0.58, -0.42], [-1.12, -0.95]];
  function setCrew(list) {
    for (const m of crew) { sc.remove(m.root); sc.remove(m.root.userData.sh); } crew.length = 0;
    list.slice(0, 3).forEach((it, i) => {
      if (!it || !it.ch) return;
      const Uo = { uYaw: { value: 0 }, uPitch: { value: 0 }, uRoll: { value: 0 }, uIdle: { value: i * 1.7 }, uLean: { value: 0 }, uArm: { value: 0 }, uWave: { value: 0 }, uWaveT: { value: 0 } };
      const Bo = { uBlink: { value: 0 }, uEyeY: { value: 0 }, uEyeHalf: { value: 0 }, uSkin: { value: new THREE.Color() }, uEyeOn: { value: 0 } };
      const T = { uTint: { value: new THREE.Color(SKINS[it.skin || 0]) }, uTintOn: { value: it.skin ? 1 : 0 } };
      const root = makeModel(it.ch, Uo, Bo, T);
      root.position.set(SPOTS[i][0], 0, SPOTS[i][1]); root.scale.setScalar(0.92);
      const sh2 = shadow.clone(); sh2.position.set(SPOTS[i][0], 0.002, SPOTS[i][1]); root.userData.sh = sh2; sc.add(sh2);
      sc.add(root); crew.push({ root, Uo, off: i * 1.7 });
    });
    w = 0; // re-frame the camera
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
      // with friends behind, pull back so the whole group fits
      // (on a phone's title the canvas is just the gap between the logo and the buttons: fill it)
      const tight = !crew.length && canvas.closest('#title') && innerWidth / innerHeight < 1.25;
      const wide = crew.length ? [1, 1.45, 1.6, 2.1][crew.length] : 1, fit = tight ? Math.max(0.6 / 0.2126, 0.5 / (0.2126 * cam.aspect))
        : Math.max(0.95 / 0.2126, 0.62 * wide / (0.2126 * cam.aspect)) * (crew.length ? 1.12 : 1);
      cam.position.set(crew.length === 3 ? -0.25 : 0, tight ? 0.75 : 0.9 + (crew.length ? 0.25 : 0), fit);
      cam.lookAt(crew.length === 3 ? -0.25 : 0, tight ? 0.5 : crew.length ? 0.5 : 0.62, crew.length ? -0.35 : 0); // a bit low in the frame, leaving the top for the logo
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
    const still = state === 'outfit'; // in the outfit screen the character stands still to be looked at
    if (still) { ty = 0; tp = 0; tr = 0; }
    const k = Math.min(1, dt * 3);
    cur.yaw += (ty - cur.yaw) * k; cur.pitch += (tp - cur.pitch) * k; cur.roll += (tr - cur.roll) * k;
    U.uYaw.value = cur.yaw; U.uPitch.value = cur.pitch; U.uRoll.value = cur.roll;
    const animal = group.userData.animal;
    spin += (spinWant - spin) * Math.min(1, dt * 8);
    group.rotation.y = -Math.PI / 2 + (animal ? 0 : cur.yaw * 0.2) + spin; // the model faces +X; turn it to face the camera (and however you spun it)
    if (animal) { U.uYaw.value = U.uPitch.value = U.uRoll.value = 0; sway.rotation.z = still ? 0 : Math.sin(t * 1.4) * 0.025; } // a gentle sway from the feet instead of bending
    // cute waiting sway: rock from foot to foot with a tiny bounce on each side
    U.uIdle.value = t;
    // feet stay planted: the upper body sways from the hips, the arms follow a beat later, a slow breath, and every
    // few seconds a happy little knee-bounce (squash and stretch from the floor up, never leaving the ground)
    // kept gentle so the model never looks bent out of shape
    U.uLean.value = still ? 0 : Math.sin(t * 1.5) * 0.035;
    U.uArm.value = still ? 0 : Math.sin(t * 1.5 - 0.7) * 0.035;
    if (still) U.uIdle.value = 0;
    if (!animal) sway.rotation.z = 0;
    group.position.y = 0;
    const sqz = still ? 1 : 1 + Math.sin(t * 3) * 0.006;
    group.scale.set(1 / Math.sqrt(sqz), sqz, 1 / Math.sqrt(sqz));
    for (const m of crew) { // the friends behind sway on their own beat and glance around
      const tt = t + m.off;
      m.Uo.uIdle.value = tt; m.Uo.uLean.value = Math.sin(tt * 1.5) * 0.035; m.Uo.uArm.value = Math.sin(tt * 1.5 - 0.7) * 0.035;
      m.Uo.uYaw.value = Math.sin(tt * 0.5) * 0.35; m.root.rotation.y = -Math.PI / 2 + Math.sin(tt * 0.3) * 0.15;
    }
    updateBlink(dt);
    r.render(sc, cam);
  }
  function sleep() {
    if (w) { r.setSize(1, 1, false); w = h = 0; } // (re-sized on the next menu frame)
    if (PHONE) sc.traverse(o => { for (const m of o.material ? [].concat(o.material) : []) for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); }); // (uploaded again when shown)
  }
  return { init, render, blink: B, setCrew, makeModel, sleep };
})();

// ---------- pillars per frame ----------
const TRAIL_GLOW = 0; // stepped tiles fade all the way back to dark
// The stones' positions go to the graphics chip only when something changed: re-sending every stone each frame (as
// this did) is what iPhones (iOS 18) choke on after a minute of play. Standing still now sends nothing.
let pillarsKey = '', pillarsDirty = true;
const _nw = [], _nc = [];
function updatePillars(dt, time) {
  const T = heights.length, { N } = maze;
  const k = 220, damp = Math.exp(-15 * dt);
  const empty = maze.empty;
  const stepGlow = curSet.variants[0].glowTex, under = st.gz * N + st.gx;
  let active = false;
  for (let i = 0; i < T; i++) { // the springs, the glow underfoot, the tremble
    if (empty && empty[i]) continue;
    // lights up underfoot, then fades back to dark over a couple of seconds
    if (stepGlow) {
      const g0 = tileGlow[i];
      tileGlow[i] = i === under ? Math.min(1, g0 + dt * 6) : g0 > TRAIL_GLOW ? TRAIL_GLOW + (g0 - TRAIL_GLOW) * Math.exp(-dt * 1.1) : g0;
      if (Math.abs(tileGlow[i] - g0) > 1e-4) active = true;
    }
    if (heights[i] === targets[i] && vels[i] === 0 && shake[i] === 0) continue; // at rest
    active = true;
    vels[i] += (targets[i] - heights[i]) * k * dt;
    vels[i] *= damp;
    heights[i] += vels[i] * dt;
    if (heights[i] < 0) {
      if (targets[i] === 0 && vels[i] < -0.4) sfx.play('land', 0.6, panOf(i % N, (i / N) | 0)); // settles into the floor
      heights[i] = 0; vels[i] = 0;
    }
    if (Math.abs(heights[i] - targets[i]) < 1e-4 && Math.abs(vels[i]) < 1e-3) { heights[i] = targets[i]; vels[i] = 0; } // settled
    shake[i] = Math.max(0, shake[i] - dt * 2.5);
  }
  // how far from the view center flat stones are drawn in full 3D (more when zoomed out)
  // (the view position is rounded to a quarter tile, so a stone is near or far exactly when the key says so)
  const near = Math.round(THREE.MathUtils.clamp((camera.userData.W ?? viewW) * 0.4 + 1.5, 3.5, 6) * 4) / 4, ncx = Math.round(camTarget.x * 4) / 4, ncz = Math.round(camTarget.z * 4) / 4;
  const key = ncx + ',' + ncz + ',' + near;
  if (!active && !pillarsDirty && key === pillarsKey) return; // nothing moved: the graphics chip already has it all
  // the far flat stones only change when the view shifts (stones that rise are always near you, never far)
  const doFloor = pillarsDirty || key !== pillarsKey;
  pillarsKey = key; pillarsDirty = false;
  const aVar = floor.geometry.attributes.aVar;
  const nw = _nw, nc = _nc; nw.length = walls.length; nc.length = caps.length; nw.fill(0); nc.fill(0);
  let nf = 0;
  for (let i = 0; i < T; i++) {
    if (empty && empty[i]) continue; // outside the shape: just the white floor
    // very subtle grinding tremble while a stone moves
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
      if (!doFloor) continue;
      _m.makeRotationY(twist[i]);
      _m.setPosition(x - origin + jx, 0, z - origin + jz);
      floor.setMatrixAt(nf, _m); floor.setColorAt(nf, tint[i]); floorShadow.setMatrixAt(nf, _m);
      aVar.array[nf] = varIdx[i] * 4 + rotIdx[i];
      nf++;
    }
  }
  // send only the part of each buffer that is in use (the buffers have room for the biggest maze)
  walls.forEach((m, v) => { m.count = nw[v]; sendUsed(m.instanceMatrix, nw[v] * 16); sendUsed(m.instanceColor, nw[v] * 3); });
  caps.forEach((m, v) => { m.count = nc[v]; sendUsed(m.instanceMatrix, nc[v] * 16); sendUsed(m.instanceColor, nc[v] * 3); if (stepGlow) sendUsed(m.geometry.attributes.aGlow, nc[v]); });
  if (!doFloor) return;
  floor.count = nf; floorShadow.count = nf;
  sendUsed(floor.instanceMatrix, nf * 16); sendUsed(floorShadow.instanceMatrix, nf * 16); sendUsed(floor.instanceColor, nf * 3); sendUsed(aVar, nf);
}
function sendUsed(attr, n) {
  if (!attr || n <= 0) return;
  attr.clearUpdateRanges(); attr.addUpdateRange(0, n); attr.needsUpdate = true;
}

// ---------- camera ----------
const camTarget = new THREE.Vector3();
const CAM_DIR = new THREE.Vector3(1, Math.tan(THREE.MathUtils.degToRad(54)) * Math.SQRT2, 1).normalize();
const AHEAD = new THREE.Vector3(-0.9, 0, -0.9); // keep more maze visible above the character
// level intro: start close on the portal, pull out to the whole maze, then glide down to the character.
// Every move eases in and out, and the zoom changes at an even rate (interpolated in log space).
const intro = { t: -1, warm: 0, wave: false, online: false, hold: false, t0: 0 };
// online race: everyone's countdown starts together (the host's 'go', minus each player's network delay)
function raceGo(at) { intro.hold = false; intro.goAt = intro.t0 = at; } // (at: this device's clock)
const INTRO = [1.2, 3.4, 3.9, 6.4]; // key hold | out to wide | wide hold | down to the character
const skipIntro = () => {
  if (intro.t < 0 || intro.online) return; // (an online race's intro is shared: nobody can skip ahead)
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
  const focus = portal && portal.visible ? portal.position : key.position; // the portal (where you're headed)
  const keyP = _ka.set(focus.x, 0, focus.z), wide = _kb.set(0, 0, 0);
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
  if (intro.online) intro.t = intro.hold ? 0 : Math.max(0, (performance.now() - intro.t0) / 1000); // real time, not frames
  else { if (intro.warm > 0) { intro.warm--; dt = 0; } intro.t += Math.min(dt, 1 / 30); }
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
  const MOTES = PHONE ? 110 : 220, R = 4.5;
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
  const flake = sprite(x => { // a soft round flake with a faint cool shadow under it, so it reads on white snow
    const sh = x.createRadialGradient(32, 37, 0, 32, 37, 20); sh.addColorStop(0, 'rgba(120,145,185,.45)'); sh.addColorStop(1, 'rgba(120,145,185,0)'); x.fillStyle = sh; x.fillRect(0, 0, 64, 64);
    const g = x.createRadialGradient(31, 30, 0, 32, 32, 17); g.addColorStop(0, '#fff'); g.addColorStop(0.7, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
  const grain = sprite(x => { x.fillStyle = '#fff'; x.beginPath(); x.arc(32, 32, 14, 0, 7); x.fill(); });
  // fall: speed down, sway: side to side, wind: steady sideways drift
  const WEATHER = {
    woods: { tex: soft, colors: ['#ffffff', '#fff8e6'], size: 0.4, n: 90, fall: 0.18, sway: 0.25, wind: 0.08, opacity: 0.8 }, // dandelion fluff
    desert: { tex: grain, colors: ['#e8cfa0', '#d9b77f', '#f3e2c2'], size: 0.16, n: 260, fall: 0.12, sway: 0.1, wind: 1.1, opacity: 0.75 }, // blowing sand
    snow: { tex: flake, colors: ['#ffffff', '#f4f8ff'], size: 0.5, n: 300, fall: 0.26, sway: 0.32, wind: 0.05, opacity: 0.9 }, // slow, soft, drifting
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
// the render resolution follows the frame rate: long frames lower it a step, a long smooth run raises it back
let prNow = PR_MAX, slowT = 0, fastT = 0;
function adaptRes(raw) {
  // phones keep one resolution: every change reallocates the screen buffers (iPhones pile that memory up until Safari
  // closes the page), and the hiccups of loading a level were read as slowness, dropping a step each level
  if (PHONE || state !== 'play' || raw > 0.25) return; // (a hitch from loading or a hidden tab says nothing)
  if (raw > 1 / 42) { slowT += raw; fastT = 0; } else { fastT += raw; if (raw < 1 / 55) slowT = Math.max(0, slowT - raw); }
  const step = slowT > 1.2 && prNow > 0.75 ? -0.25 : !PHONE && fastT > 10 && prNow < PR_MAX ? 0.25 : 0; // (phones only step down)
  if (!step) return;
  prNow = Math.min(PR_MAX, Math.max(0.75, prNow + step)); slowT = fastT = 0;
  renderer.setPixelRatio(prNow); if (!PHONE) composer.setPixelRatio(prNow); fitW = 0; // re-fit at the new resolution
}
function fitView() {
  const w = innerWidth, h = innerHeight;
  if (w === fitW && h === fitH) return;
  fitW = w; fitH = h;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (!PHONE) composer.setSize(w, h);
  tiltH.uniforms.amt.value = 3.2 / w; tiltV.uniforms.amt.value = 3.2 / h; // blur step size in screen texels
  const pr = renderer.getPixelRatio() * (PHONE ? 0.35 : 0.5);
  mirror.getRenderTarget().setSize(Math.round(w * pr), Math.round(h * pr));
}

// ---------- loop ----------
const clock = new THREE.Clock();
let lastDraw = -1e9, stillDrawn = false;
function frame(now = performance.now()) {
  // 120 Hz screens (MacBook Pro, iPad Pro) would draw every frame twice as often for no visible gain: hold ~60 fps
  if (now - lastDraw < 1000 / 75) { requestAnimationFrame(frame); return; }
  lastDraw = now;
  // paused: the maze behind the card is frozen, so draw it once and let the GPU rest (the canvas keeps the last frame)
  const still = !net.online && (state === 'pause' || (state === 'settings' && settingsBack === 'pause') || (state === 'help' && helpBack === 'pause'));
  if (still && stillDrawn) { clock.getDelta(); requestAnimationFrame(frame); return; }
  stillDrawn = still;
  const raw = clock.getDelta(), dt = Math.min(raw, 1 / 20), time = clock.elapsedTime;
  adaptRes(raw);
  fitView();
  updatePlayer(dt, time);
  updateRivals(dt, time);
  updateWarp(dt);
  updatePillars(dt, time);
  doorSpores(dt);
  coach.tick();
  sfx.tick(dt);
  updatePuffs(dt);
  atmosphere.update(dt, time);
  SUNU.uSunView.value.copy(SUN_OFFSET).normalize().transformDirection(camera.matrixWorldInverse);
  GLOW_TIME.value = time;
  key.userData.spin.rotation.y += dt * (key.userData.grab >= 0 ? 14 : 1.6);
  key.userData.glow.material.opacity = 0.5 + 0.12 * Math.sin(time * 2.4);
  if (key.userData.grab >= 0) { // grabbed: hops up over Buddy's head with a little bounce, then flies to its HUD slot
    const k = Math.min(1, (key.userData.grab += dt) / 0.5);
    key.position.x += (player.position.x - key.position.x) * Math.min(1, dt * 9);
    key.position.z += (player.position.z - key.position.z) * Math.min(1, dt * 9);
    key.position.y = 0.55 + Math.sin(Math.PI * Math.min(1, k * 1.2)) * 0.5 + k * 0.6;
    key.scale.setScalar(1 + 0.35 * Math.sin(Math.PI * k));
    key.userData.shadow.visible = false;
    if (k >= 1) { key.userData.grab = -1; flyKeyToHud(); }
  } else {
    key.position.y = 0.42 + Math.sin(time * 2.2) * 0.05 + (won ? Math.min(1.5, (key.userData.wt = (key.userData.wt || 0) + dt) * 2) : 0);
    key.userData.shadow.position.y = 0.02 - key.position.y; key.userData.shadow.visible = true;
  }
  updatePortal(dt, time);
  if (state === 'play' && !won && intro.t < 0) { elapsed += dt; ui.time.textContent = fmt(Math.floor(elapsed)); }
  updateCamera(dt);
  updateFocus();
  updateRaceUI();
  if (state === 'title' || state === 'outfit' || state === 'race' || state === 'friend' || (state === 'settings' && settingsBack === 'title') || (state === 'help' && helpBack === 'title')) face.render(dt, time); // menus are opaque; skip the maze behind them
  else if (state === 'worlds') map3d && map3d.render(dt, time); // the map has its own little 3D board
  else {
    renderer.shadowMap.needsUpdate = true;
    if (PHONE) renderer.render(scene, camera); else composer.render(); // phones: no post effects (memory)
  }
  if (!manualStep) requestAnimationFrame(frame);
}
// ?memdebug: __step(n) draws n frames on demand (measuring works even while the tab isn't on screen)
let manualStep = false;
if (params.has('memdebug')) window.__step = (n = 1) => { manualStep = true; for (let i = 0; i < n; i++) { lastDraw = -1e9; frame(); } manualStep = false; };

{
  let frames = 0, fps = 0;
  const count = () => { frames++; requestAnimationFrame(count); }; requestAnimationFrame(count);
  const dbg = params.has('debug') ? Object.assign(document.body.appendChild(document.createElement('div')), { style: 'position:fixed;left:6px;bottom:6px;z-index:99;font:600 11px ui-monospace,monospace;color:#3b2a1a;background:rgba(255,250,240,.85);padding:4px 7px;border-radius:8px;pointer-events:none' }) : null;
  bb.save = () => {
    const g = window.__gpu ? window.__gpu() : {};
    const rec = { t: Date.now(), start: bb.start, state, level: L, biome, mode, mb: (g.textures || 0) + (g.renderbuffers || 0) + (g.buffers || 0), pr: renderer.getPixelRatio(), fps,
      errs: bb.errs.slice(-4), lost: bb.lost, hidden: document.hidden, clean: 0, ua: navigator.userAgent, scr: `${screen.width}x${screen.height}@${devicePixelRatio}` };
    try { localStorage.setItem(BB_KEY, JSON.stringify(rec)); } catch {}
    if (dbg) dbg.textContent = `${fps} fps · ${rec.mb} MB · x${rec.pr} · ${state}${bb.lost ? ' · reset ' + bb.lost : ''}${bb.errs.length ? ' · err ' + bb.errs.length : ''}`;
  };
  setInterval(() => { fps = frames; frames = 0; bb.save(); }, 1000);
  document.addEventListener('visibilitychange', () => bb.save());
  // last visit ended without a goodbye: show what it was doing
  const P = bbPrev;
  if (P && !P.clean && Date.now() - P.t < 3 * 864e5) {
    const os = (P.ua.match(/OS (\d+[_\d]*) like Mac/) || [])[1], dev = /iPhone/.test(P.ua) ? 'iPhone' : /iPad/.test(P.ua) ? 'iPad' : /Android/.test(P.ua) ? 'Android' : 'Computer';
    const lines = [
      `Screen: ${P.state}${P.state === 'play' ? ` (${P.mode === 'race' ? 'race' : 'level ' + (P.level + 1)}, ${P.biome})` : ''} · played ${Math.round((P.t - P.start) / 60000)} min`,
      `Graphics memory: ${P.mb} MB · quality x${P.pr} · ${P.fps} fps`,
      `In the background: ${P.hidden ? 'yes' : 'no'} · graphics resets: ${P.lost}`,
      `Errors: ${P.errs.length ? P.errs.join(' | ') : 'none'}`,
      `Device: ${dev}${os ? ' iOS ' + os.replace(/_/g, '.') : ''} · ${P.scr}`,
    ];
    const card = document.createElement('div');
    card.style = 'position:fixed;inset:auto 12px 12px 12px;z-index:100;background:#fffaf1;color:#3b2a1a;border-radius:20px;padding:14px 16px;font:600 13px/1.45 Nunito,system-ui,sans-serif;box-shadow:0 10px 30px rgba(80,50,20,.25),inset 0 0 0 2px #ead9bd';
    card.innerHTML = `<b style="font-size:15px">The game closed unexpectedly last time</b><br>Please screenshot this and send it.<div style="margin:8px 0;font-size:12px">${lines.map(l => l.replace(/</g, '&lt;')).join('<br>')}</div><button style="font:800 14px Nunito,system-ui;padding:8px 18px;border-radius:12px;border:0;background:#7cc26b;color:#fff">OK</button>`;
    card.querySelector('button').onclick = () => card.remove();
    document.body.appendChild(card);
  }
}
await load();
{ const ch = await loadChar(charId).catch(() => loadChar('buddy')); charId = ch.id; document.body.dataset.char = charId; setupPlayer(ch); face.init(ch); }
loadScenery(); // in the background; pieces appear as they arrive
setSkin(skin);
await stoneSet(levelBiome(nextLevel()));
buildLevel(nextLevel());
show('title');
{ const j = params.get('join'); if (j) { $('friend').classList.add('guest'); $('friendTitle').textContent = 'Joining your friend…'; show('friend'); net.join(j); } } // opened from an invite: straight in
$('loading').style.opacity = 0; setTimeout(() => $('loading').remove(), 450);
frame();
window.__game = { groundTexture, decorMat, get sceneryModels() { return sceneryModels; }, startRace, get rivals() { return rivals; }, intro, net, loadChar, st, stoneSet, async cave(L) { await stoneSet(levelBiome(L)); await stoneSet("cave"); buildLevel(L, null, { stage: "cave" }); show("play"); intro.t = -1; }, get atmosphere() { return atmosphere; }, scene, get maze() { return maze; }, tryMove, renderer, face, sfx, play, get assets() { return assets; }, get keyAt() { return keyAt; }, get goal() { return goal; }, get hasKey() { return hasKey; }, get portal() { return portal; }, levelPlan, genShapedMaze, SHAPES, show, win };
