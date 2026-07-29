export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential smoothing. */
export function damp(current, target, smoothing, dt) {
  return lerp(current, target, 1 - Math.exp(-smoothing * dt));
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function dampAngle(current, target, smoothing, dt) {
  return current + wrapAngle(target - current) * (1 - Math.exp(-smoothing * dt));
}

/** Deterministic 32-bit PRNG (mulberry32) so the city is identical every run. */
export function makeRng(seed = 1337) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth deterministic value noise. */
export function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function fbm(x, y, octaves = 4, gain = 0.5, lacunarity = 2) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x, y) * amp;
    norm += amp;
    amp *= gain;
    x *= lacunarity;
    y *= lacunarity;
  }
  return sum / norm;
}

/** Squared distance from point p to segment ab, plus the parametric position. */
export function distToSegment2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t;
  const cz = az + dz * t;
  const ex = px - cx;
  const ez = pz - cz;
  return { d2: ex * ex + ez * ez, t, cx, cz };
}

/** Intersection of segments p1->p2 and p3->p4; null when parallel or outside. */
export function segIntersect(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x;
  const d1z = p2.z - p1.z;
  const d2x = p4.x - p3.x;
  const d2z = p4.z - p3.z;
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p3.x - p1.x) * d2z - (p3.z - p1.z) * d2x) / den;
  const u = ((p3.x - p1.x) * d1z - (p3.z - p1.z) * d1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + d1x * t, z: p1.z + d1z * t, t, u };
}

export function randPick(rng, arr) {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
}

export function randRange(rng, a, b) {
  return a + rng() * (b - a);
}
