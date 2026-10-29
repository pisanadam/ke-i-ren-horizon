import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeByTile, instanceByTile } from './tiles.js';
import { facadeTexture, shopTexture, roofTexture, FACADE_KEYS } from '../textures.js';
import { LANDMARKS, MAP, DISTRICT_GRIDS } from './mapData.js';
import { makeRng, clamp, randRange, randPick } from '../util/math.js';
import { QUALITY } from '../quality.js';

const BAY = 3.4;          // facade texture cell width in metres
const FLOOR = 3.0;        // facade texture cell height in metres
const TEX_W = BAY * 4;
const TEX_H = FLOOR * 4;
const SHOP_H = 4.2;
const SHOP_TEX_W = 24;

/** How tall the knockable band at the foot of a wall is, and how wide a cell. */
const BAND_H = 4.4;
const CELL_W = 2.2;

/** A balcony: two bays wide, hung off the wall at floor level. */
const BALC_W = BAY * 2 - 0.5;
const BALC_D = 1.25;
const BALCONY_TINTS = [0xffffff, 0xf3e6d6, 0xe3ece6, 0xf0dfdf, 0xe6e4f0, 0xfaf3dc];

/**
 * One balcony, outward along +Z from a wall at z = 0: a concrete slab, a
 * solid parapet across the front and down both sides. Every apartment's
 * balconies share this and are drawn instanced, tile by tile.
 */
function balconyGeometry() {
  const parts = [];
  const box = (w, h, d, x, y, z, colour) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(colouredGeo(g, colour));
  };
  const slab = 0.16;
  const ph = 1.0;
  box(BALC_W, slab, BALC_D, 0, slab / 2, BALC_D / 2, 0x9c9890);
  box(BALC_W, ph, 0.1, 0, slab + ph / 2, BALC_D - 0.05, 0xe2ddd2);
  box(0.1, ph, BALC_D - 0.1, -BALC_W / 2 + 0.05, slab + ph / 2, (BALC_D - 0.1) / 2, 0xe2ddd2);
  box(0.1, ph, BALC_D - 0.1, BALC_W / 2 - 0.05, slab + ph / 2, (BALC_D - 0.1) / 2, 0xe2ddd2);
  // the handrail capping the parapet
  box(BALC_W + 0.06, 0.06, 0.16, 0, slab + ph + 0.03, BALC_D - 0.05, 0x4a4c4f);
  const geo = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return geo;
}

/**
 * Four side walls of a box, UV-mapped so the facade texture tiles per floor.
 *
 * The bottom four and a half metres of each wall — everything a car can
 * physically reach — is laid out as a grid of small quads instead of one big
 * one. That is what makes a hole possible: driving into a wall takes out the
 * two-by-two block of cells you hit and leaves the rest of the building
 * standing. Above the band the wall is a single quad, because nothing up
 * there is ever going to be hit by a car.
 *
 * The whole city's facades come to about thirty thousand triangles, so
 * splitting the reachable strip costs very little, and the tiling means only
 * the few blocks around you are ever drawn.
 *
 * The layout is recorded on `geo.userData.walls` so a breach can find the
 * exact vertices of one cell later.
 */
function wallBox(w, h, d, texW, texH, vOffset = 0) {
  const hw = w / 2;
  const hd = d / 2;
  const uW = w / texW;
  const uD = d / texW;
  const vH = h / texH;
  const v0 = vOffset;
  const v1 = vOffset + vH;

  const pos = [];
  const uv = [];
  const nor = [];
  const idx = [];

  /** One quad, from corners given anticlockwise seen from outside. */
  const quad = (a, b, c, dd, n, uA, uB, vBot, vTop) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...dd);
    nor.push(...n, ...n, ...n, ...n);
    uv.push(uA, vBot, uB, vBot, uB, vTop, uA, vTop);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return base;
  };

  const bandH = Math.min(h, BAND_H);
  const rows = h > 1.2 ? 2 : 1;
  const walls = [];

  /**
   * @param {(t:number, y:number)=>number[]} at point on the wall, `t` running
   *   0..1 along it in the direction the texture runs
   */
  const face = (index, n, uSpan, at) => {
    const cols = Math.max(1, Math.round(uSpan * texW / CELL_W));
    // texW/texH/v0 let the brick layer map the same facade onto its bricks
    const rec = { face: index, cols, rows, bandH, cells: [], upper: null, hw, hd, texW, texH, v0 };

    // the reachable band, bottom row first
    for (let r = 0; r < rows; r++) {
      const y0 = (bandH * r) / rows;
      const y1 = (bandH * (r + 1)) / rows;
      for (let c = 0; c < cols; c++) {
        const t0 = c / cols;
        const t1 = (c + 1) / cols;
        const start = quad(
          at(t0, y0), at(t1, y0), at(t1, y1), at(t0, y1), n,
          t0 * uSpan, t1 * uSpan,
          v0 + (y0 / h) * (v1 - v0), v0 + (y1 / h) * (v1 - v0)
        );
        rec.cells.push(start);
      }
    }

    // everything above it, in one piece
    if (h > bandH + 0.05) {
      rec.upper = quad(
        at(0, bandH), at(1, bandH), at(1, h), at(0, h), n,
        0, uSpan,
        v0 + (bandH / h) * (v1 - v0), v1
      );
    }
    walls.push(rec);
  };

  face(0, [0, 0, 1], uW, (t, y) => [-hw + t * w, y, hd]);
  face(1, [0, 0, -1], uW, (t, y) => [hw - t * w, y, -hd]);
  face(2, [1, 0, 0], uD, (t, y) => [hw, y, hd - t * d]);
  face(3, [-1, 0, 0], uD, (t, y) => [-hw, y, -hd + t * d]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.userData.walls = walls;
  return geo;
}

function colouredGeo(geo, colour) {
  const c = new THREE.Color(colour);
  const arr = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < geo.attributes.position.count; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * Fills the blocks along every street with Ankara-style apartment stock:
 * 4-10 storey blocks with balconies and ground-floor shops on the main roads,
 * low pitched-roof houses on the steeper slopes.
 */
export function buildBuildings(network, ground, colliders) {
  const rng = makeRng(776655);
  // Where every building's walls end up. `wallBox` lays down four quads of
  // four vertices in a fixed order, so a single face can be found and taken
  // out later. The mesh a wall lands in is not known until the tiling runs,
  // so what is remembered here is the geometry's place in the source list.
  const breakables = [];
  const track = (bucket, list, geo) => {
    list.push(geo);
    return list.length - 1;
  };
  const group = new THREE.Group();
  group.name = 'buildings';

  const facadeGeos = {};
  for (const k of FACADE_KEYS) facadeGeos[k] = [];
  const shopGeos = [];
  const roofGeos = [];
  const detailGeos = [];
  const balconies = [];

  const placed = [];
  const placedCells = new Map();
  const PCELL = 26;
  const cellKey = (x, z) => Math.floor(x / PCELL) * 100003 + Math.floor(z / PCELL);

  const tooClose = (x, z, r) => {
    const gx = Math.floor(x / PCELL);
    const gz = Math.floor(z / PCELL);
    for (let ix = gx - 1; ix <= gx + 1; ix++) {
      for (let iz = gz - 1; iz <= gz + 1; iz++) {
        const arr = placedCells.get(ix * 100003 + iz);
        if (!arr) continue;
        for (const p of arr) {
          if (Math.hypot(p.x - x, p.z - z) < p.r + r) return true;
        }
      }
    }
    return false;
  };

  const remember = (x, z, r) => {
    const k = cellKey(x, z);
    let arr = placedCells.get(k);
    if (!arr) placedCells.set(k, (arr = []));
    arr.push({ x, z, r });
  };

  const inLandmark = (x, z) =>
    LANDMARKS.some((l) => Math.hypot(x - l.x, z - l.z) < l.radius);

  // How tall the neighbourhood builds. Ankara is not one blob: each district
  // has its own core that tapers off into empty hillside, so height follows
  // the distance to the nearest built-up area rather than to the map centre.
  const density = (x, z) => {
    let best = 0;
    for (const g of DISTRICT_GRIDS) {
      const dx = Math.abs(x - g.x) / (g.w * 0.5 + 340);
      const dz = Math.abs(z - g.z) / (g.h * 0.5 + 340);
      const d = Math.max(dx, dz);
      if (d >= 1) continue;
      // the middle of a district is solid, the fringe thins out
      best = Math.max(best, 1 - d * d);
    }
    return best;
  };

  const mtx = new THREE.Matrix4();
  const rotM = new THREE.Matrix4();
  const posM = new THREE.Matrix4();
  let count = 0;
  const MAX = QUALITY.buildings;

  // Shuffled, so the budget spreads over the whole city instead of being
  // spent entirely on whichever district happens to be first in the list.
  const order = network.edges.map((e, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  for (const ei of order) {
    const edge = network.edges[ei];
    if (count >= MAX) break;
    if (edge.type === 'highway') continue;
    const hw = edge.width * 0.5;
    const walk = edge.major ? 4.0 : 3.0;
    const cum = edge.cum;
    const total = edge.length;
    if (total < 26) continue;

    const at = (s) => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / Math.max(1e-4, cum[i] - cum[i - 1]);
      const a = edge.path[i - 1];
      const b = edge.path[i];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        dx, dz, rx: dz, rz: -dx
      };
    };

    for (let side = -1; side <= 1; side += 2) {
      let s = randRange(rng, 10, 24);
      while (s < total - 12 && count < MAX) {
        const p = at(s);
        const dens = density(p.x, p.z);
        // motorways crossing the hills between districts stay empty
        if (dens < 0.05 || rng() > 0.25 + dens * 0.9) { s += 30; continue; }

        // ---- pick a footprint --------------------------------------------
        const wide = rng() < 0.35 + dens * 0.3;
        const w = wide ? randRange(rng, 16, 26) : randRange(rng, 10, 16);
        const depth = randRange(rng, 11, 17);
        const setback = randRange(rng, 1.5, 5.5);
        const offset = hw + 0.4 + walk + setback + depth / 2;

        const cx = p.x + p.rx * side * offset;
        const cz = p.z + p.rz * side * offset;
        const step = w + randRange(rng, 3, 9);

        const ok =
          Math.abs(cx) < MAP.half - 20 &&
          Math.abs(cz) < MAP.half - 20 &&
          !inLandmark(cx, cz) &&
          !tooClose(cx, cz, Math.max(w, depth) * 0.52);

        if (!ok) { s += step; continue; }

        const near = network.nearestRoad(cx, cz);
        if (!near || near.dist < near.halfWidth + 4.5) { s += step; continue; }
        // metro piers and station stairs are already down; do not build over them
        const facing = Math.atan2(p.dx, p.dz);
        if (colliders.overlaps(cx, cz, w * 0.5, depth * 0.5, facing, 1.5)) { s += step; continue; }

        const slope = ground.slopeAt(cx, cz, 8);
        if (slope > 0.34) { s += step; continue; }

        const gy = ground.heightAt(cx, cz);
        const rot = Math.atan2(p.dx, p.dz);

        rotM.makeRotationY(rot);
        posM.makeTranslation(cx, gy, cz);
        mtx.copy(posM).multiply(rotM);

        // ---- low-rise house on the steeper, outer slopes -----------------
        const lowRise = slope > 0.19 || dens < 0.22 || rng() < 0.08;

        if (lowRise) {
          const hh = randRange(rng, 3.2, 7.2);
          const key = randPick(rng, FACADE_KEYS);
          const body = wallBox(w * 0.7, hh, depth * 0.72, TEX_W, TEX_H);
          body.applyMatrix4(mtx);
          const bIdx = track(key, facadeGeos[key], body);
          const houseWalls = body.userData.walls.map((rec) => ({
            ...rec, geoIndex: bIdx, bucket: key
          }));

          // pitched roof
          const roofH = randRange(rng, 1.6, 2.8);
          const roof = new THREE.CylinderGeometry(0, 1, 1, 4, 1);
          roof.scale((w * 0.7) / Math.SQRT2 * 1.06, roofH, (depth * 0.72) / Math.SQRT2 * 1.06);
          roof.rotateY(Math.PI / 4);
          roof.translate(0, hh + roofH / 2, 0);
          roof.applyMatrix4(mtx);
          detailGeos.push(colouredGeo(roof, rng() > 0.4 ? 0x9a4a35 : 0x7a5647));

          breakables.push({
            kind: 'bina', x: cx, y: gy, z: cz, rot,
            detail: {
              key, house: true, baseY: 0, top: hh, floors: Math.max(1, Math.round(hh / FLOOR)),
              hw: (w * 0.7) / 2, hd: (depth * 0.72) / 2, street: side > 0 ? 3 : 2, shops: false
            },
            height: hh, hw: (w * 0.7) / 2, hd: (depth * 0.72) / 2,
            wallW: w * 0.7, wallZ: 0, colour: 0xc2bcae,
            walls: houseWalls, bucket: key,
            box: colliders.add(cx, cz, (w * 0.7) / 2, (depth * 0.72) / 2, rot)
          });
          // the plot is levelled to the floor, not left as a slope under it
          ground.addPad?.(cx, cz, (w * 0.7) / 2 + 0.4, (depth * 0.72) / 2 + 0.4, rot, gy);
          remember(cx, cz, Math.max(w, depth) * 0.52);
          placed.push({ x: cx, z: cz, w: w * 0.7, d: depth * 0.72, h: hh, rot });
          count++;
          s += step;
          continue;
        }

        // ---- apartment block ---------------------------------------------
        const maxFloors = edge.major ? 11 : 8;
        const minFloors = edge.major ? 4 : 3;
        let floors = Math.round(
          minFloors + (maxFloors - minFloors) * dens * randRange(rng, 0.55, 1.15)
        );
        floors = clamp(floors, 2, 12);

        const hasShops = (edge.major || edge.type === 'main') && rng() < 0.72;
        const bodyH = floors * FLOOR;
        const baseY = hasShops ? SHOP_H : 0;

        // snap the plan to whole facade bays so windows line up
        const wSnap = Math.max(BAY * 3, Math.round(w / BAY) * BAY);
        const dSnap = Math.max(BAY * 3, Math.round(depth / BAY) * BAY);

        const blockWalls = [];
        if (hasShops) {
          const shop = wallBox(wSnap + 0.7, SHOP_H, dSnap + 0.7, SHOP_TEX_W, SHOP_H);
          shop.applyMatrix4(mtx);
          const sIdx = track('shop', shopGeos, shop);
          for (const rec of shop.userData.walls) {
            blockWalls.push({ ...rec, geoIndex: sIdx, bucket: 'shop' });
          }
          // shop canopy
          const canopy = new THREE.BoxGeometry(wSnap + 2.4, 0.28, dSnap + 2.4);
          canopy.translate(0, SHOP_H + 0.14, 0);
          canopy.applyMatrix4(mtx);
          detailGeos.push(colouredGeo(canopy, 0x8d8b85));
        }

        const key = randPick(rng, FACADE_KEYS);
        const body = wallBox(wSnap, bodyH, dSnap, TEX_W, TEX_H, rng() > 0.5 ? 0 : 0.5);
        body.translate(0, baseY, 0);
        body.applyMatrix4(mtx);
        const bIdx = track(key, facadeGeos[key], body);
        for (const rec of body.userData.walls) {
          blockWalls.push({ ...rec, geoIndex: bIdx, bucket: key, baseY });
        }

        // roof slab
        const slab = new THREE.BoxGeometry(wSnap + 0.5, 0.4, dSnap + 0.5);
        slab.translate(0, baseY + bodyH + 0.2, 0);
        slab.applyMatrix4(mtx);
        roofGeos.push(slab);

        // parapet
        const topY = baseY + bodyH + 0.4;
        const pH = 0.85;
        const par = [
          new THREE.BoxGeometry(wSnap + 0.5, pH, 0.25),
          new THREE.BoxGeometry(wSnap + 0.5, pH, 0.25),
          new THREE.BoxGeometry(0.25, pH, dSnap + 0.5),
          new THREE.BoxGeometry(0.25, pH, dSnap + 0.5)
        ];
        par[0].translate(0, topY + pH / 2, dSnap / 2 + 0.12);
        par[1].translate(0, topY + pH / 2, -dSnap / 2 - 0.12);
        par[2].translate(wSnap / 2 + 0.12, topY + pH / 2, 0);
        par[3].translate(-wSnap / 2 - 0.12, topY + pH / 2, 0);
        par.forEach((g) => { g.applyMatrix4(mtx); detailGeos.push(colouredGeo(g, 0xb3aea3)); });

        // rooftop clutter: water tanks, stair head, dishes, solar panels
        const tanks = 1 + Math.floor(rng() * 3);
        for (let t = 0; t < tanks; t++) {
          const tr = randRange(rng, 0.5, 0.8);
          const th = randRange(rng, 0.9, 1.5);
          const g = new THREE.CylinderGeometry(tr, tr, th, 8);
          g.translate(
            randRange(rng, -wSnap / 2 + 1.5, wSnap / 2 - 1.5),
            topY + th / 2,
            randRange(rng, -dSnap / 2 + 1.5, dSnap / 2 - 1.5)
          );
          g.applyMatrix4(mtx);
          detailGeos.push(colouredGeo(g, rng() > 0.45 ? 0xe4e2da : 0x2f3238));
        }
        {
          const sw = randRange(rng, 2.4, 3.4);
          const g = new THREE.BoxGeometry(sw, 2.4, sw);
          g.translate(randRange(rng, -2, 2), topY + 1.2, randRange(rng, -2, 2));
          g.applyMatrix4(mtx);
          detailGeos.push(colouredGeo(g, 0xbfb9ac));
        }
        if (rng() > 0.5) {
          const g = new THREE.SphereGeometry(0.55, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
          g.rotateX(Math.PI * 0.85);
          g.translate(randRange(rng, -wSnap / 3, wSnap / 3), topY + 0.9, randRange(rng, -dSnap / 3, dSnap / 3));
          g.applyMatrix4(mtx);
          detailGeos.push(colouredGeo(g, 0xd8d5cc));
        }
        if (rng() > 0.72) {
          const g = new THREE.BoxGeometry(2.6, 0.1, 1.5);
          g.rotateX(-0.35);
          g.translate(randRange(rng, -wSnap / 3, wSnap / 3), topY + 0.6, randRange(rng, -dSnap / 3, dSnap / 3));
          g.applyMatrix4(mtx);
          detailGeos.push(colouredGeo(g, 0x1d2a46));
        }

        // Balconies on the street side, stacked floor over floor in the same
        // bays — corner pairs on a long front, one in the middle otherwise.
        // Their own generator, so adding them moves nothing else in the city.
        {
          const brng = makeRng(4049 + count * 131);
          if (QUALITY.balconies !== false && floors >= 3 && brng() < 0.82) {
            const face = side > 0 ? 3 : 2;
            const bays = Math.round(dSnap / BAY);
            const ks = bays >= 5 && QUALITY.tier !== 'mobile' ? [1, bays - 1] : [Math.floor(bays / 2)];
            const tint = BALCONY_TINTS[Math.floor(brng() * BALCONY_TINTS.length)];
            const hwB = wSnap / 2;
            const hdB = dSnap / 2;
            const cs = Math.cos(rot);
            const sn = Math.sin(rot);
            for (let f = 1; f < floors; f++) {
              for (const k of ks) {
                const u = k * BAY;
                const lx = face === 3 ? -hwB : hwB;
                const lz = face === 3 ? -hdB + u : hdB - u;
                balconies.push({
                  x: cx + lx * cs + lz * sn,
                  y: gy + baseY + f * FLOOR,
                  z: cz - lx * sn + lz * cs,
                  yaw: rot + (face === 3 ? -Math.PI / 2 : Math.PI / 2),
                  tint
                });
              }
            }
          }
        }

        breakables.push({
          kind: 'bina', x: cx, y: gy, z: cz, rot,
          detail: {
            key, house: false, baseY, top: baseY + bodyH, floors,
            hw: wSnap / 2, hd: dSnap / 2, street: side > 0 ? 3 : 2, shops: hasShops
          },
          height: baseY + bodyH, hw: wSnap / 2, hd: dSnap / 2,
          wallW: wSnap, wallZ: 0, colour: 0xb9b3a6,
          walls: blockWalls,
          box: colliders.add(cx, cz, wSnap / 2, dSnap / 2, rot)
        });
        ground.addPad?.(cx, cz, wSnap / 2 + (hasShops ? 0.75 : 0.4), dSnap / 2 + (hasShops ? 0.75 : 0.4), rot, gy);
        remember(cx, cz, Math.max(wSnap, dSnap) * 0.52);
        placed.push({ x: cx, z: cz, w: wSnap, d: dSnap, h: baseY + bodyH, rot });
        count++;
        s += step;
      }
    }
  }

  // ---------------------------------------------------------------- meshes
  const sets = {};
  const addMerged = (geos, mat, name) => {
    const set = mergeByTile(geos, mat, name);
    group.add(set.group);
    return set;
  };

  const facadeMats = [];
  FACADE_KEYS.forEach((key, i) => {
    const tex = facadeTexture(key, i);
    const mat = new THREE.MeshStandardMaterial({
      map: tex.map,
      emissiveMap: tex.emissiveMap,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 1,
      roughness: 0.9,
      metalness: 0.02
    });
    facadeMats.push(mat);
    sets[key] = addMerged(facadeGeos[key], mat, `facade-${key}`);
  });

  const shopTex = shopTexture(2);
  const shopMat = new THREE.MeshStandardMaterial({
    map: shopTex.map,
    emissiveMap: shopTex.emissiveMap,
    emissive: new THREE.Color(0x000000),
    roughness: 0.75,
    metalness: 0.05
  });
  sets.shop = addMerged(shopGeos, shopMat, 'shops');

  sets.roof = addMerged(
    roofGeos,
    new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.95 }),
    'roofs'
  );
  sets.detail = addMerged(
    detailGeos,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    'roof-details'
  );

  if (balconies.length) {
    const tint = new THREE.Color();
    sets.balconies = instanceByTile(
      balconies,
      balconyGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 }),
      'balconies',
      (b, i, d) => {
        d.position.set(b.x, b.y, b.z);
        d.rotation.set(0, b.yaw, 0);
        d.scale.set(1, 1, 1);
        return tint.setHex(b.tint);
      }
    );
    for (const t of sets.balconies.tiles) t.mesh.receiveShadow = true;
    group.add(sets.balconies.group);
  }

  // Resolve every wall to the tile mesh it ended up in and its offset there.
  // A wall whose tile came out empty is simply not breakable.
  for (const b of breakables) {
    b.walls = b.walls.filter((w) => {
      const at = sets[w.bucket]?.placed[w.geoIndex];
      if (!at || !at.mesh) return false;
      w.mesh = at.mesh;
      // cell offsets were recorded relative to the wall box; shift them to
      // where that box actually landed inside its tile's buffer
      w.cells = w.cells.map((c) => at.start + c);
      if (w.upper !== null) w.upper = at.start + w.upper;
      w.start = w.cells[0];
      return true;
    });
    b.mesh = b.walls[0]?.mesh ?? null;
  }

  return {
    group,
    count,
    nightMaterials: [...facadeMats, shopMat],
    // by the key each wall records, so the brick layer can wear the same skin
    bucketMaterials: Object.fromEntries([...FACADE_KEYS.map((k, i) => [k, facadeMats[i]]), ['shop', shopMat]]),
    materials: [...facadeMats, shopMat],
    tileSets: Object.values(sets),
    breakables: breakables.filter((b) => b.walls.length),
    placed
  };
}
