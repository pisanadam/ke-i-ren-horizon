import * as THREE from 'three';
import { MAP } from './mapData.js';
import { QUALITY } from '../quality.js';

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

  _inWorld(ix, iz) {
    return Math.abs(ix) <= this.limit && Math.abs(iz) <= this.limit;
  }

  /** Builds one chunk if it does not exist yet. Returns true if it did work. */
  _build(ix, iz) {
    const k = this._key(ix, iz);
    if (this.chunks.has(k)) return false;
    const mesh = this.ground.buildPatch(ix * this.size, iz * this.size, this.size, this.step);
    mesh.visible = false;
    mesh.name = `chunk-${ix}-${iz}`;
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
        out.push({ ix, iz, d: dx * dx + dz * dz });
      }
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  /** Builds everything around a point right away — used on the loading screen. */
  preload(x, z) {
    for (const c of this._wanted(x, z)) this._build(c.ix, c.iz);
    this.refresh(x, z);
  }

  /** Shows the chunks around a point and hides the rest. */
  refresh(x, z) {
    const want = new Set();
    for (const c of this._wanted(x, z)) {
      const k = this._key(c.ix, c.iz);
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
    for (const c of want) {
      if (this.chunks.has(this._key(c.ix, c.iz))) continue;
      this._build(c.ix, c.iz);
      builtAny = true;
      if (performance.now() >= deadline) break;
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
