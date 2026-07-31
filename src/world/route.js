import { wrapAngle } from '../util/math.js';

/**
 * Turn-by-turn routing over the road graph.
 *
 * Plain Dijkstra across the junctions, weighted by travel time rather than
 * distance so it prefers a motorway to a back street — which is what makes a
 * suggested route look sensible instead of merely short.
 */

/** Cheapest path between two junctions. Returns node ids, or null. */
function search(network, startNode, endNode) {
  const n = network.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[startNode] = 0;

  // A binary heap keyed on the tentative cost; the graph is a few thousand
  // nodes, so this stays comfortably fast enough to run on a keypress.
  const heap = [{ id: startNode, d: 0 }];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].d <= heap[i].d) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].d < heap[m].d) m = l;
        if (r < heap.length && heap[r].d < heap[m].d) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  while (heap.length) {
    const cur = pop();
    if (done[cur.id]) continue;
    done[cur.id] = 1;
    if (cur.id === endNode) break;

    for (const eid of network.nodes[cur.id].edges) {
      const e = network.edges[eid];
      const other = e.a === cur.id ? e.b : e.a;
      if (done[other]) continue;
      // time = length / speed, so a fast road is cheap per metre
      const cost = e.length / Math.max(4, e.speed ?? 12);
      const nd = cur.d + cost;
      if (nd < dist[other]) {
        dist[other] = nd;
        from[other] = cur.id;
        push({ id: other, d: nd });
      }
    }
  }

  if (!Number.isFinite(dist[endNode])) return null;
  const path = [];
  for (let at = endNode; at !== -1; at = from[at]) path.push(at);
  return path.reverse();
}

/** The junction nearest a point, preferring one on the road under it. */
function nearestNode(network, x, z) {
  const near = network.nearestRoad(x, z);
  if (near) {
    const e = network.edges[near.edge];
    const a = network.nodes[e.a];
    const b = network.nodes[e.b];
    const da = (a.x - x) ** 2 + (a.z - z) ** 2;
    const db = (b.x - x) ** 2 + (b.z - z) ** 2;
    return da < db ? e.a : e.b;
  }
  let best = -1;
  let bestD = Infinity;
  for (const nd of network.nodes) {
    const d = (nd.x - x) ** 2 + (nd.z - z) ** 2;
    if (d < bestD) { bestD = d; best = nd.id; }
  }
  return best;
}

/**
 * Builds a route from a point to a point.
 * @returns {{points:[], legs:[], length:number}|null}
 *   `points` is the drawn polyline, `legs` the turn instructions.
 */
export function findRoute(network, fromX, fromZ, toX, toZ) {
  const a = nearestNode(network, fromX, fromZ);
  const b = nearestNode(network, toX, toZ);
  if (a < 0 || b < 0) return null;
  if (a === b) {
    return {
      points: [{ x: fromX, z: fromZ }, { x: toX, z: toZ }],
      legs: [{ x: toX, z: toZ, turn: 'arrive', s: Math.hypot(toX - fromX, toZ - fromZ), name: '' }],
      length: Math.hypot(toX - fromX, toZ - fromZ)
    };
  }

  const nodes = search(network, a, b);
  if (!nodes) return null;

  const points = [{ x: fromX, z: fromZ }];
  const legs = [];
  let total = 0;
  let heading = null;

  for (let i = 0; i < nodes.length - 1; i++) {
    const from = network.nodes[nodes[i]];
    const to = network.nodes[nodes[i + 1]];
    // the edge actually joining them, cheapest if there are several
    let edge = null;
    for (const eid of from.edges) {
      const e = network.edges[eid];
      if (e.a !== to.id && e.b !== to.id) continue;
      if (!edge || e.length < edge.length) edge = e;
    }
    if (!edge) continue;

    const forward = edge.a === from.id;
    const path = forward ? edge.path : [...edge.path].reverse();
    for (const p of path) points.push({ x: p.x, z: p.z });
    total += edge.length;

    // which way you turn at this junction
    const inDir = Math.atan2(path[1].x - path[0].x, path[1].z - path[0].z);
    if (heading !== null) {
      const delta = wrapAngle(inDir - heading);
      let turn = 'straight';
      if (delta > 0.45) turn = delta > 1.9 ? 'sharp-left' : 'left';
      else if (delta < -0.45) turn = delta < -1.9 ? 'sharp-right' : 'right';
      legs.push({ x: from.x, z: from.z, turn, name: edge.name || '', s: total - edge.length });
    }
    const last = path[path.length - 1];
    const prev = path[path.length - 2] || path[0];
    heading = Math.atan2(last.x - prev.x, last.z - prev.z);
  }

  points.push({ x: toX, z: toZ });
  legs.push({ x: toX, z: toZ, turn: 'arrive', name: '', s: total });
  return { points, legs, length: total };
}

export const TURN_LABEL = {
  straight: 'düz devam et',
  left: 'sola dön',
  right: 'sağa dön',
  'sharp-left': 'keskin sola dön',
  'sharp-right': 'keskin sağa dön',
  arrive: 'hedefe vardın'
};

export const TURN_ARROW = {
  straight: '↑', left: '↰', right: '↱',
  'sharp-left': '⤺', 'sharp-right': '⤻', arrive: '⚑'
};
