import * as THREE from 'three';
import { QUALITY } from '../quality.js';

/**
 * Rigid bodies.
 *
 * Everything that gets knocked loose — a snapped lamp column, the rubble off
 * a wall, a parked car sent cartwheeling down the street — is a box with a
 * mass and an inertia tensor, integrated properly and bounced off the
 * heightfield with contact impulses. That is what makes debris tumble, land
 * on a corner, roll over and settle instead of sliding about flat.
 *
 * It is deliberately not a general physics engine. Bodies never collide with
 * each other, only with the ground: with a hundred pieces of rubble in the
 * air the pairwise test is where all the time would go, and two bits of a
 * broken lamp post passing through each other is not something anybody
 * notices while it is happening. What they do notice is a plank landing flat
 * and stopping dead, which is exactly what the contact solver here prevents.
 *
 * Bodies that have come to rest stop integrating, so a street full of
 * wreckage costs nothing once the dust has settled.
 */

const G = 9.81;
/**
 * A body resting on the ground still gains `g · dt` of downward speed every
 * frame before the contact takes it away again, so its measured velocity
 * never falls below about 0.16 m/s at 60 fps and twice that at 30. The
 * threshold has to clear that, or nothing ever settles and a street full of
 * rubble keeps costing solver time for ever.
 */
const SLEEP_V = 0.42;
const SLEEP_W = 0.5;
const SLEEP_TIME = 0.5;
const MAX_LIFE = 34;

/** Corner signs of a box, in body space. */
const CORNERS = [
  [-1, -1, -1], [1, -1, -1], [-1, -1, 1], [1, -1, 1],
  [-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1]
];

class Body {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.spin = new THREE.Vector3();     // angular velocity, world space
    this.half = new THREE.Vector3(0.5, 0.5, 0.5);
    this.colour = new THREE.Color(0x888888);
    this.mass = 1;
    this.invMass = 1;
    this.invI = new THREE.Vector3(1, 1, 1);   // body-space inverse inertia
    this.restitution = 0.22;
    this.friction = 0.62;
    this.alive = false;
    this.render = true;
    this.shape = 'box';
    this.asleep = false;
    this.still = 0;
    this.life = 0;
  }

  /** Box inertia from the half extents. */
  _mass(mass) {
    this.mass = Math.max(0.05, mass);
    this.invMass = 1 / this.mass;
    const h = this.half;
    const k = this.mass / 3;
    const ix = k * (h.y * h.y + h.z * h.z);
    const iy = k * (h.x * h.x + h.z * h.z);
    const iz = k * (h.x * h.x + h.y * h.y);
    this.invI.set(1 / Math.max(1e-4, ix), 1 / Math.max(1e-4, iy), 1 / Math.max(1e-4, iz));
  }

  wake() {
    this.asleep = false;
    this.still = 0;
  }
}

export class RigidWorld {
  constructor(ground, scene) {
    this.ground = ground;
    this.scene = scene;
    this.max = QUALITY.tier === 'mobile' ? 56 : 160;
    this.bodies = [];
    for (let i = 0; i < this.max; i++) this.bodies.push(new Body());
    this.cursor = 0;

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.82, metalness: 0.12, envMapIntensity: 2
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.name = 'debris';

    const panelMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.48, metalness: 0.48, envMapIntensity: 2.4
    });
    this.panelMesh = new THREE.InstancedMesh(geo, panelMat, this.max);
    this.panelMesh.name = 'wreck-panels';

    // The old wreck rendered tyres as cuboids.  A low-sided cylinder costs
    // almost the same and, with full rigid-body orientation, actually rolls.
    const wheelGeo = new THREE.CylinderGeometry(1, 1, 2, 14, 1);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.04 });
    this.wheelMesh = new THREE.InstancedMesh(wheelGeo, wheelMat, this.max);
    this.wheelMesh.name = 'wreck-wheels';

    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.18, metalness: 0.04,
      transparent: true, opacity: 0.58, depthWrite: false, side: THREE.DoubleSide
    });
    this.glassMesh = new THREE.InstancedMesh(geo, glassMat, this.max);
    this.glassMesh.name = 'wreck-glass';

    this.renderMeshes = {
      box: this.mesh, panel: this.panelMesh, wheel: this.wheelMesh, glass: this.glassMesh
    };
    for (const m of Object.values(this.renderMeshes)) {
      m.castShadow = m !== this.glassMesh;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
    }

    this._dummy = new THREE.Object3D();
    this._m3 = new THREE.Matrix3();
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
    this._tmpC = new THREE.Vector3();
    this._tmpQ = new THREE.Quaternion();
  }

  /**
   * Puts a body into the world.
   *
   * @param {object} o `x,y,z` centre, `hx,hy,hz` half extents, `mass`,
   *   `vx,vy,vz` launch velocity, `sx,sy,sz` spin, `colour`, `quat`,
   *   `render` false when the caller draws it itself (a car, say).
   * @returns {Body}
   */
  spawn(o) {
    // oldest first, but never steal a body that is still moving if a sleeping
    // one is available — settled rubble is the cheapest thing to recycle
    let b = null;
    for (let i = 0; i < this.max; i++) {
      const cand = this.bodies[(this.cursor + i) % this.max];
      if (!cand.alive) { b = cand; this.cursor = (this.cursor + i + 1) % this.max; break; }
    }
    if (!b) {
      for (let i = 0; i < this.max; i++) {
        const cand = this.bodies[(this.cursor + i) % this.max];
        if (cand.asleep) { b = cand; this.cursor = (this.cursor + i + 1) % this.max; break; }
      }
    }
    if (!b) {
      b = this.bodies[this.cursor];
      this.cursor = (this.cursor + 1) % this.max;
    }

    b.pos.set(o.x, o.y, o.z);
    b.vel.set(o.vx ?? 0, o.vy ?? 0, o.vz ?? 0);
    b.spin.set(o.sx ?? 0, o.sy ?? 0, o.sz ?? 0);
    b.half.set(Math.max(0.03, o.hx), Math.max(0.03, o.hy), Math.max(0.03, o.hz));
    if (o.quat) b.quat.copy(o.quat);
    else b.quat.setFromEuler(new THREE.Euler(o.pitch ?? 0, o.yaw ?? 0, o.roll ?? 0, 'YXZ'));
    b.colour.set(o.colour ?? 0x8a8a8a);
    b.restitution = o.restitution ?? 0.2;
    b.friction = o.friction ?? 0.62;
    b._mass(o.mass ?? (8 * b.half.x * b.half.y * b.half.z * 600));
    b.render = o.render !== false;
    b.shape = this.renderMeshes[o.shape] ? o.shape : 'box';
    b.alive = true;
    b.asleep = false;
    b.still = 0;
    b.life = 0;
    return b;
  }

  /** True when there is room for `n` more pieces without evicting anything live. */
  free() {
    let n = 0;
    for (const b of this.bodies) if (!b.alive) n++;
    return n;
  }

  update(dt, focus) {
    const step = Math.min(dt, 1 / 30);
    for (const b of this.bodies) {
      if (!b.alive) continue;
      b.life += dt;
      if (b.life > MAX_LIFE || (focus && Math.hypot(b.pos.x - focus.x, b.pos.z - focus.z) > 420)) {
        b.alive = false;
        continue;
      }
      if (b.asleep) continue;
      this._integrate(b, step);
    }
    this._render();
  }

  _integrate(b, dt) {
    b.vel.y -= G * dt;
    // gentle air drag, so nothing keeps spinning for ever
    b.vel.multiplyScalar(1 - 0.28 * dt);
    b.spin.multiplyScalar(1 - 0.9 * dt);

    b.pos.addScaledVector(b.vel, dt);

    // integrate the orientation: q' = q + 0.5 * w * q
    const w = b.spin;
    const q = b.quat;
    const dq = this._tmpQ.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0);
    dq.multiply(q);
    q.set(q.x + dq.x, q.y + dq.y, q.z + dq.z, q.w + dq.w).normalize();

    this._contacts(b, dt);
  }

  /**
   * Ground contacts, one corner at a time.
   *
   * Each penetrating corner gets a normal impulse that kills the approach
   * speed and a friction impulse across it. Applying them at the corner
   * rather than at the centre is the whole point — that offset is what turns
   * a landing into a topple.
   */
  _contacts(b, dt) {
    const invI = this._worldInvInertia(b);
    const r = this._tmpA;
    const cv = this._tmpB;
    const imp = this._tmpC;
    let deepest = 0;
    let hit = false;

    for (const c of CORNERS) {
      r.set(c[0] * b.half.x, c[1] * b.half.y, c[2] * b.half.z).applyQuaternion(b.quat);
      const px = b.pos.x + r.x;
      const py = b.pos.y + r.y;
      const pz = b.pos.z + r.z;
      const gy = this.ground.heightAt(px, pz);
      const depth = gy - py;
      if (depth <= 0) continue;
      hit = true;
      if (depth > deepest) deepest = depth;

      const n = this.ground.normalAt ? this.ground.normalAt(px, pz, 1.2) : null;
      const nx = n ? n.x : 0;
      const ny = n ? Math.max(0.2, n.y ?? 1) : 1;
      const nz = n ? n.z : 0;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const Nx = nx / nl;
      const Ny = ny / nl;
      const Nz = nz / nl;

      // velocity of this corner
      cv.set(
        b.vel.x + b.spin.y * r.z - b.spin.z * r.y,
        b.vel.y + b.spin.z * r.x - b.spin.x * r.z,
        b.vel.z + b.spin.x * r.y - b.spin.y * r.x
      );
      const vn = cv.x * Nx + cv.y * Ny + cv.z * Nz;
      if (vn >= 0) continue;

      // effective mass along the normal: 1/m + n · ((I⁻¹(r × n)) × r)
      const rxn = new THREE.Vector3(
        r.y * Nz - r.z * Ny,
        r.z * Nx - r.x * Nz,
        r.x * Ny - r.y * Nx
      );
      const iRxn = rxn.clone().applyMatrix3(invI);
      const term = new THREE.Vector3(
        iRxn.y * r.z - iRxn.z * r.y,
        iRxn.z * r.x - iRxn.x * r.z,
        iRxn.x * r.y - iRxn.y * r.x
      );
      const denom = b.invMass + (term.x * Nx + term.y * Ny + term.z * Nz);
      if (denom <= 1e-6) continue;

      // a slow corner should settle, not trampoline
      const e = Math.abs(vn) < 1.4 ? 0 : b.restitution;
      const j = (-(1 + e) * vn) / denom;

      imp.set(Nx * j, Ny * j, Nz * j);
      b.vel.addScaledVector(imp, b.invMass);
      const torque = new THREE.Vector3(
        r.y * imp.z - r.z * imp.y,
        r.z * imp.x - r.x * imp.z,
        r.x * imp.y - r.y * imp.x
      ).applyMatrix3(invI);
      b.spin.add(torque);

      // friction across the contact
      const tvx = cv.x - Nx * vn;
      const tvy = cv.y - Ny * vn;
      const tvz = cv.z - Nz * vn;
      const tl = Math.hypot(tvx, tvy, tvz);
      if (tl > 1e-4) {
        const jt = Math.min(tl / denom, b.friction * j);
        imp.set((-tvx / tl) * jt, (-tvy / tl) * jt, (-tvz / tl) * jt);
        b.vel.addScaledVector(imp, b.invMass);
        const ft = new THREE.Vector3(
          r.y * imp.z - r.z * imp.y,
          r.z * imp.x - r.x * imp.z,
          r.x * imp.y - r.y * imp.x
        ).applyMatrix3(invI);
        b.spin.add(ft);
      }
    }

    if (hit) {
      // push out of the ground, gently, so the correction adds no energy
      b.pos.y += deepest * 0.65;
      if (b.vel.lengthSq() < SLEEP_V * SLEEP_V && b.spin.lengthSq() < SLEEP_W * SLEEP_W) {
        // Resting contact bleeds off what little is left. Without this a piece
        // balanced on a slope rocks under the sleep threshold for ever without
        // ever quite reaching it.
        b.vel.multiplyScalar(0.72);
        b.spin.multiplyScalar(0.6);
        b.still += dt;
        if (b.still > SLEEP_TIME) {
          b.asleep = true;
          b.vel.set(0, 0, 0);
          b.spin.set(0, 0, 0);
        }
      } else {
        b.still = 0;
      }
    }
  }

  /** R · I⁻¹ · Rᵀ for the current orientation. */
  _worldInvInertia(b) {
    const m = new THREE.Matrix4().makeRotationFromQuaternion(b.quat);
    const e = m.elements;
    const ix = b.invI.x;
    const iy = b.invI.y;
    const iz = b.invI.z;
    // columns of R scaled by the diagonal, times Rᵀ
    const r00 = e[0]; const r01 = e[4]; const r02 = e[8];
    const r10 = e[1]; const r11 = e[5]; const r12 = e[9];
    const r20 = e[2]; const r21 = e[6]; const r22 = e[10];
    const a00 = r00 * ix; const a01 = r01 * iy; const a02 = r02 * iz;
    const a10 = r10 * ix; const a11 = r11 * iy; const a12 = r12 * iz;
    const a20 = r20 * ix; const a21 = r21 * iy; const a22 = r22 * iz;
    return this._m3.set(
      a00 * r00 + a01 * r01 + a02 * r02,
      a00 * r10 + a01 * r11 + a02 * r12,
      a00 * r20 + a01 * r21 + a02 * r22,
      a10 * r00 + a11 * r01 + a12 * r02,
      a10 * r10 + a11 * r11 + a12 * r12,
      a10 * r20 + a11 * r21 + a12 * r22,
      a20 * r00 + a21 * r01 + a22 * r02,
      a20 * r10 + a21 * r11 + a22 * r12,
      a20 * r20 + a21 * r21 + a22 * r22
    );
  }

  _render() {
    const d = this._dummy;
    const counts = { box: 0, panel: 0, wheel: 0, glass: 0 };
    for (const b of this.bodies) {
      if (!b.alive || !b.render) continue;
      const shape = this.renderMeshes[b.shape] ? b.shape : 'box';
      const mesh = this.renderMeshes[shape];
      const n = counts[shape]++;
      d.position.copy(b.pos);
      d.quaternion.copy(b.quat);
      if (shape === 'wheel') d.scale.copy(b.half);
      else d.scale.set(b.half.x * 2, b.half.y * 2, b.half.z * 2);
      d.updateMatrix();
      mesh.setMatrixAt(n, d.matrix);
      mesh.setColorAt(n, b.colour);
    }
    for (const [shape, mesh] of Object.entries(this.renderMeshes)) {
      mesh.count = counts[shape];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  clear() {
    for (const b of this.bodies) b.alive = false;
    for (const m of Object.values(this.renderMeshes)) m.count = 0;
  }
}
