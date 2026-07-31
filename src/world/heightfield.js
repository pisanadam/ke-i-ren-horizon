import { fbm, smoothstep } from '../util/math.js';

/**
 * Keçiören sits on the northern hills of Ankara: a central valley running
 * north-south (where Fatih Caddesi lies), a ridge to the west carrying Etlik
 * and Sanatoryum, the Estergon/Kuşcağız hill in the east, and the Kalaba /
 * Aktepe plateau rising toward the northern ring road.
 *
 * Heights are in metres relative to an arbitrary datum; the district really is
 * roughly 60-90 m of relief end to end, which is what this reproduces.
 */

function hill(x, z, cx, cz, radius, height, sharpness = 1.6) {
  const dx = (x - cx) / radius;
  const dz = (z - cz) / radius;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= 1) return 0;
  const t = 1 - d;
  return height * Math.pow(t, sharpness) * (3 - 2 * t) * 0.5;
}

/** Smooth 0..1 bump, 1 at the centre, 0 beyond `radius`. */
function blob(x, z, cx, cz, radius) {
  const d = Math.hypot(x - cx, z - cz) / radius;
  if (d >= 1) return 0;
  const t = 1 - d;
  return t * t * (3 - 2 * t);
}

/**
 * Keçiören's own relief: the north-south valley with Fatih Caddesi in it, the
 * Etlik ridge to the west and the Estergon hill to the east. Faded out beyond
 * the district so it does not impose a valley on the rest of Ankara.
 */
function kecioren(x, z) {
  const valleyX = 52 * Math.sin(z * 0.0031) + 26 * Math.sin(z * 0.0074 + 1.1);
  const d = Math.abs(x - valleyX);

  let h = 58 * smoothstep(70, 640, d);              // valley walls
  h += 14 * Math.sin(z * 0.0022 + 1.2);             // long north-south swell
  h += 7 * Math.sin(x * 0.0035 - 0.4);

  h += hill(x, z, 620, -250, 300, 54);              // Estergon / Kuşcağız tepesi
  h += hill(x, z, -620, 150, 340, 44);              // Etlik sırtı
  h += hill(x, z, 60, -680, 420, 40, 1.3);          // Kalaba - Aktepe platosu
  h += hill(x, z, 260, 470, 280, 24);               // Pınarbaşı yükseltisi
  h += hill(x, z, -300, 760, 300, 20);              // Hasköy
  h -= hill(x, z, -40, -470, 210, 16, 1.2);         // Botanik Parkı çanağı
  return h;
}

/**
 * Greater Ankara. The city sits in a basin that drains north-west along the
 * Ankara Çayı: Ulus and Kızılay are on the low ground, Çankaya climbs the
 * ridge to the south, Elmadağ walls the map in to the east, and the plain
 * opens out west through Etimesgut towards Sincan.
 */
export function baseHeight(x, z) {
  let h = 34;

  // the Ankara Çayı corridor, running NW from the centre out past Etimesgut
  const streamZ = 1500 + (x + 200) * 0.10 + 120 * Math.sin(x * 0.00085);
  h -= 30 * (1 - smoothstep(60, 900, Math.abs(z - streamZ)));

  // broad regional swells
  h += 26 * Math.sin(x * 0.00042 + 0.6) * Math.cos(z * 0.00037 - 0.3);
  h += 14 * Math.sin(z * 0.00061 + 2.1);

  h += hill(x, z, -150, 3050, 1500, 128);           // Çankaya - Dikmen sırtı
  h += hill(x, z, 80, 1640, 300, 76, 2.1);          // Ankara Kalesi tepesi
  h += hill(x, z, 2500, 1700, 2000, 165, 1.4);      // Elmadağ
  h += hill(x, z, 1500, 2700, 1100, 74);            // Mamak yamaçları
  h += hill(x, z, -1950, 3150, 1350, 92);           // ODTÜ - Bilkent platosu
  h += hill(x, z, -2700, 780, 1000, 58);            // Batıkent sırtı
  h += hill(x, z, -900, 1850, 700, 40);             // Yenimahalle
  h += hill(x, z, 1450, -2300, 1500, 70, 1.3);      // Pursaklar tepeleri
  h += hill(x, z, 2450, -3700, 1200, 46, 1.3);      // Esenboğa platosu

  h -= hill(x, z, -3700, 1150, 1600, 46, 1.2);      // Etimesgut - Sincan ovası
  h -= hill(x, z, 620, 4180, 900, 40, 1.2);         // Gölbaşı çanağı
  h -= hill(x, z, -520, 2150, 420, 16);             // Anıtkabir düzlüğü

  // Keçiören, kept exactly as it was, faded out past the district
  h += kecioren(x, z) * blob(x, z, 0, -40, 2100);

  h += (fbm(x * 0.0042, z * 0.0042, 4) - 0.5) * 17; // rolling detail
  h += (fbm(x * 0.021, z * 0.021, 3) - 0.5) * 3.2;  // fine grain
  return h;
}

export function baseNormal(x, z, eps = 2) {
  const hL = baseHeight(x - eps, z);
  const hR = baseHeight(x + eps, z);
  const hD = baseHeight(x, z - eps);
  const hU = baseHeight(x, z + eps);
  const nx = hL - hR;
  const nz = hD - hU;
  const ny = 2 * eps;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / len, y: ny / len, z: nz / len };
}
