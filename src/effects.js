import * as THREE from 'three';
import { skidTexture, softDotTexture } from './textures.js';
import { clamp } from './util/math.js';
import { QUALITY } from './quality.js';

/**
 * Tyre marks, smoke and dust. Both systems are fixed-size pools written into
 * pre-allocated buffers, so nothing allocates while driving.
 */

const SKID_QUADS = QUALITY.skidQuads;
const SMOKE_MAX = QUALITY.smokeMax;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this._buildSkids();
    this._buildSmoke();
    this._lastSkid = new Map();
    this.smokeScale = 1;     // 0 turns puffs off entirely
    this.skidsOn = true;
  }

  // ---------------------------------------------------------------- skids
  _buildSkids() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(SKID_QUADS * 4 * 3);
    const uv = new Float32Array(SKID_QUADS * 4 * 2);
    const alpha = new Float32Array(SKID_QUADS * 4);
    const idx = new Uint32Array(SKID_QUADS * 6);

    for (let q = 0; q < SKID_QUADS; q++) {
      const v = q * 4;
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], q * 8);
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: skidTexture() } },
      vertexShader: `
        attribute float aAlpha;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vUv = uv;
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          float a = texture2D(uMap, vUv).a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(0.05, 0.05, 0.06, a * 0.55);
        }
      `,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6
    });

    this.skidMesh = new THREE.Mesh(geo, mat);
    this.skidMesh.frustumCulled = false;
    this.skidMesh.renderOrder = 2;
    this.scene.add(this.skidMesh);
    this.skidHead = 0;
    this.skidCount = 0;
    this.skidGeo = geo;
  }

  /**
   * Lays one strip of rubber between the previous and current wheel position.
   * @param {string} key stable id per wheel so strips connect up
   */
  /** Called by the settings screen. */
  setLevels(smokeScale, skidsOn) {
    this.smokeScale = smokeScale;
    this.skidsOn = !!skidsOn;
    if (!this.skidsOn) this.clearSkids();
  }

  addSkid(key, x, y, z, dirX, dirZ, width, strength) {
    if (!this.skidsOn) return;
    const prev = this._lastSkid.get(key);
    const now = { x, y, z };
    if (!prev) {
      this._lastSkid.set(key, now);
      return;
    }
    const dx = x - prev.x;
    const dz = z - prev.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.35) return;
    if (len > 6) {
      this._lastSkid.set(key, now);
      return;
    }

    const rx = dirZ * width * 0.5;
    const rz = -dirX * width * 0.5;
    const q = this.skidHead;
    const o = q * 12;
    const p = this.skidGeo.attributes.position.array;
    const a = this.skidGeo.attributes.aAlpha.array;

    p[o + 0] = prev.x - rx; p[o + 1] = prev.y + 0.03; p[o + 2] = prev.z - rz;
    p[o + 3] = prev.x + rx; p[o + 4] = prev.y + 0.03; p[o + 5] = prev.z + rz;
    p[o + 6] = x + rx;      p[o + 7] = y + 0.03;      p[o + 8] = z + rz;
    p[o + 9] = x - rx;      p[o + 10] = y + 0.03;     p[o + 11] = z - rz;

    const al = clamp(strength, 0, 1);
    a[q * 4] = al; a[q * 4 + 1] = al; a[q * 4 + 2] = al; a[q * 4 + 3] = al;

    this.skidGeo.attributes.position.needsUpdate = true;
    this.skidGeo.attributes.aAlpha.needsUpdate = true;

    this.skidHead = (this.skidHead + 1) % SKID_QUADS;
    this.skidCount = Math.min(SKID_QUADS, this.skidCount + 1);
    this.skidGeo.setDrawRange(0, this.skidCount * 6);
    this._lastSkid.set(key, now);
  }

  clearSkids() {
    const a = this.skidGeo.attributes.aAlpha.array;
    a.fill(0);
    this.skidGeo.attributes.aAlpha.needsUpdate = true;
    this.skidCount = 0;
    this.skidHead = 0;
    this.skidGeo.setDrawRange(0, 0);
    this._lastSkid.clear();
  }

  // ---------------------------------------------------------------- smoke
  _buildSmoke() {
    const geo = new THREE.BufferGeometry();
    this.smokePos = new Float32Array(SMOKE_MAX * 3);
    this.smokeSize = new Float32Array(SMOKE_MAX);
    this.smokeAlpha = new Float32Array(SMOKE_MAX);
    this.smokeTintArr = new Float32Array(SMOKE_MAX * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.smokeSize, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.smokeAlpha, 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(this.smokeTintArr, 3));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: softDotTexture() } },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aTint;
        varying float vAlpha;
        varying vec3 vTint;
        void main() {
          vAlpha = aAlpha;
          vTint = aTint;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (320.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying float vAlpha;
        varying vec3 vTint;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vTint, a);
        }
      `,
      transparent: true,
      depthWrite: false
    });

    this.smokeMesh = new THREE.Points(geo, mat);
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.renderOrder = 3;
    this.scene.add(this.smokeMesh);
    this.smokeGeo = geo;

    this.smoke = [];
    for (let i = 0; i < SMOKE_MAX; i++) {
      this.smoke.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1 });
    }
    this.smokeHead = 0;
  }

  emitSmoke(x, y, z, vx, vy, vz, size, life, tint = [0.82, 0.82, 0.8]) {
    const i = this.smokeHead;
    this.smokeHead = (this.smokeHead + 1) % SMOKE_MAX;
    const p = this.smoke[i];
    p.life = life;
    p.max = life;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.size = size;
    this.smokePos[i * 3] = x;
    this.smokePos[i * 3 + 1] = y;
    this.smokePos[i * 3 + 2] = z;
    this.smokeTintArr[i * 3] = tint[0];
    this.smokeTintArr[i * 3 + 1] = tint[1];
    this.smokeTintArr[i * 3 + 2] = tint[2];
  }

  /**
   * A cloud, all at once: masonry dust off a breached wall, or the puff a
   * felled tree throws up. Scaled by the particle setting like everything
   * else, so it can be turned down.
   */
  burst(x, y, z, count, opts = {}) {
    const n = Math.round(count * this.smokeScale);
    const spread = opts.spread ?? 2.4;
    const lift = opts.lift ?? 3;
    const size = opts.size ?? 1.6;
    const life = opts.life ?? 1.5;
    const tint = opts.tint ?? [0.78, 0.75, 0.7];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.emitSmoke(
        x + Math.cos(a) * r * 0.5,
        y + Math.random() * spread * 0.8,
        z + Math.sin(a) * r * 0.5,
        (opts.vx ?? 0) * 0.25 + Math.cos(a) * (1 + Math.random() * 2.4),
        Math.random() * lift,
        (opts.vz ?? 0) * 0.25 + Math.sin(a) * (1 + Math.random() * 2.4),
        size * (0.6 + Math.random()),
        life * (0.7 + Math.random() * 0.8),
        tint
      );
    }
  }

  update(dt) {
    for (let i = 0; i < SMOKE_MAX; i++) {
      const p = this.smoke[i];
      if (p.life <= 0) {
        this.smokeAlpha[i] = 0;
        continue;
      }
      p.life -= dt;
      const t = clamp(p.life / p.max, 0, 1);
      this.smokePos[i * 3] += p.vx * dt;
      this.smokePos[i * 3 + 1] += p.vy * dt;
      this.smokePos[i * 3 + 2] += p.vz * dt;
      p.vy += 0.6 * dt;
      p.vx *= 1 - 1.6 * dt;
      p.vz *= 1 - 1.6 * dt;
      this.smokeSize[i] = p.size * (1 + (1 - t) * 2.4);
      this.smokeAlpha[i] = t * t * 0.55;
    }
    this.smokeGeo.attributes.position.needsUpdate = true;
    this.smokeGeo.attributes.aSize.needsUpdate = true;
    this.smokeGeo.attributes.aAlpha.needsUpdate = true;
    this.smokeGeo.attributes.aTint.needsUpdate = true;
  }
}
