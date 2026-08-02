import * as THREE from 'three';

/**
 * The car you are sitting in, coming apart.
 *
 * Everything else in the city breaks the cheap way: its vertices are
 * collapsed onto a point, it stops existing, and the same shape is handed to
 * the rigid-body pool as loose pieces. The player's car cannot do that,
 * because it has to go on being a car while it is being wrecked. So it takes
 * damage the other way round — the panels themselves are pushed in where they
 * were hit, one dent at a time, and only when the shell has taken everything
 * it can does the whole thing let go.
 *
 * The one rule the deformation must never break is that the body stays
 * watertight. That is why a vertex's displacement is a pure function of where
 * it started: two vertices sitting on top of each other at a panel seam are
 * given exactly the same push, so no gap can ever open between them. Weighting
 * the push by each vertex's own normal would look slightly better on a single
 * panel and would tear the car open along every hard edge it has.
 */

/** How far around the contact point a dent reaches, before severity scales it. */
const DENT_R = 1.15;
/** No vertex is ever pushed further in than this, however many hits it takes. */
const DENT_MAX = 0.40;
/** Position quantisation used to weld coincident vertices, per metre. */
const WELD = 1000;
/** How big a fold in the metal is. */
const FOLD = 0.34;

/** One lattice value, the same every time it is asked for. */
function lattice(ix, iy, iz, seed) {
  const s = Math.sin(ix * 127.1 + iy * 311.7 + iz * 74.7 + seed * 113.5) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * Smooth value noise, sampled from where the vertex started.
 *
 * Crumpled metal folds; it does not shatter. Hashing each vertex on its own
 * gives every one an independent kick and turns a bonnet into a heap of
 * splinters, so the noise is taken off a lattice a third of a metre across and
 * interpolated — neighbours share their folds and the panel creases instead.
 * It stays a pure function of the starting position, which is what keeps the
 * two halves of a seam moving as one.
 */
function fold(x, y, z, seed) {
  const fx = x / FOLD;
  const fy = y / FOLD;
  const fz = z / FOLD;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  let tx = fx - ix;
  let ty = fy - iy;
  let tz = fz - iz;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  tz = tz * tz * (3 - 2 * tz);

  const c000 = lattice(ix, iy, iz, seed);
  const c100 = lattice(ix + 1, iy, iz, seed);
  const c010 = lattice(ix, iy + 1, iz, seed);
  const c110 = lattice(ix + 1, iy + 1, iz, seed);
  const c001 = lattice(ix, iy, iz + 1, seed);
  const c101 = lattice(ix + 1, iy, iz + 1, seed);
  const c011 = lattice(ix, iy + 1, iz + 1, seed);
  const c111 = lattice(ix + 1, iy + 1, iz + 1, seed);

  const x00 = c000 + (c100 - c000) * tx;
  const x10 = c010 + (c110 - c010) * tx;
  const x01 = c001 + (c101 - c001) * tx;
  const x11 = c011 + (c111 - c011) * tx;
  const y0 = x00 + (x10 - x00) * ty;
  const y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}

/**
 * Groups vertices that sit in the same place *and* face roughly the same way.
 *
 * Position alone would weld the two sides of every hard edge together and
 * shade the whole car like a balloon; splitting on the normal as well keeps a
 * grille slat sharp while a door skin stays smooth.
 */
function weldGroups(base, baseN, count) {
  const byPos = new Map();
  const of = new Int32Array(count);
  const members = [];

  for (let i = 0; i < count; i++) {
    const key = `${Math.round(base[i * 3] * WELD)}|${Math.round(base[i * 3 + 1] * WELD)}|` +
      `${Math.round(base[i * 3 + 2] * WELD)}`;
    let here = byPos.get(key);
    if (!here) byPos.set(key, (here = []));

    let g = -1;
    if (baseN) {
      const nx = baseN[i * 3];
      const ny = baseN[i * 3 + 1];
      const nz = baseN[i * 3 + 2];
      for (const cand of here) {
        const r = members[cand][0];
        if (baseN[r * 3] * nx + baseN[r * 3 + 1] * ny + baseN[r * 3 + 2] * nz > 0.55) {
          g = cand;
          break;
        }
      }
    } else if (here.length) {
      g = here[0];
    }
    if (g < 0) {
      g = members.length;
      members.push([]);
      here.push(g);
    }
    members[g].push(i);
    of[i] = g;
  }
  return { of, members, count: members.length };
}

/** Panels that can be pushed in, on one built car. */
export class BodyDamage {
  /** @param {{bodyRoot: THREE.Object3D}} car the result of `createPlayerCar` */
  constructor(car) {
    this.car = car;
    this.panels = [];
    this.bounds = new THREE.Box3();

    car.bodyRoot.traverse((o) => {
      const geo = o.isMesh ? o.geometry : null;
      const pos = geo?.attributes?.position;
      if (!pos || !pos.array?.length) return;
      this.panels.push({
        geo,
        pos,
        nrm: geo.attributes.normal ?? null,
        base: Float32Array.from(pos.array),
        baseN: geo.attributes.normal ? Float32Array.from(geo.attributes.normal.array) : null,
        moved: new Float32Array(pos.count),
        groups: null,
        touched: null,
        acc: null,
        done: null
      });
      geo.computeBoundingBox();
      if (geo.boundingBox) this.bounds.union(geo.boundingBox);
    });

    const empty = this.bounds.isEmpty();
    this.midY = empty ? 0.7 : this.bounds.min.y +
      (this.bounds.max.y - this.bounds.min.y) * 0.45;
    this.dents = 0;
  }

  /**
   * Pushes one dent into the shell.
   *
   * @param {{x:number, z:number, y?:number, dx:number, dz:number, mag:number}} d
   *   contact point and direction of the blow in the car's own frame, with
   *   `mag` the closing speed in m/s
   */
  dent(d) {
    // A parking scrape leaves nothing; it takes a proper shunt to mark a panel
    const strength = Math.min(1, Math.max(0, (d.mag - 3) / 26));
    if (strength <= 0.02) return false;

    const depth = 0.08 + strength * 0.34;
    const radius = DENT_R * (0.62 + strength * 0.7);
    const cx = d.x;
    const cy = d.y ?? this.midY;
    const cz = d.z;
    let nx = d.dx;
    let nz = d.dz;
    const nl = Math.hypot(nx, nz);
    if (nl < 1e-4) return false;
    nx /= nl;
    nz /= nl;

    // pushing in also drags the panel down a little, the way a crease does
    const ny = -0.18;
    let any = false;

    for (const p of this.panels) {
      const base = p.base;
      const arr = p.pos.array;
      const count = p.pos.count;
      const touched = p.touched || (p.touched = new Uint8Array(count));
      touched.fill(0);
      let hit = false;

      for (let i = 0; i < count; i++) {
        const bx = base[i * 3];
        const by = base[i * 3 + 1];
        const bz = base[i * 3 + 2];
        const ddx = bx - cx;
        const ddy = by - cy;
        const ddz = bz - cz;
        // a dent spreads further along the panel than it does up and down it
        const dist = Math.sqrt(ddx * ddx + ddy * ddy * 1.55 + ddz * ddz);
        if (dist >= radius) continue;

        let t = 1 - dist / radius;
        t = t * t * (3 - 2 * t);
        // Vertices further into the car than the contact point give way less,
        // so the near skin crumples and the far one keeps the shape.
        const along = ddx * nx + ddz * nz;
        const deep = along > 0 ? Math.max(0, 1 - along / (radius * 0.85)) : 1;
        const w = t * (0.16 + 0.84 * deep);
        if (w <= 0.002) continue;

        const room = DENT_MAX - p.moved[i];
        if (room <= 0.0008) continue;
        const push = Math.min(depth * w, room);
        p.moved[i] += push;

        // the fold runs across the panel, not straight in, so the metal
        // gathers into creases the way a wing does
        const rough = push * 0.55;
        const f1 = fold(bx, by, bz, 1) * rough;
        const f2 = fold(bx, by, bz, 2) * rough;
        arr[i * 3] += nx * push - nz * f1;
        arr[i * 3 + 1] += ny * push + f2;
        arr[i * 3 + 2] += nz * push + nx * f1;
        touched[i] = 1;
        hit = true;
      }

      if (!hit) continue;
      p.pos.needsUpdate = true;
      if (p.nrm) this._renormal(p, touched);
      any = true;
    }

    if (any) this.dents++;
    return any;
  }

  /**
   * Rebuilds the normals around a fresh dent.
   *
   * Only triangles with a moved corner are looked at, and the result is
   * averaged over each weld group, so the crease is shaded as one surface
   * rather than as a field of flat facets — and the panels nobody touched keep
   * the normals they were built with.
   */
  _renormal(p, touched) {
    const idx = p.geo.index ? p.geo.index.array : null;
    const arr = p.pos.array;
    const count = p.pos.count;
    const acc = p.acc || (p.acc = new Float32Array(count * 3));
    acc.fill(0);

    const tris = idx ? idx.length / 3 : count / 3;
    for (let t = 0; t < tris; t++) {
      const a = idx ? idx[t * 3] : t * 3;
      const b = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const c = idx ? idx[t * 3 + 2] : t * 3 + 2;
      if (!touched[a] && !touched[b] && !touched[c]) continue;

      const ax = arr[a * 3];
      const ay = arr[a * 3 + 1];
      const az = arr[a * 3 + 2];
      const e1x = arr[b * 3] - ax;
      const e1y = arr[b * 3 + 1] - ay;
      const e1z = arr[b * 3 + 2] - az;
      const e2x = arr[c * 3] - ax;
      const e2y = arr[c * 3 + 1] - ay;
      const e2z = arr[c * 3 + 2] - az;
      // left un-normalised on purpose: bigger triangles should weigh more
      const fx = e1y * e2z - e1z * e2y;
      const fy = e1z * e2x - e1x * e2z;
      const fz = e1x * e2y - e1y * e2x;

      acc[a * 3] += fx; acc[a * 3 + 1] += fy; acc[a * 3 + 2] += fz;
      acc[b * 3] += fx; acc[b * 3 + 1] += fy; acc[b * 3 + 2] += fz;
      acc[c * 3] += fx; acc[c * 3 + 1] += fy; acc[c * 3 + 2] += fz;
    }

    const groups = p.groups || (p.groups = weldGroups(p.base, p.baseN, count));
    const done = p.done || (p.done = new Uint8Array(groups.count));
    done.fill(0);
    const nrm = p.nrm.array;

    for (let i = 0; i < count; i++) {
      if (!touched[i]) continue;
      const g = groups.of[i];
      if (done[g]) continue;
      done[g] = 1;
      const mem = groups.members[g];
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let m = 0; m < mem.length; m++) {
        const v = mem[m];
        sx += acc[v * 3];
        sy += acc[v * 3 + 1];
        sz += acc[v * 3 + 2];
      }
      const len = Math.hypot(sx, sy, sz);
      if (len < 1e-9) continue;
      sx /= len; sy /= len; sz /= len;
      for (let m = 0; m < mem.length; m++) {
        const v = mem[m];
        nrm[v * 3] = sx;
        nrm[v * 3 + 1] = sy;
        nrm[v * 3 + 2] = sz;
      }
    }
    p.nrm.needsUpdate = true;
  }

  /** Straightens everything out again. */
  repair() {
    for (const p of this.panels) {
      p.pos.array.set(p.base);
      p.pos.needsUpdate = true;
      if (p.nrm && p.baseN) {
        p.nrm.array.set(p.baseN);
        p.nrm.needsUpdate = true;
      }
      p.moved.fill(0);
      p.geo.computeBoundingSphere();
    }
    this.dents = 0;
  }
}

/**
 * The car letting go: the shell, the glass and the wheels handed to the
 * rigid-body solver as separate pieces, thrown out from where it was standing
 * and still carrying whatever speed it had.
 */
export function scatterWreck(rigid, spec, colour, pos, yaw, velocity) {
  if (!rigid) return 0;
  const hw = spec.width * 0.5;
  const hl = spec.length * 0.5;
  const ride = spec.rideHeight ?? 0.32;
  const body = spec.bodyHeight ?? 0.72;
  const mass = spec.mass ?? 1400;
  const vx = velocity?.x ?? 0;
  const vz = velocity?.z ?? 0;
  const dark = 0x14161a;
  const glass = 0x2b3a48;

  const pieces = [
    // floor pan — the heavy bit, it barely leaves the ground
    { dx: 0, dy: ride + 0.16, dz: 0, hx: hw * 0.86, hy: 0.16, hz: hl * 0.78,
      m: mass * 0.34, c: colour, up: 1.4, out: 0.5 },
    // roof and cabin sides
    { dx: 0, dy: ride + body + 0.42, dz: -hl * 0.12, hx: hw * 0.74, hy: 0.10, hz: hl * 0.34,
      m: mass * 0.07, c: colour, up: 5.2, out: 2.0 },
    { dx: -hw * 0.78, dy: ride + body + 0.18, dz: -hl * 0.1, hx: 0.07, hy: 0.3, hz: hl * 0.3,
      m: mass * 0.04, c: colour, up: 4.4, out: 3.0 },
    { dx: hw * 0.78, dy: ride + body + 0.18, dz: -hl * 0.1, hx: 0.07, hy: 0.3, hz: hl * 0.3,
      m: mass * 0.04, c: colour, up: 4.4, out: 3.0 },
    // bonnet and boot lid
    { dx: 0, dy: ride + body * 0.9, dz: hl * 0.52, hx: hw * 0.8, hy: 0.06, hz: hl * 0.22,
      m: mass * 0.05, c: colour, up: 5.8, out: 2.6 },
    { dx: 0, dy: ride + body * 0.9, dz: -hl * 0.62, hx: hw * 0.78, hy: 0.06, hz: hl * 0.18,
      m: mass * 0.045, c: colour, up: 5.2, out: 2.4 },
    // doors
    { dx: -hw, dy: ride + body * 0.5, dz: 0, hx: 0.08, hy: 0.36, hz: hl * 0.28,
      m: mass * 0.05, c: colour, up: 4.0, out: 4.2 },
    { dx: hw, dy: ride + body * 0.5, dz: 0, hx: 0.08, hy: 0.36, hz: hl * 0.28,
      m: mass * 0.05, c: colour, up: 4.0, out: 4.2 },
    // bumpers
    { dx: 0, dy: ride + 0.24, dz: hl * 0.96, hx: hw * 0.9, hy: 0.16, hz: 0.12,
      m: mass * 0.03, c: dark, up: 6.4, out: 3.4 },
    { dx: 0, dy: ride + 0.24, dz: -hl * 0.96, hx: hw * 0.9, hy: 0.16, hz: 0.12,
      m: mass * 0.03, c: dark, up: 5.6, out: 3.2 },
    // engine block, straight up and straight back down
    { dx: 0, dy: ride + 0.3, dz: hl * 0.5, hx: 0.32, hy: 0.28, hz: 0.34,
      m: mass * 0.12, c: 0x33383e, up: 7.2, out: 1.2 },
    // windscreen and backlight, in pieces
    { dx: -0.3, dy: ride + body + 0.3, dz: hl * 0.2, hx: 0.26, hy: 0.02, hz: 0.3,
      m: 18, c: glass, up: 6.0, out: 4.6 },
    { dx: 0.3, dy: ride + body + 0.3, dz: hl * 0.2, hx: 0.26, hy: 0.02, hz: 0.3,
      m: 18, c: glass, up: 6.0, out: 4.6 },
    { dx: 0, dy: ride + body + 0.28, dz: -hl * 0.42, hx: 0.34, hy: 0.02, hz: 0.28,
      m: 18, c: glass, up: 5.4, out: 4.2 }
  ];

  // wheels, which come off and roll away
  const wr = spec.wheelRadius ?? 0.34;
  const wb = (spec.wheelBase ?? spec.length * 0.6) * 0.5;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    pieces.push({
      dx: sx * hw * 0.92, dy: wr, dz: sz * wb,
      hx: (spec.wheelWidth ?? 0.24) * 0.5, hy: wr, hz: wr,
      m: 26, c: dark, up: 4.8, out: 5.0, bounce: 0.34
    });
  }

  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  for (const p of pieces) {
    // the car's own frame: +Z is forward, +X is its right
    const wx = pos.x + p.dz * sn + p.dx * cs;
    const wz = pos.z + p.dz * cs - p.dx * sn;
    const ox = wx - pos.x;
    const oz = wz - pos.z;
    const ol = Math.hypot(ox, oz) || 1;
    rigid.spawn({
      x: wx,
      y: pos.y + p.dy,
      z: wz,
      hx: p.hx, hy: p.hy, hz: p.hz,
      yaw,
      colour: p.c,
      mass: p.m,
      restitution: p.bounce ?? 0.14,
      friction: 0.72,
      // enough to throw it apart, not so much that the wreck ends up in the
      // next street: what lands should still read as one car
      vx: vx * 0.5 + (ox / ol) * p.out * 0.62 + (Math.random() - 0.5) * 1.6,
      vy: p.up * (0.7 + Math.random() * 0.6),
      vz: vz * 0.5 + (oz / ol) * p.out * 0.62 + (Math.random() - 0.5) * 1.6,
      sx: (Math.random() - 0.5) * 7,
      sy: (Math.random() - 0.5) * 7,
      sz: (Math.random() - 0.5) * 7
    });
  }
  return pieces.length;
}
