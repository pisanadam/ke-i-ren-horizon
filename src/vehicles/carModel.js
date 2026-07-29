import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lerp, clamp, smoothstep } from '../util/math.js';

/**
 * Procedural car bodies.
 *
 * Rather than bolting boxes together, each body is a *lofted surface*: a
 * rounded cross-section is swept from the tail to the nose while its width,
 * sill and belt line vary along the way. That gives curved flanks, a domed
 * roof and — because the sill follows a circle over each axle — proper round
 * wheel arches. Neighbouring rings share vertices, so the shell shades
 * smoothly instead of faceting.
 *
 * The glasshouse is a second loft; the roof skin and the A/B/C pillars are
 * sub-patches of that same surface pushed out by a millimetre, which is why
 * they hug the glass exactly instead of floating above it.
 *
 * Local space: +Z is forward, +X is the car's LEFT (right = forward × up = -X),
 * Y = 0 is the road surface.
 */

/** Detail levels: the player's car gets the dense mesh, traffic a lighter one. */
const QUALITY = {
  high: { rings: 46, pts: 28, cabRings: 22, cabPts: 24, wheelSeg: 26, blockSeg: 6 },
  low: { rings: 16, pts: 12, cabRings: 8, cabPts: 10, wheelSeg: 9, blockSeg: 2 }
};

/**
 * Every part has to expose the same attribute set — and all be indexed — or
 * mergeGeometries refuses to combine them.
 */
function tint(geo, colour) {
  const n = geo.attributes.position.count;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) {
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!geo.index) {
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
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
 * Closed cross-section: a superellipse whose "squareness" differs above and
 * below the waist, so a body can be square at the sill and domed at the roof.
 * Index 0 is the right flank, N/4 the top, N/2 the left flank, 3N/4 the floor.
 */
function ringProfile(halfWidth, yBottom, yTop, nTop, nBottom, N) {
  const cy = (yBottom + yTop) / 2;
  const b = (yTop - yBottom) / 2;
  const pts = new Array(N);
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const e = 2 / (s >= 0 ? nTop : nBottom);
    pts[i] = [
      halfWidth * Math.sign(c) * Math.pow(Math.abs(c), e),
      cy + b * Math.sign(s) * Math.pow(Math.abs(s), e)
    ];
  }
  return pts;
}

/**
 * Skins a list of rings into one smooth-shaded surface.
 * @param {Array<{z:number, cy:number, pts:Array<[number,number]>}>} rings
 */
function loftGeometry(rings, { capStart = true, capEnd = true } = {}) {
  const R = rings.length;
  const N = rings[0].pts.length;
  const vertCount = R * N + (capStart ? 1 : 0) + (capEnd ? 1 : 0);
  const pos = new Float32Array(vertCount * 3);

  for (let r = 0; r < R; r++) {
    const ring = rings[r];
    for (let i = 0; i < N; i++) {
      const o = (r * N + i) * 3;
      pos[o] = ring.pts[i][0];
      pos[o + 1] = ring.pts[i][1];
      pos[o + 2] = ring.z;
    }
  }

  const idx = [];
  for (let r = 0; r < R - 1; r++) {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a = r * N + i;
      const b = r * N + j;
      const c = (r + 1) * N + j;
      const d = (r + 1) * N + i;
      idx.push(a, b, c, a, c, d);
    }
  }

  let cursor = R * N;
  if (capStart) {
    const centre = cursor++;
    pos[centre * 3] = 0;
    pos[centre * 3 + 1] = rings[0].cy;
    pos[centre * 3 + 2] = rings[0].z;
    for (let i = 0; i < N; i++) idx.push(centre, (i + 1) % N, i);
  }
  if (capEnd) {
    const centre = cursor++;
    const last = R - 1;
    pos[centre * 3] = 0;
    pos[centre * 3 + 1] = rings[last].cy;
    pos[centre * 3 + 2] = rings[last].z;
    for (let i = 0; i < N; i++) idx.push(centre, last * N + i, last * N + ((i + 1) % N));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A patch lifted off an existing loft: rings `r0..r1`, profile points
 * `i0..i1`, pushed out by `swell` so it sits just proud of the surface. This
 * is how the roof skin and the window pillars are cut from the glasshouse.
 */
function subPatch(rings, r0, r1, i0, i1, swell) {
  const N = rings[0].pts.length;
  const rCount = r1 - r0 + 1;
  const iCount = i1 - i0 + 1;
  if (rCount < 2 || iCount < 2) return null;
  const pos = new Float32Array(rCount * iCount * 3);

  for (let r = 0; r < rCount; r++) {
    const ring = rings[r0 + r];
    for (let i = 0; i < iCount; i++) {
      const p = ring.pts[((i0 + i) % N + N) % N];
      const o = (r * iCount + i) * 3;
      pos[o] = p[0] * swell;
      pos[o + 1] = ring.cy + (p[1] - ring.cy) * swell;
      pos[o + 2] = ring.z;
    }
  }

  const idx = [];
  for (let r = 0; r < rCount - 1; r++) {
    for (let i = 0; i < iCount - 1; i++) {
      const a = r * iCount + i;
      const b = r * iCount + i + 1;
      const c = (r + 1) * iCount + i + 1;
      const d = (r + 1) * iCount + i;
      idx.push(a, b, c, a, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Smoothly rounded block — lamps, mirrors, handles, roof boxes. */
function roundedBlock(w, h, d, x, y, z, colour, segs = 5) {
  const rings = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const k = Math.sqrt(Math.max(0, 1 - Math.pow(t * 2 - 1, 4)));
    const s = 0.6 + 0.4 * k;
    rings.push({
      z: -d / 2 + d * t,
      cy: 0,
      pts: ringProfile((w / 2) * s, (-h / 2) * s, (h / 2) * s, 3, 3, 10)
    });
  }
  const geo = loftGeometry(rings);
  geo.translate(x, y, z);
  return tint(geo, colour);
}

function box(w, h, d, x, y, z, colour) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return tint(g, colour);
}

/** Tyre with rounded shoulders, a dished rim and spokes. */
function wheelGeometry(radius, width, seg) {
  const parts = [];
  const hw = width / 2;
  const rimR = radius * 0.62;
  const sh = radius * 0.16;

  const profile = [new THREE.Vector2(rimR, -hw), new THREE.Vector2(radius - sh, -hw)];
  for (let i = 1; i <= 3; i++) {
    const a = (i / 4) * (Math.PI / 2);
    profile.push(new THREE.Vector2(radius - sh + Math.sin(a) * sh, -hw + (1 - Math.cos(a)) * sh));
  }
  profile.push(new THREE.Vector2(radius, -hw + sh), new THREE.Vector2(radius, hw - sh));
  for (let i = 3; i >= 1; i--) {
    const a = (i / 4) * (Math.PI / 2);
    profile.push(new THREE.Vector2(radius - sh + Math.sin(a) * sh, hw - (1 - Math.cos(a)) * sh));
  }
  profile.push(new THREE.Vector2(radius - sh, hw), new THREE.Vector2(rimR, hw));

  const tyre = new THREE.LatheGeometry(profile, seg);
  tyre.rotateZ(Math.PI / 2);
  parts.push(tint(tyre, 0x15171b));

  const rim = new THREE.LatheGeometry([
    new THREE.Vector2(radius * 0.10, -hw * 0.5),
    new THREE.Vector2(rimR * 0.92, -hw * 0.1),
    new THREE.Vector2(rimR, hw * 0.4),
    new THREE.Vector2(rimR, hw * 0.92),
    new THREE.Vector2(radius * 0.12, hw * 0.92)
  ], seg);
  rim.rotateZ(Math.PI / 2);
  parts.push(tint(rim, 0xc2c7cf));

  const hub = new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, width * 0.5, Math.max(6, Math.round(seg / 2)));
  hub.rotateZ(Math.PI / 2);
  parts.push(tint(hub, 0x70767e));

  const spokes = seg >= 20 ? 5 : 4;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const spoke = new THREE.BoxGeometry(width * 0.3, radius * 0.9, radius * 0.17);
    spoke.rotateX(a);
    spoke.translate(-hw * 0.12, 0, 0);
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
 * @param {object} spec entry from the catalogue
 * @param {'high'|'low'} quality mesh density
 */
export function buildCarParts(spec, quality = 'high') {
  const Q = QUALITY[quality] ?? QUALITY.high;
  const L = spec.length;
  const W = spec.width;
  const wheelR = spec.wheelRadius;
  const wheelW = spec.wheelWidth ?? 0.24;
  const axleF = spec.wheelBase / 2;
  const axleR = -spec.wheelBase / 2;
  const track = W / 2 - wheelW * 0.5;

  const paint = [];
  const detail = [];
  const glass = [];
  const signGeos = [];
  const headGeos = [];
  const tailGeos = [];

  const sillY = sillHeight(spec);
  const beltY = sillY + spec.bodyHeight;
  const roofY = beltY + spec.cabinHeight;

  const halfL = L / 2;
  const noseZ = halfL;
  const tailZ = -halfL;
  const tOf = (z) => clamp((z - tailZ) / (noseZ - tailZ), 0, 1);

  const cabBack = spec.cabinBack * halfL;
  const cabFront = spec.cabinFront * halfL;
  const cabMid = (cabBack + cabFront) / 2;
  const cabLen = cabFront - cabBack;
  const cabH = spec.cabinHeight;

  // ------------------------------------------------------- body silhouette
  const rearW = spec.rearWidth ?? 1;
  const frontW = spec.frontWidth ?? 0.96;
  const noseDrop = spec.noseDrop ?? 0.12;
  const tailDrop = spec.tailDrop ?? 0.05;

  /** Half-width: tapers into both ends, with a slight haunch over the rear axle. */
  const halfWidthAt = (z) => {
    const t = tOf(z);
    let f = lerp(rearW, frontW, t);
    f *= 1 - 0.18 * smoothstep(0.90, 1, t);
    f *= 1 - 0.14 * (1 - smoothstep(0, 0.10, t));
    f *= 1 + 0.022 * Math.exp(-Math.pow((z - axleR) / (wheelR * 2.6), 2));
    return (W / 2) * f;
  };

  /** Belt line: flat over the cabin, falling away over the bonnet and boot. */
  const beltAt = (z) => {
    let y = beltY;
    if (z > cabFront) y -= noseDrop * smoothstep(cabFront, noseZ, z);
    if (z < cabBack) y -= tailDrop * smoothstep(cabBack, tailZ, z);
    return y;
  };

  /** Sill line, lifted into a circular arch over each axle. */
  const archR = wheelR * 1.26;
  const archApex = wheelR * 2 + 0.05;
  const sillAt = (z) => {
    let y = sillY;
    for (const a of [axleF, axleR]) {
      const d = Math.abs(z - a);
      if (d < archR) y = Math.max(y, archApex - archR + Math.sqrt(archR * archR - d * d));
    }
    return y;
  };

  // ------------------------------------------------------------- body loft
  const makeRing = (z, shrink = 1) => {
    const w = halfWidthAt(z) * shrink;
    const yb = sillAt(z);
    const yt = beltAt(z);
    const mid = (yb + yt) / 2;
    const half = ((yt - yb) / 2) * shrink;
    return { z, cy: mid, pts: ringProfile(w, mid - half, mid + half, 3.5, 5.0, Q.pts) };
  };

  const bodyRings = [makeRing(tailZ, 0.74)];
  bodyRings[0].z = tailZ - 0.02;
  for (let i = 0; i <= Q.rings; i++) {
    bodyRings.push(makeRing(lerp(tailZ, noseZ, i / Q.rings)));
  }
  const noseCap = makeRing(noseZ, 0.74);
  noseCap.z = noseZ + 0.02;
  bodyRings.push(noseCap);

  paint.push(tint(loftGeometry(bodyRings), 0xffffff));

  // floor pan so the arches do not look hollow from below
  detail.push(box(W * 0.86, 0.06, spec.wheelBase + wheelR * 0.5, 0, sillY - 0.01, 0, 0x24272b));

  // ------------------------------------------------------------ glasshouse
  if (spec.tall) {
    // van / minibus: a tall glasshouse with a wrap-around window band
    const vanRings = [];
    for (let i = 0; i <= Q.cabRings; i++) {
      const t = i / Q.cabRings;
      const z = lerp(cabBack, cabFront, t);
      const shrink = 1 - 0.10 * smoothstep(0.88, 1, t) - 0.07 * (1 - smoothstep(0, 0.12, t));
      const top = roofY - 0.03 * (1 - Math.cos(t * Math.PI * 2)) * 0.5;
      const mid = (beltY - 0.02 + top) / 2;
      vanRings.push({
        z, cy: mid,
        pts: ringProfile((W / 2) * 0.99 * shrink, beltY - 0.02, top, 3.4, 6, Q.cabPts)
      });
    }
    paint.push(tint(loftGeometry(vanRings), 0xffffff));

    const bandH = cabH * 0.44;
    const bandY = beltY + cabH * 0.62;
    glass.push(box(W * 1.002, bandH, cabLen * 0.9, 0, bandY, cabMid, 0x27384a));
    glass.push(box(W * 0.86, bandH * 1.05, 0.08, 0, bandY, cabFront + 0.01, 0x27384a));
    glass.push(box(W * 0.86, bandH * 0.9, 0.08, 0, bandY, cabBack - 0.01, 0x27384a));
    detail.push(box(W * 0.88, bandH * 0.95, cabLen * 0.88, 0, bandY - 0.02, cabMid, 0x1a1d21));
  } else {
    const roofBack = cabBack + cabLen * (spec.roofBack ?? 0.18);
    const roofFront = cabFront - cabLen * (spec.roofFront ?? 0.3);

    // roofline: rises off the belt at both screens, gently domed between them
    const roofAt = (z) => {
      const up = smoothstep(cabBack, roofBack, z);
      const down = 1 - smoothstep(roofFront, cabFront, z);
      const span = Math.max(0.001, roofFront - roofBack);
      const crown = 1 - 0.04 * Math.pow((2 * (z - roofBack)) / span - 1, 2);
      return beltY + (roofY - beltY) * Math.min(up, down) * crown;
    };

    const cabRings = [];
    for (let i = 0; i <= Q.cabRings; i++) {
      const t = i / Q.cabRings;
      const z = lerp(cabBack, cabFront, t);
      const top = Math.max(beltY + 0.04, roofAt(z));
      const pinch = 1 - 0.11 * (1 - smoothstep(0, 0.16, t)) - 0.13 * smoothstep(0.84, 1, t);
      const mid = (beltY - 0.02 + top) / 2;
      cabRings.push({
        z, cy: mid,
        pts: ringProfile(W * 0.468 * pinch, beltY - 0.02, top, 2.7, 7, Q.cabPts)
      });
    }
    glass.push(tint(loftGeometry(cabRings), 0x24323f));

    // The cabin interior has to stay under the roofline: a box spanning the
    // whole glasshouse pokes straight through the raked screens and reads as
    // a flat black plate lying on the bonnet.
    const inBack = roofBack + (roofFront - roofBack) * 0.04;
    const inFront = roofFront - (roofFront - roofBack) * 0.04;
    const inMid = (inBack + inFront) / 2;
    const inLen = Math.max(0.25, inFront - inBack);
    detail.push(box(W * 0.7, cabH * 0.46, inLen, 0, beltY + cabH * 0.23, inMid, 0x16191d));
    for (const sx of [-1, 1]) {
      detail.push(roundedBlock(W * 0.17, 0.16, 0.12, sx * W * 0.18,
        beltY + cabH * 0.5, inMid - inLen * 0.12, 0x24272c, 3));
    }
    // dashboard, tucked just under the base of the windscreen
    detail.push(box(W * 0.64, 0.06, 0.2, 0, beltY + cabH * 0.14, inFront + 0.06, 0x2a2e33));

    // ---- roof skin and pillars, cut from the glasshouse surface -----------
    const N = Q.cabPts;
    const ringAtZ = (z) => clamp(
      Math.round(((z - cabBack) / Math.max(0.001, cabLen)) * Q.cabRings), 0, Q.cabRings
    );
    const topBand = Math.max(2, Math.round(N * 0.15));
    const sideBand = Math.max(1, Math.round(N * 0.06));
    const quarter = Math.round(N / 4);
    const half = Math.round(N / 2);

    const rb = ringAtZ(roofBack);
    const rf = ringAtZ(roofFront);
    if (rf > rb) {
      paint.push(tint(subPatch(cabRings, rb, rf, quarter - topBand, quarter + topBand, 1.012), 0xffffff));
    }

    const pillar = (za, zb) => {
      const a = ringAtZ(Math.min(za, zb));
      const b = ringAtZ(Math.max(za, zb));
      if (b <= a) return;
      for (const centre of [0, half]) {
        const patch = subPatch(cabRings, a, b, centre - sideBand, centre + sideBand, 1.014);
        if (patch) paint.push(tint(patch, 0xffffff));
      }
    };
    pillar(cabBack, roofBack);                                // C-pillar
    pillar(cabMid - cabLen * 0.05, cabMid + cabLen * 0.05);   // B-pillar
    pillar(roofFront, cabFront);                              // A-pillar

    // A thin strip around the foot of the glasshouse. It has to be cut from
    // the glass surface itself — a full-width box laid flat at the belt line
    // shows up from above as a black plate covering the bonnet.
    const skirt = subPatch(cabRings, 0, Q.cabRings, 0, N - 1, 1.008);
    if (skirt) {
      const pos = skirt.attributes.position;
      // flatten the strip onto the belt line so only its edge is visible
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, Math.min(pos.getY(i), beltY + 0.035));
      }
      skirt.computeVertexNormals();
      detail.push(tint(skirt, 0x2a2e33));
    }
  }

  // ---------------------------------------------------------------- extras
  if (spec.bed) {
    const bedBack = tailZ + 0.06;
    const bedFront = cabBack - 0.04;
    const bedY = beltY + 0.24;
    paint.push(box(W * 0.98, 0.5, 0.09, 0, bedY, bedBack, 0xffffff));
    for (const sx of [-1, 1]) {
      paint.push(box(0.09, 0.5, bedFront - bedBack, sx * W * 0.485, bedY, (bedBack + bedFront) / 2, 0xffffff));
    }
    detail.push(box(W * 0.92, 0.05, bedFront - bedBack, 0, beltY + 0.01, (bedBack + bedFront) / 2, 0x3a3d42));
  }

  if (spec.spoiler) {
    detail.push(roundedBlock(W * 0.84, 0.06, 0.3, 0, beltY + 0.3, tailZ + 0.3, 0x1c1e22, 3));
    for (const sx of [-1, 1]) {
      detail.push(box(0.06, 0.28, 0.2, sx * W * 0.34, beltY + 0.16, tailZ + 0.32, 0x1c1e22));
    }
  }

  if (spec.roofRack) {
    for (const sx of [-1, 1]) {
      detail.push(roundedBlock(0.07, 0.07, cabLen * 0.76, sx * W * 0.27, roofY + 0.07, cabMid, 0x2c3036, 3));
    }
    for (const dz of [-0.28, 0.28]) {
      detail.push(box(W * 0.58, 0.05, 0.05, 0, roofY + 0.07, cabMid + cabLen * dz, 0x2c3036));
    }
  }

  if (spec.taxiSign) {
    detail.push(roundedBlock(0.74, 0.07, 0.3, 0, roofY + 0.05, cabMid + 0.1, 0x111111, 3));
    signGeos.push(roundedBlock(0.66, 0.15, 0.24, 0, roofY + 0.14, cabMid + 0.1, 0xffd23f, 3));
  }

  if (spec.lightBar) {
    const z = cabMid + 0.12;
    detail.push(roundedBlock(1.16, 0.07, 0.26, 0, roofY + 0.05, z, 0x16181c, 3));
    signGeos.push(roundedBlock(0.5, 0.13, 0.21, -0.3, roofY + 0.13, z, 0x2a5cff, 3));
    signGeos.push(roundedBlock(0.5, 0.13, 0.21, 0.3, roofY + 0.13, z, 0xff2a2a, 3));
  }

  if (spec.acUnit) {
    detail.push(roundedBlock(W * 0.5, 0.2, 1.1, 0, roofY + 0.1, cabBack + cabLen * 0.18, 0xd8d8d4, 3));
  }

  if (spec.bullBar) {
    const y = sillY + 0.3;
    detail.push(roundedBlock(W * 0.84, 0.09, 0.09, 0, y, noseZ + 0.16, 0x9aa0a8, 3));
    for (const sx of [-1, 1]) {
      detail.push(box(0.07, 0.46, 0.08, sx * W * 0.29, y + 0.2, noseZ + 0.16, 0x9aa0a8));
    }
  }

  // ------------------------------------------------- bumpers, trim, lights
  // Bumpers are lofted from the body silhouette, so they wrap the corners
  // instead of sitting on the nose like a bolted-on brick.
  const bumperLoft = (zInner, zOuter, yLo, yHi) => {
    const rings = [];
    const steps = Math.max(3, Math.round(Q.rings * 0.14));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const z = lerp(zInner, zOuter, t);
      const w = halfWidthAt(z) * (1.005 - 0.30 * Math.pow(t, 3));
      const top = lerp(yHi, (yLo + yHi) / 2 + 0.02, Math.pow(t, 2.4));
      const mid = (yLo + top) / 2;
      rings.push({ z, cy: mid, pts: ringProfile(w, yLo, top, 3, 4, Q.pts) });
    }
    return tint(loftGeometry(rings), 0x34383e);
  };
  const bumpLo = sillY + spec.bodyHeight * 0.02;
  const bumpHi = sillY + spec.bodyHeight * 0.36;
  detail.push(bumperLoft(noseZ - 0.12, noseZ + 0.08, bumpLo, bumpHi));
  detail.push(bumperLoft(tailZ + 0.12, tailZ - 0.08, bumpLo, bumpHi));

  const grilleY = sillY + spec.bodyHeight * 0.62;
  detail.push(roundedBlock(W * 0.5, spec.bodyHeight * 0.24, 0.1, 0, grilleY, noseZ - 0.03, 0x16181c, 3));
  detail.push(box(W * 0.25, 0.11, 0.03, 0, bumpLo + 0.16, noseZ + 0.04, 0xc9ced6));
  detail.push(box(W * 0.25, 0.11, 0.03, 0, bumpLo + 0.16, tailZ - 0.04, 0xc9ced6));

  for (const sx of [-1, 1]) {
    detail.push(box(0.07, 0.045, 0.11, sx * W * 0.49, beltY + 0.07, cabFront - 0.1, 0x2a2d32));
    detail.push(roundedBlock(0.16, 0.11, 0.07, sx * W * 0.56, beltY + 0.08, cabFront - 0.1, 0x2a2d32, 3));
    detail.push(roundedBlock(0.04, 0.05, 0.17, sx * (W / 2 - 0.01), beltY - 0.17,
      cabMid - cabLen * 0.1, 0x33373d, 3));
    detail.push(roundedBlock(0.04, 0.05, 0.17, sx * (W / 2 - 0.01), beltY - 0.17,
      cabMid + cabLen * 0.2, 0x33373d, 3));
  }

  detail.push(roundedBlock(0.1, 0.1, 0.16, W * 0.26, sillY - 0.05, tailZ - 0.06, 0x7d838b, 3));

  // lamps, sunk slightly into the bodywork
  const hy = sillY + spec.bodyHeight * 0.58;
  for (const sx of [-1, 1]) {
    headGeos.push(roundedBlock(W * 0.26, 0.15, 0.1, sx * W * 0.30, hy, noseZ - 0.03, 0xfff3d6, Q.blockSeg));
    signGeos.push(roundedBlock(W * 0.09, 0.1, 0.08, sx * W * 0.44, hy - 0.03, noseZ - 0.04, 0xff9a1f, 3));
  }
  const ty = sillY + spec.bodyHeight * 0.6;
  for (const sx of [-1, 1]) {
    tailGeos.push(roundedBlock(W * 0.24, 0.17, 0.1, sx * W * 0.31, ty, tailZ + 0.03, 0xd8241f, Q.blockSeg));
  }

  // ------------------------------------------------------------- wheels
  const wheel = wheelGeometry(wheelR, wheelW, Q.wheelSeg);
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
    // everything that glows, merged for the instanced traffic cars
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
  paint: () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.26, metalness: 0.6 }),
  detail: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.3 }),
  glass: () => new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.06, metalness: 0.2,
    transparent: true, opacity: 0.66
  }),
  glow: () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: 0x555555 })
};

/**
 * Full-detail car for the player: separate steerable front wheels and
 * light groups that can flare under braking or reversing.
 */
export function createPlayerCar(spec, colourHex) {
  const parts = buildCarParts(spec, 'high');
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
