import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  MAP_SIZE, LINE_SEGMENTS, FINISH_PAD, FINISH_SIZE,
  MAZE_ROUTE, ROUTE_LENGTH, sampleMaze,
} from './maze-path.js';

// Map provenance and finish semantics: maze-path.js. Robot reference:
// public/media/mesh-electronics.webp and Meshmerize/hardware.json, schema 1.
// Nominal dimensions, not measured hardware. SI scene units; robot authored in mm.
const ROBOT = Object.freeze({ plateLength: 134.5, plateWidth: 80, wheel: 34, track: 92 });

function robotModel() {
  const robot = new THREE.Group();
  robot.name = 'Meshmerize Pico reference';
  robot.userData.dimensions = ROBOT;
  const model = new THREE.Group();
  model.scale.setScalar(0.001);
  robot.add(model);
  const materials = {
    plate: new THREE.MeshStandardMaterial({ color: 0x999fa4, metalness: 0.76, roughness: 0.35 }),
    pcb: new THREE.MeshStandardMaterial({ color: 0x14593f, metalness: 0.18, roughness: 0.57 }),
    sensor: new THREE.MeshStandardMaterial({ color: 0x18334c, metalness: 0.22, roughness: 0.5 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xb9974c, metalness: 0.78, roughness: 0.33 }),
    chip: new THREE.MeshStandardMaterial({ color: 0x101519, roughness: 0.54, metalness: 0.24 }),
    battery: new THREE.MeshStandardMaterial({ color: 0xa21c24, roughness: 0.43, metalness: 0.12 }),
    red: new THREE.MeshStandardMaterial({ color: 0xe62b34, roughness: 0.4 }),
    wire: new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.6 }),
    cream: new THREE.MeshStandardMaterial({ color: 0xe0d5b5, roughness: 0.62 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x111419, roughness: 0.88 }),
  };
  const batches = new Map();
  const transform = new THREE.Object3D();
  const add = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
    transform.position.set(x, y, z);
    transform.rotation.set(rx, ry, rz);
    transform.updateMatrix();
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    g.applyMatrix4(transform.matrix);
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push(g);
  };
  const box = (w, h, d, x, y, z, material) => add(new THREE.BoxGeometry(w, h, d), material, x, y, z);
  const cylinder = (r, h, x, y, z, material, rz = 0, sides = 12) => add(new THREE.CylinderGeometry(r, r, h, sides), material, x, y, z, 0, 0, rz);

  const plate = new THREE.Shape();
  plate.moveTo(-36, -69.5); plate.lineTo(36, -69.5);
  plate.lineTo(40, -65.5); plate.lineTo(40, 61);
  plate.lineTo(36, 65); plate.lineTo(-36, 65);
  plate.lineTo(-40, 61); plate.lineTo(-40, -65.5); plate.closePath();
  const aperture = new THREE.Path();
  aperture.moveTo(-32, 43); aperture.lineTo(-32, 62);
  aperture.lineTo(32, 62); aperture.lineTo(32, 43); aperture.closePath();
  plate.holes.push(aperture);
  add(new THREE.ExtrudeGeometry(plate, { depth: 3, bevelEnabled: false, curveSegments: 1 }), 'plate', 0, 8, 0, -Math.PI / 2);

  // Battery envelope 57 x 31 x 8, long axis across the plate, at source X=-52.5.
  box(57, 8, 31, 0, 15, 52.5, 'battery');
  for (const x of [-20, 20]) {
    box(3, 1.2, 32, x, 19.6, 52.5, 'wire');
    box(3, 8, 1.3, x, 15.3, 68.5, 'wire');
    box(3, 8, 1.3, x, 15.3, 36.5, 'wire');
  }
  box(11, 3, 5, 16, 13, 32.5, 'cream');

  // Two nominal N20 envelopes, 36 x 12 x 10, their shafts on the X axle.
  for (const side of [-1, 1]) {
    box(20, 10, 12, side * 28, 17, 0, 'gold');
    box(16, 10, 12, side * 10, 17, 0, 'plate');
    cylinder(1.5, 9, side * 42.5, 17, 0, 'plate', Math.PI / 2);
    cylinder(6, 3, side * 1.5, 17, 0, 'pcb', Math.PI / 2);
    for (const x of [side * 21, side * 35]) {
      box(2, 1.6, 16, x, 23, 0, 'gold');
      box(2, 12, 1.7, x, 17, -8, 'gold');
      box(2, 12, 1.7, x, 17, 8, 'gold');
    }
    box(15, 2, 20, side * 27, 12, 0, 'plate');
  }

  // Pico lies across the plate; source placement (13,-39,90) is its layout anchor.
  box(51, 1, 21, 13.5, 13, -23.5, 'pcb');
  box(7, 1.3, 7, 14, 14.2, -23, 'chip');
  box(8, 3, 6, 35, 15, -23.5, 'plate');
  box(4, 1.6, 3, -4, 14.7, -23, 'cream');
  for (let i = 0; i < 20; i++) {
    const x = -10 + i * 2.54;
    for (const z of [-32.4, -14.6]) {
      cylinder(0.66, 0.4, x, 13.8, z, 'gold', 0, 6);
      box(0.65, 2, 0.65, x, 12, z, 'gold');
    }
  }
  for (let i = 0; i < 7; i++) box(1.5, 0.8, 0.85, 1 + i * 3.4, 14, -18, 'cream');

  // Driver, buck and IMU occupy their hardware.json layout envelopes.
  box(15.2, 1, 20.3, -23, 13, 31.5, 'pcb');
  box(7, 2, 8, -23, 14.5, 31.5, 'chip');
  box(24, 1.2, 20, 25.5, 13, 21.5, 'pcb');
  box(9, 4, 9, 27, 15.6, 22, 'chip');
  box(16, 1, 21, -24, 13, -14, 'pcb');
  box(5, 1.2, 5, -24, 14.2, -14, 'chip');
  cylinder(3.5, 9, -16, 16, 16, 'chip');
  cylinder(3.2, 0.4, -16, 20.7, 16, 'plate');
  box(10, 10, 32, -13, 16, -10.5, 'cream');
  box(6, 2, 23, -13, 22, -10.5, 'chip');
  box(8, 7, 12, -31, 14.5, 55, 'chip');
  box(4, 2, 6, -31, 19, 55, 'red');
  box(6, 3, 6, -32, 13, -36, 'chip');
  cylinder(2, 2, -32, 15, -36, 'cream');

  // Eight QTR optics at source Y = +/-4,12,20,28 and X=55 mm.
  box(61, 1.02, 20, 0, 7, -55, 'sensor');
  for (const x of [-28, -20, -12, -4, 4, 12, 20, 28]) {
    box(3.6, 1.7, 5, x, 5.7, -55, 'chip');
    cylinder(0.7, 0.4, x, 7.8, -57, 'gold', 0, 6);
    box(1.6, 0.6, 2.4, x, 7.8, -51, 'cream');
  }
  for (const x of [-35, 35]) {
    cylinder(1.1, 7, x, 7.5, -55, 'plate');
    cylinder(2.25, 1.4, x, 11.7, -55, 'plate', 0, 6);
    box(2.5, 0.25, 0.4, x, 12.5, -55, 'chip');
  }
  cylinder(8, 4, 0, 6, 28, 'chip');
  add(new THREE.SphereGeometry(4, 12, 8), 'plate', 0, 4, 28);

  const wire = (points, material, radius = 0.55) => {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    add(new THREE.TubeGeometry(curve, 16, radius, 5, false), material, 0, 0, 0);
  };
  wire([[25, 18, 39], [32, 25, 33], [13, 25, 28], [-23, 17, 32]], 'red');
  wire([[22, 18, 39], [28, 23, 31], [9, 24, 26], [-20, 17, 32]], 'wire');
  for (const side of [-1, 1]) {
    wire([[side * 4, 20, 4], [side * 11, 25, 13], [-20, 23, 23], [-23, 16, 28]], 'red', 0.45);
    wire([[side * 4, 20, -3], [side * 9, 26, 10], [-18, 24, 21], [-21, 16, 28]], 'wire', 0.45);
  }
  for (let i = 0; i < 4; i++) {
    wire([[-12 + i * 2, 8, -48], [-14 + i * 2, 16, -40], [-7 + i * 2, 19, -35], [-6 + i * 2, 14, -30]], i % 2 ? 'wire' : 'cream', 0.38);
  }
  for (const [material, geometries] of batches) {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(merged, materials[material]);
    mesh.name = `robot ${material}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    model.add(mesh);
  }

  const wheels = [];
  const tireGeometry = new THREE.CylinderGeometry(17, 17, 7, 32).rotateZ(Math.PI / 2);
  const hubGeometry = new THREE.CylinderGeometry(6, 6, 1.2, 12).rotateZ(Math.PI / 2);
  const spokeGeometry = new THREE.BoxGeometry(1.4, 1.7, 12);
  for (const side of [-1, 1]) {
    const wheel = new THREE.Group();
    wheel.position.set(side * 46, 17, 0);
    const tire = new THREE.Mesh(tireGeometry, materials.rubber);
    tire.castShadow = true;
    wheel.add(tire);
    const hub = new THREE.Mesh(hubGeometry, materials.plate);
    hub.position.x = side * 3.7;
    const spoke = new THREE.Mesh(spokeGeometry, materials.chip);
    spoke.position.x = side * 4.4;
    wheel.add(hub, spoke);
    model.add(wheel);
    wheels.push(wheel);
  }
  return { robot, wheels };
}

function tapeGeometry(segments, width, y) {
  const pieces = segments.map(([a, b]) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    return new THREE.PlaneGeometry(Math.hypot(dx, dz) + width, width)
      .rotateX(-Math.PI / 2).rotateY(-Math.atan2(dz, dx))
      .translate((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
  });
  const geometry = mergeGeometries(pieces, false);
  pieces.forEach(g => g.dispose());
  return geometry;
}

function routeGeometry() {
  const vertices = [], distances = [];
  let travelled = 0;
  for (let i = 1; i < MAZE_ROUTE.length; i++) {
    const a = MAZE_ROUTE[i - 1], b = MAZE_ROUTE[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / length * 0.0035;
    const nz = (b[0] - a[0]) / length * 0.0035;
    const corners = [[a[0] + nx, a[1] + nz], [a[0] - nx, a[1] - nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz]];
    for (const index of [0, 2, 1, 1, 2, 3]) {
      vertices.push(corners[index][0], 0.0018, corners[index][1]);
      distances.push(travelled + (index >= 2 ? length : 0));
    }
    travelled += length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('routeDistance', new THREE.Float32BufferAttribute(distances, 1));
  return geometry;
}

export class Maze {
  constructor(world) {
    this.group = new THREE.Group();
    this.group.name = 'Official Meshmerize example';
    this.group.position.set(0, 0.006, -3.5);
    this.group.visible = false;
    world.scene.add(this.group);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x080b0f, roughness: 0.92, metalness: 0.02 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const white = new THREE.MeshBasicMaterial({ color: 0xf2f1e9, toneMapped: false });
    const tape = new THREE.Mesh(tapeGeometry(LINE_SEGMENTS, 0.03, 0.0008), white);
    tape.name = '30 mm white tape';
    const finish = new THREE.Mesh(new THREE.PlaneGeometry(FINISH_SIZE, FINISH_SIZE), white);
    finish.rotation.x = -Math.PI / 2;
    finish.position.set(FINISH_PAD[0], 0.001, FINISH_PAD[1]);
    finish.name = '400 mm white finish pad';
    this.group.add(floor, tape, finish);
    this.routeMaterial = new THREE.ShaderMaterial({
      uniforms: { uDistance: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `attribute float routeDistance;
        varying float vDistance;
        void main(){vDistance=routeDistance;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform float uDistance;varying float vDistance;
        void main(){if(vDistance>=uDistance)discard;
          float alpha=smoothstep(0.,.012,uDistance-vDistance)*.57;
          gl_FragColor=vec4(.66,.015,.025,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const route = new THREE.Mesh(routeGeometry(), this.routeMaterial);
    route.name = 'Traversed route';
    route.renderOrder = 1;
    this.group.add(route);
    const { robot, wheels } = robotModel();
    this.robot = robot;
    this.wheels = wheels;
    this.group.add(robot);
    this.initialYaw = sampleMaze(0).yaw;
    this.update({ mazeVisible: false, mazeProgress: 0 });
  }

  update(state) {
    const sample = sampleMaze(state.mazeProgress);
    this.group.visible = Boolean(state.mazeVisible);
    this.robot.position.fromArray(sample.position);
    this.robot.position.y = 0.002;
    this.robot.rotation.y = sample.yaw;
    // Absolute wheel angles include pivot travel, so scroll reversal has no drift.
    const turn = (sample.yaw - this.initialYaw) * ROBOT.track * 0.0005;
    const radius = ROBOT.wheel * 0.0005;
    this.wheels[0].rotation.x = (-sample.distance + turn) / radius;
    this.wheels[1].rotation.x = (-sample.distance - turn) / radius;
    this.routeMaterial.uniforms.uDistance.value = Math.min(ROUTE_LENGTH, Math.max(0, sample.distance - 0.035));
  }
}
