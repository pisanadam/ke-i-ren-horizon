import * as THREE from 'three';
import { RtcTransport } from './rtc.js';
import { createPlayerCar } from '../vehicles/carModel.js';
import { createPerson, poseWalk } from '../vehicles/person.js';
import { CAR_BY_ID, CARS } from '../vehicles/catalog.js';
import { clamp, wrapAngle } from '../util/math.js';

const SEND_HZ = 15;
/**
 * How far in the past remote players are drawn.
 *
 * The whole reason cars teleport in a naive implementation is that each
 * packet is applied the moment it lands: the car sits still between packets
 * and then jumps. Holding the render back by a little over one packet
 * interval means there is nearly always a newer snapshot to interpolate
 * towards, so the motion is continuous instead of stepped.
 */
const DELAY = 0.14;
const MAX_EXTRAPOLATE = 0.35;
const DROP_AFTER = 6;

/** One other player, drawn from a small buffer of timestamped snapshots. */
class RemotePlayer {
  constructor(id, name, scene, world) {
    this.id = id;
    this.name = name || `Oyuncu ${String(id).slice(-3)}`;
    this.scene = scene;
    this.world = world;
    this.snaps = [];
    this.lastSeen = 0;
    this.specId = null;
    this.colour = null;
    /** Null until the first packet lands; the maps skip a player without one. */
    this.mapX = null;
    this.mapZ = null;
    this.mapYaw = 0;
    this.mapSpeed = 0;
    this.mapFoot = false;
    /** What race they are on, and how far through it. Null when not racing. */
    this.raceId = null;
    this.raceCp = 0;
    this.raceDist = 0;
    this.raceTime = 0;
    this.car = null;
    this.onFootModel = null;
    this.walkPhase = 0;
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  /** Swaps the visible model when the other player changes car. */
  _ensureCar(specId, colour) {
    if (this.specId === specId && this.colour === colour) return;
    this.specId = specId;
    this.colour = colour;
    if (this.car) {
      this.group.remove(this.car.group);
      this.car.group.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m?.dispose());
      });
    }
    const spec = CAR_BY_ID[specId] || CARS[0];
    this.car = createPlayerCar(spec, colour ?? spec.colours[0]);
    this.group.add(this.car.group);
  }

  _ensurePerson() {
    if (this.onFootModel) return;
    this.onFootModel = createPerson({
      skin: 0x7a5237, hair: 0x1a1410, shirt: 0x6a2f3a,
      trousers: 0x2b2f38, shoes: 0x17191c, build: 1.1
    }, 'low');
    this.group.add(this.onFootModel.root);
  }

  /**
   * Files a snapshot on a reconstructed timeline.
   *
   * Stamping each packet with the moment it happened to arrive bakes the
   * network's jitter straight into the motion — the interpolation faithfully
   * reproduces the wobble in the delivery. Since the sender emits on a fixed
   * clock, snapshot `n` belongs at `n / SEND_HZ` plus one offset shared by
   * the whole stream; that offset is pinned to the earliest arrival seen and
   * allowed to drift up very slowly so clock skew cannot strand it.
   */
  push(snap, now) {
    this.lastSeen = now;
    const last = this.snaps[this.snaps.length - 1];
    // out-of-order packets would drag the car backwards
    if (last && snap.n <= last.n) return;

    const ideal = snap.n / SEND_HZ;
    const offset = now - ideal;
    this._offset = this._offset === undefined
      ? offset
      : Math.min(offset, this._offset + 0.0009);

    let at = ideal + this._offset;
    // never file a snapshot before the one in front of it
    if (last) at = Math.max(at, last.at + 1e-3);
    this.snaps.push({ ...snap, at });
    if (this.snaps.length > 24) this.snaps.shift();
  }

  /**
   * Places the model for the current frame.
   *
   * Between the two snapshots that bracket the render time it uses a Hermite
   * curve rather than a straight lerp: with the velocity at each end as the
   * tangent, a car going round a bend follows the bend instead of cutting
   * the corner and snapping back.
   */
  update(now, dt) {
    if (!this.snaps.length) return;
    const t = now - DELAY;

    let a = null;
    let b = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].at <= t) { a = this.snaps[i]; b = this.snaps[i + 1] ?? null; break; }
    }
    if (!a) a = this.snaps[0];

    let x, y, z, yaw, speed;
    if (b) {
      const span = Math.max(1e-4, b.at - a.at);
      const s = clamp((t - a.at) / span, 0, 1);
      const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
      const h10 = s ** 3 - 2 * s ** 2 + s;
      const h01 = -2 * s ** 3 + 3 * s ** 2;
      const h11 = s ** 3 - s ** 2;
      x = h00 * a.x + h10 * a.vx * span + h01 * b.x + h11 * b.vx * span;
      z = h00 * a.z + h10 * a.vz * span + h01 * b.z + h11 * b.vz * span;
      y = a.y + (b.y - a.y) * s;
      yaw = a.yaw + wrapAngle(b.yaw - a.yaw) * s;
      speed = a.sp + (b.sp - a.sp) * s;
    } else {
      // ahead of the newest packet: carry on at the last known velocity for
      // a moment rather than freezing, but do not invent a whole second of it
      const ahead = clamp(t - a.at, 0, MAX_EXTRAPOLATE);
      x = a.x + a.vx * ahead;
      z = a.z + a.vz * ahead;
      y = a.y;
      yaw = a.yaw + (a.yr ?? 0) * ahead;
      speed = a.sp;
    }

    // Where the maps look this player up. It is kept here rather than read off
    // the model because the model is only worth moving when it is on screen,
    // while the map wants your friend's position from the other side of Ankara.
    this.mapX = x;
    this.mapZ = z;
    this.mapYaw = yaw;
    this.mapSpeed = speed;

    const snap = b ?? a;
    this.mapFoot = !!snap.foot;
    if (snap.foot) {
      this._ensurePerson();
      if (this.car) this.car.group.visible = false;
      this.onFootModel.root.visible = true;
      this.onFootModel.root.position.set(x, y, z);
      this.onFootModel.root.rotation.y = yaw;
      this.walkPhase += dt * (speed > 0.05 ? clamp(speed * 2.6, 1.6, 13) : 0);
      poseWalk(this.onFootModel, this.walkPhase, speed);
      return;
    }

    this._ensureCar(snap.car, snap.col);
    if (this.onFootModel) this.onFootModel.root.visible = false;
    this.car.group.visible = true;
    this.car.group.rotation.order = 'YXZ';
    this.car.group.position.set(x, y, z);
    this.car.group.rotation.set(snap.pi ?? 0, yaw, snap.ro ?? 0);
    this.car.bodyRoot.rotation.set(0, 0, 0);

    // wheels turn at the speed the car is actually travelling
    const spec = CAR_BY_ID[this.specId] || CARS[0];
    this.walkPhase += (speed / (2 * Math.PI * spec.wheelRadius)) * Math.PI * 2 * dt;
    for (const holder of this.car.wheelMeshes) {
      if (holder.userData.front) holder.rotation.y = -(snap.st ?? 0);
      holder.userData.spin.rotation.x = this.walkPhase;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m?.dispose());
    });
  }
}

/**
 * The co-op session: joins a room, tells everybody where this player is
 * fifteen times a second, and draws the others smoothly in between.
 */
export class Coop {
  constructor(game) {
    this.game = game;
    this.peers = new Map();
    this.active = false;
    this.room = '';
    this.status = 'kapalı';
    this._acc = 0;
    this._seq = 0;
    this.onChange = () => {};
    /** 'signal' when the meeting service is unreachable, 'peer' when nobody came. */
    this.onTrouble = () => {};
    /** Called when a live guest loses the room host. */
    this.onDisconnect = () => {};
    this.isHost = false;
  }

  get count() { return this.peers.size + (this.active ? 1 : 0); }

  /**
   * Joins a room. Whoever gets there first ends up hosting it; nobody has to
   * decide that, and there is no wrong button to press.
   * @param {string} code six digits
   * @param {string} name what to call this player
   * @param {boolean|null} [isHost] forced role, for tests
   */
  join(code, name, isHost = null) {
    this.leave();
    this.name = name || 'Oyuncu';
    this.room = String(code).replace(/\D/g, '').slice(0, 6);
    if (this.room.length !== 6) {
      this.status = 'kod 6 haneli olmalı';
      this.onChange();
      return false;
    }
    this.status = 'bağlanılıyor…';
    this.onChange();

    this.tp = new RtcTransport(this.room, this.name, isHost);
    this.tp.onTrouble = (kind) => this.onTrouble?.(kind);
    this.tp.onOpen = (msg) => {
      this.active = true;
      this.isHost = this.tp.isHost;
      this.status = this.tp.isHost ? 'oda hazır' : 'bağlandı';
      for (const p of msg.peers || []) this._add(p.id, p.name);
      this.onChange();
    };
    this.tp.onStatus = (text) => {
      this.status = text;
      this.onChange();
    };
    this.tp.onMessage = (msg) => this._handle(msg);
    this.tp.onClose = () => {
      const wasActive = this.active;
      if (!this.active) this.status = 'bağlanılamadı';
      else this.status = 'bağlantı koptu';
      this.active = false;
      this._clearPeers();
      this.onChange();
      if (wasActive) this.onDisconnect();
    };
    this.tp.connect();
    return true;
  }

  /** The copy-and-paste path, for networks that block the signalling service. */
  async manualOffer(name) {
    this.leave();
    this.name = name || 'Oyuncu';
    this.room = 'elle';
    this.tp = this._manualTransport();
    return this.tp.manualOffer();
  }

  async manualAccept(text, name) {
    if (!this.tp) {
      this.name = name || 'Oyuncu';
      this.room = 'elle';
      this.tp = this._manualTransport();
    }
    return this.tp.manualAccept(text);
  }

  _manualTransport() {
    const tp = new RtcTransport('000000', this.name, false);
    tp.onOpen = (msg) => {
      this.active = true;
      this.status = 'bağlandı';
      for (const p of msg.peers || []) this._add(p.id, p.name);
      this.onChange();
    };
    tp.onStatus = (text) => { this.status = text; this.onChange(); };
    tp.onMessage = (msg) => this._handle(msg);
    tp.onClose = () => {
      this.status = this.active ? 'bağlantı koptu' : 'bağlanılamadı';
      this.active = false;
      this._clearPeers();
      this.onChange();
    };
    return tp;
  }

  leave() {
    this.tp?.close();
    this.tp = null;
    this.active = false;
    this._clearPeers();
    this.status = 'kapalı';
    this.onChange();
  }

  _clearPeers() {
    for (const p of this.peers.values()) p.dispose();
    this.peers.clear();
  }

  _add(id, name) {
    if (this.peers.has(id)) return;
    this.peers.set(id, new RemotePlayer(id, name, this.game.scene, this.game.world));
    this.onChange();
  }

  _handle(msg) {
    const now = performance.now() / 1000;
    if (msg.t === 'joined') { this._add(msg.id, msg.name); return; }
    if (msg.t === 'left') {
      this.peers.get(msg.id)?.dispose();
      this.peers.delete(msg.id);
      this.onChange();
      return;
    }
    if (msg.t === 's') {
      let p = this.peers.get(msg.id);
      if (!p) { this._add(msg.id, msg.nm); p = this.peers.get(msg.id); }
      p.push(msg, now);
      p.raceId = msg.ri || null;
      p.raceCp = msg.rc || 0;
      p.raceDist = msg.rd || 0;
      p.raceTime = msg.rt || 0;
      return;
    }
    // one player picks a race and everybody in the room drives it
    if (msg.t === 'race') {
      this.game.onRaceInvite?.(msg.race, this.peers.get(msg.id)?.name || 'Bir oyuncu');
      return;
    }
    if (msg.t === 'rfin') {
      this.game.onRaceFinish?.(msg.race, msg.time, this.peers.get(msg.id)?.name || 'Bir oyuncu');
    }
  }

  /** Tells the room which race to drive. */
  sendRaceStart(id) {
    if (this.active) this.tp?.send({ t: 'race', race: id });
  }

  sendRaceFinish(id, time) {
    if (this.active) this.tp?.send({ t: 'rfin', race: id, time: +time.toFixed(2) });
  }

  /** Everyone else currently on the same race, in running order. */
  racers(id) {
    const out = [];
    for (const p of this.peers.values()) {
      if (p.raceId !== id) continue;
      out.push({ name: p.name, cp: p.raceCp, dist: p.raceDist, time: p.raceTime });
    }
    return out;
  }

  update(dt) {
    if (!this.active) return;
    const now = performance.now() / 1000;

    // ---- send our own state --------------------------------------------
    this._acc += dt;
    if (this._acc >= 1 / SEND_HZ) {
      this._acc = 0;
      const g = this.game;
      const foot = g.state === 'foot';
      const v = g.vehicle;
      const a = foot ? g.onFoot : v;
      // Race progress rides along in the snapshot rather than in packets of
      // its own: it is three numbers fifteen times a second, and it has to
      // arrive at the same rate as the position it belongs to or the running
      // order would lag the cars it is ordering.
      const race = g.race;
      this.tp.send({
        t: 's',
        n: ++this._seq,
        x: +a.position.x.toFixed(2),
        y: +a.position.y.toFixed(2),
        z: +a.position.z.toFixed(2),
        yaw: +a.yaw.toFixed(3),
        vx: foot ? +(Math.sin(a.yaw) * a.speed).toFixed(2) : +v.velocity.x.toFixed(2),
        vz: foot ? +(Math.cos(a.yaw) * a.speed).toFixed(2) : +v.velocity.z.toFixed(2),
        yr: foot ? 0 : +v.yawRate.toFixed(3),
        sp: +(foot ? a.speed : v.speed).toFixed(2),
        st: foot ? 0 : +v.steer.toFixed(3),
        pi: foot ? 0 : +v.pitch.toFixed(3),
        ro: foot ? 0 : +v.roll.toFixed(3),
        foot: foot ? 1 : 0,
        car: v.spec.id,
        col: g.playerCar?.paintMat?.color?.getHex?.() ?? 0xffffff,
        nm: this.name,
        ri: race ? race.race.def.id : 0,
        rc: race ? race.index : 0,
        rd: race ? Math.round(race.dist) : 0,
        rt: race ? +race.time.toFixed(1) : 0
      });
    }

    // ---- draw everybody else -------------------------------------------
    for (const [id, p] of [...this.peers]) {
      if (now - p.lastSeen > DROP_AFTER) {
        p.dispose();
        this.peers.delete(id);
        this.onChange();
        continue;
      }
      p.update(now, dt);
    }
  }

  /**
   * Which slot on the start line this player takes.
   *
   * Sorting the ids gives every machine the same answer without anybody
   * having to be asked, so two cars never land on the same square metre.
   */
  gridSlot() {
    if (!this.active || !this.tp) return 0;
    const ids = [this.tp.id, ...this.peers.keys()].map(String).sort();
    return Math.max(0, ids.indexOf(String(this.tp.id)));
  }

  /** Marker positions for the map and minimap. */
  forEachPeer(fn) {
    for (const p of this.peers.values()) {
      const s = p.snaps[p.snaps.length - 1];
      if (s) fn({ x: s.x, z: s.z, name: p.name });
    }
  }
}
