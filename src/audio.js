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
    this.levels = { master: 0.7, engine: 1, ambient: 1, tyres: 1 };

    // Coming back to the tab leaves the context suspended on every browser,
    // and Chrome suspends it outright while the page is hidden. Nothing else
    // resumes it, so the game came back silent.
    const wake = () => this.resume();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
    window.addEventListener('focus', wake);
    window.addEventListener('pageshow', wake);
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
      window.addEventListener(ev, wake, { passive: true });
    }
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
    this.master.gain.value = this.levels.master;
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

    // ----------------------------------------------------------- brakes
    // Two layers: a broad hiss of pad on disc, and a narrow resonant peak
    // that only comes up at low speed — the squeal as the car settles.
    this.brakeHiss = this._noiseSource(this.noiseBuffer, 'bandpass', 2600, 1.1);
    this.brakeHiss.gain.gain.value = 0;

    this.squeal = ctx.createOscillator();
    this.squeal.type = 'sawtooth';
    this.squeal.frequency.value = 2350;
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.value = 2350;
    this.squealFilter.Q.value = 14;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.squeal.connect(this.squealFilter);
    this.squealFilter.connect(this.squealGain);
    this.squealGain.connect(this.master);
    this.squeal.start();

    this._brakeWobble = 0;
    this._ambient();
  }

  /**
   * The world outside the car: a low traffic rumble that follows how built-up
   * the surroundings are, wind over open ground, and birdsong near parks. All
   * synthesised, like everything else here.
   */
  _ambient() {
    const ctx = this.ctx;
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = this.levels.ambient * 0.9;
    this.ambientGain.connect(this.master);

    const bed = (type, freq, q, vol) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      src.playbackRate.value = 0.6 + Math.random() * 0.5;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(this.ambientGain);
      src.start();
      return { src, filter: f, gain: g };
    };

    // distant traffic: a broad low roar
    this.cityBed = bed('lowpass', 320, 0.7, 0);
    // open country: wind in the grass, higher and thinner
    this.windBed = bed('bandpass', 900, 0.6, 0);

    // birds — a chirp every so often near parkland
    this.birdGain = ctx.createGain();
    this.birdGain.gain.value = 0;
    this.birdGain.connect(this.ambientGain);
    this._birdTimer = 2 + Math.random() * 4;
    this._birdChance = 0;

    // the odd horn from somewhere in the traffic
    this._hornTimer = 8 + Math.random() * 14;
    this._hornChance = 0;
  }

  /** Chirp: two quick swept sines. */
  _chirp() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      const t = now + i * 0.13;
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f0 = 2400 + Math.random() * 1600;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * (1.3 + Math.random() * 0.5), t + 0.05);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.9, t + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      o.connect(g);
      g.connect(this.birdGain);
      o.start(t);
      o.stop(t + 0.14);
    }
  }

  /** A horn somewhere off in the traffic, softened by distance. */
  _distantHorn() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const len = 0.25 + Math.random() * 0.4;
    const base = 330 + Math.random() * 190;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.02 + Math.random() * 0.02, now + 0.03);
    g.gain.setValueAtTime(g.gain.value, now + len);
    g.gain.exponentialRampToValueAtTime(0.0001, now + len + 0.12);
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 900;
    soft.connect(g);
    g.connect(this.ambientGain);
    for (const mul of [1, 1.26]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = base * mul;
      o.connect(soft);
      o.start(now);
      o.stop(now + len + 0.2);
    }
  }

  /**
   * @param {number} dt seconds
   * @param {object} env  {builtUp 0..1, green 0..1, speed, night 0..1}
   */
  updateAmbient(dt, env) {
    if (!this.started || !this.ctx || !this.cityBed) return;
    const now = this.ctx.currentTime;
    const built = clamp(env.builtUp, 0, 1);
    const green = clamp(env.green, 0, 1);
    const night = clamp(env.night ?? 0, 0, 1);

    // the city quietens down overnight
    const cityVol = built * (0.055 + 0.02 * (1 - night)) * (1 - night * 0.45);
    this.cityBed.gain.gain.setTargetAtTime(cityVol, now, 0.8);
    this.cityBed.filter.frequency.setTargetAtTime(240 + built * 220, now, 0.8);

    const windVol = (1 - built) * 0.05;
    this.windBed.gain.gain.setTargetAtTime(windVol, now, 0.9);

    // birds want daylight and greenery
    const birdy = green * (1 - night);
    this.birdGain.gain.setTargetAtTime(birdy > 0.05 ? 1 : 0, now, 0.5);
    this._birdTimer -= dt;
    if (this._birdTimer <= 0) {
      this._birdTimer = 1.4 + Math.random() * 5;
      if (Math.random() < birdy) this._chirp();
    }

    this._hornTimer -= dt;
    if (this._hornTimer <= 0) {
      this._hornTimer = 9 + Math.random() * 20;
      if (Math.random() < built * 0.75 * (1 - night * 0.6)) this._distantHorn();
    }
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
    this._applyMaster();
  }

  _applyMaster() {
    if (!this.master) return;
    this.master.gain.value = this.muted ? 0 : this.levels.master;
  }

  /** Per-channel volumes from the settings screen. */
  setLevels(levels) {
    Object.assign(this.levels, levels);
    this._applyMaster();
    if (this.ambientGain) {
      this.ambientGain.gain.value = this.levels.ambient * 0.9;
    }
  }

  resume() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
      // the promise rejects if there is still no user gesture; that is fine,
      // one of the other wake events will get there
      this.ctx.resume().catch(() => {});
    }
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

    this._brakes(v, input, now, dt, speed);
  }

  /**
   * Brakes. The pads only make a noise while they are actually being pressed
   * against a turning disc, so everything here is gated on both the pedal and
   * the car still moving.
   */
  _brakes(v, input, now, dt, speed) {
    const pedal = clamp(input.brake, 0, 1);
    const hand = input.handbrake ? 0.85 : 0;
    // reversing out of a parking space is the throttle, not the brakes
    const braking = v.forwardSpeed > 0.4 ? pedal : 0;
    const press = Math.max(braking, hand);
    const rolling = clamp((speed - 0.6) / 5, 0, 1);

    // A little tremble in the pressure, like a pulsing ABS pedal, but only
    // when the car is hard on the brakes and the tyres are near the limit.
    const abs = press > 0.55 && v.slip > 0.22 && speed > 6 ? 1 : 0;
    this._brakeWobble += dt * (abs ? 46 : 12);
    const wobble = abs ? 0.72 + 0.28 * Math.sin(this._brakeWobble) : 1;

    const hiss = press * rolling * wobble;
    this.brakeHiss.gain.gain.setTargetAtTime(hiss * 0.085, now, 0.035);
    this.brakeHiss.filter.frequency.setTargetAtTime(
      1400 + clamp(speed / 40, 0, 1) * 2600, now, 0.06
    );

    // The squeal lives in the last few km/h: strongest as the car stops.
    const slow = clamp(1 - Math.abs(speed - 2.4) / 2.4, 0, 1);
    this.squealGain.gain.setTargetAtTime(press * slow * 0.05, now, 0.05);
    const f = 1750 + slow * 900 + Math.sin(this._brakeWobble * 0.7) * 110;
    this.squeal.frequency.setTargetAtTime(f, now, 0.05);
    this.squealFilter.frequency.setTargetAtTime(f, now, 0.05);
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
