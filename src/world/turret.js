// The counter-drone turret from the hackathon: a pan-tilt head with a camera, aimed wherever the
// lock-on reticle is, firing a laser at the drone while it holds the lock.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export class Turret {
  constructor(world) {
    this.world = world;
    const metal = new THREE.MeshPhysicalMaterial({ color: 0x1b1c1f, roughness: 0.38, metalness: 0.85, clearcoat: 0.4, clearcoatRoughness: 0.3 });
    const satin = new THREE.MeshStandardMaterial({ color: 0x2c2d31, roughness: 0.55, metalness: 0.6 });
    const red = new THREE.MeshStandardMaterial({ color: 0xe3262f, roughness: 0.45, metalness: 0.2 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0d12, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02 });
    const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      return m;
    };

    const root = new THREE.Group();
    // a tripod lifts the head into the low camera's view
    const H = 0.78;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const foot = new THREE.Vector3(Math.cos(a) * 0.34, -H, Math.sin(a) * 0.34);
      const leg = mesh(new THREE.CylinderGeometry(0.011, 0.014, foot.length(), 10), metal);
      leg.position.copy(foot).multiplyScalar(0.5);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), foot.clone().normalize().negate());
      root.add(leg);
    }
    root.add(mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.08, 20), satin, 0, -0.03, 0));
    // base: a squat drum with a red index ring
    root.add(mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.06, 48), metal, 0, 0.03, 0));
    root.add(mesh(new THREE.TorusGeometry(0.152, 0.006, 8, 64).rotateX(Math.PI / 2), red, 0, 0.061, 0));
    // pan stage
    const pan = new THREE.Group();
    pan.position.y = 0.065;
    pan.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.035, 48), satin, 0, 0.018, 0));
    for (const x of [-0.085, 0.085]) pan.add(mesh(new RoundedBoxGeometry(0.022, 0.2, 0.09, 3, 0.008), metal, x, 0.13, 0));
    // tilt head: camera body, lens, a hood and a status LED
    const tilt = new THREE.Group();
    tilt.position.y = 0.19;
    tilt.add(mesh(new RoundedBoxGeometry(0.13, 0.095, 0.15, 4, 0.02), satin));
    const lens = mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.05, 40).rotateX(Math.PI / 2), metal, 0, 0, 0.095);
    tilt.add(lens);
    tilt.add(mesh(new THREE.CylinderGeometry(0.029, 0.029, 0.004, 40).rotateX(Math.PI / 2), glass, 0, 0, 0.121));
    tilt.add(mesh(new THREE.TorusGeometry(0.037, 0.003, 8, 40), red, 0, 0, 0.118));
    tilt.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 12).rotateZ(Math.PI / 2), metal, 0, 0, 0)); // trunnion axle
    this.led = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8), new THREE.MeshBasicMaterial({ color: 0x331010 }));
    this.led.position.set(0.045, 0.035, 0.076);
    tilt.add(this.led);
    pan.add(tilt);
    root.add(pan);

    // laser: a hot core inside a soft glow, from the lens to the target, length set per frame
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    const beamMat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });
    this.core = new THREE.Mesh(beamGeo, beamMat(new THREE.Color(4, 0.5, 0.5), 0));
    this.glow = new THREE.Mesh(beamGeo, beamMat(new THREE.Color(1.2, 0.05, 0.08), 0));
    this.core.scale.set(0.0025, 0.0025, 1);
    this.glow.scale.set(0.014, 0.014, 1);
    this.core.position.z = this.glow.position.z = 0.122;
    tilt.add(this.core, this.glow);

    root.position.set(0.95, 0.78, -18.1);
    root.visible = false;
    world.scene.add(root);
    Object.assign(this, { root, pan, tilt, yaw: 0, pitch: 0, beam: 0 });
    this._v = new THREE.Vector3();
    this._o = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
  }

  // ndcX/ndcY: where the reticle is on screen; depth: how far along that ray the drone is
  update(dt, on, ndcX, ndcY, depth, locked) {
    this.root.visible = on;
    if (!on) return;
    const cam = this.world.camera;
    this._ndc.set(ndcX, ndcY);
    this._ray.setFromCamera(this._ndc, cam);
    const target = this._ray.ray.at(depth, this._v);
    this.tilt.getWorldPosition(this._o);
    const d = target.sub(this._o);
    const yaw = Math.atan2(d.x, d.z);
    const pitch = -Math.atan2(d.y, Math.hypot(d.x, d.z));
    // the head is already servo-smoothed by the reticle's PD loop; this only removes jitter
    const k = 1 - Math.exp(-dt * 20);
    this.yaw += (yaw - this.yaw) * k;
    this.pitch += (pitch - this.pitch) * k;
    this.pan.rotation.y = this.yaw;
    this.tilt.rotation.x = this.pitch;
    this.beam += ((locked ? 1 : 0) - this.beam) * (1 - Math.exp(-dt * (locked ? 14 : 6)));
    const len = d.length();
    this.core.scale.z = this.glow.scale.z = len;
    const flicker = 0.85 + Math.random() * 0.15;
    this.core.material.opacity = this.beam * flicker;
    this.glow.material.opacity = this.beam * 0.35 * flicker;
    this.core.visible = this.glow.visible = this.beam > 0.01;
    this.led.material.color.setRGB(locked ? 3 : 0.25, locked ? 0.2 : 0.04, locked ? 0.2 : 0.04);
  }
}
