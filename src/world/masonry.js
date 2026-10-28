import * as THREE from 'three';
import { QUALITY } from '../quality.js';

/**
 * Brick walls, where a car meets one.
 *
 * A city of twelve thousand apartment blocks cannot be drawn brick by brick:
 * the reachable band alone would be some forty million of them. So a wall is
 * a facade until it is struck, and only then does the stretch around the
 * impact turn into what an Ankara apartment wall actually is under the
 * plaster — courses of red hollow brick laid in running bond. The facade
 * cells behind it are collapsed out of their merged mesh and an exact brick
 * replica takes their place, so the swap cannot be seen.
 *
 * From then on the wall behaves like masonry:
 *
 *  - whatever the bumper reaches is knocked out brick by brick, with a ragged
 *    edge rather than a clean rectangle, and thrown into the building at the
 *    speed of the car;
 *  - every course above is then checked for support. A brick can sit on the
 *    one below it, or be held by its neighbours for about one brick's length
 *    out over a gap — no further. That is all it takes for the wall above a
 *    hole to come down in a stepped, corbelled arch, the shape a real brick
 *    wall leaves when its middle is punched out;
 *  - the bricks round the edge that did stay are knocked a few centimetres
 *    out of true, which is what reads as a cracked wall rather than a cut one.
 *
 * Everything that comes loose goes to its own rigid-body pool, so a wall
 * coming down cannot evict the wreck of a car from the shared one.
 */

/** Course height and nominal brick length, mortar included. */
const COURSE = 0.21;
const BRICK = 0.42;
/** Wall thickness: one hollow brick laid flat. */
const THICK = 0.24;
/** Mortar joint, left as a gap. */
const JOINT = 0.022;

const BRICK_COLOURS = [0xb4532f, 0xa8472a, 0xbf5f37, 0x9e4428, 0xc46a40, 0xad5032, 0x93412a];

export class Masonry {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./rigid.js').RigidWorld} rubble where loose bricks go
   */
  constructor(scene, rubble) {
    this.scene = scene;
    this.rubble = rubble;
    this.capacity = QUALITY.tier === 'mobile' ? 7000 : 26000;
    /** Set by Breakables: takes one facade cell out of its merged mesh. */
    this.hideCell = null;

    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(geo, this.material, this.capacity);
    this.mesh.name = 'masonry';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // the bricks are scattered over however many buildings have been hit,
    // so one bounding sphere for all of them would be the whole city anyway
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    this.used = 0;
    this.free = [];
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  /** Room left for new bricks. */
  get room() {
    return this.capacity - this.used + this.free.length;
  }

  /**
   * Knocks a hole in a wall.
   *
   * @param {object} item the building
   * @param {object} wall one of its wall records
   * @param {number} u where along the wall it was hit, in metres
   * @param {object} blow `vx,vz,speed`
   * @param {{rx:number, ry:number, yc:number}} shape half-width and
   *   half-height of what the car takes out, and the height of its centre
   * @returns {{removed:number, from:number, to:number}|null} null when the
   *   wall could not be turned to brick (out of room), so the caller can
   *   fall back to the plain hole
   */
  strike(item, wall, u, blow, shape) {
    const st = this._state(item, wall);
    const reach = shape.rx + 1.3;
    const c0 = Math.max(0, Math.floor((u - reach) / st.cw));
    const c1 = Math.min(st.cols - 1, Math.floor((u + reach) / st.cw));

    let need = 0;
    for (let c = c0; c <= c1; c++) if (!st.colOn[c]) need += st.perCol;
    if (need > this.room) return null;
    for (let c = c0; c <= c1; c++) if (!st.colOn[c]) this._raise(item, wall, st, c);

    const falling = [];
    const minU = c0 * st.cw;
    const maxU = (c1 + 1) * st.cw;

    // ---- what the car itself takes out ---------------------------------
    for (let r = 0; r < st.rows; r++) {
      const y = (r + 0.5) * st.rowH;
      for (const b of st.byRow[r]) {
        if (!b.alive || b.u < minU || b.u > maxU) continue;
        const dx = (b.u - u) / shape.rx;
        const dy = (y - shape.yc) / shape.ry;
        const d = dx * dx + dy * dy;
        // a ragged edge: each brick's own bit of luck decides the borderline
        if (d < 1 + (b.luck - 0.5) * 0.45) {
          b.alive = false;
          falling.push({ b, y, hit: Math.max(0, 1 - Math.sqrt(d)) });
        }
      }
    }
    if (!falling.length) return { removed: 0, from: c0, to: c1 };

    // ---- and what comes down because of it -----------------------------
    for (let r = 0; r < st.rows; r++) {
      const row = st.byRow[r];
      const n = row.length;
      if (!n) continue;
      const sup = new Array(n);
      for (let i = 0; i < n; i++) {
        const b = row[i];
        if (!b.alive) continue;
        const h = b.len * 0.32;
        sup[i] = this._solid(st, r - 1, b.u - h) || this._solid(st, r - 1, b.u + h) ||
          this._solid(st, r - 1, b.u);
      }
      // distance, in bricks, from the nearest thing holding this one up
      const dl = new Array(n).fill(Infinity);
      const dr = new Array(n).fill(Infinity);
      for (let i = 0; i < n; i++) {
        const b = row[i];
        if (!b.alive) continue;
        if (sup[i]) { dl[i] = 0; continue; }
        const prev = row[i - 1];
        if (prev && Math.abs(prev.u + prev.len / 2 - (b.u - b.len / 2)) < 0.01) {
          if (prev.alive) dl[i] = dl[i - 1] + 1;
        } else if (this._solid(st, r, b.u - b.len / 2 - 0.05)) {
          dl[i] = 1;
        }
      }
      for (let i = n - 1; i >= 0; i--) {
        const b = row[i];
        if (!b.alive) continue;
        if (sup[i]) { dr[i] = 0; continue; }
        const next = row[i + 1];
        if (next && Math.abs(b.u + b.len / 2 - (next.u - next.len / 2)) < 0.01) {
          if (next.alive) dr[i] = dr[i + 1] + 1;
        } else if (this._solid(st, r, b.u + b.len / 2 + 0.05)) {
          dr[i] = 1;
        }
      }
      const y = (r + 0.5) * st.rowH;
      for (let i = 0; i < n; i++) {
        const b = row[i];
        if (!b.alive || sup[i]) continue;
        // mortar holds a brick out over a gap, a second one only sometimes
        const allow = b.luck > 0.78 ? 2 : 1;
        if (Math.min(dl[i], dr[i]) > allow) {
          b.alive = false;
          falling.push({ b, y, hit: 0 });
        }
      }
    }

    for (const f of falling) this._release(f.b);

    // ---- the ones that stayed, knocked out of true ---------------------
    for (let r = 0; r < st.rows; r++) {
      const y = (r + 0.5) * st.rowH;
      for (const b of st.byRow[r]) {
        if (!b.alive || b.u < minU || b.u > maxU) continue;
        const dx = (b.u - u) / (shape.rx + 0.9);
        const dy = (y - shape.yc) / (shape.ry + 1.1);
        const d = dx * dx + dy * dy;
        if (d >= 1) continue;
        const k = (1 - d) * (0.5 + b.luck);
        b.shove = (b.shove || 0) + k * 0.035;
        b.twist = (b.twist || 0) + (b.luck - 0.5) * k * 0.16;
        this._place(item, wall, st, b, r);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    this._throw(item, wall, st, falling, blow);
    return { removed: falling.length, from: c0, to: c1 };
  }

  /** The brick layout of one wall, made the first time it is struck. */
  _state(item, wall) {
    if (wall.masonry) return wall.masonry;
    const span = wall.face < 2 ? wall.hw * 2 : wall.hd * 2;
    const cols = wall.cols;
    const cw = span / cols;
    const rows = Math.max(2, Math.round(wall.bandH / COURSE));
    const perBrick = Math.max(2, Math.round(cw / BRICK));
    wall.masonry = {
      span, cols, cw, rows,
      rowH: wall.bandH / rows,
      perBrick,
      perCol: rows * (perBrick + 1),
      colOn: new Uint8Array(cols),
      byRow: Array.from({ length: rows }, () => [])
    };
    return wall.masonry;
  }

  /** Lays one column of the wall in brick and takes the facade there away. */
  _raise(item, wall, st, c) {
    st.colOn[c] = 1;
    for (let fr = 0; fr < wall.rows; fr++) {
      const n = fr * wall.cols + c;
      wall.bricked = wall.bricked || new Set();
      if (wall.bricked.has(n)) continue;
      wall.bricked.add(n);
      this.hideCell?.(wall, n, item);
    }

    const len = st.cw / st.perBrick;
    const left = c * st.cw;
    for (let r = 0; r < st.rows; r++) {
      const row = st.byRow[r];
      const add = (a, l) => {
        const b = {
          u: a + l / 2, len: l, alive: true, idx: -1,
          luck: Math.random(), colour: BRICK_COLOURS[(Math.random() * BRICK_COLOURS.length) | 0]
        };
        b.idx = this._alloc();
        this._place(item, wall, st, b, r);
        this._c.setHex(b.colour).multiplyScalar(0.9 + b.luck * 0.18);
        this.mesh.setColorAt(b.idx, this._c);
        row.push(b);
      };
      if (r % 2 === 0) {
        for (let i = 0; i < st.perBrick; i++) add(left + i * len, len);
      } else {
        // running bond: every other course starts on a half brick
        add(left, len / 2);
        for (let i = 0; i < st.perBrick - 1; i++) add(left + len / 2 + i * len, len);
        add(left + st.cw - len / 2, len / 2);
      }
      row.sort((a, b) => a.u - b.u);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** True where course `r` has something solid at `u`. */
  _solid(st, r, u) {
    if (r < 0) return true;                          // the ground
    if (u < 0.02 || u > st.span - 0.02) return true; // the building's corner
    const c = Math.floor(u / st.cw);
    if (!st.colOn[c]) return true;                   // wall still whole there
    for (const b of st.byRow[r]) {
      if (Math.abs(b.u - u) <= b.len / 2) return b.alive;
    }
    return false;
  }

  /** Where a point on the wall is in the world. */
  _world(item, wall, u, y, inward, out) {
    const hw = wall.hw;
    const hd = wall.hd;
    let lx;
    let lz;
    if (wall.face === 0) { lx = -hw + u; lz = hd - inward; }
    else if (wall.face === 1) { lx = hw - u; lz = -hd + inward; }
    else if (wall.face === 2) { lx = hw - inward; lz = hd - u; }
    else { lx = -hw + inward; lz = -hd + u; }
    const yaw = item.rot ?? 0;
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    return out.set(
      item.x + lx * cs + lz * sn,
      item.y + (wall.baseY ?? 0) + y,
      item.z - lx * sn + lz * cs
    );
  }

  _place(item, wall, st, b, r) {
    const y = (r + 0.5) * st.rowH;
    // proud of the facade by a hair, pushed further out where it was shaken
    this._world(item, wall, b.u, y, THICK / 2 - 0.012 - (b.shove || 0), this._p);
    this._e.set((b.luck - 0.5) * (b.shove || 0) * 1.5, (item.rot ?? 0) + (wall.face < 2 ? 0 : Math.PI / 2) + (b.twist || 0), 0);
    this._q.setFromEuler(this._e);
    this._s.set(Math.max(0.02, b.len - JOINT), st.rowH - JOINT, THICK);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(b.idx, this._m);
  }

  _alloc() {
    if (this.free.length) return this.free.pop();
    const i = this.used++;
    this.mesh.count = this.used;
    return i;
  }

  _release(b) {
    if (b.idx < 0) return;
    this.mesh.setMatrixAt(b.idx, this._zero);
    this.free.push(b.idx);
    b.idx = -1;
  }

  /** Hands the loose bricks to the rubble pool. */
  _throw(item, wall, st, falling, blow) {
    const rubble = this.rubble;
    if (!rubble) return;
    const speed = blow?.speed ?? 8;
    const vx = blow?.vx ?? 0;
    const vz = blow?.vz ?? 0;
    const vl = Math.hypot(vx, vz) || 1;
    const fx = vx / vl;
    const fz = vz / vl;

    // a hole bigger than the pool sends a sample of it: the rest is dust
    let list = falling;
    const budget = Math.floor(rubble.max * 0.9);
    if (list.length > budget) {
      list = list.slice();
      for (let i = list.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [list[i], list[j]] = [list[j], list[i]];
      }
      list.length = budget;
    }

    const yaw = (item.rot ?? 0) + (wall.face < 2 ? 0 : Math.PI / 2);
    for (const f of list) {
      const b = f.b;
      this._world(item, wall, b.u, f.y, THICK / 2, this._p);
      // straight in front of the bumper they leave at most of the car's
      // speed; off to the side, or dropping out of the wall above, barely
      const push = f.hit > 0 ? speed * (0.25 + 0.6 * f.hit) * (0.6 + Math.random() * 0.5) : 0;
      rubble.spawn({
        x: this._p.x, y: this._p.y, z: this._p.z,
        hx: b.len / 2 - JOINT / 2, hy: st.rowH / 2 - JOINT / 2, hz: THICK / 2,
        yaw,
        colour: b.colour,
        mass: 4.2 * (b.len / BRICK),
        restitution: 0.12,
        friction: 0.82,
        vx: fx * push + (Math.random() - 0.5) * (0.6 + f.hit * 3),
        vy: f.hit > 0 ? 0.4 + Math.random() * 2.6 * f.hit : -0.2,
        vz: fz * push + (Math.random() - 0.5) * (0.6 + f.hit * 3),
        sx: (Math.random() - 0.5) * (1.5 + f.hit * 12),
        sy: (Math.random() - 0.5) * (1 + f.hit * 8),
        sz: (Math.random() - 0.5) * (1.5 + f.hit * 12)
      });
    }
  }
}
