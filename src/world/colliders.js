/**
 * Static world collision: a uniform hash of oriented boxes (walls, buildings,
 * landmark volumes, street furniture) with a cheap push-out query.
 */
const CELL = 28;

export class ColliderGrid {
  constructor() {
    this.items = [];
    this.cells = new Map();
  }

  /** @param {number} cx @param {number} cz @param {number} hx half-size along local X
   *  @param {number} hz half-size along local Z @param {number} rot yaw in radians */
  add(cx, cz, hx, hz, rot = 0, solid = true) {
    const box = {
      cx, cz, hx, hz,
      cos: Math.cos(rot),
      sin: Math.sin(rot),
      radius: Math.hypot(hx, hz),
      solid
    };
    const id = this.items.length;
    this.items.push(box);

    const r = box.radius;
    for (let ix = Math.floor((cx - r) / CELL); ix <= Math.floor((cx + r) / CELL); ix++) {
      for (let iz = Math.floor((cz - r) / CELL); iz <= Math.floor((cz + r) / CELL); iz++) {
        const k = ix * 100003 + iz;
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(id);
      }
    }
    return box;
  }

  /**
   * Resolves a circle of `radius` at (x,z) against nearby boxes.
   *
   * `onFrail` is called for anything marked breakable before it is treated as
   * a wall. Returning true means it gave way, and the circle passes straight
   * through — which is the difference between shearing a lamp post off at the
   * base and bouncing off it.
   *
   * @returns {{x:number,z:number,nx:number,nz:number,depth:number,box:object}|null}
   */
  resolveCircle(x, z, radius, onFrail = null) {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let px = x;
    let pz = z;
    let hitNx = 0;
    let hitNz = 0;
    let maxDepth = 0;
    let hitBox = null;

    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const arr = this.cells.get(ix * 100003 + iz);
        if (!arr) continue;
        for (let n = 0; n < arr.length; n++) {
          const b = this.items[arr[n]];
          if (!b.solid) continue;
          if (b.frail && onFrail && onFrail(b)) continue;
          // to box space
          const dx = px - b.cx;
          const dz = pz - b.cz;
          const lx = dx * b.cos + dz * b.sin;
          const lz = -dx * b.sin + dz * b.cos;

          const ex = Math.abs(lx) - b.hx;
          const ez = Math.abs(lz) - b.hz;
          if (ex > radius || ez > radius) continue;

          let nlx = 0;
          let nlz = 0;
          let depth = 0;

          if (ex < 0 && ez < 0) {
            // centre is inside: exit through the nearest face
            if (ex > ez) { nlx = Math.sign(lx) || 1; depth = -ex + radius; }
            else { nlz = Math.sign(lz) || 1; depth = -ez + radius; }
          } else {
            const qx = Math.max(ex, 0) * Math.sign(lx || 1);
            const qz = Math.max(ez, 0) * Math.sign(lz || 1);
            const d = Math.hypot(qx, qz);
            if (d >= radius || d < 1e-6) continue;
            nlx = qx / d;
            nlz = qz / d;
            depth = radius - d;
          }
          if (depth <= 0) continue;

          // back to world space
          const nx = nlx * b.cos - nlz * b.sin;
          const nz = nlx * b.sin + nlz * b.cos;
          px += nx * depth;
          pz += nz * depth;
          if (depth > maxDepth) {
            maxDepth = depth;
            hitNx = nx;
            hitNz = nz;
            hitBox = b;
          }
        }
      }
    }

    if (maxDepth <= 0) return null;
    return { x: px, z: pz, nx: hitNx, nz: hitNz, depth: maxDepth, box: hitBox };
  }

  /** True when a footprint of the given half-extents would overlap something. */
  overlaps(cx, cz, hx, hz, rot = 0, margin = 0) {
    const radius = Math.hypot(hx, hz) + margin;
    for (let ix = Math.floor((cx - radius) / CELL); ix <= Math.floor((cx + radius) / CELL); ix++) {
      for (let iz = Math.floor((cz - radius) / CELL); iz <= Math.floor((cz + radius) / CELL); iz++) {
        const arr = this.cells.get(ix * 100003 + iz);
        if (!arr) continue;
        for (let n = 0; n < arr.length; n++) {
          const b = this.items[arr[n]];
          const d = Math.hypot(b.cx - cx, b.cz - cz);
          if (d < b.radius + radius) return true;
        }
      }
    }
    return false;
  }
}
