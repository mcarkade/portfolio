import * as THREE from 'three';
import { galleryRail, GALLERY_END, galleryPortrait } from './gallery-path.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const vertex = `varying vec2 vUv; varying vec3 vView;
void main(){vUv=uv;vec4 p=modelViewMatrix*vec4(position,1.);vView=-p.xyz;gl_Position=projectionMatrix*p;}`;
const fragment = `
uniform sampler2D uMap,uAlt,uLabel;
uniform vec2 uSize,uImage,uAltImage,uCursor;
uniform float uHover,uTime,uAlternate,uVideo,uOpacity,uFocus;
varying vec2 vUv; varying vec3 vView;
vec2 cover(vec2 uv,vec2 image){float a=uSize.x/uSize.y;float b=image.x/image.y;return (uv-.5)*vec2(min(1.,a/b),min(1.,b/a))+.5;}
float rounded(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return min(max(q.x,q.y),0.)+length(max(q,0.))-r;}
void main(){
 vec2 p=(vUv-.5)*uSize;
 float d=rounded(p,uSize*.5-.025,.19);
 float aa=max(fwidth(d),.001);
 if(d>aa) discard;
 vec2 bend=(vUv-.5)*.006+uCursor*.008*uHover;
 vec2 uv=cover(vUv+bend,uImage);
 vec3 col=texture2D(uMap,uv).rgb;
 if(uVideo>.5) col=mix(col/12.92,pow((col+.055)/1.055,vec3(2.4)),step(vec3(.04045),col));
 vec3 alt=texture2D(uAlt,cover(vUv-bend,uAltImage)).rgb;
 float reveal=1.-smoothstep(uAlternate-.06,uAlternate+.06,vUv.x);
 col=mix(col,alt,reveal*step(.001,uAlternate));
 float edge=1.-smoothstep(.0,.055,-d);
 float inner=1.-smoothstep(.045,.11,-d);
 vec3 spectral=.5+.5*cos(vec3(0.,1.9,3.8)+vUv.x*4.+vUv.y*3.+uHover);
 float fresnel=pow(1.-abs(normalize(vView).z),2.);
 col*=.88;
 col*=1.-.65*exp(-length((vUv-vec2(.9,.91))*vec2(1.,1.6))*12.);
 col+=spectral*(inner*.09+fresnel*.12);
 float glint=pow(max(0.,sin(vUv.x*6.+vUv.y*3.+.6)),14.);
 col=mix(col,vec3(.38,.32,.29)+spectral*.22,edge*.75);
 col+=glint*inner*.45;
 col=mix(col,vec3(.85,.82,.77),inner*uFocus);
 float sweep=pow(max(0.,1.-abs(vUv.x+vUv.y*.28-mod(uTime*.27,1.7)+.35)*7.),4.)*uHover;
 col+=vec3(.22,.18,.15)*sweep;
 col*=1.-.78*(1.-smoothstep(.02,.47,vUv.y));
 vec4 label=texture2D(uLabel,vUv);
 col=mix(col,label.rgb,label.a);
 float fog=exp(-length(vView)*.018);
 gl_FragColor=vec4(col*fog,(1.-smoothstep(-aa,aa,d))*uOpacity);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;

export class Gallery {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.visible = false;
    world.scene.add(this.group);
    this.links = [...document.querySelectorAll('[data-gallery]')];
    this.overlay = document.createElement('div');
    this.overlay.className = 'gallery-labels';
    this.overlay.hidden = true;
    document.body.append(this.overlay);
    this.rayPoint = new THREE.Vector3();
    this.panelGeometry = new THREE.PlaneGeometry(1, 1);
    this.panels = this.links.map((link, i) => this.makePanel(link, i));
    this.makeSpace();
    this.velocity = 0;
    this.active = false;
    this.mobile = false;
    this.focusIndex = -1;
    this.links.forEach((link, i) => {
      link.addEventListener('focus', () => {
        if (!world.director) return;
        this.focusIndex = i;
        const d = world.director;
        window.scrollTo(0, d.tops[6] + d.heights[6] * GALLERY_END * i / 5);
      });
      link.addEventListener('blur', () => { this.focusIndex = -1; });
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
  }

  makePanel(link, i) {
    const empty = new THREE.DataTexture(new Uint8Array([8, 8, 9, 255]), 1, 1);
    empty.needsUpdate = true;
    const uniforms = {
      uMap: { value: empty }, uAlt: { value: empty }, uLabel: { value: empty },
      uImage: { value: new THREE.Vector2(16, 9) }, uAltImage: { value: new THREE.Vector2(16, 9) },
      uSize: { value: new THREE.Vector2(9, 5.4) }, uCursor: { value: new THREE.Vector2() },
      uFocus: { value: 0 }, uOpacity: { value: 1 }, uHover: { value: 0 }, uTime: { value: 0 }, uAlternate: { value: 0 }, uVideo: { value: 0 },
    };
    const mesh = new THREE.Mesh(this.panelGeometry, new THREE.ShaderMaterial({
      uniforms, vertexShader: vertex, fragmentShader: fragment, transparent: true, side: THREE.DoubleSide,
    }));
    this.group.add(mesh);
    const hit = document.createElement('div');
    hit.className = 'gallery-hit';
    hit.dataset.cursor = link.dataset.cursor;
    hit.setAttribute('aria-hidden', 'true');
    // The original link retains the site's hash navigation and keyboard behavior.
    hit.addEventListener('click', e => { e.preventDefault(); link.click(); });
    const item = { link, mesh, hit, uniforms, hover: 0, loaded: false, images: [], video: null, videoTexture: null, playing: false, i };
    hit.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch' && matchMedia('(hover: hover)').matches) item.hover = 1; });
    hit.addEventListener('pointerleave', () => { item.hover = 0; });
    this.overlay.append(hit);
    return item;
  }

  resize() {
    this.mobile = galleryPortrait(innerWidth, innerHeight);
    this.panels.forEach(item => {
      const w = this.mobile ? 3.65 : 8.4, h = this.mobile ? 4.3 : 5.1;
      item.mesh.scale.set(w, h, 1);
      item.uniforms.uSize.value.set(w, h);
      const label = this.label(item.link, this.mobile);
      if (item.uniforms.uLabel.value.isCanvasTexture) item.uniforms.uLabel.value.dispose();
      item.uniforms.uLabel.value = label;
      this.upload(label);
    });
  }

  label(link, mobile) {
    const c = document.createElement('canvas');
    c.width = mobile ? 1024 : 2048; c.height = mobile ? 1206 : 1228;
    const g = c.getContext('2d');
    g.fillStyle = '#ede9e3';
    const pad = mobile ? 62 : 100;
    g.font = `500 ${mobile ? 35 : 31}px "Geist Mono Variable", monospace`;
    g.textAlign = 'right';
    g.fillText(link.dataset.year, c.width - pad, pad + 35);
    g.textAlign = 'left';
    g.font = `650 ${mobile ? 97 : 140}px "Archivo Variable", sans-serif`;
    g.letterSpacing = '-4px';
    const lines = link.dataset.gallery === 'Counter-drone turret' ? ['Counter-drone', 'turret'] : link.dataset.gallery === 'Medicine box' && mobile ? ['Medicine', 'box'] : [link.dataset.gallery];
    lines.forEach((line, i) => g.fillText(line, pad, c.height - pad - (lines.length - 1 - i) * (mobile ? 100 : 135), c.width - pad * 2));
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }

  upload(texture) {
    const renderer = this.world.renderer;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.world.composer.readBuffer);
    renderer.initTexture(texture);
    renderer.setRenderTarget(previous);
  }

  prime() {
    return Promise.all(this.panels.map(item => this.load(item)));
  }

  load(item) {
    if (item.loaded) return item.promise;
    item.loaded = true;
    const load = (name, key, sizeKey) => new Promise(resolve => {
      new THREE.TextureLoader().load(`/media/${name}`, texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        item.images.push(texture);
        if (key !== 'uMap' || !item.playing || item.video?.readyState < 2) {
          item.uniforms[key].value = texture;
          item.uniforms[sizeKey].value.set(texture.image.width, texture.image.height);
        }
        this.upload(texture);
        resolve();
      }, undefined, resolve);
    });
    item.promise = Promise.all([
      load(item.link.dataset.image, 'uMap', 'uImage'),
      load(item.link.dataset.alternate || item.link.dataset.image, 'uAlt', 'uAltImage'),
    ]);
    return item.promise;
  }

  loadVideo(item) {
    if (item.link.dataset.video && !item.video && !reduce.matches) {
      const v = document.createElement('video');
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
      v.src = `/media/${item.link.dataset.video}`;
      item.video = v;
      item.videoTexture = new THREE.VideoTexture(v);
      item.videoTexture.colorSpace = THREE.SRGBColorSpace;
      const ready = () => {
        if (v.readyState < 2) return;
        this.upload(item.videoTexture);
        if (item.playing) {
          item.uniforms.uMap.value = item.videoTexture;
          item.uniforms.uImage.value.set(v.videoWidth, v.videoHeight);
          item.uniforms.uVideo.value = 1;
        }
      };
      v.addEventListener('loadeddata', ready);
      v.addEventListener('playing', ready);
      v.load();
    }
  }

  prepare(s) {
    // Video decode starts one chapter early. Playback stays local.
    if (s > 5.4 && s < 7) {
      const t = Math.max(0, (s - 6) / GALLERY_END * 5);
      this.panels.forEach(item => {
        this.load(item);
        if (Math.abs(item.i - t) < 2.1) this.loadVideo(item);
      });
    }
    if (s < 6 || s >= 7 || document.hidden) this.pause();
    if ((s >= 7 || s < 6) && this.active) this.hide();
  }

  pause() { this.panels.forEach(item => { item.video?.pause(); item.playing = false; }); }
  hide() {
    this.active = false; this.group.visible = false; this.overlay.hidden = true;
    document.body.classList.remove('in-gallery');
  }

  makeSpace() {
    // One continuous twisted metal ribbon, threaded through the six projects.
    const pos = [], indices = [];
    for (let i = 0; i <= 600; i++) {
      const t = i / 600, a = t * Math.PI * 7;
      for (let side = -1; side <= 1; side += 2) {
        const w = side * (.09 + .07 * Math.sin(t * Math.PI));
        pos.push(Math.sin(a) * 3.7 + Math.cos(a * 2) * w, 30 + Math.cos(a) * 2.7 + Math.sin(a * 2) * w, 3 - t * 58 + w * .5);
      }
      if (i < 600) { const k = i * 2; indices.push(k, k+1, k+2, k+1, k+3, k+2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(indices); geo.computeVertexNormals();
    this.ribbon = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      side: THREE.DoubleSide, transparent: true, depthWrite: false,
      vertexShader: `varying vec3 vN,vV;void main(){vN=normalize(normalMatrix*normal);vec4 p=modelViewMatrix*vec4(position,1.);vV=-p.xyz;gl_Position=projectionMatrix*p;}`,
      fragmentShader: `varying vec3 vN,vV;void main(){vec3 n=normalize(vN);float f=pow(1.-abs(dot(n,normalize(vV))),2.);float light=pow(abs(dot(n,normalize(vec3(-.5,1.,1.)))),8.);vec3 c=mix(vec3(.055,.003,.006),vec3(.82,.025,.045),f);c+=vec3(.85,.8,.72)*light*.8;gl_FragColor=vec4(c*exp(-length(vV)*.023),smoothstep(2.,6.,length(vV))); #include <tonemapping_fragment>\n#include <colorspace_fragment>}`.replace(' #include', '\n#include'),
    }));
    this.group.add(this.ribbon);
    const n = this.world.quality === 'high' ? 650 : 180;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const hash = x => { const v = Math.sin(x * 127.1) * 43758.5453; return v - Math.floor(v); };
      positions.set([(hash(i+1)-.5)*23, 30+(hash(i+100)-.5)*13, 5-hash(i+200)*65], i*3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(positions,3));
    this.dust = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uDpr: { value: 1 } },
      vertexShader: `uniform float uTime,uDpr;varying float vA;void main(){vec3 p=position;p.x+=sin(uTime*.07+position.z)*.14;p.y+=cos(uTime*.09+position.x)*.12;vec4 v=modelViewMatrix*vec4(p,1.);vA=exp(-length(v.xyz)*.045)*.45;gl_PointSize=clamp(24./-v.z,1.,2.5)*uDpr;gl_Position=projectionMatrix*v;}`,
      fragmentShader: `varying float vA;void main(){float a=1.-smoothstep(.05,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(.72,.66,.59,a*vA);}`,
    }));
    this.group.add(this.dust);
  }

  update(state, dt, time) {
    const on = state.gallery;
    if (!on) { if (this.active) this.hide(); return; }
    this.active = true; this.group.visible = true; this.overlay.hidden = false;
    document.body.classList.add('in-gallery');
    const t = state.galleryProgress / GALLERY_END * 5;
    const k = 1 - Math.exp(-dt * 7);
    const motion = !reduce.matches;
    this.velocity += ((motion ? THREE.MathUtils.clamp(state.scrollVelocity || 0, -80, 80) * .002 : 0) - this.velocity) * k;
    this.dust.material.uniforms.uTime.value = motion ? time : 0;
    this.dust.material.uniforms.uDpr.value = this.world.renderer.getPixelRatio();
    this.panels.forEach(item => {
      const near = Math.abs(item.i-t) < .58;
      const visible = item.i - t > -.85 && item.i - t < 3.1;
      item.mesh.visible = visible;
      const play = near && !document.hidden && motion;
      if (item.video && play !== item.playing) {
        item.playing = play;
        if (play) item.video.play().catch(() => {}); else item.video.pause();
      }
      const u = item.uniforms;
      u.uFocus.value = this.focusIndex === item.i ? 1 : 0;
      u.uHover.value += (((item.hover || this.focusIndex === item.i) && near ? 1 : 0) - u.uHover.value) * (motion ? k : 1);
      u.uAlternate.value = item.link.dataset.alternate ? u.uHover.value * 1.08 : 0;
      u.uTime.value = motion ? time : 0;
      u.uCursor.value.copy(this.world.mouseSmooth);
      const [x,y,z] = galleryRail(item.i, this.mobile);
      const passed = THREE.MathUtils.smoothstep(t - item.i, .3, .85);
      u.uOpacity.value = 1 - THREE.MathUtils.smoothstep(t - item.i, .6, .85);
      const scale = this.mobile ? Math.max(.2, 1 - Math.max(0, t - item.i) * 9 / 9.8) : 1;
      item.mesh.scale.set((this.mobile ? 3.65 : 8.4) * scale, (this.mobile ? 4.3 : 5.1) * scale, 1);
      item.mesh.position.set(x + (item.i % 2 ? 1 : -1) * passed * (this.mobile ? 5 : 12), y + passed * .5, z + u.uHover.value*.3);
      item.mesh.rotation.set(motion ? this.velocity*.5 - this.world.mouseSmooth.y*.025 : 0, motion ? (this.mobile ? 0 : (item.i%2 ? -.12 : .12)) + this.velocity + this.world.mouseSmooth.x*.045*u.uHover.value + passed*(item.i%2 ? -.7 : .7) : 0, motion && !this.mobile ? Math.sin(item.i*2.3)*.035 + this.velocity*.16 : 0);
      item.mesh.updateMatrixWorld();
      this.placeHit(item, visible && near);
    });
  }

  placeHit(item, visible) {
    const el = item.hit;
    el.hidden = !visible;
    if (!visible) return;
    const points = [[-.5,.5],[.5,.5],[.5,-.5],[-.5,-.5]].map(([x,y]) => {
      this.rayPoint.set(x,y,0).applyMatrix4(item.mesh.matrixWorld).project(this.world.camera);
      return [(this.rayPoint.x*.5+.5)*innerWidth,(-this.rayPoint.y*.5+.5)*innerHeight];
    });
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const left=Math.min(...xs),top=Math.min(...ys),w=Math.max(...xs)-left,h=Math.max(...ys)-top;
    el.style.transform=`translate3d(${left}px,${top}px,0)`;
    el.style.width=`${w}px`; el.style.height=`${h}px`;
    el.style.clipPath=`polygon(${points.map(([x,y])=>`${(x-left)/w*100}% ${(y-top)/h*100}%`).join(',')})`;
    el.style.outline=this.focusIndex===item.i?'2px solid #ede9e3':'';
  }
}
