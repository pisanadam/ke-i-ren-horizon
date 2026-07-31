import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

/** Four side walls of a box, UV-mapped so the facade texture tiles per floor. */
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

  const quad = (a, b, c, dd, n, u1, vTop, vBot) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...dd);
    nor.push(...n, ...n, ...n, ...n);
    uv.push(0, vBot, u1, vBot, u1, vTop, 0, vTop);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  // +Z
  quad([-hw, 0, hd], [hw, 0, hd], [hw, h, hd], [-hw, h, hd], [0, 0, 1], uW, v1, v0);
  // -Z
  quad([hw, 0, -hd], [-hw, 0, -hd], [-hw, h, -hd], [hw, h, -hd], [0, 0, -1], uW, v1, v0);
  // +X
  quad([hw, 0, hd], [hw, 0, -hd], [hw, h, -hd], [hw, h, hd], [1, 0, 0], uD, v1, v0);
  // -X
  quad([-hw, 0, -hd], [-hw, 0, hd], [-hw, h, hd], [-hw, h, -hd], [-1, 0, 0], uD, v1, v0);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
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
  const group = new THREE.Group();
  group.name = 'buildings';

  const facadeGeos = {};
  for (const k of FACADE_KEYS) facadeGeos[k] = [];
  const shopGeos = [];
  const roofGeos = [];
  const detailGeos = [];

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
          facadeGeos[key].push(body);

          // pitched roof
          const roofH = randRange(rng, 1.6, 2.8);
          const roof = new THREE.CylinderGeometry(0, 1, 1, 4, 1);
          roof.scale((w * 0.7) / Math.SQRT2 * 1.06, roofH, (depth * 0.72) / Math.SQRT2 * 1.06);
          roof.rotateY(Math.PI / 4);
          roof.translate(0, hh + roofH / 2, 0);
          roof.applyMatrix4(mtx);
          detailGeos.push(colouredGeo(roof, rng() > 0.4 ? 0x9a4a35 : 0x7a5647));

          colliders.add(cx, cz, (w * 0.7) / 2, (depth * 0.72) / 2, rot);
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

        if (hasShops) {
          const shop = wallBox(wSnap + 0.7, SHOP_H, dSnap + 0.7, SHOP_TEX_W, SHOP_H);
          shop.applyMatrix4(mtx);
          shopGeos.push(shop);
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
        facadeGeos[key].push(body);

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

        colliders.add(cx, cz, wSnap / 2, dSnap / 2, rot);
        remember(cx, cz, Math.max(wSnap, dSnap) * 0.52);
        placed.push({ x: cx, z: cz, w: wSnap, d: dSnap, h: baseY + bodyH, rot });
        count++;
        s += step;
      }
    }
  }

  // ---------------------------------------------------------------- meshes
  const addMerged = (geos, mat, name) => {
    const valid = geos.filter(Boolean);
    if (!valid.length) return null;
    const merged = mergeGeometries(valid, false);
    valid.forEach((g) => g.dispose());
    if (!merged) return null;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    return mesh;
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
    addMerged(facadeGeos[key], mat, `facade-${key}`);
  });

  const shopTex = shopTexture(2);
  const shopMat = new THREE.MeshStandardMaterial({
    map: shopTex.map,
    emissiveMap: shopTex.emissiveMap,
    emissive: new THREE.Color(0x000000),
    roughness: 0.75,
    metalness: 0.05
  });
  addMerged(shopGeos, shopMat, 'shops');

  addMerged(
    roofGeos,
    new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.95 }),
    'roofs'
  );
  addMerged(
    detailGeos,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    'roof-details'
  );

  return { group, count, nightMaterials: [...facadeMats, shopMat], placed };
}
