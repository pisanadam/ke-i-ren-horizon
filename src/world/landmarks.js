import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANDMARKS, TELEFERIK } from './mapData.js';
import { flagTexture, signTexture } from '../textures.js';
import { makeRng, randRange, lerp } from '../util/math.js';

/**
 * The buildings that make the district recognisable: Estergon Kalesi on its
 * hill, the cable car that runs from it across the valley, Etlik City
 * Hospital, the town hall, Atapark mosque, Aktepe stadium, the botanical
 * garden, the metro entrance and a handful of everyday civic buildings.
 */

const COL = {
  stone: 0xb9ad96,
  stoneDark: 0x9c9280,
  roofRed: 0x8f3b2c,
  white: 0xe9e7e0,
  concrete: 0xc6c2b8,
  blue: 0x2f5f96,
  glassTint: 0x3d5f7a,
  metal: 0x8d939b,
  green: 0x3f7a3a,
  pitch: 0x2f7a3c,
  sand: 0xd3c39a,
  dark: 0x2b3037,
  gold: 0xc9a227
};

function tint(geo, colour) {
  const c = new THREE.Color(colour);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Small builder that accumulates tinted geometry in world space. */
class Kit {
  constructor(origin, rot) {
    this.solid = [];
    this.glass = [];
    this.glow = [];
    this.m = new THREE.Matrix4()
      .makeTranslation(origin.x, origin.y, origin.z)
      .multiply(new THREE.Matrix4().makeRotationY(rot));
  }

  _place(geo, x, y, z, rotY = 0, bucket = 'solid', colour = COL.stone) {
    if (rotY) geo.rotateY(rotY);
    geo.translate(x, y, z);
    geo.applyMatrix4(this.m);
    this[bucket].push(tint(geo, colour));
    return geo;
  }

  box(w, h, d, x, y, z, colour = COL.stone, rotY = 0, bucket = 'solid') {
    return this._place(new THREE.BoxGeometry(w, h, d), x, y, z, rotY, bucket, colour);
  }

  cyl(rt, rb, h, seg, x, y, z, colour = COL.stone, rotY = 0, bucket = 'solid') {
    return this._place(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rotY, bucket, colour);
  }

  cone(r, h, seg, x, y, z, colour = COL.roofRed, rotY = 0, bucket = 'solid') {
    return this._place(new THREE.ConeGeometry(r, h, seg), x, y, z, rotY, bucket, colour);
  }

  dome(r, seg, x, y, z, colour = COL.white, bucket = 'solid') {
    const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg / 2), 0, Math.PI * 2, 0, Math.PI / 2);
    return this._place(g, x, y, z, 0, bucket, colour);
  }

  /** World position of a local point (used for cable-car anchors etc.). */
  toWorld(x, y, z) {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.m);
  }
}

function crenellate(kit, cx, cz, length, height, thickness, rotY, colour) {
  const merlons = Math.max(2, Math.floor(length / 2.2));
  for (let i = 0; i < merlons; i++) {
    if (i % 2) continue;
    const t = (i / (merlons - 1) - 0.5) * length;
    const ox = Math.cos(rotY) * t;
    const oz = -Math.sin(rotY) * t;
    kit.box(1.1, 0.9, thickness, cx + ox, height + 0.45, cz + oz, colour, rotY);
  }
}

// ---------------------------------------------------------------- ESTERGON
function estergon(kit) {
  const R = 34;
  // rock plinth
  kit.cyl(R + 5, R + 9, 7, 12, 0, -2, 0, COL.stoneDark);
  kit.cyl(R + 2, R + 4, 2.2, 12, 0, 2.2, 0, COL.stone);

  // curtain wall — a square with round corner towers
  const wallH = 9.5;
  const half = 26;
  const sides = [
    { x: 0, z: half, rot: 0, len: half * 2 },
    { x: 0, z: -half, rot: 0, len: half * 2 },
    { x: half, z: 0, rot: Math.PI / 2, len: half * 2 },
    { x: -half, z: 0, rot: Math.PI / 2, len: half * 2 }
  ];
  for (const s of sides) {
    kit.box(s.len, wallH, 2.4, s.x, 3.2 + wallH / 2, s.z, COL.stone, s.rot);
    crenellate(kit, s.x, s.z, s.len - 3, 3.2 + wallH, 2.4, s.rot, COL.stoneDark);
  }

  // corner towers with conical roofs
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const tx = sx * half;
    const tz = sz * half;
    kit.cyl(4.2, 4.8, 15, 12, tx, 3.2 + 7.5, tz, COL.stone);
    kit.cyl(4.7, 4.7, 1.1, 12, tx, 3.2 + 15.2, tz, COL.stoneDark);
    kit.cone(5.4, 7.5, 12, tx, 3.2 + 19.4, tz, COL.roofRed);
    kit.box(0.14, 2.4, 0.14, tx, 3.2 + 24.2, tz, COL.metal);
  }

  // gatehouse
  kit.box(11, 12.5, 5, 0, 3.2 + 6.25, half, COL.stone);
  kit.box(4.6, 6.6, 6.2, 0, 3.2 + 3.3, half, COL.dark);
  kit.cyl(2.3, 2.3, 6.2, 12, 0, 3.2 + 6.6, half, COL.dark, Math.PI / 2);
  crenellate(kit, 0, half, 10, 3.2 + 12.5, 5, 0, COL.stoneDark);

  // keep
  kit.box(20, 20, 16, 0, 3.2 + 10, -4, COL.stone);
  kit.box(21, 1.2, 17, 0, 3.2 + 20.4, -4, COL.stoneDark);
  const roof = new THREE.ConeGeometry(15, 11, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 3.2 + 26.5, -4);
  roof.applyMatrix4(kit.m);
  kit.solid.push(tint(roof, COL.roofRed));

  // stair tower
  kit.cyl(3.2, 3.6, 26, 10, 9, 3.2 + 13, 3, COL.stone);
  kit.cone(4.2, 6, 10, 9, 3.2 + 29, 3, COL.roofRed);

  // windows facing the valley
  for (let i = -1; i <= 1; i++) {
    kit.box(1.6, 2.6, 0.3, i * 6, 3.2 + 13, -12.2, COL.dark, 0, 'glow');
  }

  // flag
  kit.cyl(0.1, 0.1, 9, 6, -9, 3.2 + 24, 3, COL.metal);
  return {
    flag: kit.toWorld(-9, 3.2 + 27.2, 3),
    top: kit.toWorld(0, 3.2 + 22, -4)
  };
}

// ---------------------------------------------------------------- HOSPITAL
function hospital(kit) {
  // podium
  kit.box(120, 9, 62, 0, 4.5, 0, COL.white);
  kit.box(122, 1.2, 64, 0, 9.6, 0, COL.concrete);

  // three ward towers
  const towers = [-40, 0, 40];
  towers.forEach((tx, i) => {
    const h = 34 + i * 6;
    kit.box(26, h, 26, tx, 9 + h / 2, -6, COL.white);
    // glazed stair core
    kit.box(6, h, 6.4, tx + 13.4, 9 + h / 2, -6, COL.glassTint, 0, 'glass');
    // window bands
    for (let f = 1; f < Math.floor(h / 3.6); f++) {
      kit.box(26.4, 1.7, 26.4, tx, 9 + f * 3.6, -6, COL.glassTint, 0, 'glass');
    }
    kit.box(27, 1, 27, tx, 9 + h + 0.5, -6, COL.concrete);
    // rooftop plant
    kit.box(8, 2.6, 6, tx - 5, 9 + h + 2.3, -6, COL.metal);
  });

  // entrance canopy
  kit.box(46, 1.1, 16, 0, 10.6, 34, COL.blue);
  for (const x of [-20, -7, 7, 20]) {
    kit.cyl(0.55, 0.55, 10, 8, x, 5.2, 40, COL.concrete);
  }
  kit.box(44, 8.4, 1.2, 0, 4.6, 26.6, COL.glassTint, 0, 'glass');

  // helipad
  kit.cyl(9, 9, 0.4, 20, 34, 10.2, 22, COL.dark);
  kit.box(1.6, 0.12, 7, 34, 10.5, 22, COL.white);
  kit.box(7, 0.12, 1.6, 34, 10.5, 22, COL.white);
  kit.cyl(9.4, 9.4, 0.12, 24, 34, 10.55, 22, COL.white);
  kit.cyl(8.4, 8.4, 0.14, 24, 34, 10.6, 22, COL.dark);

  // ambulance bay marking
  kit.box(26, 0.06, 10, -38, 0.35, 34, COL.blue);

  return { sign: kit.toWorld(0, 13.5, 34.2), signRot: 0 };
}

// ---------------------------------------------------------------- BELEDİYE
function belediye(kit) {
  kit.box(54, 3, 34, 0, 1.5, 0, COL.concrete);
  kit.box(46, 17, 26, 0, 3 + 8.5, 0, COL.sand);
  kit.box(48, 1.4, 28, 0, 3 + 17.7, 0, COL.stoneDark);
  // colonnade
  for (let i = -4; i <= 4; i++) {
    kit.cyl(0.85, 0.95, 14, 10, i * 5, 3 + 7, 14.6, COL.white);
  }
  kit.box(46, 2.4, 3, 0, 3 + 15.2, 14.6, COL.white);
  // glazing between the columns
  kit.box(40, 12, 0.4, 0, 3 + 7, 12.4, COL.glassTint, 0, 'glass');
  // clock/emblem block
  kit.box(10, 8, 10, 0, 3 + 21, 0, COL.sand);
  kit.cyl(3, 3, 0.5, 16, 0, 3 + 24, 5.2, COL.white, Math.PI / 2);
  // steps
  for (let i = 0; i < 4; i++) {
    kit.box(30 - i * 1.5, 0.35, 2 + i * 1.4, 0, 0.2 + i * 0.35, 19 + i * 1.2, COL.concrete);
  }
  return {
    flag: kit.toWorld(-20, 3 + 18, 12),
    flag2: kit.toWorld(20, 3 + 18, 12),
    sign: kit.toWorld(0, 3 + 19.4, 13.2)
  };
}

// ------------------------------------------------------------------- CAMİİ
function camii(kit) {
  // courtyard wall
  const R = 30;
  for (const s of [[0, R, 0], [0, -R, 0], [R, 0, Math.PI / 2], [-R, 0, Math.PI / 2]]) {
    kit.box(R * 2, 2.4, 0.6, s[0], 1.2, s[1], COL.sand, s[2]);
  }
  // prayer hall
  kit.box(30, 12, 30, 0, 6, 0, COL.sand);
  kit.box(32, 1.4, 32, 0, 12.7, 0, COL.stoneDark);
  // drum + dome
  kit.cyl(11, 11.6, 4.5, 20, 0, 15.6, 0, COL.sand);
  kit.dome(11.4, 22, 0, 17.8, 0, COL.white);
  kit.cyl(0.22, 0.22, 3.4, 6, 0, 30.6, 0, COL.gold);
  // half domes
  for (const [dx, dz] of [[0, 15], [0, -15], [15, 0], [-15, 0]]) {
    kit.dome(6.2, 14, dx, 12.4, dz, COL.white);
  }
  // minarets
  for (const mx of [-17, 17]) {
    kit.box(3, 2.4, 3, mx, 1.2, 17, COL.sand);
    kit.cyl(1.05, 1.35, 26, 12, mx, 15.4, 17, COL.white);
    kit.cyl(1.7, 1.7, 1.1, 12, mx, 27.5, 17, COL.stoneDark);
    kit.cyl(0.95, 1.05, 8, 12, mx, 32.2, 17, COL.white);
    kit.cone(1.5, 4.4, 12, mx, 38.4, 17, COL.metal);
    kit.cyl(0.14, 0.14, 1.8, 6, mx, 41.4, 17, COL.gold);
    // balcony light
    kit.cyl(1.75, 1.75, 0.3, 12, mx, 27.9, 17, 0xffe0a0, 0, 'glow');
  }
  // arched portico
  for (let i = -2; i <= 2; i++) {
    kit.cyl(0.6, 0.6, 6.5, 10, i * 6, 3.25, 17.5, COL.white);
  }
  kit.box(30, 1.2, 3, 0, 7, 17.5, COL.sand);
  return {};
}

// ---------------------------------------------------------------- STADYUM
function stadyum(kit) {
  const A = 62;
  const B = 44;
  // pitch
  const pitch = new THREE.CircleGeometry(1, 40);
  pitch.scale(A - 20, 1, B - 16);
  pitch.rotateX(-Math.PI / 2);
  pitch.translate(0, 0.25, 0);
  pitch.applyMatrix4(kit.m);
  kit.solid.push(tint(pitch, COL.pitch));

  // running track / surround
  const track = new THREE.RingGeometry(0.82, 1, 40);
  track.rotateX(-Math.PI / 2);
  track.scale(A - 6, 1, B - 4);
  track.translate(0, 0.2, 0);
  track.applyMatrix4(kit.m);
  kit.solid.push(tint(track, 0x9c4a34));

  // stands: a ring of raked blocks
  const seg = 30;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = Math.cos(a) * (A - 2);
    const z = Math.sin(a) * (B - 2);
    const rot = -Math.atan2(z, x) + Math.PI / 2;
    const w = (Math.PI * 2 * ((A + B) / 2)) / seg + 3;
    kit.box(w, 9, 14, x * 1.06, 4.5, z * 1.08, COL.concrete, rot);
    kit.box(w, 1.4, 15, x * 1.1, 9.6, z * 1.12, i % 3 === 0 ? COL.blue : 0xb0392f, rot);
    // roof
    kit.box(w, 0.5, 13, x * 1.13, 14.5, z * 1.16, COL.metal, rot);
    kit.box(0.5, 5.5, 0.5, x * 1.2, 12, z * 1.24, COL.metal, rot);
  }

  // floodlights
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = sx * (A - 6);
    const z = sz * (B - 6);
    kit.cyl(0.5, 0.8, 30, 8, x, 15, z, COL.metal);
    kit.box(9, 4, 1.2, x, 31, z, COL.dark, -Math.atan2(z, x));
    kit.box(8.4, 3.4, 0.5, x * 0.985, 31, z * 0.985, 0xfff2cc, -Math.atan2(z, x), 'glow');
  }
  return {};
}

// ----------------------------------------------------------------- BOTANİK
function botanik(kit, rng) {
  // pond
  const pond = new THREE.CircleGeometry(1, 32);
  pond.scale(48, 1, 34);
  pond.rotateX(-Math.PI / 2);
  pond.translate(-18, 0.3, 10);
  pond.applyMatrix4(kit.m);
  kit.glass.push(tint(pond, 0x2f6b86));

  // pond rim
  const rim = new THREE.RingGeometry(0.94, 1.02, 32);
  rim.rotateX(-Math.PI / 2);
  rim.scale(50, 1, 36);
  rim.translate(-18, 0.42, 10);
  rim.applyMatrix4(kit.m);
  kit.solid.push(tint(rim, COL.concrete));

  // greenhouse
  kit.box(34, 6, 20, 44, 3, -22, COL.white);
  const gh = new THREE.CylinderGeometry(10.6, 10.6, 34, 18, 1, false, 0, Math.PI);
  gh.rotateZ(Math.PI / 2);
  gh.rotateY(Math.PI / 2);
  gh.translate(44, 6, -22);
  gh.applyMatrix4(kit.m);
  kit.glass.push(tint(gh, 0x9fd9e8));
  kit.box(35, 0.5, 0.5, 44, 6.2, -12, COL.white);

  // pergola walk
  for (let i = 0; i < 14; i++) {
    const x = -70 + i * 9;
    kit.cyl(0.22, 0.26, 3.4, 6, x, 1.7, -52, 0x8a6a42);
    kit.cyl(0.22, 0.26, 3.4, 6, x, 1.7, -44, 0x8a6a42);
    kit.box(1.2, 0.18, 9.6, x, 3.5, -48, 0x8a6a42);
  }

  // bandstand
  kit.cyl(7, 7.4, 0.6, 12, 30, 0.4, 40, COL.concrete);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    kit.cyl(0.2, 0.2, 4.2, 6, 30 + Math.cos(a) * 6.2, 2.8, 40 + Math.sin(a) * 6.2, COL.white);
  }
  kit.cone(8.2, 3.4, 12, 30, 6.6, 40, COL.roofRed);

  // playground bits
  for (let i = 0; i < 6; i++) {
    const x = randRange(rng, -40, 20);
    const z = randRange(rng, 46, 66);
    kit.box(1.4, 0.5, 1.4, x, 0.6, z, 0xd06a2a);
    kit.cyl(0.12, 0.12, 2, 6, x, 1.4, z, COL.metal);
  }

  // park lamps
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const x = Math.cos(a) * randRange(rng, 55, 95);
    const z = Math.sin(a) * randRange(rng, 45, 80);
    kit.cyl(0.1, 0.14, 4.2, 6, x, 2.1, z, COL.dark);
    kit.dome(0.45, 8, x, 4.3, z, 0xffe6b0, 'glow');
  }
  return {};
}

// ------------------------------------------------------------------- METRO
function metro(kit) {
  kit.box(18, 0.6, 12, 0, 0.3, 0, COL.concrete);
  // stair well
  kit.box(11, 0.5, 7, 0, 0.1, 0, COL.dark);
  for (let i = 0; i < 7; i++) {
    kit.box(10, 0.3, 0.9, 0, -0.1 - i * 0.32, -2.6 + i * 0.9, COL.concrete);
  }
  // glass canopy
  kit.box(13, 0.3, 9, 0, 4.2, 0, COL.metal);
  const cover = new THREE.CylinderGeometry(6.6, 6.6, 13, 14, 1, false, 0, Math.PI);
  cover.rotateZ(Math.PI / 2);
  cover.translate(0, 4.2, 0);
  cover.applyMatrix4(kit.m);
  kit.glass.push(tint(cover, 0x8fc7de));
  for (const [x, z] of [[-6, -4.2], [6, -4.2], [-6, 4.2], [6, 4.2]]) {
    kit.cyl(0.2, 0.2, 4.4, 8, x, 2.2, z, COL.metal);
  }
  // rail-red "M" totem
  kit.cyl(0.24, 0.24, 6, 8, 8.5, 3, 5.5, COL.metal);
  return { sign: kit.toWorld(8.5, 6.4, 5.5) };
}

// -------------------------------------------------------------- KÜLTÜR MRK
function kultur(kit) {
  kit.box(44, 14, 26, 0, 7, 0, COL.sand);
  kit.box(46, 1.2, 28, 0, 14.6, 0, COL.stoneDark);
  // angled glazed foyer
  const foyer = new THREE.BoxGeometry(30, 11, 12);
  foyer.rotateY(0.22);
  foyer.translate(2, 5.5, 17);
  foyer.applyMatrix4(kit.m);
  kit.glass.push(tint(foyer, COL.glassTint));
  kit.box(32, 0.8, 14, 2, 11.4, 17, COL.white, 0.22);
  // fly tower
  kit.box(16, 22, 16, -12, 11, -4, COL.concrete);
  // relief fins
  for (let i = -5; i <= 5; i++) {
    kit.box(0.6, 12, 1.4, i * 3.6, 7.5, 13.4, COL.white);
  }
  return { sign: kit.toWorld(2, 12.4, 23.4) };
}

// -------------------------------------------------------------------- PAZAR
function pazar(kit, rng) {
  kit.box(70, 0.4, 46, 0, 0.2, 0, COL.concrete);
  const awning = [0xd94f4f, 0x3f7fbf, 0x4faf5f, 0xe0a83f, 0xffffff];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 7; c++) {
      const x = -30 + c * 10;
      const z = -18 + r * 9;
      kit.box(8.4, 0.25, 7, x, 3.1, z, awning[(r + c) % awning.length]);
      for (const [ox, oz] of [[-3.8, -3], [3.8, -3], [-3.8, 3], [3.8, 3]]) {
        kit.cyl(0.07, 0.07, 3, 5, x + ox, 1.5, z + oz, COL.metal);
      }
      kit.box(7.4, 0.7, 2.4, x, 1.05, z, 0x9a7b52);
      if (rng() > 0.4) {
        kit.box(6.4, 0.42, 1.8, x, 1.6, z, randRange(rng, 0, 1) > 0.5 ? 0xd06a2a : 0x86a832);
      }
    }
  }
  return {};
}

// ---------------------------------------------------------------------- AVM
function avm(kit) {
  kit.box(90, 16, 62, 0, 8, 0, COL.white);
  kit.box(92, 1.6, 64, 0, 16.8, 0, COL.concrete);
  // glazed atrium
  const atrium = new THREE.CylinderGeometry(15, 15, 8, 20, 1, false);
  atrium.translate(0, 20, 0);
  atrium.applyMatrix4(kit.m);
  kit.glass.push(tint(atrium, 0x9fd0e8));
  kit.dome(15.2, 20, 0, 24, 0, 0xbfe4f2, 'glass');
  // entrance
  kit.box(26, 10, 2, 0, 5, 31.5, COL.glassTint, 0, 'glass');
  kit.box(30, 1.4, 8, 0, 11, 34, COL.blue);
  // rooftop car park deck
  kit.box(92, 0.8, 30, 0, 18, -18, COL.concrete);
  for (let i = -5; i <= 5; i++) {
    kit.box(0.3, 0.06, 26, i * 8, 18.5, -18, COL.white);
  }
  // service yard
  kit.box(30, 0.3, 18, -56, 0.2, 20, 0x54585e);
  return { sign: kit.toWorld(0, 13.5, 34.4) };
}

// ------------------------------------------------------------------- BUILD
export function buildLandmarks(ground, colliders) {
  const rng = makeRng(99887766);
  const group = new THREE.Group();
  group.name = 'landmarks';

  const solid = [];
  const glass = [];
  const glow = [];
  const flags = [];
  const signs = [];

  for (const def of LANDMARKS) {
    const y = ground.heightAt(def.x, def.z);
    const kit = new Kit({ x: def.x, y, z: def.z }, def.rot);
    let extra = {};

    switch (def.id) {
      case 'estergon': extra = estergon(kit); break;
      case 'hospital': extra = hospital(kit); break;
      case 'belediye': extra = belediye(kit); break;
      case 'camii': extra = camii(kit); break;
      case 'stadyum': extra = stadyum(kit); break;
      case 'botanik': extra = botanik(kit, rng); break;
      case 'metro': extra = metro(kit); break;
      case 'kultur': extra = kultur(kit); break;
      case 'pazar': extra = pazar(kit, rng); break;
      case 'avm': extra = avm(kit); break;
      default: break;
    }

    solid.push(...kit.solid);
    glass.push(...kit.glass);
    glow.push(...kit.glow);

    if (extra.flag) flags.push(extra.flag);
    if (extra.flag2) flags.push(extra.flag2);
    if (extra.sign) signs.push({ pos: extra.sign, name: def.name, rot: def.rot });

    // block the footprint so cars stop at the walls
    addLandmarkColliders(def, colliders);
  }

  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.05 });
  const glassMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.12,
    metalness: 0.3,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide
  });
  const glowMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    emissive: 0xffffff,
    emissiveIntensity: 0.35,
    roughness: 0.5
  });

  const add = (geos, mat, name) => {
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

  add(solid, solidMat, 'landmark-solid');
  add(glass, glassMat, 'landmark-glass');
  const glowMesh = add(glow, glowMat, 'landmark-glow');

  // Turkish flags on the civic buildings
  const flagMat = new THREE.MeshStandardMaterial({
    map: flagTexture(),
    side: THREE.DoubleSide,
    roughness: 0.9
  });
  const flagMeshes = [];
  for (const pos of flags) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 11, 6),
      new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.5, metalness: 0.4 })
    );
    pole.position.copy(pos);
    pole.position.y += 1.5;
    pole.castShadow = true;
    group.add(pole);

    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.4, 12, 4), flagMat);
    cloth.position.set(pos.x + 1.85, pos.y + 5.6, pos.z);
    cloth.castShadow = true;
    group.add(cloth);
    flagMeshes.push(cloth);
  }

  // landmark signage boards
  for (const s of signs) {
    const tex = signTexture(s.name.toUpperCase(), '#123a63', '#ffffff');
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 4),
      new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.7 })
    );
    board.position.copy(s.pos);
    board.rotation.y = s.rot;
    group.add(board);
  }

  return { group, glowMesh, flagMeshes };
}

function addLandmarkColliders(def, colliders) {
  const c = Math.cos(def.rot);
  const s = Math.sin(def.rot);
  const put = (lx, lz, hx, hz) => {
    colliders.add(def.x + lx * c + lz * s, def.z - lx * s + lz * c, hx, hz, def.rot);
  };
  switch (def.id) {
    case 'estergon':
      put(0, 0, 30, 30);
      break;
    case 'hospital':
      put(0, 0, 61, 32);
      break;
    case 'belediye':
      put(0, 0, 27, 18);
      break;
    case 'camii':
      put(0, 0, 16, 16);
      put(-17, 17, 2, 2);
      put(17, 17, 2, 2);
      break;
    case 'stadyum':
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        put(Math.cos(a) * 64, Math.sin(a) * 46, 8, 8);
      }
      break;
    case 'kultur':
      put(0, 0, 23, 14);
      break;
    case 'avm':
      put(0, 0, 46, 32);
      break;
    case 'pazar':
      put(0, 0, 36, 24);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------- TELEFERİK
/** The Keçiören cable car: towers, cables and cabins that keep circulating. */
export function buildTeleferik(ground) {
  const group = new THREE.Group();
  group.name = 'teleferik';

  const a = new THREE.Vector3(TELEFERIK.from[0], 0, TELEFERIK.from[1]);
  const b = new THREE.Vector3(TELEFERIK.to[0], 0, TELEFERIK.to[1]);
  a.y = ground.heightAt(a.x, a.z);
  b.y = ground.heightAt(b.x, b.z);

  const towers = [];
  const solids = [];
  const N = TELEFERIK.towerCount;

  const stationGeo = (p, isTop) => {
    const h = 12;
    const base = new THREE.BoxGeometry(16, h, 11);
    base.translate(p.x, p.y + h / 2, p.z);
    solids.push(tint(base, COL.concrete));
    const roof = new THREE.BoxGeometry(19, 0.7, 14);
    roof.translate(p.x, p.y + h + 0.35, p.z);
    solids.push(tint(roof, isTop ? COL.roofRed : COL.blue));
    const wheel = new THREE.CylinderGeometry(3.4, 3.4, 0.7, 16);
    wheel.rotateZ(Math.PI / 2);
    wheel.translate(p.x, p.y + h - 2.2, p.z);
    solids.push(tint(wheel, COL.metal));
  };

  stationGeo(a, true);
  stationGeo(b, false);

  for (let i = 0; i <= N + 1; i++) {
    const t = i / (N + 1);
    const x = lerp(a.x, b.x, t);
    const z = lerp(a.z, b.z, t);
    const gy = ground.heightAt(x, z);
    const lineY = lerp(a.y + 10, b.y + 10, t) + Math.sin(t * Math.PI) * 12 + TELEFERIK.cableHeight * 0.4;
    const h = Math.max(9, lineY - gy);
    towers.push({ x, z, y: gy, h, top: gy + h });

    if (i > 0 && i <= N) {
      const mast = new THREE.CylinderGeometry(0.5, 0.9, h, 8);
      mast.translate(x, gy + h / 2, z);
      solids.push(tint(mast, COL.metal));
      // cross arm
      const dir = new THREE.Vector2(b.x - a.x, b.z - a.z).normalize();
      const arm = new THREE.BoxGeometry(5.4, 0.5, 0.5);
      arm.rotateY(Math.atan2(-dir.y, dir.x));
      arm.translate(x, gy + h, z);
      solids.push(tint(arm, COL.metal));
      // lattice bracing
      for (let k = 1; k < 4; k++) {
        const ring = new THREE.TorusGeometry(0.75, 0.09, 4, 8);
        ring.rotateX(Math.PI / 2);
        ring.translate(x, gy + (h * k) / 4, z);
        solids.push(tint(ring, COL.metal));
      }
    }
  }

  const solidMesh = new THREE.Mesh(
    mergeGeometries(solids, false),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.35 })
  );
  solidMesh.castShadow = true;
  solidMesh.receiveShadow = true;
  group.add(solidMesh);
  solids.forEach((g) => g.dispose());

  // cables: one loop out, one back
  const cablePts = [[], []];
  const laneOffset = 1.9;
  const dir = new THREE.Vector2(b.x - a.x, b.z - a.z).normalize();
  const nx = dir.y;
  const nz = -dir.x;
  for (const tw of towers) {
    cablePts[0].push(new THREE.Vector3(tw.x + nx * laneOffset, tw.top - 0.35, tw.z + nz * laneOffset));
    cablePts[1].push(new THREE.Vector3(tw.x - nx * laneOffset, tw.top - 0.35, tw.z - nz * laneOffset));
  }
  const curves = cablePts.map((pts) => new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.25));

  const cableMat = new THREE.LineBasicMaterial({ color: 0x20232a });
  for (const curve of curves) {
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(120));
    group.add(new THREE.Line(geo, cableMat));
  }

  // cabins
  const cabinGeos = [];
  const shell = new THREE.BoxGeometry(2.3, 2.5, 3.2);
  shell.translate(0, -2.6, 0);
  cabinGeos.push(tint(shell, 0xd8443c));
  const glassBand = new THREE.BoxGeometry(2.4, 1.2, 3.3);
  glassBand.translate(0, -2.4, 0);
  cabinGeos.push(tint(glassBand, 0x2b3f52));
  const roofG = new THREE.BoxGeometry(2.5, 0.22, 3.4);
  roofG.translate(0, -1.3, 0);
  cabinGeos.push(tint(roofG, 0xe6e6e2));
  const hanger = new THREE.CylinderGeometry(0.09, 0.09, 1.6, 6);
  hanger.translate(0, -0.6, 0);
  cabinGeos.push(tint(hanger, COL.metal));
  const grip = new THREE.BoxGeometry(0.5, 0.35, 0.7);
  cabinGeos.push(tint(grip, COL.dark));
  const cabinGeo = mergeGeometries(cabinGeos, false);
  cabinGeos.forEach((g) => g.dispose());

  const cabinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
  const cabins = [];
  const total = TELEFERIK.cabinCount;
  for (let i = 0; i < total; i++) {
    const mesh = new THREE.Mesh(cabinGeo, cabinMat);
    mesh.castShadow = true;
    group.add(mesh);
    cabins.push({ mesh, lane: i % 2, t: (i / total) });
  }

  const lengths = curves.map((c) => c.getLength());
  const tmp = new THREE.Vector3();

  function update(dt) {
    for (const cab of cabins) {
      const len = lengths[cab.lane] || 1;
      cab.t += (TELEFERIK.speed / len) * dt * (cab.lane === 0 ? 1 : -1);
      cab.t = (cab.t + 1) % 1;
      curves[cab.lane].getPointAt(Math.min(0.999, Math.max(0.001, cab.t)), tmp);
      cab.mesh.position.copy(tmp);
      cab.mesh.rotation.y = Math.atan2(dir.x, dir.y);
    }
  }

  return { group, update, stations: [a, b] };
}
