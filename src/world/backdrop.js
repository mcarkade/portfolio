import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uAspect;
  uniform float uDim;
  varying vec2 vUv;

  void main() {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    float t = uTime * 0.075;

    // Broad, slowly shifting contours keep their proportions across screen sizes.
    float shape = p.y
      + sin(p.x * 2.1 + t) * 0.12
      + sin(p.x * 3.8 - t * 0.7 + p.y * 1.4) * 0.045
      + sin(p.y * 2.8 + p.x * 1.2) * 0.035;
    float contourDistance = abs(fract(shape * 1.55 + 0.5) - 0.5);
    float contour = 1.0 - smoothstep(0.018, 0.042, contourDistance);

    float edge = smoothstep(0.18, 0.64, abs(p.y) + abs(p.x) * 0.16);
    float quietCenter = smoothstep(0.22, 0.86, length(p));
    float detailMask = edge * quietCenter * uDim;

    float redBand = exp(-pow((p.y + 0.31 - sin(p.x * 1.35 + t * 0.8) * 0.09) / 0.22, 2.0));
    float blueBand = exp(-pow((p.y - 0.36 - sin(p.x * 1.05 - t * 0.55) * 0.11) / 0.25, 2.0));
    float flow = 0.55 + 0.45 * sin(shape * 3.0 + p.x * 0.42 - t * 1.2);

    vec3 color = vec3(0.0030, 0.0036, 0.0052);
    color += vec3(0.015, 0.0028, 0.0038) * redBand * flow * detailMask;
    color += vec3(0.0028, 0.0075, 0.014) * blueBand * (1.0 - flow * 0.32) * detailMask;
    color += vec3(0.0040, 0.0055, 0.0080) * contour * detailMask;

    gl_FragColor = vec4(color, 1.0);
  }
`;

export class Backdrop {
  constructor(world) {
    this.world = world;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAspect: { value: 16 / 9 },
        uDim: { value: 1 },
      },
      vertexShader,
      fragmentShader,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    world.scene.add(this.mesh);
  }

  update(state, time) {
    if (!this.world.motion.matches) this.material.uniforms.uTime.value = time;
    this.material.uniforms.uAspect.value = this.world.aspect || 16 / 9;
    this.material.uniforms.uDim.value = state.mazeVisible || state.analytic > 0 ? 0.35 : 1;
  }
}
