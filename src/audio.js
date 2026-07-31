import { clamp, lerp } from './util/math.js';

/**
 * Fully synthesised audio — no sample files. The engine is a pair of detuned
 * saws through a resonant low-pass whose cutoff tracks load, with a separate
 * noise bed for intake and exhaust. Electric cars swap the saws for a whine.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.started = false;
    this.muted = false;
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.started) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return; }
    this.ctx = new Ctx();
    this.started = true;

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    // ---------------------------------------------------------- engine
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 700;
    this.engineFilter.Q.value = 6;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);

    this.osc = [];
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'square' : 'sawtooth';
      o.frequency.value = 60;
      const g = ctx.createGain();
      g.gain.value = i === 2 ? 0.18 : 0.4;
      o.connect(g);
      g.connect(this.engineFilter);
      o.start();
      this.osc.push({ o, g, ratio: [1, 2.02, 0.5][i] });
    }

    // whine layer for the electric car
    this.whine = ctx.createOscillator();
    this.whine.type = 'triangle';
    this.whine.frequency.value = 400;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain);
    this.whineGain.connect(this.master);
    this.whine.start();

    // ----------------------------------------------------------- noise
    this.noiseBuffer = this._makeNoise(2);
    this.exhaust = this._noiseSource(this.noiseBuffer, 'bandpass', 320, 1.2);
    this.exhaust.gain.gain.value = 0;
    this.wind = this._noiseSource(this.noiseBuffer, 'lowpass', 900, 0.6);
    this.wind.gain.gain.value = 0;
    this.screech = this._noiseSource(this.noiseBuffer, 'bandpass', 1900, 9);
    this.screech.gain.gain.value = 0;
    this.gravel = this._noiseSource(this.noiseBuffer, 'bandpass', 620, 1.6);
    this.gravel.gain.gain.value = 0;
  }

  _makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    return buf;
  }

  _noiseSource(buffer, filterType, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    return { src, filter, gain };
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.7;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /**
   * @param {object} v vehicle state
   * @param {object} input current controls
   * @param {number} dt seconds since the last frame
   */
  update(v, input, dt = 1 / 60) {
    if (!this.started || !this.ctx) return;
    const now = this.ctx.currentTime;
    const spec = v.spec;
    const load = clamp(input.throttle, 0, 1);
    const speed = v.speed;

    // Off the throttle the engine has to fall back to idle. Following v.rpm
    // straight through meant a car rolling down a hill revved up on its own
    // and sounded exactly like the gas was pinned.
    const idleRpm = 900;
    const target = load > 0 ? v.rpm : idleRpm + (v.rpm - idleRpm) * 0.08;
    // revs snap up on the throttle and fall away gently on the overrun
    const a = 1 - Math.exp(-(load > 0 ? 9 : 3) * clamp(dt, 0, 0.25));
    this._audioRpm = this._audioRpm === undefined
      ? target
      : this._audioRpm + (target - this._audioRpm) * a;
    const rpm = this._audioRpm;

    if (spec.electric) {
      this.engineGain.gain.setTargetAtTime(0.02, now, 0.1);
      const f = 180 + speed * 26 * (0.25 + load * 0.75);
      this.whine.frequency.setTargetAtTime(f, now, 0.05);
      this.whineGain.gain.setTargetAtTime(0.008 + load * 0.072, now, 0.08);
      this.engineFilter.frequency.setTargetAtTime(900, now, 0.1);
    } else {
      this.whineGain.gain.setTargetAtTime(0, now, 0.1);
      const base = (rpm / 60) * 2;
      for (const o of this.osc) {
        o.o.frequency.setTargetAtTime(clamp(base * o.ratio, 20, 900), now, 0.035);
      }
      const heaviness = spec.mass > 4000 ? 0.6 : 1;
      // a quiet idle underneath, and the note only opens up under throttle
      this.engineGain.gain.setTargetAtTime(
        (0.014 + load * 0.13) * heaviness, now, load > 0 ? 0.05 : 0.16
      );
      this.engineFilter.frequency.setTargetAtTime(
        lerp(420, 2600, clamp(rpm / 7000, 0, 1) * (0.3 + load * 0.7)), now, 0.06
      );
      this.exhaust.gain.gain.setTargetAtTime(0.004 + load * 0.058, now, load > 0 ? 0.06 : 0.18);
      this.exhaust.filter.frequency.setTargetAtTime(180 + rpm * 0.06, now, 0.08);
    }

    // wind and road noise
    this.wind.gain.gain.setTargetAtTime(clamp((speed - 8) / 90, 0, 1) * 0.11, now, 0.15);
    this.wind.filter.frequency.setTargetAtTime(500 + speed * 22, now, 0.15);

    // tyre squeal / gravel
    const squeal = v.onRoad ? clamp(v.slip - 0.18, 0, 1) : 0;
    this.screech.gain.gain.setTargetAtTime(squeal * 0.16 * clamp(speed / 12, 0, 1), now, 0.05);
    this.screech.filter.frequency.setTargetAtTime(1500 + squeal * 1400, now, 0.08);

    const gravel = !v.onRoad ? clamp(speed / 25, 0, 1) : 0;
    this.gravel.gain.gain.setTargetAtTime(gravel * 0.1, now, 0.12);
  }

  horn(on) {
    if (!this.started) return;
    if (!this._horn) {
      const ctx = this.ctx;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.master);
      const a = ctx.createOscillator();
      a.type = 'square';
      a.frequency.value = 405;
      const b = ctx.createOscillator();
      b.type = 'square';
      b.frequency.value = 508;
      const soft = ctx.createBiquadFilter();
      soft.type = 'lowpass';
      soft.frequency.value = 2200;
      a.connect(soft); b.connect(soft);
      soft.connect(g);
      a.start(); b.start();
      this._horn = g;
    }
    this._horn.gain.setTargetAtTime(on ? 0.13 : 0, this.ctx.currentTime, 0.02);
  }

  thud(strength) {
    if (!this.started || strength <= 0.02) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = false;
    src.playbackRate.value = 0.5 + Math.random() * 0.3;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260 + strength * 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.5, strength * 0.55), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(now, Math.random(), 0.35);

    // metallic ring on harder hits
    if (strength > 0.35) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(320 + Math.random() * 260, now);
      const og = ctx.createGain();
      og.gain.setValueAtTime(strength * 0.10, now);
      og.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      o.connect(og);
      og.connect(this.master);
      o.start(now);
      o.stop(now + 0.55);
    }
  }

  blip(freq = 660, len = 0.08, vol = 0.08) {
    if (!this.started) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + len);
    o.connect(g);
    g.connect(this.master);
    o.start(now);
    o.stop(now + len + 0.02);
  }
}
