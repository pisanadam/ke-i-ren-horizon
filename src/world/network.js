import * as THREE from 'three';
import { ROADS, ROAD_TYPES, FILLER_GRID, LANDMARKS, MAP } from './mapData.js';
import { baseHeight } from './heightfield.js';
import { makeRng, clamp, lerp, distToSegment2, segIntersect, wrapAngle } from '../util/math.js';

const RESAMPLE = 11;      // metres between polyline points after smoothing
const NODE_MERGE = 9;     // intersections closer than this become one node
const QUERY_CELL = 40;    // spatial hash cell size for nearest-road lookups

/**
 * Turns the hand-authored polylines in mapData into a real road graph:
 * smoothed centrelines, intersections, nodes, edges, heights and traffic
 * lights, plus the spatial queries the rest of the game needs.
 */
export class RoadNetwork {
  constructor() {
    this.roads = [];
    this.nodes = [];
    this.edges = [];
    this.lights = [];
    this._cells = new Map();
    this._segs = [];
  }

  build() {
    this._collectRoads();
    this._smoothAndResample();
    this._findIntersections();
    this._buildEdges();
    this._solveHeights();
    this._indexSegments();
    this._placeTrafficLights();
    return this;
  }

  // ------------------------------------------------------------------ roads

  _collectRoads() {
    for (const def of ROADS) {
      this.roads.push({
        name: def.name,
        type: def.type,
        major: !!def.major,
        raw: def.points.map(([x, z]) => ({ x, z })),
        spec: ROAD_TYPES[def.type]
      });
    }
    this._addFillerGrid();
  }

  /** Minor connectors that turn the arteries into an actual street grid. */
  _addFillerGrid() {
    const rng = makeRng(20240501);
    const { spacingX, spacingZ, jitter, type, keepChance } = FILLER_GRID;
    const spec = ROAD_TYPES[type];
    const H = MAP.half;
    const runs = [];

    const emit = (pts) => {
      // Cut the line wherever it would run through a landmark plot.
      let current = [];
      for (const p of pts) {
        const blocked = LANDMARKS.some(
          (l) => Math.hypot(p.x - l.x, p.z - l.z) < l.radius * 0.92
        );
        if (blocked) {
          if (current.length >= 3) runs.push(current);
          current = [];
        } else {
          current.push(p);
        }
      }
      if (current.length >= 3) runs.push(current);
    };

    for (let x = -H + spacingX * 0.5; x < H; x += spacingX) {
      if (rng() > keepChance) continue;
      const pts = [];
      const wob = (rng() - 0.5) * 0.004;
      for (let z = -H + 30; z <= H - 30; z += 120) {
        pts.push({
          x: x + Math.sin(z * 0.006 + x) * jitter + z * wob,
          z: z + (rng() - 0.5) * 8
        });
      }
      emit(pts);
    }
    for (let z = -H + spacingZ * 0.5; z < H; z += spacingZ) {
      if (rng() > keepChance) continue;
      const pts = [];
      const wob = (rng() - 0.5) * 0.004;
      for (let x = -H + 30; x <= H - 30; x += 120) {
        pts.push({
          x: x + (rng() - 0.5) * 8,
          z: z + Math.cos(x * 0.0055 + z) * jitter + x * wob
        });
      }
      emit(pts);
    }

    let n = 0;
    for (const pts of runs) {
      this.roads.push({
        name: `Sokak ${++n}`,
        type,
        major: false,
        minor: true,
        raw: pts,
        spec
      });
    }
  }

  /** Catmull-Rom smoothing so corners are drivable, then even resampling. */
  _smoothAndResample() {
    for (const road of this.roads) {
      const pts = road.raw.map((p) => new THREE.Vector3(p.x, 0, p.z));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
      const approxLen = curve.getLength();
      const count = Math.max(2, Math.round(approxLen / RESAMPLE));
      const sampled = curve.getSpacedPoints(count);
      road.pts = sampled.map((p) => ({ x: p.x, z: p.z, y: 0 }));
      road.length = approxLen;
      road.cuts = [];
    }
  }

  // ------------------------------------------------------- intersections

  _findIntersections() {
    // Bucket every segment so we only test pairs that can possibly meet.
    const cell = 60;
    const buckets = new Map();
    const key = (cx, cz) => cx * 100003 + cz;

    const segs = [];
    this.roads.forEach((road, ri) => {
      for (let i = 0; i < road.pts.length - 1; i++) {
        segs.push({ ri, i, a: road.pts[i], b: road.pts[i + 1] });
      }
    });

    segs.forEach((s, si) => {
      const minx = Math.min(s.a.x, s.b.x);
      const maxx = Math.max(s.a.x, s.b.x);
      const minz = Math.min(s.a.z, s.b.z);
      const maxz = Math.max(s.a.z, s.b.z);
      for (let cx = Math.floor(minx / cell); cx <= Math.floor(maxx / cell); cx++) {
        for (let cz = Math.floor(minz / cell); cz <= Math.floor(maxz / cell); cz++) {
          const k = key(cx, cz);
          let arr = buckets.get(k);
          if (!arr) buckets.set(k, (arr = []));
          arr.push(si);
        }
      }
    });

    const seen = new Set();
    const hits = [];
    for (const arr of buckets.values()) {
      for (let a = 0; a < arr.length; a++) {
        for (let b = a + 1; b < arr.length; b++) {
          const sa = segs[arr[a]];
          const sb = segs[arr[b]];
          if (sa.ri === sb.ri) continue;
          const pairKey = arr[a] < arr[b] ? arr[a] * 1e6 + arr[b] : arr[b] * 1e6 + arr[a];
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);
          const hit = segIntersect(sa.a, sa.b, sb.a, sb.b);
          if (hit) hits.push({ hit, sa, sb });
        }
      }
    }

    // Merge nearby crossings into shared nodes.
    const nodeGrid = new Map();
    const nkey = (x, z) => `${Math.round(x / NODE_MERGE)},${Math.round(z / NODE_MERGE)}`;
    const nodeAt = (x, z) => {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const found = nodeGrid.get(nkey(x + dx * NODE_MERGE, z + dz * NODE_MERGE));
          if (found !== undefined) {
            const n = this.nodes[found];
            if (Math.hypot(n.x - x, n.z - z) < NODE_MERGE) return found;
          }
        }
      }
      const id = this.nodes.length;
      this.nodes.push({ id, x, z, y: 0, edges: [], light: null });
      nodeGrid.set(nkey(x, z), id);
      return id;
    };

    for (const { hit, sa, sb } of hits) {
      const id = nodeAt(hit.x, hit.z);
      this.roads[sa.ri].cuts.push({ si: sa.i, t: hit.t, node: id });
      this.roads[sb.ri].cuts.push({ si: sb.i, t: hit.u, node: id });
    }

    this._nodeAt = nodeAt;
  }

  // -------------------------------------------------------------- edges

  _buildEdges() {
    for (const road of this.roads) {
      // Insert intersection points into the polyline, in order.
      road.cuts.sort((p, q) => (p.si - q.si) || (p.t - q.t));
      const pts = [];
      const marks = [];
      let ci = 0;
      for (let i = 0; i < road.pts.length; i++) {
        pts.push(road.pts[i]);
        while (ci < road.cuts.length && road.cuts[ci].si === i) {
          const cut = road.cuts[ci++];
          const a = road.pts[i];
          const b = road.pts[i + 1];
          if (!b) break;
          const p = { x: lerp(a.x, b.x, cut.t), z: lerp(a.z, b.z, cut.t), y: 0 };
          const node = this.nodes[cut.node];
          p.x = node.x;
          p.z = node.z;
          // Skip duplicates when two roads cross at nearly the same spot.
          const last = pts[pts.length - 1];
          if (Math.hypot(last.x - p.x, last.z - p.z) < 0.6) {
            marks.push({ index: pts.length - 1, node: cut.node });
          } else {
            pts.push(p);
            marks.push({ index: pts.length - 1, node: cut.node });
          }
        }
      }
      road.pts = pts;
      road.marks = marks;
    }

    // Endpoints of every road also become (degree-1) nodes.
    for (const road of this.roads) {
      const first = road.pts[0];
      const last = road.pts[road.pts.length - 1];
      const hasStart = road.marks.some((m) => m.index === 0);
      const hasEnd = road.marks.some((m) => m.index === road.pts.length - 1);
      if (!hasStart) road.marks.unshift({ index: 0, node: this._nodeAt(first.x, first.z) });
      if (!hasEnd) road.marks.push({ index: road.pts.length - 1, node: this._nodeAt(last.x, last.z) });
      road.marks.sort((a, b) => a.index - b.index);
    }

    // One edge per stretch of road between consecutive nodes.
    this.roads.forEach((road, ri) => {
      for (let m = 0; m < road.marks.length - 1; m++) {
        const i0 = road.marks[m].index;
        const i1 = road.marks[m + 1].index;
        if (i1 <= i0) continue;
        const path = road.pts.slice(i0, i1 + 1);
        if (path.length < 2) continue;
        let len = 0;
        for (let i = 0; i < path.length - 1; i++) {
          len += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
        }
        if (len < 6) continue;
        const edge = {
          id: this.edges.length,
          road: ri,
          name: road.name,
          type: road.type,
          major: road.major,
          minor: !!road.minor,
          width: road.spec.width,
          speed: road.spec.speed,
          layer: road.spec.layer,
          marks: road.spec.marks,
          a: road.marks[m].node,
          b: road.marks[m + 1].node,
          path,
          i0,
          i1,
          length: len
        };
        this.edges.push(edge);
        this.nodes[edge.a].edges.push(edge.id);
        this.nodes[edge.b].edges.push(edge.id);
      }
    });

    // Drop nodes nothing connects to.
    this.nodes.forEach((n) => { n.degree = n.edges.length; });
  }

  // ------------------------------------------------------------ heights

  _solveHeights() {
    // 1. sample the natural terrain along every centreline
    for (const road of this.roads) {
      for (const p of road.pts) p.y = baseHeight(p.x, p.z);
    }

    const smoothRoad = (road, pinned) => {
      const n = road.pts.length;
      if (n < 3) return;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        let w = 0;
        for (let k = -4; k <= 4; k++) {
          const j = clamp(i + k, 0, n - 1);
          const weight = 1 / (1 + Math.abs(k));
          sum += road.pts[j].y * weight;
          w += weight;
        }
        out[i] = sum / w;
      }
      for (let i = 0; i < n; i++) road.pts[i].y = out[i];
      if (pinned) {
        for (const m of road.marks) {
          road.pts[m.index].y = this.nodes[m.node].y;
        }
      }
    };

    // 2. relax: smooth each road, then agree on a shared height per node
    for (let pass = 0; pass < 4; pass++) {
      for (const road of this.roads) smoothRoad(road, pass > 0);

      const acc = this.nodes.map(() => ({ sum: 0, n: 0 }));
      for (const road of this.roads) {
        for (const m of road.marks) {
          acc[m.node].sum += road.pts[m.index].y;
          acc[m.node].n++;
        }
      }
      this.nodes.forEach((node, i) => {
        if (acc[i].n) node.y = acc[i].sum / acc[i].n;
      });
    }

    // 3. final pin so intersections are perfectly flat across roads
    for (const road of this.roads) {
      for (const m of road.marks) road.pts[m.index].y = this.nodes[m.node].y;
      // re-interpolate between pinned marks to remove any residual kink
      for (let m = 0; m < road.marks.length - 1; m++) {
        const i0 = road.marks[m].index;
        const i1 = road.marks[m + 1].index;
        const y0 = road.pts[i0].y;
        const y1 = road.pts[i1].y;
        const span = i1 - i0;
        for (let i = i0 + 1; i < i1; i++) {
          const t = (i - i0) / span;
          road.pts[i].y = lerp(y0, y1, t) * 0.72 + road.pts[i].y * 0.28;
        }
      }
    }

    // edges inherit the resolved heights (paths share the point objects)
    for (const edge of this.edges) {
      edge.cum = [0];
      for (let i = 0; i < edge.path.length - 1; i++) {
        edge.cum.push(
          edge.cum[i] +
            Math.hypot(edge.path[i + 1].x - edge.path[i].x, edge.path[i + 1].z - edge.path[i].z)
        );
      }
      edge.length = edge.cum[edge.cum.length - 1];
    }
  }

  // ------------------------------------------------------ spatial index

  _indexSegments() {
    this._segs = [];
    for (const edge of this.edges) {
      const hw = edge.width * 0.5;
      // pavements exist on everything except the ring road (see roads.js)
      const walk = edge.type === 'highway' ? 0 : (edge.major ? 4.0 : 3.0);
      const walkOuter = walk ? hw + 0.4 + walk : 0;
      for (let i = 0; i < edge.path.length - 1; i++) {
        this._segs.push({
          ax: edge.path[i].x, az: edge.path[i].z, ay: edge.path[i].y,
          bx: edge.path[i + 1].x, bz: edge.path[i + 1].z, by: edge.path[i + 1].y,
          hw,
          walkOuter,
          edge: edge.id,
          s0: edge.cum[i],
          segLen: edge.cum[i + 1] - edge.cum[i]
        });
      }
    }

    this._cells.clear();
    const pad = 26;
    this._segs.forEach((s, i) => {
      const minx = Math.min(s.ax, s.bx) - s.hw - pad;
      const maxx = Math.max(s.ax, s.bx) + s.hw + pad;
      const minz = Math.min(s.az, s.bz) - s.hw - pad;
      const maxz = Math.max(s.az, s.bz) + s.hw + pad;
      for (let cx = Math.floor(minx / QUERY_CELL); cx <= Math.floor(maxx / QUERY_CELL); cx++) {
        for (let cz = Math.floor(minz / QUERY_CELL); cz <= Math.floor(maxz / QUERY_CELL); cz++) {
          const k = cx * 100003 + cz;
          let arr = this._cells.get(k);
          if (!arr) this._cells.set(k, (arr = []));
          arr.push(i);
        }
      }
    });
  }

  /**
   * Nearest point on any carriageway.
   * @returns {{dist:number, y:number, halfWidth:number, edge:number}|null}
   */
  nearestRoad(x, z) {
    const cx = Math.floor(x / QUERY_CELL);
    const cz = Math.floor(z / QUERY_CELL);
    let best = null;
    let bestD2 = Infinity;
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const arr = this._cells.get(ix * 100003 + iz);
        if (!arr) continue;
        for (let n = 0; n < arr.length; n++) {
          const s = this._segs[arr[n]];
          const r = distToSegment2(x, z, s.ax, s.az, s.bx, s.bz);
          if (r.d2 < bestD2) {
            bestD2 = r.d2;
            best = { seg: s, t: r.t };
          }
        }
      }
    }
    if (!best) return null;
    const s = best.seg;
    let dx = s.bx - s.ax;
    let dz = s.bz - s.az;
    const len = Math.hypot(dx, dz) || 1;
    return {
      dist: Math.sqrt(bestD2),
      y: lerp(s.ay, s.by, best.t),
      halfWidth: s.hw,
      walkOuter: s.walkOuter,
      edge: s.edge,
      s: s.s0 + best.t * s.segLen,   // arc length along the edge
      dx: dx / len,
      dz: dz / len
    };
  }

  /** True when the point sits on tarmac (used for surface grip and effects). */
  isOnRoad(x, z) {
    const r = this.nearestRoad(x, z);
    return !!r && r.dist < r.halfWidth;
  }

  // ---------------------------------------------------- traffic lights

  _placeTrafficLights() {
    const dirOf = (edge, node) => {
      const p = edge.path;
      if (edge.a === node) {
        return Math.atan2(p[1].x - p[0].x, p[1].z - p[0].z);
      }
      const n = p.length - 1;
      return Math.atan2(p[n - 1].x - p[n].x, p[n - 1].z - p[n].z);
    };

    for (const node of this.nodes) {
      if (node.edges.length < 3) continue;
      const conn = node.edges.map((id) => this.edges[id]);
      const anyMajor = conn.some((e) => e.major);
      if (!anyMajor) continue;

      // Split approaches into two phase groups by orientation.
      const base = dirOf(conn[0], node.id);
      const groups = [[], []];
      for (const e of conn) {
        const a = wrapAngle(dirOf(e, node.id) - base);
        const perp = Math.abs(Math.abs(a) - Math.PI / 2) < Math.PI / 4;
        groups[perp ? 1 : 0].push(e.id);
      }
      if (!groups[0].length || !groups[1].length) continue;

      const light = {
        node: node.id,
        x: node.x,
        z: node.z,
        y: node.y,
        groups,
        baseAngle: base,
        offset: (node.x * 0.013 + node.z * 0.019) % 1,
        phase: 0,
        state: ['green', 'red']
      };
      node.light = light;
      this.lights.push(light);
    }
  }

  /** Advance every signal. Cycle: 14 s green, 2.6 s yellow, then swap. */
  updateLights(clockSeconds) {
    const GREEN = 14;
    const YELLOW = 2.6;
    const HALF = GREEN + YELLOW;
    const FULL = HALF * 2;
    for (const l of this.lights) {
      const t = (clockSeconds + l.offset * FULL) % FULL;
      if (t < GREEN) l.state = ['green', 'red'];
      else if (t < HALF) l.state = ['yellow', 'red'];
      else if (t < HALF + GREEN) l.state = ['red', 'green'];
      else l.state = ['red', 'yellow'];
    }
  }

  /** Signal colour an approaching vehicle on `edgeId` sees at `nodeId`. */
  lightFor(nodeId, edgeId) {
    const node = this.nodes[nodeId];
    if (!node || !node.light) return 'green';
    const l = node.light;
    if (l.groups[0].includes(edgeId)) return l.state[0];
    if (l.groups[1].includes(edgeId)) return l.state[1];
    return 'green';
  }

  // ------------------------------------------------------------ helpers

  /** Interpolated world position `s` metres along an edge, in the given direction. */
  pointAlong(edge, s, forward = true, out = { x: 0, y: 0, z: 0, dx: 0, dz: 0 }) {
    const dist = forward ? s : edge.length - s;
    const cum = edge.cum;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < dist) i++;
    const t = (dist - cum[i - 1]) / Math.max(1e-4, cum[i] - cum[i - 1]);
    const a = edge.path[i - 1];
    const b = edge.path[i];
    out.x = lerp(a.x, b.x, t);
    out.y = lerp(a.y, b.y, t);
    out.z = lerp(a.z, b.z, t);
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    out.dx = forward ? dx : -dx;
    out.dz = forward ? dz : -dz;
    return out;
  }

  drivableEdges() {
    if (!this._drivable) {
      this._drivable = this.edges.filter((e) => e.length > 26);
    }
    return this._drivable;
  }
}
