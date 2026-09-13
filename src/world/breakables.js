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
    this.scene = rigid?.scene ?? null;
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
    // Ordinary props disappear once. Buildings keep their remaining walls,
    // so a later impact may open a second, separate way through the shell.
    if (!item || (item.gone && !item.walls)) return false;

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
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const vx = blow?.vx ?? 0;
    const vz = blow?.vz ?? 0;
    // direction of travel, and where the car is, in the building's own axes
    const lx = vx * cs - vz * sn;
    const lz = vx * sn + vz * cs;
    const px = blow?.x ?? item.x;
    const pz = blow?.z ?? item.z;
    const ox = (px - item.x) * cs - (pz - item.z) * sn;
    const oz = (px - item.x) * sn + (pz - item.z) * cs;

    const hw = item.hw ?? 6;
    const hd = item.hd ?? 6;

    /**
     * Which wall took it.
     *
     * Whichever one the car is actually up against — not whichever one it is
     * heading towards. Those are the same thing on the way in and opposite
     * ones on the way out: standing inside a building pressed against the far
     * wall, the direction of travel names the wall you came in through, and
     * you would tear another hole in that one while the wall in front of you
     * stayed shut.
     */
    let face;
    if (blow && blow.x !== undefined) {
      const d = [Math.abs(hd - oz), Math.abs(oz + hd), Math.abs(hw - ox), Math.abs(ox + hw)];
      face = d.indexOf(Math.min(...d));
    } else {
      // wallBox lays the faces down in this order; heading +Z hits the -Z wall
      face = Math.abs(lz) > Math.abs(lx) ? (lz > 0 ? 1 : 0) : (lx > 0 ? 3 : 2);
    }
    // how far along that wall the car went in, 0 at one end and 1 at the other
    let t;
    if (face === 0) t = (ox + hw) / (2 * hw);
    else if (face === 1) t = (hw - ox) / (2 * hw);
    else if (face === 2) t = (hd - oz) / (2 * hd);
    else t = (oz + hd) / (2 * hd);
    t = Math.max(0, Math.min(1, t));

    const wall = item.walls.find((w) => w.face === face && !w.exhausted);
    if (!wall) return false;

    // A car-wide bite out of the wall: the column it went in at plus its
    // neighbour, both rows of the reachable band. What is left of the wall
    // stays standing, which is the difference between a hole and a demolition.
    const hit = Math.min(wall.cols - 1, Math.floor(t * wall.cols));
    const bite = (blow?.speed ?? 0) > 34 ? 3 : 2;
    const from = Math.max(0, Math.min(wall.cols - bite, hit - Math.floor(bite / 2)));
    const to = Math.min(wall.cols - 1, from + bite - 1);
    const opened = [];
    wall.holes = wall.holes || new Set();
    for (let r = 0; r < wall.rows; r++) {
      for (let c = from; c <= to; c++) {
        const n = r * wall.cols + c;
        if (wall.holes.has(n)) continue;
        wall.holes.add(n);
        this._hide(wall.mesh, wall.cells[n], 4, item);
        opened.push(n);
      }
    }
    if (!opened.length) return false;
    if (wall.holes.size >= wall.cols * wall.rows) wall.exhausted = true;

    // Where the hole is, in the world — the collider is told to let anything
    // through there, so the rest of the building still stops you.
    const along = (from + to + 1) / wall.cols - 1;
    let hx;
    let hz;
    if (face === 0) { hx = along * hw; hz = hd; }
    else if (face === 1) { hx = -along * hw; hz = -hd; }
    else if (face === 2) { hx = hw; hz = -along * hd; }
    else { hx = -hw; hz = along * hd; }
    const worldX = item.x + hx * cs + hz * sn;
    const worldZ = item.z - hx * sn + hz * cs;
    if (item.box) {
      item.box.holes = item.box.holes || [];
      const span = face < 2 ? hw * 2 : hd * 2;
      const holeWidth = (to - from + 1) * span / wall.cols;
      item.box.holes.push({ x: worldX, z: worldZ, r: holeWidth * 0.52 + 0.9 });
      // and from now on the footprint is a shell with a room in it, so what
      // you drove into is somewhere you can drive around
      if (item.box.shell === undefined) item.box.shell = 0.8;
    }

    const span = face < 2 ? hw * 2 : hd * 2;
    const holeWidth = (to - from + 1) * span / wall.cols;
    this._showBreach(item, face, along, holeWidth, wall.bandH ?? 4.4);

    const first = !item.gone;
    item.gone = true;
    if (first) {
      this.broken++;
      // Once a wall is open you can see the inside of the others, and a
      // single-sided shell would look like a box with no far wall.
      this.onOpened?.(item);
    }
    this._scatter({ ...item, x: worldX, z: worldZ, y: item.y }, blow);
    this.onBreak(item, { ...blow, x: worldX, z: worldZ, y: item.y + 1.5 });
    return true;
  }

  /** Adds concrete jambs, a lintel and a floor behind a new facade hole. */
  _showBreach(item, face, along, width, height) {
    if (!this.scene) return;
    if (!this._concrete) {
      this._concrete = new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.98 });
      this._inside = new THREE.MeshStandardMaterial({ color: 0x4b4945, roughness: 1, side: THREE.DoubleSide });
    }
    const root = new THREE.Group();
    root.position.set(item.x, item.y + 0.025, item.z);
    root.rotation.y = item.rot ?? 0;
    root.name = 'building-breach';
    const hw = item.hw ?? 6;
    const hd = item.hd ?? 6;
    const depth = Math.min(3.6, (face < 2 ? hd : hw) * 0.62);
    const centre = new THREE.Vector3();
    const outward = new THREE.Vector3();
    if (face === 0) { centre.set(along * hw, 0, hd); outward.set(0, 0, 1); }
    else if (face === 1) { centre.set(-along * hw, 0, -hd); outward.set(0, 0, -1); }
    else if (face === 2) { centre.set(hw, 0, -along * hd); outward.set(1, 0, 0); }
    else { centre.set(-hw, 0, along * hd); outward.set(-1, 0, 0); }
    const innerX = centre.x - outward.x * depth * 0.5;
    const innerZ = centre.z - outward.z * depth * 0.5;

    const add = (w, h, d, x, y, z, mat = this._concrete) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    };
    const edge = 0.18;
    if (face < 2) {
      add(edge, height, depth, centre.x - width * 0.5, height * 0.5, innerZ);
      add(edge, height, depth, centre.x + width * 0.5, height * 0.5, innerZ);
      add(width + edge * 2, edge, depth, centre.x, height - edge * 0.5, innerZ);
      add(width, 0.12, depth, centre.x, 0.035, innerZ, this._inside);
    } else {
      add(depth, height, edge, innerX, height * 0.5, centre.z - width * 0.5);
      add(depth, height, edge, innerX, height * 0.5, centre.z + width * 0.5);
      add(depth, edge, width + edge * 2, innerX, height - edge * 0.5, centre.z);
      add(depth, 0.12, width, innerX, 0.035, centre.z, this._inside);
    }
    // Uneven masonry around the opening keeps the edge from looking laser-cut.
    for (let i = 0; i < 7; i++) {
      const side = i % 2 ? -1 : 1;
      const y = 0.35 + (i / 7) * (height - 0.65);
      const size = 0.10 + Math.random() * 0.16;
      if (face < 2) add(size, size * 1.6, 0.34, centre.x + side * width * 0.5, y, centre.z - outward.z * 0.12);
      else add(0.34, size * 1.6, size, centre.x - outward.x * 0.12, y, centre.z + side * width * 0.5);
    }
    this.scene.add(root);
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
      const yaw = item.yaw ?? item.rot ?? 0;
      const cs = Math.cos(yaw);
      const sn = Math.sin(yaw);
      const dx = p.dx ?? 0;
      const dz = p.dz ?? 0;
      rigid.spawn({
        x: item.x + dx * cs + dz * sn,
        y: p.y,
        z: item.z - dx * sn + dz * cs,
        hx: p.hx, hy: p.hy, hz: p.hz,
        yaw: (p.yaw ?? 0) + yaw,
        shape: p.shape ?? 'box',
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
  // a mix: a few slabs off the edge of the hole and a lot of small rubble
  for (let i = 0; i < 4; i++) {
    pieces.push({
      y: item.y + 0.5 + Math.random() * 3.6,
      dx: (Math.random() - 0.5) * 4.2,
      dz: (Math.random() - 0.5) * 1.4,
      hx: 0.42 + Math.random() * 0.5,
      hy: 0.3 + Math.random() * 0.4,
      hz: 0.22 + Math.random() * 0.2,
      mass: 260 + Math.random() * 220,
      colour: item.colour ?? 0xb9b3a6,
      spread: 1, restitution: 0.06, friction: 0.9
    });
  }
  for (let i = 0; i < 10; i++) {
    pieces.push({
      y: item.y + 0.3 + Math.random() * 4.2,
      dx: (Math.random() - 0.5) * 5.2,
      dz: (Math.random() - 0.5) * 2.4,
      hx: 0.1 + Math.random() * 0.22,
      hy: 0.1 + Math.random() * 0.2,
      hz: 0.1 + Math.random() * 0.22,
      mass: 25 + Math.random() * 60,
      colour: item.colour ?? 0xb9b3a6,
      spread: 1.8, restitution: 0.2, friction: 0.8
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
    { y: y + 0.62, hx: 0.9, hy: 0.36, hz: 2.2, mass: 780, colour: c, spread: 0.25, shape: 'panel' },
    { y: y + 1.28, dz: -0.2, hx: 0.78, hy: 0.31, hz: 1.1, mass: 210, colour: c, spread: 0.6, shape: 'panel' },
    { y: y + 1.36, dz: -0.2, hx: 0.8, hy: 0.21, hz: 1.05, mass: 60, colour: 0x2b3a48, spread: 1.1, shape: 'glass' }
  ];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    pieces.push({
      y: y + 0.32, dx: sx * 0.86, dz: sz * 1.4,
      hx: 0.11, hy: 0.32, hz: 0.32,
      mass: 24, colour: 0x14161a, spread: 0.9, restitution: 0.32, shape: 'wheel'
    });
  }
  return pieces;
}
