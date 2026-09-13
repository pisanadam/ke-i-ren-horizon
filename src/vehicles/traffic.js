import * as THREE from 'three';
import { buildCarParts, CAR_MATERIALS } from './carModel.js';
import { CAR_BY_ID, TRAFFIC_MIX, TRAFFIC_COLOURS } from './catalog.js';
import { makeRng, clamp, damp, randRange } from '../util/math.js';
import { QUALITY } from '../quality.js';
import { scatterWreck } from './damage.js';

const MAX_AGENTS = QUALITY.trafficAgents;

/**
 * Closing speed, in metres a second, past which a struck car leaves the road
 * instead of being nudged aside. About 32 km/h — brisk enough that ordinary
 * jostling in traffic still just shoves, but a proper run at one launches it.
 */
const FLING_SPEED = 9;
const SHATTER_SPEED = 23;
const SPAWN_MIN = 65;
/**
 * Past this the glass, the lamps and the wheels come off a traffic car.
 * Measured: wheels alone were 47% of one, and there are ninety of them.
 */
const DETAIL_DIST = 95;
/** And past this only the shape and the colour of one are left. */
const BODY_DIST = 210;
const SPAWN_MAX = QUALITY.trafficSpawnMax;
const DESPAWN = QUALITY.trafficSpawnMax + 100;

/**
 * Background traffic. Agents are kinematic: they ride the road graph, keep to
 * the right, queue behind each other, obey the signals and get shoved around
 * when the player hits them.
 */
export class Traffic {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.rng = makeRng(31415926);
    this.agents = [];
    this.density = 1;
    this.types = [];
    this.time = 0;

    this._buildMeshes();
    for (let i = 0; i < MAX_AGENTS; i++) {
      this.agents.push({
        active: false, type: 0, colour: new THREE.Color(0xffffff),
        edge: null, forward: true, s: 0, lane: 0, laneOffset: 0,
        speed: 0, desired: 12, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0,
        nudgeX: 0, nudgeZ: 0, wheelSpin: 0, stopped: 0, honkCooldown: 0,
        body: null, flungFor: 0
      });
    }
  }

  _buildMeshes() {
    const dummyGroup = new THREE.Group();
    dummyGroup.name = 'traffic';
    this.group = dummyGroup;

    this.glowMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true, toneMapped: false, color: 0x4a4a4a
    });

    for (const entry of TRAFFIC_MIX) {
      const spec = CAR_BY_ID[entry.id];
      if (!spec) continue;
      const parts = buildCarParts(spec, 'low');
      // instanced traffic uses the single merged glow mesh; the player-only
      // split-out light geometries would just leak
      parts.signGlow?.dispose();
      parts.headLight?.dispose();
      parts.tailLight?.dispose();

      const paintMat = CAR_MATERIALS.paint();
      const detailMat = CAR_MATERIALS.detail();
      const glassMat = CAR_MATERIALS.glass();

      /**
       * Two sets of the same body, near and far.
       *
       * An InstancedMesh casts a shadow or it does not; there is no deciding
       * per instance. Splitting the buffer in two is what lets the cars beside
       * you throw a shadow while the ninety on the far side of the district
       * stay out of the shadow map altogether — measured at 127k triangles a
       * frame of shadow nobody could resolve.
       */
      const paint = new THREE.InstancedMesh(parts.paint, paintMat, MAX_AGENTS);
      const paintFar = new THREE.InstancedMesh(parts.paint, paintMat, MAX_AGENTS);
      const detail = parts.detail ? new THREE.InstancedMesh(parts.detail, detailMat, MAX_AGENTS) : null;
      const detailFar = parts.detail ? new THREE.InstancedMesh(parts.detail, detailMat, MAX_AGENTS) : null;
      const glass = parts.glass ? new THREE.InstancedMesh(parts.glass, glassMat, MAX_AGENTS) : null;
      const glow = parts.glow ? new THREE.InstancedMesh(parts.glow, this.glowMaterial, MAX_AGENTS) : null;
      const wheels = new THREE.InstancedMesh(parts.wheel, detailMat, MAX_AGENTS * 4);

      for (const m of [paint, detail, glass, glow, wheels]) {
        if (!m) continue;
        m.castShadow = true;
        m.count = 0;
        m.frustumCulled = false;
        dummyGroup.add(m);
      }
      for (const m of [paintFar, detailFar]) {
        if (!m) continue;
        m.castShadow = false;
        m.receiveShadow = true;
        m.count = 0;
        m.frustumCulled = false;
        dummyGroup.add(m);
      }

      this.types.push({
        spec, entry, parts, paint, paintFar, detail, detailFar, glass, glow, wheels,
        cursor: 0, farCursor: 0, midCount: 0, wheelCursor: 0
      });
    }

    // weighted picker
    this._weights = [];
    let total = 0;
    this.types.forEach((t, i) => {
      total += t.entry.weight;
      this._weights.push({ i, upTo: total });
    });
    this._weightTotal = total;

    this._dummy = new THREE.Object3D();
    this._probe = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };
  }

  _pickType() {
    const r = this.rng() * this._weightTotal;
    for (const w of this._weights) if (r <= w.upTo) return w.i;
    return 0;
  }

  _laneFor(edge) {
    const perSide = edge.width >= 15 ? 2 : 1;
    const laneW = edge.width / (2 * perSide);
    const idx = perSide > 1 ? (this.rng() > 0.55 ? 1 : 0) : 0;
    return { lane: idx, offset: laneW * (idx + 0.5) };
  }

  /**
   * Spawns onto whatever road happens to be nearest a random point in a ring
   * around the player, which keeps traffic dense wherever you actually are.
   */
  _spawn(agent, playerPos) {
    const net = this.world.network;
    for (let attempt = 0; attempt < 14; attempt++) {
      const ang = this.rng() * Math.PI * 2;
      const dist = SPAWN_MIN + Math.sqrt(this.rng()) * (SPAWN_MAX - SPAWN_MIN);
      const px = playerPos.x + Math.cos(ang) * dist;
      const pz = playerPos.z + Math.sin(ang) * dist;

      const near = net.nearestRoad(px, pz);
      if (!near || near.dist > 30) continue;
      const edge = net.edges[near.edge];
      if (!edge || edge.length < 26) continue;

      let s = clamp(near.s, 4, edge.length - 4);
      const forward = this.rng() > 0.5;
      if (!forward) s = edge.length - s;
      net.pointAlong(edge, s, forward, this._probe);

      const d = Math.hypot(this._probe.x - playerPos.x, this._probe.z - playerPos.z);
      if (d < SPAWN_MIN * 0.8) continue;

      // don't drop a car on top of another
      let clash = false;
      for (const other of this.agents) {
        if (!other.active) continue;
        if (Math.hypot(other.x - this._probe.x, other.z - this._probe.z) < 13) { clash = true; break; }
      }
      if (clash) continue;

      const lane = this._laneFor(edge);
      agent.active = true;
      agent.body = null;
      agent.flungFor = 0;
      agent.quat = null;
      agent.type = this._pickType();
      agent.colour.setHex(TRAFFIC_COLOURS[Math.floor(this.rng() * TRAFFIC_COLOURS.length)]);
      agent.edge = edge;
      agent.forward = forward;
      agent.s = s;
      agent.lane = lane.lane;
      agent.laneOffset = lane.offset;
      agent.desired = edge.speed * randRange(this.rng, 0.82, 1.12);
      agent.speed = agent.desired * 0.7;
      agent.nudgeX = 0;
      agent.nudgeZ = 0;
      agent.stopped = 0;
      this._place(agent);
      return true;
    }
    return false;
  }

  _place(agent) {
    const p = this.world.network.pointAlong(agent.edge, agent.s, agent.forward, this._probe);
    // right of travel = heading x up, so cars keep to the right like in Turkey
    const rx = -p.dz;
    const rz = p.dx;
    agent.x = p.x + rx * agent.laneOffset + agent.nudgeX;
    agent.z = p.z + rz * agent.laneOffset + agent.nudgeZ;
    agent.yaw = Math.atan2(p.dx, p.dz);
    const spec = this.types[agent.type].spec;
    const fwdX = Math.sin(agent.yaw);
    const fwdZ = Math.cos(agent.yaw);
    const rightX = -Math.cos(agent.yaw);
    const rightZ = Math.sin(agent.yaw);
    const wb = spec.wheelBase * 0.5;
    const tr = spec.width * 0.41;
    const h = (f, r) => this.world.ground.heightAt(
      agent.x + fwdX * wb * f + rightX * tr * r,
      agent.z + fwdZ * wb * f + rightZ * tr * r
    );
    const fl = h(1, -1); const fr = h(1, 1);
    const rl = h(-1, -1); const rr = h(-1, 1);
    agent.y = (fl + fr + rl + rr) * 0.25;
    agent.pitch = -Math.atan2((fl + fr - rl - rr) * 0.5, wb * 2);
    agent.roll = -Math.atan2((fr + rr - fl - rl) * 0.5, tr * 2);
  }

  /** Choose the next leg at a junction, preferring to carry straight on. */
  _advanceEdge(agent) {
    const net = this.world.network;
    const nodeId = agent.forward ? agent.edge.b : agent.edge.a;
    const node = net.nodes[nodeId];
    if (!node) { agent.active = false; return; }

    const headX = Math.sin(agent.yaw);
    const headZ = Math.cos(agent.yaw);
    const options = [];

    for (const id of node.edges) {
      if (id === agent.edge.id && node.edges.length > 1) continue;
      const e = net.edges[id];
      const forward = e.a === nodeId;
      const p = forward ? e.path[0] : e.path[e.path.length - 1];
      const q = forward ? e.path[1] : e.path[e.path.length - 2];
      let dx = q.x - p.x;
      let dz = q.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const dot = dx * headX + dz * headZ;
      if (dot < -0.72) continue;              // no U-turns
      const weight = Math.pow(clamp(dot + 1.05, 0.05, 2), 3.2);
      options.push({ e, forward, weight });
    }

    if (!options.length) {
      // dead end: turn around
      agent.forward = !agent.forward;
      agent.s = 0;
      return;
    }

    let total = 0;
    for (const o of options) total += o.weight;
    let r = this.rng() * total;
    let chosen = options[options.length - 1];
    for (const o of options) {
      r -= o.weight;
      if (r <= 0) { chosen = o; break; }
    }

    agent.edge = chosen.e;
    agent.forward = chosen.forward;
    agent.s = 0;
    const lane = this._laneFor(chosen.e);
    agent.lane = lane.lane;
    agent.laneOffset = lane.offset;
    agent.desired = chosen.e.speed * randRange(this.rng, 0.82, 1.12);
  }

  /** 0 empties the roads, 1 is the normal amount. */
  setDensity(d) { this.density = Math.max(0, Math.min(1.5, d)); }

  update(dt, playerVehicle) {
    this.time += dt;
    const net = this.world.network;
    const player = playerVehicle.position;

    // ---- spawn / despawn -------------------------------------------------
    for (const a of this.agents) {
      if (!a.active) continue;
      if (Math.hypot(a.x - player.x, a.z - player.z) > DESPAWN) this._retire(a);
    }
    // the settings screen can thin the traffic out, or empty the roads
    const wanted = Math.round(this.agents.length * this.density);
    let live = 0;
    for (const a of this.agents) if (a.active) live++;
    if (live > wanted) {
      let over = live - wanted;
      for (const a of this.agents) {
        if (over <= 0) break;
        if (!a.active) continue;
        if (Math.hypot(a.x - player.x, a.z - player.z) < 120) continue;
        if (a.body) continue;              // let a wreck finish falling
        a.active = false;
        over--;
        live--;
      }
    }
    let budget = 7;
    for (const a of this.agents) {
      if (a.active || budget <= 0 || live >= wanted) continue;
      if (this._spawn(a, player)) { budget--; live++; }
    }

    // ---- drive -----------------------------------------------------------
    for (const a of this.agents) {
      if (!a.active) continue;

      // A car that has been hit hard is no longer driving anywhere: it is a
      // rigid body now, and it stays one until it has stopped rolling.
      if (a.body) {
        this._followBody(a, dt);
        continue;
      }

      let target = a.desired;

      // slow for the corner ahead
      const remaining = a.edge.length - a.s;
      const nodeId = a.forward ? a.edge.b : a.edge.a;

      // traffic signal
      if (remaining < 42) {
        const state = net.lightFor(nodeId, a.edge.id);
        if (state === 'red' || state === 'yellow') {
          const stopLine = Math.max(0, remaining - (a.edge.width * 0.5 * 1.28 + 3.5));
          if (stopLine < 1.2) target = 0;
          else target = Math.min(target, Math.sqrt(2 * 3.4 * stopLine));
        } else {
          target = Math.min(target, a.edge.speed * 0.95);
        }
      }
      if (remaining < 22) target = Math.min(target, a.edge.speed * 0.72);

      // queue behind whatever is in front
      const aheadX = Math.sin(a.yaw);
      const aheadZ = Math.cos(a.yaw);
      const gapNeeded = 7 + a.speed * 0.9;
      for (const b of this.agents) {
        if (b === a || !b.active) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const along = dx * aheadX + dz * aheadZ;
        if (along <= 0.5 || along > gapNeeded + 8) continue;
        const side = Math.abs(dx * aheadZ - dz * aheadX);
        if (side > 2.4) continue;
        const t = clamp((along - 5.2) / gapNeeded, 0, 1);
        target = Math.min(target, b.speed * t + (t > 0.85 ? 1.5 : 0));
      }

      // and behind the player
      {
        const dx = player.x - a.x;
        const dz = player.z - a.z;
        const along = dx * aheadX + dz * aheadZ;
        const side = Math.abs(dx * aheadZ - dz * aheadX);
        if (along > 0.5 && along < gapNeeded + 8 && side < 2.8) {
          const t = clamp((along - 5.5) / gapNeeded, 0, 1);
          target = Math.min(target, playerVehicle.forwardSpeed * t + 1.0);
        }
      }

      target = Math.max(0, target);
      const accel = target > a.speed ? 3.0 : 7.0;
      a.speed = damp(a.speed, target, accel * 0.55, dt);
      if (a.speed < 0.05) a.speed = 0;

      a.s += a.speed * dt;
      a.wheelSpin += (a.speed / (0.32 * Math.PI * 2)) * dt * 6.0;

      if (a.s >= a.edge.length) {
        a.s -= a.edge.length;
        this._advanceEdge(a);
        if (!a.active) continue;
      }

      a.nudgeX = damp(a.nudgeX, 0, 1.6, dt);
      a.nudgeZ = damp(a.nudgeZ, 0, 1.6, dt);
      this._place(a);
    }

    this._collidePlayer(dt, playerVehicle);
    this._render(player?.position ?? player);
  }

  /**
   * Sends a car flying.
   *
   * The agent stops driving and hands itself to the rigid-body solver: from
   * here on its position and its full orientation come from the physics, so
   * it can leave the ground, roll over and end up on its roof.
   */
  fling(a, vx, vy, vz, spin) {
    if (!this.rigid || a.body) return;
    const spec = this.types[a.type].spec;
    const b = this.rigid.spawn({
      x: a.x, y: a.y + spec.wheelRadius + 0.35, z: a.z,
      hx: spec.width * 0.5, hy: (spec.bodyHeight + spec.cabinHeight) * 0.5, hz: spec.length * 0.5,
      yaw: a.yaw,
      mass: spec.mass,
      restitution: 0.14,
      friction: 0.72,
      render: false,          // the car's own mesh is drawn from this body
      vx, vy, vz,
      sx: spin.x, sy: spin.y, sz: spin.z
    });
    a.body = b;
    a.flungFor = 0;
    a.speed = 0;
    a.stopped = 99;
  }

  /** Reads a flung car's transform back out of the solver. */
  _followBody(a, dt) {
    const b = a.body;
    a.flungFor += dt;
    if (!b.alive) { a.active = false; a.body = null; return; }
    a.x = b.pos.x;
    a.y = b.pos.y - (this.types[a.type].spec.wheelRadius + 0.35);
    a.z = b.pos.z;
    a.quat = b.quat;
    a.wheelSpin += dt * 2.4;
    // once it has come to rest it just lies there; after a while it is cleared
    if (a.flungFor > 26) { b.alive = false; a.active = false; a.body = null; }
  }

  /** Player-vs-traffic contact: shoves both parties apart. */
  _collidePlayer(dt, pv) {
    const spec = pv.spec;
    const pFwdX = Math.sin(pv.yaw);
    const pFwdZ = Math.cos(pv.yaw);

    for (const a of this.agents) {
      if (!a.active || a.body) continue;
      const dx = a.x - pv.position.x;
      const dz = a.z - pv.position.z;
      const rough = Math.hypot(dx, dz);
      if (rough > 9) continue;

      const other = this.types[a.type].spec;
      const aFwdX = Math.sin(a.yaw);
      const aFwdZ = Math.cos(a.yaw);

      // two circles per car along its length
      const pR = spec.width * 0.5;
      const oR = other.width * 0.5;
      for (const ps of [0.28, -0.28]) {
        for (const os of [0.28, -0.28]) {
          const px = pv.position.x + pFwdX * spec.length * ps;
          const pz = pv.position.z + pFwdZ * spec.length * ps;
          const ox = a.x + aFwdX * other.length * os;
          const oz = a.z + aFwdZ * other.length * os;
          let nx = ox - px;
          let nz = oz - pz;
          const d = Math.hypot(nx, nz);
          const minD = pR + oR;
          if (d >= minD || d < 1e-4) continue;
          nx /= d;
          nz /= d;
          const push = minD - d;

          const massRatio = clamp(other.mass / (other.mass + spec.mass), 0.15, 0.85);
          pv.position.x -= nx * push * massRatio;
          pv.position.z -= nz * push * massRatio;
          a.nudgeX += nx * push * (1 - massRatio);
          a.nudgeZ += nz * push * (1 - massRatio);

          const vn = pv.velocity.x * nx + pv.velocity.z * nz;
          if (vn > 0) {
            pv.velocity.x -= nx * vn * 1.25 * massRatio;
            pv.velocity.z -= nz * vn * 1.25 * massRatio;
            pv.yawRate *= 0.75;
            pv.impact = Math.max(pv.impact, Math.min(1, vn / 10));
            a.speed = Math.max(0, a.speed - vn * 0.35);
            a.stopped = 0.9;

            // Past a real closing speed it stops being a shove. The struck
            // car takes the momentum it is due — the lighter it is against
            // what hit it, the further it goes — and leaves the road.
            if (vn > FLING_SPEED && !a.body) {
              const share = (2 * spec.mass) / (spec.mass + other.mass);
              const push = vn * share * 0.85;
              // hitting off-centre is what makes it spin rather than slide
              const lever = ((ox - a.x) * aFwdX + (oz - a.z) * aFwdZ) / Math.max(1, other.length);
              const side = ((ox - a.x) * -aFwdZ + (oz - a.z) * aFwdX) / Math.max(1, other.width);
              pv.crash = Math.max(pv.crash ?? 0, Math.min(1, vn / 16));
              if (vn > SHATTER_SPEED && this.rigid) {
                scatterWreck(
                  this.rigid, other, a.colour.getHex(),
                  { x: a.x, y: a.y, z: a.z }, a.yaw,
                  { x: nx * push, z: nz * push }
                );
                a.active = false;
                pv.addDent(px, pz, -nx, -nz, vn * 0.72);
                return;
              }
              this.fling(
                a,
                nx * push,
                Math.min(7.5, vn * 0.3),
                nz * push,
                {
                  x: (nz * push) * 0.16 * (1 - Math.abs(lever)),
                  y: -lever * push * 0.5 - side * push * 0.25,
                  z: (-nx * push) * 0.16 * (1 - Math.abs(lever))
                }
              );
            }
          }
        }
      }
      if (a.stopped > 0) a.stopped -= dt;
    }
  }

  /**
   * Lays out the instances for this frame.
   *
   * The instances of one car model live in one buffer, and an InstancedMesh is
   * either drawn whole or not at all — there is no per-instance culling to
   * lean on. What there is is the order they are written in: near cars first,
   * far cars after. Then the parts nobody can make out at range simply stop
   * counting partway down the buffer, and a car on the far side of the
   * junction costs a shell instead of a shell, glass, lamps and four wheels.
   */
  _render(focus) {
    const dummy = this._dummy;
    const fx = focus?.x ?? 0;
    const fz = focus?.z ?? 0;
    const near2 = DETAIL_DIST * DETAIL_DIST;
    const mid2 = BODY_DIST * BODY_DIST;

    for (const t of this.types) {
      t.cursor = 0;
      t.farCursor = 0;
      t.midCount = 0;
      t.wheelCursor = 0;
    }

    const pose = (a) => {
      dummy.position.set(a.x, a.y, a.z);
      if (a.body) {
        // a car in the air is not upright, so it needs the whole rotation
        dummy.quaternion.copy(a.body.quat);
      } else {
        dummy.rotation.set(a.pitch ?? 0, a.yaw, a.roll ?? 0, 'YXZ');
      }
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
    };

    // ---- close enough to look at: everything, and a shadow -------------
    for (const a of this.agents) {
      if (!a.active) continue;
      const dx = a.x - fx;
      const dz = a.z - fz;
      if (dx * dx + dz * dz > near2) continue;
      const t = this.types[a.type];
      const i = t.cursor++;
      if (i >= MAX_AGENTS) continue;
      pose(a);
      t.paint.setMatrixAt(i, dummy.matrix);
      t.paint.setColorAt(i, a.colour);
      if (t.detail) t.detail.setMatrixAt(i, dummy.matrix);
      if (t.glass) t.glass.setMatrixAt(i, dummy.matrix);
      if (t.glow) t.glow.setMatrixAt(i, dummy.matrix);

      // wheels get their own transforms so they actually turn
      const carMat = dummy.matrix.clone();
      for (const w of t.parts.wheels) {
        const wi = t.wheelCursor++;
        dummy.position.set(w.x, w.y, w.z);
        dummy.rotation.set(a.wheelSpin, 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        dummy.matrix.premultiply(carMat);
        t.wheels.setMatrixAt(wi, dummy.matrix);
      }
    }

    // ---- down the street: body and trim, no shadow ---------------------
    for (const a of this.agents) {
      if (!a.active) continue;
      const dx = a.x - fx;
      const dz = a.z - fz;
      const d2 = dx * dx + dz * dz;
      if (d2 <= near2 || d2 > mid2) continue;
      const t = this.types[a.type];
      const i = t.farCursor++;
      if (i >= MAX_AGENTS) continue;
      pose(a);
      t.paintFar.setMatrixAt(i, dummy.matrix);
      t.paintFar.setColorAt(i, a.colour);
      if (t.detailFar) t.detailFar.setMatrixAt(i, dummy.matrix);
      t.midCount = t.farCursor;
    }

    // ---- and the far end of the district: a shape and a colour ---------
    for (const a of this.agents) {
      if (!a.active) continue;
      const dx = a.x - fx;
      const dz = a.z - fz;
      if (dx * dx + dz * dz <= mid2) continue;
      const t = this.types[a.type];
      const i = t.farCursor++;
      if (i >= MAX_AGENTS) continue;
      pose(a);
      t.paintFar.setMatrixAt(i, dummy.matrix);
      t.paintFar.setColorAt(i, a.colour);
    }

    for (const t of this.types) {
      t.paint.count = t.cursor;
      t.paint.instanceMatrix.needsUpdate = true;
      if (t.paint.instanceColor) t.paint.instanceColor.needsUpdate = true;
      t.paintFar.count = t.farCursor;
      t.paintFar.instanceMatrix.needsUpdate = true;
      if (t.paintFar.instanceColor) t.paintFar.instanceColor.needsUpdate = true;
      if (t.detail) { t.detail.count = t.cursor; t.detail.instanceMatrix.needsUpdate = true; }
      if (t.detailFar) { t.detailFar.count = t.midCount; t.detailFar.instanceMatrix.needsUpdate = true; }
      if (t.glass) { t.glass.count = t.cursor; t.glass.instanceMatrix.needsUpdate = true; }
      if (t.glow) { t.glow.count = t.cursor; t.glow.instanceMatrix.needsUpdate = true; }
      t.wheels.count = t.wheelCursor;
      t.wheels.instanceMatrix.needsUpdate = true;
    }
  }

  /** Takes an agent off the road, returning its body to the pool if it has one. */
  _retire(a) {
    if (a.body) { a.body.alive = false; a.body = null; }
    a.active = false;
  }

  /** Positions for the minimap. */
  forEachActive(fn) {
    for (const a of this.agents) if (a.active) fn(a);
  }

  setNight(isNight) {
    this.glowMaterial.color.setScalar(isNight ? 1.0 : 0.29);
  }
}
