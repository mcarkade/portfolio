import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import {
  MAP_SIZE, LINE_SEGMENTS, START, FINISH, FINISH_PAD, FINISH_SIZE,
  MAZE_ROUTE, ROUTE_LENGTH, MOTION_PHASES, sampleMaze,
} from '../src/world/maze-path.js';
import { Maze } from '../src/world/maze.js';

// CPU-only. Run: node tools/maze-path-check.mjs [Meshmerize source directory].
const source = process.argv[2] || 'C:/Abhinav/Projects/iitbtf26_zonals/Meshmerize';
const [probe, plant, hardwareText] = await Promise.all([
  readFile(`${source}/checks/official_example_probe.cpp`, 'utf8'),
  readFile(`${source}/checks/robustness_plant.cpp`, 'utf8'),
  readFile(`${source}/hardware.json`, 'utf8'),
]);
const hardware = JSON.parse(hardwareText);
const close = (a, b, message, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${message}: ${a} vs ${b}`);
const closePoint = (a, b, message) => { assert.equal(a.length, b.length); a.forEach((v, i) => close(v, b[i], message)); };
const separation = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sourcePoint = (u, v) => [(764 - u) * 2.3 / 820, (v - 819) * 2.3 / 803];
const pixelList = probe.match(/const std::vector<PixelStroke> raw\{([\s\S]+?)\n\s*\};/);
assert.ok(pixelList, 'official PixelStroke list exists');
const raw = [...pixelList[1].matchAll(/\{(\d+),(\d+),(\d+),(\d+)\}/g)].map(m => m.slice(1).map(Number));
assert.equal(raw.length, 22);
assert.equal(LINE_SEGMENTS.length, 23, '22 raw strokes plus the source finish connector');
assert.match(probe, /add\(764,819\);a.nodes\[0\].type=NodeType::Start/);
assert.match(probe, /goal=transform\(344,819\)/);
assert.match(probe, /finish\(a,ids.at\(\{173,819\}\),goal.x,goal.y\)/);
assert.match(probe, /\(764-u\)\*2\.3\/820\.0,\(v-819\)\*2\.3\/803\.0/);
assert.match(plant, /cx-v.x\*\.175,cy-v.y\*\.175/);
close(MAP_SIZE, 2.3, 'arena size');
close(FINISH_SIZE, 0.4, 'pad size');
const translate = p => [p[0] - START[0], p[1] - START[1]];
raw.forEach(([u, v, x, y], i) => {
  closePoint(translate(LINE_SEGMENTS[i][0]), sourcePoint(u, v), 'source stroke start');
  closePoint(translate(LINE_SEGMENTS[i][1]), sourcePoint(x, y), 'source stroke end');
});
closePoint(translate(LINE_SEGMENTS[22][0]), sourcePoint(173, 819), 'finish connector start');
closePoint(translate(FINISH_PAD), sourcePoint(344, 819), 'finish pad centre');
closePoint(FINISH, [FINISH_PAD[0] + 0.175, FINISH_PAD[1]], 'source axle stop');
for (const [a, b] of LINE_SEGMENTS) {
  assert.ok(a[0] === b[0] || a[1] === b[1], 'every white stroke is axis aligned');
  for (const p of [a, b]) for (const coordinate of p) assert.ok(Math.abs(coordinate) + 0.015 <= MAP_SIZE / 2, 'white tape fits arena');
}
for (const coordinate of FINISH_PAD) assert.ok(Math.abs(coordinate) + FINISH_SIZE / 2 <= MAP_SIZE / 2, 'finish pad fits arena');

// Independent graph in source pixel coordinates. Split crossings and endpoints,
// then use Bellman-Ford rather than the production Dijkstra implementation.
const sourceSegments = raw.map(([u, v, x, y]) => [[u, v], [x, y]]);
sourceSegments.push([[173, 819], [344, 819]]);
const pixelFinish = [344 - 0.175 * 820 / 2.3, 819];
const nodes = [[764, 819], pixelFinish];
const add = p => { if (!nodes.some(n => separation(n, p) < 1e-7)) nodes.push(p); };
const on = (p, a, b) => Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) < 1e-7
  && p[0] >= Math.min(a[0], b[0]) - 1e-9 && p[0] <= Math.max(a[0], b[0]) + 1e-9
  && p[1] >= Math.min(a[1], b[1]) - 1e-9 && p[1] <= Math.max(a[1], b[1]) + 1e-9;
sourceSegments.forEach(([a, b]) => { add(a); add(b); });
for (const [a, b] of sourceSegments) for (const [c, d] of sourceSegments) {
  if (a[1] !== b[1] || c[0] !== d[0]) continue;
  const p = [c[0], a[1]];
  if (on(p, a, b) && on(p, c, d)) add(p);
}
const edges = [];
for (const [a, b] of sourceSegments) {
  const ids = nodes.map((p, i) => i).filter(i => on(nodes[i], a, b)).sort((i, j) => separation(nodes[i], a) - separation(nodes[j], a));
  for (let i = 1; i < ids.length; i++) {
    const u = ids[i - 1], v = ids[i];
    const weight = separation(sourcePoint(...nodes[u]), sourcePoint(...nodes[v]));
    edges.push([u, v, weight], [v, u, weight]);
  }
}
const weights = nodes.map(() => Infinity);
weights[0] = 0;
for (let pass = 0; pass < nodes.length - 1; pass++) for (const [a, b, weight] of edges) weights[b] = Math.min(weights[b], weights[a] + weight);
close(ROUTE_LENGTH, weights[1], 'weighted shortest route matches independent source graph');
closePoint(MAZE_ROUTE[0], START, 'route starts at source start');
closePoint(MAZE_ROUTE.at(-1), FINISH, 'route ends at source axle stop');
closePoint(sampleMaze(0).position, [START[0], 0, START[1]], 'sample start');
closePoint(sampleMaze(1).position, [FINISH[0], 0, FINISH[1]], 'sample finish');
assert.equal(sampleMaze(1).done, true);
assert.equal(sampleMaze(0.999999).done, false);
assert.deepEqual(sampleMaze(-1), sampleMaze(0));
assert.deepEqual(sampleMaze(2), sampleMaze(1));
assert.deepEqual(sampleMaze(NaN), sampleMaze(0));

let lastDistance = -1;
for (let i = 0; i <= 20000; i++) {
  const p = i / 20000, sample = sampleMaze(p);
  const pos = [sample.position[0], sample.position[2]];
  assert.ok(LINE_SEGMENTS.some(([a, b]) => on(pos, a, b)), `sample ${p} follows actual white tape`);
  assert.ok(sample.distance >= lastDistance, 'route distance is monotone');
  lastDistance = sample.distance;
  assert.deepEqual(sampleMaze(p), sample, 'sampling is stateless');
}
close(lastDistance, ROUTE_LENGTH, 'distance ends at route length');
let corners = 0;
for (const phase of MOTION_PHASES) {
  const before = sampleMaze(phase.start), after = sampleMaze(phase.end);
  const middle = sampleMaze((phase.start + phase.end) / 2);
  if (phase.type === 'pivot') {
    corners++;
    closePoint(before.position, after.position, 'pivot remains at corner');
    closePoint(before.position, middle.position, 'pivot midpoint remains at corner');
    close(before.distance, after.distance, 'pivot adds no forward distance');
    close(Math.abs(after.yaw - before.yaw), Math.PI / 2, 'right-angle pivot');
  } else {
    const dx = phase.to[0] - phase.from[0], dz = phase.to[1] - phase.from[1];
    close(-Math.sin(middle.yaw), dx / phase.length, 'nose follows X direction');
    close(-Math.cos(middle.yaw), dz / phase.length, 'nose follows Z direction');
    const h = (phase.end - phase.start) * 1e-5;
    assert.ok(separation([before.position[0], before.position[2]], [sampleMaze(phase.start + h).position[0], sampleMaze(phase.start + h).position[2]]) < phase.length * 1e-8, 'zero-speed departure');
    assert.ok(separation([after.position[0], after.position[2]], [sampleMaze(phase.end - h).position[0], sampleMaze(phase.end - h).position[2]]) < phase.length * 1e-8, 'zero-speed arrival');
  }
}
assert.equal(corners, MAZE_ROUTE.length - 2, 'every route corner has an in-place pivot');

const scene = new THREE.Scene();
const maze = new Maze({ scene });
assert.ok(scene.children.includes(maze.group));
closePoint(maze.group.position.toArray(), [0, 0.006, -3.5], 'contract group transform');
assert.equal(maze.group.visible, false);
assert.equal(maze.robot.userData.dimensions.plateLength, hardware.geometry.plate_length);
assert.equal(maze.robot.userData.dimensions.plateWidth, hardware.geometry.plate_width);
assert.equal(maze.robot.userData.dimensions.wheel, hardware.geometry.wheel_diameter);
assert.equal(maze.robot.userData.dimensions.track, hardware.geometry.track);
// Check generated vertices and transforms, as well as declared dimensions.
close(Math.abs(maze.wheels[1].position.x - maze.wheels[0].position.x), hardware.geometry.track, 'actual wheel track in model mm');
for (const wheel of maze.wheels) {
  const tire = wheel.children[0].geometry;
  tire.computeBoundingBox();
  const size = tire.boundingBox.getSize(new THREE.Vector3());
  close(size.x, hardware.geometry.wheel_width, 'actual tire width');
  close(size.y, hardware.geometry.wheel_diameter, 'actual tire diameter');
  close(size.z, hardware.geometry.wheel_diameter, 'actual tire diameter');
  close(wheel.position.y, hardware.geometry.axle_z, 'actual axle height');
}
const plate = maze.robot.getObjectByName('robot plate').geometry;
plate.computeBoundingBox();
close(plate.boundingBox.max.z - plate.boundingBox.min.z, hardware.geometry.plate_length, 'actual plate length');
const plateVertices = plate.attributes.position;
const plateBottom = [];
for (let i = 0; i < plateVertices.count; i++) {
  if (Math.abs(plateVertices.getY(i) - hardware.geometry.plate_under_z) < 1e-6) plateBottom.push(plateVertices.getX(i));
}
close(Math.max(...plateBottom) - Math.min(...plateBottom), hardware.geometry.plate_width, 'actual plate width');
let meshes = 0, triangles = 0;
const identities = [];
maze.group.traverse(o => {
  if (!o.isMesh) return;
  meshes++;
  identities.push([o.uuid, o.geometry.uuid, o.material.uuid]);
  triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
  for (const value of o.geometry.attributes.position.array) assert.ok(Number.isFinite(value), 'finite constructor geometry');
});
assert.ok(meshes <= 24, `bounded mesh count: ${meshes}`);
assert.ok(triangles < 20000, `bounded triangle count: ${triangles}`);
const capture = p => {
  maze.update({ mazeVisible: true, mazeProgress: p });
  assert.equal(maze.group.visible, true);
  return { position: maze.robot.position.toArray(), yaw: maze.robot.rotation.y,
    wheels: maze.wheels.map(w => w.rotation.x), reveal: maze.routeMaterial.uniforms.uDistance.value };
};
const forward = Array.from({ length: 1001 }, (_, i) => capture(i / 1000));
for (let i = 1000; i >= 0; i--) assert.deepEqual(capture(i / 1000), forward[i], 'exact reverse playback including wheels and route reveal');
assert.equal(forward[0].reveal, 0);
assert.ok(forward.at(-1).reveal < ROUTE_LENGTH, 'route reveal stays behind robot');
maze.update({ mazeVisible: false, mazeProgress: 1 });
assert.equal(maze.group.visible, false);
assert.deepEqual(capture(0.73), forward[730], 're-entry is independent of hidden updates');
const afterIdentities = [];
maze.group.traverse(o => { if (o.isMesh) afterIdentities.push([o.uuid, o.geometry.uuid, o.material.uuid]); });
assert.deepEqual(afterIdentities, identities, 'all geometry and materials are built in constructor');
console.log(`PASS: 22 source strokes + finish; ${nodes.length} split nodes; ${ROUTE_LENGTH.toFixed(6)} m weighted shortest route; ${corners} stationary right-angle pivots; 20,001 tape samples; 1,001 exact reverse states; ${meshes} meshes / ${triangles} triangles. CPU only, no render or hardware claim.`);
