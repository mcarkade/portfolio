// Procedural F450 quadcopter, modelled after the real build (red arms, gold A2212 motors,
// Pixhawk under a blue-cased Raspberry Pi 4). Every part can fly apart along its own vector.
// Detail lives in merged, bevelled geometry plus small printed textures; droneKit.js has the helpers.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Batch, TAU, setLod, seg, canvasTexture, rbox, lathe, cyl, hex, screwGeo, rr, hole, rrHole, slab,
  planarUV, decal, wire, ribbon, bladeGeo, carbonTexture,
} from './droneKit.js';

const ARM_R = 0.205; // motor radius from centre (F450 ≈ 450 mm motor-to-motor)
const PLATE_GAP = 0.024;
const yTop = PLATE_GAP / 2, yBot = -PLATE_GAP / 2;
const PLATE_T = 0.0016;
const PLATE_TOP = yTop + 0.001 + PLATE_T; // top face of the upper plate
const ARM_SCREWS = [0.055, 0.011]; // radial, lateral position of the bolts holding each arm

const FONT = 'Arial, Helvetica, sans-serif';
const text = (g, s, x, y, size, color, weight = '700', align = 'left') => {
  g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic';
  g.fillText(s, x, y);
};

const decalMat = (map) => new THREE.MeshStandardMaterial({
  map, transparent: true, roughness: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  userData: { decal: true },
});

function materials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  const carbonMap = carbonTexture();
  const glow = (c, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) });
  return {
    red: phys({ color: 0xb30f19, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.26 }),
    redLeg: phys({ color: 0xa30d16, roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.3 }),
    carbon: phys({ color: 0xffffff, map: carbonMap, roughness: 0.34, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
    gold: std({ color: 0xd2a23f, metalness: 1, roughness: 0.27 }),
    brass: std({ color: 0xbc9840, metalness: 1, roughness: 0.36 }),
    steel: std({ color: 0xcdd1d6, metalness: 1, roughness: 0.24 }),
    screw: std({ color: 0x3a3b3f, metalness: 0.9, roughness: 0.42 }), // black-oxide hardware
    tie: std({ color: 0x1d1d20, roughness: 0.6 }),
    copper: std({ color: 0xd08a4a, metalness: 1, roughness: 0.3 }),
    silver: std({ color: 0xc4c8ce, metalness: 0.9, roughness: 0.34 }),
    blackAlu: std({ color: 0x232326, metalness: 0.9, roughness: 0.38 }),
    black: phys({ color: 0x111113, roughness: 0.46, clearcoat: 0.3, clearcoatRoughness: 0.35 }),
    glass: phys({ color: 0x07090f, roughness: 0.06, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 }),
    rubber: std({ color: 0x161618, roughness: 0.92 }),
    foam: std({ color: 0x1b1b1d, roughness: 1 }),
    lipo: phys({ color: 0x1b2230, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.3 }),
    escBlue: phys({ color: 0x1a38a6, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15 }),
    piBlue: phys({ color: 0x1c3fd0, roughness: 0.36, clearcoat: 0.8, clearcoatRoughness: 0.12 }),
    green: phys({ color: 0x0d5a36, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
    yellow: std({ color: 0xe0b021, roughness: 0.42 }),
    white: std({ color: 0xb5b3ad, roughness: 0.6 }),
    ribbon: std({ color: 0xb87a2a, roughness: 0.55 }),
    wireRed: phys({ color: 0xb0121a, roughness: 0.4, clearcoat: 0.3 }),
    wireBlack: phys({ color: 0x0c0c0e, roughness: 0.4, clearcoat: 0.3 }),
    wireYel: phys({ color: 0xc9a019, roughness: 0.4, clearcoat: 0.3 }),
    wireWhite: phys({ color: 0xa9a7a1, roughness: 0.5, clearcoat: 0.2 }),
    led: glow(0xff2a2a, 2.2),
    ledG: glow(0x3cff7a, 2.2),
    ledB: glow(0x3a7bff, 2.2),
  };
}

// ---------- frame ----------

function plateShape(r0) {
  // F450-style plate: a rounded square with an arm tab on each diagonal.
  const pts = [], n = seg(96, 48);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = Math.round((a - Math.PI / 4) / (Math.PI / 2));
    const d = a - (Math.PI / 4 + k * Math.PI / 2);
    const tab = Math.exp(-((d / 0.3) ** 2));
    const rad = r0 * (0.86 + 0.4 * tab);
    pts.push(new THREE.Vector2(Math.cos(a) * rad, Math.sin(a) * rad));
  }
  const s = new THREE.Shape();
  s.setFromPoints(pts);
  s.closePath();
  return s;
}

const armDir = (i) => { const a = Math.PI / 4 + (i * Math.PI) / 2; return [Math.cos(a), -Math.sin(a), a]; };

function buildTopPlate(M) {
  const B = new Batch();
  const s = plateShape(0.072);
  rrHole(s, 0, 0, 0.036, 0.016, 0.006);
  for (const sx of [-1, 1]) rrHole(s, sx * 0.052, 0, 0.008, 0.02, 0.003);
  for (const [x, y] of [[0.04, 0], [-0.04, 0], [0, 0.04], [0, -0.04]]) hole(s, x, y, 0.0026);
  const g = slab(s, PLATE_T, 0.0004, 6);
  planarUV(g, 50);
  B.add(M.carbon, g);
  const top = PLATE_T / 2;
  for (const [x, z] of [[0.04, 0], [-0.04, 0], [0, 0.04], [0, -0.04]]) B.add(M.screw, screwGeo(), [x, top, z]);
  for (let i = 0; i < 4; i++) {
    const [dx, dz] = armDir(i);
    for (const s2 of [-1, 1]) {
      const r = ARM_SCREWS[0], l = ARM_SCREWS[1] * s2;
      B.add(M.screw, screwGeo(), [dx * r - dz * l, top, dz * r + dx * l]);
    }
  }
  return B.build();
}

function pdbTexture(bb) {
  const S = 1024;
  const px = (x) => ((x - bb.minX) / bb.w) * S;
  const pz = (z) => ((z - bb.minZ) / bb.d) * S;
  const k = S / bb.w;
  return canvasTexture(S, S, (g) => {
    g.fillStyle = '#0f3b2c'; g.fillRect(0, 0, S, S);
    // copper pours under the mask, from each ESC pad pair to the battery pads
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < 4; i++) {
      const [dx, dz] = armDir(i);
      for (const side of [-1, 1]) {
        g.strokeStyle = side > 0 ? '#1f6b50' : '#186049';
        g.lineWidth = 0.0065 * k;
        g.beginPath();
        g.moveTo(px(dx * 0.062 - dz * side * 0.0085), pz(dz * 0.062 + dx * side * 0.0085));
        g.lineTo(px(dx * 0.036 - dz * side * 0.0085), pz(dz * 0.036 + dx * side * 0.0085));
        g.lineTo(px(side * 0.0085), pz(0.03));
        g.stroke();
      }
    }
    // fine signal traces
    g.strokeStyle = '#1b5c46'; g.lineWidth = 0.0008 * k;
    for (let n = 0; n < 26; n++) {
      const a = (n / 26) * TAU, r0 = 0.02 + (n % 5) * 0.0045;
      g.beginPath();
      g.moveTo(px(Math.cos(a) * r0), pz(Math.sin(a) * r0));
      g.lineTo(px(Math.cos(a + 0.2) * (r0 + 0.012)), pz(Math.sin(a + 0.2) * (r0 + 0.012)));
      g.lineTo(px(Math.cos(a + 0.2) * (r0 + 0.026)), pz(Math.sin(a + 0.2) * (r0 + 0.026)));
      g.stroke();
    }
    // ESC pads: gold plated, with a silkscreen outline and label
    for (let i = 0; i < 4; i++) {
      const [dx, dz, a] = armDir(i);
      g.save();
      g.translate(px(dx * 0.057), pz(dz * 0.057));
      g.rotate(-a);
      for (const side of [-1, 1]) {
        g.fillStyle = '#d4aa55';
        g.beginPath(); g.roundRect(-0.0062 * k, side * 0.0085 * k - 0.0036 * k, 0.0124 * k, 0.0072 * k, 0.0012 * k); g.fill();
        g.fillStyle = '#7a5a1a';
        g.beginPath(); g.arc(-0.002 * k, side * 0.0085 * k, 0.0011 * k, 0, TAU); g.fill();
        text(g, side > 0 ? '+' : '-', 0.0068 * k, side * 0.0085 * k + 0.0013 * k, 0.0042 * k, '#ece9df');
      }
      g.strokeStyle = '#ece9df'; g.lineWidth = 0.0005 * k;
      g.strokeRect(-0.0085 * k, -0.0145 * k, 0.017 * k, 0.029 * k);
      text(g, `ESC${i + 1}`, -0.012 * k, 0.0014 * k, 0.0038 * k, '#ece9df', '700', 'center');
      g.restore();
    }
    // battery pads
    for (const side of [-1, 1]) {
      g.fillStyle = '#d4aa55';
      g.beginPath(); g.roundRect(px(side * 0.0085) - 0.004 * k, pz(0.03) - 0.007 * k, 0.008 * k, 0.014 * k, 0.0014 * k); g.fill();
      text(g, side > 0 ? '+' : '-', px(side * 0.0085), pz(0.03) + 0.0015 * k, 0.005 * k, '#31230a', '700', 'center');
    }
    // mounting hole rings
    g.strokeStyle = '#ece9df'; g.lineWidth = 0.0005 * k;
    for (const [x, z] of [[0.04, 0], [-0.04, 0], [0, 0.04], [0, -0.04]]) { g.beginPath(); g.arc(px(x), pz(z), 0.0042 * k, 0, TAU); g.stroke(); }
    // silkscreen
    text(g, 'F450 PDB', px(-0.03), pz(-0.012), 0.0062 * k, '#ece9df');
    text(g, 'V2.1  12V / 5V BEC', px(-0.03), pz(-0.005), 0.0034 * k, '#c9c6bb', '600');
    text(g, 'BAT', px(0), pz(0.045), 0.0038 * k, '#ece9df', '700', 'center');
    g.strokeStyle = '#ece9df'; g.lineWidth = 0.0006 * k;
    g.strokeRect(px(-0.014), pz(0.0185), 0.028 * k, 0.0245 * k);
  });
}

function buildPdb(M) {
  const B = new Batch();
  const s = plateShape(0.072);
  const g = slab(s, PLATE_T, 0.0003, 6);
  planarUV(g);
  g.computeBoundingBox();
  const bb = { minX: g.boundingBox.min.x, minZ: g.boundingBox.min.z, w: g.boundingBox.max.x - g.boundingBox.min.x, d: g.boundingBox.max.z - g.boundingBox.min.z };
  const mat = new THREE.MeshPhysicalMaterial({ map: pdbTexture(bb), roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.2 });
  B.add(mat, g);
  const top = PLATE_T / 2;
  // components on the board
  for (const x of [-0.027, -0.0165]) {
    B.add(M.black, cyl(0.0035, 0.0035, 0.0078, 18), [x, top + 0.0039, -0.03]);
    B.add(M.silver, cyl(0.0031, 0.0031, 0.0004, 18), [x, top + 0.0079, -0.03]);
  }
  B.add(M.black, rbox(0.011, 0.0022, 0.008, 0.0004), [0.02, top + 0.0011, -0.03]);
  for (let k = 0; k < 3; k++) B.add(M.gold, cyl(0.0004, 0.0004, 0.0075, 6), [0.034, top + 0.0037, -0.0455 + k * 0.0025]);
  B.add(M.black, rbox(0.0035, 0.0025, 0.0095, 0.0004), [0.034, top + 0.0013, -0.0425]);
  B.add(M.led, rbox(0.0024, 0.0008, 0.0014, 0.0002), [0.03, top + 0.0004, -0.012]);
  // standoff screws underneath
  for (const [x, z] of [[0.04, 0], [-0.04, 0], [0, 0.04], [0, -0.04]]) B.add(M.screw, screwGeo(), [x, -top, z], [Math.PI, 0, 0]);
  // main battery leads down to the XT60
  for (const side of [-1, 1]) {
    const m = side > 0 ? M.wireRed : M.wireBlack;
    B.add(m, wire([[side * 0.0085, 0.0015, 0.03], [side * 0.0088, -0.0035, 0.052], [side * 0.0088, -0.0045, 0.085], [side * 0.0082, -0.012, 0.1], [side * 0.0078, -0.0252, 0.1]], 0.0021, 8, 40));
  }
  B.add(M.yellow, rbox(0.0158, 0.0082, 0.016, 0.0014, 2), [0, -0.0292, 0.1]);
  return { group: B.build() };
}

function buildPosts(M) {
  const B = new Batch();
  const hx = hex(0.0034, PLATE_GAP);
  for (const [x, z] of [[0.04, 0], [-0.04, 0], [0, 0.04], [0, -0.04]]) B.add(M.brass, hx, [x, 0, z]);
  return B.build();
}

// ---------- arms, legs, ESCs ----------

function armTexture() {
  return canvasTexture(1024, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    text(g, 'F450', 28, h * 0.72, h * 0.62, 'rgba(244,240,232,0.92)', '800');
    g.fillStyle = 'rgba(30,6,8,0.55)';
    for (let k = 0; k < 4; k++) { g.beginPath(); g.roundRect(w * 0.3 + k * 64, h * 0.16, 44, h * 0.68, 12); g.fill(); }
    g.fillStyle = 'rgba(244,240,232,0.9)';
    for (let k = 0; k < 4; k++) {
      const x = w * 0.68 + k * 62;
      g.beginPath(); g.moveTo(x, h * 0.2); g.lineTo(x + 38, h * 0.5); g.lineTo(x, h * 0.8); g.lineTo(x + 14, h * 0.8); g.lineTo(x + 52, h * 0.5); g.lineTo(x + 14, h * 0.2); g.closePath(); g.fill();
    }
  });
}

function buildArm(M) {
  const B = new Batch();
  const W = 0.0246, H = 0.018, t = 0.0022, r = 0.0042;
  const x0 = 0.03, L = ARM_R - 0.012 - x0, taper = 0.14;
  const w = W / 2, h0 = -H / 2, h1 = H / 2, ri = r * 0.55;
  const s = new THREE.Shape();
  s.moveTo(-w, h0);
  s.lineTo(-w, h1 - r);
  s.quadraticCurveTo(-w, h1, -w + r, h1);
  s.lineTo(w - r, h1);
  s.quadraticCurveTo(w, h1, w, h1 - r);
  s.lineTo(w, h0);
  s.lineTo(w - t, h0);
  s.lineTo(w - t, h1 - t - ri);
  s.quadraticCurveTo(w - t, h1 - t, w - t - ri, h1 - t);
  s.lineTo(-w + t + ri, h1 - t);
  s.quadraticCurveTo(-w + t, h1 - t, -w + t, h1 - t - ri);
  s.lineTo(-w + t, h0);
  s.closePath();
  let g = new THREE.ExtrudeGeometry(s, { depth: L, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelSegments: 1, curveSegments: 5 });
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (1 - taper * THREE.MathUtils.clamp(p.getZ(i) / L, 0, 1)));
  g.rotateY(Math.PI / 2);
  g.translate(x0, 0, 0);
  g = toCreasedNormals(g, 0.7);
  B.add(M.red, g);
  // ribs across the channel, and a bulkhead closing the root
  for (let k = 0; k < 6; k++) {
    const x = 0.062 + k * 0.02, f = (x - x0) / L;
    B.add(M.red, rbox(0.0014, H - t - 0.0004, W * (1 - taper * f) - 2 * t + 0.0006, 0.0003), [x, -t / 2, 0]);
  }
  B.add(M.red, rbox(0.0022, H - 0.001, W - 0.001, 0.0006), [x0 + 0.0012, 0, 0]);
  // motor mount: flat pad with the A2212 bolt pattern and a cable hole
  const m = new THREE.Shape();
  rr(m, 0, 0, 0.044, 0.036, 0.0075);
  hole(m, 0, 0, 0.0045);
  for (const [x, y] of [[0.0095, 0], [-0.0095, 0], [0, 0.0095], [0, -0.0095]]) hole(m, x, y, 0.0016);
  B.add(M.red, toCreasedNormals(slab(m, 0.006, 0.0006, 6), 0.7), [ARM_R, 0.0065, 0]);
  const dm = decalMat(armTexture());
  B.add(dm, decal(0.07, 0.0095), [0.118, h1 + 0.0004, 0]);
  return B.build();
}

function buildLeg(M) {
  const B = new Batch();
  B.add(M.redLeg, lathe([
    [0, 0.0005], [0.0098, 0.0005], [0.0098, -0.0024], [0.0088, -0.0034], [0.0072, -0.0036], [0.0067, -0.0075],
    [0.0064, -0.0185], [0.0067, -0.0192], [0.0067, -0.0204], [0.0063, -0.0211], [0.0060, -0.034], [0.0054, -0.044], [0.0049, -0.0535], [0, -0.0535],
  ], 28));
  B.add(M.rubber, lathe([[0, -0.0525], [0.0049, -0.0525], [0.0066, -0.0546], [0.0071, -0.06], [0.0062, -0.0664], [0.004, -0.0678], [0, -0.0678]], 24));
  return B.build();
}

function escTexture() {
  return canvasTexture(512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    text(g, '30A', 24, 112, 100, 'rgba(240,240,236,0.95)', '800');
    text(g, 'OPTO ESC', 24, 170, 46, 'rgba(240,240,236,0.9)', '700');
    text(g, '2-4S LiPo   BEC 5V/2A', 24, 218, 30, 'rgba(210,214,230,0.85)', '600');
    g.fillStyle = 'rgba(240,240,236,0.9)';
    for (let k = 0; k < 22; k++) g.fillRect(300 + k * 9, 40, k % 3 === 0 ? 6 : 3, 60);
    g.strokeStyle = 'rgba(240,240,236,0.8)'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(430, 150); g.lineTo(486, 150); g.lineTo(458, 110); g.closePath(); g.stroke();
  });
}

function buildEsc(M) {
  const B = new Batch();
  B.add(M.escBlue, rbox(0.046, 0.011, 0.022, 0.0024, 1));
  B.add(M.escBlue, rbox(0.04, 0.0007, 0.003, 0.0003), [0, 0.0055, 0.008]); // shrink-wrap seam
  for (const x of [-0.012, 0.012]) B.add(M.black, rbox(0.0028, 0.0118, 0.0228, 0.0012), [x, 0, 0]); // tape bands
  B.add(decalMat(escTexture()), decal(0.026, 0.0165), [-0.0045, 0.0058, 0]);
  // cable sleeves and solder tails
  for (const side of [-1, 1]) B.add(M.black, cyl(0.0042, 0.0042, 0.0055, 12), [side * 0.0245, 0, 0], [0, 0, Math.PI / 2]);
  // zip ties holding the ESC to the arm
  const tie = new THREE.Shape();
  rr(tie, 0, 0.0118, 0.0258, 0.0388, 0.005);
  tie.holes.push(rr(new THREE.Path(), 0, 0.0118, 0.0234, 0.0364, 0.0042));
  const tg = new THREE.ExtrudeGeometry(tie, { depth: 0.0026, bevelEnabled: false, curveSegments: 3 }).rotateY(Math.PI / 2);
  for (const x of [-0.0178, 0.0178]) {
    B.add(M.tie, tg, [x - 0.0013, 0, 0]);
    B.add(M.tie, rbox(0.0034, 0.004, 0.0046, 0.0008), [x, 0.0118, 0.0136]);
  }
  // three motor phase wires, run up inside the arm channel to the motor
  const mats = [M.wireBlack, M.wireRed, M.wireYel];
  for (let k = 0; k < 3; k++) {
    const z = (k - 1) * 0.0045;
    B.add(mats[k], wire([[0.0245, 0, z], [0.04, 0.005, z * 0.9], [0.058, 0.0122, z * 0.7], [0.085, 0.0128, z * 0.5], [0.098, 0.0165, z * 0.3], [0.105, 0.0225, 0]], 0.0012, 6, 36));
  }
  // power leads back to the distribution board, and a signal lead with its plug
  for (const side of [-1, 1]) {
    B.add(side > 0 ? M.wireRed : M.wireBlack, wire([[-0.0245, 0, side * 0.0055], [-0.034, 0.0035, side * 0.007], [-0.047, 0.0072, side * 0.0085]], 0.0017, 6, 16));
  }
  const sig = [M.wireBlack, M.wireRed, M.wireWhite];
  for (let k = 0; k < 3; k++) B.add(sig[k], wire([[-0.0245, 0.0, (k - 1) * 0.0018 - 0.0005], [-0.034, -0.0055, (k - 1) * 0.0018], [-0.044, -0.013, (k - 1) * 0.0018]], 0.0006, 5, 14));
  B.add(M.black, rbox(0.004, 0.0075, 0.0072, 0.0008), [-0.0455, -0.0155, 0]);
  return B.build();
}

// ---------- motor and propeller ----------

function buildMotor(M) {
  const B = new Batch();
  // black mounting cross with its four bolts
  B.add(M.blackAlu, rbox(0.0345, 0.0024, 0.0072, 0.0008), [0, 0.0012, 0]);
  B.add(M.blackAlu, rbox(0.0072, 0.0024, 0.0345, 0.0008), [0, 0.0012, 0]);
  for (const [x, z] of [[0.0125, 0], [-0.0125, 0], [0, 0.0125], [0, -0.0125]]) B.add(M.screw, screwGeo(), [x, 0.0024, z]);
  B.add(M.blackAlu, lathe([[0, 0.0024], [0.0102, 0.0024], [0.0102, 0.0046], [0.0095, 0.005], [0, 0.005]], 28));
  // stator windings seen through the vented skirt
  B.add(M.blackAlu, cyl(0.0088, 0.0088, 0.0076, 24), [0, 0.0087, 0]);
  const lobe = rbox(0.0036, 0.0058, 0.003, 0.0006);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    B.add(M.copper, lobe, [Math.cos(a) * 0.0107, 0.0095, Math.sin(a) * 0.0107], [0, -a, 0]);
  }
  // bell: rim, 12 skirt bars, grooved wall, spoked top
  B.add(M.gold, lathe([[0.0127, 0.0048], [0.0147, 0.0048], [0.0147, 0.0066], [0.0127, 0.0066]], 36));
  const bar = rbox(0.002, 0.0062, 0.0044, 0.0004);
  for (let k = 0; k < 12; k++) {
    const a = ((k + 0.5) / 12) * TAU;
    B.add(M.gold, bar, [Math.cos(a) * 0.0137, 0.0097, Math.sin(a) * 0.0137], [0, -a, 0]);
  }
  B.add(M.gold, lathe([
    [0.0127, 0.0125], [0.0147, 0.0125], [0.0147, 0.0182], [0.0144, 0.0184], [0.0144, 0.019], [0.0147, 0.0192],
    [0.0147, 0.0253], [0.0141, 0.0263], [0.0127, 0.0263],
  ], 40));
  const top = new THREE.Shape();
  top.absarc(0, 0, 0.0141, 0, TAU, false);
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * TAU + 0.2, a1 = a0 + TAU / 6 - 0.4, rO = 0.0118, rI = 0.0064;
    const win = new THREE.Path();
    win.moveTo(Math.cos(a0) * rI, Math.sin(a0) * rI);
    win.lineTo(Math.cos(a0) * rO, Math.sin(a0) * rO);
    win.absarc(0, 0, rO, a0, a1, false);
    win.lineTo(Math.cos(a1) * rI, Math.sin(a1) * rI);
    win.absarc(0, 0, rI, a1, a0, true);
    top.holes.push(win);
  }
  B.add(M.gold, slab(top, 0.0014, 0, 6), [0, 0.027, 0]);
  B.add(M.gold, lathe([[0, 0.0263], [0.0066, 0.0263], [0.0066, 0.0277], [0.0058, 0.029], [0.0036, 0.0293], [0, 0.0293]], 24));
  B.add(M.steel, cyl(0.0019, 0.0019, 0.033, 12), [0, 0.017, 0]);
  return B.build();
}

function bladeTexture(cw) {
  return canvasTexture(512, 64, (g, w, h) => {
    g.fillStyle = '#17181b'; g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,255,255,0.05)'); grd.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ece6da'; g.fillRect(w * 0.935, 0, w, h);
    g.fillStyle = '#c4121b'; g.fillRect(w * 0.918, 0, w * 0.017, h);
    // the clockwise prop is a mirror image, so its print is drawn flipped to read correctly
    if (cw) { g.translate(0, h); g.scale(1, -1); }
    text(g, '1045', w * 0.15, h * 0.62, h * 0.5, 'rgba(225,225,222,0.85)', '700');
    text(g, cw ? 'CW' : 'CCW', w * 0.34, h * 0.62, h * 0.38, 'rgba(225,225,222,0.7)', '600');
  });
}

function buildRotor(M, bladeMat, geo, ccw) {
  const rotor = new THREE.Group();
  for (let b = 0; b < 2; b++) {
    const blade = new THREE.Mesh(geo, bladeMat);
    blade.castShadow = blade.receiveShadow = true;
    blade.rotation.y = b * Math.PI;
    if (!ccw) blade.scale.z = -1;
    rotor.add(blade);
  }
  const B = new Batch();
  B.add(M.black, lathe([[0.0026, -0.003], [0.009, -0.003], [0.0097, -0.0022], [0.0097, 0.001], [0.0085, 0.003], [0.0026, 0.003]], 32));
  B.add(M.gold, lathe([[0, 0.003], [0.0058, 0.003], [0.0063, 0.0038], [0.006, 0.0055], [0.0046, 0.0073], [0.002, 0.0083], [0, 0.0085]], 28));
  for (const m of [...B.build().children]) rotor.add(m);
  return rotor;
}

// ---------- electronics ----------

function pixhawkTexture() {
  return canvasTexture(768, 448, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    text(g, 'Pixhawk', 44, 150, 118, '#f1f1ee', '800');
    text(g, 'PX4  FMU 2.4.8   ·   32-bit ARM Cortex-M4', 46, 208, 32, 'rgba(215,218,225,0.85)', '600');
    g.fillStyle = '#d6d9de';
    g.beginPath(); g.moveTo(640, 70); g.lineTo(704, 190); g.lineTo(640, 162); g.lineTo(576, 190); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(215,218,225,0.5)'; g.lineWidth = 3;
    for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(44 + k * 112, 290); g.lineTo(44 + k * 112, 400); g.stroke(); }
    ['MAIN OUT', 'AUX', 'SBUS', 'GPS', 'TELEM', 'I2C'].forEach((s, k) => text(g, s, 48 + k * 112, 276, 24, 'rgba(215,218,225,0.8)', '700'));
  });
}

function buildPixhawk(M) {
  const B = new Batch();
  B.add(M.foam, rbox(0.072, 0.0022, 0.042, 0.0006), [0, 0.0011, 0]);
  B.add(M.silver, rbox(0.082, 0.0148, 0.05, 0.0024, 2), [0, 0.0096, 0]);
  B.add(M.glass, rbox(0.068, 0.0008, 0.04, 0.0016), [0, 0.0169, 0]);
  B.add(decalMat(pixhawkTexture()), decal(0.066, 0.0385), [0, 0.0174, 0]);
  const jst = rbox(0.0074, 0.0054, 0.0034, 0.0008);
  for (let k = 0; k < 6; k++) {
    B.add(M.black, jst, [-0.03 + k * 0.012, 0.0085, 0.0266]);
    B.add(M.silver, rbox(0.0048, 0.0014, 0.0006, 0.0002), [-0.03 + k * 0.012, 0.0085, 0.0284]);
  }
  B.add(M.steel, rbox(0.0072, 0.0026, 0.0024, 0.0006), [0.0345, 0.0075, 0.0256]);
  B.add(M.black, rbox(0.0014, 0.0014, 0.0075, 0.0004), [-0.0412, 0.0085, 0]); // SD slot
  B.add(new THREE.MeshStandardMaterial({ color: 0xc4121b, roughness: 0.4 }), cyl(0.0023, 0.0023, 0.0022, 14), [0.032, 0.0183, -0.0138]);
  B.add(M.led, rbox(0.003, 0.0008, 0.0016, 0.0002), [0.028, 0.0173, -0.0035]);
  B.add(M.ledB, rbox(0.003, 0.0008, 0.0016, 0.0002), [0.028, 0.0173, -0.0003]);
  B.add(M.ledG, rbox(0.003, 0.0008, 0.0016, 0.0002), [0.028, 0.0173, 0.0029]);
  return B.build();
}

function piLogoTexture() {
  return canvasTexture(512, 192, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#d6203a';
    for (const [x, y] of [[62, 58], [96, 52], [80, 82], [44, 86], [114, 86], [62, 112], [98, 112], [80, 138]]) { g.beginPath(); g.arc(x, y, 17, 0, TAU); g.fill(); }
    g.fillStyle = '#45b05a';
    g.beginPath(); g.ellipse(58, 30, 22, 9, -0.5, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(102, 30, 22, 9, 0.5, 0, TAU); g.fill();
    text(g, 'Raspberry Pi', 160, 100, 62, 'rgba(240,242,255,0.95)', '700');
    text(g, 'Model 4B   ·   4 GB', 162, 150, 34, 'rgba(210,218,255,0.8)', '600');
  });
}

function buildPi(M) {
  const B = new Batch();
  const tray = 0.0122, lid = 0.0156;
  B.add(M.piBlue, rbox(0.094, tray, 0.066, 0.004, 2), [0, tray / 2, 0]);
  B.add(M.piBlue, rbox(0.094, lid, 0.066, 0.004, 2), [0, tray + lid / 2, 0]);
  B.add(M.black, rbox(0.0944, 0.0008, 0.0664, 0.0004), [0, tray, 0]); // split line
  const vent = rbox(0.052, 0.0004, 0.0024, 0.0001);
  for (let k = 0; k < 7; k++) B.add(M.black, vent, [0.008, 0.0281, -0.019 + k * 0.0062]);
  B.add(decalMat(piLogoTexture()), decal(0.036, 0.0135), [-0.0245, 0.0284, 0.0]);
  // side cut-outs: Ethernet and two USB stacks
  const port = (h, d, z, y) => {
    B.add(M.black, rbox(0.002, h, d, 0.0006), [-0.047, y, z]);
    B.add(M.steel, rbox(0.003, h * 0.84, d * 0.88, 0.0004), [-0.0462, y, z]);
  };
  port(0.0135, 0.0165, -0.0205, 0.0105);
  port(0.0155, 0.0135, 0.0, 0.0105);
  port(0.0155, 0.0135, 0.0172, 0.0105);
  for (const [x, w] of [[-0.012, 0.0085], [0.003, 0.0065], [0.0165, 0.0065]]) B.add(M.black, rbox(w, 0.0034, 0.002, 0.0006), [x, 0.007, 0.033]);
  B.add(M.black, rbox(0.002, 0.0026, 0.011, 0.0006), [0.047, 0.006, 0]); // SD slot
  B.add(M.ledG, rbox(0.003, 0.0006, 0.003, 0.0002), [0.04, 0.0282, 0.0255]);
  // standoffs down to the plate, with their screws on the lid
  const post = hex(0.0028, 0.0384);
  for (const [x, z] of [[0.0445, 0.0285], [-0.0445, 0.0285], [0.0445, -0.0285], [-0.0445, -0.0285]]) {
    B.add(M.brass, post, [x, -0.0192, z]);
    B.add(M.screw, screwGeo(), [x, tray + lid, z]);
  }
  return B.build();
}

function gpsTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#0c0d0f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#17191c';
    g.beginPath(); g.roundRect(w * 0.12, h * 0.12, w * 0.76, h * 0.76, 22); g.fill();
    g.fillStyle = '#e9e9e6';
    g.beginPath(); g.moveTo(w * 0.5, h * 0.18); g.lineTo(w * 0.64, h * 0.5); g.lineTo(w * 0.5, h * 0.43); g.lineTo(w * 0.36, h * 0.5); g.closePath(); g.fill();
    text(g, 'GPS', w * 0.5, h * 0.72, 44, '#e9e9e6', '800', 'center');
    text(g, 'NEO-M8N', w * 0.5, h * 0.84, 20, '#8a8d93', '600', 'center');
    g.fillStyle = '#4d86ff'; g.beginPath(); g.arc(w * 0.79, h * 0.79, 6, 0, TAU); g.fill();
  });
}

function buildGps(M) {
  const B = new Batch();
  B.add(M.black, rbox(0.02, 0.0035, 0.016, 0.0012), [0, 0.00175, 0]);
  for (const x of [-0.0072, 0.0072]) B.add(M.screw, screwGeo(), [x, 0.0035, 0]);
  B.add(M.black, rbox(0.011, 0.011, 0.009, 0.0016), [0, 0.0095, 0]);
  B.add(M.screw, cyl(0.0026, 0.0026, 0.0125, 10), [0, 0.0095, 0], [Math.PI / 2, 0, 0]);
  const mast = cyl(0.003, 0.003, 0.068, 14);
  const uv = mast.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 16);
  B.add(M.carbon, mast, [0, 0.0485, 0]);
  B.add(M.black, cyl(0.0046, 0.0046, 0.004, 14), [0, 0.0845, 0]);
  B.add(M.black, lathe([
    [0, 0.0865], [0.0258, 0.0865], [0.0296, 0.0885], [0.0304, 0.0905], [0.0304, 0.0945], [0.0296, 0.0975], [0.0272, 0.0985], [0, 0.0985],
  ], 44));
  B.add(decalMat(gpsTexture()), new THREE.CircleGeometry(0.0256, 44).rotateX(-Math.PI / 2), [0, 0.0987, 0]);
  // cable down the mast to the flight controller
  B.add(M.wireBlack, wire([[0.0045, 0.0865, 0], [0.0047, 0.06, 0], [0.0046, 0.02, 0], [0.0036, 0.006, -0.006], [0.001, 0.0034, -0.016], [0, 0.0034, -0.0215]], 0.0011, 6, 40));
  B.add(M.black, rbox(0.008, 0.0048, 0.0042, 0.0008), [0, 0.0034, -0.0225]);
  return B.build();
}

function telTexture() {
  return canvasTexture(256, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    text(g, '433', 18, 76, 62, 'rgba(240,240,236,0.95)', '800');
    text(g, 'MHz TELEM', 18, 112, 28, 'rgba(210,214,222,0.85)', '700');
    text(g, 'RADIO  V2', 18, 142, 22, 'rgba(160,166,176,0.85)', '600');
    g.fillStyle = '#c4121b'; g.beginPath(); g.arc(218, 38, 10, 0, TAU); g.fill();
  });
}

function buildTelemetry(M) {
  const B = new Batch();
  B.add(M.foam, rbox(0.031, 0.0018, 0.023, 0.0005), [0, 0.0009, 0]);
  B.add(M.black, rbox(0.028, 0.0095, 0.02, 0.0018, 2), [0, 0.0065, 0]);
  B.add(decalMat(telTexture()), decal(0.0225, 0.014), [-0.0015, 0.0115, 0]);
  B.add(M.steel, rbox(0.0024, 0.0032, 0.0072, 0.0005), [-0.0142, 0.0066, 0]);
  B.add(M.gold, hex(0.0036, 0.0028), [0.0153, 0.0066, 0], [0, 0, Math.PI / 2]);
  B.add(M.black, cyl(0.0031, 0.0031, 0.0085, 14), [0.0215, 0.0072, 0], [Math.PI / 2, 0, 0]);
  B.add(M.gold, cyl(0.0036, 0.0036, 0.007, 14), [0.0215, 0.0135, 0]);
  B.add(M.black, lathe([
    [0, 0.017], [0.0032, 0.017], [0.0035, 0.0195], [0.0031, 0.0215], [0.0034, 0.0235], [0.003, 0.0255], [0.0028, 0.06], [0.0024, 0.0665], [0.0012, 0.0698], [0, 0.07],
  ], 16), [0.0215, 0, 0]);
  return B.build();
}

function labelTexture() {
  return canvasTexture(1024, 288, (g, w, h) => {
    g.fillStyle = '#12151b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c4121b'; g.fillRect(0, 0, w, 20);
    g.fillStyle = '#ece9e2'; g.fillRect(0, h - 14, w * 0.36, 14);
    text(g, '4S', 44, 150, 142, '#bdb9b0', '800');
    text(g, '5200', 218, 150, 142, '#bdb9b0', '800');
    text(g, 'mAh', 640, 150, 66, '#c9c6bf', '700');
    text(g, '14.8 V   45C   LiPo   77.0 Wh', 48, 214, 46, '#9a978f', '600');
    text(g, 'XT60   ·   JST-XH balance', 48, 258, 28, '#6f6d68', '600');
    g.fillStyle = '#a9a69e';
    for (let k = 0; k < 40; k++) g.fillRect(660 + k * 8, 190, k % 3 ? 3 : 5, 70);
    g.strokeStyle = '#e8b21c'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(880, 96); g.lineTo(940, 96); g.lineTo(910, 40); g.closePath(); g.stroke();
    text(g, '!', 910, 88, 38, '#e8b21c', '800', 'center');
  });
}

function buildBattery(M) {
  const B = new Batch();
  B.add(M.lipo, rbox(0.048, 0.042, 0.14, 0.0055, 3));
  const lab = decalMat(labelTexture());
  const plane = new THREE.PlaneGeometry(0.12, 0.0338);
  B.add(lab, plane, [0.0242, 0, 0], [0, Math.PI / 2, 0]);
  B.add(lab, plane, [-0.0242, 0, 0], [0, -Math.PI / 2, 0]);
  // velcro straps with a buckle underneath
  const strap = new THREE.Shape();
  rr(strap, 0, 0, 0.0504, 0.0444, 0.0058);
  strap.holes.push(rr(new THREE.Path(), 0, 0, 0.0482, 0.0422, 0.0048));
  const sg = new THREE.ExtrudeGeometry(strap, { depth: 0.015, bevelEnabled: false, curveSegments: 6 });
  for (const z of [-0.036, 0.036]) {
    B.add(M.rubber, sg, [0, 0, z - 0.0075]);
    B.add(M.steel, rbox(0.017, 0.0034, 0.0125, 0.0008), [0, -0.0226, z]);
  }
  // foam pads between the pack and the frame
  for (const z of [-0.036, 0.036]) B.add(M.foam, rbox(0.036, 0.0072, 0.03, 0.0012), [0, 0.0246, z]);
  // leads: XT60 on two silicone wires, balance lead with a JST-XH
  for (const side of [-1, 1]) B.add(side > 0 ? M.wireRed : M.wireBlack, wire([[side * 0.0078, 0, 0.069], [side * 0.0078, -0.001, 0.075], [side * 0.0078, 0, 0.081]], 0.0021, 8, 12));
  B.add(M.yellow, rbox(0.0158, 0.0082, 0.014, 0.0014, 2), [0, 0, 0.087]);
  const bal = [M.wireBlack, M.wireRed, M.wireWhite, M.wireYel, M.wireRed];
  bal.forEach((m, k) => {
    const o = (k - 2) * 0.0013;
    B.add(m, wire([[-0.016 + o, 0.012, 0.069], [-0.017 + o, 0.009, 0.08], [-0.021 + o, -0.004, 0.088], [-0.021 + o, -0.021, 0.088]], 0.0006, 5, 20));
  });
  B.add(M.white, rbox(0.0125, 0.007, 0.0062, 0.0007), [-0.021, -0.0245, 0.088]);
  return B.build();
}

export class Drone {
  constructor({ quality = 'high' } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'drone';
    this.body = new THREE.Group(); // tilt/bank happens here
    this.group.add(this.body);
    this.parts = [];
    this.props = [];
    this.anchors = [];
    this.explode = 0;
    this.spin = 0;
    this._spinAngle = 0;
    setLod(quality === 'high' ? 1 : 0.6);
    this.M = materials();
    this._build();
    this._edges();
  }

  // CAD-style feature lines on every part, shown while the drone is taken apart
  _edges() {
    this.edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.55, 0.62, 0.78), transparent: true, opacity: 0, depthWrite: false, fog: false });
    const meshes = [];
    for (const p of this.parts) p.traverse((o) => {
      if (!o.isMesh || o.material?.userData?.decal || o.material?.transparent) return;
      if (this.props.some((pr) => pr.userData.blur === o)) return;
      meshes.push(o);
    });
    this.edges = meshes.map((m) => {
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 28), this.edgeMat);
      l.raycast = () => {};
      l.visible = false;
      m.add(l);
      return l;
    });
  }

  setAnalytic(a) {
    this.edgeMat.opacity = a;
    const on = a > 0.01;
    if (this.edges[0]?.visible !== on) this.edges.forEach((l) => { l.visible = on; });
  }

  _part(name, obj, offset, rot = [0, 0, 0], delay = 0, label = null, anchor = [0, 0, 0]) {
    const g = new THREE.Group();
    g.name = name;
    g.add(obj);
    g.userData.base = obj.position.clone();
    obj.position.set(0, 0, 0);
    g.position.copy(g.userData.base);
    g.userData.baseRot = obj.rotation.clone();
    g.rotation.copy(obj.rotation);
    obj.rotation.set(0, 0, 0);
    g.userData.offset = new THREE.Vector3(...offset);
    g.userData.rot = new THREE.Vector3(...rot);
    g.userData.delay = delay;
    this.body.add(g);
    this.parts.push(g);
    if (label) this.anchors.push({ obj: g, label, local: new THREE.Vector3(...anchor) });
    return g;
  }

  _build() {
    const M = this.M;

    // Plates and standoffs
    const top = buildTopPlate(M);
    top.position.y = yTop + 0.001 + PLATE_T / 2;
    this._part('topPlate', top, [0, 0.11, 0], [0, 0.4, 0], 0.05);

    const bot = buildPdb(M).group;
    bot.position.y = yBot - PLATE_T / 2;
    this._part('pdb', bot, [0, -0.075, 0], [0, -0.3, 0], 0.08, 'Power board', [0.06, 0, 0]);

    this._part('posts', buildPosts(M), [0, -0.02, 0], [0, 0, 0], 0.0);

    // Arms, legs, ESCs, motors, props
    const armKit = buildArm(M), legKit = buildLeg(M), escKit = buildEsc(M), motorKit = buildMotor(M);
    const bladeMat = [false, true].map((cw) => new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: bladeTexture(cw), roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.3, side: THREE.DoubleSide }));
    const blades = bladeGeo();
    const blurTex = canvasTexture(256, 256, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, w * 0.05, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(30,30,32,0.0)');
      grd.addColorStop(0.12, 'rgba(30,30,32,0.55)');
      grd.addColorStop(0.75, 'rgba(18,18,20,0.32)');
      grd.addColorStop(0.97, 'rgba(10,10,12,0.12)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
    const blurMat = new THREE.MeshBasicMaterial({ map: blurTex, transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide });
    const blurGeo = new THREE.CircleGeometry(0.128, 48);

    for (let i = 0; i < 4; i++) {
      const [dx, dz, a] = armDir(i); // X configuration
      const at = (r, y = 0) => new THREE.Vector3(dx * r, y, dz * r);
      const yaw = a;

      const arm = armKit.clone();
      arm.position.copy(at(0, 0));
      arm.rotation.y = yaw;
      this._part(`arm${i}`, arm, at(0.13, 0).toArray(), [0, 0, (i % 2 ? 1 : -1) * 0.25], 0.12 + i * 0.02, i === 0 ? 'Arm' : null, [0.12, 0.01, 0]);

      // landing leg under the motor
      const leg = legKit.clone();
      leg.position.copy(at(ARM_R - 0.03, -0.01));
      this._part(`leg${i}`, leg, at(0.2, -0.2).toArray(), [0.6, 0, 0.4], 0.2 + i * 0.02);

      // ESC zip-tied under the arm, with three phase wires running up the arm to the motor
      const esc = escKit.clone();
      esc.position.copy(at(0.1, -0.019));
      esc.rotation.y = yaw;
      this._part(`esc${i}`, esc, at(0.12, -0.14).toArray(), [0, 0, 0.5], 0.22 + i * 0.02, i === 1 ? 'ESC' : null, [0, -0.006, 0]);

      // A2212 motor: vented gold bell over visible windings
      const motor = motorKit.clone();
      motor.position.copy(at(ARM_R, 0.0095));
      this._part(`motor${i}`, motor, at(0.2, 0.1).toArray(), [0, 2, 0], 0.28 + i * 0.03, i === 0 ? 'A2212 motor' : null, [0, 0.02, 0]);

      // Propeller: two twisted airfoil blades on a hub, plus a blur disc for speed
      const prop = new THREE.Group();
      const ccw = i % 2 === 0;
      const rotor = buildRotor(M, bladeMat[ccw ? 0 : 1], blades, ccw);
      const blur = new THREE.Mesh(blurGeo, blurMat);
      blur.rotation.x = -Math.PI / 2;
      blur.renderOrder = 2;
      prop.add(rotor, blur);
      prop.position.copy(at(ARM_R, 0.042));
      prop.userData.rotor = rotor;
      prop.userData.blur = blur;
      prop.userData.dir = ccw ? 1 : -1;
      this.props.push(prop);
      this._part(`prop${i}`, prop, at(0.26, 0.26).toArray(), [0.9, 0, 0.5], 0.34 + i * 0.03, i === 3 ? 'Propeller' : null, [0.09, 0.0, 0]);
    }

    // Pixhawk flight controller, on the top plate
    const px = buildPixhawk(M);
    px.position.set(0, PLATE_TOP + 0.0004, 0.004);
    this._part('pixhawk', px, [0, 0.2, 0.02], [0, 0.6, 0], 0.36, 'Pixhawk 2.4.8', [0.04, 0.01, 0]);

    // Raspberry Pi 4 in a blue case, on standoffs above the Pixhawk
    const pi = buildPi(M);
    pi.position.set(0, yTop + 0.041, 0.004);
    this._part('pi', pi, [0, 0.36, 0], [0.3, -0.5, 0], 0.4, 'Raspberry Pi 4', [0.047, 0.014, 0]);

    // GPS + compass on a folding carbon mast at the rear
    const gps = buildGps(M);
    gps.position.set(0, PLATE_TOP, 0.05);
    this._part('gps', gps, [0, 0.3, 0.17], [-0.5, 0, 0.3], 0.44, 'GPS', [0, 0.095, 0]);

    // Pi Camera V2 on a bracket at the nose
    this._part('camera', this._camera(M), [0, 0.06, -0.25], [0.6, 0, 0], 0.3, 'Camera', [0, 0, -0.006]);

    // 433 MHz telemetry radio with its antenna
    const tel = buildTelemetry(M);
    tel.position.set(0.054, PLATE_TOP, 0.036);
    this._part('telemetry', tel, [0.22, 0.12, 0.12], [0, 0, -0.7], 0.42, 'Telemetry', [0.02, 0.06, 0]);

    // 4S LiPo strapped underneath
    const batt = buildBattery(M);
    batt.position.set(0, yBot - 0.03, 0);
    this._part('battery', batt, [0, -0.25, 0], [0, 0.8, 0.2], 0.16, '4S LiPo', [0, -0.02, 0.07]);
  }

  _camera(M) {
    const root = new THREE.Group();
    root.position.set(0, PLATE_TOP + 0.0125, -0.07);
    const B = new Batch();
    const T = new Batch();
    // bracket: foot on the plate, upright behind the board
    B.add(M.black, rbox(0.03, 0.0025, 0.016, 0.001), [0, -0.0125 + 0.00125, 0.002]);
    for (const x of [-0.011, 0.011]) B.add(M.screw, screwGeo(), [x, -0.0125 + 0.0025, 0.002]);
    T.add(M.black, rbox(0.022, 0.016, 0.0022, 0.0008), [0, -0.006, 0.002]);
    // board, sensor block, lens, ribbon socket
    T.add(M.green, rbox(0.025, 0.024, 0.0012, 0.0006), [0, 0, 0]);
    T.add(M.black, rbox(0.0086, 0.0086, 0.0046, 0.0008), [0, 0.002, -0.003]);
    T.add(M.black, cyl(0.0033, 0.0033, 0.0022, 20), [0, 0.002, -0.0063], [Math.PI / 2, 0, 0]);
    T.add(M.glass, cyl(0.0022, 0.0022, 0.0004, 18), [0, 0.002, -0.0075], [Math.PI / 2, 0, 0]);
    T.add(M.black, rbox(0.017, 0.0024, 0.0038, 0.0005), [0, -0.0106, 0.0027]);
    for (const [x, y] of [[-0.0105, 0.0105], [0.0105, 0.0105], [-0.0105, -0.0105], [0.0105, -0.0105]]) T.add(M.gold, cyl(0.0014, 0.0014, 0.0014, 8), [x, y, -0.0006], [Math.PI / 2, 0, 0]);
    const tilt = T.build();
    tilt.rotation.x = 0.25;
    root.add(B.build(), tilt);
    // flat ribbon cable, from the board round to the Pi
    tilt.updateMatrix();
    const start = new THREE.Vector3(0, -0.012, 0.003).applyMatrix4(tilt.matrix);
    const R = new Batch();
    R.add(M.ribbon, ribbon([[start.x, start.y, start.z], [0, -0.02, 0.0075], [0, -0.0225, 0.019], [0, -0.012, 0.031], [0, 0.011, 0.038], [0, 0.03, 0.0415]], 0.012, 0.0004, [1, 0, 0], 28));
    root.add(R.build());
    return root;
  }

  setExplode(t) {
    this.explode = t;
    for (const p of this.parts) {
      const d = p.userData.delay;
      const local = THREE.MathUtils.clamp((t - d * 0.55) / 0.62, 0, 1);
      const e = local < 0.5 ? 4 * local ** 3 : 1 - (-2 * local + 2) ** 3 / 2;
      p.position.copy(p.userData.base).addScaledVector(p.userData.offset, e);
      p.rotation.set(
        p.userData.baseRot.x + p.userData.rot.x * e,
        p.userData.baseRot.y + p.userData.rot.y * e,
        p.userData.baseRot.z + p.userData.rot.z * e,
      );
    }
  }

  // spin: 0 = still, 1 = full throttle
  update(dt, spin) {
    this.spin = spin;
    this._spinAngle += dt * (0.4 + spin * 95);
    for (const p of this.props) {
      const { rotor, blur, dir } = p.userData;
      rotor.rotation.y = this._spinAngle * dir;
      const fast = THREE.MathUtils.smoothstep(spin, 0.25, 0.6);
      blur.material.opacity = fast * 0.9;
      rotor.children.forEach((c, i) => { if (i < 2) c.visible = fast < 0.95; });
    }
  }
}
