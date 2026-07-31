/**
 * Modifications.
 *
 * Every option here changes something you can feel: an engine stage really
 * adds tractive force, wider tyres really add grip and mass, a lowered ride
 * height really moves the body. The spec the physics reads is derived from
 * the catalogue entry plus the chosen parts, so nothing is cosmetic-only
 * unless it says so.
 *
 * Choices are stored per car in localStorage, so the garage remembers what
 * you built.
 */

const KEY = 'ankara-surus-modifiye';

export const RIM_STYLES = [
  { id: 'stok', name: 'Stok', spokes: 5, style: 'spoke', colour: 0xc2c7cf },
  { id: 'yildiz', name: 'Yıldız', spokes: 10, style: 'spoke', colour: 0xd6dae0 },
  { id: 'derin', name: 'Derin jant', spokes: 6, style: 'dish', colour: 0xb9bec6 },
  { id: 'mesh', name: 'Petek', spokes: 14, style: 'spoke', colour: 0x9aa0a8 },
  { id: 'bronz', name: 'Bronz', spokes: 7, style: 'spoke', colour: 0xa9773f },
  { id: 'siyah', name: 'Mat siyah', spokes: 5, style: 'spoke', colour: 0x2a2d31 },
  { id: 'krom', name: 'Krom', spokes: 8, style: 'dish', colour: 0xe8ecf2 },
  { id: 'yaris', name: 'Yarış', spokes: 12, style: 'spoke', colour: 0xd8b53a }
];

export const PAINTS = [
  { id: 'duz', name: 'Düz', roughness: 0.42, metalness: 0.18 },
  { id: 'metalik', name: 'Metalik', roughness: 0.26, metalness: 0.6 },
  { id: 'mat', name: 'Mat', roughness: 0.86, metalness: 0.04 },
  { id: 'sedef', name: 'Sedef', roughness: 0.14, metalness: 0.85 }
];

/**
 * The option list. `apply` mutates the derived spec; anything without one is
 * purely how the car looks.
 */
export const MODS = [
  {
    key: 'engine', label: 'Motor', group: 'performans',
    values: [
      { v: 0, t: 'Stok' },
      { v: 1, t: 'Kademe 1', power: 1.14, mass: 4 },
      { v: 2, t: 'Kademe 2', power: 1.30, mass: 9 },
      { v: 3, t: 'Kademe 3', power: 1.52, mass: 16 },
      { v: 4, t: 'Yarış', power: 1.85, mass: 26 }
    ],
    apply: (spec, o) => {
      spec.power *= o.power ?? 1;
      spec.mass += o.mass ?? 0;
      spec.topSpeed *= 1 + ((o.power ?? 1) - 1) * 0.42;
    }
  },
  {
    key: 'turbo', label: 'Turbo', group: 'performans',
    values: [
      { v: 0, t: 'Yok' },
      { v: 1, t: 'Küçük', power: 1.18, lag: 0.55 },
      { v: 2, t: 'Orta', power: 1.34, lag: 0.85 },
      { v: 3, t: 'Büyük', power: 1.58, lag: 1.25 }
    ],
    apply: (spec, o) => {
      if (!o.power) return;
      spec.power *= o.power;
      spec.topSpeed *= 1 + (o.power - 1) * 0.5;
      // a big turbo takes a moment to come on song: `turboGain` is how much
      // of the total power is boost, `turboLag` how long it takes to arrive
      spec.turboGain = o.power;
      spec.turboLag = o.lag;
      spec.voice = { ...(spec.voice || {}), turbo: Math.min(1, (o.lag ?? 0) * 0.8) };
    }
  },
  {
    key: 'gearbox', label: 'Şanzıman', group: 'performans',
    values: [
      { v: 0, t: 'Stok' },
      { v: 1, t: 'Kısa dişli', accel: 1.12, top: 0.92 },
      { v: 2, t: 'Uzun dişli', accel: 0.93, top: 1.12 }
    ],
    apply: (spec, o) => {
      spec.power *= o.accel ?? 1;
      spec.topSpeed *= o.top ?? 1;
    }
  },
  {
    key: 'brakes', label: 'Fren', group: 'performans',
    values: [
      { v: 0, t: 'Stok' },
      { v: 1, t: 'Performans', brake: 1.22, mass: 3 },
      { v: 2, t: 'Karbon-seramik', brake: 1.48, mass: -6 }
    ],
    apply: (spec, o) => {
      spec.brake *= o.brake ?? 1;
      spec.mass += o.mass ?? 0;
    }
  },
  {
    key: 'weight', label: 'Hafifletme', group: 'performans',
    values: [
      { v: 0, t: 'Yok' },
      { v: 1, t: 'İç döşeme sök', mass: -0.05 },
      { v: 2, t: 'Karbon panel', mass: -0.11 },
      { v: 3, t: 'Tam yarış', mass: -0.18 }
    ],
    apply: (spec, o) => {
      if (o.mass) spec.mass *= 1 + o.mass;
    }
  },

  // ------------------------------------------------------------ şasi
  {
    key: 'tyres', label: 'Lastik', group: 'şasi',
    values: [
      { v: 0, t: 'Stok' },
      { v: 1, t: 'Geniş sport', grip: 1.10, width: 1.18, mass: 6 },
      { v: 2, t: 'Yarı slick', grip: 1.22, width: 1.30, mass: 9 },
      { v: 3, t: 'Slick', grip: 1.34, width: 1.42, mass: 12 },
      { v: 4, t: 'Kar/çamur', grip: 0.94, width: 1.12, mass: 8, offRoad: 1.25 }
    ],
    apply: (spec, o) => {
      spec.grip *= o.grip ?? 1;
      spec.wheelWidth = (spec.wheelWidth ?? 0.24) * (o.width ?? 1);
      spec.mass += o.mass ?? 0;
      spec.offRoadBonus = o.offRoad ?? 1;
    }
  },
  {
    key: 'rim', label: 'Jant tipi', group: 'şasi',
    values: RIM_STYLES.map((r, i) => ({ v: i, t: r.name }))
  },
  {
    key: 'rimSize', label: 'Jant boyutu', group: 'şasi',
    values: [
      { v: -1, t: 'Küçük', r: 0.94, grip: 0.97 },
      { v: 0, t: 'Stok', r: 1, grip: 1 },
      { v: 1, t: 'Büyük', r: 1.06, grip: 1.02 },
      { v: 2, t: 'Çok büyük', r: 1.12, grip: 1.01, mass: 8 }
    ],
    apply: (spec, o) => {
      spec.wheelRadius *= o.r ?? 1;
      spec.grip *= o.grip ?? 1;
      spec.mass += o.mass ?? 0;
    }
  },
  {
    key: 'suspension', label: 'Süspansiyon', group: 'şasi',
    values: [
      { v: 0, t: 'Stok', ride: 1, grip: 1 },
      { v: 1, t: 'Sport', ride: 0.82, grip: 1.05 },
      { v: 2, t: 'Coilover', ride: 0.66, grip: 1.09 },
      { v: 3, t: 'Yerde', ride: 0.5, grip: 1.11 },
      { v: 4, t: 'Yükseltilmiş', ride: 1.45, grip: 0.95 }
    ],
    apply: (spec, o) => {
      spec.rideHeight *= o.ride ?? 1;
      spec.grip *= o.grip ?? 1;
    }
  },
  {
    key: 'steer', label: 'Direksiyon açısı', group: 'şasi',
    values: [
      { v: 0, t: 'Stok', s: 1 },
      { v: 1, t: 'Geniş açı', s: 1.25 },
      { v: 2, t: 'Drift açısı', s: 1.55 }
    ],
    apply: (spec, o) => { spec.steerMax *= o.s ?? 1; }
  },

  // ----------------------------------------------------------- görünüm
  { key: 'paint', label: 'Boya tipi', group: 'görünüm', values: PAINTS.map((p, i) => ({ v: i, t: p.name })) },
  {
    key: 'tint', label: 'Cam filmi', group: 'görünüm',
    values: [
      { v: 0, t: 'Yok', o: 0.66 }, { v: 1, t: 'Hafif', o: 0.5 },
      { v: 2, t: 'Koyu', o: 0.3 }, { v: 3, t: 'Siyah', o: 0.12 }
    ]
  },
  {
    key: 'spoiler', label: 'Spoyler', group: 'görünüm',
    values: [{ v: 0, t: 'Stok' }, { v: 1, t: 'Var' }, { v: 2, t: 'Yok' }],
    apply: (spec, o) => {
      if (o.v === 1) { spec.spoiler = true; spec.grip *= 1.03; }
      if (o.v === 2) spec.spoiler = false;
    }
  },
  {
    key: 'exhaust', label: 'Egzoz', group: 'görünüm',
    values: [
      { v: 0, t: 'Stok', ex: 1 },
      { v: 1, t: 'Sport', ex: 1.4, power: 1.03 },
      { v: 2, t: 'Yarış', ex: 1.9, power: 1.06 }
    ],
    apply: (spec, o) => {
      spec.power *= o.power ?? 1;
      spec.voice = { ...(spec.voice || {}), ex: (spec.voice?.ex ?? 1) * (o.ex ?? 1) };
    }
  }
];

export const MOD_GROUPS = ['performans', 'şasi', 'görünüm'];

/** Everything at its stock setting. */
export function defaultTune() {
  const t = {};
  for (const m of MODS) t[m.key] = m.values[0].v === -1 ? 0 : m.values[0].v;
  t.rimSize = 0;
  t.colour = null;          // null means "use the catalogue colour"
  return t;
}

export function loadTunes() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch { return {}; }
}

export function saveTunes(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* özel mod */ }
}

/** The option object for a chosen value. */
export function option(mod, value) {
  return mod.values.find((o) => o.v === value) ?? mod.values[0];
}

/**
 * Builds the spec the physics and the model should actually use.
 * The catalogue entry is never mutated.
 */
export function tunedSpec(base, tune) {
  const spec = { ...base, voice: base.voice ? { ...base.voice } : undefined };
  if (!tune) return spec;
  for (const mod of MODS) {
    if (!mod.apply) continue;
    mod.apply(spec, option(mod, tune[mod.key] ?? 0));
  }
  // keep the stat bars honest about what was built
  const pw = spec.power / spec.mass;
  spec.stats = {
    speed: Math.min(1, spec.topSpeed / 86),
    accel: Math.min(1, pw / 15),
    grip: Math.min(1, spec.grip / 1.5),
    brake: Math.min(1, spec.brake / 23000)
  };
  spec.rim = RIM_STYLES[tune.rim ?? 0] ?? RIM_STYLES[0];
  spec.paintStyle = PAINTS[tune.paint ?? 0] ?? PAINTS[0];
  spec.glassOpacity = option(MODS.find((m) => m.key === 'tint'), tune.tint ?? 0).o ?? 0.66;
  return spec;
}
