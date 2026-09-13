import * as THREE from 'three';
import { QUALITY } from '../quality.js';
import { clamp, randRange } from '../util/math.js';
import { createCrowdParts } from '../vehicles/person.js';

const RANGE = 260;
const G = 9.81;
const UP = new THREE.Vector3(0, 1, 0);
const SHIRTS = [0x334f73, 0x7d3f36, 0x41613e, 0x8a3342, 0x3b4653, 0x74527f];
const TROUSERS = [0x202631, 0x34363a, 0x273444, 0x403832, 0x1d2430];

/**
 * An articulated, instanced crowd with a connected ragdoll pose.
 *
 * Each body part is one draw call for the entire crowd.  A struck pedestrian
 * keeps all joints attached while the hips follow a ballistic body and the
 * limbs react to the hit, so it reads as a ragdoll instead of six boxes
 * exploding away from one another.
 */
export class PedestrianCrowd {
  constructor(network, ground, rng) {
    this.network = network;
    this.ground = ground;
    this.rng = rng;
    this.count = QUALITY.pedestrians;
    this.edges = network.edges.filter((e) => e.type !== 'highway' && e.length > 40);
    this.people = [];
    this.group = new THREE.Group();
    this.group.name = 'pedestrians';
    this.onHit = () => {};

    const parts = createCrowdParts(QUALITY.tier === 'mobile' ? 'low' : 'high');
    const cloth = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xb77a56, roughness: 0.9 });
    const face = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.96 });

    this.meshes = {
      pelvis: this._mesh(parts.pelvis, cloth, this.count),
      torso: this._mesh(parts.torso, cloth, this.count),
      head: this._mesh(parts.head, face, this.count),
      upperArm: this._mesh(parts.upperArm, cloth, this.count * 2),
      foreArm: this._mesh(parts.foreArm, skin, this.count * 2),
      hand: this._mesh(parts.hand, skin, this.count * 2),
      thigh: this._mesh(parts.thigh, cloth, this.count * 2),
      shin: this._mesh(parts.shin, cloth, this.count * 2),
      foot: this._mesh(parts.foot, shoe, this.count * 2)
    };

    const colour = new THREE.Color();
    for (let i = 0; i < this.count; i++) {
      const shirt = SHIRTS[Math.floor(rng() * SHIRTS.length)];
      const trousers = TROUSERS[Math.floor(rng() * TROUSERS.length)];
      this.meshes.torso.setColorAt(i, colour.setHex(shirt));
      this.meshes.pelvis.setColorAt(i, colour.setHex(trousers));
      for (const side of [0, 1]) {
        const j = i * 2 + side;
        this.meshes.upperArm.setColorAt(j, colour.setHex(shirt));
        this.meshes.thigh.setColorAt(j, colour.setHex(trousers));
        this.meshes.shin.setColorAt(j, colour.setHex(trousers));
      }

      const edge = this.edges.length ? this.edges[Math.floor(rng() * this.edges.length)] : null;
      this.people.push({
        edge, s: rng() * (edge?.length || 1), dir: rng() > 0.5 ? 1 : -1,
        side: rng() > 0.5 ? 1 : -1, speed: randRange(rng, 0.9, 1.6),
        phase: rng() * Math.PI * 2, check: rng() * 2,
        x: 0, y: 0, z: 0, yaw: 0,
        ragdoll: false, ragTime: 0, rest: 0,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        quat: new THREE.Quaternion(), spin: new THREE.Vector3()
      });
    }
    for (const m of Object.values(this.meshes)) {
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    this._probe = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };
    this._matrix = new THREE.Matrix4();
    this._root = new THREE.Matrix4();
    this._local = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._centre = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._scale = new THREE.Vector3(1, 1, 1);
    this._joints = Array.from({ length: 6 }, () => new THREE.Vector3());
  }

  _mesh(geo, mat, count) {
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = count;
    this.group.add(mesh);
    return mesh;
  }

  setDensity(d) {
    const active = Math.round(this.count * clamp(d, 0, 1));
    for (const m of Object.values(this.meshes)) {
      m.count = m === this.meshes.upperArm || m === this.meshes.foreArm ||
        m === this.meshes.hand || m === this.meshes.thigh ||
        m === this.meshes.shin || m === this.meshes.foot ? active * 2 : active;
    }
    this.activeCount = active;
  }

  _rehome(p, at) {
    for (let tries = 0; tries < 28; tries++) {
      const e = this.edges[Math.floor(this.rng() * this.edges.length)];
      if (!e) return;
      const mid = e.path[Math.floor(e.path.length / 2)];
      if (Math.hypot(mid.x - at.x, mid.z - at.z) > RANGE) continue;
      p.edge = e;
      p.s = this.rng() * e.length;
      p.dir = this.rng() > 0.5 ? 1 : -1;
      p.side = this.rng() > 0.5 ? 1 : -1;
      p.ragdoll = false;
      p.rest = 0;
      return;
    }
  }

  _walk(p, dt, time, at) {
    if (at) {
      p.check -= dt;
      if (p.check <= 0) {
        p.check = 1.5 + this.rng();
        const mid = p.edge?.path[Math.floor(p.edge.path.length / 2)];
        if (!mid || Math.hypot(mid.x - at.x, mid.z - at.z) > RANGE * 1.35) this._rehome(p, at);
      }
    }
    if (!p.edge) return;
    p.s += p.speed * p.dir * dt;
    if (p.s > p.edge.length) { p.s = p.edge.length; p.dir = -1; }
    else if (p.s < 0) { p.s = 0; p.dir = 1; }

    this.network.pointAlong(p.edge, p.s, true, this._probe);
    const off = (p.edge.width * 0.5 + 0.4 + (p.edge.major ? 2.0 : 1.5)) * p.side;
    p.x = this._probe.x - this._probe.dz * off;
    p.z = this._probe.z + this._probe.dx * off;
    p.y = this.ground.heightAt(p.x, p.z);
    p.yaw = Math.atan2(this._probe.dx * p.dir, this._probe.dz * p.dir);
    p.walkPhase = time * p.speed * 3.4 + p.phase;
  }

  _hitTest(p, vehicle) {
    if (!vehicle || vehicle.dead || vehicle.speed < 1.8) return;
    const fwdX = Math.sin(vehicle.yaw);
    const fwdZ = Math.cos(vehicle.yaw);
    const radius = vehicle.spec.width * 0.48 + 0.28;
    let best = Infinity;
    for (const s of [0.42, 0.16, -0.16, -0.42]) {
      const cx = vehicle.position.x + fwdX * vehicle.spec.length * s;
      const cz = vehicle.position.z + fwdZ * vehicle.spec.length * s;
      best = Math.min(best, Math.hypot(p.x - cx, p.z - cz));
    }
    if (best > radius) return;

    const speed = vehicle.speed;
    let nx = p.x - vehicle.position.x;
    let nz = p.z - vehicle.position.z;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    p.ragdoll = true;
    p.ragTime = 0;
    p.rest = 0;
    p.pos.set(p.x, p.y + 0.9, p.z);
    const carry = clamp(0.56 + speed / 90, 0.58, 0.82);
    p.vel.set(
      vehicle.velocity.x * carry + nx * Math.min(5, speed * 0.16),
      clamp(1.4 + speed * 0.25, 2.0, 10.5),
      vehicle.velocity.z * carry + nz * Math.min(5, speed * 0.16)
    );
    p.spin.set(
      (Math.random() - 0.5) * (4 + speed * 0.35),
      (Math.random() - 0.5) * (3 + speed * 0.18),
      (Math.random() - 0.5) * (5 + speed * 0.42)
    );
    p.quat.identity();
    vehicle.velocity.multiplyScalar(clamp(1 - 74 / Math.max(900, vehicle.spec.mass), 0.91, 0.97));
    vehicle.impact = Math.max(vehicle.impact, Math.min(0.72, speed / 30));
    const noseX = vehicle.position.x + fwdX * vehicle.spec.length * 0.42;
    const noseZ = vehicle.position.z + fwdZ * vehicle.spec.length * 0.42;
    vehicle.addDent(noseX, noseZ, -fwdX, -fwdZ, speed * 0.34);
    this.onHit(p, speed);
  }

  _rag(p, dt, at) {
    p.ragTime += dt;
    p.vel.y -= G * dt;
    p.vel.multiplyScalar(Math.exp(-0.12 * dt));
    p.pos.addScaledVector(p.vel, dt);

    const qStep = this._quat.set(p.spin.x * dt * 0.5, p.spin.y * dt * 0.5, p.spin.z * dt * 0.5, 0);
    qStep.multiply(p.quat);
    p.quat.set(
      p.quat.x + qStep.x, p.quat.y + qStep.y,
      p.quat.z + qStep.z, p.quat.w + qStep.w
    ).normalize();

    const gy = this.ground.heightAt(p.pos.x, p.pos.z);
    if (p.pos.y < gy + 0.48) {
      p.pos.y = gy + 0.48;
      if (p.vel.y < 0) p.vel.y *= -0.18;
      p.vel.x *= 0.76;
      p.vel.z *= 0.76;
      p.spin.multiplyScalar(0.64);
      if (p.vel.lengthSq() < 0.34 && p.spin.lengthSq() < 0.8) p.rest += dt;
    }
    p.x = p.pos.x; p.y = gy; p.z = p.pos.z;
    if (p.rest > 4.5 || p.ragTime > 12 || (at && Math.hypot(p.x - at.x, p.z - at.z) > RANGE * 1.4)) {
      this._rehome(p, at || p);
    }
  }

  /** Places a segment between two skeleton joints. */
  _segment(mesh, index, a, b, root, baseLength) {
    this._centre.copy(a).add(b).multiplyScalar(0.5);
    this._a.copy(b).sub(a);
    const len = this._a.length();
    if (len < 1e-5) this._a.set(0, 1, 0);
    else this._a.multiplyScalar(1 / len);
    this._quat.setFromUnitVectors(UP, this._a);
    this._local.compose(this._centre, this._quat, this._scale.set(1, len / baseLength, 1));
    this._matrix.multiplyMatrices(root, this._local);
    mesh.setMatrixAt(index, this._matrix);
  }

  _pose(p, i) {
    const rag = p.ragdoll;
    if (rag) this._root.compose(p.pos, p.quat, this._scale.set(1, 1, 1));
    else {
      this._centre.set(p.x, p.y + 0.90, p.z);
      this._quat.setFromAxisAngle(UP, p.yaw);
      this._root.compose(this._centre, this._quat, this._scale.set(1, 1, 1));
    }

    const t = rag ? p.ragTime * 9 + p.phase : p.walkPhase;
    const flail = rag ? clamp(p.spin.length() * 0.055, 0.25, 0.9) : 0;
    const stride = rag ? Math.sin(t) * flail : Math.sin(t) * 0.48;
    const armSwing = rag ? Math.sin(t * 1.17 + 0.8) * flail * 1.15 : -stride * 0.9;
    const crouch = rag ? -0.08 : Math.abs(Math.sin(t)) * 0.025;

    this._local.makeTranslation(0, 0.04 + crouch, 0);
    this._matrix.multiplyMatrices(this._root, this._local);
    this.meshes.pelvis.setMatrixAt(i, this._matrix);
    this._local.makeTranslation(0, 0.34 + crouch, 0);
    this._matrix.multiplyMatrices(this._root, this._local);
    this.meshes.torso.setMatrixAt(i, this._matrix);
    this._local.makeTranslation(0, 0.71 + crouch, 0.015);
    this._matrix.multiplyMatrices(this._root, this._local);
    this.meshes.head.setMatrixAt(i, this._matrix);

    for (const side of [-1, 1]) {
      const j = i * 2 + (side > 0 ? 1 : 0);
      const [shoulder, elbow, hand, hip, knee, ankle] = this._joints;
      shoulder.set(side * 0.235, 0.50 + crouch, 0);
      const aAng = armSwing * side;
      elbow.set(
        side * 0.27, shoulder.y - Math.cos(aAng) * 0.28,
        Math.sin(aAng) * 0.28
      );
      hand.set(
        side * (0.27 + 0.025 * (rag ? Math.sin(t * 0.7) : 1)),
        elbow.y - Math.cos(aAng * 0.55 - (rag ? side * 0.5 : 0)) * 0.27,
        elbow.z + Math.sin(aAng * 0.55 - (rag ? side * 0.5 : 0)) * 0.27
      );
      this._segment(this.meshes.upperArm, j, shoulder, elbow, this._root, 0.28);
      this._segment(this.meshes.foreArm, j, elbow, hand, this._root, 0.27);
      this._local.makeTranslation(hand.x, hand.y - 0.04, hand.z);
      this._matrix.multiplyMatrices(this._root, this._local);
      this.meshes.hand.setMatrixAt(j, this._matrix);

      hip.set(side * 0.09, -0.07 + crouch, 0);
      const lAng = stride * side;
      knee.set(side * 0.09, hip.y - Math.cos(lAng) * 0.41, Math.sin(lAng) * 0.41);
      const bend = rag ? Math.sin(t * 0.83 + side) * 0.75 : Math.max(0, -Math.cos(t + (side > 0 ? 0 : Math.PI))) * 0.72;
      ankle.set(side * 0.09, knee.y - Math.cos(bend) * 0.40, knee.z + Math.sin(bend) * 0.40);
      this._segment(this.meshes.thigh, j, hip, knee, this._root, 0.41);
      this._segment(this.meshes.shin, j, knee, ankle, this._root, 0.40);
      this._local.makeTranslation(ankle.x, ankle.y - 0.045, ankle.z + 0.07);
      this._matrix.multiplyMatrices(this._root, this._local);
      this.meshes.foot.setMatrixAt(j, this._matrix);
    }
  }

  update(dt, time, at, vehicle) {
    const n = this.activeCount ?? this.count;
    for (let i = 0; i < n; i++) {
      const p = this.people[i];
      if (p.ragdoll) this._rag(p, dt, at);
      else {
        this._walk(p, dt, time, at);
        this._hitTest(p, vehicle);
      }
      this._pose(p, i);
    }
    for (const m of Object.values(this.meshes)) m.instanceMatrix.needsUpdate = true;
  }
}
