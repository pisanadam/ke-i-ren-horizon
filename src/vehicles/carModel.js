import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Procedural car bodies. Everything is built from tapered hulls and boxes so
 * each vehicle in the catalogue reads differently without any asset files.
 *
 * Local space: +Z is forward, +X is right, Y=0 is the road surface.
 */

/**
 * Every part has to expose the same attribute set or mergeGeometries refuses
 * to combine them, so all geometry goes through here: position + normal + uv
 * + colour, always.
 */
function tint(geo, colour) {
  const n = geo.attributes.position.count;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) {
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  const c = new THREE.Color(colour);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * Eight-corner hull. Corners are given bottom-then-top, each ring ordered
 * rear-left, rear-right, front-right, front-left.
 */
function hull(p) {
  const pos = [];
  const idx = [];
  const push = (a, b, c, d) => {
    const base = pos.length / 3;
    pos.push(...p[a], ...p[b], ...p[c], ...p[d]);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  push(3, 2, 1, 0);           // bottom
  push(4, 5, 6, 7);           // top
  push(0, 1, 5, 4);           // rear
  push(2, 3, 7, 6);           // front
  push(1, 2, 6, 5);           // right
  push(3, 0, 4, 7);           // left

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Convenience wrapper: a symmetric body section. */
function section({ zBack, zFront, yBottom, yTop, wBack, wFront, wTopBack, wTopFront, yTopBack, yTopFront }) {
  const wtb = wTopBack ?? wBack;
  const wtf = wTopFront ?? wFront;
  const ytb = yTopBack ?? yTop;
  const ytf = yTopFront ?? yTop;
  return hull([
    [-wBack / 2, yBottom, zBack],
    [wBack / 2, yBottom, zBack],
    [wFront / 2, yBottom, zFront],
    [-wFront / 2, yBottom, zFront],
    [-wtb / 2, ytb, zBack],
    [wtb / 2, ytb, zBack],
    [wtf / 2, ytf, zFront],
    [-wtf / 2, ytf, zFront]
  ]);
}

function box(w, h, d, x, y, z, colour) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return tint(g, colour);
}

function wheelGeometry(radius, width) {
  const parts = [];
  const tyre = new THREE.CylinderGeometry(radius, radius, width, 14);
  tyre.rotateZ(Math.PI / 2);
  parts.push(tint(tyre, 0x15171b));

  const rim = new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width * 1.04, 12);
  rim.rotateZ(Math.PI / 2);
  parts.push(tint(rim, 0xb9bec6));

  const hub = new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, width * 1.1, 8);
  hub.rotateZ(Math.PI / 2);
  parts.push(tint(hub, 0x6d737b));

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spoke = new THREE.BoxGeometry(width * 0.9, radius * 0.9, radius * 0.16);
    spoke.rotateX(a);
    parts.push(tint(spoke, 0xa8adb5));
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

/**
 * Builds all geometry for one vehicle spec.
 * @returns {{paint:THREE.BufferGeometry, detail:THREE.BufferGeometry,
 *            glass:THREE.BufferGeometry, glow:THREE.BufferGeometry,
 *            wheel:THREE.BufferGeometry, wheels:Array, spec:object}}
 */
export function buildCarParts(spec) {
  const L = spec.length;
  const W = spec.width;
  const wheelR = spec.wheelRadius;
  const wheelW = spec.wheelWidth ?? 0.24;
  const axleF = spec.wheelBase / 2;
  const axleR = -spec.wheelBase / 2;
  const track = W / 2 - wheelW * 0.55;

  const paint = [];
  const detail = [];
  const glass = [];
  const glow = [];

  const sillY = spec.rideHeight;
  const beltY = sillY + spec.bodyHeight;
  const roofY = beltY + spec.cabinHeight;

  const halfL = L / 2;
  const noseZ = halfL;
  const tailZ = -halfL;

  // ---------------------------------------------------------------- body
  const body = section({
    zBack: tailZ,
    zFront: noseZ,
    yBottom: sillY,
    yTop: beltY,
    wBack: W * (spec.rearWidth ?? 1),
    wFront: W * (spec.frontWidth ?? 0.96),
    wTopBack: W * (spec.rearWidth ?? 1) * 0.99,
    wTopFront: W * (spec.frontWidth ?? 0.96) * 0.97,
    yTopBack: beltY,
    yTopFront: beltY - (spec.noseDrop ?? 0.06)
  });
  paint.push(tint(body, 0xffffff));

  // rocker / lower skirt
  paint.push(box(W * 0.98, sillY * 0.9, L * 0.72, 0, sillY * 0.55, 0, 0xffffff));

  // ------------------------------------------------------------- cabin
  const cabBack = spec.cabinBack * halfL;
  const cabFront = spec.cabinFront * halfL;

  // A dark interior block behind the glass: without it the glasshouse reads
  // as an empty aquarium you can see straight through.
  const cabMid = (cabBack + cabFront) / 2;
  const cabLen = cabFront - cabBack;
  const cabH = spec.cabinHeight;
  detail.push(box(W * 0.80, cabH * 0.94, cabLen * 0.88, 0, beltY + cabH * 0.47 - 0.02, cabMid, 0x16191d));
  if (!spec.tall) {
    // headrests, so there is something to read through the rear screen
    for (const sx of [-1, 1]) {
      detail.push(box(W * 0.20, 0.18, 0.12, sx * W * 0.20, beltY + cabH * 0.86, cabMid - cabLen * 0.06, 0x24272c));
    }
    detail.push(box(W * 0.74, 0.10, 0.30, 0, beltY + cabH * 0.30, cabFront - cabLen * 0.16, 0x24272c));
  }

  if (spec.tall) {
    // van / bus: a single tall glasshouse
    paint.push(tint(section({
      zBack: cabBack, zFront: cabFront,
      yBottom: beltY - 0.02, yTop: roofY,
      wBack: W * 0.99, wFront: W * 0.99,
      wTopBack: W * 0.93, wTopFront: W * 0.93
    }), 0xffffff));
    // window bands
    const bandH = spec.cabinHeight * 0.52;
    const bandY = beltY + spec.cabinHeight * 0.52;
    glass.push(box(W * 1.005, bandH, (cabFront - cabBack) * 0.9, 0, bandY, (cabFront + cabBack) / 2, 0x27384a));
    glass.push(box(W * 0.86, bandH * 1.15, 0.1, 0, bandY, cabFront + 0.02, 0x27384a));
    glass.push(box(W * 0.86, bandH, 0.1, 0, bandY, cabBack - 0.02, 0x27384a));
  } else {
    const roofBack = cabBack + (cabFront - cabBack) * (spec.roofBack ?? 0.18);
    const roofFront = cabFront - (cabFront - cabBack) * (spec.roofFront ?? 0.3);
    const cabin = hull([
      [-W * 0.49, beltY, cabBack],
      [W * 0.49, beltY, cabBack],
      [W * 0.49, beltY, cabFront],
      [-W * 0.49, beltY, cabFront],
      [-W * 0.40, roofY, roofBack],
      [W * 0.40, roofY, roofBack],
      [W * 0.40, roofY, roofFront],
      [-W * 0.40, roofY, roofFront]
    ]);
    glass.push(tint(cabin, 0x24323f));

    // roof panel + pillars in body colour
    paint.push(box(W * 0.83, 0.07, roofFront - roofBack + 0.06, 0, roofY, (roofFront + roofBack) / 2, 0xffffff));
    const pillar = (x, z, w, d) => paint.push(
      box(w, spec.cabinHeight, d, x, beltY + spec.cabinHeight / 2, z, 0xffffff)
    );
    pillar(-W * 0.44, cabBack + 0.06, 0.07, 0.16);
    pillar(W * 0.44, cabBack + 0.06, 0.07, 0.16);
    pillar(-W * 0.455, (cabBack + cabFront) / 2, 0.07, 0.13);
    pillar(W * 0.455, (cabBack + cabFront) / 2, 0.07, 0.13);
  }

  // ---------------------------------------------------------- extras
  if (spec.bed) {
    // pickup load bed
    const bedBack = tailZ + 0.08;
    const bedFront = cabBack - 0.05;
    const wall = 0.1;
    paint.push(box(W * 0.99, 0.55, wall, 0, beltY + 0.22, bedBack, 0xffffff));
    paint.push(box(wall, 0.55, bedFront - bedBack, -W * 0.49, beltY + 0.22, (bedBack + bedFront) / 2, 0xffffff));
    paint.push(box(wall, 0.55, bedFront - bedBack, W * 0.49, beltY + 0.22, (bedBack + bedFront) / 2, 0xffffff));
    detail.push(box(W * 0.94, 0.05, bedFront - bedBack, 0, beltY + 0.02, (bedBack + bedFront) / 2, 0x3a3d42));
  }

  if (spec.spoiler) {
    detail.push(box(W * 0.86, 0.06, 0.32, 0, beltY + 0.30, tailZ + 0.22, 0x1c1e22));
    detail.push(box(0.07, 0.28, 0.24, -W * 0.34, beltY + 0.16, tailZ + 0.24, 0x1c1e22));
    detail.push(box(0.07, 0.28, 0.24, W * 0.34, beltY + 0.16, tailZ + 0.24, 0x1c1e22));
  }

  if (spec.roofRack) {
    for (const x of [-W * 0.3, W * 0.3]) {
      detail.push(box(0.07, 0.07, (cabFront - cabBack) * 0.8, x, roofY + 0.06, (cabFront + cabBack) / 2, 0x2c3036));
    }
  }

  if (spec.taxiSign) {
    detail.push(box(0.7, 0.16, 0.26, 0, roofY + 0.11, (cabFront + cabBack) / 2 + 0.1, 0x111111));
    glow.push(box(0.66, 0.13, 0.22, 0, roofY + 0.11, (cabFront + cabBack) / 2 + 0.1, 0xffd23f));
  }

  if (spec.lightBar) {
    const z = (cabFront + cabBack) / 2 + 0.15;
    detail.push(box(1.15, 0.1, 0.24, 0, roofY + 0.09, z, 0x16181c));
    glow.push(box(0.5, 0.13, 0.2, -0.3, roofY + 0.12, z, 0x2a5cff));
    glow.push(box(0.5, 0.13, 0.2, 0.3, roofY + 0.12, z, 0xff2a2a));
  }

  if (spec.acUnit) {
    detail.push(box(W * 0.5, 0.22, 1.1, 0, roofY + 0.12, cabBack + 0.9, 0xd8d8d4));
  }

  if (spec.bullBar) {
    detail.push(box(W * 0.9, 0.1, 0.1, 0, sillY + 0.28, noseZ + 0.1, 0x9aa0a8));
    detail.push(box(0.08, 0.42, 0.1, -W * 0.32, sillY + 0.42, noseZ + 0.1, 0x9aa0a8));
    detail.push(box(0.08, 0.42, 0.1, W * 0.32, sillY + 0.42, noseZ + 0.1, 0x9aa0a8));
  }

  // ------------------------------------------------------- bumpers & trim
  detail.push(box(W * 1.0, 0.3, 0.22, 0, sillY + 0.16, noseZ + 0.02, 0x2a2d32));
  detail.push(box(W * 1.0, 0.3, 0.22, 0, sillY + 0.16, tailZ - 0.02, 0x2a2d32));
  detail.push(box(W * 0.62, 0.22, 0.1, 0, beltY - 0.20, noseZ + 0.06, 0x16181c)); // grille
  detail.push(box(W * 0.30, 0.12, 0.06, 0, sillY + 0.12, tailZ - 0.12, 0xc9ced6)); // plate

  // mirrors
  for (const sx of [-1, 1]) {
    detail.push(box(0.06, 0.05, 0.13, sx * W * 0.53, beltY + 0.09, cabFront - 0.15, 0x2a2d32));
    detail.push(box(0.16, 0.11, 0.07, sx * W * 0.60, beltY + 0.09, cabFront - 0.15, 0x2a2d32));
  }

  // exhaust
  detail.push(box(0.11, 0.11, 0.2, W * 0.28, sillY * 0.6, tailZ - 0.1, 0x7d838b));

  // wheel arches
  for (const z of [axleF, axleR]) {
    for (const sx of [-1, 1]) {
      detail.push(box(0.1, wheelR * 0.8, wheelR * 2.25, sx * (W / 2 + 0.01), sillY + wheelR * 0.34, z, 0x1b1d21));
    }
  }

  // ------------------------------------------------------------- lights
  const hy = beltY - 0.16;
  const hz = noseZ + 0.05;
  glow.push(box(W * 0.24, 0.13, 0.06, -W * 0.32, hy, hz, 0xfff3d6));
  glow.push(box(W * 0.24, 0.13, 0.06, W * 0.32, hy, hz, 0xfff3d6));
  const ty = beltY - 0.14;
  const tz = tailZ - 0.05;
  glow.push(box(W * 0.22, 0.15, 0.05, -W * 0.33, ty, tz, 0xd8241f));
  glow.push(box(W * 0.22, 0.15, 0.05, W * 0.33, ty, tz, 0xd8241f));
  // indicators
  glow.push(box(W * 0.1, 0.08, 0.05, -W * 0.44, hy - 0.02, hz, 0xff9a1f));
  glow.push(box(W * 0.1, 0.08, 0.05, W * 0.44, hy - 0.02, hz, 0xff9a1f));

  // ------------------------------------------------------------- wheels
  const wheel = wheelGeometry(wheelR, wheelW);
  const wheels = [
    { x: -track, y: wheelR, z: axleF, front: true },
    { x: track, y: wheelR, z: axleF, front: true },
    { x: -track, y: wheelR, z: axleR, front: false },
    { x: track, y: wheelR, z: axleR, front: false }
  ];

  const merge = (arr) => {
    const valid = arr.filter(Boolean);
    if (!valid.length) return null;
    const m = mergeGeometries(valid, false);
    if (!m) {
      console.warn(`[${spec.id}] geometry merge failed`);
      return valid[0];
    }
    valid.forEach((g) => g.dispose());
    return m;
  };

  return {
    paint: merge(paint),
    detail: merge(detail),
    glass: merge(glass),
    glow: merge(glow),
    wheel,
    wheels,
    spec
  };
}

const MATS = {
  paint: () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0.55 }),
  detail: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.25 }),
  glass: () => new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.08, metalness: 0.15,
    transparent: true, opacity: 0.62
  }),
  glow: () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: 0x555555 })
};

/**
 * Full-detail car for the player: separate steerable front wheels and
 * light groups that can flare under braking or reversing.
 */
export function createPlayerCar(spec, colourHex) {
  const parts = buildCarParts(spec);
  const group = new THREE.Group();
  group.name = `car-${spec.id}`;

  const paintMat = MATS.paint();
  paintMat.color.setHex(colourHex);
  const detailMat = MATS.detail();
  const glassMat = MATS.glass();

  const bodyRoot = new THREE.Group();
  group.add(bodyRoot);

  const paintMesh = new THREE.Mesh(parts.paint, paintMat);
  paintMesh.castShadow = true;
  bodyRoot.add(paintMesh);

  const detailMesh = new THREE.Mesh(parts.detail, detailMat);
  detailMesh.castShadow = true;
  bodyRoot.add(detailMesh);

  if (parts.glass) {
    const glassMesh = new THREE.Mesh(parts.glass, glassMat);
    bodyRoot.add(glassMesh);
  }

  // Lights are split so head / tail / reverse can be driven independently.
  const headMat = new THREE.MeshBasicMaterial({ color: 0x554b38, toneMapped: false });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x521411, toneMapped: false });
  const signMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: 0xffffff });

  const L = spec.length;
  const W = spec.width;
  const beltY = spec.rideHeight + spec.bodyHeight;

  const headGeo = mergeGeometries([
    box(W * 0.24, 0.13, 0.06, -W * 0.32, beltY - 0.16, L / 2 + 0.05, 0xffffff),
    box(W * 0.24, 0.13, 0.06, W * 0.32, beltY - 0.16, L / 2 + 0.05, 0xffffff)
  ], false);
  const tailGeo = mergeGeometries([
    box(W * 0.22, 0.15, 0.05, -W * 0.33, beltY - 0.14, -L / 2 - 0.05, 0xffffff),
    box(W * 0.22, 0.15, 0.05, W * 0.33, beltY - 0.14, -L / 2 - 0.05, 0xffffff)
  ], false);

  const headMesh = new THREE.Mesh(headGeo, headMat);
  const tailMesh = new THREE.Mesh(tailGeo, tailMat);
  bodyRoot.add(headMesh, tailMesh);

  // the roof sign / light bar keeps its own colours
  let signMesh = null;
  if (parts.glow) {
    signMesh = new THREE.Mesh(parts.glow, signMat);
    bodyRoot.add(signMesh);
  }

  const wheelMat = MATS.detail();
  const wheelMeshes = parts.wheels.map((w) => {
    const holder = new THREE.Group();
    holder.position.set(w.x, w.y, w.z);
    const mesh = new THREE.Mesh(parts.wheel, wheelMat);
    mesh.castShadow = true;
    holder.add(mesh);
    holder.userData.front = w.front;
    holder.userData.spin = mesh;
    group.add(holder);
    return holder;
  });

  return {
    group,
    bodyRoot,
    paintMat,
    headMat,
    tailMat,
    signMat,
    wheelMeshes,
    spec,
    setColour(hex) { paintMat.color.setHex(hex); }
  };
}

export { MATS as CAR_MATERIALS };
