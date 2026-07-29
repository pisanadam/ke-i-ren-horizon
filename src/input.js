import { clamp, damp } from './util/math.js';

const ACTION_KEYS = {
  KeyC: 'camera',
  KeyR: 'respawn',
  KeyT: 'time',
  KeyN: 'teleport',
  KeyM: 'map',
  KeyG: 'garage',
  KeyV: 'lights',
  KeyP: 'pause',
  Escape: 'pause',
  KeyF: 'fullscreen',
  KeyX: 'mute'
};

const BLOCKED = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

/**
 * Keyboard, gamepad and on-screen controls collapsed into one control state.
 *
 * The touch steering is analogue: drag anywhere in the left half of the screen
 * and the wheel follows how far your thumb has travelled, which is far easier
 * to drive with than left/right buttons.
 */
export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { gas: false, brake: false, handbrake: false, steer: 0, active: false };
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false };
    this._rawSteer = 0;
    this._hornUntil = 0;
    this.actions = new Set();
    this._bound = false;
    this.hasTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  }

  bind(target = window) {
    if (this._bound) return;
    this._bound = true;

    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (ACTION_KEYS[e.code]) this.actions.add(ACTION_KEYS[e.code]);
      if (BLOCKED.has(e.code)) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());

    this._bindSteerZone();
    this._bindButtons();
  }

  /** Analogue steering: the whole lower-left of the screen is the wheel. */
  _bindSteerZone() {
    const zone = document.getElementById('steer-zone');
    const knob = document.getElementById('steer-knob');
    if (!zone) return;
    let id = null;
    let originX = 0;
    const RANGE = 78;                       // px of travel for full lock

    const setSteer = (v) => {
      this.touch.steer = v;
      if (knob) knob.style.transform = `translateX(${v * 62}px)`;
    };

    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      originX = e.clientX;
      this.touch.active = true;
      zone.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      setSteer(clamp((e.clientX - originX) / RANGE, -1, 1));
      e.preventDefault();
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.touch.active = false;
      setSteer(0);
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('pointerleave', end);
  }

  /** Pedals and the round buttons: `data-hold` latches, `data-tap` fires once. */
  _bindButtons() {
    for (const el of document.querySelectorAll('[data-hold]')) {
      const key = el.dataset.hold;
      const set = (v) => (e) => {
        e.preventDefault();
        this.touch[key] = v;
        el.classList.toggle('on', v);
      };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointercancel', set(false));
      el.addEventListener('pointerleave', set(false));
    }

    for (const el of document.querySelectorAll('[data-tap]')) {
      const action = el.dataset.tap;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (action === 'horn') {
          this._hornUntil = performance.now() + 450;
        } else {
          this.actions.add(action);
        }
        el.classList.add('on');
      });
      const off = () => el.classList.remove('on');
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
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

  /** Releases every held control — used when a screen opens over the game. */
  releaseAll() {
    this.keys.clear();
    this.touch.gas = false;
    this.touch.brake = false;
    this.touch.handbrake = false;
    this.touch.steer = 0;
    for (const el of document.querySelectorAll('[data-hold]')) el.classList.remove('on');
    const knob = document.getElementById('steer-knob');
    if (knob) knob.style.transform = 'translateX(0px)';
  }

  update(dt) {
    const k = this.keys;
    const gp = this._gamepad();

    let throttle = 0;
    let brake = 0;
    let steerTarget = 0;
    let analogue = false;

    if (k.has('KeyW') || k.has('ArrowUp')) throttle = 1;
    if (k.has('KeyS') || k.has('ArrowDown')) brake = 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) steerTarget -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) steerTarget += 1;

    if (this.touch.gas) throttle = 1;
    if (this.touch.brake) brake = 1;
    if (this.touch.active || this.touch.steer !== 0) {
      steerTarget = this.touch.steer;
      analogue = true;
    }

    let handbrake = k.has('Space') || this.touch.handbrake;
    let horn = k.has('KeyH') || performance.now() < this._hornUntil;

    if (gp) {
      const axis = gp.axes[0] ?? 0;
      if (Math.abs(axis) > 0.12) { steerTarget = clamp(axis, -1, 1); analogue = true; }
      const rt = gp.buttons[7]?.value ?? 0;
      const lt = gp.buttons[6]?.value ?? 0;
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      if (gp.buttons[0]?.pressed) handbrake = true;
      if (gp.buttons[2]?.pressed) horn = true;
      if (gp.buttons[3]?.pressed) this.actions.add('camera');
    }

    // Digital input ramps in so the keyboard still feels progressive; an
    // analogue source (thumb or stick) is already proportional.
    if (analogue) {
      this._rawSteer = damp(this._rawSteer, clamp(steerTarget, -1, 1), 16, dt);
    } else {
      const rate = steerTarget === 0 ? 9 : 6;
      this._rawSteer = damp(this._rawSteer, clamp(steerTarget, -1, 1), rate, dt);
    }
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
    for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    return null;
  }
}
