// Cute toy-like props built from simple shapes (no model files): trees, tent, mushrooms, flowers, logs, rocks,
// grass clumps, a pond and a campfire. Soft rounded forms and bright candy colors, lit by the scene's lights.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const mats = {};
// one shared material per color: soft matte plastic
export const mat = (color, o = {}) => (mats[color + JSON.stringify(o)] ||= new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...o }));
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };
const mesh = (geo, color, o) => { const m = new THREE.Mesh(geo, typeof color === 'string' ? mat(color, o) : color); m.castShadow = m.receiveShadow = true; return m; };
export const PAL = {
  grass: '#8ccf3a', grassDark: '#78bd2f', leaf: '#36a843', leafDark: '#2f9440', pine: '#2f9bb5', pineDark: '#237f99',
  trunk: '#8a5a36', wood: '#a8683c', woodEnd: '#e9b878', tent: '#f6b52e', tentDark: '#e08a1c', cap: '#e8434b', cream: '#f6efe0',
  rock: '#c9bfae', water: '#43b8ef', star: '#f7c13a',
};

// a cone layer with a soft rounded rim, like a scoop of icing (lathe profile)
function layer(r, h) {
  const pts = [];
  for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI / 2; pts.push(new THREE.Vector2(r * (0.82 + 0.18 * Math.cos(a)), -0.12 * r * Math.sin(a))); }
  pts.reverse();
  pts.push(new THREE.Vector2(0.001, h));
  return new THREE.LatheGeometry([new THREE.Vector2(0.001, -0.12 * r), ...pts], 28);
}
export function pine(s = 1, color = PAL.pine) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 10).translate(0, 0.15, 0), PAL.trunk));
  [[0.42, 0.55, 0.22], [0.33, 0.48, 0.52], [0.23, 0.4, 0.8]].forEach(([r, h, y], i) => {
    const m = mesh(layer(r, h), i % 2 ? color : new THREE.Color(color).offsetHSL(0, 0, 0.03).getStyle());
    m.position.y = y; g.add(m);
  });
  g.scale.setScalar(s);
  return g;
}
export function roundTree(s = 1, leaves = [PAL.leaf, PAL.leafDark, '#55bf55']) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.5, 10).translate(0, 0.25, 0), PAL.trunk));
  for (const [x, y, z, r, c] of [[0, 0.75, 0, 0.36, leaves[0]], [0.2, 0.62, 0.08, 0.24, leaves[1]], [-0.18, 0.64, -0.06, 0.26, leaves[0]], [0.04, 0.98, -0.04, 0.24, leaves[2]]])
    g.add(at(mesh(new THREE.IcosahedronGeometry(r, 3), c), x, y, z));
  g.scale.setScalar(s);
  return g;
}
export function tent(s = 1) {
  const g = new THREE.Group(), w = 0.9, h = 0.75, d = 1.1;
  const shape = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  const body = mesh(new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 3 }).translate(0, 0, -d / 2), PAL.tent);
  g.add(body);
  // the door: a darker triangle on the front, flap folded open
  const door = mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.2, 0), new THREE.Vector2(0.2, 0), new THREE.Vector2(0, 0.42)])), PAL.tentDark);
  door.position.z = d / 2 + 0.04; g.add(door);
  const ridge = mesh(new THREE.CylinderGeometry(0.025, 0.025, d + 0.25, 8).rotateX(Math.PI / 2), PAL.wood);
  ridge.position.y = h + 0.02; g.add(ridge);
  for (const z of [-1, 1]) { const p = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6), PAL.wood); p.position.set(0, h + 0.05, z * (d / 2 + 0.1)); g.add(p); }
  g.scale.setScalar(s);
  return g;
}
export function mushroom(s = 1, cap = PAL.cap) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.14, 12).translate(0, 0.07, 0), PAL.cream));
  const c = mesh(new THREE.SphereGeometry(0.12, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1), cap);
  c.position.y = 0.12; g.add(c);
  for (let i = 0; i < 6; i++) {
    const a = i * 2.1, e = 0.5 + (i % 3) * 0.3, dot = mesh(new THREE.SphereGeometry(0.022, 8, 6).scale(1, 0.5, 1), '#ffffff');
    dot.position.set(Math.cos(a) * Math.sin(e) * 0.12, 0.12 + Math.cos(e) * 0.096, Math.sin(a) * Math.sin(e) * 0.12);
    dot.lookAt(dot.position.clone().multiplyScalar(2).setY(dot.position.y * 2 - 0.12)); g.add(dot);
  }
  g.scale.setScalar(s);
  return g;
}
export function flower(s = 1, petal = '#ffffff') {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 5).translate(0, 0.06, 0), PAL.leafDark));
  for (let i = 0; i < 5; i++) {
    const p = mesh(new THREE.SphereGeometry(0.04, 10, 6).scale(1, 0.3, 0.6), petal), a = i / 5 * Math.PI * 2;
    p.position.set(Math.cos(a) * 0.04, 0.125, Math.sin(a) * 0.04); p.rotation.y = -a; g.add(p);
  }
  g.add(at(mesh(new THREE.SphereGeometry(0.025, 10, 8), '#ffc928'), 0, 0.135, 0));
  g.scale.setScalar(s);
  return g;
}
export function log(s = 1, len = 0.7) {
  const g = new THREE.Group(), r = 0.09;
  const bark = mesh(new THREE.CylinderGeometry(r, r, len, 14, 1, true).rotateZ(Math.PI / 2), PAL.wood);
  g.add(bark);
  for (const k of [-1, 1]) {
    const end = mesh(new THREE.CircleGeometry(r, 14).rotateY(k * Math.PI / 2), PAL.woodEnd);
    end.position.x = k * len / 2; g.add(end);
    const ring = mesh(new THREE.RingGeometry(r * 0.45, r * 0.55, 14).rotateY(k * Math.PI / 2), '#d29a5a');
    ring.position.x = k * (len / 2 + 0.001); g.add(ring);
  }
  g.position.y = r;
  const root = new THREE.Group(); root.add(g); root.scale.setScalar(s);
  return root;
}
export function stump(s = 1) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.16, 14).translate(0, 0.08, 0), PAL.wood));
  g.add(at(mesh(new THREE.CircleGeometry(0.13, 14).rotateX(-Math.PI / 2), PAL.woodEnd), 0, 0.161, 0));
  g.scale.setScalar(s);
  return g;
}
export function rock(s = 1, seed = 1) {
  const geo = new THREE.IcosahedronGeometry(0.16, 2), P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) { const n = 1 + 0.12 * Math.sin(P.getX(i) * 23 + seed) * Math.cos(P.getZ(i) * 19 + seed * 2); P.setXYZ(i, P.getX(i) * n, P.getY(i) * 0.7 * n, P.getZ(i) * n); }
  geo.computeVertexNormals();
  const m = mesh(geo, PAL.rock); m.position.y = 0.06; m.scale.setScalar(s);
  return m;
}
// a clump of tall soft grass blades (rounded capsules)
export function grassClump(s = 1, color = '#c3d64a') {
  const g = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const h = 0.18 + (i % 3) * 0.05, b = mesh(new THREE.CapsuleGeometry(0.03, h, 4, 8).translate(0, h / 2 + 0.03, 0), i % 2 ? color : new THREE.Color(color).offsetHSL(0, 0, -0.06).getStyle());
    b.position.set(((i * 37) % 7 - 3) * 0.035, 0, ((i * 53) % 5 - 2) * 0.04); b.rotation.z = (i % 3 - 1) * 0.12; g.add(b);
  }
  g.scale.setScalar(s);
  return g;
}
export function campfire(s = 1) {
  const g = new THREE.Group();
  for (let i = 0; i < 8; i++) { const r = rock(0.35, i); const a = i / 8 * Math.PI * 2; r.position.set(Math.cos(a) * 0.17, 0.02, Math.sin(a) * 0.17); g.add(r); }
  for (const a of [0.4, 2.2]) { const l = log(0.5, 0.45); l.rotation.y = a; g.add(l); }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 4).translate(0, 0.18, 0), new THREE.MeshBasicMaterial({ color: '#ffd23a' }));
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 4).translate(0, 0.15, 0), new THREE.MeshBasicMaterial({ color: '#fff3b0' }));
  g.add(flame, inner);
  const light = new THREE.PointLight('#ffae42', 1.6, 2.2, 1.6); light.position.y = 0.3; g.add(light);
  g.userData.flame = flame;
  g.scale.setScalar(s);
  return g;
}
// a rounded pond: blue water in a soft sand rim, with lily pads
export function pond(w = 2, d = 1.4) {
  const g = new THREE.Group();
  g.add(at(mesh(new RoundedBoxGeometry(w + 0.16, 0.06, d + 0.16, 4, 0.08), '#d9c99a'), 0, 0.0, 0));
  const water = mesh(new RoundedBoxGeometry(w, 0.06, d, 4, 0.08), new THREE.MeshStandardMaterial({ color: PAL.water, roughness: 0.15, metalness: 0, emissive: '#1a6fb0', emissiveIntensity: 0.15 }));
  water.position.y = 0.012; g.add(water);
  for (const [x, z] of [[-0.5, 0.2], [0.3, -0.35], [0.6, 0.3]]) {
    const pad = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.01, 16, 1, false, 0.3, Math.PI * 1.8), '#5cc35a');
    pad.position.set(x, 0.05, z); g.add(pad);
  }
  return g;
}
// soft rounded board tile (paths, patches of ground)
export function tile(color, w = 1, d = 1, h = 0.12) {
  const m = mesh(new RoundedBoxGeometry(w * 0.96, h, d * 0.96, 3, Math.min(0.05, h / 2.2)), color);
  m.position.y = h / 2;
  return m;
}

// a pine with snow on each layer
export function snowPine(s = 1) {
  const g = pine(1, '#3a8ea6');
  [[0.38, 0.22, 0.3], [0.3, 0.12, 0.6], [0.2, 0.08, 0.92]].forEach(([r, h, y]) => {
    const cap = mesh(new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, h / r, 1), '#ffffff');
    cap.position.y = y + 0.08; g.add(cap);
  });
  g.scale.setScalar(s);
  return g;
}
export function cactus(s = 1) {
  const g = new THREE.Group(), c = '#4cae4f';
  g.add(mesh(new THREE.CapsuleGeometry(0.11, 0.55, 6, 12).translate(0, 0.39, 0), c));
  for (const [x, y, h, k] of [[-0.18, 0.36, 0.2, -1], [0.18, 0.5, 0.16, 1]]) {
    g.add(at(mesh(new THREE.CapsuleGeometry(0.06, 0.12, 4, 10).rotateZ(Math.PI / 2), c), x * 0.7, y - 0.06, 0));
    g.add(at(mesh(new THREE.CapsuleGeometry(0.06, h, 4, 10), c), x, y + h / 2 - 0.04, 0));
  }
  g.add(at(mesh(new THREE.SphereGeometry(0.05, 10, 8), '#ff7fae'), 0, 0.8, 0)); // a little flower on top
  g.scale.setScalar(s);
  return g;
}
export function pyramid(s = 1) {
  const m = mesh(new THREE.ConeGeometry(0.7, 0.75, 4).rotateY(Math.PI / 4).translate(0, 0.375, 0), '#e9c27a');
  m.scale.setScalar(s);
  return m;
}
export function snowman(s = 1) {
  const g = new THREE.Group();
  g.add(at(mesh(new THREE.SphereGeometry(0.2, 18, 14), '#ffffff'), 0, 0.18, 0));
  g.add(at(mesh(new THREE.SphereGeometry(0.14, 18, 14), '#ffffff'), 0, 0.45, 0));
  const nose = mesh(new THREE.ConeGeometry(0.03, 0.12, 8).rotateX(Math.PI / 2), '#ff8a2a'); nose.position.set(0, 0.46, 0.17); g.add(nose);
  for (const x of [-0.05, 0.05]) g.add(at(mesh(new THREE.SphereGeometry(0.018, 8, 6), '#2a2a2a'), x, 0.5, 0.125));
  g.add(at(mesh(new THREE.TorusGeometry(0.11, 0.035, 8, 16).rotateX(Math.PI / 2), '#e8434b'), 0, 0.34, 0));
  g.scale.setScalar(s);
  return g;
}
export function pumpkin(s = 1) {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, b = mesh(new THREE.SphereGeometry(0.1, 14, 10).scale(0.8, 0.85, 1), '#f08a24'); b.position.set(Math.cos(a) * 0.07, 0.1, Math.sin(a) * 0.07); b.rotation.y = -a; g.add(b); }
  g.add(at(mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.07, 6), '#6b8a2a'), 0, 0.21, 0));
  g.scale.setScalar(s);
  return g;
}
export function bridge(len = 1.6) {
  const g = new THREE.Group(), n = Math.round(len / 0.2);
  for (let i = 0; i < n; i++) { const p = mesh(new RoundedBoxGeometry(0.18, 0.06, 0.7, 2, 0.02), i % 2 ? PAL.wood : '#b8774a'); p.position.set(-len / 2 + 0.1 + i * 0.2, 0, 0); g.add(p); }
  for (const z of [-0.33, 0.33]) g.add(at(mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 6).rotateZ(Math.PI / 2), '#8a5a36'), 0, 0.12, z));
  return g;
}
