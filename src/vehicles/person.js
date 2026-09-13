import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * People. Low-polygon in the way the mid-2000s open-world games were —
 * chunky limbs and blocky torsos — but with the face actually modelled:
 * brow, nose, lips, ears and eyes are geometry, not a texture, so a head
 * still reads as a face up close.
 *
 * The skeleton is deliberately simple: a hip group, a chest group on top of
 * it, and four limb chains hung off those. Everything the walk cycle needs
 * is a rotation on one of nine joints, which keeps the animation cheap
 * enough to run on a crowd.
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

/** Box with the corners pulled in, so limbs are not raw bricks. */
function limb(w, h, d, taper = 0.82) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 2, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < -h * 0.24) {
      pos.setX(i, pos.getX(i) * taper);
      pos.setZ(i, pos.getZ(i) * taper);
    }
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A head with a face on it. Everything is placed in a 0.23 m tall skull
 * so the proportions hold whatever the body size.
 */
function headGeometry(skin, hair, seg) {
  const parts = [];

  // skull: a sphere squeezed into a human-ish oval, jaw flattened
  const skull = new THREE.SphereGeometry(0.115, seg, seg);
  skull.scale(0.92, 1.12, 1.0);
  const sp = skull.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const y = sp.getY(i);
    const z = sp.getZ(i);
    // narrow the jaw and push the chin forward
    if (y < -0.02) {
      const t = Math.min(1, (-y - 0.02) / 0.1);
      sp.setX(i, sp.getX(i) * (1 - 0.28 * t));
      if (z > 0) sp.setZ(i, z + 0.012 * t);
    }
    // flatten the back of the head slightly
    if (z < -0.05) sp.setZ(i, z * 0.94);
  }
  skull.computeVertexNormals();
  parts.push(tint(skull, skin));

  // brow ridge — a hint of one; any deeper and it reads as a visor
  const brow = new THREE.BoxGeometry(0.126, 0.015, 0.026);
  brow.translate(0, 0.042, 0.094);
  parts.push(tint(brow, skin));

  // nose: a small wedge, bridge up between the eyes
  const nose = new THREE.ConeGeometry(0.023, 0.055, 4);
  nose.rotateX(Math.PI / 2);
  nose.rotateZ(Math.PI / 4);
  nose.translate(0, -0.014, 0.112);
  parts.push(tint(nose, skin));
  const bridge = new THREE.BoxGeometry(0.026, 0.05, 0.02);
  bridge.translate(0, 0.016, 0.102);
  parts.push(tint(bridge, skin));

  // lips and the shadow between them
  const lip = new THREE.BoxGeometry(0.05, 0.016, 0.018);
  lip.translate(0, -0.062, 0.1);
  parts.push(tint(lip, 0x6e3a33));
  const mouth = new THREE.BoxGeometry(0.044, 0.004, 0.005);
  mouth.translate(0, -0.062, 0.111);
  parts.push(tint(mouth, 0x25120f));

  // eyes: white, iris, and a lid line so they are not staring beads
  for (const sx of [-1, 1]) {
    const white = new THREE.SphereGeometry(0.0175, 8, 6);
    white.scale(1, 0.72, 0.62);
    white.translate(sx * 0.041, 0.016, 0.1);
    parts.push(tint(white, 0xeee8e0));

    const iris = new THREE.SphereGeometry(0.0088, 8, 6);
    iris.scale(1, 1, 0.55);
    iris.translate(sx * 0.042, 0.015, 0.111);
    parts.push(tint(iris, 0x2f2118));

    // upper lid, thin enough to be a lid and not a bar
    const lid = new THREE.BoxGeometry(0.04, 0.005, 0.016);
    lid.translate(sx * 0.041, 0.028, 0.101);
    parts.push(tint(lid, skin));

    // ear
    const ear = new THREE.SphereGeometry(0.024, 6, 5);
    ear.scale(0.35, 1, 0.7);
    ear.translate(sx * 0.104, -0.006, 0.0);
    parts.push(tint(ear, skin));
  }

  // Close-cropped hair. Only the crown: taken any further down the sphere it
  // swallows the brow and the whole head reads as a motorcycle helmet.
  const cap = new THREE.SphereGeometry(0.1185, seg, seg, 0, Math.PI * 2, 0, Math.PI * 0.40);
  cap.scale(0.95, 1.10, 1.01);
  cap.translate(0, 0.012, -0.006);
  parts.push(tint(cap, hair));

  // the hairline carried down to a short fade behind the ears
  const back = new THREE.SphereGeometry(0.1175, seg, seg, 0, Math.PI, Math.PI * 0.34, Math.PI * 0.30);
  back.rotateY(Math.PI);
  back.scale(0.95, 1.10, 1.01);
  back.translate(0, 0.012, -0.006);
  parts.push(tint(back, hair));

  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

/**
 * Shared geometry for the instanced city crowd.
 *
 * The close player character keeps the full joint hierarchy above.  Ninety
 * pedestrians cannot each own twenty meshes, though, so the crowd draws one
 * instanced mesh per anatomical part and supplies a different matrix for
 * every joint.  These are the same tapered proportions and the same modelled
 * face, just centred on their joints for fast forward-kinematics.
 */
export function createCrowdParts(quality = 'low') {
  const seg = quality === 'high' ? 10 : 7;
  const centre = (g) => g;
  return {
    pelvis: centre(limb(0.30, 0.20, 0.20, 0.88)),
    torso: centre(limb(0.36, 0.46, 0.23, 0.86)),
    head: headGeometry(0xb77a56, 0x24170f, seg),
    upperArm: centre(limb(0.115, 0.28, 0.115, 0.88)),
    foreArm: centre(limb(0.095, 0.27, 0.095, 0.84)),
    hand: centre(limb(0.082, 0.105, 0.06, 0.90)),
    thigh: centre(limb(0.15, 0.41, 0.16, 0.86)),
    shin: centre(limb(0.12, 0.40, 0.13, 0.82)),
    foot: new THREE.BoxGeometry(0.12, 0.08, 0.25)
  };
}

/**
 * Builds one person.
 * @param {object} look  skin, hair, shirt, trousers, shoes, build
 */
export function createPerson(look = {}, quality = 'high') {
  const seg = quality === 'high' ? 12 : 6;
  const skin = look.skin ?? 0x8d5a3b;
  const hair = look.hair ?? 0x1a1410;
  const shirt = look.shirt ?? 0x2f4f6f;
  const trousers = look.trousers ?? 0x2b2f38;
  const shoes = look.shoes ?? 0x17191c;
  // 1 is an average build; the player character is heavier through the
  // shoulders and arms, which is all `build` does
  const b = look.build ?? 1;

  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.82, metalness: 0.02
  });

  const mesh = (geo) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    return m;
  };

  // ---------------------------------------------------------------- hips
  const hips = new THREE.Group();
  hips.position.y = 0.90;
  root.add(hips);

  const pelvis = limb(0.30 * b, 0.20, 0.20);
  pelvis.translate(0, -0.05, 0);
  hips.add(mesh(tint(pelvis, trousers)));

  // --------------------------------------------------------------- chest
  const chest = new THREE.Group();
  chest.position.y = 0.10;
  hips.add(chest);

  const torso = limb(0.34 * b, 0.40, 0.22, 0.88);
  torso.translate(0, 0.19, 0);
  chest.add(mesh(tint(torso, shirt)));

  // shoulders, which is where the build really shows
  const yoke = limb(0.44 * b, 0.13, 0.24, 0.94);
  yoke.translate(0, 0.36, 0);
  chest.add(mesh(tint(yoke, shirt)));

  // neck
  const neck = new THREE.CylinderGeometry(0.05, 0.058, 0.09, 8);
  neck.translate(0, 0.46, 0);
  chest.add(mesh(tint(neck, skin)));

  // ---------------------------------------------------------------- head
  const head = new THREE.Group();
  head.position.y = 0.51;
  chest.add(head);
  head.add(mesh(headGeometry(skin, hair, seg)));

  // ---------------------------------------------------------------- arms
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.22 * b, 0.36, 0);
    chest.add(shoulder);

    const upper = limb(0.115 * b, 0.28, 0.115 * b, 0.9);
    upper.translate(0, -0.14, 0);
    shoulder.add(mesh(tint(upper, shirt)));

    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    shoulder.add(elbow);

    const fore = limb(0.10 * b, 0.26, 0.10 * b, 0.86);
    fore.translate(0, -0.13, 0);
    elbow.add(mesh(tint(fore, skin)));

    const hand = limb(0.085, 0.11, 0.055);
    hand.translate(0, -0.31, 0);
    elbow.add(mesh(tint(hand, skin)));

    arms.push({ shoulder, elbow, side });
  }

  // ---------------------------------------------------------------- legs
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.085, -0.12, 0);
    hips.add(hip);

    const thigh = limb(0.145, 0.40, 0.15, 0.88);
    thigh.translate(0, -0.20, 0);
    hip.add(mesh(tint(thigh, trousers)));

    const knee = new THREE.Group();
    knee.position.y = -0.40;
    hip.add(knee);

    const shin = limb(0.12, 0.40, 0.125, 0.86);
    shin.translate(0, -0.20, 0);
    knee.add(mesh(tint(shin, trousers)));

    const foot = new THREE.BoxGeometry(0.115, 0.075, 0.24);
    foot.translate(0, -0.44, 0.05);
    knee.add(mesh(tint(foot, shoes)));

    legs.push({ hip, knee, side });
  }

  return { root, hips, chest, head, arms, legs, mat };
}

/**
 * Drives a person's joints. `speed` in m/s picks between standing, walking
 * and running; `t` is a phase that the caller advances.
 */
export function poseWalk(p, t, speed, seated = false) {
  if (seated) {
    // folded into a car seat
    p.hips.position.y = 0.62;
    for (const l of p.legs) {
      l.hip.rotation.x = -1.35;
      l.knee.rotation.x = 1.25;
    }
    for (const a of p.arms) {
      a.shoulder.rotation.x = -0.55;
      a.elbow.rotation.x = -0.75;
      a.shoulder.rotation.z = -a.side * 0.18;
    }
    p.chest.rotation.x = 0.12;
    p.head.rotation.set(0, 0, 0);
    return;
  }

  const run = Math.min(1, Math.max(0, (speed - 1.9) / 2.6));
  const amp = Math.min(1, speed / 1.5);            // stride grows with pace
  const swing = (0.42 + run * 0.34) * amp;
  const armSwing = (0.36 + run * 0.42) * amp;

  p.hips.position.y = 0.90 - run * 0.04;

  for (const l of p.legs) {
    const ph = t + (l.side > 0 ? 0 : Math.PI);
    const s = Math.sin(ph);
    l.hip.rotation.x = s * swing;
    // the knee only bends on the way through, never backwards
    l.knee.rotation.x = Math.max(0, -Math.cos(ph) + 0.35) * (0.7 + run * 0.9) * amp;
  }

  for (const a of p.arms) {
    const ph = t + (a.side > 0 ? Math.PI : 0);
    a.shoulder.rotation.x = Math.sin(ph) * armSwing;
    a.shoulder.rotation.z = -a.side * (0.10 + run * 0.10);
    a.elbow.rotation.x = -(0.25 + run * 0.55) * amp - Math.max(0, Math.sin(ph)) * 0.3 * amp;
  }

  // the body bobs twice per stride and leans into a run
  p.hips.position.y += Math.abs(Math.sin(t)) * 0.035 * amp;
  p.chest.rotation.x = run * 0.16 + amp * 0.03;
  p.chest.rotation.y = Math.sin(t) * 0.07 * amp;
  p.head.rotation.y = -Math.sin(t) * 0.05 * amp;
  p.head.rotation.x = -run * 0.1;
}
