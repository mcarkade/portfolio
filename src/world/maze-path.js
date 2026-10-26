// Source: iitbtf26_zonals/Meshmerize/checks/official_example_probe.cpp,
// official_example() PixelStroke list, transform(), and finish(173,819 -> 344,819).
// This preserves that approximate digitization, not a surveyed venue or robot trial.
// Metres, +Y up. The source's XY plane becomes XZ, translated to centre the tape
// extents on a 2.3 m square. No drawing annotations are part of the track.
export const MAP_SIZE = 2.3;
const SX = MAP_SIZE / 820;
const SZ = MAP_SIZE / 803;
const point = (u, v) => [(514.5 - u) * SX, (v - 561) * SZ];
const freezePoint = p => Object.freeze(p);
const raw = [
  [173, 200, 856, 200], [173, 200, 173, 343], [173, 343, 280, 343],
  [280, 200, 280, 577], [412, 200, 412, 343], [412, 343, 521, 343],
  [521, 200, 521, 471], [173, 471, 521, 471], [628, 200, 628, 428],
  [628, 323, 856, 323], [856, 200, 856, 543], [739, 323, 739, 434],
  [739, 434, 856, 434], [628, 543, 856, 543], [739, 543, 739, 682],
  [558, 682, 840, 682], [558, 682, 558, 782], [663, 682, 663, 922],
  [663, 819, 764, 819], [383, 471, 383, 678], [173, 577, 519, 577],
  [173, 577, 173, 819],
];
export const START = freezePoint(point(764, 819));
export const FINISH_PAD = freezePoint(point(344, 819));
export const FINISH_SIZE = 0.4;
// robustness_plant.cpp finish(): the axle stops 175 mm before the pad centre.
export const FINISH = freezePoint([FINISH_PAD[0] + 0.175, FINISH_PAD[1]]);
export const LINE_SEGMENTS = Object.freeze([
  ...raw.map(([u, v, x, y]) => [point(u, v), point(x, y)]),
  [point(173, 819), [...FINISH_PAD]],
].map(segment => Object.freeze(segment.map(freezePoint))));

const EPS = 1e-9;
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const onSegment = (p, a, b) => Math.abs(
  (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]),
) < EPS && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS
  && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;

function shortestRoute() {
  const nodes = [];
  const add = p => {
    const existing = nodes.findIndex(n => distance(n, p) < EPS);
    if (existing >= 0) return existing;
    nodes.push(p);
    return nodes.length - 1;
  };
  const start = add(START), finish = add(FINISH);
  for (const [a, b] of LINE_SEGMENTS) { add(a); add(b); }
  for (const [a, b] of LINE_SEGMENTS) {
    if (Math.abs(a[1] - b[1]) > EPS) continue;
    for (const [c, d] of LINE_SEGMENTS) {
      if (Math.abs(c[0] - d[0]) > EPS) continue;
      const p = [c[0], a[1]];
      if (onSegment(p, a, b) && onSegment(p, c, d)) add(p);
    }
  }
  const edges = nodes.map(() => new Map());
  for (const [a, b] of LINE_SEGMENTS) {
    const along = nodes.map((p, id) => ({ p, id })).filter(n => onSegment(n.p, a, b))
      .sort((m, n) => distance(a, m.p) - distance(a, n.p));
    for (let i = 1; i < along.length; i++) {
      const m = along[i - 1], n = along[i], weight = distance(m.p, n.p);
      edges[m.id].set(n.id, weight);
      edges[n.id].set(m.id, weight);
    }
  }
  const weights = nodes.map(() => Infinity), previous = nodes.map(() => -1);
  const visited = new Set();
  weights[start] = 0;
  while (visited.size < nodes.length) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (!visited.has(i) && (current < 0 || weights[i] < weights[current])) current = i;
    }
    if (current < 0 || !Number.isFinite(weights[current])) throw new Error('Disconnected official maze');
    if (current === finish) break;
    visited.add(current);
    for (const [next, weight] of edges[current]) {
      if (weights[current] + weight < weights[next] - EPS) {
        weights[next] = weights[current] + weight;
        previous[next] = current;
      }
    }
  }
  const route = [];
  for (let id = finish; id >= 0; id = previous[id]) route.unshift(nodes[id]);
  // Straight-through junctions retain their tape geometry but do not cause stops.
  return route.filter((p, i) => {
    if (i === 0 || i === route.length - 1) return true;
    const a = route[i - 1], b = route[i + 1];
    return !onSegment(p, a, b);
  });
}

export const MAZE_ROUTE = Object.freeze(shortestRoute().map(p => freezePoint([...p])));
export const ROUTE_LENGTH = MAZE_ROUTE.slice(1).reduce((total, p, i) => total + distance(MAZE_ROUTE[i], p), 0);
// Local robot nose is -Z. Unwrapped yaw keeps differential wheel travel continuous.
const heading = (a, b) => Math.atan2(a[0] - b[0], a[1] - b[1]);
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const phases = [];
let elapsed = 0, travelled = 0, yaw = heading(MAZE_ROUTE[0], MAZE_ROUTE[1]);
for (let i = 1; i < MAZE_ROUTE.length; i++) {
  const from = MAZE_ROUTE[i - 1], to = MAZE_ROUTE[i];
  const target = yaw + angleDelta(yaw, heading(from, to));
  if (Math.abs(target - yaw) > EPS) {
    // A finite pivot interval, weighted like 65 mm of travel per right angle.
    const duration = Math.abs(target - yaw) / (Math.PI / 2) * 0.065;
    phases.push({ type: 'pivot', from, to: from, yaw, target, distance: travelled, length: 0, start: elapsed, end: elapsed + duration });
    elapsed += duration;
    yaw = target;
  }
  const length = distance(from, to);
  phases.push({ type: 'drive', from, to, yaw, target: yaw, distance: travelled, length, start: elapsed, end: elapsed + length });
  elapsed += length;
  travelled += length;
}
export const MOTION_PHASES = Object.freeze(phases.map(p => Object.freeze({ ...p, start: p.start / elapsed, end: p.end / elapsed })));
const smooth = t => t * t * (3 - 2 * t);

export function sampleMaze(progress) {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const phase = MOTION_PHASES.find(step => p <= step.end) || MOTION_PHASES.at(-1);
  const t = smooth(Math.max(0, Math.min(1, (p - phase.start) / (phase.end - phase.start))));
  return {
    position: [phase.from[0] + (phase.to[0] - phase.from[0]) * t, 0, phase.from[1] + (phase.to[1] - phase.from[1]) * t],
    yaw: phase.yaw + (phase.target - phase.yaw) * t,
    distance: phase.distance + phase.length * t,
    done: p === 1,
  };
}
