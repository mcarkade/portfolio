import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Drone } from './drone.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { Garage, GARAGE_Z, HERO_X } from './garage.js';
import { Morph } from './morph.js';
import { Fluid } from './fluid.js';
import { LaunchFX, GATE_GAP } from './launch.js';
import { Turret } from './turret.js';
import { Atmosphere, atmosphereNoise, atmosphereColor, atmosphereVolume } from './atmosphere.js';
import { HeroType } from './hero-type.js';
import { Gallery } from './gallery.js';

const FinalShader = {
  defines: { VOLUME_STEPS: 8 },
  uniforms: {
    tDiffuse: { value: null },
    tFlow: { value: null },
    uFlowStrength: { value: 0 },
    uTime: { value: 0 },
    uAberration: { value: 0.0015 },
    uSpeed: { value: 0 },
    uVignette: { value: 0.9 },
    uFade: { value: 0 },
    uFlash: { value: 0 },
    uThermal: { value: 0 },
    uStatic: { value: 0 },
    uWarmth: { value: 0 },
    uTransition: { value: 0 },
    uSweep: { value: 0 },
    uResolution: { value: new THREE.Vector2(1440, 900) },
    uReducedMotion: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uAberration, uSpeed, uVignette, uFade, uFlash;
    uniform sampler2D tFlow; uniform float uFlowStrength;
    uniform float uThermal, uStatic;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    // ironbow false colour, as on a FLIR feed
    vec3 ironbow(float t){
      vec3 a = vec3(0.0), b = vec3(0.2, 0.0, 0.42), c = vec3(0.8, 0.05, 0.32), d = vec3(1.0, 0.52, 0.02), e = vec3(1.0, 0.97, 0.78);
      return t < 0.25 ? mix(a, b, t * 4.0) : t < 0.5 ? mix(b, c, t * 4.0 - 1.0) : t < 0.75 ? mix(c, d, t * 4.0 - 2.0) : mix(d, e, t * 4.0 - 3.0);
    }
    uniform float uWarmth, uTransition, uSweep, uReducedMotion;
    uniform vec2 uResolution;
    ${atmosphereNoise}
    ${atmosphereVolume}
    float grain(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec3 flow = vec3(0.0);
      if (uFlowStrength > 0.0) flow = texture2D(tFlow, vUv).rgb * uFlowStrength;
      vec2 smear = flow.rg * 0.06;
      vec2 split = flow.rg * 0.0018;
      vec2 uv = clamp(vUv - smear, 0.001, 0.999);
      // the feed tears sideways while the camera switches
      float tear = (hash(vec2(floor(vUv.y * 48.0), floor(uTime * 24.0))) - 0.5) * 0.12 * uStatic;
      uv.x = clamp(uv.x + tear, 0.001, 0.999);
      float clouds=sin(vUv.y*9.+sin(vUv.x*13.)*.6)*.035;
      float sweep=vUv.x*.78+vUv.y*.22+clouds-uSweep*1.35+.18;
      float beam=exp(-sweep*sweep*240.)*uTransition;
      uv=clamp(uv+vec2(beam*.012,beam*.003),.001,.999);
      vec2 c = vUv - 0.5;
      float r = length(c);
      vec2 dir = normalize(c + 1e-5);
      float ab = uAberration * (0.2 + r * 1.3) + uSpeed * 0.006 * r;
      vec3 col;
      // radial speed blur, strongest at the edges
      if (uSpeed > 0.01) {
        vec3 acc = vec3(0.0);
        float tot = 0.0;
        for (int i = 0; i < 8; i++) {
          float t = float(i) / 7.0;
          float w = 1.0 - t * 0.6;
          vec2 o = c * (1.0 - t * uSpeed * 0.09 * smoothstep(0.08, 0.6, r));
          acc.r += texture2D(tDiffuse, clamp(0.5 + o - smear + dir * ab + split, 0.001, 0.999)).r * w;
          acc.g += texture2D(tDiffuse, clamp(0.5 + o - smear, 0.001, 0.999)).g * w;
          acc.b += texture2D(tDiffuse, clamp(0.5 + o - smear - dir * ab - split, 0.001, 0.999)).b * w;
          tot += w;
        }
        col = acc / tot;
      } else {
        col.r = texture2D(tDiffuse, clamp(uv + dir * ab + split, 0.001, 0.999)).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, clamp(uv - dir * ab - split, 0.001, 0.999)).b;
      }
      col = col * (1.0 + flow.b * 0.12) + vec3(0.0006, 0.0008, 0.001) * flow.b;
      if (uThermal > 0.0) {
        float l = dot(col, vec3(0.3, 0.59, 0.11));
        float heat = clamp(pow(l * 1.9, 0.7) * 0.92 + 0.04 + (hash(vUv * 900.0 + uTime) - 0.5) * 0.05, 0.0, 1.0);
        vec3 th = ironbow(heat) * (0.94 + 0.06 * sin(vUv.y * 900.0)) * 1.25;
        col = mix(col, th, uThermal);
      }
      col = mix(col, vec3(hash(vUv * 700.0 + fract(uTime * 7.0))), uStatic * 0.8);
      float vig = 1.0 - smoothstep(0.18, 0.95, r * uVignette);
      col *= mix(0.35, 1.0, vig);
      col+=lightVolume(uv);
      // Small shadow lift, warm highlights, and a cool toe preserve the dark room.
      vec3 lift=mix(vec3(.001,.003,.005),vec3(.004,.0015,.0008),uWarmth);
      vec3 gain=mix(vec3(.91,1.01,1.08),vec3(1.10,.98,.87),uWarmth);
      col=pow(max(col+lift,vec3(0.)),vec3(1.025))*gain;
      col+=beam*mix(vec3(.12,.25,.36),vec3(.35,.12,.035),uWarmth);
      float n=grain(floor(vUv*uResolution)+floor(uTime*24.));
      col+=(n-.5)*.003*sqrt(max(dot(col,vec3(.2126,.7152,.0722)),.015));
      col += uFlash;
      if(uReducedMotion>.5) col*=1.-uFade;
      else if(uFade>0.){
        float field=vUv.x*.5+vUv.y*.15+noise(vec3(vUv*vec2(5.,4.),3.))*.35;
        float edge=field-uFade*1.25;
        col+=exp(-edge*edge*1800.)*vec3(.09,.035,.015)*sin(uFade*3.14159265);
        col*=smoothstep(-.12,.04,edge);
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class World {
  constructor(canvas, { quality }) {
    this.canvas = canvas;
    this.quality = quality; // 'high' | 'low'
    this.timer = new THREE.Timer();
    this.mouse = new THREE.Vector2(0, 0);
    this.mouseSmooth = new THREE.Vector2(0, 0);
    this.lightsOn = 0; // easter egg, press L
    this.lightsTarget = 0;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance', alpha: false });
    renderer.setClearColor(0x000000, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;
    this.dprCap = quality === 'high' ? 1.75 : 1.25;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.075);
    this.scene = scene;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.atmosphere = new Atmosphere(scene);

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = this.envMap;
    scene.environmentIntensity = 0.32;

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.03, 200);
    this.camera.position.set(0, 1.2, 1.1);
    this.look = new THREE.Vector3(0, 1.1, 0);

    RectAreaLightUniformsLib.init();
    this._lights();
    this._floor();
    this._dust();
    this._road();
    this._vision();

    this.drone = new Drone({ quality });
    this.drone.group.position.set(0, 1.1, 0);
    scene.add(this.drone.group);
    // screws, pads and wires add shadow draws without adding a visible shadow
    this.drone.group.traverse((o) => {
      if (!o.isMesh || !o.castShadow) return;
      o.geometry.computeBoundingSphere();
      o.castShadow = o.geometry.boundingSphere.radius > 0.035;
    });
    this.heroType = new HeroType(scene, renderer);

    this.garage = new Garage(this);
    scene.add(this.garage.group);
    this.morph = new Morph(this);
    this.launch = new LaunchFX(this);
    this.turret = new Turret(this);
    if (quality === 'high') this._showroomFloor();

    // Post-processing
    // The scene renders offscreen for post-processing, where the canvas's own antialiasing never
    // applies, so the composer's buffers carry the multisampling instead.
    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    for (const target of [composer.renderTarget1, composer.renderTarget2]) {
      target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    }
    composer.addPass(new RenderPass(scene, this.camera));
    if (quality === 'high') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.35, 0.6, 0.9);
      composer.addPass(this.bloom);
    }
    this.final = new ShaderPass(FinalShader);
    this.final.material.defines.VOLUME_STEPS = quality === 'high' ? 8 : 4;
    Object.assign(this.final.uniforms, this.atmosphere.uniforms, {
      tDepth: { value: null }, uCamera: { value: this.camera.position },
      uCameraWorld: { value: this.camera.matrixWorld }, uProjectionInverse: { value: this.camera.projectionMatrixInverse },
    });
    this.fluid = new Fluid(renderer, { quality, uniforms: this.final.uniforms });
    composer.addPass(this.final);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.gallery = new Gallery(this);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _lights() {
    const s = this.scene;
    // The cursor-driven key light: the only real light in the room.
    const spot = new THREE.SpotLight(0xfff1e2, 60, 14, Math.PI / 7.5, 0.55, 1.6);
    spot.castShadow = true;
    spot.shadow.mapSize.set(this.quality === 'high' ? 2048 : 1024, this.quality === 'high' ? 2048 : 1024);
    spot.shadow.bias = -0.0002;
    spot.shadow.normalBias = 0.02;
    spot.shadow.camera.near = 0.2;
    spot.shadow.camera.far = 14;
    s.add(spot, spot.target);
    this.spot = spot;

    // Cool rim from behind and a low red kicker, both faint.
    const rim = new THREE.DirectionalLight(0xc9d3ff, 0.22);
    rim.position.set(-2, 3, -4);
    s.add(rim, rim.target);
    this.rim = rim;
    const kick = new THREE.PointLight(0xe3262f, 1.2, 6, 2);
    kick.position.set(1.6, 0.3, 1.2);
    s.add(kick);
    this.kick = kick;

    // Studio strips for the cars (RectAreaLight gives the long showroom highlights).
    this.strips = [];
    for (let i = 0; i < 2; i++) {
      const l = new THREE.RectAreaLight(0xffffff, 0, 5.5, 0.35);
      l.lookAt(0, -1, 0);
      s.add(l);
      this.strips.push(l);
    }
    // Visible light bars, so the strips have a source you can see in the dark.
    this.stripMeshes = this.strips.map(() => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 0.06), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: false }));
      m.rotation.x = Math.PI / 2;
      s.add(m);
      return m;
    });

    // Fill used by the "lights on" easter egg.
    this.fill = new THREE.HemisphereLight(0xdde3ff, 0x101012, 0);
    s.add(this.fill);
  }

  _floor() {
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x080b10, roughness: 0.36, metalness: 0.35, envMapIntensity: 0.32 });
    floorMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.atmosphere.uniforms);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFloorWorld; varying vec4 vFloorClip;').replace('#include <project_vertex>', '#include <project_vertex>\nvFloorClip=gl_Position; vFloorWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vFloorWorld; varying vec4 vFloorClip;
        uniform float uTime,uWarm,uStrength,uAspect; uniform vec2 uPointer;
        ${atmosphereNoise} ${atmosphereColor}`).replace('#include <fog_fragment>', `#include <fog_fragment>
        float hazeFade=smoothstep(1.8,10.,distance(vFloorWorld,cameraPosition));
        gl_FragColor.rgb=mix(gl_FragColor.rgb,atmosphereAt(vFloorClip.xy/vFloorClip.w*.5+.5),hazeFade);`);
    };
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.floor = floor;

    // Fine engineering grid, fading out from wherever the camera is looking.
    const gridMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uCenter: { value: new THREE.Vector3() }, uOpacity: { value: 0.5 } },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        varying vec3 vW; uniform vec3 uCenter; uniform float uOpacity;
        float line(float x, float w){ float d = abs(fract(x - 0.5) - 0.5) / fwidth(x); return 1.0 - min(d / w, 1.0); }
        void main(){
          float minor = max(line(vW.x * 4.0, 1.0), line(vW.z * 4.0, 1.0)) * 0.35;
          float major = max(line(vW.x, 1.2), line(vW.z, 1.2));
          float d = length(vW.xz - uCenter.xz);
          float fade = 1.0 - smoothstep(0.4, 3.0, d);
          float a = max(minor, major) * fade * uOpacity;
          gl_FragColor = vec4(vec3(0.92, 0.9, 0.87), a * 0.13);
        }`,
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), gridMat);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = 0.002;
    this.scene.add(grid);
    this.grid = grid;
  }

  // Glossy showroom floor under the garage: a half-resolution mirror added onto the dark floor.
  _showroomFloor() {
    const shader = {
      name: 'ShowroomReflector',
      uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, uStrength: { value: 0 } },
      vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec2 vUv2;
        void main(){ vUv = textureMatrix * vec4(position, 1.0); vUv2 = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 color; uniform sampler2D tDiffuse; uniform float uStrength; varying vec4 vUv; varying vec2 vUv2;
        void main(){
          vec3 base = texture2DProj(tDiffuse, vUv).rgb;
          float fade = smoothstep(0.0, 0.08, vUv2.x) * (1.0 - smoothstep(0.92, 1.0, vUv2.x)) * smoothstep(0.0, 0.3, vUv2.y) * (1.0 - smoothstep(0.7, 1.0, vUv2.y));
          gl_FragColor = vec4(base * color * fade * uStrength, 1.0);
        }`,
    };
    const w = 64, d = 26;
    const refl = new Reflector(new THREE.PlaneGeometry(w, d), {
      textureWidth: Math.round(window.innerWidth * 0.5), textureHeight: Math.round(window.innerHeight * 0.5),
      clipBias: 0.003, color: 0xffffff, shader,
    });
    refl.material.transparent = true;
    refl.material.blending = THREE.AdditiveBlending;
    refl.material.depthWrite = false;
    refl.rotation.x = -Math.PI / 2;
    refl.position.set(HERO_X / 2 + 4, 0.003, GARAGE_Z);
    refl.renderOrder = -1;
    this.scene.add(refl);
    this.reflector = refl;
  }

  _dust() {
    const N = this.quality === 'high' ? 1400 : 450;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 24;
      pos[i * 3 + 1] = Math.random() * 7;
      pos[i * 3 + 2] = 6 - Math.random() * 80;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uLight: { value: new THREE.Vector3() }, uPx: { value: 1 }, uStretch: { value: 0 } },
      vertexShader: `
        attribute float aSeed; uniform float uTime, uPx; uniform vec3 uLight; varying float vA;
        void main(){
          vec3 p = position;
          p.x += sin(uTime * 0.15 + aSeed * 40.0) * 0.25;
          p.y += mod(uTime * 0.04 * (0.3 + aSeed), 7.0);
          p.y = mod(p.y, 7.0);
          p.z += cos(uTime * 0.12 + aSeed * 30.0) * 0.25;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float lit = 1.0 - smoothstep(0.0, 3.5, distance(p, uLight));
          vA = (0.018 + lit * 0.38) * (0.4 + aSeed * 0.6);
          gl_PointSize = min(4.0, uPx * (0.55 + aSeed * 1.1) * (6.0 / -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = 1.0 - smoothstep(0.0, 0.5, d); gl_FragColor = vec4(vec3(1.0, 0.95, 0.9), a * vA); }`,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.dust = pts;
  }

  _road() {
    // A strip of asphalt with kerbs and lane marks; it scrolls under the car during the launch.
    const roadMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { uOffset: { value: 0 }, uOpacity: { value: 0 }, uGlow: { value: 0 } },
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        varying vec2 vUv; varying vec3 vW; uniform float uOffset, uOpacity, uGlow;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        // thresholds softened by their screen-space footprint, so painted edges don't stair-step
        float aastep(float t, float v){ float w = fwidth(v) * 0.75; return smoothstep(t - w, t + w, v); }
        void main(){
          float x = (vUv.x - 0.5) * 14.0;   // metres across
          float z = vUv.y * 600.0 + uOffset; // metres along
          // grain fades out where a texel would shrink below a pixel, instead of turning to moire
          float grainVis = 1.0 - smoothstep(0.3, 1.0, fwidth(z) * 40.0);
          vec3 col = vec3(0.035) + (hash(floor(vec2(x * 40.0, z * 40.0))) - 0.5) * 0.018 * grainVis + 0.009;
          float edge = abs(x);
          // red and white kerbs
          float kerb = aastep(5.0, edge) * (1.0 - aastep(6.0, edge));
          float stripe = aastep(0.5, abs(fract(z / 2.0) - 0.5) * 2.0);
          col = mix(col, mix(vec3(0.75, 0.05, 0.07), vec3(0.85), stripe), kerb);
          // dashed centre line
          float dash = (1.0 - aastep(0.08, abs(x))) * aastep(0.55, fract(z / 9.0));
          col = mix(col, vec3(0.8), dash);
          // white edge lines
          float el = 1.0 - aastep(0.07, abs(edge - 4.8));
          col = mix(col, vec3(0.85), el);
          // wet tarmac: each light gate (at road coordinate n * GATE_GAP, see launch.js)
          // smears a reflection back towards the camera
          float gz = ceil(z / ${GATE_GAP.toFixed(1)});
          float d = gz * ${GATE_GAP.toFixed(1)} - z;
          float refl = exp(-d * 0.14) * smoothstep(0.0, 2.5, d) * (0.4 + 0.6 * smoothstep(3.5, 6.0, edge));
          refl *= 0.7 + 0.3 * sin(x * 2.3 + sin(x * 5.1) * 0.8); // streaky, like light on wet asphalt
          vec3 tint = mod(gz, 3.0) < 0.5 ? vec3(1.0, 0.1, 0.12) : vec3(0.9, 0.88, 0.85);
          col += tint * refl * 0.4 * uGlow;
          float fade = 1.0 - smoothstep(5.9, 6.5, edge);
          gl_FragColor = vec4(col, uOpacity * fade);
        }`,
    });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(14, 600), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.004, 0);
    road.visible = false;
    this.scene.add(road);
    this.road = road;

    // Light streaks rushing past: instanced thin quads.
    const N = 160;
    const geo = new THREE.PlaneGeometry(0.03, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const streaks = new THREE.InstancedMesh(geo, mat, N);
    streaks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    streaks.userData.items = Array.from({ length: N }, (_, i) => ({
      x: (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 7),
      y: 0.2 + Math.random() * 3.5,
      z: -Math.random() * 120,
      red: i % 5 === 0,
    }));
    const c = new THREE.Color();
    streaks.userData.items.forEach((it, i) => streaks.setColorAt(i, it.red ? c.set(0xe3262f) : c.set(0xffffff)));
    streaks.frustumCulled = false;
    streaks.visible = false;
    this.scene.add(streaks);
    this.streaks = streaks;
  }

  _vision() {
    // Obstacle for the avoidance beat: an abstract person-sized pillar.
    const person = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 0.75 });
    const limb = (r, len, x, y, z, rz = 0, rx = 0) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, 0, rz);
      m.castShadow = true;
      person.add(m);
    };
    limb(0.17, 0.42, 0, 1.22, 0);            // torso
    limb(0.075, 0.72, -0.1, 0.46, 0.06, 0, -0.18); // legs, mid-stride
    limb(0.075, 0.72, 0.1, 0.46, -0.06, 0, 0.22);
    limb(0.06, 0.55, -0.27, 1.18, 0, 0.12, 0.25);  // arms
    limb(0.06, 0.55, 0.27, 1.18, 0, -0.12, -0.25);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 14), mat);
    head.position.y = 1.7;
    head.castShadow = true;
    person.add(head);
    person.rotation.y = Math.PI / 2;
    person.position.set(0, 0, -9.5);
    this.scene.add(person);
    this.person = person;

    // ArUco-style landing marker (ID 23 pattern, 6×6 with border).
    const bits = [
      [1, 0, 1, 1, 0, 0], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 0, 1],
      [0, 0, 1, 1, 1, 0], [1, 0, 0, 1, 0, 1], [0, 1, 1, 0, 1, 0],
    ];
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 512, 512);
    const cell = 512 / 10;
    g.fillStyle = '#000'; g.fillRect(cell, cell, cell * 8, cell * 8);
    g.fillStyle = '#fff';
    bits.forEach((row, y) => row.forEach((b, x) => { if (b) g.fillRect(cell * (2 + x), cell * (2 + y), cell, cell); }));
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    const marker = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, color: 0x9a9792 })); // grey paper keeps the white cells below the bloom threshold
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(0, 0.006, -19);
    marker.receiveShadow = true;
    this.scene.add(marker);
    this.marker = marker;
  }

  // Compile every shader the film will need, ahead of time. Programs depend on the render
  // target (the composer draws offscreen, without tone mapping), so compile against the
  // composer's buffer, not the canvas. Hidden meshes are shown for the compile only;
  // lights stay as they are, because light counts are part of every program.
  warm(root = this.scene) {
    const hidden = [];
    root.traverse((o) => { if (!o.visible && !o.isLight) { hidden.push(o); o.visible = true; } });
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.composer.readBuffer);
    const p = r.compileAsync(root, this.camera, this.scene);
    r.setRenderTarget(prev);
    hidden.forEach((o) => { o.visible = false; });
    return p.catch(() => {});
  }

  // Adaptive quality: if the median frame over a 1.5 s window is slower than ~48 fps,
  // render fewer pixels; once at 1x, drop the mirror floor and bloom. Only ever steps down.
  adapt(dt) {
    const a = this._adapt || (this._adapt = { t: -2, dts: [] }); // skip the first 2 s (shader warm-up)
    a.t += dt;
    if (a.t < 0) return;
    a.dts.push(dt);
    if (a.t < 1.5) return;
    const sorted = a.dts.sort((x, y) => x - y);
    const median = sorted[sorted.length >> 1];
    a.t = 0; a.dts.length = 0;
    if (median < 1 / 48) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    if (dpr > 1.01) { this.dprCap = Math.max(1, dpr * 0.8); this.resize(); }
    else if (this.reflector || this.bloom) {
      if (this.reflector) { this.scene.remove(this.reflector); this.reflector = null; }
      if (this.bloom) { this.bloom.enabled = false; this.bloom = null; }
    } else if (dpr > 0.76) { this.dprCap = Math.max(0.75, dpr * 0.85); this.resize(); }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    if (this.bloom) this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    // Portrait screens: lift the subject into the top part of the frame, above the copy.
    if (w < h) this.camera.setViewOffset(w, h, 0, h * 0.14, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.dust.material.uniforms.uPx.value = dpr * (h / 900);
    this.final.uniforms.uResolution.value.set(w * dpr, h * dpr);
    this.heroType.resize();
    this.aspect = w / h;
    this.gallery?.resize();
  }

  setMouse(x, y) { this.mouse.set(x, y); }

  // Project a world point to CSS pixels. Returns null when behind the camera.
  project(v, out = { x: 0, y: 0, z: 0 }) {
    const p = (this._proj || (this._proj = new THREE.Vector3())).copy(v).project(this.camera);
    if (p.z > 1) return null;
    out.x = (p.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-p.y * 0.5 + 0.5) * window.innerHeight;
    out.z = p.z;
    return out;
  }

  // state comes from the director, once per frame
  render(state) {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 1 / 20);
    const t = this.motion.matches ? 0 : this.timer.getElapsed();
    const k = 1 - Math.exp(-dt * 6);
    if (this.motion.matches) this.mouseSmooth.set(0, 0);
    else this.mouseSmooth.lerp(this.mouse, 1 - Math.exp(-dt * 3.5));

    // Camera, with a little parallax from the pointer
    const cam = this.camera;
    const m = this.mouseSmooth;
    cam.position.set(state.cam[0] + m.x * 0.06 * state.parallax, state.cam[1] + m.y * 0.04 * state.parallax, state.cam[2]);
    // Narrow screens see less sideways, so back the camera off along its line of sight.
    const pull = !state.gallery && this.aspect < 1.25 ? Math.min(state.garage ? 3.2 : 2.1, (state.garage ? 1.5 : 1.25) / this.aspect) : 1;
    if (pull > 1) {
      this._tmp = this._tmp || new THREE.Vector3();
      this._tmp.set(...state.look);
      cam.position.sub(this._tmp).multiplyScalar(pull).add(this._tmp);
    }
    if (state.gallery) cam.clearViewOffset();
    else if (this.aspect < 1) cam.setViewOffset(innerWidth, innerHeight, 0, innerHeight * 0.14, innerWidth, innerHeight);
    if (state.shake) {
      cam.position.x += (Math.sin(t * 37) + Math.sin(t * 23)) * 0.004 * state.shake;
      cam.position.y += (Math.sin(t * 41) + Math.cos(t * 29)) * 0.003 * state.shake;
    }
    this.look.set(...state.look);
    cam.lookAt(this.look);
    if (state.roll) cam.rotateZ(state.roll);
    if (Math.abs(cam.fov - state.fov) > 0.01) { cam.fov = state.fov; cam.updateProjectionMatrix(); }

    // Cursor light: orbits the focus point, following the pointer
    const f = this.look;
    const ang = m.x * 1.25 + state.lightYaw;
    const lr = state.lightDist;
    this.spot.position.set(f.x + Math.sin(ang) * lr, f.y + 1.1 + m.y * 0.9 + state.lightLift, f.z + Math.cos(ang) * lr);
    this.spot.target.position.copy(f);
    this.spot.intensity = state.light * 0.42;
    this.spot.angle = state.lightAngle;
    this.spot.color.setRGB(1, 1 - state.warmth * .18, 1 - state.warmth * .38);
    this.atmosphere.update(state, t, m, this.spot, this.aspect);
    this.heroType.update(state, cam, m, t);
    this.kick.position.set(f.x + 1.4, f.y - 0.6, f.z + 1.0);
    this.kick.intensity = state.kick;

    // Easter egg: lights on
    this.lightsOn += (this.lightsTarget - this.lightsOn) * k;
    this.fill.intensity = this.lightsOn * 1.6;
    this.scene.fog.density = state.fog * (1 - this.lightsOn * 0.75);
    this.scene.fog.color.setRGB(.006 + state.warmth * .008, .011 - state.warmth * .005, .018 - state.warmth * .015);
    this.scene.environmentIntensity = state.env + this.lightsOn * 0.5;

    // Drone
    const d = this.drone;
    d.group.position.set(...state.drone);
    d.group.rotation.y = state.droneYaw;
    d.body.rotation.set(state.dronePitch, 0, state.droneRoll);
    d.setExplode(state.explode);
    d.update(dt, state.spin);
    d.group.visible = state.droneVisible;

    // Grid, dust
    this.grid.material.uniforms.uCenter.value.copy(f);
    this.grid.material.uniforms.uOpacity.value = state.grid * .12;
    this.dust.material.uniforms.uTime.value = t;
    this.dust.material.uniforms.uLight.value.copy(this.spot.position).lerp(f, 0.5);

    // Vision props
    this.person.visible = state.person > 0.01;
    this.person.position.x = state.personX;
    this.marker.visible = state.marker;

    // Garage + launch
    this.garage.update(dt, state);
    this.morph.update(state.morph, t, state);
    if (this.reflector) {
      const r = state.garage && state.road < 0.5 ? 0.32 * (1 - state.road * 2) : 0;
      this.reflector.visible = r > 0.001;
      this.reflector.material.uniforms.uStrength.value = r;
    }
    const speed = state.speed;
    this.road.visible = state.road > 0.001;
    this.road.material.uniforms.uOpacity.value = state.road;
    this.road.position.set(state.roadPos[0], 0.004, state.roadPos[2] - 260); // runs 40 m behind the car, past a pulled-back phone camera
    this.road.material.uniforms.uOffset.value -= speed * dt * 90;
    this.launch.update(t, state);
    this.streaks.visible = speed > 0.02;
    if (this.streaks.visible) {
      const dummy = this._dummy || (this._dummy = new THREE.Object3D());
      this.streaks.material.opacity = Math.min(1, speed * 1.4) * 0.8;
      const len = 1 + speed * 14;
      const base = state.roadPos;
      this.streaks.userData.items.forEach((it, i) => {
        it.z += speed * dt * 160;
        if (it.z > 8) it.z -= 128;
        dummy.position.set(base[0] + it.x, it.y, base[2] + it.z);
        dummy.scale.set(1, 1, len);
        dummy.updateMatrix();
        this.streaks.setMatrixAt(i, dummy.matrix);
      });
      this.streaks.instanceMatrix.needsUpdate = true;
    }

    this.floor.visible = !state.gallery;
    this.grid.visible = !state.gallery;
    this.dust.visible = !state.gallery;
    this.gallery.update(state, dt, t);

    // Post
    const u = this.final.uniforms;
    this.fluid.update(dt, this.mouse.x, this.mouse.y);
    u.uTime.value = t;
    u.uSpeed.value = this.quality === 'high' ? speed : 0; // radial blur is desktop-only
    u.uAberration.value = 0.0001 + state.aberration * .35;
    u.uFade.value = state.fade;
    u.uFlash.value = state.flash;
    u.uThermal.value = state.thermal > 0.5 ? 1 : 0;
    u.uStatic.value = Math.max(0, 1 - Math.abs(state.thermal - 0.5) * 5);
    // the person is the warmest thing in the drone's view
    this.person.children[0].material.emissive.setScalar(state.thermal > 0.5 ? 0.38 : 0);
    u.uWarmth.value = state.warmth;
    u.uTransition.value = this.motion.matches ? 0 : state.transition;
    u.uSweep.value = state.sweep;
    u.uReducedMotion.value = this.motion.matches ? 1 : 0;
    if (this.bloom) this.bloom.strength = state.bloom;
    this.renderer.toneMappingExposure = state.exposure;

    this.final.uniforms.tDepth.value = this.composer.readBuffer.depthTexture;
    this.composer.render(dt);
  }
}
