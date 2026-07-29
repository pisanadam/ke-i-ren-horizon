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

export function baseHeight(x, z) {
  // The valley meanders slightly instead of running dead straight.
  const valleyX = 52 * Math.sin(z * 0.0031) + 26 * Math.sin(z * 0.0074 + 1.1);
  const d = Math.abs(x - valleyX);

  let h = 4;
  h += 58 * smoothstep(70, 640, d);                 // valley walls
  h += 14 * Math.sin(z * 0.0022 + 1.2);             // long north-south swell
  h += 7 * Math.sin(x * 0.0035 - 0.4);

  h += hill(x, z, 620, -250, 300, 54);              // Estergon / Kuşcağız tepesi
  h += hill(x, z, -620, 150, 340, 44);              // Etlik sırtı
  h += hill(x, z, 60, -680, 420, 40, 1.3);          // Kalaba - Aktepe platosu
  h += hill(x, z, 260, 470, 280, 24);               // Pınarbaşı yükseltisi
  h += hill(x, z, -300, 760, 300, 20);              // Hasköy
  h -= hill(x, z, -40, -470, 210, 16, 1.2);         // Botanik Parkı çanağı

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
