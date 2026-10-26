import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// One advect-and-splat draw per frame. RG is signed UV velocity; B is the wake.
export class Fluid {
  constructor(renderer, { quality = 'high', uniforms } = {}) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    this.size = new THREE.Vector2();
    this.previous = new THREE.Vector2();
    this.clearColor = new THREE.Color();
    this.idle = 2;
    this.seeded = false;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.pointer = matchMedia('(hover: hover) and (pointer: fine)');
    this.enabled = quality !== 'low' && this.pointer.matches && !this.motion.matches
      && renderer.extensions.has('EXT_color_buffer_float');
    this.empty = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    this.empty.needsUpdate = true;
    this.texture = this.empty;
    if (uniforms) { uniforms.tFlow.value = this.texture; uniforms.uFlowStrength.value = 0; }
    if (!this.enabled) return;
    const options = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };
    this.read = new THREE.WebGLRenderTarget(1, 1, options);
    this.write = this.read.clone();
    this.material = new THREE.ShaderMaterial({
      name: 'PointerFlow', depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        tFlow: { value: this.read.texture }, uDt: { value: 1 / 60 },
        uAspect: { value: 1 }, uFrom: { value: new THREE.Vector2() },
        uTo: { value: new THREE.Vector2() }, uVelocity: { value: new THREE.Vector2() },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tFlow;
        uniform float uDt, uAspect;
        uniform vec2 uFrom, uTo, uVelocity;
        varying vec2 vUv;
        void main(){
          vec2 metric = vec2(uAspect, 1.0);
          vec2 velocity = texture2D(tFlow, vUv).rg;
          vec3 flow = texture2D(tFlow, clamp(vUv - velocity * uDt * 0.55, 0.001, 0.999)).rgb;
          flow *= exp(-uDt * vec3(5.5, 5.5, 7.0));
          vec2 segment = (uTo - uFrom) * metric;
          vec2 p = (vUv - uFrom) * metric;
          float along = clamp(dot(p, segment) / max(dot(segment, segment), 0.000001), 0.0, 1.0);
          vec2 delta = p - segment * along;
          float speed = min(length(uVelocity * metric), 1.8);
          float radius = mix(0.026, 0.075, min(speed * 0.65, 1.0));
          float ink = exp(-dot(delta, delta) / (radius * radius));
          float weight = ink * (1.0 - exp(-uDt * 26.0));
          // A small cross-stream roll makes the wake fold, without radial ripples.
          vec2 roll = vec2(-delta.y, delta.x) / metric;
          flow.rg = mix(flow.rg, uVelocity + roll * speed * 3.0, weight);
          flow.b = max(flow.b, ink * min(speed * 0.55, 0.8));
          gl_FragColor = vec4(flow, 1.0);
        }`,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  update(dt, x, y) {
    if (!this.enabled || this.motion.matches || !this.pointer.matches || this.renderer.getContext().isContextLost()) {
      if (this.uniforms) this.uniforms.uFlowStrength.value = 0;
      this.seeded = false;
      return;
    }
    dt = Math.max(1 / 240, Math.min(dt, 1 / 20));
    const now = performance.now();
    const stale = this.updatedAt !== undefined && now - this.updatedAt > 250;
    this.updatedAt = now;
    if (stale) { this.seeded = false; this.idle = 2; }
    const u = this.material.uniforms;
    const px = x * 0.5 + 0.5, py = y * 0.5 + 0.5;
    if (!this.seeded) { this.previous.set(px, py); this.seeded = true; }
    this.renderer.getSize(this.size);
    const w = Math.max(1, Math.round(Math.min(this.size.x * 0.25, 480)));
    const h = Math.max(1, Math.round(w * this.size.y / this.size.x));
    const resized = this.read.width !== w || this.read.height !== h;
    if (resized) { this.read.setSize(w, h); this.write.setSize(w, h); this.idle = 2; }
    u.uAspect.value = this.size.x / this.size.y;
    u.uFrom.value.copy(this.previous);
    u.uTo.value.set(px, py);
    u.uVelocity.value.subVectors(u.uTo.value, this.previous).divideScalar(dt);
    const speed = Math.hypot(u.uVelocity.value.x * u.uAspect.value, u.uVelocity.value.y);
    if (speed > 1.8) u.uVelocity.value.multiplyScalar(1.8 / speed);
    this.previous.copy(u.uTo.value);
    this.idle = speed > 0.002 ? 0 : this.idle + dt;
    if (this.idle >= 1.8 && this.texture === this.empty && !resized && !stale) return;
    const renderer = this.renderer;
    const target = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    const clearAlpha = renderer.getClearAlpha();
    if (resized || stale || this.idle >= 1.8) {
      renderer.getClearColor(this.clearColor);
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(this.read); renderer.clear();
      renderer.setRenderTarget(this.write); renderer.clear();
      renderer.setClearColor(this.clearColor, clearAlpha);
    }
    if (this.idle < 1.8) {
      u.uDt.value = dt;
      u.tFlow.value = this.read.texture;
      renderer.autoClear = false;
      renderer.setRenderTarget(this.write);
      this.quad.render(renderer);
      [this.read, this.write] = [this.write, this.read];
    }
    renderer.setRenderTarget(target);
    renderer.autoClear = autoClear;
    this.texture = this.idle < 1.8 ? this.read.texture : this.empty;
    if (this.uniforms) {
      this.uniforms.tFlow.value = this.texture;
      this.uniforms.uFlowStrength.value = this.idle < 1.8 ? 1 : 0;
    }
  }

  dispose() {
    this.read?.dispose(); this.write?.dispose();
    this.material?.dispose(); this.quad?.dispose(); this.empty.dispose();
    this.enabled = false;
    this.texture = this.empty;
    if (this.uniforms) this.uniforms.uFlowStrength.value = 0;
  }
}
