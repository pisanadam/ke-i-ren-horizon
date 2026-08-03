import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeByTile } from './tiles.js';
import { METRO_LINES } from './mapData.js';
import { clamp, makeRng, randRange } from '../util/math.js';
import { QUALITY } from '../quality.js';

const DECK_H = 9.4;        // rail level above the ground
const DECK_W = 9.0;        // viaduct deck width
const PIER_GAP = 26;       // metres between piers
const CAR_LEN = 17.5;
const CAR_GAP = 1.2;
const CARS_PER_TRAIN = 4;
const DWELL = 6.5;         // seconds stopped at a platform
const TOP_SPEED = 22;      // m/s ≈ 80 km/h
const ACCEL = 1.15;
const BRAKE = 1.5;

function tinted(geo, colour) {
  const c = new THREE.Color(colour);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!geo.attributes.uv) {
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  return geo;
}

function box(w, h, d, x, y, z, colour, rotY = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return tinted(g, colour);
}

/**
 * Catmull-Rom through the stations, so the line sweeps between stops instead
 * of turning a hard corner at each one.
 */
function smoothPath(stations, ground) {
  const pts = stations.map((s) => new THREE.Vector3(s.x, 0, s.z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
  const total = curve.getLength();
  const n = Math.max(24, Math.round(total / 12));
  const path = [];
  for (let i = 0; i <= n; i++) {
    const p = curve.getPoint(i / n);
    path.push({ x: p.x, z: p.z, ground: ground.heightAt(p.x, p.z) });
  }

  // The deck is a smoothed version of the ground so the viaduct rides level
  // over dips instead of following every undulation.
  const raw = path.map((p) => p.ground);
  const smoothed = raw.slice();
  for (let pass = 0; pass < 26; pass++) {
    for (let i = 1; i < smoothed.length - 1; i++) {
      smoothed[i] = (smoothed[i - 1] + smoothed[i] * 1.6 + smoothed[i + 1]) / 3.6;
    }
  }
  // never dive into the hillside: the deck clears the highest ground nearby
  for (let i = 0; i < path.length; i++) {
    let hi = raw[i];
    for (let k = -3; k <= 3; k++) {
      const j = clamp(i + k, 0, path.length - 1);
      hi = Math.max(hi, raw[j]);
    }
    path[i].y = Math.max(smoothed[i] + DECK_H, hi + 6.2);
  }

  // arc length + station positions along it
  let cum = 0;
  path[0].s = 0;
  for (let i = 1; i < path.length; i++) {
    cum += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    path[i].s = cum;
  }

  const stops = stations.map((st) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < path.length; i++) {
      const d = (path[i].x - st.x) ** 2 + (path[i].z - st.z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return { name: st.name, s: path[best].s, i: best };
  });
  stops.sort((a, b) => a.s - b.s);

  return { path, length: cum, stops };
}

/** Position, height and heading at an arc length along the line. */
function sample(path, s) {
  const total = path[path.length - 1].s;
  const t = clamp(s, 0, total);
  let lo = 0;
  let hi = path.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid].s <= t) lo = mid; else hi = mid;
  }
  const a = path[lo];
  const b = path[hi];
  const span = Math.max(1e-4, b.s - a.s);
  const f = (t - a.s) / span;
  const dx = (b.x - a.x) / span;
  const dz = (b.z - a.z) / span;
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    z: a.z + (b.z - a.z) * f,
    dx, dz,
    yaw: Math.atan2(dx, dz)
  };
}

/** One metro car: body, window band, skirt and a stripe in the line colour. */
function carGeometry(colour) {
  const parts = [];
  const W = 2.9;
  const H = 3.3;
  const L = CAR_LEN;
  const body = 0xd9dde2;

  // body with the roof edges knocked off, so it is not a plain brick
  parts.push(box(W, H * 0.62, L, 0, H * 0.31, 0, body));
  parts.push(box(W * 0.86, H * 0.24, L, 0, H * 0.74, 0, body));
  parts.push(box(W * 0.62, H * 0.14, L * 0.97, 0, H * 0.93, 0, 0xb9bfc6));
  // nose taper at both ends
  parts.push(box(W * 0.82, H * 0.5, 1.1, 0, H * 0.3, L / 2 + 0.5, body));
  parts.push(box(W * 0.82, H * 0.5, 1.1, 0, H * 0.3, -L / 2 - 0.5, body));

  // window band
  parts.push(box(W + 0.04, H * 0.3, L * 0.9, 0, H * 0.56, 0, 0x1b2430));
  // doors
  for (const dz of [-L * 0.3, 0, L * 0.3]) {
    parts.push(box(W + 0.06, H * 0.46, 1.5, 0, H * 0.42, dz, 0x2b3642));
  }
  // line stripe
  parts.push(box(W + 0.08, 0.34, L * 0.96, 0, H * 0.24, 0, colour));
  // skirt and bogies
  parts.push(box(W * 0.8, 0.5, L * 0.94, 0, -0.1, 0, 0x3a4048));
  for (const dz of [-L * 0.32, L * 0.32]) {
    parts.push(box(W * 0.7, 0.55, 2.6, 0, -0.5, dz, 0x24282d));
  }

  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

/**
 * The metro. Builds a viaduct, platforms and stations for every line, then
 * runs trains along them: they accelerate away from a stop, hold line speed,
 * brake into the next platform and wait there before setting off again.
 */
export class Metro {
  constructor(ground, colliders, network) {
    this.group = new THREE.Group();
    this.group.name = 'metro';
    this.ground = ground;
    this.network = network;
    this.lines = [];
    this.trains = [];

    const rng = makeRng(31071923);
    const structure = [];
    const rails = [];
    const platforms = [];

    for (const def of METRO_LINES) {
      const geom = smoothPath(def.stations, ground);
      const line = { ...def, ...geom };
      this.lines.push(line);

      this._viaduct(line, structure, rails, colliders);
      this._stations(line, platforms, colliders);
      this._trains(line, rng);
    }

    const concrete = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.92, metalness: 0.04
    });
    /**
     * Five lines the length of the map used to be three meshes.
     *
     * Three meshes with bounding spheres nine kilometres across, which the
     * frustum test can never reject: the viaduct over Sincan was drawn while
     * you were in Keçiören, ninety-five thousand triangles of it every frame
     * wherever you stood. Tiled like the rest of the city it is culled with
     * everything else.
     */
    this.tileSets = [];
    const add = (geos, mat, name) => {
      const valid = geos.filter(Boolean);
      if (!valid.length) return;
      const set = mergeByTile(valid, mat, name);
      this.group.add(set.group);
      this.tileSets.push(set);
    };
    add(structure, concrete, 'metro-viaduct');
    add(platforms, concrete, 'metro-stations');
    add(rails, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.45, metalness: 0.7
    }), 'metro-rails');
  }

  // ------------------------------------------------------------- structure
  _viaduct(line, out, rails, colliders) {
    const { path } = line;
    const half = line.gauge / 2;

    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.2) continue;
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const my = (a.y + b.y) / 2;

      // deck slab and its edge beams
      out.push(box(DECK_W, 0.9, len + 0.15, mx, my - 0.75, mz, 0x9a9a94, yaw));
      out.push(box(0.42, 1.05, len + 0.15, mx + Math.cos(yaw) * (DECK_W / 2 - 0.2), my - 0.05,
        mz - Math.sin(yaw) * (DECK_W / 2 - 0.2), 0xa8a8a1, yaw));
      out.push(box(0.42, 1.05, len + 0.15, mx - Math.cos(yaw) * (DECK_W / 2 - 0.2), my - 0.05,
        mz + Math.sin(yaw) * (DECK_W / 2 - 0.2), 0xa8a8a1, yaw));

      // two pairs of running rails
      for (const track of [-1, 1]) {
        const ox = Math.cos(yaw) * half * track;
        const oz = -Math.sin(yaw) * half * track;
        for (const r of [-0.72, 0.72]) {
          rails.push(box(0.12, 0.16, len + 0.15,
            mx + ox + Math.cos(yaw) * r, my + 0.08, mz + oz - Math.sin(yaw) * r, 0x6b6f74, yaw));
        }
      }
    }

    // Piers down to the ground. The lines follow the boulevards, so a pier
    // dropped straight down would stand in the middle of the carriageway —
    // each one slides sideways until it is clear of the tarmac, and if there
    // is nowhere clear the deck simply spans that bay instead.
    for (let s = PIER_GAP * 0.5; s < line.length; s += PIER_GAP) {
      const p = sample(path, s);
      const spot = this._pierSpot(p);
      if (!spot) continue;

      const gy = Math.min(p.y - 2, this.ground.heightAt(spot.x, spot.z));
      const h = Math.max(1.5, p.y - 1.2 - gy);
      out.push(box(1.9, h, 1.5, spot.x, gy + h / 2, spot.z, 0x8f8f89, p.yaw));
      // cross-head reaching back under the deck
      const reach = Math.abs(spot.off);
      out.push(box(2.6 + reach, 0.72, 2.4,
        (spot.x + p.x) / 2, gy + h + 0.26, (spot.z + p.z) / 2, 0x9a9a94, p.yaw));
      colliders.add(spot.x, spot.z, 1.05, 0.9, p.yaw);
    }
  }

  /** Nearest offset from the alignment that is not on somebody's carriageway. */
  _pierSpot(p) {
    const rx = Math.cos(p.yaw);
    const rz = -Math.sin(p.yaw);
    for (const off of [0, 5, -5, 8, -8, 11, -11, 14, -14, 17, -17]) {
      const x = p.x + rx * off;
      const z = p.z + rz * off;
      const near = this.network.nearestRoad(x, z);
      if (!near || near.dist > near.halfWidth + 1.6) return { x, z, off };
    }
    return null;
  }

  _groundAt(line, s) {
    const { path } = line;
    let lo = 0;
    while (lo < path.length - 1 && path[lo + 1].s < s) lo++;
    return path[lo].ground;
  }

  _stations(line, out, colliders) {
    for (const stop of line.stops) {
      const p = sample(line.path, stop.s);
      const yaw = p.yaw;
      const L = CAR_LEN * CARS_PER_TRAIN * 0.55;

      // island platform between the two tracks, with a canopy over it
      out.push(box(line.gauge - 1.2, 0.5, L, p.x, p.y + 0.55, p.z, 0xb4b2aa, yaw));
      out.push(box(DECK_W + 3.0, 0.55, L + 3, p.x, p.y - 0.35, p.z, 0x9a9a94, yaw));

      for (const side of [-1, 1]) {
        const ox = Math.cos(yaw) * (DECK_W / 2 + 1.1) * side;
        const oz = -Math.sin(yaw) * (DECK_W / 2 + 1.1) * side;
        for (let t = -1; t <= 1; t++) {
          const cx = p.x + ox + Math.sin(yaw) * t * L * 0.4;
          const cz = p.z + oz + Math.cos(yaw) * t * L * 0.4;
          out.push(box(0.3, 4.4, 0.3, cx, p.y + 2.9, cz, 0x7f8288, yaw));
        }
      }
      out.push(box(DECK_W + 3.6, 0.34, L + 2, p.x, p.y + 5.2, p.z, 0xc9ccd0, yaw));
      // stair core down to street level, on whichever side is off the road
      const spot = this._pierSpot({ ...p, yaw }) || { off: DECK_W / 2 + 3 };
      const off = spot.off >= 0 ? spot.off + 3.2 : spot.off - 3.2;
      const sx = p.x + Math.cos(yaw) * off;
      const sz = p.z - Math.sin(yaw) * off;
      const gy = this.ground.heightAt(sx, sz);
      const sh = Math.max(2, p.y - gy - 0.6);
      out.push(box(4.2, sh, 5.0, sx, gy + sh / 2, sz, 0xa5a49c, yaw));
      colliders.add(sx, sz, 2.1, 2.5, yaw);
    }
  }

  // ----------------------------------------------------------------- trains
  _trains(line, rng) {
    const geo = carGeometry(line.colour);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.5, metalness: 0.25
    });

    const perDirection = clamp(Math.round(line.length / 1500), 1, QUALITY.metroTrains);
    for (let dir = -1; dir <= 1; dir += 2) {
      for (let k = 0; k < perDirection; k++) {
        const group = new THREE.Group();
        const cars = [];
        for (let c = 0; c < CARS_PER_TRAIN; c++) {
          const mesh = new THREE.Mesh(geo, mat);
          mesh.castShadow = true;
          group.add(mesh);
          cars.push(mesh);
        }
        this.group.add(group);

        // spread the trains out along the line so they do not run in a pack
        const spread = line.length / perDirection;
        const s = clamp(spread * (k + randRange(rng, 0.15, 0.85)), 40, line.length - 40);
        this.trains.push({
          line, cars, group, dir, s,
          speed: 0,
          dwell: randRange(rng, 0, DWELL),
          target: this._nextStop(line, s, dir)
        });
      }
    }
  }

  _nextStop(line, s, dir) {
    if (dir > 0) {
      for (const st of line.stops) if (st.s > s + 12) return st;
      return line.stops[line.stops.length - 1];
    }
    for (let i = line.stops.length - 1; i >= 0; i--) {
      if (line.stops[i].s < s - 12) return line.stops[i];
    }
    return line.stops[0];
  }

  update(dt, viewer) {
    const cull = QUALITY.metroCull;
    for (const t of this.trains) {
      // ---- run the timetable -------------------------------------------
      if (t.dwell > 0) {
        t.dwell -= dt;
        t.speed = 0;
        if (t.dwell <= 0) {
          // turn round at the end of the line
          const last = t.line.stops[t.line.stops.length - 1];
          const first = t.line.stops[0];
          if ((t.dir > 0 && t.target === last) || (t.dir < 0 && t.target === first)) {
            t.dir *= -1;
          }
          t.target = this._nextStop(t.line, t.s, t.dir);
        }
      } else {
        const toGo = (t.target.s - t.s) * t.dir;
        // brake so the train comes to rest exactly on the platform
        const stopDist = (t.speed * t.speed) / (2 * BRAKE);
        if (toGo <= stopDist) t.speed = Math.max(0, t.speed - BRAKE * dt);
        else t.speed = Math.min(TOP_SPEED, t.speed + ACCEL * dt);

        t.s += t.speed * t.dir * dt;
        if (toGo <= 0.6 || (t.speed < 0.25 && toGo < 6)) {
          t.s = t.target.s;
          t.speed = 0;
          t.dwell = DWELL;
        }
      }

      // ---- place the cars ------------------------------------------------
      const head = sample(t.line.path, t.s);
      const dx = head.x - viewer.x;
      const dz = head.z - viewer.z;
      const visible = dx * dx + dz * dz < cull * cull;
      t.group.visible = visible;
      if (!visible) continue;

      const half = t.line.gauge / 2 * t.dir;
      for (let c = 0; c < t.cars.length; c++) {
        const back = (c + 0.5) * (CAR_LEN + CAR_GAP);
        const p = sample(t.line.path, t.s - back * t.dir);
        const car = t.cars[c];
        // sit on the correct track for the direction of travel
        car.position.set(
          p.x + Math.cos(p.yaw) * half,
          p.y + 1.05,
          p.z - Math.sin(p.yaw) * half
        );
        car.rotation.y = p.yaw + (t.dir > 0 ? 0 : Math.PI);
      }
    }
  }
}
