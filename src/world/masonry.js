import * as THREE from 'three';
import { QUALITY } from '../quality.js';
import { facadePalette } from '../textures.js';

/**
 * What an apartment wall is made of, where a car meets one.
 *
 * A city of twelve thousand apartment blocks cannot be drawn brick by brick,
 * so a wall is a facade until it is struck. Then the stretch around the
 * impact is quietly rebuilt as what an Ankara apartment wall really is: red
 * hollow brick in running bond behind a coat of plaster. The rebuild is meant
 * to be invisible — every brick carries the exact piece of the facade it
 * replaces on its outer face (the same texture, the same windows, lit the
 * same at night), laid flush with no joints showing. From the street the
 * building looks untouched. Only where bricks are knocked out does the inside
 * of the wall show: the plaster skin, the brick behind it, the mortar lines.
 *
 * From then on the wall behaves like masonry:
 *
 *  - whatever the bumper reaches is knocked out brick by brick, with a ragged
 *    edge rather than a clean rectangle, and thrown into the building at the
 *    speed of the car;
 *  - every course above is then checked for support. A brick can sit on the
 *    one below it, or be held by its neighbours for about one brick's length
 *    out over a gap — no further. That is all it takes for the wall above a
 *    hole to come down in a stepped, corbelled arch;
 *  - the bricks round the edge that did stay are knocked a few centimetres
 *    out of true, which opens hairline cracks in the plaster around the hole.
 *
 * Everything that comes loose goes to its own rigid-body pool, still plaster
 * on one face and brick on the rest.
 */

/** Course height and nominal brick length, mortar included. */
const COURSE = 0.21;
const BRICK = 0.42;
/** Wall thickness: one hollow brick laid flat, plaster included. */
const THICK = 0.24;
/** Plaster skin on the outside, as a share of the thickness. */
const PLASTER = 0.025 / THICK;

/**
 * Turns a standard material into one that draws a brick: the outer face
 * (+Z of the unit box) is the wall's skin, everything else is brick in
 * mortar with the plaster layer showing along its outer edge.
 *
 * @param {THREE.Material} material
 * @param {{facade:boolean}} opts `facade` true when the outer face samples
 *   the facade texture through a per-instance UV rectangle; false when it
 *   is a plain plaster colour given per instance (the rubble)
 */
export function brickMaterial(material, { facade }) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uPlaster = material.userData.plaster;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aVar;
${facade ? 'attribute vec4 aUvRect;' : 'attribute float aFade;\nvarying float vFade;'}
varying vec3 vBrick;
varying float vBrickVar;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
vBrick = position;
vBrickVar = aVar;
${facade ? '' : 'vFade = aFade;'}
${facade ? `vec2 brickUv = aUvRect.xy + (position.xy + 0.5) * aUvRect.zw;
#ifdef USE_MAP
vMapUv = (mapTransform * vec3(brickUv, 1.0)).xy;
#endif
#ifdef USE_EMISSIVEMAP
vEmissiveMapUv = (emissiveMapTransform * vec3(brickUv, 1.0)).xy;
#endif` : ''}`);
    const anchor = facade ? '#include <map_fragment>' : '#include <color_fragment>';
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uPlaster;
varying vec3 vBrick;
varying float vBrickVar;
${facade ? '' : 'varying float vFade;'}`)
      .replace(anchor, `${anchor}
${facade ? '' : `// dissolving: a stable screen-space dither eats the piece away, so it
// fades without being transparent (no sorting, no depth trouble)
if (vFade < 0.999) {
  float dither = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  if (dither > vFade) discard;
}`}
float brickOuter = step(0.4995, vBrick.z);
{
  vec3 plaster = ${facade ? 'uPlaster' : 'diffuseColor.rgb'};
  vec3 clay = mix(vec3(0.30, 0.065, 0.025), vec3(0.56, 0.15, 0.06), vBrickVar);
  // hollow-brick webs: the end faces of a Turkish brick are a grid of holes
  float endFace = step(0.4995, abs(vBrick.x));
  vec2 web = fract(vec2(vBrick.z * 4.0 + 0.5, vBrick.y * 3.0 + 0.5));
  float hole = endFace * step(0.18, web.x) * step(web.x, 0.82) * step(0.2, web.y) * step(web.y, 0.8);
  clay *= 1.0 - hole * 0.72;
  // mortar round the edge of every face that is not the skin
  float joint = max(step(0.47, abs(vBrick.x)), step(0.44, abs(vBrick.y)));
  vec3 side = mix(clay, vec3(0.34, 0.32, 0.28), joint * (1.0 - endFace));
  side = mix(side, plaster, step(0.5 - ${PLASTER.toFixed(4)}, vBrick.z));
  // the room side is plastered too, lighter and plain
  side = mix(side, vec3(0.58, 0.55, 0.5), step(vBrick.z, -0.4995));
  diffuseColor.rgb = mix(side, diffuseColor.rgb, brickOuter);
}`);
    if (facade) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= brickOuter;');
    }
  };
  material.userData.plaster = { value: new THREE.Color(0xd8d0c0) };
  material.customProgramCacheKey = () => (facade ? 'brick-facade' : 'brick-rubble');
  return material;
}

/** A unit box whose instances carry a brick tint and a facade UV patch. */
function brickGeometry(capacity, facade) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
  if (facade) {
    geo.setAttribute('aUvRect', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
  }
  return geo;
}

/** The geometry the rubble pool draws its bricks with: random tint per slot. */
export function rubbleGeometry(capacity) {
  const geo = brickGeometry(capacity, false);
  const v = geo.attributes.aVar.array;
  for (let i = 0; i < capacity; i++) v[i] = Math.random();
  geo.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1));
  return geo;
}

/**
 * A number in [0, 1) that depends only on where a brick is, so every
 * machine in a co-op room lays — and breaks — exactly the same wall.
 */
function luckAt(item, face, r, u) {
  let h = Math.imul(Math.round(item.x * 10) | 0, 73856093) ^
    Math.imul(Math.round(item.z * 10) | 0, 19349663) ^
    Math.imul(face + 1, 83492791) ^ Math.imul(r + 7, 2654435761) ^
    Math.imul(Math.round(u * 100) | 0, 40503);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class Masonry {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./rigid.js').RigidWorld} rubble where loose bricks go
   */
  constructor(scene, rubble) {
    this.scene = scene;
    this.rubble = rubble;
    /** Bricks standing in walls, across every facade. */
    this.capacity = QUALITY.masonry ?? 12000;
    this.total = 0;
    /** Set by Breakables: takes one facade cell out of its merged mesh. */
    this.hideCell = null;
    /** facade key -> the facade's own material, set by the game */
    this.facades = {};
    /** where clones go so they light up at night with the rest */
    this.nightList = null;
    /** One instanced layer per facade, made the first time it is needed. */
    this.layers = new Map();

    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  /**
   * @param {Record<string, THREE.MeshStandardMaterial>} materials facade
   *   materials by bucket key
   * @param {THREE.Material[]} [nightList] the list whose emissive is driven
   *   after dark
   */
  setFacades(materials, nightList) {
    this.facades = materials;
    this.nightList = nightList ?? null;
  }

  /** Room left for new bricks. */
  get room() {
    return this.capacity - this.total;
  }

  _layer(bucket) {
    let L = this.layers.get(bucket);
    if (L) return L;
    const src = this.facades[bucket];
    const cap = Math.max(800, Math.ceil(this.capacity * 0.6));
    const mat = brickMaterial(src ? src.clone() : new THREE.MeshStandardMaterial({ color: 0xd8d0c0 }), { facade: !!src?.map });
    mat.side = THREE.FrontSide;
    const pal = bucket === 'shop' ? { wall: '#8d8a84' } : facadePalette(bucket);
    mat.userData.plaster.value.set(pal.wall);
    if (src && this.nightList) this.nightList.push(mat);
    const mesh = new THREE.InstancedMesh(brickGeometry(cap, !!src?.map), mat, cap);
    mesh.name = `masonry-${bucket}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // scattered over however many buildings have been hit
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    L = { mesh, cap, used: 0, free: [], plaster: new THREE.Color(pal.wall).getHex(), facade: !!src?.map };
    this.layers.set(bucket, L);
    return L;
  }

  /**
   * Knocks a hole in a wall.
   *
   * @param {object} item the building
   * @param {object} wall one of its wall records
   * @param {number} u where along the wall it was hit, in metres
   * @param {object} blow `vx,vz,speed`
   * @param {{rx:number, ry:number, yc:number}} shape half-width and
   *   half-height of what the car takes out, and the height of its centre
   * @returns {{removed:number, from:number, to:number}|null} null when the
   *   wall could not be turned to brick (out of room), so the caller can
   *   fall back to the plain hole
   */
  strike(item, wall, u, blow, shape) {
    if (this.capacity <= 0) return null;
    const st = this._state(item, wall);
    const L = this._layer(wall.bucket ?? 'shop');
    const reach = shape.rx + 1.3;
    const c0 = Math.max(0, Math.floor((u - reach) / st.cw));
    const c1 = Math.min(st.cols - 1, Math.floor((u + reach) / st.cw));

    let need = 0;
    for (let c = c0; c <= c1; c++) if (!st.colOn[c]) need += st.perCol;
    if (need > this.room || need > L.cap - L.used + L.free.length) return null;
    for (let c = c0; c <= c1; c++) if (!st.colOn[c]) this._raise(item, wall, st, L, c);

    const falling = [];
    const minU = c0 * st.cw;
    const maxU = (c1 + 1) * st.cw;

    // ---- what the car itself takes out ---------------------------------
    for (let r = 0; r < st.rows; r++) {
      const y = (r + 0.5) * st.rowH;
      for (const b of st.byRow[r]) {
        if (!b.alive || b.u < minU || b.u > maxU) continue;
        const dx = (b.u - u) / shape.rx;
        const dy = (y - shape.yc) / shape.ry;
        const d = dx * dx + dy * dy;
        // a ragged edge: each brick's own bit of luck decides the borderline
        if (d < 1 + (b.luck - 0.5) * 0.45) {
          b.alive = false;
          falling.push({ b, y, hit: Math.max(0, 1 - Math.sqrt(d)) });
        }
      }
    }
    if (!falling.length) return { removed: 0, from: c0, to: c1 };

    // ---- and what comes down because of it -----------------------------
    for (let r = 0; r < st.rows; r++) {
      const row = st.byRow[r];
      const n = row.length;
      if (!n) continue;
      const sup = new Array(n);
      for (let i = 0; i < n; i++) {
        const b = row[i];
        if (!b.alive) continue;
        const h = b.len * 0.32;
        sup[i] = this._solid(st, r - 1, b.u - h) || this._solid(st, r - 1, b.u + h) ||
          this._solid(st, r - 1, b.u);
      }
      // distance, in bricks, from the nearest thing holding this one up
      const dl = new Array(n).fill(Infinity);
      const dr = new Array(n).fill(Infinity);
      for (let i = 0; i < n; i++) {
        const b = row[i];
        if (!b.alive) continue;
        if (sup[i]) { dl[i] = 0; continue; }
        const prev = row[i - 1];
        if (prev && Math.abs(prev.u + prev.len / 2 - (b.u - b.len / 2)) < 0.01) {
          if (prev.alive) dl[i] = dl[i - 1] + 1;
        } else if (this._solid(st, r, b.u - b.len / 2 - 0.05)) {
          dl[i] = 1;
        }
      }
      for (let i = n - 1; i >= 0; i--) {
        const b = row[i];
        if (!b.alive) continue;
        if (sup[i]) { dr[i] = 0; continue; }
        const next = row[i + 1];
        if (next && Math.abs(b.u + b.len / 2 - (next.u - next.len / 2)) < 0.01) {
          if (next.alive) dr[i] = dr[i + 1] + 1;
        } else if (this._solid(st, r, b.u + b.len / 2 + 0.05)) {
          dr[i] = 1;
        }
      }
      const y = (r + 0.5) * st.rowH;
      for (let i = 0; i < n; i++) {
        const b = row[i];
        if (!b.alive || sup[i]) continue;
        // mortar holds a brick out over a gap, a second one only sometimes
        const allow = b.luck > 0.78 ? 2 : 1;
        if (Math.min(dl[i], dr[i]) > allow) {
          b.alive = false;
          falling.push({ b, y, hit: 0 });
        }
      }
    }

    for (const f of falling) this._release(L, f.b);

    // ---- the ones that stayed, knocked out of true ---------------------
    for (let r = 0; r < st.rows; r++) {
      const y = (r + 0.5) * st.rowH;
      for (const b of st.byRow[r]) {
        if (!b.alive || b.u < minU || b.u > maxU) continue;
        const dx = (b.u - u) / (shape.rx + 0.9);
        const dy = (y - shape.yc) / (shape.ry + 1.1);
        const d = dx * dx + dy * dy;
        if (d >= 1) continue;
        const k = (1 - d) * (0.5 + b.luck);
        b.shove = (b.shove || 0) + k * 0.03;
        b.twist = (b.twist || 0) + (b.luck - 0.5) * k * 0.12;
        this._place(item, wall, st, L, b, r);
      }
    }
    L.mesh.instanceMatrix.needsUpdate = true;

    this._throw(item, wall, st, L, falling, blow);
    return { removed: falling.length, from: c0, to: c1 };
  }

  /** True when a column of a wall has been rebuilt in brick. */
  isBrick(wall, c) {
    return !!wall.masonry?.colOn[c];
  }

  /** The brick layout of one wall, made the first time it is struck. */
  _state(item, wall) {
    if (wall.masonry) return wall.masonry;
    const span = wall.face < 2 ? wall.hw * 2 : wall.hd * 2;
    const cols = wall.cols;
    const cw = span / cols;
    const rows = Math.max(2, Math.round(wall.bandH / COURSE));
    const perBrick = Math.max(2, Math.round(cw / BRICK));
    wall.masonry = {
      span, cols, cw, rows,
      rowH: wall.bandH / rows,
      perBrick,
      perCol: rows * (perBrick + 1),
      colOn: new Uint8Array(cols),
      byRow: Array.from({ length: rows }, () => [])
    };
    return wall.masonry;
  }

  /** Lays one column of the wall in brick and takes the facade there away. */
  _raise(item, wall, st, L, c) {
    st.colOn[c] = 1;
    for (let fr = 0; fr < wall.rows; fr++) {
      const n = fr * wall.cols + c;
      wall.bricked = wall.bricked || new Set();
      if (wall.bricked.has(n)) continue;
      wall.bricked.add(n);
      this.hideCell?.(wall, n, item);
    }

    const geo = L.mesh.geometry;
    const varA = geo.attributes.aVar;
    const uvA = geo.attributes.aUvRect;
    const len = st.cw / st.perBrick;
    const left = c * st.cw;
    for (let r = 0; r < st.rows; r++) {
      const row = st.byRow[r];
      const add = (a, l) => {
        const b = { u: a + l / 2, len: l, alive: true, idx: -1, luck: luckAt(item, wall.face, r, a + l / 2) };
        b.idx = this._alloc(L);
        varA.array[b.idx] = Math.random();
        if (uvA) {
          // the patch of facade this brick stands in for
          const texW = wall.texW ?? 13.6;
          const texH = wall.texH ?? 12;
          uvA.array[b.idx * 4] = a / texW;
          uvA.array[b.idx * 4 + 1] = (wall.v0 ?? 0) + (r * st.rowH) / texH;
          uvA.array[b.idx * 4 + 2] = l / texW;
          uvA.array[b.idx * 4 + 3] = st.rowH / texH;
        }
        this._place(item, wall, st, L, b, r);
        row.push(b);
      };
      if (r % 2 === 0) {
        for (let i = 0; i < st.perBrick; i++) add(left + i * len, len);
      } else {
        // running bond: every other course starts on a half brick
        add(left, len / 2);
        for (let i = 0; i < st.perBrick - 1; i++) add(left + len / 2 + i * len, len);
        add(left + st.cw - len / 2, len / 2);
      }
      row.sort((a, b) => a.u - b.u);
    }
    L.mesh.instanceMatrix.needsUpdate = true;
    varA.needsUpdate = true;
    if (uvA) uvA.needsUpdate = true;
  }

  /** True where course `r` has something solid at `u`. */
  _solid(st, r, u) {
    if (r < 0) return true;                          // the ground
    if (u < 0.02 || u > st.span - 0.02) return true; // the building's corner
    const c = Math.floor(u / st.cw);
    if (!st.colOn[c]) return true;                   // wall still whole there
    for (const b of st.byRow[r]) {
      if (Math.abs(b.u - u) <= b.len / 2) return b.alive;
    }
    return false;
  }

  /** Where a point on the wall is in the world. */
  _world(item, wall, u, y, inward, out) {
    const hw = wall.hw;
    const hd = wall.hd;
    let lx;
    let lz;
    if (wall.face === 0) { lx = -hw + u; lz = hd - inward; }
    else if (wall.face === 1) { lx = hw - u; lz = -hd + inward; }
    else if (wall.face === 2) { lx = hw - inward; lz = hd - u; }
    else { lx = -hw + inward; lz = -hd + u; }
    const yaw = item.rot ?? 0;
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    return out.set(
      item.x + lx * cs + lz * sn,
      item.y + (wall.baseY ?? 0) + y,
      item.z - lx * sn + lz * cs
    );
  }

  /**
   * The yaw that turns a brick's +Z (its skin) outwards and its +X along the
   * way the facade texture runs on this face.
   */
  _yaw(item, wall) {
    return (item.rot ?? 0) + [0, Math.PI, Math.PI / 2, -Math.PI / 2][wall.face];
  }

  _place(item, wall, st, L, b, r) {
    const y = (r + 0.5) * st.rowH;
    // flush with the facade, pushed out where it was shaken
    this._world(item, wall, b.u, y, THICK / 2 - 0.004 - (b.shove || 0), this._p);
    this._e.set((b.luck - 0.5) * (b.shove || 0) * 1.5, this._yaw(item, wall) + (b.twist || 0), 0);
    this._q.setFromEuler(this._e);
    // whole bricks overlap by a hair: the skin must read as one unbroken wall
    // until it breaks, with no hairline of the room behind showing through
    this._s.set(Math.max(0.02, b.len + 0.003), st.rowH + 0.003, THICK);
    this._m.compose(this._p, this._q, this._s);
    L.mesh.setMatrixAt(b.idx, this._m);
  }

  _alloc(L) {
    this.total++;
    if (L.free.length) return L.free.pop();
    const i = L.used++;
    L.mesh.count = L.used;
    return i;
  }

  _release(L, b) {
    if (b.idx < 0) return;
    L.mesh.setMatrixAt(b.idx, this._zero);
    L.free.push(b.idx);
    b.idx = -1;
    this.total--;
  }

  /** Hands the loose bricks to the rubble pool. */
  _throw(item, wall, st, L, falling, blow) {
    const rubble = this.rubble;
    if (!rubble) return;
    const speed = blow?.speed ?? 8;
    const vx = blow?.vx ?? 0;
    const vz = blow?.vz ?? 0;
    const vl = Math.hypot(vx, vz) || 1;
    const fx = vx / vl;
    const fz = vz / vl;

    // a hole bigger than the pool sends a sample of it: the rest is dust
    let list = falling;
    const budget = Math.floor(rubble.max * 0.9);
    if (list.length > budget) {
      list = list.slice();
      for (let i = list.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [list[i], list[j]] = [list[j], list[i]];
      }
      list.length = budget;
    }

    const yaw = this._yaw(item, wall);
    for (const f of list) {
      const b = f.b;
      this._world(item, wall, b.u, f.y, THICK / 2, this._p);
      // straight in front of the bumper they leave at most of the car's
      // speed; off to the side, or dropping out of the wall above, barely
      const push = f.hit > 0 ? speed * (0.25 + 0.6 * f.hit) * (0.6 + Math.random() * 0.5) : 0;
      // What the car threw stays a few seconds and then slowly dissolves;
      // of what dropped out of the wall above, some is gone before it lands
      // and the rest is left lying as a heap.
      let fadeAt;
      let fadeFor;
      if (f.hit > 0) {
        fadeAt = 2.5 + Math.random() * 3.5;
        fadeFor = 2.2 + Math.random() * 1.6;
      } else if (Math.random() < 0.45) {
        fadeAt = 0.1 + Math.random() * 0.45;
        fadeFor = 0.5 + Math.random() * 0.6;
      }
      rubble.spawn({
        x: this._p.x, y: this._p.y, z: this._p.z,
        hx: b.len / 2, hy: st.rowH / 2, hz: THICK / 2,
        yaw,
        colour: L.plaster,
        mass: 4.2 * (b.len / BRICK),
        fadeAt,
        fadeFor,
        restitution: 0.12,
        friction: 0.82,
        vx: fx * push + (Math.random() - 0.5) * (0.6 + f.hit * 3),
        vy: f.hit > 0 ? 0.4 + Math.random() * 2.6 * f.hit : -0.2,
        vz: fz * push + (Math.random() - 0.5) * (0.6 + f.hit * 3),
        sx: (Math.random() - 0.5) * (1.5 + f.hit * 12),
        sy: (Math.random() - 0.5) * (1 + f.hit * 8),
        sz: (Math.random() - 0.5) * (1.5 + f.hit * 12)
      });
    }
  }
}
