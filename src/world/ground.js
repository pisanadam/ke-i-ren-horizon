import * as THREE from 'three';
import { baseHeight } from './heightfield.js';
import { MAP, LANDMARKS, rampAt } from './mapData.js';
import { clamp, lerp, smoothstep, fbm } from '../util/math.js';
import { grassTexture } from '../textures.js';
import { QUALITY } from '../quality.js';

const CORRIDOR = 20;   // metres over which terrain blends into a carriageway
const SINK = 0.30;     // terrain sits just under the tarmac so it never pokes through
const KERB = 0.16;     // kerb height, matching the pavement meshes in roads.js

/** Areas that should read as parkland rather than dry Ankara hillside. */
const GREENS = LANDMARKS
  .filter((l) => l.green)
  .map((l) => ({ x: l.x, z: l.z, r: l.radius * 1.15 }));

const TONE = {
  dry: new THREE.Color(0x7d7f4c),
  dryLight: new THREE.Color(0x99945c),
  park: new THREE.Color(0x5f8f47),
  rock: new THREE.Color(0x8a8172)
};

/** How far round a building the ground eases back into the hillside. */
const PAD_BLEND = 5;
const PAD_CELL = 40;
/** The most chunks out from the car the detail ring ever reaches, either way. */
const MASK_R = 5;
const MASK_N = MASK_R * 2 + 1;

export class Ground {
  constructor(network) {
    this.net = network;
    this.mesh = null;
    /** Level building plots, filed by a coarse grid. */
    this._pads = new Map();
  }

  /**
   * Levels the ground under a building.
   *
   * A block is placed at the height of the hillside under its middle, and the
   * hillside carries on sloping underneath it: on the uphill side the grass
   * came up through the ground floor and over the shop windows (measured: a
   * quarter of all building corners buried, the worst by nearly four
   * metres), and driving into a breached block meant driving up a grassy
   * bank inside it. A plot is cut level to the building's floor and eased back
   * into the slope over a few metres round it, the way a real one is.
   */
  addPad(x, z, hw, hd, rot, y) {
    const pad = { x, z, hw, hd, cos: Math.cos(rot), sin: Math.sin(rot), y };
    const r = Math.hypot(hw, hd) + PAD_BLEND;
    for (let ix = Math.floor((x - r) / PAD_CELL); ix <= Math.floor((x + r) / PAD_CELL); ix++) {
      for (let iz = Math.floor((z - r) / PAD_CELL); iz <= Math.floor((z + r) / PAD_CELL); iz++) {
        const k = ix * 100003 + iz;
        let arr = this._pads.get(k);
        if (!arr) this._pads.set(k, (arr = []));
        arr.push(pad);
      }
    }
  }

  /**
   * How much a building plot claims this point, 0..1, and its level (left in
   * `_padY`). Applied after the blend into the road, not before: next to a
   * road that climbs past a block, that blend is what was dragging the
   * ground up through the shop floor.
   */
  _padWeight(x, z) {
    const arr = this._pads.get(Math.floor(x / PAD_CELL) * 100003 + Math.floor(z / PAD_CELL));
    if (!arr) return 0;
    let best = 0;
    for (const p of arr) {
      const dx = x - p.x;
      const dz = z - p.z;
      // building frame, as in colliders.js
      const ex = Math.max(0, Math.abs(dx * p.cos - dz * p.sin) - p.hw);
      const ez = Math.max(0, Math.abs(dx * p.sin + dz * p.cos) - p.hd);
      const d = Math.hypot(ex, ez);
      if (d >= PAD_BLEND) continue;
      const w = 1 - smoothstep(0, PAD_BLEND, d);
      if (w > best) { best = w; this._padY = p.y - 0.04; }
    }
    return best;
  }

  /** Cuts any building plot into a height, keeping off the road and pavement. */
  _withPad(x, z, h, r) {
    let w = this._padWeight(x, z);
    if (w <= 0) return h;
    if (r) {
      const outer = r.walkOuter || r.halfWidth;
      w *= smoothstep(outer, outer + 1.5, r.dist);
    }
    return lerp(h, this._padY, w);
  }

  /**
   * Height a wheel rests at. Inside the carriageway that is the tarmac; the
   * pavement sits a kerb-height above it (so mounting the kerb is a real
   * bump), and beyond that it blends back into the hillside.
   */
  /** Extra height from a jump ramp, if the point is on one. */
  rampRise(x, z) {
    const hit = rampAt(x, z);
    if (!hit) return 0;
    // eases in at the foot and tapers off at the sides so it is not a wall
    const up = hit.u * hit.u * (3 - 2 * hit.u);
    const side = 1 - Math.pow(Math.abs(hit.v), 6);
    return hit.ramp.rise * up * Math.max(0, side);
  }

  heightAt(x, z) {
    const rise = this.rampRise(x, z);
    if (rise > 0) return this._surface(x, z) + rise;
    return this._surface(x, z);
  }

  _surface(x, z) {
    const r = this.net.nearestRoad(x, z);
    return this._withPad(x, z, this._roadSurface(x, z, r), r);
  }

  _roadSurface(x, z, r) {
    const base = baseHeight(x, z);
    if (!r) return base;
    if (r.dist <= r.halfWidth) return r.y;

    if (r.walkOuter && r.dist <= r.walkOuter) {
      // ramp up over the 0.4 m kerb stone, then flat pavement
      return r.y + KERB * smoothstep(r.halfWidth, r.halfWidth + 0.4, r.dist);
    }

    const from = r.walkOuter ? r.walkOuter : r.halfWidth;
    const top = r.y + (r.walkOuter ? KERB : 0);
    const infl = smoothstep(from + CORRIDOR, from, r.dist);
    return lerp(base, top, infl);
  }

  /**
   * Same field, but pulled down so the terrain mesh always stays underneath
   * the tarmac and pavement slabs instead of poking through them.
   */
  terrainHeight(x, z) {
    const r = this.net.nearestRoad(x, z);
    const base = baseHeight(x, z);
    if (!r) return this._withPad(x, z, base, null);
    const outer = r.walkOuter || r.halfWidth;
    const infl = smoothstep(outer + CORRIDOR, r.halfWidth * 0.6, r.dist);
    return this._withPad(x, z, lerp(base, r.y - SINK, infl), r);
  }

  /** @param {THREE.Vector3} [out] filled in and returned, to spare an allocation per call */
  normalAt(x, z, eps = 1.6, out = new THREE.Vector3()) {
    const hL = this.heightAt(x - eps, z);
    const hR = this.heightAt(x + eps, z);
    const hD = this.heightAt(x, z - eps);
    const hU = this.heightAt(x, z + eps);
    return out.set(hL - hR, 2 * eps, hD - hU).normalize();
  }

  /** Slope in radians, handy for keeping buildings off cliffs. */
  slopeAt(x, z, eps = 6) {
    const n = this.normalAt(x, z, eps);
    return Math.acos(clamp(n.y, -1, 1));
  }

  isGreen(x, z) {
    for (const g of GREENS) {
      if (Math.hypot(x - g.x, z - g.z) < g.r) return true;
    }
    return false;
  }

  /** Hillside colour at a point — shared by the patches and the backdrop. */
  _shade(x, z, out) {
    const dry = TONE.dry;
    out.copy(dry).lerp(TONE.dryLight, fbm(x * 0.008, z * 0.008, 3));
    if (this.isGreen(x, z)) out.lerp(TONE.park, 0.78);

    // expose bare rock where the hillside gets steep
    const hx = baseHeight(x + 6, z) - baseHeight(x - 6, z);
    const hz = baseHeight(x, z + 6) - baseHeight(x, z - 6);
    const slope = Math.hypot(hx, hz) / 12;
    out.lerp(TONE.rock, clamp((slope - 0.30) * 1.7, 0, 0.7));
    return out;
  }

  /** The one material every terrain mesh shares. */
  material() {
    if (!this._mat) {
      const tex = grassTexture();
      tex.repeat.set(MAP.groundSize / 14, MAP.groundSize / 14);
      this._mat = new THREE.MeshStandardMaterial({
        map: tex, vertexColors: true, roughness: 0.98, metalness: 0
      });
    }
    return this._mat;
  }

  /**
   * One square of detailed terrain, road-conforming.
   *
   * Patch vertices land on a global lattice, so neighbouring patches share
   * their edge positions exactly. Normals are taken analytically from the
   * height field rather than from the patch's own triangles — a patch cannot
   * see over its own border, and per-patch normals leave a lit seam along
   * every join.
   */
  buildPatch(x0, z0, size, step) {
    const segs = Math.max(1, Math.round(size / step));
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    geo.translate(x0 + size / 2, 0, z0 + size / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const normals = geo.attributes.normal;
    const tmp = new THREE.Color();
    const eps = Math.max(1.5, step * 0.5);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, this.terrainHeight(x, z));

      const hL = this.terrainHeight(x - eps, z);
      const hR = this.terrainHeight(x + eps, z);
      const hD = this.terrainHeight(x, z - eps);
      const hU = this.terrainHeight(x, z + eps);
      const nx = hL - hR;
      const nz = hD - hU;
      const ny = 2 * eps;
      const len = Math.hypot(nx, ny, nz) || 1;
      normals.setXYZ(i, nx / len, ny / len, nz / len);

      this._shade(x, z, tmp);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, this.material());
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  /**
   * The backdrop's material: the shared ground, with a hole wherever a
   * detailed patch has been laid.
   *
   * The backdrop is sixty to a hundred metres a triangle and knows nothing of
   * roads, and it was always drawn — under the detailed ground, and through
   * it wherever a road is cut into a hill. Measured, at one road point in six
   * the backdrop stood above the tarmac, by up to almost three metres: the
   * walls of grass you drove straight through. Now each square the detailed
   * ground covers is cut out of it, so under the car there is only the ground
   * that was shaped around the road.
   */
  _backdropMaterial() {
    if (this._backMat) return this._backMat;
    const mat = this.material().clone();
    this._mask = {
      uMaskOrigin: { value: new THREE.Vector2(1e6, 1e6) },
      uMaskSize: { value: 620 },
      uMask: { value: new Float32Array(MASK_N * MASK_N) }
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this._mask);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vGroundXZ;
uniform vec2 uMaskOrigin;
uniform float uMaskSize;
uniform float uMask[${MASK_N * MASK_N}];`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
{
  vec2 cell = floor(vGroundXZ / uMaskSize) - uMaskOrigin;
  if (cell.x >= 0.0 && cell.y >= 0.0 && cell.x < ${MASK_N}.0 && cell.y < ${MASK_N}.0) {
    if (uMask[int(cell.y) * ${MASK_N} + int(cell.x)] > 0.5) discard;
  }
}`);
    };
    mat.customProgramCacheKey = () => 'terrain-backdrop';
    this._backMat = mat;
    return mat;
  }

  /**
   * Tells the backdrop which squares have detailed ground showing.
   * @param {number} cx @param {number} cz the car's square
   * @param {number} size square size in metres
   * @param {Array<[number, number]>} covered squares with a patch visible
   */
  maskBackdrop(cx, cz, size, covered) {
    this._backdropMaterial();
    const m = this._mask;
    m.uMaskOrigin.value.set(cx - MASK_R, cz - MASK_R);
    m.uMaskSize.value = size;
    const a = m.uMask.value;
    a.fill(0);
    for (const [ix, iz] of covered) {
      const i = ix - (cx - MASK_R);
      const j = iz - (cz - MASK_R);
      if (i >= 0 && j >= 0 && i < MASK_N && j < MASK_N) a[j * MASK_N + i] = 1;
    }
  }

  /**
   * Coarse hillside covering the whole world, built once. The detailed
   * patches sit on top of it near the player; further out this is all there
   * is, which is what fills the horizon with Ankara's hills.
   */
  buildBackdrop() {
    const size = MAP.groundSize;
    const step = QUALITY.backdropStep;
    const segs = Math.round(size / step);
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // no road conforming out here — it would cost a query per vertex and
      // the detailed patches cover everywhere the player can actually drive
      pos.setY(i, baseHeight(x, z) - 0.6);
      this._shade(x, z, tmp);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    this.mesh = new THREE.Mesh(geo, this._backdropMaterial());
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain-backdrop';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    return this.mesh;
  }
}
