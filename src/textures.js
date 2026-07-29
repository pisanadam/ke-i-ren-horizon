import * as THREE from 'three';
import { makeRng } from './util/math.js';

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = aniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function memo(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}

/** Speckled asphalt with faint cracks and patch repairs. */
export function asphaltTexture() {
  return memo('asphalt', () => {
    const S = 512;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const rng = makeRng(4711);

    g.fillStyle = '#3a3d42';
    g.fillRect(0, 0, S, S);

    const img = g.getImageData(0, 0, S, S);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rng() - 0.5) * 46;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
    g.putImageData(img, 0, 0);

    // tar-sealed cracks
    g.strokeStyle = 'rgba(24,25,28,0.55)';
    for (let i = 0; i < 22; i++) {
      g.lineWidth = 1 + rng() * 2.2;
      g.beginPath();
      let x = rng() * S;
      let y = rng() * S;
      g.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += (rng() - 0.5) * 90;
        y += (rng() - 0.5) * 90;
        g.lineTo(x, y);
      }
      g.stroke();
    }

    // lighter asphalt patches
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `rgba(${72 + rng() * 22 | 0},${74 + rng() * 22 | 0},${80 + rng() * 22 | 0},0.16)`;
      const w = 40 + rng() * 130;
      const h = 30 + rng() * 90;
      g.fillRect(rng() * S, rng() * S, w, h);
    }
    return finish(c, { repeat: [1, 1] });
  });
}

/** Dry Ankara grass — olive/khaki rather than lush green. */
export function grassTexture() {
  return memo('grass', () => {
    const S = 256;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const rng = makeRng(90210);
    g.fillStyle = '#6b7440';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 5200; i++) {
      const t = rng();
      g.fillStyle = t > 0.72
        ? `rgba(${130 + rng() * 40 | 0},${140 + rng() * 30 | 0},${72 + rng() * 30 | 0},0.5)`
        : `rgba(${76 + rng() * 30 | 0},${86 + rng() * 26 | 0},${48 + rng() * 22 | 0},0.55)`;
      g.fillRect(rng() * S, rng() * S, 1 + rng() * 3, 1 + rng() * 3);
    }
    return finish(c, { repeat: [1, 1] });
  });
}

/** Concrete pavement for sidewalks, with slab joints. */
export function sidewalkTexture() {
  return memo('sidewalk', () => {
    const S = 256;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const rng = makeRng(31337);
    g.fillStyle = '#9a9689';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 4000; i++) {
      const v = 140 + rng() * 60;
      g.fillStyle = `rgba(${v | 0},${(v - 4) | 0},${(v - 14) | 0},0.25)`;
      g.fillRect(rng() * S, rng() * S, 2, 2);
    }
    g.strokeStyle = 'rgba(70,68,62,0.5)';
    g.lineWidth = 2;
    const step = S / 4;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, S); g.stroke();
      g.beginPath(); g.moveTo(0, i * step); g.lineTo(S, i * step); g.stroke();
    }
    return finish(c, { repeat: [1, 1] });
  });
}

const FACADE_PALETTES = {
  // Ankara apartment blocks: sand, cream, brick, pale grey
  sand:   { wall: '#c9b393', trim: '#b09b7c', glass: '#2c3a4a' },
  cream:  { wall: '#ddd3bd', trim: '#c3b79e', glass: '#31404f' },
  brick:  { wall: '#a9694f', trim: '#8f5641', glass: '#2b3846' },
  grey:   { wall: '#b6b7b3', trim: '#9b9c98', glass: '#2a3644' },
  ochre:  { wall: '#c99a5b', trim: '#ad8149', glass: '#2d3b4b' },
  white:  { wall: '#e6e4dd', trim: '#cbc8bf', glass: '#33424f' },
  teal:   { wall: '#8fa9a4', trim: '#78918d', glass: '#28353f' }
};

export const FACADE_KEYS = Object.keys(FACADE_PALETTES);

/**
 * Builds a tiling apartment facade: one texture cell == one floor by one window bay.
 * Returns { map, emissiveMap } so windows can light up after dark.
 */
export function facadeTexture(key = 'sand', seed = 7) {
  return memo(`facade:${key}:${seed}`, () => {
    const pal = FACADE_PALETTES[key] || FACADE_PALETTES.sand;
    const CELL = 64;
    const COLS = 4;
    const ROWS = 4;
    const W = CELL * COLS;
    const H = CELL * ROWS;
    const rng = makeRng(1000 + seed * 97);

    const c = canvas(W, H);
    const g = c.getContext('2d');
    const e = canvas(W, H);
    const ge = e.getContext('2d');

    g.fillStyle = pal.wall;
    g.fillRect(0, 0, W, H);
    ge.fillStyle = '#000';
    ge.fillRect(0, 0, W, H);

    // subtle stucco grain
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = `rgba(0,0,0,${rng() * 0.05})`;
      g.fillRect(rng() * W, rng() * H, 2, 2);
    }

    for (let r = 0; r < ROWS; r++) {
      for (let col = 0; col < COLS; col++) {
        const x = col * CELL;
        const y = r * CELL;

        // floor slab band
        g.fillStyle = pal.trim;
        g.fillRect(x, y + CELL - 7, CELL, 7);

        // window opening
        const wx = x + 12;
        const wy = y + 10;
        const ww = CELL - 24;
        const wh = CELL - 26;

        g.fillStyle = '#6d6659';
        g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
        g.fillStyle = pal.glass;
        g.fillRect(wx, wy, ww, wh);

        // sky reflection in the pane
        const grd = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
        grd.addColorStop(0, 'rgba(190,215,240,0.42)');
        grd.addColorStop(0.5, 'rgba(120,150,180,0.10)');
        grd.addColorStop(1, 'rgba(20,30,45,0.30)');
        g.fillStyle = grd;
        g.fillRect(wx, wy, ww, wh);

        // mullion
        g.fillStyle = 'rgba(230,228,220,0.75)';
        g.fillRect(wx + ww / 2 - 1, wy, 2, wh);

        // balcony rail on some bays
        if (rng() > 0.55) {
          g.fillStyle = 'rgba(60,62,64,0.75)';
          g.fillRect(x + 6, y + CELL - 20, CELL - 12, 3);
          for (let b = 0; b < 7; b++) {
            g.fillRect(x + 7 + b * ((CELL - 14) / 7), y + CELL - 20, 1.5, 13);
          }
        }

        // an AC unit here and there
        if (rng() > 0.82) {
          g.fillStyle = '#d6d6d2';
          g.fillRect(x + CELL - 16, y + CELL - 26, 10, 8);
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.fillRect(x + CELL - 16, y + CELL - 26, 10, 2);
        }

        // lit-window mask: warm interiors, a few cool fluorescent ones
        if (rng() > 0.42) {
          const warm = rng() > 0.24;
          ge.fillStyle = warm ? '#ffcb75' : '#cfe6ff';
          ge.globalAlpha = 0.55 + rng() * 0.45;
          ge.fillRect(wx, wy, ww, wh);
          ge.globalAlpha = 1;
        }
      }
    }

    return {
      map: finish(c, { repeat: [1, 1] }),
      emissiveMap: finish(e, { repeat: [1, 1], srgb: true })
    };
  });
}

/** Ground-floor shopfronts: glazing, signage bands, roller shutters. */
export function shopTexture(seed = 3) {
  return memo(`shop:${seed}`, () => {
    const CELL = 96;
    const COLS = 4;
    const W = CELL * COLS;
    const H = CELL;
    const rng = makeRng(500 + seed * 31);
    const c = canvas(W, H);
    const g = c.getContext('2d');
    const e = canvas(W, H);
    const ge = e.getContext('2d');

    g.fillStyle = '#8d8a84';
    g.fillRect(0, 0, W, H);
    ge.fillStyle = '#000';
    ge.fillRect(0, 0, W, H);

    const signColors = ['#d0342c', '#1f6fb2', '#2e8b57', '#e0a800', '#7a3fa0', '#c2410c', '#0f766e'];

    for (let col = 0; col < COLS; col++) {
      const x = col * CELL;
      // signage band
      const sc = signColors[Math.floor(rng() * signColors.length)];
      g.fillStyle = sc;
      g.fillRect(x + 2, 6, CELL - 4, 20);
      ge.fillStyle = sc;
      ge.globalAlpha = 0.9;
      ge.fillRect(x + 2, 6, CELL - 4, 20);
      ge.globalAlpha = 1;

      // fake lettering
      g.fillStyle = 'rgba(255,255,255,0.85)';
      let lx = x + 10;
      const words = 1 + Math.floor(rng() * 2);
      for (let w = 0; w < words; w++) {
        const letters = 3 + Math.floor(rng() * 5);
        for (let l = 0; l < letters; l++) {
          g.fillRect(lx, 13, 4, 8);
          lx += 6;
        }
        lx += 6;
      }

      if (rng() > 0.78) {
        // closed roller shutter
        g.fillStyle = '#7f8288';
        g.fillRect(x + 4, 30, CELL - 8, H - 34);
        g.fillStyle = 'rgba(0,0,0,0.18)';
        for (let s = 0; s < 14; s++) g.fillRect(x + 4, 32 + s * 4, CELL - 8, 1.6);
      } else {
        // glazed front
        g.fillStyle = '#20303c';
        g.fillRect(x + 4, 30, CELL - 8, H - 34);
        const grd = g.createLinearGradient(x, 30, x + CELL, H);
        grd.addColorStop(0, 'rgba(220,235,250,0.35)');
        grd.addColorStop(1, 'rgba(20,30,45,0.15)');
        g.fillStyle = grd;
        g.fillRect(x + 4, 30, CELL - 8, H - 34);
        g.fillStyle = 'rgba(240,240,235,0.6)';
        g.fillRect(x + CELL / 2 - 1, 30, 2, H - 34);
        ge.fillStyle = '#fff3d0';
        ge.globalAlpha = 0.8;
        ge.fillRect(x + 6, 32, CELL - 12, H - 38);
        ge.globalAlpha = 1;
      }
    }
    return {
      map: finish(c, { repeat: [1, 1] }),
      emissiveMap: finish(e, { repeat: [1, 1] })
    };
  });
}

/** Flat roof: gravel, water tanks are added as geometry elsewhere. */
export function roofTexture() {
  return memo('roof', () => {
    const S = 128;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const rng = makeRng(2024);
    g.fillStyle = '#57534c';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const v = 60 + rng() * 70;
      g.fillStyle = `rgba(${v | 0},${v | 0},${(v - 6) | 0},0.5)`;
      g.fillRect(rng() * S, rng() * S, 2, 2);
    }
    return finish(c, { repeat: [1, 1] });
  });
}

/** Turkish flag for the civic buildings. */
export function flagTexture() {
  return memo('flag', () => {
    const W = 192;
    const H = 128;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#e30a17';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff';
    // crescent = big circle minus a smaller offset circle
    g.beginPath();
    g.arc(W * 0.375, H * 0.5, H * 0.25, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e30a17';
    g.beginPath();
    g.arc(W * 0.42, H * 0.5, H * 0.2, 0, Math.PI * 2);
    g.fill();
    // five-pointed star
    g.fillStyle = '#fff';
    const cx = W * 0.545;
    const cy = H * 0.5;
    const R = H * 0.125;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? R : R * 0.42;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    return finish(c, { repeat: [1, 1] });
  });
}

/** Soft round blob used for tyre smoke and headlight pools. */
export function softDotTexture() {
  return memo('softdot', () => {
    const S = 128;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    return finish(c, { repeat: [1, 1], srgb: false });
  });
}

/** Elongated soft blob for skid marks. */
export function skidTexture() {
  return memo('skid', () => {
    const S = 64;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, S, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.25, 'rgba(0,0,0,0.85)');
    grd.addColorStop(0.75, 'rgba(0,0,0,0.85)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    return finish(c, { repeat: [1, 1], srgb: false });
  });
}

/** Signboard used by landmarks (metro entrance, hospital, stadium…). */
export function signTexture(text, bg = '#c8102e', fg = '#ffffff') {
  return memo(`sign:${text}:${bg}`, () => {
    const W = 512;
    const H = 128;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = fg;
    g.font = 'bold 58px Inter, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, W / 2, H / 2 + 4, W - 30);
    return finish(c, { repeat: [1, 1] });
  });
}

export function disposeTextureCache() {
  for (const v of cache.values()) {
    if (v?.dispose) v.dispose();
    else if (v?.map) { v.map.dispose(); v.emissiveMap?.dispose(); }
  }
  cache.clear();
}
