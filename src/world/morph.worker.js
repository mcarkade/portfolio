import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

// Geometry copies arrive here, never a second GLB decode. All triangle work is off-thread.
self.onmessage = ({ data: { id, meshes, count } }) => {
  const started = performance.now();
  let seed = id === 'source' ? 781 : 1949;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
  const point = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const bounds = new THREE.Box3();
  let area = 0;
  const surfaces = [];
  for (const entry of meshes) {
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(entry.position, 3);
    matrix.fromArray(entry.matrix);
    position.applyMatrix4(matrix);
    geometry.setAttribute('position', position);
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox);
    if (entry.index) geometry.setIndex(new THREE.BufferAttribute(entry.index, 1));
    const sampler = new MeshSurfaceSampler(new THREE.Mesh(geometry)).setRandomGenerator(random).build();
    const weight = sampler.distribution.at(-1);
    if (weight > 0) {
      area += weight;
      surfaces.push({ sampler, end: area, part: entry.part });
    }
  }
  if (!surfaces.length) { self.postMessage({ id, error: 'No nonzero mesh surfaces' }); return; }
  const points = new Float32Array(count * 3);
  const parts = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const pick = random() * area;
    let lo = 0, hi = surfaces.length - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (pick < surfaces[mid].end) hi = mid; else lo = mid + 1; }
    const surface = surfaces[lo];
    surface.sampler.sample(point);
    point.toArray(points, i * 3);
    parts[i] = surface.part;
  }
  self.postMessage({ id, points, parts, center: bounds.getCenter(point).toArray(), area, meshes: surfaces.length, workerMs: performance.now() - started }, [points.buffer, parts.buffer]);
};
