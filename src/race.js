import * as THREE from 'three';
import { clamp } from './util/math.js';
import { findRoute } from './world/route.js';

/**
 * Kontrol noktası yarışları.
 *
 * The city was already worth driving around; what it had no answer for was
 * "and then what". A race is the cheapest possible answer: a start, a handful
 * of gates in a fixed order, and a clock. Nothing here changes how the world
 * is built — the gates are snapped onto the existing road graph at the moment
 * a race is armed, so a route that the map cannot actually drive is caught
 * before it is ever offered.
 */

/** Where the personal bests live. */
const STORE = 'kecioren-yaris-rekor';

/** How close to the gate centre counts as through it, at minimum. */
const MIN_GATE_R = 17;

/**
 * The routes.
 *
 * Every point is an approximate position — it gets pulled onto the nearest
 * road centre when the race is prepared, so these only have to be roughly
 * right. `speed` is the average pace, in km/h, that earns gold: the target
 * time is the real driving distance divided by it, which means a route
 * through traffic lights asks for a lower number than a ring road.
 */
export const RACES = [
  {
    id: 'kecioren-turu',
    name: 'Keçiören Turu',
    blurb: 'Merkezden çık, ilçeyi dolaş, merkeze dön.',
    speed: 56,
    start: { x: 0, z: 40 },
    points: [
      { x: 78, z: 216, name: 'Belediye' },
      { x: -150, z: 400, name: 'Subayevleri' },
      { x: -620, z: 190, name: 'Etlik Şehir Hastanesi' },
      { x: -340, z: -420, name: 'Aktepe Stadyumu' },
      { x: -20, z: -540, name: 'Kalaba' },
      { x: 0, z: 40, name: 'Keçiören Merkez' }
    ]
  },
  {
    id: 'etlik-sprint',
    name: 'Etlik Sprinti',
    blurb: 'Kısa ve hızlı: merkezden hastaneye.',
    speed: 60,
    start: { x: 0, z: 40 },
    points: [
      { x: -150, z: 400, name: 'Subayevleri' },
      { x: -262, z: 402, name: 'Atapark Camii' },
      { x: -700, z: 268, name: 'Etlik Şehir Hastanesi' }
    ]
  },
  {
    id: 'estergon-kacisi',
    name: 'Estergon Kaçışı',
    blurb: 'Botanik Parkı’ndan kaleye, kaleden merkeze.',
    speed: 58,
    start: { x: 30, z: -470 },
    points: [
      { x: 130, z: -600, name: 'Kalaba Pazarı' },
      { x: 692, z: -50, name: 'Yayla' },
      { x: 500, z: -150, name: 'Estergon Kalesi' },
      { x: 300, z: -100, name: 'Keçiören AVM' },
      { x: 0, z: 40, name: 'Keçiören Merkez' }
    ]
  },
  {
    id: 'ankara-klasigi',
    name: 'Ankara Klasiği',
    blurb: 'Ulus’tan Atakule’ye, şehrin bütün simgelerinden geçerek.',
    speed: 62,
    start: { x: 22, z: 1660 },
    points: [
      { x: -110, z: 1830, name: 'Gençlik Parkı' },
      { x: -700, z: 2080, name: 'Anıtkabir' },
      { x: -780, z: 2390, name: 'AŞTİ' },
      { x: 8, z: 2200, name: 'Kızılay' },
      { x: 150, z: 2330, name: 'Kocatepe Camii' },
      { x: -30, z: 3020, name: 'Atakule' }
    ]
  },
  {
    id: 'cankaya-tirmanisi',
    name: 'Çankaya Tırmanışı',
    blurb: 'Kızılay’dan yokuş yukarı Atakule’ye.',
    speed: 58,
    start: { x: 8, z: 2200 },
    points: [
      { x: -300, z: 2330, name: 'TBMM' },
      { x: -20, z: 2900, name: 'Çankaya' },
      { x: -30, z: 3020, name: 'Atakule' }
    ]
  },
  {
    id: 'cevre-yolu',
    name: 'Çevre Yolu Maratonu',
    blurb: 'Kuzeyden batıya, Sincan’a kadar. Uzun ve hızlı.',
    speed: 84,
    start: { x: -120, z: -816 },
    points: [
      { x: -760, z: 1420, name: 'Yenimahalle' },
      { x: -2100, z: 780, name: 'Ostim' },
      { x: -2760, z: 780, name: 'Batıkent' },
      { x: -3400, z: 1010, name: 'Etimesgut' },
      { x: -4420, z: 960, name: 'Sincan' }
    ]
  },
  {
    id: 'havalimani',
    name: 'Havalimanı Koşusu',
    blurb: 'Kalaba’dan Esenboğa’ya tek soluk.',
    speed: 88,
    start: { x: -20, z: -540 },
    points: [
      { x: -120, z: -816, name: 'Kuzey Çevre Yolu' },
      { x: 2500, z: -4080, name: 'Esenboğa Havalimanı' }
    ]
  }
];

/** mm:ss.d — the only time format the HUD ever needs. */
export function formatTime(t) {
  if (!Number.isFinite(t)) return '--:--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

/** +1.4 / -0.8, with the sign the player wants to see. */
export function formatDelta(d) {
  return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;
}

export const MEDAL = {
  altin: { label: 'ALTIN', icon: '🥇', colour: '#ffd05a' },
  gumus: { label: 'GÜMÜŞ', icon: '🥈', colour: '#cfd8e6' },
  bronz: { label: 'BRONZ', icon: '🥉', colour: '#e0955a' }
};

/** Gold is the target time; silver and bronze are the room around it. */
export function medalFor(time, par) {
  if (!Number.isFinite(time) || !par) return null;
  if (time <= par) return 'altin';
  if (time <= par * 1.12) return 'gumus';
  if (time <= par * 1.32) return 'bronz';
  return null;
}

export function loadBests() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function saveBest(bests, id, time, splits) {
  bests[id] = { time, splits: splits.slice() };
  try {
    localStorage.setItem(STORE, JSON.stringify(bests));
  } catch {
    /* private browsing: the run still counted, it just will not survive */
  }
}

/**
 * Pulls a route onto the road graph and works out what a good time is.
 * Returns null when the map cannot actually drive it — which is how a route
 * that reaches past the built road network gets dropped from the list rather
 * than offered and then found to be impossible.
 */
/**
 * Pulls a point onto a piece of road a car can actually be put on.
 *
 * Two things disqualify a spot, and the network knows about both: a stub
 * that is not joined to the rest of the city, and a spot with a building
 * standing on it. Nought point one three per cent of this map's road
 * centreline runs inside a solid box — mostly where a landmark's footprint
 * swallows the drive that serves it — and a gate there is a gate nobody can
 * pass, so a blocked spot is walked along its own road until it comes out.
 */
function snapToNetwork(network, p, colliders) {
  const blocked = colliders
    ? (x, z) => !!colliders.resolveCircle(x, z, 2.4, () => true)
    : null;
  const at = network.snapToDrivable(p.x, p.z, blocked);
  if (!at) return null;
  const hw = Math.max(4, (at.width || 12) * 0.5);
  return {
    x: at.x, y: at.y, z: at.z,
    dx: at.dx, dz: at.dz,
    name: p.name || '',
    road: at.name,
    moved: at.moved,
    hw,
    r: Math.max(MIN_GATE_R, hw + 7)
  };
}

export function prepareRace(def, network, colliders) {
  const snap = (p) => snapToNetwork(network, p, colliders);

  const start = snap(def.start);
  if (!start) return null;
  const checkpoints = [];
  for (const p of def.points) {
    const s = snap(p);
    if (!s) return null;
    checkpoints.push(s);
  }

  let length = 0;
  let from = start;
  for (const cp of checkpoints) {
    const r = findRoute(network, from.x, from.z, cp.x, cp.z);
    if (!r) return null;
    length += r.length;
    from = cp;
  }
  // a loop that comes back to where it started would otherwise read as 0 m
  if (length < 200) return null;

  return { def, start, checkpoints, length, par: length / (def.speed / 3.6) };
}

/** Every race the current map can actually hold, prepared once. */
export function prepareAll(network, colliders) {
  const out = [];
  for (const def of RACES) {
    const r = prepareRace(def, network, colliders);
    if (r) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------- the gates

const GATE_H = 7.5;

/**
 * The two gates that are ever on screen: the one you are driving at and the
 * one after it, dimmed. Both are built once and moved, so a race adds eight
 * draw calls to the frame and no allocation at all while it runs.
 */
export class RaceGates {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'race-gates';
    this.active = this._build(0xffb03a, 1);
    this.next = this._build(0x34d3ff, 0.42);
    this.group.add(this.active.group, this.next.group);
    this.shown = false;
    this._pulse = 0;
  }

  _build(colour, alpha) {
    const group = new THREE.Group();
    const post = new THREE.BoxGeometry(0.7, GATE_H, 0.7);
    post.translate(0, GATE_H / 2, 0);
    const solid = new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity: alpha, fog: false
    });
    const left = new THREE.Mesh(post, solid);
    const right = new THREE.Mesh(post, solid);
    left.frustumCulled = false;
    right.frustumCulled = false;

    // The band you actually aim at: a wall of light across the gap, drawn
    // additively so it reads at any hour without needing to be lit.
    const bandGeo = new THREE.PlaneGeometry(1, 1);
    const bandMat = new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.24 * alpha,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    });
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.y = GATE_H * 0.5;
    band.frustumCulled = false;
    band.renderOrder = 3;

    // and a ring on the tarmac, for when the band is behind a lorry
    const ringGeo = new THREE.RingGeometry(0.86, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.55 * alpha,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.09;
    ring.frustumCulled = false;
    ring.renderOrder = 3;

    group.add(left, right, band, ring);
    return { group, left, right, band, ring, bandMat, ringMat, solid };
  }

  show() {
    if (this.shown) return;
    this.scene.add(this.group);
    this.shown = true;
  }

  hide() {
    if (!this.shown) return;
    this.scene.remove(this.group);
    this.shown = false;
  }

  /** Puts one gate across the road at a checkpoint. */
  place(gate, cp, groundY) {
    const half = Math.max(5, Math.min(cp.r, cp.hw + 2.5));
    // perpendicular to the direction of the road under it
    const px = -cp.dz;
    const pz = cp.dx;
    const y = groundY;
    gate.group.visible = true;
    gate.left.position.set(cp.x + px * half, y, cp.z + pz * half);
    gate.right.position.set(cp.x - px * half, y, cp.z - pz * half);
    gate.band.position.set(cp.x, y + GATE_H * 0.5, cp.z);
    gate.band.scale.set(half * 2, GATE_H, 1);
    gate.band.rotation.y = Math.atan2(px, pz) + Math.PI / 2;
    gate.ring.position.set(cp.x, y + 0.09, cp.z);
    gate.ring.scale.set(cp.r, 1, cp.r);
  }

  /** Where the two gates are this checkpoint, and a slow pulse on the active one. */
  update(dt, cps, index, ground) {
    if (!this.shown) return;
    this._pulse += dt;
    const cur = cps[index];
    if (cur) this.place(this.active, cur, ground.heightAt(cur.x, cur.z));
    else this.active.group.visible = false;
    const nxt = cps[index + 1];
    if (nxt) this.place(this.next, nxt, ground.heightAt(nxt.x, nxt.z));
    else this.next.group.visible = false;

    const p = 0.5 + 0.5 * Math.sin(this._pulse * 3.4);
    this.active.bandMat.opacity = 0.16 + p * 0.2;
    this.active.ringMat.opacity = 0.4 + p * 0.35;
  }
}

// --------------------------------------------------------------- a live run

/** How long you sit on the line before the clock starts. */
const COUNT_IN = 3.4;

/**
 * One attempt at one race. Holds the clock and which gate is next, and
 * nothing else: what a passed gate sounds like, and what a finish does to
 * the screen, is the game's business.
 */
export class RaceSession {
  constructor(prepared) {
    this.race = prepared;
    this.index = 0;
    this.time = 0;
    this.countdown = COUNT_IN;
    this.state = 'countdown';   // countdown · running · done · failed
    this.splits = [];
    this.delta = null;          // seconds against the best run, at the last gate
    this.dist = 0;              // to the gate you are driving at
    this._tick = Math.ceil(COUNT_IN);
  }

  get target() { return this.race.checkpoints[this.index]; }
  get total() { return this.race.checkpoints.length; }
  get running() { return this.state === 'countdown' || this.state === 'running'; }

  /**
   * @returns {null|'tick'|'go'|'gate'|'finish'} what just happened
   */
  update(dt, x, z) {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.state = 'running'; return 'go'; }
      const t = Math.ceil(this.countdown);
      if (t !== this._tick) { this._tick = t; return 'tick'; }
      return null;
    }
    if (this.state !== 'running') return null;

    this.time += dt;
    const cp = this.target;
    if (!cp) return null;
    this.dist = Math.hypot(cp.x - x, cp.z - z);
    if (this.dist > cp.r) return null;

    this.splits.push(this.time);
    this.index++;
    if (this.index >= this.race.checkpoints.length) {
      this.state = 'done';
      return 'finish';
    }
    return 'gate';
  }

  fail() { this.state = 'failed'; }
}
