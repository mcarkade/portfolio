// The Multiroads garage: a dark row of cars, each lit as the camera passes,
// ending at the MP4/5 on a turntable, which can be taken apart.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const GARAGE_Z = -60;
export const SPACING = 7;

// Lineup order = scroll order. The hero (index 0 in HERO) sits at the end of the row.
export const CARS = [
  { id: 'rb19', file: '/models/rb19.glb', name: 'Red Bull RB19', year: '2023', length: 5.3 },
  { id: 'w11', file: '/models/w11.glb', name: 'Mercedes W11', year: '2020', length: 5.4 },
];
export const HERO = { id: 'mp45', file: '/models/mp45.glb', name: 'McLaren MP4/5', year: '1989', length: 4.5 };

export const lineupX = (i) => -i * SPACING;
export const HERO_X = lineupX(CARS.length) - 1.5;

// Per-model orientation fixes, filled in once the models are inspected.
const FIX = {
  // id: { rotY: radians to make the nose point to -Z }
};

export class Garage {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.position.z = GARAGE_Z;
    this.slots = [];
    this.hero = null;
    this.heroParts = [];
    this.loaded = 0;
    this.ready = new Set();
    this.prepared = new Set();
    this.total = CARS.length + 1;
    this._turntable();

    const loader = new GLTFLoader();
    MeshoptDecoder.useWorkers?.(2); // decode geometry off the main thread
    loader.setMeshoptDecoder(MeshoptDecoder);
    this.loader = loader;

    CARS.forEach((c, i) => {
      const slot = new THREE.Group();
      slot.position.set(lineupX(i), 0, 0);
      slot.rotation.y = 1.25; // models face +Z; turn so the camera sees a three-quarter front
      this.group.add(slot);
      this.slots.push({ car: c, slot, model: null });
    });
    this.heroSlot = new THREE.Group();
    this.heroSlot.position.set(HERO_X, 0, 0);
    this.group.add(this.heroSlot);
  }

  _turntable() {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.45, 0.06, 96),
      new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.3, metalness: 0.4 }),
    );
    disc.position.y = 0.03;
    disc.receiveShadow = true;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.43, 0.012, 8, 160),
      new THREE.MeshBasicMaterial({ color: 0xe3262f }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.062;
    g.add(disc, ring);
    g.position.set(lineupX(CARS.length) - 1.5, 0, 0);
    this.group.add(g);
    this.turntable = g;
    this.ring = ring;
  }

  // Load the hero first, then the lineup in scroll order. Each car is fully prepared
  // (shaders compiled, textures uploaded a few per frame) long before it comes into view,
  // so arriving in the garage never stalls on first-use GPU work.
  loadHero(onProgress) {
    return this.heroPromise ||= this._load(HERO, this.heroSlot, true, onProgress).then(async m => { await this._warm(m); this.prepared.add(HERO.id); });
  }

  loadAll(onProgress) {
    return this.allPromise ||= this._loadAll(onProgress);
  }

  async _loadAll(onProgress) {
    await this.loadHero();
    onProgress?.(1 / this.total);
    for (const [i, s] of this.slots.entries()) {
      const m = await this._load(s.car, s.slot, false, p => onProgress?.((1 + i + p) / this.total));
      s.model = m;
      await this._warm(m);
      this.prepared.add(s.car.id);
      onProgress?.((i + 2) / this.total);
    }
  }

  async _warm(model) {
    const w = this.world;
    await w.warm(model);
    const textures = new Set();
    model.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const v of Object.values(m)) if (v && v.isTexture) textures.add(v);
      }
    });
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    let i = 0;
    for (const t of textures) {
      w.renderer.initTexture(t);
      if (++i % 2 === 0) await frame();
    }
  }

  _load(car, slot, isHero, onProgress) {
    return new Promise((resolve, reject) => {
      this.loader.load(car.file, (gltf) => {
        const model = gltf.scene;
        this._normalize(model, car);
        model.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = isHero; // only the hero car is worth a shadow pass
            o.receiveShadow = true;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => { if (m.envMapIntensity !== undefined) m.envMapIntensity = 1.0; });
          }
        });
        slot.add(model);
        if (isHero) {
          this.hero = model;
          this._prepareExplode(model);
        }
        this.loaded++;
        this.ready.add(car.id);
        resolve(model);
      }, e => { if (e.total > 0) onProgress?.(e.loaded / e.total); }, reject);
    });
  }

  _normalize(model, car) {
    const fix = FIX[car.id] || {};
    if (fix.rotY) model.rotation.y = fix.rotY;
    model.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    // If the model is longer along X than Z, turn it so length runs along Z.
    if (size.x > size.z * 1.15 && fix.rotY === undefined) {
      model.rotation.y = Math.PI / 2;
      model.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(model);
      box.getSize(size);
    }
    const s = car.length / Math.max(size.z, 1e-3);
    model.scale.multiplyScalar(s);
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    model.position.x -= c.x;
    model.position.z -= c.z;
    model.position.y -= box.min.y;
  }

  _prepareExplode(model) {
    model.updateMatrixWorld(true);
    const carBox = new THREE.Box3().setFromObject(model);
    const centre = carBox.getCenter(new THREE.Vector3());
    const size = carBox.getSize(new THREE.Vector3());
    const tmpBox = new THREE.Box3();
    const wc = new THREE.Vector3();
    // Animate each part's own group node when it has one (its pivot sits at the part's centre).
    const meshes = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.parent;
      meshes.push(p && p !== model && p.children.length === 1 ? p : o);
    });
    this.heroWheels = [];
    model.traverse((o) => { if (/^wheel_(front|rear)_[LR]$/.test(o.name)) this.heroWheels.push(o); });
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const o of meshes) {
      tmpBox.setFromObject(o);
      if (tmpBox.isEmpty()) continue;
      tmpBox.getCenter(wc);
      const rel = wc.clone().sub(centre);
      // normalised position inside the car's bounds
      const n = new THREE.Vector3(rel.x / (size.x / 2), rel.y / (size.y / 2), rel.z / (size.z / 2));
      const dir = new THREE.Vector3(n.x * 1.4, 0.35 + Math.max(0, n.y) * 1.2, n.z * 0.9);
      if (dir.lengthSq() < 0.05) dir.set(0, 1, 0);
      dir.normalize();
      const dist = 0.7 + rel.length() * 0.55 + rnd() * 0.5;
      const worldTarget = wc.clone().addScaledVector(dir, dist);
      const parent = o.parent;
      const a = parent.worldToLocal(wc.clone());
      const b = parent.worldToLocal(worldTarget);
      o.userData.base = o.position.clone();
      o.userData.offset = b.sub(a);
      o.userData.baseRot = o.rotation.clone();
      o.userData.spin = new THREE.Vector3((rnd() - 0.5) * 1.2, (rnd() - 0.5) * 1.2, (rnd() - 0.5) * 1.2);
      o.userData.delay = THREE.MathUtils.clamp((rel.y / size.y + 0.5) * 0.25 + Math.abs(n.z) * 0.15 + rnd() * 0.1, 0, 0.5);
      this.heroParts.push(o);
    }
  }

  setHeroExplode(t) {
    if (t === this._lastExplode) return;
    this._lastExplode = t;
    for (const o of this.heroParts) {
      const u = o.userData;
      const l = THREE.MathUtils.clamp((t - u.delay * 0.6) / 0.7, 0, 1);
      const e = l < 0.5 ? 4 * l ** 3 : 1 - (-2 * l + 2) ** 3 / 2;
      o.position.copy(u.base).addScaledVector(u.offset, e);
      o.rotation.set(u.baseRot.x + u.spin.x * e, u.baseRot.y + u.spin.y * e, u.baseRot.z + u.spin.z * e);
    }
  }

  update(dt, state) {
    this.group.visible = state.garage;
    if (!state.garage) return;
    this.heroSlot.rotation.y = state.heroYaw;
    this.heroSlot.position.z = state.heroZ;
    this.turntable.rotation.y = state.heroYaw;
    this.turntable.visible = state.turntable > 0.01;
    this.ring.material.color.setRGB(0.89 * state.turntable, 0.15 * state.turntable, 0.18 * state.turntable);
    this.setHeroExplode(state.carExplode);
    // Wheels roll during the launch
    if (this.heroWheels?.length && state.carExplode === 0) {
      this.wheelAngle = (this.wheelAngle || 0) - state.speed * dt * 38;
      for (const w of this.heroWheels) {
        const b = w.userData.baseRot || (w.userData.baseRot = w.rotation.clone());
        w.rotation.x = b.x + this.wheelAngle;
      }
      this._lastExplode = null;
    }
    // Only draw the cars near the camera's focus
    this.slots.forEach((s) => { s.slot.visible = state.lineup && Math.abs(s.slot.position.x - state.stripX) < SPACING * 1.15; });

    // Studio strips follow the focused car.
    const w = this.world;
    const fx = state.stripX;
    w.strips.forEach((l, i) => {
      l.position.set(fx + (i ? 1.2 : -1.2), 3.2, GARAGE_Z + state.heroZ * (state.stripOnHero ? 1 : 0) + (i ? -0.6 : 0.6));
      l.lookAt(fx, 0, GARAGE_Z + (i ? -0.6 : 0.6));
      l.intensity = state.strip * 5;
      const m = w.stripMeshes[i];
      m.position.copy(l.position);
      m.material.opacity = 0;
    });
  }
}
