/**
 * One place that decides how heavy the world may be. Phones get a smaller
 * city, fewer cars and cheaper shadows; everything reads the same object so
 * the decision is made once, at startup.
 */

/**
 * Touch-first devices get the light build. Core and memory counts are
 * deliberately *not* used as triggers — plenty of perfectly capable desktops
 * report four cores, and downgrading those would be wrong.
 * `?kalite=dusuk` / `?kalite=yuksek` forces either tier by hand.
 */
function detect() {
  if (typeof window === 'undefined') return 'desktop';

  const forced = new URLSearchParams(window.location.search).get('kalite');
  if (forced === 'dusuk' || forced === 'low') return 'mobile';
  if (forced === 'yuksek' || forced === 'high') return 'desktop';

  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const noHover = window.matchMedia?.('(hover: none)').matches;
  const phoneSized = Math.min(window.screen?.width || 9999, window.screen?.height || 9999) < 600;
  if ((coarse && noHover) || phoneSized) return 'mobile';
  return 'desktop';
}

const tier = detect();

export const QUALITY = tier === 'mobile'
  ? {
    tier: 'mobile',
    pixelRatio: 1.15,
    shadows: true,
    shadowMap: 1024,
    shadowExtent: 105,
    shadowFar: 420,
    terrainStep: 10,
    backdropStep: 90,
    chunkSize: 620,
    chunkRadius: 2,
    trafficAgents: 40,
    trafficSpawnMax: 250,
    trees: 2600,
    treeDensity: 0.55,
    buildings: 2600,
    pedestrians: 34,
    metroTrains: 2,
    metroCull: 900,
    skidQuads: 380,
    smokeMax: 120,
    fogFarScale: 0.62,
    lampPools: true
  }
  : {
    tier: 'desktop',
    pixelRatio: 1.75,
    shadows: true,
    shadowMap: 2048,
    shadowExtent: 170,
    shadowFar: 620,
    terrainStep: 8,
    backdropStep: 60,
    chunkSize: 620,
    chunkRadius: 3,
    trafficAgents: 92,
    trafficSpawnMax: 360,
    trees: 7000,
    treeDensity: 1,
    buildings: 7000,
    pedestrians: 90,
    metroTrains: 4,
    metroCull: 1500,
    skidQuads: 900,
    smokeMax: 260,
    fogFarScale: 1,
    lampPools: true
  };

export const IS_MOBILE = tier === 'mobile';

/** True when the device is primarily touch-driven. */
export const IS_TOUCH = typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);
