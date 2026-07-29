import * as THREE from 'three';
import { clamp, damp, wrapAngle, sign } from '../util/math.js';
import { MAP } from '../world/mapData.js';

const G = 9.81;

/**
 * Arcade car physics built on a two-axle bicycle model: each axle generates a
 * lateral force from its slip angle, which is what makes the cars turn, push
 * wide when overdriven, and step out under the handbrake.
 */
export class Vehicle {
  constructor(spec, world) {
    this.spec = spec;
    this.world = world;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.yawRate = 0;

    this.steer = 0;
    this.wheelSpin = 0;
    this.suspension = 0;
    this.pitch = 0;
    this.roll = 0;
    this.bodyPitch = 0;
    this.bodyRoll = 0;

    this.gear = 1;
    this.rpm = 800;
    this.slip = 0;
    this.onRoad = true;
    this.surfaceGrip = 1;
    this.impact = 0;
    this.airborne = false;
    this.verticalVel = 0;
    this.groundY = 0;
    this.distance = 0;
    this.topSpeedSeen = 0;

    this.inertia = (spec.mass * (spec.length * spec.length + spec.width * spec.width)) / 12;

    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
  }

  reset(x, z, yaw = 0) {
    this.position.set(x, this.world.ground.heightAt(x, z), z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.yawRate = 0;
    this.steer = 0;
    this.verticalVel = 0;
    this.airborne = false;
    this.bodyPitch = 0;
    this.bodyRoll = 0;
  }

  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get speedKmh() {
    return this.speed * 3.6;
  }

  get forwardSpeed() {
    return this.velocity.x * Math.sin(this.yaw) + this.velocity.z * Math.cos(this.yaw);
  }

  update(dt, input) {
    const spec = this.spec;
    const { ground, network, colliders } = this.world;

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    this._fwd.set(sinY, 0, cosY);
    this._right.set(cosY, 0, -sinY);

    const vLong = this.velocity.x * this._fwd.x + this.velocity.z * this._fwd.z;
    const vLat = this.velocity.x * this._right.x + this.velocity.z * this._right.z;
    const speed = this.speed;

    // ------------------------------------------------------------ surface
    const near = network.nearestRoad(this.position.x, this.position.z);
    this.onRoad = !!near && near.dist < near.halfWidth + 0.6;
    const offRoadGrip = spec.id === 'suv' ? 0.86 : 0.62;
    this.surfaceGrip = damp(this.surfaceGrip, this.onRoad ? 1 : offRoadGrip, 6, dt);

    // ------------------------------------------------------------ steering
    const speedFactor = 0.30 + 0.70 * Math.exp(-Math.abs(vLong) / 26);
    const targetSteer = input.steer * spec.steerMax * speedFactor;
    const steerRate = 6.5 + 4 * (1 - Math.min(1, Math.abs(vLong) / 30));
    this.steer = damp(this.steer, targetSteer, steerRate, dt);

    // ---------------------------------------------------------- long. force
    const topSpeed = spec.topSpeed;
    let engineF = 0;
    let brakeF = 0;

    if (input.throttle > 0) {
      const fade = clamp(1 - Math.max(0, vLong) / topSpeed, 0, 1);
      engineF = spec.power * input.throttle * fade;
    }
    if (input.brake > 0) {
      if (vLong > 0.6) {
        brakeF = -spec.brake * input.brake;
      } else {
        // reverse gear
        const fade = clamp(1 - Math.max(0, -vLong) / (topSpeed * 0.34), 0, 1);
        engineF = -spec.power * 0.44 * input.brake * fade;
      }
    }
    if (input.handbrake) {
      brakeF += -spec.brake * 0.55 * sign(vLong);
    }

    const aero = (spec.power * 0.10) / (topSpeed * topSpeed);
    const dragF = -aero * vLong * Math.abs(vLong);
    const rollF = -spec.mass * 0.016 * G * sign(vLong) * Math.min(1, Math.abs(vLong) / 1.2);
    const offRoadDrag = this.onRoad ? 0 : -spec.mass * 0.05 * G * sign(vLong) * Math.min(1, Math.abs(vLong) / 2);

    let aLong = (engineF + brakeF + dragF + rollF + offRoadDrag) / spec.mass;

    // stop creeping when stationary with no input
    if (Math.abs(vLong) < 0.35 && input.throttle === 0 && input.brake === 0) {
      aLong -= vLong * 6;
    }

    // -------------------------------------------------------- lateral model
    const halfWB = spec.wheelBase / 2;
    const load = (spec.mass * G) / 2;
    const gripMul = spec.grip * this.surfaceGrip;
    const maxF = gripMul * load;
    const maxR = gripMul * load * (input.handbrake ? 0.32 : 1);
    const stiffness = gripMul * load * 7.5;

    const u = Math.max(Math.abs(vLong), 2.2);
    const dirSign = vLong >= 0 ? 1 : -1;
    const slipF = Math.atan2(vLat + this.yawRate * halfWB, u) - this.steer * dirSign;
    const slipR = Math.atan2(vLat - this.yawRate * halfWB, u);

    let forceF = clamp(-stiffness * slipF, -maxF, maxF);
    let forceR = clamp(-stiffness * (input.handbrake ? 0.42 : 1) * slipR, -maxR, maxR);

    let aLat = (forceF + forceR) / spec.mass;
    let yawAcc = (forceF * halfWB - forceR * halfWB) / this.inertia;

    // At crawling speed the slip model has nothing to work with, so fall back
    // to a kinematic steering response for parking manoeuvres.
    const kin = clamp(1 - Math.abs(vLong) / 5.5, 0, 1);
    if (kin > 0) {
      const kinYaw = (vLong / spec.wheelBase) * Math.tan(this.steer);
      const blendYawRate = this.yawRate + yawAcc * dt;
      const newRate = blendYawRate * (1 - kin) + kinYaw * kin;
      yawAcc = (newRate - this.yawRate) / Math.max(dt, 1e-4);
      aLat *= 1 - kin * 0.7;
    }

    this.yawRate += yawAcc * dt;
    this.yawRate *= Math.exp(-0.9 * dt);
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);

    // ------------------------------------------------------------- gravity
    const n = ground.normalAt(this.position.x, this.position.z, 2.2);
    const slopeAx = G * n.x * 0.92;
    const slopeAz = G * n.z * 0.92;

    this.velocity.x += (this._fwd.x * aLong + this._right.x * aLat + slopeAx) * dt;
    this.velocity.z += (this._fwd.z * aLong + this._right.z * aLat + slopeAz) * dt;

    // ------------------------------------------------------------ integrate
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.distance += speed * dt;
    this.topSpeedSeen = Math.max(this.topSpeedSeen, this.speedKmh);

    // ----------------------------------------------------------- collisions
    this.impact = Math.max(0, this.impact - dt * 3);
    const radius = spec.width * 0.48;
    const samples = [0.32, 0, -0.32];
    for (const s of samples) {
      const sx = this.position.x + this._fwd.x * spec.length * s;
      const sz = this.position.z + this._fwd.z * spec.length * s;
      const hit = colliders.resolveCircle(sx, sz, radius);
      if (!hit) continue;
      this.position.x += hit.x - sx;
      this.position.z += hit.z - sz;
      const vn = this.velocity.x * hit.nx + this.velocity.z * hit.nz;
      if (vn < 0) {
        const impulse = -(1 + 0.22) * vn;
        this.velocity.x += hit.nx * impulse;
        this.velocity.z += hit.nz * impulse;
        this.velocity.multiplyScalar(0.86);
        this.yawRate *= 0.6;
        this.impact = Math.max(this.impact, Math.min(1, -vn / 12));
      }
    }

    // map edge
    const lim = MAP.half + 120;
    if (Math.abs(this.position.x) > lim) {
      this.position.x = clamp(this.position.x, -lim, lim);
      this.velocity.x *= -0.3;
    }
    if (Math.abs(this.position.z) > lim) {
      this.position.z = clamp(this.position.z, -lim, lim);
      this.velocity.z *= -0.3;
    }

    // ------------------------------------------------------------- vertical
    const groundY = ground.heightAt(this.position.x, this.position.z);
    this.groundY = groundY;
    if (this.airborne) {
      this.verticalVel -= G * dt;
      this.position.y += this.verticalVel * dt;
      if (this.position.y <= groundY) {
        this.position.y = groundY;
        this.impact = Math.max(this.impact, Math.min(1, -this.verticalVel / 14));
        this.verticalVel = 0;
        this.airborne = false;
      }
    } else {
      const drop = this.position.y - groundY;
      if (drop > 0.85 && speed > 6) {
        this.airborne = true;
        this.verticalVel = 0;
      } else {
        this.position.y = damp(this.position.y, groundY, 18, dt);
      }
    }

    // ---------------------------------------------------------- body attitude
    const fwdSlope = Math.atan2(
      ground.heightAt(this.position.x + this._fwd.x * 1.4, this.position.z + this._fwd.z * 1.4) -
        ground.heightAt(this.position.x - this._fwd.x * 1.4, this.position.z - this._fwd.z * 1.4),
      2.8
    );
    const sideSlope = Math.atan2(
      ground.heightAt(this.position.x + this._right.x * 1.0, this.position.z + this._right.z * 1.0) -
        ground.heightAt(this.position.x - this._right.x * 1.0, this.position.z - this._right.z * 1.0),
      2.0
    );
    this.pitch = damp(this.pitch, -fwdSlope, 9, dt);
    this.roll = damp(this.roll, sideSlope, 9, dt);

    // weight transfer for a bit of life
    this.bodyPitch = damp(this.bodyPitch, clamp(-aLong * 0.012, -0.09, 0.09), 7, dt);
    this.bodyRoll = damp(this.bodyRoll, clamp(aLat * 0.011, -0.12, 0.12), 7, dt);

    // ------------------------------------------------------------- telemetry
    const wheelCirc = 2 * Math.PI * spec.wheelRadius;
    this.wheelSpin += (vLong / wheelCirc) * Math.PI * 2 * dt;

    const slipAmount = Math.max(
      Math.abs(slipF) > 0.9 * (maxF / stiffness) ? Math.abs(slipF) : 0,
      Math.abs(slipR) > 0.9 * (maxR / stiffness) ? Math.abs(slipR) : 0
    );
    const wheelspin = input.throttle > 0.4 && Math.abs(vLong) < topSpeed * 0.25 &&
      spec.power / spec.mass > 6 ? 0.35 : 0;
    this.slip = damp(this.slip, Math.min(1, slipAmount * 2.6 + wheelspin +
      (input.handbrake && speed > 4 ? 0.8 : 0)), 10, dt);

    // simple 6-speed auto box, purely for the HUD and engine note
    const ratio = clamp(Math.abs(vLong) / topSpeed, 0, 1);
    const gears = spec.electric ? 1 : 6;
    this.gear = vLong < -0.6 ? -1 : Math.max(1, Math.min(gears, Math.ceil(ratio * gears) || 1));
    const inGear = gears === 1 ? ratio : (ratio * gears) - (this.gear - 1);
    this.rpm = clamp(900 + inGear * 5600 + (input.throttle > 0 ? 350 : 0), 800, 7200);
    if (this.gear === -1) this.rpm = clamp(900 + Math.abs(vLong) * 300, 800, 4200);
  }

  /** Applies the physics state to the visual car group. */
  applyTo(car) {
    car.group.position.copy(this.position);
    car.group.rotation.set(0, this.yaw, 0);
    car.bodyRoot.rotation.set(this.pitch + this.bodyPitch, 0, this.roll + this.bodyRoll);

    for (const holder of car.wheelMeshes) {
      if (holder.userData.front) holder.rotation.y = this.steer;
      holder.userData.spin.rotation.x = this.wheelSpin;
    }
  }
}
