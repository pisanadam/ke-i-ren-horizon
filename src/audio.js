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

    // turbo whistle, silent unless the car's voice asks for it
    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'triangle';
    this.turboOsc.frequency.value = 3000;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    const turboBp = ctx.createBiquadFilter();
    turboBp.type = 'bandpass';
    turboBp.frequency.value = 3200;
    turboBp.Q.value = 3;
    this.turboOsc.connect(turboBp);
    turboBp.connect(this.turboGain);
    this.turboGain.connect(this.master);
    this.turboOsc.start();

    this._brakeWobble = 0;
    this._ambient();
    if (this._voice) this.setVehicle({ voice: this._voice });
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

  /**
   * Retunes the oscillator bank for a particular car. A V8 fires twice as
   * often per revolution as a four and leans on its low harmonics; a rotary
   * has no pistons at all and screams. Called whenever the player swaps cars.
   */
  setVehicle(spec) {
    this._voice = spec?.voice || null;
    if (!this.started || !this.osc) return;
    const v = this._voice;
    if (!v || v.electric) return;
    for (let i = 0; i < this.osc.length; i++) {
      const o = this.osc[i];
      o.ratio = v.harm?.[i] ?? [1, 2.02, 0.5][i];
      o.o.type = v.type?.[i] ?? (i === 2 ? 'square' : 'sawtooth');
      o.g.gain.value = v.gain?.[i] ?? (i === 2 ? 0.18 : 0.4);
    }
    this.engineFilter.Q.value = v.q ?? 6;
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
    const voice = spec.voice || this._voice || {};
    const redline = voice.redline ?? 7000;
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
      const w = voice.whine ?? [180, 26];
      // clamped: an unbounded ramp reaches 2.4 kHz at motorway speed, which
      // is a dentist's drill rather than a motor
      const f = clamp(w[0] + speed * w[1] * (0.25 + load * 0.75), 120, 1250);
      this.whine.frequency.setTargetAtTime(f, now, 0.05);
      this.whineGain.gain.setTargetAtTime(0.008 + load * 0.072, now, 0.08);
      this.engineFilter.frequency.setTargetAtTime(voice.cut ?? 900, now, 0.1);
      if (this.turboGain) this.turboGain.gain.setTargetAtTime(0, now, 0.15);
    } else {
      this.whineGain.gain.setTargetAtTime(0, now, 0.1);
      // firing frequency: a four-stroke fires cyl/2 times per revolution
      const cyl = voice.cyl ?? 4;
      const base = (rpm / 60) * (cyl / 2);
      for (const o of this.osc) {
        o.o.frequency.setTargetAtTime(clamp(base * o.ratio, 18, 1400), now, 0.035);
      }
      const heaviness = spec.mass > 4000 ? 0.6 : 1;
      // a quiet idle underneath, and the note only opens up under throttle
      this.engineGain.gain.setTargetAtTime(
        (0.014 + load * 0.13) * heaviness, now, load > 0 ? 0.05 : 0.16
      );
      const cut = voice.cut ?? [420, 2600];
      this.engineFilter.frequency.setTargetAtTime(
        lerp(cut[0], cut[1], clamp(rpm / redline, 0, 1) * (0.3 + load * 0.7)), now, 0.06
      );
      const ex = voice.ex ?? 1;
      this.exhaust.gain.gain.setTargetAtTime(
        (0.004 + load * 0.058) * ex, now, load > 0 ? 0.06 : 0.18
      );
      this.exhaust.filter.frequency.setTargetAtTime(180 + rpm * 0.06, now, 0.08);

      // turbo whistle rides on top, and only under boost
      if (this.turboGain) {
        const boost = (voice.turbo ?? 0) * load * clamp(rpm / redline, 0, 1);
        this.turboGain.gain.setTargetAtTime(boost * 0.035, now, 0.12);
        this.turboOsc.frequency.setTargetAtTime(2600 + clamp(rpm / redline, 0, 1) * 3200, now, 0.1);
      }
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

  /**
   * A hit.
   *
   * `strength` runs 0 to 1 and everything about the sound follows it, because
   * a kerb scrape and a lamp post at ninety are not the same event with the
   * volume turned up. As it rises the body thump drops in pitch and lengthens,
   * the filter opens so the crumple gets its rasp, the metal ring comes in,
   * and past halfway there is glass.
   */
  thud(strength) {
    if (!this.started || strength <= 0.02) return;
    const s = Math.min(1, strength);
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // ---- the body of the impact: filtered noise, longer the harder it is
    const tail = 0.16 + s * 0.42;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = false;
    src.playbackRate.value = 0.34 + Math.random() * 0.3 + s * 0.35;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(700 + s * 3200, now);
    filter.frequency.exponentialRampToValueAtTime(180 + s * 260, now + tail);
    filter.Q.value = 0.9 + s * 2.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.62, 0.08 + s * 0.58), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + tail);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(now, Math.random(), tail + 0.05);

    // ---- the thump you feel: a short pitch drop, deeper on a heavy hit
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120 - s * 46, now);
    o.frequency.exponentialRampToValueAtTime(34 - s * 12, now + 0.13 + s * 0.14);
    const og = ctx.createGain();
    og.gain.setValueAtTime(Math.min(0.5, 0.1 + s * 0.42), now);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.2 + s * 0.2);
    o.connect(og);
    og.connect(this.master);
    o.start(now);
    o.stop(now + 0.45 + s * 0.3);

    // ---- panel ring, only once there is enough in it to ring
    if (s > 0.28) {
      for (let i = 0; i < 2; i++) {
        const m = ctx.createOscillator();
        m.type = 'triangle';
        m.frequency.setValueAtTime(280 + i * 190 + Math.random() * 220, now + i * 0.012);
        const mg = ctx.createGain();
        mg.gain.setValueAtTime((s - 0.28) * 0.2, now + i * 0.012);
        mg.gain.exponentialRampToValueAtTime(0.0001, now + 0.35 + s * 0.5);
        m.connect(mg);
        mg.connect(this.master);
        m.start(now + i * 0.012);
        m.stop(now + 0.9 + s * 0.5);
      }
    }

    // ---- glass, for the ones that really hurt
    if (s > 0.52) {
      const gs = ctx.createBufferSource();
      gs.buffer = this.noiseBuffer;
      gs.playbackRate.value = 2.4 + Math.random();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3200;
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0, now);
      gg.gain.linearRampToValueAtTime((s - 0.52) * 0.34, now + 0.03);
      gg.gain.exponentialRampToValueAtTime(0.0001, now + 0.5 + s * 0.4);
      gs.connect(hp);
      hp.connect(gg);
      gg.connect(this.master);
      gs.start(now + 0.02, Math.random(), 0.7);
    }
  }

  /**
   * Something came apart: the impact plus the wreckage hitting the road a
   * moment later. `kind` picks what it sounds like — a steel column rings,
   * a car crumples.
   */
  crash(strength, kind = 'direk') {
    if (!this.started) return;
    const s = Math.min(1, Math.max(0.25, strength));
    this.thud(Math.min(1, s * 1.15));

    const ctx = this.ctx;
    const now = ctx.currentTime;
    // steel rings, everything else is a dull collapse
    const metal = kind === 'lamba';

    // the pieces landing, a beat behind the hit
    for (let i = 0; i < (metal ? 3 : 4); i++) {
      const at = now + 0.18 + Math.random() * (0.5 + s * 0.5);
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.playbackRate.value = metal ? 1.4 + Math.random() * 1.2 : 0.6 + Math.random() * 0.5;
      const f = ctx.createBiquadFilter();
      f.type = metal ? 'bandpass' : 'lowpass';
      f.frequency.value = metal ? 900 + Math.random() * 2200 : 400 + Math.random() * 500;
      f.Q.value = metal ? 4 : 1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(s * (metal ? 0.16 : 0.2) * (1 - i * 0.18), at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22 + Math.random() * 0.3);
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start(at, Math.random(), 0.5);
    }
  }

  /**
   * The car itself going up.
   *
   * Three things happening at once: the crack of the ignition, the body of the
   * blast dropping away underneath it, and a long tail of wreckage coming back
   * down. Nothing here is a sample — it is the same noise buffer the crashes
   * use, opened right up and then shut down over a second and a half.
   */
  explode(strength = 1) {
    if (!this.started) return;
    const s = Math.min(1, Math.max(0.5, strength));
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // ---- the crack: wide open for a few hundredths, then gone
    const crack = ctx.createBufferSource();
    crack.buffer = this.noiseBuffer;
    crack.playbackRate.value = 1.6 + Math.random() * 0.5;
    const ch = ctx.createBiquadFilter();
    ch.type = 'highpass';
    ch.frequency.setValueAtTime(1400, now);
    ch.frequency.exponentialRampToValueAtTime(320, now + 0.22);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, now);
    cg.gain.linearRampToValueAtTime(0.5 * s, now + 0.008);
    cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    crack.connect(ch);
    ch.connect(cg);
    cg.connect(this.master);
    crack.start(now, Math.random(), 0.5);

    // ---- the body of the blast: low noise falling away
    const body = ctx.createBufferSource();
    body.buffer = this.noiseBuffer;
    body.playbackRate.value = 0.28 + Math.random() * 0.14;
    const bf = ctx.createBiquadFilter();
    bf.type = 'lowpass';
    bf.frequency.setValueAtTime(2200, now);
    bf.frequency.exponentialRampToValueAtTime(110, now + 1.1);
    bf.Q.value = 1.6;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, now);
    bg.gain.linearRampToValueAtTime(0.62 * s, now + 0.02);
    bg.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
    body.connect(bf);
    bf.connect(bg);
    bg.connect(this.master);
    body.start(now, Math.random(), 1.6);

    // ---- the thump under it, which is most of what you actually feel
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(96, now);
    sub.frequency.exponentialRampToValueAtTime(26, now + 0.75);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.55 * s, now);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
    sub.connect(sg);
    sg.connect(this.master);
    sub.start(now);
    sub.stop(now + 1.2);

    // ---- wreckage landing, spread over the next second and a half
    for (let i = 0; i < 7; i++) {
      const at = now + 0.35 + Math.random() * 1.2;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.playbackRate.value = 0.7 + Math.random() * 1.9;
      const f = ctx.createBiquadFilter();
      f.type = Math.random() < 0.45 ? 'bandpass' : 'lowpass';
      f.frequency.value = 300 + Math.random() * 2600;
      f.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(s * 0.16 * (0.4 + Math.random()), at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2 + Math.random() * 0.35);
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start(at, Math.random(), 0.6);
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
