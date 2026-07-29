import * as THREE from 'three';
import { baseHeight } from './heightfield.js';
import { MAP, LANDMARKS } from './mapData.js';
import { clamp, lerp, smoothstep, fbm } from '../util/math.js';
import { grassTexture } from '../textures.js';
import { QUALITY } from '../quality.js';

const CORRIDOR = 20;   // metres over which terrain blends into a carriageway
const SINK = 0.30;     // terrain sits just under the tarmac so it never pokes through
const KERB = 0.16;     // kerb height, matching the pavement meshes in roads.js

/** Areas that should read as parkland rather than dry Ankara hillside. */
const GREENS = LANDMARKS
  .filter((l) => l.id === 'botanik' || l.id === 'stadyum')
  .map((l) => ({ x: l.x, z: l.z, r: l.radius * 1.15 }));

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
  heightAt(x, z) {
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

  build() {
    const size = MAP.groundSize;
    const step = QUALITY.terrainStep;
    const segs = Math.round(size / step);
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const dry = new THREE.Color(0x7d7f4c);
    const dryLight = new THREE.Color(0x99945c);
    const park = new THREE.Color(0x5f8f47);
    const rock = new THREE.Color(0x8a8172);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const inMap = Math.abs(x) < MAP.half + 60 && Math.abs(z) < MAP.half + 60;
      const y = inMap ? this.terrainHeight(x, z) : baseHeight(x, z);
      pos.setY(i, y);

      const variation = fbm(x * 0.008, z * 0.008, 3);
      tmp.copy(dry).lerp(dryLight, variation);
      if (this.isGreen(x, z)) tmp.lerp(park, 0.78);

      // expose bare rock where the hillside gets steep
      const hx = baseHeight(x + 6, z) - baseHeight(x - 6, z);
      const hz = baseHeight(x, z + 6) - baseHeight(x, z - 6);
      const slope = Math.hypot(hx, hz) / 12;
      tmp.lerp(rock, clamp((slope - 0.30) * 1.7, 0, 0.7));

      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const tex = grassTexture();
    tex.repeat.set(size / 14, size / 14);

    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      vertexColors: true,
      roughness: 0.98,
      metalness: 0
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    return this.mesh;
  }
}
