// The launch at full speed: titanium skid sparks from under the MP4/5's plank, and light
// gates spanning the track that the car blasts through, mirrored on the wet tarmac.
import * as THREE from 'three';
import { GARAGE_Z, HERO_X } from './garage.js';

// Gates sit at fixed track positions (every GATE_GAP metres of road coordinate), so the
// road shader can draw their reflections without knowing about this file's meshes.
export const GATE_GAP = 26;
const GATES = 6;
const ROAD_HALF = 6.4;
const GATE_H = 4.6;

export class LaunchFX {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.visible = false;
    world.scene.add(this.group);
    this._sparks(world.quality === 'high' ? 1400 : 500);
    this._gates();
  }

  _sparks(n) {
    // Each spark is a line segment: head at its age, tail a little earlier, so it reads as a streak.
    const seeds = new Float32Array(n * 2 * 4);
    const end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let k = 0; k < 2; k++) {
        seeds.set(s, (i * 2 + k) * 4);
        end[i * 2 + k] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uOrigin: { value: new THREE.Vector3() }, uAmount: { value: 0 }, uSpeed: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; attribute float aEnd;
        uniform float uTime, uAmount, uSpeed; uniform vec3 uOrigin;
        varying float vHeat; varying float vAlive;
        float hash(float x){ return fract(sin(x * 91.17) * 43758.5453); }
        vec3 at(float age, vec4 r){
          vec3 v = vec3((r.z - 0.5) * 3.4, 0.5 + r.w * 2.6, (10.0 + r.y * 14.0) * (0.6 + uSpeed * 0.4));
          vec3 p = vec3((r.x - 0.5) * 0.7, 0.03, 0.0) + v * age;
          p.y -= 4.9 * age * age;
          // skip off the tarmac once
          if (p.y < 0.0) p.y = -p.y * 0.3;
          return uOrigin + p;
        }
        void main(){
          float life = 0.28 + aSeed.y * 0.32;
          float phase = fract(uTime / life + aSeed.x * 7.13);
          float age = phase * life;
          // sparks come in bursts, as the plank touches down over bumps
          float born = floor((uTime - age) * 9.0);
          float burst = step(0.42, hash(born + floor(aSeed.w * 3.0) * 17.0));
          vAlive = burst * step(aSeed.z, uAmount);
          vHeat = 1.0 - phase;
          float a = aEnd > 0.5 ? age : max(0.0, age - 0.012 - 0.02 * uSpeed);
          vec3 p = at(a, aSeed);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vHeat; varying float vAlive;
        void main(){
          if (vAlive < 0.5) discard;
          vec3 hot = vec3(1.0, 0.86, 0.6), warm = vec3(1.0, 0.36, 0.08), cool = vec3(0.8, 0.08, 0.04);
          vec3 c = vHeat > 0.5 ? mix(warm, hot, (vHeat - 0.5) * 2.0) : mix(cool, warm, vHeat * 2.0);
          gl_FragColor = vec4(c * (0.6 + vHeat * 3.2), vHeat);
        }`,
    });
    this.sparks = new THREE.LineSegments(geo, mat);
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
  }

  _gates() {
    // Three bars per gate: two posts and a lintel, bright enough to bloom.
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: false }); // fades by distance itself
    const bars = new THREE.InstancedMesh(geo, mat, GATES * 3);
    bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bars.frustumCulled = false;
    const white = new THREE.Color(2.4, 2.3, 2.2), red = new THREE.Color(3.2, 0.25, 0.3);
    for (let i = 0; i < GATES * 3; i++) bars.setColorAt(i, white);
    this.white = white; this.red = red;
    this.bars = bars;
    this.group.add(bars);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  update(t, state) {
    const on = state.road > 0.01 && state.speed > 0.02;
    this.group.visible = on;
    if (!on) return;
    const road = this.world.road;
    const offset = road.material.uniforms.uOffset.value;
    const carZ = GARAGE_Z + state.heroZ;

    // sparks only once the car is really going
    const u = this.sparks.material.uniforms;
    u.uTime.value = t;
    u.uSpeed.value = state.speed;
    u.uAmount.value = THREE.MathUtils.smoothstep(state.speed, 0.55, 1.05) * state.road;
    u.uOrigin.value.set(HERO_X, 0, carZ + 0.75);

    // gate n stands at road coordinate n * GATE_GAP; see the road shader in world.js
    const zero = road.position.z + 300 + offset;
    const n0 = Math.ceil((zero - (carZ + 14)) / GATE_GAP);
    const { _m: m, _q: q, _p: p, _s: s, _c: c } = this;
    const camZ = this.world.camera.position.z;
    for (let g = 0; g < GATES; g++) {
      const n = n0 + g;
      const z = zero - n * GATE_GAP;
      const bars = [
        [HERO_X - ROAD_HALF, GATE_H / 2, 0.14, GATE_H],
        [HERO_X + ROAD_HALF, GATE_H / 2, 0.14, GATE_H],
        [HERO_X, GATE_H, ROAD_HALF * 2 + 0.14, 0.14],
      ];
      // emerge out of the dark far ahead, full strength as they pass the car
      const fade = 1 - THREE.MathUtils.smoothstep(camZ - z, 40, 150);
      c.copy(((n % 3) + 3) % 3 === 0 ? this.red : this.white).multiplyScalar(fade);
      bars.forEach(([x, y, w, h], j) => {
        p.set(x, y, z);
        s.set(w, h, 0.14);
        m.compose(p, q, s);
        this.bars.setMatrixAt(g * 3 + j, m);
        this.bars.setColorAt(g * 3 + j, c);
      });
    }
    this.bars.instanceMatrix.needsUpdate = true;
    this.bars.instanceColor.needsUpdate = true;
    this.bars.material.opacity = state.road;
    road.material.uniforms.uGlow.value = state.road * Math.min(1, state.speed * 1.5);
  }
}
