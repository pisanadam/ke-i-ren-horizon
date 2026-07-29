import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lerp, clamp } from '../util/math.js';

/**
 * Procedural car bodies. Everything is built from tapered hulls and boxes so
 * each vehicle in the catalogue reads differently without any asset files.
 *
 * The lower body is cut into five slices along its length so the two wheel
 * arches are real openings rather than wheels poking out of a flat slab —
 * that single detail is what makes these read as cars instead of bricks.
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

/**
 * A window pillar that leans with the glasshouse: it runs from (z0,y0) at the
 * belt line to (z1,y1) at the roof, and narrows inwards on the way up so it
 * hugs the tumblehome instead of standing proud of the glass.
 */
function pillarHull(xBot, xTop, z0, y0, z1, y1, thickness, depth) {
  const t = thickness / 2;
  const d = depth / 2;
  return hull([
    [xBot - t, y0, z0 - d],
    [xBot + t, y0, z0 - d],
    [xBot + t, y0, z0 + d],
    [xBot - t, y0, z0 + d],
    [xTop - t, y1, z1 - d],
    [xTop + t, y1, z1 - d],
    [xTop + t, y1, z1 + d],
    [xTop - t, y1, z1 + d]
  ]);
}

function wheelGeometry(radius, width) {
  const parts = [];
  const tyre = new THREE.CylinderGeometry(radius, radius, width, 16);
  tyre.rotateZ(Math.PI / 2);
  parts.push(tint(tyre, 0x15171b));

  const rim = new THREE.CylinderGeometry(radius * 0.60, radius * 0.60, width * 1.03, 14);
  rim.rotateZ(Math.PI / 2);
  parts.push(tint(rim, 0xb9bec6));

  const hub = new THREE.CylinderGeometry(radius * 0.2, radius * 0.2, width * 1.08, 8);
  hub.rotateZ(Math.PI / 2);
  parts.push(tint(hub, 0x6d737b));

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spoke = new THREE.BoxGeometry(width * 0.86, radius * 0.86, radius * 0.15);
    spoke.rotateX(a);
    parts.push(tint(spoke, 0xa8adb5));
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

/** Height of the body sill — the cockpit cameras need to agree with this. */
export function sillHeight(spec) {
  return Math.max(spec.rideHeight, spec.wheelRadius + 0.05);
}

/**
 * Builds all geometry for one vehicle spec.
 * @returns {{paint, detail, glass, glow, signGlow, headLight, tailLight,
 *            wheel, wheels, spec, dims}}
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
  const signGeos = [];
  const headGeos = [];
  const tailGeos = [];

  // The body sill has to clear the wheel centre, otherwise the wheels look
  // half-swallowed by the bodywork.
  const sillY = sillHeight(spec);
  const beltY = sillY + spec.bodyHeight;
  const roofY = beltY + spec.cabinHeight;

  const halfL = L / 2;
  const noseZ = halfL;
  const tailZ = -halfL;

  const rearW = spec.rearWidth ?? 1;
  const frontW = spec.frontWidth ?? 0.96;
  const noseDrop = spec.noseDrop ?? 0.10;

  const tOf = (z) => clamp((z - tailZ) / (noseZ - tailZ), 0, 1);
  const widthAt = (z) => W * lerp(rearW, frontW, tOf(z));
  // the bonnet only starts dropping over the front 45% of the car
  const topAt = (z) => beltY - noseDrop * clamp((tOf(z) - 0.6) / 0.4, 0, 1);

  // ------------------------------------------------------------ lower body
  const archHalf = wheelR * 1.24;
  const archY = wheelR * 2 + 0.04;          // opening clears the top of the tyre
  const rearArch = [axleR - archHalf, axleR + archHalf];
  const frontArch = [axleF - archHalf, axleF + archHalf];

  const bodySeg = (zBack, zFront, yBottom) => {
    if (zFront - zBack < 0.02) return;
    paint.push(tint(section({
      zBack, zFront,
      yBottom,
      yTop: beltY,
      wBack: widthAt(zBack), wFront: widthAt(zFront),
      yTopBack: topAt(zBack), yTopFront: topAt(zFront)
    }), 0xffffff));
  };

  bodySeg(tailZ, rearArch[0], sillY);
  bodySeg(rearArch[0], rearArch[1], archY);
  bodySeg(rearArch[1], frontArch[0], sillY);
  bodySeg(frontArch[0], frontArch[1], archY);
  bodySeg(frontArch[1], noseZ, sillY);

  // floor pan, so you cannot see up into the car through the arches
  detail.push(box(W * 0.9, 0.07, spec.wheelBase + wheelR, 0, sillY - 0.02, 0, 0x24272b));

  // a thin dark lip around each opening reads as the arch liner
  for (const z of [axleF, axleR]) {
    detail.push(box(W + 0.03, 0.06, archHalf * 2 + 0.02, 0, archY - 0.005, z, 0x141619));
  }

  // ---------------------------------------------------------------- cabin
  const cabBack = spec.cabinBack * halfL;
  const cabFront = spec.cabinFront * halfL;
  const cabMid = (cabBack + cabFront) / 2;
  const cabLen = cabFront - cabBack;
  const cabH = spec.cabinHeight;

  if (spec.tall) {
    // van / bus: a single tall glasshouse
    paint.push(tint(section({
      zBack: cabBack, zFront: cabFront,
      yBottom: beltY - 0.02, yTop: roofY,
      wBack: W * 0.99, wFront: W * 0.99,
      wTopBack: W * 0.93, wTopFront: W * 0.93
    }), 0xffffff));

    const bandH = cabH * 0.46;
    const bandY = beltY + cabH * 0.60;
    glass.push(box(W * 1.006, bandH, cabLen * 0.9, 0, bandY, cabMid, 0x27384a));
    glass.push(box(W * 0.88, bandH * 1.1, 0.1, 0, bandY, cabFront + 0.02, 0x27384a));
    glass.push(box(W * 0.88, bandH * 0.9, 0.1, 0, bandY, cabBack - 0.02, 0x27384a));
    // dark interior behind the glazing
    detail.push(box(W * 0.9, bandH * 0.95, cabLen * 0.88, 0, bandY - 0.02, cabMid, 0x1a1d21));
  } else {
    const roofBack = cabBack + cabLen * (spec.roofBack ?? 0.18);
    const roofFront = cabFront - cabLen * (spec.roofFront ?? 0.3);

    const cabin = hull([
      [-W * 0.47, beltY, cabBack],
      [W * 0.47, beltY, cabBack],
      [W * 0.47, beltY, cabFront],
      [-W * 0.47, beltY, cabFront],
      [-W * 0.39, roofY, roofBack],
      [W * 0.39, roofY, roofBack],
      [W * 0.39, roofY, roofFront],
      [-W * 0.39, roofY, roofFront]
    ]);
    glass.push(tint(cabin, 0x24323f));

    // Interior fills only the lower half of the glasshouse, so daylight still
    // shows through the upper glazing instead of a solid black block.
    detail.push(box(W * 0.72, cabH * 0.58, cabLen * 0.8, 0, beltY + cabH * 0.28, cabMid, 0x16191d));
    for (const sx of [-1, 1]) {
      detail.push(box(W * 0.17, 0.16, 0.11, sx * W * 0.19, beltY + cabH * 0.55, cabMid - cabLen * 0.08, 0x24272c));
    }
    detail.push(box(W * 0.68, 0.08, 0.26, 0, beltY + cabH * 0.20, cabFront - cabLen * 0.15, 0x2a2e33));

    // roof panel and pillars in body colour
    paint.push(box(W * 0.81, 0.08, roofFront - roofBack + 0.06, 0, roofY, (roofFront + roofBack) / 2, 0xffffff));

    // Pillars lean with the glass: an upright post would stand well above the
    // raked screens and read as a roll cage.
    const pillar = (z0, z1, depth) => {
      for (const sx of [-1, 1]) {
        paint.push(tint(pillarHull(
          sx * W * 0.472, sx * W * 0.392,
          z0, beltY, z1, roofY,
          0.065, depth
        ), 0xffffff));
      }
    };
    pillar(cabBack + 0.03, roofBack - 0.03, 0.14);       // C-pillar
    pillar(cabMid, cabMid, 0.10);                        // B-pillar
    pillar(cabFront - 0.03, roofFront + 0.03, 0.14);     // A-pillar
    // belt-line trim breaks up the glazing
    detail.push(box(W * 0.955, 0.05, cabLen * 0.98, 0, beltY + 0.02, cabMid, 0x2a2e33));
  }

  // ---------------------------------------------------------- extras
  if (spec.bed) {
    const bedBack = tailZ + 0.06;
    const bedFront = cabBack - 0.04;
    const wall = 0.09;
    const bedY = beltY + 0.24;
    paint.push(box(W * 0.99, 0.5, wall, 0, bedY, bedBack, 0xffffff));
    paint.push(box(wall, 0.5, bedFront - bedBack, -W * 0.49, bedY, (bedBack + bedFront) / 2, 0xffffff));
    paint.push(box(wall, 0.5, bedFront - bedBack, W * 0.49, bedY, (bedBack + bedFront) / 2, 0xffffff));
    detail.push(box(W * 0.94, 0.05, bedFront - bedBack, 0, beltY + 0.01, (bedBack + bedFront) / 2, 0x3a3d42));
  }

  if (spec.spoiler) {
    detail.push(box(W * 0.84, 0.06, 0.3, 0, beltY + 0.3, tailZ + 0.24, 0x1c1e22));
    for (const sx of [-1, 1]) {
      detail.push(box(0.07, 0.28, 0.22, sx * W * 0.34, beltY + 0.16, tailZ + 0.26, 0x1c1e22));
    }
  }

  if (spec.roofRack) {
    for (const sx of [-1, 1]) {
      detail.push(box(0.07, 0.07, cabLen * 0.78, sx * W * 0.28, roofY + 0.07, cabMid, 0x2c3036));
    }
    for (const dz of [-0.3, 0.3]) {
      detail.push(box(W * 0.6, 0.06, 0.06, 0, roofY + 0.07, cabMid + cabLen * dz, 0x2c3036));
    }
  }

  if (spec.taxiSign) {
    detail.push(box(0.72, 0.06, 0.28, 0, roofY + 0.06, cabMid + 0.1, 0x111111));
    signGeos.push(box(0.66, 0.14, 0.22, 0, roofY + 0.14, cabMid + 0.1, 0xffd23f));
  }

  if (spec.lightBar) {
    const z = cabMid + 0.12;
    detail.push(box(1.15, 0.07, 0.24, 0, roofY + 0.05, z, 0x16181c));
    signGeos.push(box(0.5, 0.12, 0.2, -0.3, roofY + 0.13, z, 0x2a5cff));
    signGeos.push(box(0.5, 0.12, 0.2, 0.3, roofY + 0.13, z, 0xff2a2a));
  }

  if (spec.acUnit) {
    detail.push(box(W * 0.5, 0.2, 1.1, 0, roofY + 0.11, cabBack + cabLen * 0.18, 0xd8d8d4));
  }

  if (spec.bullBar) {
    const y = sillY + 0.3;
    detail.push(box(W * 0.86, 0.09, 0.09, 0, y, noseZ + 0.14, 0x9aa0a8));
    for (const sx of [-1, 1]) {
      detail.push(box(0.08, 0.46, 0.09, sx * W * 0.3, y + 0.2, noseZ + 0.14, 0x9aa0a8));
    }
  }

  // ------------------------------------------------------- bumpers & trim
  const bumperY = sillY + spec.bodyHeight * 0.20;
  const bumperH = spec.bodyHeight * 0.34;
  detail.push(box(widthAt(noseZ) * 0.99, bumperH, 0.10, 0, bumperY, noseZ + 0.03, 0x34383e));
  detail.push(box(widthAt(tailZ) * 0.99, bumperH, 0.10, 0, bumperY, tailZ - 0.03, 0x34383e));

  // grille and number plates
  const grilleY = sillY + spec.bodyHeight * 0.62;
  detail.push(box(W * 0.52, spec.bodyHeight * 0.26, 0.07, 0, grilleY, noseZ + 0.04, 0x16181c));
  detail.push(box(W * 0.26, 0.12, 0.03, 0, bumperY, noseZ + 0.09, 0xc9ced6));
  detail.push(box(W * 0.26, 0.12, 0.03, 0, bumperY, tailZ - 0.09, 0xc9ced6));

  // mirrors
  for (const sx of [-1, 1]) {
    detail.push(box(0.06, 0.05, 0.13, sx * W * 0.5, beltY + 0.08, cabFront - 0.12, 0x2a2d32));
    detail.push(box(0.15, 0.11, 0.07, sx * W * 0.57, beltY + 0.08, cabFront - 0.12, 0x2a2d32));
  }

  // door handles and a shut line, so the flanks are not blank
  for (const sx of [-1, 1]) {
    detail.push(box(0.03, 0.05, 0.18, sx * (W / 2 + 0.005), beltY - 0.16, cabMid - cabLen * 0.1, 0x33373d));
    detail.push(box(0.03, 0.05, 0.18, sx * (W / 2 + 0.005), beltY - 0.16, cabMid + cabLen * 0.2, 0x33373d));
  }

  // exhaust
  detail.push(box(0.1, 0.1, 0.18, W * 0.26, sillY - 0.06, tailZ - 0.08, 0x7d838b));

  // ------------------------------------------------------------- lights
  const hy = sillY + spec.bodyHeight * 0.58;
  const hz = noseZ + 0.035;
  for (const sx of [-1, 1]) {
    headGeos.push(box(W * 0.24, 0.14, 0.05, sx * W * 0.31, hy, hz, 0xfff3d6));
    signGeos.push(box(W * 0.09, 0.09, 0.05, sx * W * 0.45, hy - 0.02, hz, 0xff9a1f));
  }
  const ty = sillY + spec.bodyHeight * 0.60;
  const tz = tailZ - 0.035;
  for (const sx of [-1, 1]) {
    tailGeos.push(box(W * 0.22, 0.16, 0.05, sx * W * 0.32, ty, tz, 0xd8241f));
  }

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
  const copies = (arr) => arr.map((g) => g.clone());

  return {
    paint: merge(paint),
    detail: merge(detail),
    glass: merge(glass),
    // everything that glows, for the instanced traffic cars
    glow: merge([...copies(signGeos), ...copies(headGeos), ...copies(tailGeos)]),
    // …and split apart, so the player's lights can be driven independently
    signGlow: merge(signGeos),
    headLight: merge(headGeos),
    tailLight: merge(tailGeos),
    wheel,
    wheels,
    spec,
    dims: { sillY, beltY, roofY }
  };
}

const MATS = {
  paint: () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0.55 }),
  detail: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.25 }),
  glass: () => new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.08, metalness: 0.15,
    transparent: true, opacity: 0.68
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

  if (parts.glass) bodyRoot.add(new THREE.Mesh(parts.glass, glassMat));

  // Lights are split so head / tail can be driven independently.
  const headMat = new THREE.MeshBasicMaterial({ color: 0x554b38, toneMapped: false });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x521411, toneMapped: false });
  const signMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: 0xffffff });

  if (parts.headLight) bodyRoot.add(new THREE.Mesh(parts.headLight, headMat));
  if (parts.tailLight) bodyRoot.add(new THREE.Mesh(parts.tailLight, tailMat));
  if (parts.signGlow) bodyRoot.add(new THREE.Mesh(parts.signGlow, signMat));
  parts.glow?.dispose();

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
