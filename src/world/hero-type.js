import * as THREE from 'three';

// The type and the glass share one texture and one world-space text plane.
// Refraction traces through the torus normal into that plane, including RGB dispersion.
export class HeroType {
  constructor(scene, renderer) {
    this.renderer = renderer;
    this.copy = document.querySelector('.hero__title').textContent.trim();
    this.canvas = document.createElement('canvas');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthWrite: false, fog: false, toneMapped: false,
    }));
    scene.add(this.plane);
    this.inverse = new THREE.Matrix4();
    this.glass = new THREE.Mesh(new THREE.TorusGeometry(.43, .072, 32, 144), new THREE.ShaderMaterial({
      name: 'DispersiveHeroGlass', transparent: true, depthWrite: false,
      uniforms: {
        tType: { value: this.texture }, uTextInverse: { value: this.inverse },
        uOpacity: { value: 1 },
      },
      vertexShader: `varying vec3 vWorld,vNormal; void main(){vec4 p=modelMatrix*vec4(position,1.); vWorld=p.xyz; vNormal=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*p;}`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tType; uniform mat4 uTextInverse; uniform float uOpacity;
        varying vec3 vWorld,vNormal;
        vec4 typeAt(vec3 ray){
          vec3 origin=(uTextInverse*vec4(vWorld,1.)).xyz;
          vec3 direction=(uTextInverse*vec4(ray,0.)).xyz;
          float t=-origin.z/min(direction.z,-.0001);
          vec2 uv=(origin+direction*t).xy+.5;
          if(t<0. || any(lessThan(uv,vec2(0.))) || any(greaterThan(uv,vec2(1.)))) return vec4(0.);
          return texture2D(tType,uv);
        }
        void main(){
          vec3 n=normalize(vNormal), eye=normalize(vWorld-cameraPosition);
          float fresnel=pow(1.-abs(dot(-eye,n)),3.);
          vec4 r=typeAt(refract(eye,n,1./1.30));
          vec4 g=typeAt(refract(eye,n,1./1.34));
          vec4 b=typeAt(refract(eye,n,1./1.39));
          vec3 type=vec3(r.r*r.a,g.g*g.a,b.b*b.a);
          float ribbon=pow(.5+.5*sin(n.y*11.+n.x*4.),32.);
          vec3 reflection=mix(vec3(.012,.028,.043),vec3(.35,.62,.78),fresnel);
          reflection+=ribbon*vec3(.18,.24,.30)+pow(max(dot(n,normalize(vec3(-1,2,2))),0.),40.)*.75;
          reflection+=pow(fresnel,3.)*vec3(.15,.09,.04);
          float alpha=clamp(.22+fresnel*.72+max(type.r,max(type.g,type.b))*.6,0.,.96);
          gl_FragColor=vec4(type*.9+reflection,uOpacity*alpha);
        }`,
    }));
    scene.add(this.glass);
    this.glass.scale.setScalar(.68);
    this.offset = new THREE.Vector3();
    this.resize();
    document.fonts.ready.then(() => this.resize());
  }

  resize() {
    const portrait = innerWidth < innerHeight;
    this.portrait = portrait;
    // Supersampled independently of the renderer's adaptive DPR.
    this.canvas.width = portrait ? 1536 : 2560;
    this.canvas.height = portrait ? 1024 : 768;
    const ctx = this.canvas.getContext('2d');
    const size = portrait ? 230 : 260;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#ede9e3';
    ctx.font = `800 ${size}px "Archivo Variable"`;
    ctx.fontStretch = 'condensed';
    ctx.textBaseline = 'top';
    const lines = this.copy.split(/ (?=that )/);
    const target = portrait ? 1490 : 2480;
    const scale = Math.min(1, target / ctx.measureText(lines[0]).width);
    ctx.scale(scale, 1);
    lines.forEach((line, i) => ctx.fillText(line, 0, i * size * .90));
    this.texture.needsUpdate = true;
  }

  update(state, camera, pointer, time) {
    const alpha = state.heroType;
    this.plane.visible = this.glass.visible = alpha > .001;
    if (alpha <= .001) return;
    const distance = this.portrait ? 3.6 : 2.6;
    const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * .5)) * distance;
    const width = height * camera.aspect;
    const w = width * (this.portrait ? .91 : .76);
    const h = w * this.canvas.height / this.canvas.width;
    this.plane.scale.set(w, h, 1);
    this.offset.set(-width * (this.portrait ? .005 : .09), -height * (this.portrait ? .27 : .19), -distance).applyQuaternion(camera.quaternion);
    this.plane.position.copy(camera.position).add(this.offset);
    this.plane.quaternion.copy(camera.quaternion);
    this.plane.material.opacity = alpha;
    this.plane.updateMatrixWorld(true);
    this.inverse.copy(this.plane.matrixWorld).invert();
    this.glass.position.set(-.07, 1.14, -.06);
    this.glass.rotation.set(.16 + pointer.y * .10, -.28 + pointer.x * .16 + Math.sin(time * .18) * .1, -.32);
    this.glass.material.uniforms.uOpacity.value = alpha;
  }
}
