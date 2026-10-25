// Procedural F450 quadcopter, modelled after the real build (red arms, gold A2212 motors,
// Pixhawk under a blue-cased Raspberry Pi 4). Every part can fly apart along its own vector.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const TAU = Math.PI * 2;
const ARM_R = 0.205; // motor radius from centre (F450 ≈ 450 mm motor-to-motor)
const PLATE_GAP = 0.024;

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function materials() {
  const red = new THREE.MeshPhysicalMaterial({ color: 0xc4121b, roughness: 0.36, clearcoat: 0.7, clearcoatRoughness: 0.22 });
  return {
    red,
    redMatte: new THREE.MeshStandardMaterial({ color: 0xa50f16, roughness: 0.85 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xb9b3a8, roughness: 0.65 }),
    pcbDark: new THREE.MeshStandardMaterial({ color: 0x1a1d1c, roughness: 0.45 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xd08a4a, metalness: 1, roughness: 0.32 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xc99a42, metalness: 1, roughness: 0.24 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xc2c6cc, metalness: 1, roughness: 0.22 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.55 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.9 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x1c1c1f, metalness: 0.35, roughness: 0.3 }),
    blue: new THREE.MeshPhysicalMaterial({ color: 0x2341c9, roughness: 0.32, clearcoat: 0.5 }),
    escBlue: new THREE.MeshPhysicalMaterial({ color: 0x1b2f7a, roughness: 0.25, clearcoat: 0.9, transmission: 0 }),
    green: new THREE.MeshStandardMaterial({ color: 0x0e5b35, roughness: 0.5 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.5, roughness: 0.32 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xe0b021, roughness: 0.45 }),
    wireRed: new THREE.MeshStandardMaterial({ color: 0xb0121a, roughness: 0.5 }),
    wireBlack: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.5 }),
    wireYel: new THREE.MeshStandardMaterial({ color: 0xc9a019, roughness: 0.5 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.6 }),
    led: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
    ledG: new THREE.MeshBasicMaterial({ color: 0x3cff7a }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x0a0d1a, metalness: 0.2, roughness: 0.05, clearcoat: 1 }),
  };
}

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function plateShape(r) {
  // F450-style centre plate: rounded square with four tabs pointing down each arm.
  const s = new THREE.Shape();
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + Math.PI / 16;
    const tab = Math.abs(Math.cos(a * 2)) > 0.92 ? 1.18 : 1.0; // arms at 45°
    const rr = r * tab * (0.92 + 0.08 * Math.cos(a * 4));
    pts.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
  }
  s.setFromPoints(pts);
  s.closePath();
  const holes = [[0, 0, r * 0.22], [r * 0.5, 0, r * 0.07], [-r * 0.5, 0, r * 0.07], [0, r * 0.5, r * 0.07], [0, -r * 0.5, r * 0.07]];
  for (const [x, y, hr] of holes) {
    const h = new THREE.Path();
    h.absarc(x, y, hr, 0, TAU, true);
    s.holes.push(h);
  }
  return s;
}

function armGeometry() {
  const s = new THREE.Shape();
  const x0 = 0.03, x1 = ARM_R - 0.012;
  s.moveTo(x0, -0.021);
  s.lineTo(x1, -0.015);
  s.absarc(ARM_R, 0, 0.021, -Math.PI * 0.62, Math.PI * 0.62, false);
  s.lineTo(x0, 0.021);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0025, bevelSegments: 3, curveSegments: 18 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -0.009, 0);
  return g;
}

function bladeGeometry(R = 0.127) {
  const s = new THREE.Shape();
  const root = 0.011;
  const chord = (r) => {
    const u = (r - root) / (R - root);
    return 0.006 + 0.017 * Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.55) * (1 - u * 0.55);
  };
  const N = 22;
  const lead = [], trail = [];
  for (let i = 0; i <= N; i++) {
    const r = root + (R - root) * (i / N);
    const c = chord(r);
    lead.push(new THREE.Vector2(r, c * 0.62));
    trail.push(new THREE.Vector2(r, -c * 0.38));
  }
  s.moveTo(root, -0.004);
  trail.forEach((p) => s.lineTo(p.x, p.y));
  s.quadraticCurveTo(R + 0.004, 0, lead[N].x, lead[N].y);
  for (let i = N; i >= 0; i--) s.lineTo(lead[i].x, lead[i].y);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.0018, bevelEnabled: true, bevelThickness: 0.0007, bevelSize: 0.0007, bevelSegments: 2, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  // Twist: steep pitch at the root, flatter at the tip.
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const u = THREE.MathUtils.clamp((v.x - root) / (R - root), 0, 1);
    const a = THREE.MathUtils.degToRad(24 - 16 * u);
    const y = v.y, z = v.z;
    v.y = y * Math.cos(a) - z * Math.sin(a);
    v.z = y * Math.sin(a) + z * Math.cos(a);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function tube(points, r, mat) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return mesh(new THREE.TubeGeometry(curve, 24, r, 6, false), mat);
}

export class Drone {
  constructor() {
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
    this.M = materials();
    this._build();
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
    const yTop = PLATE_GAP / 2, yBot = -PLATE_GAP / 2;

    // Plates
    const plateGeo = new THREE.ExtrudeGeometry(plateShape(0.072), { depth: 0.0016, bevelEnabled: false, curveSegments: 4 });
    plateGeo.rotateX(-Math.PI / 2);
    const top = new THREE.Group();
    top.add(mesh(plateGeo, M.plate));
    top.position.y = yTop + 0.001;
    this._part('topPlate', top, [0, 0.11, 0], [0, 0.4, 0], 0.05);

    const bot = new THREE.Group();
    bot.add(mesh(plateGeo, M.pcbDark));
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      for (const s of [-1, 1]) {
        const pad = mesh(new THREE.BoxGeometry(0.012, 0.0012, 0.008), M.copper, Math.cos(a) * 0.055 + Math.sin(a) * s * 0.008, 0.0018, Math.sin(a) * 0.055 - Math.cos(a) * s * 0.008);
        pad.rotation.y = -a;
        bot.add(pad);
      }
    }
    bot.add(mesh(new THREE.BoxGeometry(0.02, 0.0012, 0.014), M.copper, 0, 0.0018, 0.03));
    // main battery leads + XT60
    bot.add(tube([[0.004, 0.0, 0.028], [0.006, -0.03, 0.04], [0.004, -0.05, 0.06]], 0.0022, M.wireRed));
    bot.add(tube([[-0.004, 0.0, 0.028], [-0.006, -0.03, 0.04], [-0.004, -0.05, 0.06]], 0.0022, M.wireBlack));
    bot.add(mesh(new RoundedBoxGeometry(0.016, 0.008, 0.012, 2, 0.002), M.yellow, 0, -0.052, 0.066));
    bot.position.y = yBot - 0.0016;
    this._part('pdb', bot, [0, -0.075, 0], [0, -0.3, 0], 0.08, 'Power board', [0.06, 0, 0]);

    // Standoffs between plates are implied by the arm roots; add a few brass posts for detail
    const posts = new THREE.Group();
    const postGeo = new THREE.CylinderGeometry(0.0025, 0.0025, PLATE_GAP, 8);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      posts.add(mesh(postGeo, M.gold, Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04));
    }
    this._part('posts', posts, [0, -0.02, 0], [0, 0, 0], 0.0);

    // Arms, legs, ESCs, motors, props
    const armGeo = armGeometry();
    const bladeGeo = bladeGeometry();
    const legGeo = new THREE.CylinderGeometry(0.0055, 0.0035, 0.06, 10);
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

    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2; // X configuration
      const dir = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      const at = (r, y = 0) => dir.clone().multiplyScalar(r).setY(y);
      const yaw = a;

      const arm = new THREE.Group();
      arm.add(mesh(armGeo, M.red));
      // ribs and molded slots on the arm
      for (let k = 0; k < 4; k++) {
        const slot = mesh(new THREE.BoxGeometry(0.022, 0.002, 0.016), M.black, 0.065 + k * 0.03, 0.0095, 0);
        arm.add(slot);
      }
      arm.position.copy(at(0, 0));
      arm.rotation.y = yaw;
      this._part(`arm${i}`, arm, at(0.13, 0).toArray(), [0, 0, (i % 2 ? 1 : -1) * 0.25], 0.12 + i * 0.02, i === 0 ? 'Arm' : null, [0.12, 0.01, 0]);

      // landing leg under the motor
      const leg = new THREE.Group();
      leg.add(mesh(legGeo, M.redMatte, 0, -0.03, 0));
      leg.add(mesh(new THREE.SphereGeometry(0.0065, 12, 8), M.rubber, 0, -0.061, 0));
      leg.position.copy(at(ARM_R - 0.03, -0.01));
      this._part(`leg${i}`, leg, at(0.2, -0.2).toArray(), [0.6, 0, 0.4], 0.2 + i * 0.02);

      // ESC zip-tied under the arm, with three phase wires running to the motor
      const esc = new THREE.Group();
      const escBody = mesh(new RoundedBoxGeometry(0.046, 0.011, 0.022, 2, 0.004), M.escBlue);
      esc.add(escBody);
      esc.add(mesh(new THREE.BoxGeometry(0.003, 0.013, 0.024), M.black, 0.012, 0, 0));
      esc.add(mesh(new THREE.BoxGeometry(0.003, 0.013, 0.024), M.black, -0.012, 0, 0));
      for (let w = 0; w < 3; w++) {
        const mat = [M.wireBlack, M.wireRed, M.wireYel][w];
        esc.add(tube([[0.023, 0, (w - 1) * 0.005], [0.05, 0.004, (w - 1) * 0.004], [0.075, 0.014, (w - 1) * 0.003]], 0.0012, mat));
      }
      esc.position.copy(at(0.1, -0.019));
      esc.rotation.y = yaw;
      this._part(`esc${i}`, esc, at(0.12, -0.14).toArray(), [0, 0, 0.5], 0.22 + i * 0.02, i === 1 ? 'ESC' : null, [0, -0.006, 0]);

      // A2212 motor: black stator base, gold bell, steel shaft and prop nut
      const motor = new THREE.Group();
      motor.add(mesh(new THREE.CylinderGeometry(0.0148, 0.0152, 0.007, 28), M.black, 0, 0.0035, 0));
      motor.add(mesh(new THREE.CylinderGeometry(0.0145, 0.0145, 0.019, 36), M.gold, 0, 0.0165, 0));
      motor.add(mesh(new THREE.TorusGeometry(0.0145, 0.0011, 6, 36), M.black, 0, 0.012, 0).rotateX(Math.PI / 2));
      motor.add(mesh(new THREE.CylinderGeometry(0.0105, 0.0145, 0.003, 36), M.gold, 0, 0.0275, 0));
      motor.add(mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.016, 12), M.steel, 0, 0.034, 0));
      for (let k = 0; k < 4; k++) {
        const ka = (k / 4) * TAU;
        motor.add(mesh(new THREE.CylinderGeometry(0.0013, 0.0013, 0.0015, 6), M.steel, Math.cos(ka) * 0.007, 0.0292, Math.sin(ka) * 0.007));
      }
      motor.position.copy(at(ARM_R, 0.0095));
      this._part(`motor${i}`, motor, at(0.2, 0.1).toArray(), [0, 2, 0], 0.28 + i * 0.03, i === 0 ? 'A2212 motor' : null, [0, 0.02, 0]);

      // Propeller: two twisted blades, hub, nut and a blur disc for speed
      const prop = new THREE.Group();
      const rotor = new THREE.Group();
      const ccw = i % 2 === 0;
      for (let b = 0; b < 2; b++) {
        const blade = mesh(bladeGeo, M.black);
        blade.rotation.y = b * Math.PI;
        if (!ccw) blade.scale.z = -1;
        rotor.add(blade);
      }
      rotor.add(mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.0065, 20), M.black));
      rotor.add(mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.008, 6), M.steel, 0, 0.006, 0));
      const blur = new THREE.Mesh(new THREE.CircleGeometry(0.128, 48), blurMat);
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
    const px = new THREE.Group();
    px.add(mesh(new RoundedBoxGeometry(0.082, 0.016, 0.05, 3, 0.004), M.silver, 0, 0.008, 0));
    px.add(mesh(new THREE.BoxGeometry(0.06, 0.001, 0.03), M.black, 0, 0.0165, 0));
    px.add(mesh(new THREE.BoxGeometry(0.008, 0.002, 0.004), M.led, 0.03, 0.017, -0.017));
    for (let k = 0; k < 6; k++) px.add(mesh(new THREE.BoxGeometry(0.006, 0.006, 0.004), M.black, -0.03 + k * 0.012, 0.006, 0.027));
    px.position.set(0, yTop + 0.003, 0.004);
    this._part('pixhawk', px, [0, 0.2, 0.02], [0, 0.6, 0], 0.36, 'Pixhawk 2.4.8', [0.04, 0.01, 0]);

    // Raspberry Pi 4 in a blue case, on standoffs above the Pixhawk
    const pi = new THREE.Group();
    pi.add(mesh(new RoundedBoxGeometry(0.094, 0.028, 0.066, 3, 0.005), M.blue, 0, 0.014, 0));
    for (let k = 0; k < 7; k++) pi.add(mesh(new THREE.BoxGeometry(0.05, 0.0012, 0.0025), M.black, 0.01, 0.0285, -0.02 + k * 0.006));
    pi.add(mesh(new THREE.BoxGeometry(0.06, 0.0015, 0.05), M.green, 0, 0.0005, 0));
    pi.add(mesh(new THREE.BoxGeometry(0.017, 0.016, 0.014), M.steel, -0.05, 0.012, -0.018));
    pi.add(mesh(new THREE.BoxGeometry(0.017, 0.016, 0.014), M.steel, -0.05, 0.012, 0.0));
    pi.add(mesh(new THREE.BoxGeometry(0.02, 0.014, 0.016), M.steel, -0.05, 0.011, 0.02));
    pi.add(mesh(new THREE.BoxGeometry(0.003, 0.003, 0.003), M.ledG, 0.046, 0.02, 0.028));
    const piPosts = new THREE.CylinderGeometry(0.002, 0.002, 0.02, 8);
    for (const [x, z] of [[0.035, 0.024], [-0.035, 0.024], [0.035, -0.024], [-0.035, -0.024]]) pi.add(mesh(piPosts, M.gold, x, -0.01, z));
    pi.position.set(0, yTop + 0.041, 0.004);
    this._part('pi', pi, [0, 0.36, 0], [0.3, -0.5, 0], 0.4, 'Raspberry Pi 4', [0.047, 0.014, 0]);

    // GPS + compass on a folding carbon mast at the rear
    const gps = new THREE.Group();
    gps.add(mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.085, 10), M.carbon, 0, 0.0425, 0));
    gps.add(mesh(new THREE.BoxGeometry(0.009, 0.01, 0.009), M.black, 0, 0.03, 0));
    const puckTop = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#18181a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#e9e9e9';
      g.beginPath(); g.moveTo(w * 0.5, h * 0.2); g.lineTo(w * 0.64, h * 0.52); g.lineTo(w * 0.5, h * 0.45); g.lineTo(w * 0.36, h * 0.52); g.closePath(); g.fill();
      g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.fillText('GPS', w * 0.5, h * 0.75);
    });
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.031, 0.012, 40), [
      M.black,
      new THREE.MeshStandardMaterial({ map: puckTop, roughness: 0.5 }),
      M.black,
    ]);
    puck.castShadow = true;
    puck.position.y = 0.091;
    gps.add(puck);
    gps.position.set(0, yTop + 0.002, 0.05);
    this._part('gps', gps, [0, 0.3, 0.17], [-0.5, 0, 0.3], 0.44, 'GPS', [0, 0.095, 0]);

    // Pi Camera V2 at the nose
    const cam = new THREE.Group();
    cam.add(mesh(new THREE.BoxGeometry(0.025, 0.024, 0.0012), M.green));
    cam.add(mesh(new THREE.BoxGeometry(0.0085, 0.0085, 0.004), M.black, 0, 0.002, -0.002));
    cam.add(mesh(new THREE.CylinderGeometry(0.0034, 0.0034, 0.003, 18), M.lens, 0, 0.002, -0.005).rotateX(Math.PI / 2));
    cam.add(mesh(new THREE.BoxGeometry(0.016, 0.03, 0.0005), M.white, 0, -0.024, 0.002));
    cam.position.set(0, yTop + 0.004, -0.07);
    cam.rotation.x = 0.25;
    this._part('camera', cam, [0, 0.06, -0.25], [0.6, 0, 0], 0.3, 'Camera', [0, 0, -0.006]);

    // 433 MHz telemetry radio with its antenna
    const tel = new THREE.Group();
    tel.add(mesh(new RoundedBoxGeometry(0.028, 0.01, 0.02, 2, 0.002), M.black, 0, 0.005, 0));
    tel.add(mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.008, 10), M.gold, 0.016, 0.006, 0).rotateZ(Math.PI / 2));
    const ant = mesh(new THREE.CylinderGeometry(0.0022, 0.0028, 0.07, 10), M.black, 0.02, 0.035, 0);
    tel.add(ant);
    tel.position.set(0.05, yTop + 0.002, 0.035);
    this._part('telemetry', tel, [0.22, 0.12, 0.12], [0, 0, -0.7], 0.42, 'Telemetry', [0.02, 0.06, 0]);

    // 4S LiPo strapped underneath
    const label = canvasTexture(512, 160, (g, w, h) => {
      g.fillStyle = '#141416'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c4121b'; g.fillRect(0, h * 0.68, w, h * 0.1);
      g.fillStyle = '#ede9e3'; g.font = '600 46px sans-serif'; g.fillText('4S  5200 mAh', 28, 70);
      g.fillStyle = '#8f8b85'; g.font = '400 26px sans-serif'; g.fillText('14.8 V  LiPo', 30, 106);
    });
    const batt = new THREE.Group();
    const bMat = new THREE.MeshStandardMaterial({ map: label, roughness: 0.4 });
    batt.add(mesh(new RoundedBoxGeometry(0.048, 0.042, 0.14, 3, 0.006), [bMat, bMat, M.black, M.black, M.black, M.black]));
    for (const z of [-0.035, 0.035]) batt.add(mesh(new THREE.BoxGeometry(0.052, 0.046, 0.012), M.redMatte, 0, 0, z));
    batt.rotation.y = Math.PI / 2;
    batt.position.set(0, yBot - 0.026, 0);
    this._part('battery', batt, [0, -0.25, 0], [0, 0.8, 0.2], 0.16, '4S LiPo', [0, -0.02, 0.07]);
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
