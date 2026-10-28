import * as THREE from 'three';
import { QUALITY } from '../quality.js';
import { facadePalette } from '../textures.js';
import { makeRng } from '../util/math.js';

/**
 * Apartments, modelled properly — where you can see it.
 *
 * Seen from a kilometre away an Ankara block is a box with a window grid
 * painted on it, and that is what the whole city is drawn as. Up close it is
 * not: every window has a marble sill under it and a plaster surround, the
 * floors are marked by a ledge running all the way round, the corners are
 * picked out, the way in has a canopy over the door and two steps up to it,
 * and somebody has hung an air conditioner off every few windows.
 *
 * All of that is real geometry, aligned to the painted facade underneath it
 * (one window per 3.4 m bay, one per 3 m floor), and built only for the
 * blocks around you. Each one is merged into a single geometry and lives in
 * a slot of one BatchedMesh, so the whole neighbourhood is one draw call that
 * the renderer still culls block by block. Blocks you drive away from give
 * their slot back to the ones you drive towards; a few are built per frame,
 * nearest first, inside a fixed time budget.
 *
 * Walls that have been struck are respected: nothing is hung over a stretch
 * of wall that has turned into bricks, so a sill never floats over a hole.
 */

const BAY = 3.4;
const FLOOR = 3.0;
/** Where the painted window sits in its bay and floor (see facadeTexture). */
const WIN_HALF = 1.0625;
const WIN_BOTTOM = 0.75;
const WIN_TOP = 2.53;

const SILL = 0xdcd8d0;
const CANOPY = 0xa8a49c;
const DOOR = 0x4a3020;
const STEP = 0x9a958c;
const AC = 0xe9e9e5;

export class ApartmentDetail {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./breakables.js').Breakables} breakables the buildings,
   *   with the spatial lookup they already have
   */
  constructor(scene, breakables) {
    this.breakables = breakables;
    this.radius = QUALITY.detailRadius ?? 0;
    this.slots = QUALITY.detailSlots ?? 0;
    this.enabled = this.radius > 0 && this.slots > 0;
    this.active = new Map();     // item -> { geoId, instId, reserved }
    this.spare = [];             // released slots: { geoId, instId, reserved:{v,i} }
    this.dirty = new Set();
    this._t = 0;
    this._last = { x: Infinity, z: Infinity };
    this._queue = [];
    this._near = [];
    if (!this.enabled) return;

    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
    this.maxV = this.slots * 6500;
    this.maxI = this.slots * 9800;
    this.mesh = new THREE.BatchedMesh(this.slots, this.maxV, this.maxI, this.material);
    this.mesh.name = 'apartment-detail';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.perObjectFrustumCulled = true;
    this.mesh.sortObjects = false;
    scene.add(this.mesh);
    this._id = new THREE.Matrix4();
  }

  /** Rebuild a block next time round — a wall of it has changed. */
  invalidate(item) {
    if (this.active.has(item)) this.dirty.add(item);
  }

  update(x, z, dt) {
    if (!this.enabled) return;
    this._t += dt;
    const moved = Math.hypot(x - this._last.x, z - this._last.z);
    if (moved > 12 || this._t > 0.6) {
      this._t = 0;
      this._last.x = x;
      this._last.z = z;
      this._refresh(x, z);
    }
    for (const item of this.dirty) {
      this._release(item);
      this._queue.unshift(item);
    }
    this.dirty.clear();

    // build the nearest few, inside a couple of milliseconds
    const t0 = performance.now();
    while (this._queue.length && performance.now() - t0 < 1.6) {
      const item = this._queue.shift();
      if (this.active.has(item)) continue;
      if (Math.hypot(item.x - x, item.z - z) > this.radius * 1.1) continue;
      if (!this._build(item)) break;
    }
  }

  _refresh(x, z) {
    const r = this.radius;
    const near = this.breakables.near(x, z, r, this._near, true).filter((it) => it.detail);
    near.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    const keep = new Set(near.slice(0, this.slots));
    for (const item of [...this.active.keys()]) {
      if (!keep.has(item) && Math.hypot(item.x - x, item.z - z) > r * 1.08) this._release(item);
    }
    // anything still over budget goes, farthest first
    if (this.active.size > this.slots) {
      const list = [...this.active.keys()].sort((a, b) =>
        Math.hypot(b.x - x, b.z - z) - Math.hypot(a.x - x, a.z - z));
      for (const item of list.slice(0, this.active.size - this.slots)) this._release(item);
    }
    this._queue = [...keep].filter((it) => !this.active.has(it));
  }

  _release(item) {
    if (!this.active.has(item)) return;
    const slot = this.active.get(item);
    this.active.delete(item);
    if (!slot) return;
    this.mesh.setVisibleAt(slot.instId, false);
    this.spare.push(slot);
  }

  /** @returns {boolean} false when there is no room left this frame */
  _build(item) {
    const geo = buildBlock(item);
    if (!geo) {
      this.active.set(item, null);
      return true;
    }
    const v = geo.attributes.position.count;
    const i = geo.index.count;
    // best-fitting released slot first
    let best = -1;
    for (let k = 0; k < this.spare.length; k++) {
      const s = this.spare[k];
      if (s.v >= v && s.i >= i && (best < 0 || s.v < this.spare[best].v)) best = k;
    }
    let slot;
    if (best >= 0) {
      slot = this.spare.splice(best, 1)[0];
      this.mesh.setGeometryAt(slot.geoId, geo);
      this.mesh.setVisibleAt(slot.instId, true);
    } else {
      const rv = Math.ceil(v / 1024) * 1024;
      const ri = Math.ceil(i / 1536) * 1536;
      if (!this._fits(rv, ri)) {
        geo.dispose();
        return false;
      }
      const geoId = this.mesh.addGeometry(geo, rv, ri);
      const instId = this.mesh.addInstance(geoId);
      this.mesh.setMatrixAt(instId, this._id);
      slot = { geoId, instId, v: rv, i: ri };
    }
    this.active.set(item, slot);
    geo.dispose();
    return true;
  }

  /**
   * Room for a new slot of this size. When the buffers are full of slots
   * nobody is using, those are dropped and the batch compacted — rarely, as
   * spare slots are normally re-used before it comes to that.
   */
  _fits(rv, ri) {
    const m = this.mesh;
    const usedV = m._nextVertexStart ?? 0;
    const usedI = m._nextIndexStart ?? 0;
    const count = this.active.size + this.spare.length;
    if (usedV + rv <= this.maxV && usedI + ri <= this.maxI && count < this.slots) return true;
    if (!this.spare.length) return false;
    for (const s of this.spare) {
      m.deleteInstance(s.instId);
      m.deleteGeometry(s.geoId);
    }
    this.spare.length = 0;
    m.optimize();
    return (m._nextVertexStart ?? 0) + rv <= this.maxV && (m._nextIndexStart ?? 0) + ri <= this.maxI &&
      this.active.size < this.slots;
  }
}

// ------------------------------------------------------------------ builder

/**
 * Scratch the builder writes straight into, grown on demand and reused for
 * every block. Building a block is on the frame's clock, so it allocates
 * nothing per vertex: no arrays per corner, no spreads, no pushes.
 */
let CAP = 0;
let P = null;
let NR = null;
let CO = null;
let IX = null;
function reserve(verts) {
  if (verts <= CAP) return;
  CAP = Math.max(verts, CAP * 2, 16384);
  const p = new Float32Array(CAP * 3); if (P) p.set(P); P = p;
  const n = new Int8Array(CAP * 3); if (NR) n.set(NR); NR = n;
  const c = new Uint8Array(CAP * 3); if (CO) c.set(CO); CO = c;
  const i = new Uint32Array(CAP * 1.5); if (IX) i.set(IX); IX = i;
}

const _c = new THREE.Color();
const _rgb = new Map();
/** Linear 0..255 bytes of an sRGB hex, cached. */
function bytes(hex) {
  let b = _rgb.get(hex);
  if (!b) {
    _c.setHex(hex);
    b = [Math.round(_c.r * 255), Math.round(_c.g * 255), Math.round(_c.b * 255)];
    _rgb.set(hex, b);
  }
  return b;
}

/** Builds one block's detail as world-space geometry. */
export function buildBlock(item) {
  const d = item.detail;
  if (!d) return null;
  const pal = facadePalette(d.key);
  const trim = new THREE.Color(pal.trim).lerp(new THREE.Color(0xffffff), 0.12).getHex();
  const wall = new THREE.Color(pal.wall).multiplyScalar(0.93).getHex();
  const rng = makeRng(9001 + (item.id ?? 0) * 17);

  let nv = 0;
  let ni = 0;
  reserve(4096);
  const cs = Math.cos(item.rot ?? 0);
  const sn = Math.sin(item.rot ?? 0);
  const ox = item.x;
  const oy = item.y;
  const oz = item.z;
  const hw = d.hw;
  const hd = d.hd;

  // Per face: where u=0,o=0 sits in local x/z, and which way u and o run.
  // Local point = base + u*along + o*out; world = rotate(local) + origin.
  const FB = [[-hw, hd], [hw, -hd], [hw, hd], [-hw, -hd]];
  const FA = [[1, 0], [-1, 0], [0, -1], [0, 1]];
  const FO = [[0, 1], [0, -1], [1, 0], [-1, 0]];

  let f = 0;
  let bx = 0; let bz = 0; let ax = 0; let az = 0; let qx = 0; let qz = 0;
  // world-space along/out/up of the current face
  let wax = 0; let waz = 0; let wox = 0; let woz = 0;
  const setFace = (k) => {
    f = k;
    bx = FB[k][0]; bz = FB[k][1];
    ax = FA[k][0]; az = FA[k][1];
    qx = FO[k][0]; qz = FO[k][1];
    wax = ax * cs + az * sn; waz = -ax * sn + az * cs;
    wox = qx * cs + qz * sn; woz = -qx * sn + qz * cs;
  };

  const vert = (u, y, o, nx, ny, nz, rgb) => {
    const lx = bx + u * ax + o * qx;
    const lz = bz + u * az + o * qz;
    const k = nv * 3;
    P[k] = ox + lx * cs + lz * sn;
    P[k + 1] = oy + y;
    P[k + 2] = oz - lx * sn + lz * cs;
    NR[k] = nx; NR[k + 1] = ny; NR[k + 2] = nz;
    CO[k] = rgb[0]; CO[k + 1] = rgb[1]; CO[k + 2] = rgb[2];
    nv++;
  };
  /** Indices for the last four vertices, wound to face `flip` ? back : front. */
  const tri = (flip) => {
    const b = nv - 4;
    if (!flip) { IX[ni++] = b; IX[ni++] = b + 1; IX[ni++] = b + 2; IX[ni++] = b; IX[ni++] = b + 2; IX[ni++] = b + 3; }
    else { IX[ni++] = b; IX[ni++] = b + 2; IX[ni++] = b + 1; IX[ni++] = b; IX[ni++] = b + 3; IX[ni++] = b + 2; }
  };

  /**
   * A block standing proud of the current face. `sides` picks which of its
   * faces are drawn: f(ront) t(op) b(ottom) l(eft end) r(ight end).
   *
   * Winding comes from (along × up) · out, worked out once per face rather
   * than per quad.
   */
  const block = (u0, u1, y0, y1, o0, o1, colour, sides = 'ftblr') => {
    reserve(nv + 20);
    const rgb = bytes(colour);
    // (along × up) · out: which way round the corners go for each face
    const front = wax * woz - waz * wox;
    const nfx = Math.round(wox * 127); const nfz = Math.round(woz * 127);
    const nax = Math.round(wax * 127); const naz = Math.round(waz * 127);
    if (sides.includes('f')) {
      vert(u0, y0, o1, nfx, 0, nfz, rgb); vert(u1, y0, o1, nfx, 0, nfz, rgb);
      vert(u1, y1, o1, nfx, 0, nfz, rgb); vert(u0, y1, o1, nfx, 0, nfz, rgb);
      tri(front < 0);
    }
    if (sides.includes('t')) {
      vert(u0, y1, o0, 0, 127, 0, rgb); vert(u1, y1, o0, 0, 127, 0, rgb);
      vert(u1, y1, o1, 0, 127, 0, rgb); vert(u0, y1, o1, 0, 127, 0, rgb);
      tri(front > 0);
    }
    if (sides.includes('b')) {
      vert(u0, y0, o0, 0, -127, 0, rgb); vert(u1, y0, o0, 0, -127, 0, rgb);
      vert(u1, y0, o1, 0, -127, 0, rgb); vert(u0, y0, o1, 0, -127, 0, rgb);
      tri(front < 0);
    }
    if (sides.includes('l')) {
      vert(u0, y0, o0, -nax, 0, -naz, rgb); vert(u0, y0, o1, -nax, 0, -naz, rgb);
      vert(u0, y1, o1, -nax, 0, -naz, rgb); vert(u0, y1, o0, -nax, 0, -naz, rgb);
      tri(front < 0);
    }
    if (sides.includes('r')) {
      vert(u1, y0, o0, nax, 0, naz, rgb); vert(u1, y0, o1, nax, 0, naz, rgb);
      vert(u1, y1, o1, nax, 0, naz, rgb); vert(u1, y1, o0, nax, 0, naz, rgb);
      tri(front > 0);
    }
  };

  for (let face = 0; face < 4; face++) {
    setFace(face);
    const span = f < 2 ? hw * 2 : hd * 2;

    // Stretches of this wall that are brick now, and how high that goes.
    const struck = item.walls?.find((w) => w.face === f);
    const holes = [];
    let bandTop = -1;
    if (struck?.masonry) {
      const m = struck.masonry;
      bandTop = (struck.baseY ?? 0) + struck.bandH;
      // the band wall can be a little wider than the body (shops): shift
      const shift = (m.span - span) / 2;
      for (let c = 0; c < m.cols; c++) {
        if (m.colOn[c]) holes.push([c * m.cw - shift - 0.15, (c + 1) * m.cw - shift + 0.15]);
      }
    }
    const blocked = (u0, u1, y0) =>
      y0 < bandTop && holes.some(([a, b]) => u1 > a && u0 < b);
    /** The parts of [u0,u1] clear of the holes, for things that run along a wall. */
    const clear = (u0, u1, y0) => {
      if (!(y0 < bandTop) || !holes.length) return [[u0, u1]];
      let parts = [[u0, u1]];
      for (const [a, b] of holes) {
        const next = [];
        for (const [p, q] of parts) {
          if (b <= p || a >= q) { next.push([p, q]); continue; }
          if (a > p) next.push([p, a]);
          if (b < q) next.push([b, q]);
        }
        parts = next;
      }
      return parts.filter(([p, q]) => q - p > 0.2);
    };

    // ---- corner pilasters ---------------------------------------------
    const pil = 0.34;
    for (const [p0, p1, end] of [[-0.05, pil, 'r'], [span - pil, span + 0.05, 'l']]) {
      let y0 = d.baseY;
      if (blocked(p0, p1, y0)) y0 = bandTop;
      if (d.top - y0 > 0.5) block(p0, p1, y0, d.top, 0, 0.05, wall, 'f' + end);
    }

    // ---- floor ledges and the cornice -----------------------------------
    const firstLedge = d.shops ? 1 : 1;
    for (let k = firstLedge; k < d.floors; k++) {
      const y = d.baseY + k * FLOOR;
      if (y > d.top - 0.5) break;
      for (const [p, q] of clear(-0.07, span + 0.07, y)) {
        block(p, q, y - 0.02, y + 0.3, 0, 0.075, trim, 'ftb' + (p > -0.07 ? 'l' : '') + (q < span + 0.07 ? 'r' : ''));
      }
    }
    if (!d.house) block(-0.1, span + 0.1, d.top - 0.38, d.top, 0, 0.12, trim, 'fb');

    // ---- windows --------------------------------------------------------
    const bays = Math.floor((span + 0.01) / BAY);
    const door = !d.house && !d.shops && f === d.street ? Math.floor(bays / 2) : -1;
    const startFloor = d.shops ? 0 : 0;
    for (let k = startFloor; k < d.floors; k++) {
      const yf = d.baseY + k * FLOOR;
      const yb = yf + WIN_BOTTOM;
      const yt = yf + WIN_TOP;
      if (yt > d.top - 0.15) break;
      for (let j = 0; j < bays; j++) {
        const uc = j * BAY + BAY / 2;
        const u0 = uc - WIN_HALF - 0.13;
        const u1 = uc + WIN_HALF + 0.13;
        if (u0 < pil + 0.02 || u1 > span - pil - 0.02) continue;

        if (k === 0 && j === door) {
          // the way in: a stone surround over the painted window, a door,
          // a canopy and two steps
          if (!blocked(u0, u1, 0)) {
            block(uc - 1.25, uc + 1.25, d.baseY, d.baseY + 2.75, 0, 0.04, SILL, 'ftlr');
            block(uc - 0.78, uc + 0.78, d.baseY + 0.3, d.baseY + 2.45, 0.04, 0.07, DOOR, 'ftlr');
            block(uc - 1.5, uc + 1.5, d.baseY + 2.78, d.baseY + 2.95, 0, 1.25, CANOPY);
            block(uc - 1.1, uc + 1.1, d.baseY, d.baseY + 0.15, 0, 0.9, STEP, 'ftlr');
            block(uc - 1.1, uc + 1.1, d.baseY + 0.15, d.baseY + 0.3, 0, 0.5, STEP, 'ftlr');
          }
          continue;
        }
        if (blocked(u0, u1, yb - 0.1)) continue;

        // marble sill, proud enough to throw a shadow
        block(u0 - 0.06, u1 + 0.06, yb - 0.08, yb + 0.01, 0, 0.12, SILL, 'ftblr');
        // plaster surround: jambs and a head
        block(u0, u0 + 0.13, yb, yt, 0, 0.045, trim, 'fr');
        block(u1 - 0.13, u1, yb, yt, 0, 0.045, trim, 'fl');
        block(u0, u1, yt, yt + 0.16, 0, 0.06, trim, 'fbt');

        // somebody's air conditioner
        if (rng() < 0.09 && u1 + 0.85 < span - pil) {
          block(u1 + 0.08, u1 + 0.83, yb + 0.05, yb + 0.6, 0, 0.3, AC, 'ftblr');
        }
      }
    }
  }

  if (!nv) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P.slice(0, nv * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(NR.slice(0, nv * 3), 3, true));
  geo.setAttribute('color', new THREE.BufferAttribute(CO.slice(0, nv * 3), 3, true));
  geo.setIndex(new THREE.BufferAttribute(IX.slice(0, ni), 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
