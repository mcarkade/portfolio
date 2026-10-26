import * as THREE from 'three';

export const atmosphereNoise = /* glsl */ `
  float hash(vec3 p){ p=fract(p*.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float noise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1)),f.x),f.y),f.z); }
`;
export const atmosphereColor = /* glsl */ `
  vec3 atmosphereAt(vec2 p){
    vec2 light=vec2(.69,.88)+uPointer*vec2(.13,.08);
    vec2 d=(p-light)*vec2(uAspect,1.);
    float mist=noise(vec3(p*vec2(4.,3.),uTime*.025));
    float veil=noise(vec3(p*vec2(9.,5.)+mist,uTime*.018));
    float glow=exp(-dot(d,d)*2.8);
    float horizon=exp(-pow((p.y-.28+mist*.035)*5.,2.));
    vec3 col=mix(vec3(.0025,.005,.008),vec3(.009,.003,.002),uWarm);
    col+=mix(vec3(.014,.033,.052),vec3(.052,.018,.007),uWarm)*(glow*(.38+mist*.5)+horizon*.13)*uStrength;
    col+=mix(vec3(.008,.018,.03),vec3(.036,.008,.004),uWarm)*veil*.3;
    return col;
  }
`;

export const atmosphereVolume = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 uCameraWorld,uProjectionInverse;
  uniform vec3 uCamera,uApex,uAxis;
  uniform float uLength,uRadius,uWarm,uStrength;
  vec3 worldAt(vec2 uv,float depth){
    vec4 p=uProjectionInverse*vec4(uv*2.-1.,depth*2.-1.,1.);
    return (uCameraWorld*vec4(p.xyz/p.w,1.)).xyz;
  }
  vec3 lightVolume(vec2 uv){
    vec3 endpoint=worldAt(uv,texture2D(tDepth,uv).x);
    vec3 ray=normalize(endpoint-uCamera);
    vec3 center=uApex+uAxis*uLength*.5;
    vec3 oc=uCamera-center;
    float b=dot(oc,ray), radius=length(vec2(uLength*.5,uRadius));
    float discriminant=b*b-dot(oc,oc)+radius*radius;
    if(discriminant<=0.) return vec3(0.);
    float entry=max(0.,-b-sqrt(discriminant));
    float exit=min(distance(uCamera,endpoint),-b+sqrt(discriminant));
    float stepSize=max(0.,exit-entry)/float(VOLUME_STEPS);
    float density=0.;
    for(int i=0;i<VOLUME_STEPS;i++){
      vec3 p=uCamera+ray*(entry+(float(i)+.5)*stepSize);
      vec3 local=p-uApex;
      float along=dot(local,uAxis)/uLength;
      float radial=length(local-uAxis*along*uLength)/max(.001,uRadius*along);
      float edge=1.-smoothstep(.35,1.,radial);
      float end=smoothstep(0.,.12,along)*(1.-smoothstep(.5,1.,along));
      density+=edge*end*exp(-max(p.y,0.)*.55)*stepSize;
    }
    float n=noise((uCamera+ray*(entry+exit)*.5)*1.2+vec3(uTime*.025,0.,uTime*.018));
    return mix(vec3(.25,.49,.72),vec3(.8,.32,.10),uWarm)*(1.-exp(-density*.048))*(.55+n*.45)*uStrength;
  }
`;

// The distant haze and floor share a colour function. The final pass integrates
// the light volume up to scene depth, so solid surfaces cannot cut wedges out of it.
export class Atmosphere {
  constructor(scene) {
    this.uniforms = {
      uTime: { value: 0 }, uWarm: { value: 0 }, uStrength: { value: 1 },
      uPointer: { value: new THREE.Vector2() }, uAspect: { value: 1 },
      uApex: { value: new THREE.Vector3() }, uAxis: { value: new THREE.Vector3() },
      uLength: { value: 1 }, uRadius: { value: 1 },
    };
    this.back = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      name: 'LivingAtmosphere', depthWrite: false, depthTest: false, fog: false,
      uniforms: this.uniforms,
      vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy, .9999, 1.);}`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; uniform float uTime,uWarm,uStrength,uAspect; uniform vec2 uPointer;
        ${atmosphereNoise}
        ${atmosphereColor}
        void main(){
          gl_FragColor=vec4(atmosphereAt(vUv),1.);
        }`,
    }));
    this.back.frustumCulled = false;
    this.back.renderOrder = -100;
    scene.add(this.back);

  }

  update(state, time, pointer, spot, aspect) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uWarm.value = state.warmth;
    u.uStrength.value = state.haze;
    u.uPointer.value.copy(pointer);
    u.uAspect.value = aspect;
    const length = spot.position.distanceTo(spot.target.position) * 2.8;
    const radius = Math.tan(spot.angle) * length;
    u.uApex.value.copy(spot.position);
    u.uAxis.value.copy(spot.target.position).sub(spot.position).normalize();
    u.uLength.value = length;
    u.uRadius.value = radius;
  }
}
