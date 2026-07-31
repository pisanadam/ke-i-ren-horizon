import * as THREE from 'three';
import { baseHeight } from './heightfield.js';
import { MAP, LANDMARKS, RAMPS, rampAt } from './mapData.js';
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

export class Ground {
  constructor(network) {
    this.net = network;
    this.mesh = null;
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
    if (!r) return base;
    const outer = r.walkOuter || r.halfWidth;
    const infl = smoothstep(outer + CORRIDOR, r.halfWidth * 0.6, r.dist);
    return lerp(base, r.y - SINK, infl);
  }

  normalAt(x, z, eps = 1.6) {
    const hL = this.heightAt(x - eps, z);
    const hR = this.heightAt(x + eps, z);
    const hD = this.heightAt(x, z - eps);
    const hU = this.heightAt(x, z + eps);
    const n = new THREE.Vector3(hL - hR, 2 * eps, hD - hU);
    return n.normalize();
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

    this.mesh = new THREE.Mesh(geo, this.material());
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain-backdrop';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    return this.mesh;
  }
}
