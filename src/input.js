import { clamp, damp } from './util/math.js';

/**
 * Keyboard, gamepad and on-screen controls collapsed into one control state.
 */
export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { gas: false, brake: false, left: false, right: false };
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false };
    this._rawSteer = 0;
    this.actions = new Set();
    this._bound = false;
    this.hasTouch = matchMedia('(pointer: coarse)').matches;
  }

  bind(target = window) {
    if (this._bound) return;
    this._bound = true;

    const down = (e) => {
      if (e.repeat) return;
      const code = e.code;
      this.keys.add(code);
      if (ACTION_KEYS[code]) this.actions.add(ACTION_KEYS[code]);
      if (BLOCKED.has(code)) e.preventDefault();
    };
    const up = (e) => this.keys.delete(e.code);

    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', () => this.keys.clear());

    // on-screen buttons
    for (const btn of document.querySelectorAll('.tbtn')) {
      const key = btn.dataset.key;
      const set = (v) => (e) => {
        e.preventDefault();
        this.touch[key] = v;
      };
      btn.addEventListener('pointerdown', set(true));
      btn.addEventListener('pointerup', set(false));
      btn.addEventListener('pointercancel', set(false));
      btn.addEventListener('pointerleave', set(false));
    }
  }

  /** Drains one-shot actions such as "change camera". */
  consume(action) {
    if (this.actions.has(action)) {
      this.actions.delete(action);
      return true;
    }
    return false;
  }

  clearActions() {
    this.actions.clear();
  }

  update(dt) {
    const k = this.keys;
    const gp = this._gamepad();

    let throttle = 0;
    let brake = 0;
    let steerTarget = 0;

    if (k.has('KeyW') || k.has('ArrowUp')) throttle = 1;
    if (k.has('KeyS') || k.has('ArrowDown')) brake = 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) steerTarget -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) steerTarget += 1;

    if (this.touch.gas) throttle = 1;
    if (this.touch.brake) brake = 1;
    if (this.touch.left) steerTarget -= 1;
    if (this.touch.right) steerTarget += 1;

    let handbrake = k.has('Space');
    let horn = k.has('KeyH');

    if (gp) {
      const axis = gp.axes[0] ?? 0;
      if (Math.abs(axis) > 0.12) steerTarget = clamp(steerTarget + axis, -1, 1);
      const rt = gp.buttons[7]?.value ?? 0;
      const lt = gp.buttons[6]?.value ?? 0;
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      if (gp.buttons[0]?.pressed) handbrake = true;
      if (gp.buttons[2]?.pressed) horn = true;
      if (gp.buttons[3]?.pressed) this.actions.add('camera');
    }

    // Steering ramps in so keyboard input still feels progressive.
    const rate = steerTarget === 0 ? 9 : 6;
    this._rawSteer = damp(this._rawSteer, clamp(steerTarget, -1, 1), rate, dt);
    if (Math.abs(this._rawSteer) < 0.002) this._rawSteer = 0;

    this.state.throttle = throttle;
    this.state.brake = brake;
    this.state.steer = this._rawSteer;
    this.state.handbrake = handbrake;
    this.state.horn = horn;
    return this.state;
  }

  _gamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }
}

const ACTION_KEYS = {
  KeyC: 'camera',
  KeyR: 'respawn',
  KeyT: 'time',
  KeyN: 'teleport',
  KeyM: 'garage',
  KeyV: 'lights',
  KeyP: 'pause',
  Escape: 'pause',
  KeyF: 'fullscreen',
  KeyX: 'mute'
};

const BLOCKED = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'
]);
