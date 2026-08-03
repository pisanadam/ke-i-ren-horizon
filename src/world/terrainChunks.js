import * as THREE from 'three';
import { MAP } from './mapData.js';
import { QUALITY } from '../quality.js';

/**
 * How many chunks out from the car keep the full detail.
 *
 * It has to reach the diagonals. At 1.2 it covered the four squares sharing an
 * edge with the car's own and left the four corners coarse — and a corner
 * square can begin a couple of metres from the bumper, so a wedge of
 * sixteen-metre ground came up through the tarmac right beside the car.
 * √2 is the least that takes in the whole ring; 1.5 takes it in and no more.
 */
const NEAR_RING = 1.5;
/** How much coarser the ground gets past that. */
const FAR_STEP = 2;
/**
 * Coarse ground is dropped by this much.
 *
 * Sampling the road-conforming height every sixteen metres instead of every
 * eight cuts corners, and where it cuts one upwards the hillside pokes through
 * the road laid over it. Sinking the coarse mesh a hand's breadth puts it
 * under the tarmac for good; the seam it leaves at the ring boundary is six
 * hundred metres away and thinner than a pixel.
 */
const FAR_SINK = 0.28;

/**
 * Detailed terrain, built a square at a time around the player.
 *
 * Ankara is far too large to mesh in one go — road-conforming terrain costs a
 * road query per vertex, so a single mesh covering the whole map would take
 * minutes to build and hundreds of megabytes to hold. Instead a coarse
 * backdrop covers everything (built once, cheap), and detailed patches are
 * laid over it near the car as it drives.
 *
 * Patches are never thrown away once built: they cost little to keep hidden,
 * and rebuilding them would repeat the expensive part every time the player
 * doubles back.
 */
export class TerrainChunks {
  constructor(ground, scene) {
    this.ground = ground;
    this.scene = scene;
    this.size = QUALITY.chunkSize;
    this.step = QUALITY.terrainStep;
    this.radius = QUALITY.chunkRadius;

    this.group = new THREE.Group();
    this.group.name = 'terrain-detail';
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);

    this.chunks = new Map();
    this.limit = Math.ceil((MAP.half + this.size) / this.size);
    this.built = 0;
    this._visible = new Set();
  }

  _key(ix, iz) { return ix * 100003 + iz; }
  _coarseKey(ix, iz) { return -(ix * 100003 + iz) - 1; }

  /**
   * Whether a chunk is close enough to be worth meshing finely.
   *
   * Everything within `radius` used to be built at the same eight-metre
   * resolution, which meant a square four kilometres across at the detail you
   * need under the wheels: 450k triangles a frame, more than the whole city
   * put together. Beyond the ring next to the car, ground detail is smaller
   * than a pixel, so out there the same square is meshed at sixteen metres and
   * costs a quarter as much.
   */
  _isNear(dx, dz) { return dx * dx + dz * dz <= NEAR_RING * NEAR_RING; }

  _inWorld(ix, iz) {
    return Math.abs(ix) <= this.limit && Math.abs(iz) <= this.limit;
  }

  /**
   * Builds one chunk if it does not exist yet. Returns true if it did work.
   *
   * A square can end up meshed twice — once coarse when it was on the horizon
   * and once fine when the car got to it. Both are kept: the coarse one is
   * cheap to hold and the car may well drive back out again, and rebuilding
   * means paying for the road query at every vertex a second time.
   */
  _build(ix, iz, near) {
    const k = near ? this._key(ix, iz) : this._coarseKey(ix, iz);
    if (this.chunks.has(k)) return false;
    const step = near ? this.step : this.step * FAR_STEP;
    const mesh = this.ground.buildPatch(ix * this.size, iz * this.size, this.size, step);
    if (!near) {
      mesh.geometry.translate(0, -FAR_SINK, 0);
      mesh.geometry.computeBoundingSphere();
    }
    mesh.visible = false;
    mesh.name = `chunk-${ix}-${iz}${near ? '' : '-uzak'}`;
    // chunks appear long after the world is marked up, so they opt in here
    this.onChunk?.(mesh);
    this.group.add(mesh);
    this.chunks.set(k, mesh);
    this.built++;
    return true;
  }

  /** Chunks the player can see, nearest first. */
  _wanted(x, z) {
    const cx = Math.floor(x / this.size);
    const cz = Math.floor(z / this.size);
    const out = [];
    const r = this.radius;
    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iz = cz - r; iz <= cz + r; iz++) {
        if (!this._inWorld(ix, iz)) continue;
        // circular, so corners of the square do not cost a chunk each
        const dx = ix - cx;
        const dz = iz - cz;
        if (dx * dx + dz * dz > (r + 0.35) * (r + 0.35)) continue;
        out.push({ ix, iz, d: dx * dx + dz * dz, near: this._isNear(dx, dz) });
      }
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  /** Builds everything around a point right away — used on the loading screen. */
  preload(x, z) {
    for (const c of this._wanted(x, z)) {
      this._build(c.ix, c.iz, false);
      if (c.near) this._build(c.ix, c.iz, true);
    }
    this.refresh(x, z);
  }

  /** Shows the chunks around a point and hides the rest. */
  refresh(x, z) {
    const want = new Set();
    for (const c of this._wanted(x, z)) {
      // A square the car has already visited has a fine mesh sitting there;
      // once it is on the horizon the coarse one is the right one to show, and
      // if that has not been built yet the fine one will do until it is.
      const fine = this._key(c.ix, c.iz);
      const coarse = this._coarseKey(c.ix, c.iz);
      const k = c.near
        ? (this.chunks.has(fine) ? fine : coarse)
        : (this.chunks.has(coarse) ? coarse : fine);
      want.add(k);
      const m = this.chunks.get(k);
      if (m) m.visible = true;
    }
    for (const k of this._visible) {
      if (want.has(k)) continue;
      const m = this.chunks.get(k);
      if (m) m.visible = false;
    }
    this._visible = want;
  }

  /**
   * Called every frame. Builds at most a few milliseconds' worth so the frame
   * rate never falls off a cliff when the player crosses into new ground.
   */
  update(x, z, budgetMs = 6) {
    const want = this._wanted(x, z);
    const deadline = performance.now() + budgetMs;
    let builtAny = false;

    /**
     * The coarse mesh for a square goes down first, even where a fine one is
     * wanted.
     *
     * A chunk is one indivisible piece of work — five road queries at every
     * one of six thousand vertices — and at fine resolution that is the
     * seventy-millisecond frame you feel as a stutter when you drive into new
     * ground. The coarse version of the same square costs a quarter of that
     * and `refresh` will happily stand on it, so the ground is never missing
     * while the detailed mesh is found a spare few milliseconds later.
     */
    for (const c of want) {
      if (this.chunks.has(this._coarseKey(c.ix, c.iz))) continue;
      this._build(c.ix, c.iz, false);
      builtAny = true;
      if (performance.now() >= deadline) break;
    }
    for (const c of want) {
      if (!c.near || this.chunks.has(this._key(c.ix, c.iz))) continue;
      if (performance.now() >= deadline) break;
      this._build(c.ix, c.iz, true);
      builtAny = true;
    }

    // only touch visibility when the player actually changed chunk
    const cx = Math.floor(x / this.size);
    const cz = Math.floor(z / this.size);
    if (builtAny || cx !== this._lastCx || cz !== this._lastCz) {
      this._lastCx = cx;
      this._lastCz = cz;
      this.refresh(x, z);
    }
  }
}
