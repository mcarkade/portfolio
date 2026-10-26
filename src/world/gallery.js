import * as THREE from 'three';
import { galleryRail, GALLERY_END, GALLERY_LAST, galleryPortrait } from './gallery-path.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const vertex = `uniform float uVelocity; varying vec2 vUv; varying vec3 vView;
void main(){
 vUv=uv;
 vec3 bent=position;
 bent.z+=uVelocity*(position.y*position.y*4.-.3)*.7;
 bent.x+=uVelocity*position.y*.045;
 vec4 p=modelViewMatrix*vec4(bent,1.);
 vView=-p.xyz;gl_Position=projectionMatrix*p;
}`;
const fragment = `
uniform sampler2D uMap,uAlt,uLabel;
uniform vec2 uSize,uImage,uAltImage,uCursor;
uniform float uHover,uSweep,uVelocity,uAlternate,uVideo,uOpacity,uFocus;
varying vec2 vUv; varying vec3 vView;
vec2 cover(vec2 uv,vec2 image){float a=uSize.x/uSize.y;float b=image.x/image.y;return (uv-.5)*vec2(min(1.,a/b),min(1.,b/a))+.5;}
float rounded(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return min(max(q.x,q.y),0.)+length(max(q,0.))-r;}
vec3 image(sampler2D map,vec2 size,vec2 point){
 vec2 uv=cover(point,size);
 vec2 split=vec2(uVelocity*.0015,0.);
 return vec3(texture2D(map,uv+split).r,texture2D(map,uv).g,texture2D(map,uv-split).b);
}
void main(){
 vec2 p=(vUv-.5)*uSize;
 float d=rounded(p,uSize*.5-.025,.19);
 float aa=max(fwidth(d),.001);
 if(d>aa) discard;
 vec2 bend=uCursor*.014*uHover+vec2(uVelocity*.008,-uVelocity*.012);
 vec2 point=(vUv-.5)*.95+.5;
 vec3 col=image(uMap,uImage,point+bend);
 if(uVideo>.5) col=mix(col/12.92,pow((col+.055)/1.055,vec3(2.4)),step(vec3(.04045),col));
 if(uAlternate>.001){
  vec3 alt=image(uAlt,uAltImage,point-bend);
  float reveal=1.-smoothstep(uAlternate-.06,uAlternate+.06,vUv.x);
  col=mix(col,alt,reveal);
 }
 float edge=1.-smoothstep(.0,.055,-d);
 float inner=1.-smoothstep(.045,.11,-d);
 vec3 normal=normalize(cross(dFdx(vView),dFdy(vView)));
 float fresnel=pow(1.-abs(dot(normal,normalize(vView))),2.);
 col*=.88;
 col*=1.-.65*exp(-length((vUv-vec2(.9,.91))*vec2(1.,1.6))*12.);
 col+=vec3(.75,.78,.82)*(inner*.045+fresnel*.11);
 float glint=pow(max(0.,sin(vUv.x*6.+vUv.y*3.+.6)),14.);
 col=mix(col,vec3(.35,.33,.32),edge*.7);
 col+=glint*inner*.18;
 col=mix(col,vec3(.85,.82,.77),inner*uFocus);
 float sweep=exp(-pow((vUv.x+vUv.y*.28-mix(-.35,1.65,uSweep))*8.,2.))*uHover;
 col+=vec3(.15,.13,.11)*sweep;
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
    this.panelGeometry = new THREE.PlaneGeometry(1, 1, 32, 20);
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
        window.scrollTo(0, d.tops[6] + d.heights[6] * GALLERY_END * i / GALLERY_LAST);
      });
      link.addEventListener('blur', () => { this.focusIndex = -1; });
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    reduce.addEventListener('change', () => { if (reduce.matches) this.pause(); });
  }

  makePanel(link, i) {
    const empty = new THREE.DataTexture(new Uint8Array([8, 8, 9, 255]), 1, 1);
    empty.needsUpdate = true;
    const uniforms = {
      uMap: { value: empty }, uAlt: { value: empty }, uLabel: { value: empty },
      uImage: { value: new THREE.Vector2(16, 9) }, uAltImage: { value: new THREE.Vector2(16, 9) },
      uSize: { value: new THREE.Vector2(9, 5.4) }, uCursor: { value: new THREE.Vector2() },
      uFocus: { value: 0 }, uOpacity: { value: 1 }, uHover: { value: 0 }, uSweep: { value: 1 }, uVelocity: { value: 0 }, uAlternate: { value: 0 }, uVideo: { value: 0 },
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
    const item = { link, mesh, hit, uniforms, hover: 0, engaged: false, pointer: new THREE.Vector2(), loaded: false, images: [], poster: null, video: null, videoTexture: null, playing: false, videoBlocked: false, playAttempt: 0, i };
    hit.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch' && matchMedia('(hover: hover)').matches) item.hover = 1; });
    hit.addEventListener('pointerleave', () => { item.hover = 0; });
    hit.addEventListener('pointermove', e => {
      if (!item.hover) return;
      const box = hit.getBoundingClientRect();
      item.pointer.set(THREE.MathUtils.clamp((e.clientX - box.left) / box.width * 2 - 1, -1, 1), THREE.MathUtils.clamp(1 - (e.clientY - box.top) / box.height * 2, -1, 1));
    });
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
    g.textAlign = 'left';
    g.font = `650 ${mobile ? 97 : 140}px "Archivo Variable", sans-serif`;
    g.letterSpacing = '-4px';
    const lines = link.dataset.gallery === 'Counter-drone turret' ? ['Counter-drone', 'turret'] : [link.dataset.gallery];
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
        if (key === 'uMap') item.poster = texture;
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
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'metadata';
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
    // Posters are primed early; only the selected panel decodes and plays video.
    if (s > 5.4 && s < 7) {
      this.panels.forEach(item => {
        this.load(item);
      });
    }
    if (s < 6 || s >= 7 || document.hidden) this.pause();
    if ((s >= 7 || s < 6) && this.active) this.hide();
  }

  stopVideo(item) {
    item.playAttempt++;
    item.playing = false;
    item.video?.pause();
    if (item.poster) {
      item.uniforms.uMap.value = item.poster;
      item.uniforms.uImage.value.set(item.poster.image.width, item.poster.image.height);
    }
    item.uniforms.uVideo.value = 0;
  }

  pause() { this.panels.forEach(item => { this.stopVideo(item); item.videoBlocked = false; }); }
  hide() {
    this.pause();
    this.velocity = 0;
    this.panels.forEach(item => {
      item.hover = 0; item.engaged = false;
      item.uniforms.uHover.value = 0;
      item.uniforms.uSweep.value = 1;
      item.uniforms.uCursor.value.set(0, 0);
    });
    this.active = false; this.group.visible = false; this.overlay.hidden = true;
    document.body.classList.remove('in-gallery');
  }

  makeSpace() {
    // One continuous twisted metal ribbon, threaded through the projects.
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
  }

  update(state, dt) {
    const on = state.gallery;
    if (!on) { if (this.active) this.hide(); return; }
    this.active = true; this.group.visible = true; this.overlay.hidden = false;
    document.body.classList.add('in-gallery');
    const t = THREE.MathUtils.clamp(state.galleryProgress / GALLERY_END * GALLERY_LAST, 0, GALLERY_LAST);
    const focused = Math.round(t);
    const k = 1 - Math.exp(-dt * 7);
    const motion = !reduce.matches;
    const velocity = motion ? THREE.MathUtils.clamp((state.scrollVelocity || 0) / 45, -1, 1) * (this.mobile ? .45 : 1) : 0;
    this.velocity = motion ? THREE.MathUtils.lerp(this.velocity, velocity, k) : 0;
    const suspended = document.hidden || document.body.matches('.is-intro, .is-loading, .viewer-open') || this.overlay.inert;
    this.panels.forEach(item => {
      const near = item.i === focused;
      const visible = item.i - t > -.85 && item.i - t < 3.1;
      item.mesh.visible = visible;
      const play = near && !suspended && motion;
      if (play) this.loadVideo(item);
      if (!play) item.videoBlocked = false;
      if (item.video && play && !item.playing && !item.videoBlocked) {
        const attempt = ++item.playAttempt;
        item.playing = true;
        item.video.play().then(() => {
          if (!item.playing) item.video.pause();
        }).catch(() => {
          if (attempt !== item.playAttempt) return;
          this.stopVideo(item);
          item.videoBlocked = true;
        });
      } else if (!play && item.playing) {
        this.stopVideo(item);
      }
      const u = item.uniforms;
      const engaged = !!(item.hover || this.focusIndex === item.i) && near && !suspended;
      if (engaged && !item.engaged) u.uSweep.value = 0;
      item.engaged = engaged;
      u.uFocus.value = this.focusIndex === item.i ? 1 : 0;
      u.uHover.value += ((engaged ? 1 : 0) - u.uHover.value) * (motion ? k : 1);
      u.uSweep.value = motion ? Math.min(1, u.uSweep.value + dt * 1.1) : 1;
      u.uVelocity.value = this.velocity;
      u.uAlternate.value = item.link.dataset.alternate ? u.uHover.value * 1.08 : 0;
      if (!motion) u.uCursor.value.set(0, 0);
      else if (item.hover && near && !suspended) u.uCursor.value.lerp(item.pointer, k);
      else u.uCursor.value.multiplyScalar(1 - k);
      const [x,y,z] = galleryRail(item.i, this.mobile);
      const passed = THREE.MathUtils.smoothstep(t - item.i, .3, .85);
      u.uOpacity.value = 1 - THREE.MathUtils.smoothstep(t - item.i, .6, .85);
      const scale = this.mobile ? Math.max(.2, 1 - Math.max(0, t - item.i) * 9 / 9.8) : 1;
      item.mesh.scale.set((this.mobile ? 3.65 : 8.4) * scale, (this.mobile ? 4.3 : 5.1) * scale, 1);
      item.mesh.position.set(x + (item.i % 2 ? 1 : -1) * passed * (this.mobile ? 5 : 12), y + passed * .5, z + (motion ? u.uHover.value*.3 : 0));
      item.mesh.rotation.set(motion ? this.velocity*.045 - u.uCursor.value.y*.045*u.uHover.value : 0, motion ? (this.mobile ? 0 : (item.i%2 ? -.12 : .12)) + this.velocity*.055 + u.uCursor.value.x*.065*u.uHover.value + passed*(item.i%2 ? -.7 : .7) : 0, motion && !this.mobile ? Math.sin(item.i*2.3)*.035 + this.velocity*.02 : 0);
      item.mesh.updateMatrixWorld();
      this.placeHit(item, visible && near);
    });
  }

  placeHit(item, visible) {
    const el = item.hit;
    el.hidden = !visible;
    if (!visible) return;
    const points = [[-.5,.5],[.5,.5],[.5,-.5],[-.5,-.5]].map(([x,y]) => {
      const velocity = item.uniforms.uVelocity.value;
      this.rayPoint.set(x + velocity*y*.045,y,velocity*(y*y*4-.3)*.7).applyMatrix4(item.mesh.matrixWorld).project(this.world.camera);
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
