import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asphaltTexture, sidewalkTexture } from '../textures.js';
import { baseHeight } from './heightfield.js';
import { lerp } from '../util/math.js';

/**
 * Builds every drivable surface: carriageways, junction plates, kerbs,
 * pavements, lane markings and zebra crossings.
 */

/** Sub-path between two arc-length positions, resampled with the ends kept. */
function trimPath(path, cum, startTrim, endTrim) {
  const total = cum[cum.length - 1];
  const s0 = Math.min(startTrim, total * 0.45);
  const s1 = Math.max(total - endTrim, total * 0.55);
  if (s1 <= s0) return null;

  const sample = (s) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / Math.max(1e-4, cum[i] - cum[i - 1]);
    return {
      x: lerp(path[i - 1].x, path[i].x, t),
      y: lerp(path[i - 1].y, path[i].y, t),
      z: lerp(path[i - 1].z, path[i].z, t)
    };
  };

  const out = [sample(s0)];
  for (let i = 0; i < path.length; i++) {
    if (cum[i] > s0 + 0.5 && cum[i] < s1 - 0.5) out.push(path[i]);
  }
  out.push(sample(s1));
  return out.length >= 2 ? out : null;
}

/** Unit "right of travel" vector at each point, mitred at the joints. */
function frames(path) {
  const out = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    out.push({ rx: dz, rz: -dx, fx: dx, fz: dz });
  }
  return out;
}

/**
 * Ribbon along a path. `left`/`right` are offsets in metres from the centre
 * (negative = left of travel). `rise` lifts the strip above the centreline.
 */
function ribbon(path, left, right, rise, uvLen = 8, uvWide = 8, leftRise = 0, rightRise = 0) {
  if (path.length < 2) return null;
  const fr = frames(path);
  const verts = [];
  const uvs = [];
  const idx = [];
  let dist = 0;

  for (let i = 0; i < path.length; i++) {
    if (i > 0) dist += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    const p = path[i];
    const f = fr[i];
    verts.push(p.x + f.rx * left, p.y + rise + leftRise, p.z + f.rz * left);
    verts.push(p.x + f.rx * right, p.y + rise + rightRise, p.z + f.rz * right);
    uvs.push(left / uvWide, dist / uvLen);
    uvs.push(right / uvWide, dist / uvLen);
  }
  for (let i = 0; i < path.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Flat quad centred on (x,z) with a heading, used for markings. */
function stripe(x, y, z, dirX, dirZ, length, width) {
  const rx = dirZ;
  const rz = -dirX;
  const hl = length * 0.5;
  const hw = width * 0.5;
  const verts = [
    x - dirX * hl - rx * hw, y, z - dirZ * hl - rz * hw,
    x + dirX * hl - rx * hw, y, z + dirZ * hl - rz * hw,
    x - dirX * hl + rx * hw, y, z - dirZ * hl + rz * hw,
    x + dirX * hl + rx * hw, y, z + dirZ * hl + rz * hw
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  return geo;
}

function junctionPlate(node, radius, y) {
  const geo = new THREE.CircleGeometry(radius, 14);
  geo.rotateX(-Math.PI / 2);
  geo.translate(node.x, y, node.z);
  // scale UVs so the asphalt keeps a consistent grain
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * radius * 0.25, uv.getY(i) * radius * 0.25);
  }
  return geo;
}

/**
 * Embankment hanging off the outer edge of a road, down to the hillside.
 * Where a carriageway is built up over falling ground this is what stops you
 * seeing daylight underneath it.
 */
function embankment(path, offset, side, rise) {
  if (path.length < 2) return null;
  const fr = frames(path);
  const verts = [];
  const uvs = [];
  const idx = [];
  let dist = 0;
  let anyDrop = false;

  for (let i = 0; i < path.length; i++) {
    if (i > 0) dist += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    const p = path[i];
    const f = fr[i];
    const ox = p.x + f.rx * offset * side;
    const oz = p.z + f.rz * offset * side;
    const top = p.y + rise;
    const outX = ox + f.rx * side * 2.2;
    const outZ = oz + f.rz * side * 2.2;
    const ground = Math.min(baseHeight(outX, outZ), baseHeight(ox, oz)) - 0.5;
    const bottom = Math.min(top - 0.05, ground);
    if (top - bottom > 0.35) anyDrop = true;

    verts.push(ox, top, oz);
    verts.push(outX, bottom, outZ);
    uvs.push(0, dist / 4, 1, dist / 4);
  }
  if (!anyDrop) return null;

  for (let i = 0; i < path.length - 1; i++) {
    const a = i * 2;
    if (side > 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function buildRoads(network) {
  const group = new THREE.Group();
  group.name = 'roads';

  const surfaces = [];
  const walks = [];
  const kerbs = [];
  const marks = [];
  const banks = [];

  // junction radius per node, so edges can be trimmed back to meet it
  const nodeRadius = new Map();
  for (const node of network.nodes) {
    if (node.edges.length < 2) continue;
    let maxHW = 0;
    let maxLayer = 0;
    for (const id of node.edges) {
      const e = network.edges[id];
      maxHW = Math.max(maxHW, e.width * 0.5);
      maxLayer = Math.max(maxLayer, e.layer);
    }
    nodeRadius.set(node.id, { r: maxHW * 1.28 + 1.2, layer: maxLayer });
  }

  for (const edge of network.edges) {
    const hw = edge.width * 0.5;
    const y = edge.layer;
    const ra = nodeRadius.get(edge.a);
    const rb = nodeRadius.get(edge.b);
    const trimA = ra ? Math.max(0, ra.r - 1.0) : 0;
    const trimB = rb ? Math.max(0, rb.r - 1.0) : 0;

    // carriageway (full length so it tucks under the junction plate)
    const road = ribbon(edge.path, -hw, hw, y, 9, 9);
    if (road) surfaces.push(road);

    const trimmed = trimPath(edge.path, edge.cum, trimA, trimB);

    // kerbs + pavements, only on ordinary streets (not the ring road)
    if (edge.type !== 'highway' && trimmed) {
      const walkW = edge.major ? 4.0 : 3.0;
      const kerbTop = y + 0.16;
      const kerbL = ribbon(trimmed, -hw - 0.4, -hw, y, 4, 4, 0.16, 0);
      const kerbR = ribbon(trimmed, hw, hw + 0.4, y, 4, 4, 0, 0.16);
      const faceL = ribbon(trimmed, -hw - 0.4, -hw - 0.4, y, 4, 4, 0.16, 0);
      const faceR = ribbon(trimmed, hw + 0.4, hw + 0.4, y, 4, 4, 0, 0.16);
      if (kerbL) kerbs.push(kerbL);
      if (kerbR) kerbs.push(kerbR);
      if (faceL) kerbs.push(faceL);
      if (faceR) kerbs.push(faceR);

      const wl = ribbon(trimmed, -hw - 0.4 - walkW, -hw - 0.4, kerbTop, 4, 4);
      const wr = ribbon(trimmed, hw + 0.4, hw + 0.4 + walkW, kerbTop, 4, 4);
      if (wl) walks.push(wl);
      if (wr) walks.push(wr);

      const outer = hw + 0.4 + walkW;
      banks.push(embankment(edge.path, outer, 1, y + 0.16));
      banks.push(embankment(edge.path, outer, -1, y + 0.16));
    }
    if (edge.type === 'highway') {
      banks.push(embankment(edge.path, hw + 0.6, 1, y));
      banks.push(embankment(edge.path, hw + 0.6, -1, y));
    }

    // lane markings
    if (trimmed && edge.marks !== 'none') {
      const my = y + 0.015;
      const cum = [0];
      for (let i = 0; i < trimmed.length - 1; i++) {
        cum.push(cum[i] + Math.hypot(trimmed[i + 1].x - trimmed[i].x, trimmed[i + 1].z - trimmed[i].z));
      }
      const total = cum[cum.length - 1];

      const at = (s) => {
        let i = 1;
        while (i < cum.length - 1 && cum[i] < s) i++;
        const t = (s - cum[i - 1]) / Math.max(1e-4, cum[i] - cum[i - 1]);
        const a = trimmed[i - 1];
        const b = trimmed[i];
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        return {
          x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t),
          dx: dx / len, dz: dz / len
        };
      };

      // dashed centre line
      for (let s = 3; s < total - 3; s += 11) {
        const p = at(s);
        marks.push(stripe(p.x, p.y + my, p.z, p.dx, p.dz, 4.2, 0.18));
      }
      // solid edge lines
      const edgeLine = (off) => {
        const g = ribbon(trimmed, off - 0.09, off + 0.09, my, 1, 1);
        if (g) marks.push(g);
      };
      edgeLine(-hw + 0.55);
      edgeLine(hw - 0.55);

      if (edge.marks === 'highway') {
        // painted median hatching on the ring road
        for (let s = 2; s < total - 2; s += 5) {
          const p = at(s);
          marks.push(stripe(p.x, p.y + my, p.z, p.dx, p.dz, 3.4, 0.5));
        }
        edgeLine(-hw * 0.5);
        edgeLine(hw * 0.5);
      }
    }
  }

  // junction plates + zebra crossings
  for (const node of network.nodes) {
    const info = nodeRadius.get(node.id);
    if (!info) continue;
    const y = node.y + info.layer + 0.006;
    surfaces.push(junctionPlate(node, info.r, y));

    if (!node.light) continue;
    for (const id of node.edges) {
      const e = network.edges[id];
      const fromA = e.a === node.id;
      const p0 = fromA ? e.path[0] : e.path[e.path.length - 1];
      const p1 = fromA ? e.path[1] : e.path[e.path.length - 2];
      let dx = p1.x - p0.x;
      let dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const hw = e.width * 0.5;
      const d = info.r + 1.6;
      const cx = node.x + dx * d;
      const cz = node.z + dz * d;
      const cy = node.y + e.layer + 0.02;
      const rx = dz;
      const rz = -dx;
      const bars = Math.max(3, Math.floor(hw));
      for (let b = 0; b < bars; b++) {
        const off = -hw + 0.9 + b * ((hw * 2 - 1.8) / Math.max(1, bars - 1));
        marks.push(stripe(cx + rx * off, cy, cz + rz * off, dx, dz, 3.2, 0.52));
      }
    }
  }

  const asphaltMat = new THREE.MeshStandardMaterial({
    map: asphaltTexture(),
    roughness: 0.94,
    metalness: 0.02,
    color: 0xdadada
  });
  const walkMat = new THREE.MeshStandardMaterial({
    map: sidewalkTexture(),
    roughness: 0.95,
    metalness: 0
  });
  const kerbMat = new THREE.MeshStandardMaterial({ color: 0xb9b6ac, roughness: 0.9 });
  const markMat = new THREE.MeshStandardMaterial({
    color: 0xf2f2ec,
    roughness: 0.72,
    emissive: 0x2a2a26,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3
  });

  const add = (geos, mat, name, receive = true) => {
    const valid = geos.filter(Boolean);
    if (!valid.length) return;
    const merged = mergeGeometries(valid, false);
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.receiveShadow = receive;
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    valid.forEach((g) => g.dispose());
  };

  const bankMat = new THREE.MeshStandardMaterial({
    color: 0x8a8058,
    roughness: 1,
    side: THREE.DoubleSide
  });

  add(surfaces, asphaltMat, 'asphalt');
  add(banks, bankMat, 'embankments');
  add(walks, walkMat, 'pavement');
  add(kerbs, kerbMat, 'kerb');
  add(marks, markMat, 'markings');

  return group;
}
