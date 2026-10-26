// Geometry and texture helpers for the procedural drone: batching by material, rounded plates,
// lofted airfoil blades, wires and ribbons. Everything is metres, like the rest of the world.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const TAU = Math.PI * 2;

// Level of detail: curved surfaces scale their segment counts by this (set once, before building).
let lod = 1;
export const setLod = (v) => { lod = v; };
export const seg = (n, min = 6) => Math.max(min, Math.round(n * lod));

export function canvasTexture(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Collects geometry per material, bakes each transform in, then merges to one mesh per material.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export class Batch {
  constructor() { this.by = new Map(); }

  add(mat, geo, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
    _e.set(r[0], r[1], r[2]);
    _q.setFromEuler(_e);
    _p.set(p[0], p[1], p[2]);
    if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
    return this.addMatrix(mat, geo, _m.compose(_p, _q, _s));
  }

  addMatrix(mat, geo, matrix) {
    const g = geo.clone();
    g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i));
    g.clearGroups();
    if (!this.by.has(mat)) this.by.set(mat, []);
    this.by.get(mat).push(g);
    return this;
  }

  build() {
    const out = new THREE.Group();
    for (const [mat, list] of this.by) {
      const m = new THREE.Mesh(mergeGeometries(list, false), mat);
      const decal = !!mat.userData.decal;
      m.castShadow = !decal;
      m.receiveShadow = true;
      if (decal) m.renderOrder = 1;
      out.add(m);
      for (const g of list) g.dispose();
    }
    return out;
  }
}

export function rbox(w, h, d, r = 0.0008, s = 1) {
  r = Math.min(r, w * 0.499, h * 0.499, d * 0.499);
  if (r < 0.0007) return new THREE.BoxGeometry(w, h, d); // rounding below a pixel is not worth 100 triangles
  return new RoundedBoxGeometry(w, h, d, s, r);
}

export function lathe(pts, n = 24) {
  return new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg(n));
}

export function cyl(rt, rb, h, n = 20, open = false) {
  return new THREE.CylinderGeometry(rt, rb, h, seg(n), 1, open);
}

export function flat(g) {
  const n = g.toNonIndexed();
  n.computeVertexNormals();
  return n;
}

export const hex = (r, h) => flat(new THREE.CylinderGeometry(r, r, h, 6, 1));

// Socket-cap screw, head up, base on y = 0.
let _screw;
export function screwGeo() {
  if (_screw) return _screw;
  const r = 0.0021, h = 0.0017;
  _screw = lathe([[0, 0], [r, 0], [r, h - 0.0003], [r - 0.0003, h], [0.0009, h], [0.0008, h - 0.0007], [0, h - 0.0007]], 6);
  return _screw;
}

// Rounded rectangle on any Path/Shape, counter-clockwise.
export function rr(p, cx, cy, w, h, r) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  p.moveTo(x0 + r, y0);
  p.lineTo(x1 - r, y0);
  p.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  p.lineTo(x1, y1 - r);
  p.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  p.lineTo(x0 + r, y1);
  p.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(x0, y0 + r);
  p.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return p;
}

export function hole(shape, cx, cy, r) {
  const h = new THREE.Path();
  h.absarc(cx, cy, r, 0, TAU, true);
  shape.holes.push(h);
}

export function rrHole(shape, cx, cy, w, h, r) {
  shape.holes.push(rr(new THREE.Path(), cx, cy, w, h, r));
}

// Flat bevelled plate lying in XZ (shape +y points to -z), centred on y = 0.
export function slab(shape, t, b = 0.0005, curve = 8) {
  const depth = Math.max(t - 2 * b, 0.0001);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: lod < 1 ? 1 : 2, curveSegments: seg(curve, 3) });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -depth / 2, 0);
  return g;
}

// Map a flat part into 0..1 UVs from its XZ bounds (v up = -z), or tile it by `tile` repeats per metre.
export function planarUV(g, tile = 0) {
  g.computeBoundingBox();
  const b = g.boundingBox, p = g.attributes.position;
  const w = b.max.x - b.min.x, d = b.max.z - b.min.z;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    uv[i * 2] = tile ? x * tile : (x - b.min.x) / w;
    uv[i * 2 + 1] = tile ? -z * tile : (b.max.z - z) / d;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// Flat quad that faces up and carries a printed label (upright when viewed from +z).
export const decal = (w, h) => new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2);

export function wire(points, r, radial = 6, segs = 0) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  return new THREE.TubeGeometry(c, segs || Math.max(8, points.length * 7), r, Math.max(4, Math.round(radial * Math.min(1, lod + 0.3))), false);
}

// Midpoint hanging `drop` below the straight line, so a cable reads as having weight.
export function sag(a, b, drop, mid = 0.5) {
  return [a, [a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid - drop, a[2] + (b[2] - a[2]) * mid], b];
}

// Flat ribbon cable: rectangular section swept along a curve, `side` is the (fixed) width direction.
export function ribbon(points, width, thick, side = [1, 0, 0], segs = 24) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  const S = new THREE.Vector3(...side).normalize();
  const pos = [], idx = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), q = new THREE.Vector3();
  const stations = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    c.getPointAt(t, q);
    c.getTangentAt(t, T);
    N.crossVectors(T, S).normalize();
    stations.push(corners.map(([a, b]) => q.clone().addScaledVector(S, a * width / 2).addScaledVector(N, b * thick / 2)));
  }
  // one strip per face so edges stay crisp
  for (let f = 0; f < 4; f++) {
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const a = stations[i][f], b = stations[i][(f + 1) % 4];
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    for (let i = 0; i < segs; i++) {
      const k = base + i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// One propeller blade along +x. Leading edge on -z (the blade turns towards -z), pitched so the
// leading edge is high. Cambered NACA-style section, chord and twist varying along the span.
export function bladeGeo(R = 0.127, root = 0.004) {
  const N = seg(26, 12), P = seg(10, 6), ring = P * 2;
  const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const poly = (x) => (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4) * 10;
  const pos = [], uv = [], idx = [];
  const cmax = 0.0235;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const t = 1 - (1 - u) ** 1.6; // denser near the tip where the chord closes up
    const r = root + (R - root) * t;
    const chord = t < 0.72
      ? 0.0085 + (cmax - 0.0085) * Math.sin((t / 0.72) * Math.PI / 2) ** 1.3
      : cmax * Math.sqrt(Math.max(0, 1 - ((t - 0.72) / 0.28) ** 2));
    const c = Math.max(chord, 0.0005);
    const th = 0.0026 * (1 - t) + 0.0007;
    const a = THREE.MathUtils.degToRad(6 + 26 * (1 - t) ** 1.2);
    const sw = 0.0022 * t * t;
    const sa = Math.sin(a), ca = Math.cos(a);
    for (let j = 0; j < ring; j++) {
      const upper = j <= P;
      const s = upper ? j / P : (ring - j) / P;
      const xc = (1 - Math.cos(Math.PI * s)) / 2;
      const camber = 0.055 * c * 4 * xc * (1 - xc);
      const y0 = camber + (upper ? 1 : -1) * (th / 2) * poly(xc);
      const z0 = (xc - 0.28) * c;
      pos.push(r, y0 * ca - z0 * sa, y0 * sa + z0 * ca + sw);
      uv.push(u, 1 - s);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * ring + j, b = i * ring + ((j + 1) % ring), c = (i + 1) * ring + j, d = (i + 1) * ring + ((j + 1) % ring);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Twill carbon-fibre weave tile (seamless, 2/2 pattern).
export function carbonTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    const n = 8, cell = w / n;
    g.fillStyle = '#0b0b0c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const warp = ((i - j + 8) % 4) < 2;
        const x = i * cell, y = j * cell;
        const grd = warp ? g.createLinearGradient(x, 0, x + cell, 0) : g.createLinearGradient(0, y, 0, y + cell);
        grd.addColorStop(0, '#2c2d31');
        grd.addColorStop(0.45, '#6a6b72');
        grd.addColorStop(1, '#1d1d20');
        g.fillStyle = grd;
        g.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
      }
    }
  }, { repeat: true });
}
