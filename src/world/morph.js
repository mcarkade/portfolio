import * as THREE from 'three';
import { HERO_X, GARAGE_Z } from './garage.js';

const smooth = (a, b, t) => THREE.MathUtils.smoothstep(t, a, b);
const idle = (fn) => typeof requestIdleCallback === 'function'
  ? requestIdleCallback(fn, { timeout: 100 }) : setTimeout(fn, 0);

const vertexShader = /* glsl */ `
  attribute vec3 aSource, aTarget, aFallback;
  attribute vec3 aSeed;
  attribute float aPart;
  uniform float uProgress, uTargetMix, uSourceReady;
  uniform vec2 uViewport;
  uniform vec3 uSourceCenter, uTargetCenter, uFallbackCenter;
  uniform mat4 uSourceTransform, uTargetTransform;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;

  // Analytic curl of three sinusoidal potentials. Divergence-free, with no texture fetches.
  vec3 curl(vec3 p) {
    vec3 c = cos(vec3(p.x + p.y, p.y + p.z + 2.1, p.z + p.x + 4.2));
    return vec3(c.x - c.z, c.y - c.x, c.z - c.y);
  }
  void main() {
    if (uSourceReady < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
    float t = uProgress;
    float delay = aPart * 0.105 + aSeed.x * 0.045;
    float q = clamp((t - delay) / (1.0 - delay - aSeed.y * 0.055), 0.0, 1.0);
    float flight = smoothstep(0.08, 0.9, q);
    float envelope = sin(q * 3.14159265);
    envelope *= envelope;
    vec3 start = (uSourceTransform * vec4(aSource, 1.0)).xyz;
    vec3 end = mix(aFallback, (uTargetTransform * vec4(aTarget, 1.0)).xyz, uTargetMix);
    vec3 sourceCenter = (uSourceTransform * vec4(uSourceCenter, 1.0)).xyz;
    vec3 targetCenter = mix(uFallbackCenter, (uTargetTransform * vec4(uTargetCenter, 1.0)).xyz, uTargetMix);
    start = mix(start, sourceCenter, envelope * 0.9);
    end = mix(end, targetCenter, envelope * 0.85);
    vec3 c1 = start + vec3(-7.5, 8.0, -13.0);
    vec3 c2 = end + vec3(10.0, 6.0, 12.0);
    float r = 1.0 - flight;
    vec3 p = r*r*r*start + 3.0*r*r*flight*c1 + 3.0*r*flight*flight*c2 + flight*flight*flight*end;
    vec3 velocity = 3.0*r*r*(c1-start) + 6.0*r*flight*(c2-c1) + 3.0*flight*flight*(end-c2);
    float strand = floor(aSeed.x * 3.0);
    float angle = strand * 2.0943951 + t * 9.0 + flight * 3.0;
    // A braided stream with an empty centre, rather than a spherical explosion.
    float radius = (0.9 + aSeed.y * 0.12) * envelope;
    vec3 braid = vec3(cos(angle), sin(angle), -0.4*cos(angle)) * radius;
    vec3 field = curl(p * 0.45 + strand * 2.1 + aSeed.y * 0.25 + t * 6.0);
    p += braid + field * envelope * 0.15;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    vec4 clip = projectionMatrix * mv;
    vec4 ahead = projectionMatrix * (mv + viewMatrix * vec4(normalize(velocity + field), 0.0));
    vec2 direction = (ahead.xy / max(ahead.w, 0.01) - clip.xy / max(clip.w, 0.01)) * uViewport;
    direction = normalize(direction + vec2(0.0001));
    vec2 side = vec2(direction.y, -direction.x);
    float width = clamp((0.005 + aSeed.z * 0.006) * uViewport.y / max(-mv.z, 0.4), 0.65, 2.0);
    float stretch = 1.0 + envelope * (3.0 + aSeed.y * 6.0);
    vec2 offset = side * position.x * width + direction * position.y * width * stretch;
    clip.xy += offset * 2.0 / uViewport * clip.w;
    gl_Position = clip;
    vUv = uv;
    vec3 red = vec3(0.768, 0.0194, 0.0284);
    vec3 bone = vec3(0.847, 0.815, 0.768);
    vColor = mix(red * 1.5, bone, step(0.58, aSeed.z)) * (1.5 + aSeed.y);
    float birth = smoothstep(0.0, 0.055, t);
    float death = 1.0 - smoothstep(0.9, 1.0, t) * uTargetMix;
    vAlpha = birth * death * (0.055 + aSeed.z * 0.105) * uSourceReady;
    vAlpha *= 1.0 + 2.5 * smoothstep(0.72, 0.88, t);
    if (mv.z > -0.05) vAlpha = 0.0;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    float alpha = exp(-d * 4.5) * (1.0 - smoothstep(0.5, 1.0, d));
    gl_FragColor = vec4(vColor, alpha * vAlpha);
  }
`;

/** Scroll-only motion. update(t, time) accepts time for the World API but never integrates it.
 * Source stays solid through t=.035, gone by .24. Target resolves over .86..99.
 * Sampling snapshots world-space surfaces. The departure pose latches on first use so
 * cursor piloting and idle bob cannot change a replay; target deltas follow the real car.
 */
export class Morph {
  constructor(world) {
    this.world = world;
    this.count = world.quality === 'high' ? 40000 : 12000;
    this.stats = { count: this.count, source: null, target: null, maxCopyMs: 0 };
    this._disposed = false;
    this._generations = { source: 0, target: 0 };
    this._sourceInverse = new THREE.Matrix4();
    this._targetInverse = new THREE.Matrix4();
    this._viewport = new THREE.Vector2();
    this._fadeRecords = new Map();
    const geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geometry.index = quad.index;
    geometry.attributes.position = quad.attributes.position;
    geometry.attributes.uv = quad.attributes.uv;
    geometry.instanceCount = this.count;
    const source = new Float32Array(this.count * 3);
    const target = new Float32Array(this.count * 3);
    const seeds = new Float32Array(this.count * 3);
    let seed = 713;
    const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
    // A recognisable F1 fallback, replaced by actual world-space surfaces once available.
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      seeds[j] = random(); seeds[j + 1] = random(); seeds[j + 2] = random();
      const wheel = i % 5 === 0;
      const z = (random() - 0.5) * 4.5;
      const x = wheel ? (i % 2 ? -0.83 : 0.83) : (random() - 0.5) * (Math.abs(z) > 1.7 ? 1.9 : 0.72);
      const y = wheel ? 0.3 + Math.sin(random() * Math.PI * 2) * 0.28 : 0.18 + random() * (0.25 + 0.4 * Math.exp(-z*z*3));
      const yaw = 0.6;
      target[j] = HERO_X + x * Math.cos(yaw) + z * Math.sin(yaw);
      target[j + 1] = y;
      target[j + 2] = GARAGE_Z + z * Math.cos(yaw) - x * Math.sin(yaw);
      source[j] = 0.3; source[j + 1] = 1.75; source[j + 2] = -19.4;
    }
    for (const [name, array, size] of [['aSource', source, 3], ['aTarget', target.slice(), 3], ['aFallback', target, 3], ['aSeed', seeds, 3], ['aPart', new Float32Array(this.count), 1]]) {
      geometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, size));
    }
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 }, uTargetMix: { value: 0 }, uSourceReady: { value: 0 },
        uSourceTransform: { value: new THREE.Matrix4() }, uTargetTransform: { value: new THREE.Matrix4() },
        uSourceCenter: { value: new THREE.Vector3() }, uTargetCenter: { value: new THREE.Vector3(HERO_X, 0.5, GARAGE_Z) },
        uFallbackCenter: { value: new THREE.Vector3(HERO_X, 0.5, GARAGE_Z) },
        uViewport: { value: this._viewport },
      },
      vertexShader, fragmentShader,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'Drone to MP4-5 surface swarm';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    // Skip the mirror's second particle draw and its very large reflected overdraw.
    this.mesh.onBeforeRender = (renderer, scene, camera) => {
      this.material.uniforms.uSourceReady.value = camera === world.camera ? Number(!!this.stats.source) : 0;
    };
    world.scene.add(this.mesh);
    this.setSource(world.drone.group);
  }

  sourceFade(t) { return 1 - smooth(0.035, 0.24, t); }
  targetFade(t) { return smooth(0.86, 0.99, t); }

  setSource(object3D) { return this._sample('source', object3D); }
  setTarget(object3D) { return this._sample('target', object3D); }

  _prepareFade(root, id) {
    const uniforms = { value: 1 };
    const materials = new Set();
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) materials.add(material);
    });
    for (const material of materials) {
      const compile = material.onBeforeCompile;
      const key = material.customProgramCacheKey.bind(material);
      const oldKey = key();
      material.onBeforeCompile = function(shader, renderer) {
        compile.call(this, shader, renderer);
        shader.uniforms.uMorphFade = uniforms;
        shader.fragmentShader = 'uniform float uMorphFade;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
          float morphDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (morphDither >= uMorphFade) discard;
          #include <opaque_fragment>`);
      };
      material.customProgramCacheKey = () => oldKey + '|surface-morph-fade';
      material.needsUpdate = true;
      this._fadeRecords.set(material, { compile, cacheKey: key, id });
    }
    return uniforms;
  }

  async _sample(id, object) {
    if (!object || this._disposed) return;
    const generation = ++this._generations[id];
    this[`_${id}Worker`]?.terminate();
    for (const [material, record] of this._fadeRecords) if (record.id === id) {
      material.onBeforeCompile = record.compile;
      material.customProgramCacheKey = record.cacheKey;
      material.needsUpdate = true;
      this._fadeRecords.delete(material);
    }
    this[id] = object;
    if (id === 'source') this._sourceFlightPose = null;
    this.stats[id] = null;
    this[`_${id}Fade`] = this._prepareFade(object, id);
    if (id === 'target') {
      this._targetReadyAt = undefined;
      this._targetBlendTime = 0;
      this._targetLastTime = undefined;
      this._targetMaterialsReady = false;
      this.material.uniforms.uTargetMix.value = 0;
      this._warmTarget(object, generation);
    }
    object.updateWorldMatrix(true, true);
    const inverse = object.matrixWorld.clone().invert();
    const entries = [];
    object.traverse((mesh) => {
      if (!mesh.isMesh || mesh.isSkinnedMesh || !mesh.geometry.attributes.position) return;
      // Rotor blur discs are translucent proxy geometry, not aircraft surfaces.
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.every((m) => m.transparent && m.opacity < 0.05)) return;
      entries.push({ mesh, matrix: mesh.matrixWorld.toArray(), part: (entries.length * 0.61803398875) % 1 });
    });
    const meshes = [];
    const transfer = [];
    // Copy at most a small batch per idle turn; worker owns the costly transforms and areas.
    let turnStarted = 0;
    const yieldCopy = async () => {
      const elapsed = performance.now() - turnStarted;
      if (turnStarted) this.stats.maxCopyMs = Math.max(this.stats.maxCopyMs, elapsed);
      await new Promise((resolve) => idle(resolve));
      turnStarted = performance.now();
    };
    await yieldCopy();
    for (const { mesh, matrix, part } of entries) {
      if (this._disposed || generation !== this._generations[id]) return;
      const attr = mesh.geometry.attributes.position;
      const position = new Float32Array(attr.count * 3);
      for (let v = 0; v < attr.count; v += 2048) {
        const end = Math.min(attr.count, v + 2048);
        if (!attr.isInterleavedBufferAttribute && attr.itemSize === 3) position.set(attr.array.subarray(v * 3, end * 3), v * 3);
        else for (let j = v; j < end; j++) { position[j*3] = attr.getX(j); position[j*3+1] = attr.getY(j); position[j*3+2] = attr.getZ(j); }
        if (performance.now() - turnStarted >= 1) await yieldCopy();
      }
      const originalIndex = mesh.geometry.index?.array;
      const index = originalIndex ? new originalIndex.constructor(originalIndex.length) : null;
      if (index) for (let j = 0; j < index.length; j += 8192) {
        index.set(originalIndex.subarray(j, Math.min(j + 8192, index.length)), j);
        if (performance.now() - turnStarted >= 1) await yieldCopy();
      }
      meshes.push({ position, index, matrix, part });
      transfer.push(position.buffer);
      if (index) transfer.push(index.buffer);
      if (performance.now() - turnStarted >= 1) await yieldCopy();
    }
    this.stats.maxCopyMs = Math.max(this.stats.maxCopyMs, performance.now() - turnStarted);
    if (this._disposed || generation !== this._generations[id]) return;
    const worker = new Worker(new URL('./morph.worker.js', import.meta.url), { type: 'module' });
    this[`_${id}Worker`]?.terminate();
    this[`_${id}Worker`] = worker;
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (this._disposed || generation !== this._generations[id]) return;
      if (data.error) { this.stats[id + 'Error'] = data.error; return; }
      this[`_${id}Inverse`].copy(inverse);
      this.material.uniforms[id === 'source' ? 'uSourceCenter' : 'uTargetCenter'].value.fromArray(data.center);
      const attribute = this.mesh.geometry.getAttribute(id === 'source' ? 'aSource' : 'aTarget');
      attribute.array.set(data.points);
      attribute.needsUpdate = true;
      if (id === 'source') {
        const parts = this.mesh.geometry.getAttribute('aPart');
        parts.array.set(data.parts); parts.needsUpdate = true;
      }
      this.stats[id] = { workerMs: data.workerMs, area: data.area, meshes: data.meshes };
    };
    worker.onerror = (event) => { this.stats[id + 'Error'] = event.message; worker.terminate(); };
    worker.postMessage({ id, meshes, count: this.count }, transfer);
  }

  async _warmTarget(object, generation) {
    await new Promise((resolve) => idle(resolve));
    if (this._disposed || generation !== this._generations.target) return;
    const started = performance.now();
    let deadline;
    try {
      const renderer = this.world.renderer;
      const previousTarget = renderer.getRenderTarget();
      // Match RenderPass's linear offscreen output, otherwise compile() warms a different variant.
      renderer.setRenderTarget(this.world.composer.readBuffer);
      let compilation;
      try { compilation = renderer.compileAsync(object, this.world.camera, this.world.scene); }
      finally { renderer.setRenderTarget(previousTarget); }
      const ready = await Promise.race([
        compilation.then(() => true),
        new Promise((resolve) => { deadline = setTimeout(() => resolve(false), 5000); }),
      ]);
      clearTimeout(deadline);
      // Some drivers do not finish parallel compilation until the first draw. Never gate the film on it.
      if (!ready) this.stats.targetPrepareTimedOut = true;
      const textures = new Set();
      object.traverse((o) => {
        if (!o.isMesh) return;
        for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      });
      for (const texture of textures) {
        await new Promise((resolve) => idle(resolve));
        if (this._disposed || generation !== this._generations.target) return;
        this.world.renderer.initTexture(texture);
      }
      if (this._disposed || generation !== this._generations.target) return;
      this.stats.targetPrepareMs = performance.now() - started;
      this._targetMaterialsReady = true;
    } catch (error) {
      clearTimeout(deadline);
      this.stats.targetError = error.message;
    }
  }

  update(t = 0, time = 0, state) {
    if (this._disposed) return;
    const world = this.world;
    if (world.garage.hero && world.garage.hero !== this.target) this.setTarget(world.garage.hero);
    t = THREE.MathUtils.clamp(t, 0, 1);
    const uniforms = this.material.uniforms;
    uniforms.uProgress.value = t;
    // A late target is blended continuously. Once settled, motion remains entirely scroll-driven.
    if (this.stats.target && this._targetMaterialsReady) {
      this._targetReadyAt ??= time;
      // Only this one-time asset handoff uses a clock. A delayed upload cannot skip the blend.
      this._targetBlendTime += Math.max(0, Math.min(1 / 30, time - (this._targetLastTime ?? time)));
      this._targetLastTime = time;
      uniforms.uTargetMix.value = smooth(0, 0.65, this._targetBlendTime);
    }
    if (this.source) {
      this.source.updateWorldMatrix(true, false);
      if (t > 0 && t < 1) {
        this._sourceFlightPose ||= this.source.matrix.clone();
        this._sourceFlightPose.decompose(this.source.position, this.source.quaternion, this.source.scale);
        if (this.source === world.drone.group) world.drone.body.rotation.set(0, 0, 0);
        this.source.updateWorldMatrix(true, false);
      }
      uniforms.uSourceTransform.value.multiplyMatrices(this.source.matrixWorld, this._sourceInverse);
      const fade = !this.stats.source || state?.chapter > 6 ? 1 : this.sourceFade(t);
      if (this._sourceFade) this._sourceFade.value = fade;
      if (t > 0 && (!state || state.chapter < 6)) this.source.visible = fade > 0;
    }
    if (this.target) {
      this.target.updateWorldMatrix(true, false);
      uniforms.uTargetTransform.value.multiplyMatrices(this.target.matrixWorld, this._targetInverse);
      const fade = this.targetFade(t) * uniforms.uTargetMix.value;
      this._targetFade.value = fade;
      this.target.visible = fade > 0;
    }
    world.renderer.getDrawingBufferSize(this._viewport);
    this.mesh.visible = !!this.stats.source && t > 0 && (t < 1 || uniforms.uTargetMix.value < 1);
  }

  dispose() {
    this._disposed = true;
    this._sourceWorker?.terminate(); this._targetWorker?.terminate();
    this.world.scene.remove(this.mesh);
    this.mesh.geometry.dispose(); this.material.dispose();
    for (const [material, record] of this._fadeRecords) {
      material.onBeforeCompile = record.compile;
      material.customProgramCacheKey = record.cacheKey;
      material.needsUpdate = true;
    }
    if (this.source) this.source.visible = true;
    if (this.target) this.target.visible = true;
  }
}
