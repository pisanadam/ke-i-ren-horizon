import * as THREE from 'three';
import { damp, dampAngle, clamp, lerp } from './util/math.js';
import { sillHeight } from './vehicles/carModel.js';

export const CAMERA_MODES = [
  { id: 'chase', label: 'Takip' },
  { id: 'far', label: 'Geniş' },
  { id: 'hood', label: 'Kaput' },
  { id: 'bumper', label: 'Tampon' },
  { id: 'orbit', label: 'Serbest' },
  { id: 'top', label: 'Kuşbakışı' }
];

/**
 * Chase camera with a spring, plus cockpit, orbit and top-down variants.
 * The orbit mode is mouse-driven; the rest follow the car.
 */
export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.modeIndex = 0;
    this.pos = new THREE.Vector3(0, 10, -20);
    this.look = new THREE.Vector3();
    this.yaw = 0;
    this.orbitYaw = 0;
    this.orbitPitch = 0.42;
    this.orbitDist = 14;
    this.shake = 0;
    this._tmp = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._dragging = false;

    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this._dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      dom.setPointerCapture?.(e.pointerId);
    });
    dom.addEventListener('pointerup', (e) => {
      this._dragging = false;
      dom.releasePointerCapture?.(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this.orbitYaw -= dx * 0.005;
      this.orbitPitch = clamp(this.orbitPitch + dy * 0.004, -0.25, 1.3);
      if (this.mode.id !== 'orbit') this.setMode('orbit');
    });
    dom.addEventListener('wheel', (e) => {
      this.orbitDist = clamp(this.orbitDist + e.deltaY * 0.02, 5, 90);
      e.preventDefault();
    }, { passive: false });
  }

  get mode() {
    return CAMERA_MODES[this.modeIndex];
  }

  setMode(id) {
    const i = CAMERA_MODES.findIndex((m) => m.id === id);
    if (i >= 0) this.modeIndex = i;
  }

  next() {
    this.modeIndex = (this.modeIndex + 1) % CAMERA_MODES.length;
    return this.mode;
  }

  addShake(amount) {
    this.shake = Math.min(1, this.shake + amount);
  }

  update(dt, vehicle, ground) {
    const spec = vehicle.spec;
    const p = vehicle.position;
    const speed = vehicle.speed;
    const mode = this.mode.id;

    const sinY = Math.sin(vehicle.yaw);
    const cosY = Math.cos(vehicle.yaw);

    if (mode === 'hood' || mode === 'bumper') {
      const isHood = mode === 'hood';
      const sill = sillHeight(spec);
      const height = isHood
        ? sill + spec.bodyHeight + spec.cabinHeight * 0.55
        : sill + spec.bodyHeight * 0.55;
      const fwd = isHood ? spec.length * 0.12 : spec.length * 0.52;
      this.camera.position.set(
        p.x + sinY * fwd,
        p.y + height,
        p.z + cosY * fwd
      );
      this.camera.rotation.set(0, 0, 0);
      const lookAhead = 26;
      this._target.set(
        p.x + sinY * lookAhead,
        p.y + height + vehicle.pitch * 6 - 0.6,
        p.z + cosY * lookAhead
      );
      this.camera.lookAt(this._target);
      this.camera.rotateZ(-vehicle.roll * 0.5 - vehicle.bodyRoll * 0.8);
      this.camera.fov = lerp(66, 82, clamp(speed / 60, 0, 1));
      this.camera.updateProjectionMatrix();
      this._applyShake(dt);
      return;
    }

    if (mode === 'top') {
      const h = 58 + speed * 0.9;
      this.camera.position.set(p.x, p.y + h, p.z - 0.01);
      this.camera.lookAt(p.x, p.y, p.z);
      this.camera.fov = 55;
      this.camera.updateProjectionMatrix();
      return;
    }

    if (mode === 'orbit') {
      const d = this.orbitDist;
      const cp = Math.cos(this.orbitPitch);
      this._target.set(
        p.x + Math.sin(this.orbitYaw) * cp * d,
        p.y + Math.sin(this.orbitPitch) * d + 1.5,
        p.z + Math.cos(this.orbitYaw) * cp * d
      );
      const minY = ground.heightAt(this._target.x, this._target.z) + 1.5;
      this._target.y = Math.max(this._target.y, minY);
      this.camera.position.lerp(this._target, 1 - Math.exp(-9 * dt));
      this.camera.lookAt(p.x, p.y + 1, p.z);
      this.camera.fov = 55;
      this.camera.updateProjectionMatrix();
      return;
    }

    // ---- chase / far -----------------------------------------------------
    const far = mode === 'far';
    const baseDist = (far ? 12.5 : 8.2) + spec.length * 0.75;
    const baseHeight = (far ? 5.4 : 3.4) + spec.cabinHeight;

    // let the camera fall behind a touch as speed builds
    const speedT = clamp(speed / 45, 0, 1);
    const dist = baseDist + speedT * (far ? 5 : 3.4);
    const height = baseHeight + speedT * 0.9;

    // aim slightly into the direction of travel so drifts read well
    const velYaw = speed > 4 ? Math.atan2(vehicle.velocity.x, vehicle.velocity.z) : vehicle.yaw;
    const blended = vehicle.yaw + Math.atan2(
      Math.sin(velYaw - vehicle.yaw), Math.cos(velYaw - vehicle.yaw)
    ) * 0.30;
    this.yaw = dampAngle(this.yaw, blended, 4.5 + speedT * 3, dt);

    const desiredX = p.x - Math.sin(this.yaw) * dist;
    const desiredZ = p.z - Math.cos(this.yaw) * dist;
    const groundY = ground.heightAt(desiredX, desiredZ);
    const desiredY = Math.max(p.y, groundY) + height;

    const follow = 6.5 + speedT * 3.5;
    this.pos.x = damp(this.pos.x, desiredX, follow, dt);
    this.pos.y = damp(this.pos.y, desiredY, follow * 0.8, dt);
    this.pos.z = damp(this.pos.z, desiredZ, follow, dt);

    // never clip through the hillside
    const camGround = ground.heightAt(this.pos.x, this.pos.z) + 1.2;
    if (this.pos.y < camGround) this.pos.y = camGround;

    this.camera.position.copy(this.pos);

    const lookAhead = 5 + speedT * 12;
    this.look.x = damp(this.look.x, p.x + Math.sin(this.yaw) * lookAhead, 8, dt);
    this.look.y = damp(this.look.y, p.y + 1.5, 8, dt);
    this.look.z = damp(this.look.z, p.z + Math.cos(this.yaw) * lookAhead, 8, dt);
    this.camera.lookAt(this.look);

    this.camera.fov = lerp(58, 74, clamp(speed / 62, 0, 1));
    this.camera.updateProjectionMatrix();
    this._applyShake(dt);
  }

  _applyShake(dt) {
    if (this.shake <= 0.001) {
      this.shake = 0;
      return;
    }
    const s = this.shake * 0.14;
    this.camera.position.x += (Math.random() - 0.5) * s;
    this.camera.position.y += (Math.random() - 0.5) * s;
    this.camera.position.z += (Math.random() - 0.5) * s;
    this.shake = damp(this.shake, 0, 6, dt);
  }

  snapTo(vehicle) {
    const dist = 12 + vehicle.spec.length;
    this.yaw = vehicle.yaw;
    this.pos.set(
      vehicle.position.x - Math.sin(vehicle.yaw) * dist,
      vehicle.position.y + 5,
      vehicle.position.z - Math.cos(vehicle.yaw) * dist
    );
    this.look.copy(vehicle.position);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
