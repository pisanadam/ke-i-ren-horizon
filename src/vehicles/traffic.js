import * as THREE from 'three';
import { buildCarParts, CAR_MATERIALS } from './carModel.js';
import { CAR_BY_ID, TRAFFIC_MIX, TRAFFIC_COLOURS } from './catalog.js';
import { makeRng, clamp, damp, randRange } from '../util/math.js';

const MAX_AGENTS = 92;
const SPAWN_MIN = 65;
const SPAWN_MAX = 360;
const DESPAWN = 460;

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
    this.types = [];
    this.time = 0;

    this._buildMeshes();
    for (let i = 0; i < MAX_AGENTS; i++) {
      this.agents.push({
        active: false, type: 0, colour: new THREE.Color(0xffffff),
        edge: null, forward: true, s: 0, lane: 0, laneOffset: 0,
        speed: 0, desired: 12, x: 0, y: 0, z: 0, yaw: 0,
        nudgeX: 0, nudgeZ: 0, wheelSpin: 0, stopped: 0, honkCooldown: 0
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

      const paint = new THREE.InstancedMesh(parts.paint, paintMat, MAX_AGENTS);
      const detail = parts.detail ? new THREE.InstancedMesh(parts.detail, detailMat, MAX_AGENTS) : null;
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

      this.types.push({
        spec, entry, parts, paint, detail, glass, glow, wheels,
        cursor: 0, wheelCursor: 0
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
    agent.y = p.y;
    agent.yaw = Math.atan2(p.dx, p.dz);
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

  update(dt, playerVehicle) {
    this.time += dt;
    const net = this.world.network;
    const player = playerVehicle.position;

    // ---- spawn / despawn -------------------------------------------------
    for (const a of this.agents) {
      if (!a.active) continue;
      if (Math.hypot(a.x - player.x, a.z - player.z) > DESPAWN) a.active = false;
    }
    let budget = 7;
    for (const a of this.agents) {
      if (a.active || budget <= 0) continue;
      if (this._spawn(a, player)) budget--;
    }

    // ---- drive -----------------------------------------------------------
    for (const a of this.agents) {
      if (!a.active) continue;

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
    this._render();
  }

  /** Player-vs-traffic contact: shoves both parties apart. */
  _collidePlayer(dt, pv) {
    const spec = pv.spec;
    const pFwdX = Math.sin(pv.yaw);
    const pFwdZ = Math.cos(pv.yaw);

    for (const a of this.agents) {
      if (!a.active) continue;
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
          }
        }
      }
      if (a.stopped > 0) a.stopped -= dt;
    }
  }

  _render() {
    const dummy = this._dummy;
    for (const t of this.types) {
      t.cursor = 0;
      t.wheelCursor = 0;
    }

    for (const a of this.agents) {
      if (!a.active) continue;
      const t = this.types[a.type];
      const i = t.cursor++;
      if (i >= MAX_AGENTS) continue;

      dummy.position.set(a.x, a.y, a.z);
      dummy.rotation.set(0, a.yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();

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

    for (const t of this.types) {
      t.paint.count = t.cursor;
      t.paint.instanceMatrix.needsUpdate = true;
      if (t.paint.instanceColor) t.paint.instanceColor.needsUpdate = true;
      if (t.detail) { t.detail.count = t.cursor; t.detail.instanceMatrix.needsUpdate = true; }
      if (t.glass) { t.glass.count = t.cursor; t.glass.instanceMatrix.needsUpdate = true; }
      if (t.glow) { t.glow.count = t.cursor; t.glow.instanceMatrix.needsUpdate = true; }
      t.wheels.count = t.wheelCursor;
      t.wheels.instanceMatrix.needsUpdate = true;
    }

  }

  /** Positions for the minimap. */
  forEachActive(fn) {
    for (const a of this.agents) if (a.active) fn(a);
  }

  setNight(isNight) {
    this.glowMaterial.color.setScalar(isNight ? 1.0 : 0.29);
  }
}
