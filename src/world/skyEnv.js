import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, lerp, smoothstep, makeRng } from '../util/math.js';
import { QUALITY } from '../quality.js';

/**
 * Sky dome, sun, moon-lit night and everything that has to change colour as
 * the clock runs: fog, ambient bounce, window lights and street lamps.
 */
export class SkyEnv {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.hour = 9.5;
    this.timeScale = 40;      // one in-game minute per 1.5 real seconds
    this.autoAdvance = true;

    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    scene.add(this.sky);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4.2;
    u.rayleigh.value = 2.1;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.82;

    this.sun = new THREE.DirectionalLight(0xfff0dd, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(QUALITY.shadowMap, QUALITY.shadowMap);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = QUALITY.shadowFar;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.9;
    const cam = this.sun.shadow.camera;
    const ext = QUALITY.shadowExtent;
    cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
    cam.updateProjectionMatrix();
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd6ff, 0x6b6247, 0.9);
    scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.18);
    scene.add(this.ambient);

    scene.fog = new THREE.Fog(0xbfd0e0, 260, 1650);

    this._buildStars();

    this.sunPos = new THREE.Vector3();
    this.fogScale = 1;
    this._fogNear = 260;
    this._fogFar = 1650;
    this.dayFactor = 1;
    this.nightFactor = 0;
    this._skyColour = new THREE.Color();
  }

  _buildStars() {
    const rng = makeRng(24680);
    const N = 900;
    const pos = new Float32Array(N * 3);
    const size = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // upper hemisphere only
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos(clamp(rng() * 0.98 + 0.02, 0, 1));
      const r = 6000;
      pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      pos[i * 3 + 1] = Math.cos(phi) * r * 0.9 + 400;
      pos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
      size[i] = 8 + rng() * 26;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

    const mat = new THREE.PointsMaterial({
      color: 0xfff6e0,
      size: 18,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false
    });
    this.stars = new THREE.Points(geo, mat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    // moon
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(180, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0xf2f0e4, fog: false, transparent: true, opacity: 0 })
    );
    this.moon.frustumCulled = false;
    this.scene.add(this.moon);
  }

  setHour(h) {
    this.hour = ((h % 24) + 24) % 24;
  }

  advance(hours) {
    this.setHour(this.hour + hours);
  }

  get clockText() {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** 0 off, 1 low, 2 high — driven by the settings screen. */
  setShadowQuality(level) {
    this.sun.castShadow = level > 0;
    const size = level >= 2 ? QUALITY.shadowMap : Math.max(512, QUALITY.shadowMap / 2);
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  update(dt, focus) {
    if (this.autoAdvance) this.setHour(this.hour + (dt * this.timeScale) / 3600);

    const h = this.hour;
    const elevDeg = 62 * Math.sin(((h - 6) / 12) * Math.PI);
    const azimDeg = 190 + (h - 12) * 14;
    const phi = THREE.MathUtils.degToRad(90 - elevDeg);
    const theta = THREE.MathUtils.degToRad(azimDeg);
    this.sunPos.setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunPos);

    const day = smoothstep(-6, 8, elevDeg);
    const dusk = smoothstep(-14, 2, elevDeg) * (1 - smoothstep(4, 16, elevDeg));
    this.dayFactor = day;
    this.nightFactor = 1 - day;

    // ---- sun ------------------------------------------------------------
    const sunDist = 340;
    this.sun.position.set(
      focus.x + this.sunPos.x * sunDist,
      focus.y + Math.max(30, this.sunPos.y * sunDist),
      focus.z + this.sunPos.z * sunDist
    );
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    this.sun.intensity = lerp(0.06, 3.3, day);
    this.sun.color.setRGB(
      lerp(1.0, 1.0, day),
      lerp(0.62, 0.95, day) + dusk * 0.05,
      lerp(0.42, 0.88, day) - dusk * 0.12
    );
    this.sun.castShadow = day > 0.08;

    // ---- ambience --------------------------------------------------------
    this.hemi.intensity = lerp(0.22, 1.05, day);
    this.hemi.color.setHSL(0.58, 0.45, lerp(0.22, 0.72, day));
    this.hemi.groundColor.setHSL(0.11, 0.28, lerp(0.08, 0.36, day));
    this.ambient.intensity = lerp(0.10, 0.20, day);

    // ---- sky / fog -------------------------------------------------------
    this.sky.material.uniforms.turbidity.value = lerp(2.4, 5.2, day);
    this.sky.material.uniforms.rayleigh.value = lerp(0.6, 2.3, day);
    this.sky.material.uniforms.mieCoefficient.value = lerp(0.002, 0.008, day);

    const fogDay = new THREE.Color(0xc3d3e2);
    const fogNight = new THREE.Color(0x0b1220);
    const fogDusk = new THREE.Color(0xd88f5e);
    this._skyColour.copy(fogNight).lerp(fogDay, day);
    this._skyColour.lerp(fogDusk, dusk * 0.55);
    this.scene.fog.color.copy(this._skyColour);
    this.scene.fog.near = lerp(90, 300, day) * this.fogScale;
    this.scene.fog.far = lerp(900, 1750, day) * QUALITY.fogFarScale * this.fogScale;
    this.renderer.setClearColor(this._skyColour, 1);

    // ---- night sky -------------------------------------------------------
    const starOpacity = clamp(1 - day * 2.6, 0, 1);
    this.stars.material.opacity = starOpacity * 0.9;
    this.stars.position.set(focus.x, 0, focus.z);
    this.moon.material.opacity = starOpacity;
    const moonPhi = THREE.MathUtils.degToRad(90 + elevDeg);
    const moonTheta = THREE.MathUtils.degToRad(azimDeg + 180);
    const mp = new THREE.Vector3().setFromSphericalCoords(4200, moonPhi, moonTheta);
    this.moon.position.set(focus.x + mp.x, Math.max(200, mp.y), focus.z + mp.z);
  }

  /** 0 during the day, 1 at night — drives window and street lighting. */
  get lightsOn() {
    return clamp(1 - smoothstep(-2, 10, 62 * Math.sin(((this.hour - 6) / 12) * Math.PI)), 0, 1);
  }
}
