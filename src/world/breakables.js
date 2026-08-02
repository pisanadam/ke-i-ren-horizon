import * as THREE from 'three';

/**
 * Things that come apart when you hit them.
 *
 * The street furniture is merged into a handful of big static meshes, which
 * is what keeps a city this size drawing in a few hundred calls — so a lamp
 * post is not an object that can simply be removed. What it *is* is a known
 * run of vertices inside one of those meshes. Breaking one collapses its
 * vertices onto a point (they vanish, the draw call is untouched), takes its
 * collider out of the world, and hands the same shape to the rigid-body pool
 * as loose pieces that fall, bounce and roll.
 *
 * Only the touched slice of the vertex buffer is re-uploaded, so shearing a
 * column off at 90 km/h costs a few kilobytes rather than the whole mesh.
 */

const CELL = 24;

export class Breakables {
  constructor(rigid) {
    this.rigid = rigid;
    this.items = [];
    this.cells = new Map();
    this.broken = 0;
    this.onBreak = () => {};
  }

  /**
   * @param {object} o `mesh` the merged mesh, `start`/`count` its vertex run,
   *   `x,y,z` where it stands, `box` its collider, `kind`, plus whatever
   *   shape data the pieces need.
   */
  add(o) {
    const item = { ...o, gone: false, id: this.items.length };
    this.items.push(item);
    if (item.box) {
      item.box.frail = true;
      item.box.brk = item;
    }
    const k = `${Math.floor(o.x / CELL)}:${Math.floor(o.z / CELL)}`;
    let arr = this.cells.get(k);
    if (!arr) this.cells.set(k, (arr = []));
    arr.push(item);
    return item;
  }

  /** Everything standing within `r` of a point. */
  near(x, z, r, out = []) {
    out.length = 0;
    const x0 = Math.floor((x - r) / CELL);
    const x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL);
    const z1 = Math.floor((z + r) / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        for (const it of this.cells.get(`${ix}:${iz}`) || []) {
          if (!it.gone && Math.hypot(it.x - x, it.z - z) <= r) out.push(it);
        }
      }
    }
    return out;
  }

  /**
   * Knocks one down.
   * @param {object} item from `near` or `box.brk`
   * @param {{vx:number, vz:number, speed:number}} blow what hit it
   */
  smash(item, blow) {
    if (!item || item.gone) return false;

    // A building does not vanish — the wall you drove at does. Each face of a
    // block is its own quad, so the one facing the impact can be taken out on
    // its own, leaving a hole to drive through and the rest standing.
    if (item.walls) return this._breach(item, blow);

    item.gone = true;
    this.broken++;
    if (item.box) item.box.solid = false;

    this._hide(item, item.start, item.count);
    this._hideInstances(item);
    this._scatter(item, blow);
    this.onBreak(item, blow);
    return true;
  }

  /**
   * Takes the struck wall out of a building.
   *
   * Which wall it is comes from the direction of travel in the building's own
   * frame: whichever face the car is heading into. The whole footprint stops
   * being solid at that point, so what is left is a shell you can drive into.
   */
  _breach(item, blow) {
    const yaw = item.rot ?? 0;
    const vx = blow?.vx ?? 0;
    const vz = blow?.vz ?? 0;
    // into the building's local axes
    const lx = vx * Math.cos(yaw) - vz * Math.sin(yaw);
    const lz = vx * Math.sin(yaw) + vz * Math.cos(yaw);
    // wallBox lays the faces down in this order
    const face = Math.abs(lz) > Math.abs(lx)
      ? (lz > 0 ? 1 : 0)          // heading +Z hits the -Z wall, and the reverse
      : (lx > 0 ? 3 : 2);

    const already = item.gone === true;
    for (const w of item.walls) {
      if (w.done) continue;
      if (w.face !== face) continue;
      this._hide(w.mesh ?? item.mesh, w.start, w.count, item);
      w.done = true;
    }
    if (item.box) item.box.solid = false;
    if (!already) {
      item.gone = true;
      this.broken++;
      // Once a wall is missing you can see the inside of the others, and a
      // single-sided shell would look like an open box with no far wall.
      this.onOpened?.(item);
      this._scatter(item, blow);
      this.onBreak(item, blow);
    }
    return true;
  }

  /** Collapses a run of vertices onto one point, where nothing can see them. */
  _hide(meshOrItem, start, count, owner) {
    const item = owner ?? meshOrItem;
    const mesh = owner ? meshOrItem : meshOrItem.mesh;
    if (!mesh || !count) return;
    const attr = mesh.geometry.attributes.position;
    const arr = attr.array;
    const base = item.y ?? 0;
    for (let i = start; i < start + count; i++) {
      arr[i * 3] = item.x;
      arr[i * 3 + 1] = base;
      arr[i * 3 + 2] = item.z;
    }
    // only the touched slice goes back to the GPU
    if (attr.addUpdateRange) {
      attr.clearUpdateRanges?.();
      attr.addUpdateRange(start * 3, count * 3);
    }
    attr.needsUpdate = true;
  }

  /** Lamp heads, light pools and signal lenses live in instanced meshes. */
  _hideInstances(item) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const ref of item.instances || []) {
      ref.mesh.setMatrixAt(ref.index, zero);
      ref.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Hands the pieces to the rigid-body pool. */
  _scatter(item, blow) {
    const rigid = this.rigid;
    if (!rigid) return;
    const vx = blow?.vx ?? 0;
    const vz = blow?.vz ?? 0;
    const speed = blow?.speed ?? 6;
    const kick = Math.min(1.35, speed / 18);
    const pieces = item.pieces || makePieces(item);

    // one shared tumble, so the wreck leaves as a wreck and only comes apart
    // when it lands — pieces given independent spins fly off like confetti
    const tumble = {
      x: (Math.random() - 0.5) * 3.4 * kick,
      y: (Math.random() - 0.5) * 2.6 * kick,
      z: (Math.random() - 0.5) * 3.4 * kick
    };

    for (const p of pieces) {
      // Anything higher up leaves faster: when a column shears at the base the
      // top of it is swinging through the biggest arc.
      const lever = item.height > 2
        ? 0.35 + (p.y - item.y) / Math.max(1, item.height)
        : 1;
      const spread = p.spread ?? 0.5;
      // piece offsets are given in the thing's own frame
      const yaw = item.yaw ?? 0;
      const cs = Math.cos(yaw);
      const sn = Math.sin(yaw);
      const dx = p.dx ?? 0;
      const dz = p.dz ?? 0;
      rigid.spawn({
        x: item.x + dx * cs + dz * sn,
        y: p.y,
        z: item.z - dx * sn + dz * cs,
        hx: p.hx, hy: p.hy, hz: p.hz,
        yaw: (p.yaw ?? 0) + (item.yaw ?? 0),
        colour: p.colour,
        mass: p.mass,
        restitution: p.restitution ?? 0.16,
        friction: 0.7,
        vx: vx * kick * lever * 0.8 + (Math.random() - 0.5) * 2.2 * spread,
        vy: 1.2 + kick * 3.2 * lever + Math.random() * spread,
        vz: vz * kick * lever * 0.8 + (Math.random() - 0.5) * 2.2 * spread,
        sx: tumble.x + (Math.random() - 0.5) * 3 * spread,
        sy: tumble.y + (Math.random() - 0.5) * 3 * spread,
        sz: tumble.z + (Math.random() - 0.5) * 3 * spread
      });
    }
  }
}

function makePieces(item) {
  if (item.kind === 'park') return carPieces(item);
  if (item.kind === 'agac') return treePieces(item);
  if (item.kind === 'bina') return wallPieces(item);
  return columnPieces(item);
}

/** A tree: the trunk snaps, the crown comes down in pieces. */
export function treePieces(item) {
  const s = item.scale ?? 1;
  const pieces = [];
  const trunkH = 3.0 * s;
  for (let i = 0; i < 2; i++) {
    pieces.push({
      y: item.y + trunkH * (0.25 + i * 0.5),
      hx: 0.2 * s, hy: trunkH * 0.24, hz: 0.2 * s,
      mass: 90, colour: 0x5c4632, spread: 0.4, restitution: 0.08
    });
  }
  const leaf = item.leaf ?? 0x4f7a37;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    pieces.push({
      y: item.y + (3.6 + Math.random() * 0.9) * s,
      dx: Math.cos(a) * 1.1 * s, dz: Math.sin(a) * 1.1 * s,
      hx: 0.85 * s, hy: 0.62 * s, hz: 0.85 * s,
      mass: 40, colour: leaf, spread: 1.1, restitution: 0.05, friction: 0.9
    });
  }
  return pieces;
}

/** Masonry off a breached wall. */
export function wallPieces(item) {
  const pieces = [];
  const n = 7;
  const span = Math.max(2, item.wallW ?? 8);
  for (let i = 0; i < n; i++) {
    pieces.push({
      y: item.y + 0.6 + Math.random() * 3.2,
      dx: (Math.random() - 0.5) * span * 0.8,
      dz: (item.wallZ ?? 0) * 0.9,
      hx: 0.35 + Math.random() * 0.5,
      hy: 0.22 + Math.random() * 0.3,
      hz: 0.3 + Math.random() * 0.45,
      mass: 120 + Math.random() * 180,
      colour: item.colour ?? 0xb9b3a6,
      spread: 1.2,
      restitution: 0.08,
      friction: 0.85
    });
  }
  return pieces;
}

/** The pieces a lamp or signal column breaks into. */
export function columnPieces(item) {
  const height = item.height || 7;
  const colour = item.colour ?? 0x545a60;
  const parts = 3;
  const seg = height / parts;
  const pieces = [];
  for (let i = 0; i < parts; i++) {
    pieces.push({
      y: item.y + seg * (i + 0.5),
      hx: 0.12, hy: seg * 0.46, hz: 0.12,
      mass: 26 + i * 4,
      colour,
      spread: 0.35
    });
  }
  // the head or the signal box, thrown clear
  pieces.push({
    y: item.y + height + 0.05, dx: 0.25, dz: 0.15,
    hx: 0.3, hy: 0.1, hz: 0.18,
    mass: 9, colour: item.headColour ?? colour, restitution: 0.3, spread: 1
  });
  return pieces;
}

/**
 * A parked car coming apart. The shell keeps the car's own colour so what
 * cartwheels down the road still reads as the car that was standing there.
 */
export function carPieces(item) {
  const c = item.colour ?? 0x8a8f96;
  const y = item.y;
  const pieces = [
    { y: y + 0.62, hx: 0.9, hy: 0.36, hz: 2.2, mass: 780, colour: c, spread: 0.25 },
    { y: y + 1.28, dz: -0.2, hx: 0.78, hy: 0.31, hz: 1.1, mass: 210, colour: c, spread: 0.6 },
    { y: y + 1.36, dz: -0.2, hx: 0.8, hy: 0.21, hz: 1.05, mass: 60, colour: 0x2b3a48, spread: 1.1 }
  ];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    pieces.push({
      y: y + 0.32, dx: sx * 0.86, dz: sz * 1.4,
      hx: 0.11, hy: 0.32, hz: 0.32,
      mass: 24, colour: 0x14161a, spread: 0.9, restitution: 0.32
    });
  }
  return pieces;
}
