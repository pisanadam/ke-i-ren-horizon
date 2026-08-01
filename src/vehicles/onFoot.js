import * as THREE from 'three';
import { createPerson, poseWalk } from './person.js';
import { clamp, damp, wrapAngle } from '../util/math.js';

/** 4 km/h walking, a jog at 10 when you hold shift. */
const WALK = 4 / 3.6;
const RUN = 10 / 3.6;
const EYE = 1.62;

/**
 * The player on foot: getting out of the car, walking around, and riding the
 * metro. Movement is deliberately simple — the character walks over the same
 * height field the car drives on, so pavements, kerbs and ramps all work
 * without any extra collision work.
 */
export class OnFoot {
  constructor(world, look) {
    this.world = world;
    this.person = createPerson(look, 'high');
    this.group = this.person.root;
    this.group.visible = false;

    this.position = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.phase = 0;
    this.active = false;
    this.riding = null;          // the train being ridden, if any
    this._vel = new THREE.Vector3();
  }

  /** Steps out of a car, onto whichever side has room. */
  exit(vehicle) {
    const spec = vehicle.spec;
    const right = { x: -Math.cos(vehicle.yaw), z: Math.sin(vehicle.yaw) };
    let placed = false;
    for (const side of [-1, 1, -1.7, 1.7]) {
      const off = (spec.width * 0.5 + 0.75) * side;
      const x = vehicle.position.x + right.x * off;
      const z = vehicle.position.z + right.z * off;
      if (this.world.colliders.overlaps(x, z, 0.32, 0.32, 0, 0.1)) continue;
      this.position.set(x, this.world.ground.heightAt(x, z), z);
      placed = true;
      break;
    }
    if (!placed) {
      this.position.copy(vehicle.position);
      this.position.y = this.world.ground.heightAt(this.position.x, this.position.z);
    }
    this.yaw = vehicle.yaw + Math.PI / 2;
    this.speed = 0;
    this.active = true;
    this.group.visible = true;
  }

  /** The nearest car door within reach, or null. */
  nearestCar(vehicle) {
    const d = Math.hypot(vehicle.position.x - this.position.x, vehicle.position.z - this.position.z);
    return d < 3.6 ? vehicle : null;
  }

  /**
   * The nearest metro platform within reach.
   * @returns {{line, stop, x, z, y}|null}
   */
  nearestPlatform(metro, reach = 6) {
    if (!metro) return null;
    let best = null;
    for (const line of metro.lines) {
      for (const stop of line.stops) {
        const p = line.path.reduce(
          (a, q) => (Math.abs(q.s - stop.s) < Math.abs(a.s - stop.s) ? q : a), line.path[0]
        );
        const d = Math.hypot(p.x - this.position.x, p.z - this.position.z);
        const up = Math.abs(p.y - this.position.y);
        if (d < reach && up < 3.2 && (!best || d < best.d)) {
          best = { line, stop, x: p.x, y: p.y, z: p.z, d };
        }
      }
    }
    return best;
  }

  /** A train stopped at this platform, if one is waiting. */
  trainAt(metro, platform) {
    if (!platform) return null;
    for (const t of metro.trains) {
      if (t.line !== platform.line) continue;
      if (t.dwell <= 0) continue;
      if (Math.abs(t.s - platform.stop.s) > 14) continue;
      return t;
    }
    return null;
  }

  board(train) {
    this.riding = train;
    this.group.visible = false;
  }

  alight(metro) {
    const t = this.riding;
    this.riding = null;
    if (!t) return;
    // step out onto the platform the train is standing at
    const p = t.line.path.reduce(
      (a, q) => (Math.abs(q.s - t.s) < Math.abs(a.s - t.s) ? q : a), t.line.path[0]
    );
    this.position.set(p.x, p.y + 0.8, p.z);
    this.yaw = p.yaw ?? 0;
    this.speed = 0;
    this.group.visible = true;
  }

  update(dt, input) {
    // ---- riding the metro: follow the train, no controls ---------------
    if (this.riding) {
      const t = this.riding;
      const p = t.line.path.reduce(
        (a, q) => (Math.abs(q.s - t.s) < Math.abs(a.s - t.s) ? q : a), t.line.path[0]
      );
      this.position.set(p.x, p.y + 0.8, p.z);
      this.phase += dt * 2;
      return;
    }
    if (!this.active) return;

    // ---- walk ----------------------------------------------------------
    const fwd = input.walkForward ?? 0;
    const strafe = input.walkStrafe ?? 0;
    const wants = Math.hypot(fwd, strafe);
    const top = input.run ? RUN : WALK;

    if (wants > 0.01) {
      // the camera's heading is the reference, like every third-person game
      const dir = Math.atan2(strafe, fwd) + (input.cameraYaw ?? 0);
      this.yaw = wrapAngle(this.yaw + wrapAngle(dir - this.yaw) * Math.min(1, dt * 11));
      this.speed = damp(this.speed, top * Math.min(1, wants), 7, dt);
    } else {
      this.speed = damp(this.speed, 0, 11, dt);
    }

    if (this.speed > 0.02) {
      const nx = this.position.x + Math.sin(this.yaw) * this.speed * dt;
      const nz = this.position.z + Math.cos(this.yaw) * this.speed * dt;
      // walls and street furniture stop a person the same way they stop a car
      const hit = this.world.colliders.resolveCircle(nx, nz, 0.3);
      if (hit) {
        this.position.x = hit.x;
        this.position.z = hit.z;
        this.speed *= 0.4;
      } else {
        this.position.x = nx;
        this.position.z = nz;
      }
    }

    const gy = this.world.ground.heightAt(this.position.x, this.position.z);
    this.position.y = damp(this.position.y, gy, 16, dt);

    // stride rate follows the actual pace, so the feet do not skate
    this.phase += dt * (this.speed > 0.05 ? clamp(this.speed * 2.6, 1.6, 13) : 0);
  }

  applyToModel() {
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;
    poseWalk(this.person, this.phase, this.speed);
  }

  /** Where the third-person camera should look. */
  get eye() {
    return this.position.y + EYE;
  }
}
