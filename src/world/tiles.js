import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Cutting the city into tiles.
 *
 * Everything static used to be merged into a handful of enormous meshes —
 * one for all the facades, one for every lamp post in Ankara, and so on. That
 * keeps the draw call count down, which is why it was done, but it has a
 * fatal property: a mesh that spans nine kilometres has a bounding sphere
 * that spans nine kilometres, so the renderer can never decide it is out of
 * shot. Every rooftop water tank in Sincan was submitted for drawing while
 * you were parked in Keçiören.
 *
 * Merging per tile instead gives each mesh a bounding sphere a few hundred
 * metres across, which the frustum test can throw away for free, and lets
 * anything past the view distance be switched off outright. The world is
 * still built in one go at load — nothing streams — there is simply no longer
 * a reason to draw the half of it that is behind you.
 */

export const TILE = 560;

const key = (ix, iz) => `${ix}:${iz}`;

/** Centre of a geometry, used to decide which tile it belongs to. */
function centroid(geo, out) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  out.x = (b.min.x + b.max.x) * 0.5;
  out.z = (b.min.z + b.max.z) * 0.5;
  return out;
}

/**
 * One tiled layer: a group of per-tile meshes that can be switched on and off
 * by distance. Frustum culling is left to the renderer.
 */
export class TileSet {
  constructor(name) {
    this.group = new THREE.Group();
    this.group.name = name;
    this.tiles = [];
    /** Where each input geometry ended up: index -> { mesh, start, count } */
    this.placed = [];
  }

  /**
   * Hides tiles that are entirely further than `dist` away.
   *
   * The test is against each tile's real bounding sphere, not against the
   * grid cell it was filed under. A road surface is one long strip whose
   * centre can be a kilometre from the stretch you are standing on: filed by
   * its centre and culled by its cell, the tarmac under the car disappeared
   * while the buildings either side stayed.
   */
  update(x, z, dist) {
    for (const t of this.tiles) {
      const dx = t.cx - x;
      const dz = t.cz - z;
      const r = dist + t.r;
      t.mesh.visible = dx * dx + dz * dz <= r * r;
    }
  }

  showAll() {
    for (const t of this.tiles) t.mesh.visible = true;
  }
}

/**
 * Merges `geos` into one mesh per tile.
 *
 * Input order is kept within each tile, so a caller that pushed several
 * geometries for the same object can still find its own run of vertices
 * afterwards through `placed`.
 *
 * @param {THREE.BufferGeometry[]} geos
 * @param {THREE.Material} material
 * @param {string} name
 * @param {{cast?:boolean, receive?:boolean}} [opts]
 * @returns {TileSet}
 */
export function mergeByTile(geos, material, name, opts = {}) {
  const set = new TileSet(name);
  const buckets = new Map();
  const c = { x: 0, z: 0 };

  for (let i = 0; i < geos.length; i++) {
    const geo = geos[i];
    if (!geo) continue;
    centroid(geo, c);
    const ix = Math.floor(c.x / TILE);
    const iz = Math.floor(c.z / TILE);
    const k = key(ix, iz);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = { ix, iz, geos: [], idx: [], verts: 0 }));
    b.idx.push(i);
    b.geos.push(geo);
  }

  for (const b of buckets.values()) {
    let start = 0;
    for (let n = 0; n < b.geos.length; n++) {
      const count = b.geos[n].attributes.position.count;
      set.placed[b.idx[n]] = { start, count, mesh: null };
      start += count;
    }
    const merged = mergeGeometries(b.geos, false);
    b.geos.forEach((g) => g.dispose());
    if (!merged) continue;

    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = opts.receive !== false;
    mesh.matrixAutoUpdate = false;
    mesh.name = `${name}-${b.ix}-${b.iz}`;
    merged.computeBoundingSphere();
    const sph = merged.boundingSphere;
    set.group.add(mesh);
    set.tiles.push({
      mesh,
      cx: sph ? sph.center.x : (b.ix + 0.5) * TILE,
      cz: sph ? sph.center.z : (b.iz + 0.5) * TILE,
      r: sph ? sph.radius : TILE
    });
    for (const i of b.idx) if (set.placed[i]) set.placed[i].mesh = mesh;
  }

  return set;
}

/**
 * Splits instanced content the same way: one InstancedMesh per tile, so a
 * forest on the far side of the map is one bounding-sphere test rather than
 * nine thousand trees submitted every frame.
 *
 * @param {Array<{x:number,z:number}>} items
 * @param {THREE.BufferGeometry} geo
 * @param {THREE.Material} material
 * @param {string} name
 * @param {(item:any, i:number, dummy:THREE.Object3D)=>THREE.Color|null} write
 *   positions `dummy` for one item and returns its colour, or null for none
 * @returns {TileSet & {slots: Array<{mesh:THREE.InstancedMesh, index:number}>}}
 */
export function instanceByTile(items, geo, material, name, write) {
  const set = new TileSet(name);
  set.slots = [];
  const buckets = new Map();

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const ix = Math.floor(it.x / TILE);
    const iz = Math.floor(it.z / TILE);
    const k = key(ix, iz);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = { ix, iz, items: [] }));
    b.items.push(i);
  }

  const dummy = new THREE.Object3D();
  for (const b of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geo, material, b.items.length);
    mesh.name = `${name}-${b.ix}-${b.iz}`;
    let n = 0;
    for (const i of b.items) {
      const colour = write(items[i], i, dummy);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      if (colour) mesh.setColorAt(n, colour);
      set.slots[i] = { mesh, index: n };
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    const sph = mesh.boundingSphere;
    set.group.add(mesh);
    set.tiles.push({
      mesh,
      cx: sph ? sph.center.x : (b.ix + 0.5) * TILE,
      cz: sph ? sph.center.z : (b.iz + 0.5) * TILE,
      r: sph ? sph.radius : TILE
    });
  }
  return set;
}

/** Drives a collection of tiled layers from one place. */
export class TileWorld {
  constructor() {
    this.sets = [];
    this.distance = 2200;
  }

  add(set) {
    if (set) this.sets.push(set);
    return set;
  }

  update(x, z) {
    for (const s of this.sets) s.update(x, z, this.distance);
  }

  /** Every tile mesh in every layer, for the reflection probe and culling. */
  forEachMesh(fn) {
    for (const s of this.sets) for (const t of s.tiles) fn(t.mesh);
  }

  get tileCount() {
    let n = 0;
    for (const s of this.sets) n += s.tiles.length;
    return n;
  }
}
