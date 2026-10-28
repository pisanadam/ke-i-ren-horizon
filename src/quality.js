/**
 * One place that decides how heavy the world may be.
 *
 * There are five graphics profiles — Düşük, Orta, Yüksek, Çok yüksek and
 * Ultra. Each one is a complete description of the world the game builds:
 * how many buildings and trees, how far the near-field apartment detail
 * reaches, how big the shadow map is, how many bricks a wall may turn into.
 * Everything reads the same object, so the decision is made once, at startup;
 * the settings panel stores the choice and the next load builds that world.
 *
 * The live half of a profile (resolution, shadow quality, view distance and
 * so on) is in `PRESET_LIVE` and is applied by the settings panel straight
 * away.
 */

export const PRESET_KEYS = ['dusuk', 'orta', 'yuksek', 'cokyuksek', 'ultra'];
export const PRESET_NAMES = {
  dusuk: 'Düşük', orta: 'Orta', yuksek: 'Yüksek', cokyuksek: 'Çok yüksek', ultra: 'Ultra'
};

const PROFILES = {
  dusuk: {
    tier: 'mobile',
    pixelRatio: 1,
    shadowMap: 1024,
    shadowExtent: 90,
    shadowFar: 360,
    terrainStep: 12,
    backdropStep: 110,
    chunkSize: 620,
    chunkRadius: 1,
    trafficAgents: 26,
    trafficSpawnMax: 220,
    trees: 1800,
    treeDensity: 0.4,
    buildings: 3000,
    pedestrians: 18,
    metroTrains: 1,
    metroCull: 700,
    skidQuads: 240,
    smokeMax: 70,
    fogFarScale: 0.5,
    lampPools: false,
    balconies: false,
    detailRadius: 0,
    detailSlots: 0,
    masonry: 3500,
    rubble: 90
  },
  orta: {
    tier: 'mobile',
    pixelRatio: 1.15,
    shadowMap: 1024,
    shadowExtent: 105,
    shadowFar: 420,
    terrainStep: 10,
    backdropStep: 90,
    chunkSize: 620,
    chunkRadius: 2,
    trafficAgents: 40,
    trafficSpawnMax: 250,
    trees: 3200,
    treeDensity: 0.55,
    buildings: 4200,
    pedestrians: 34,
    metroTrains: 2,
    metroCull: 900,
    skidQuads: 380,
    smokeMax: 120,
    fogFarScale: 0.62,
    lampPools: true,
    balconies: true,
    detailRadius: 110,
    detailSlots: 48,
    masonry: 7000,
    rubble: 150
  },
  yuksek: {
    tier: 'desktop',
    pixelRatio: 1.5,
    shadowMap: 2048,
    shadowExtent: 160,
    shadowFar: 580,
    terrainStep: 8,
    backdropStep: 60,
    chunkSize: 620,
    chunkRadius: 3,
    trafficAgents: 80,
    trafficSpawnMax: 340,
    trees: 8000,
    treeDensity: 0.9,
    buildings: 10000,
    pedestrians: 70,
    metroTrains: 3,
    metroCull: 1300,
    skidQuads: 800,
    smokeMax: 220,
    fogFarScale: 1,
    lampPools: true,
    balconies: true,
    detailRadius: 190,
    detailSlots: 110,
    masonry: 18000,
    rubble: 360
  },
  cokyuksek: {
    tier: 'desktop',
    pixelRatio: 1.75,
    shadowMap: 2048,
    shadowExtent: 190,
    shadowFar: 640,
    terrainStep: 8,
    backdropStep: 60,
    chunkSize: 620,
    chunkRadius: 3,
    trafficAgents: 92,
    trafficSpawnMax: 360,
    trees: 9000,
    treeDensity: 1,
    buildings: 12000,
    pedestrians: 90,
    metroTrains: 4,
    metroCull: 1500,
    skidQuads: 900,
    smokeMax: 260,
    fogFarScale: 1,
    lampPools: true,
    balconies: true,
    detailRadius: 270,
    detailSlots: 170,
    masonry: 26000,
    rubble: 460
  },
  ultra: {
    tier: 'desktop',
    pixelRatio: 2,
    shadowMap: 4096,
    shadowExtent: 230,
    shadowFar: 800,
    terrainStep: 6,
    backdropStep: 50,
    chunkSize: 620,
    chunkRadius: 4,
    trafficAgents: 120,
    trafficSpawnMax: 420,
    trees: 12000,
    treeDensity: 1.2,
    buildings: 14000,
    pedestrians: 120,
    metroTrains: 4,
    metroCull: 2000,
    skidQuads: 1200,
    smokeMax: 360,
    fogFarScale: 1.15,
    lampPools: true,
    balconies: true,
    detailRadius: 360,
    detailSlots: 240,
    masonry: 40000,
    rubble: 700
  }
};

/**
 * What the settings panel applies live when a profile is picked. The keys
 * are the panel's own setting keys.
 */
export const PRESET_LIVE = {
  dusuk: {
    resScale: 0.75, shadows: 0, reflections: 0, viewDistance: 1, particles: 0.5,
    fog: 0.6, farClip: 2000, antialias: 0, culling: 2, skidMarks: 0, fpsTarget: 60
  },
  orta: {
    resScale: 0.9, shadows: 1, reflections: 1, viewDistance: 2, particles: 0.5,
    fog: 1, farClip: 3200, antialias: 0, culling: 1, skidMarks: 1, fpsTarget: 60
  },
  yuksek: {
    resScale: 1, shadows: 2, reflections: 2, viewDistance: 3, particles: 1,
    fog: 1, farClip: 6000, antialias: 1, culling: 1, skidMarks: 1, fpsTarget: 60
  },
  cokyuksek: {
    resScale: 1, shadows: 2, reflections: 2, viewDistance: 4, particles: 1,
    fog: 1.5, farClip: 6000, antialias: 1, culling: 1, skidMarks: 1, fpsTarget: 60
  },
  ultra: {
    resScale: 1.25, shadows: 2, reflections: 2, viewDistance: 5, particles: 1.6,
    fog: 1.5, farClip: 6000, antialias: 1, culling: 1, skidMarks: 1, fpsTarget: 0
  }
};

function touchFirst() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const noHover = window.matchMedia?.('(hover: none)').matches;
  const phoneSized = Math.min(window.screen?.width || 9999, window.screen?.height || 9999) < 600;
  return (coarse && noHover) || phoneSized;
}

function savedSettings() {
  try {
    return JSON.parse(localStorage.getItem('ankara-surus-ayarlar') || '{}') || {};
  } catch {
    return {};
  }
}

/**
 * The profile this load builds.
 *
 * `?kalite=dusuk|orta|yuksek|cokyuksek|ultra` wins (the old `low`/`high`
 * still work), then the profile saved in the settings, then the device:
 * touch-first devices start on Orta, everything else on Yüksek. Core and
 * memory counts are deliberately *not* used — plenty of capable desktops
 * report four cores.
 */
function detect(saved) {
  if (typeof window === 'undefined') return 'yuksek';
  const forced = new URLSearchParams(window.location.search).get('kalite');
  const alias = { low: 'dusuk', medium: 'orta', high: 'yuksek', veryhigh: 'cokyuksek' };
  const f = alias[forced] ?? forced;
  if (PROFILES[f]) return f;
  if (PROFILES[saved.preset]) return saved.preset;
  return touchFirst() ? 'orta' : 'yuksek';
}

const saved = savedSettings();
export const PRESET = detect(saved);
export const DEFAULT_PRESET = touchFirst() ? 'orta' : 'yuksek';

export const QUALITY = { ...PROFILES[PRESET], preset: PRESET, shadows: true };
// The density settings scale the profile's city; they were stored before but
// nothing read them.
if (typeof saved.buildings === 'number') QUALITY.buildings = Math.round(QUALITY.buildings * saved.buildings);
if (typeof saved.trees === 'number') QUALITY.trees = Math.round(QUALITY.trees * saved.trees);

export const IS_MOBILE = QUALITY.tier === 'mobile';

/** True when the device is primarily touch-driven. */
export const IS_TOUCH = typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);
