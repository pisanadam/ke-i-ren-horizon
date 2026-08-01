import * as THREE from 'three';
import { QUALITY } from '../quality.js';

/**
 * Image-based lighting and real reflections.
 *
 * The paint on a car is only convincing when it has something to reflect.
 * A cube camera parked on the roof grabs the surroundings, a PMREM pass
 * turns that into the blurred mip chain a rough surface needs, and the
 * result goes on `scene.environment` so every metal and glass surface in
 * the world is lit by it instead of by a flat hemisphere light.
 *
 * The capture is the expensive part — six scene renders — so two things
 * keep it cheap:
 *
 *   * it only runs a few times a second, never every frame;
 *   * the cube camera is restricted to a layer that holds the sky, the
 *     ground and the buildings. Trees, street furniture, traffic and the
 *     player's own car are left out, which is both faster and correct:
 *     a car must not reflect itself.
 */

/** Everything that shows up in a reflection. */
export const REFLECT_LAYER = 3;
/** The sky alone — the cheap mode captures only this. */
export const SKY_LAYER = 4;

/** Adds `root` and its children to the reflected set. */
export function markReflective(root, skyOnly = false) {
  root.traverse((o) => {
    o.layers.enable(REFLECT_LAYER);
    if (skyOnly) o.layers.enable(SKY_LAYER);
  });
}

export const REFLECT_MODES = ['kapalı', 'gökyüzü', 'dinamik'];

export class Reflections {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;

    const mobile = QUALITY.tier === 'mobile';
    // 64 px a face. Larger probes were measured to break the environment
    // lighting outright on this stack — every lit surface in the scene turns
    // black — and there is nothing to gain from them anyway: the map is blurred
    // into a roughness chain before anything reads it, so the extra resolution
    // would be filtered straight back out.
    this.size = 64;
    this.mode = mobile ? 'gökyüzü' : 'dinamik';
    this.interval = mobile ? 1.2 : 0.34;

    this._timer = 1e9;          // force a capture on the first update
    this._lastHour = -99;
    this._lastX = 1e9;
    this._lastZ = 1e9;
    this._pending = false;

    this.cubeRT = new THREE.WebGLCubeRenderTarget(this.size, {
      type: THREE.HalfFloatType,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    });
    // The sky dome is 20 km across, so the far plane has to reach it. Depth
    // precision hardly matters when the result is blurred into a 128 px cube.
    this.cubeCam = new THREE.CubeCamera(1.5, 30000, this.cubeRT);
    this.cubeCam.layers.set(SKY_LAYER);
    scene.add(this.cubeCam);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileCubemapShader();
    this.target = null;

    // How much of the scene's light comes from the environment.
    //
    // The map is the procedural sky with the sun still in it, so its radiance
    // runs an order of magnitude above 1 — feeding that in whole would both
    // double-count the directional light and wash the city out. Measured
    // against the old hemisphere-lit look, 0.10 lifts the average frame by
    // about a tenth without clipping a single extra highlight: shadows fill
    // in, nothing blooms. Surfaces that are meant to act as mirrors undo this
    // with their own envMapIntensity.
    this.intensity = 0.10;
    scene.environmentIntensity = this.intensity;
  }

  /** @param {'kapalı'|'gökyüzü'|'dinamik'} mode */
  setMode(mode) {
    if (!REFLECT_MODES.includes(mode)) return;
    this.mode = mode;
    if (mode === 'kapalı') {
      this.scene.environment = null;
      return;
    }
    this.cubeCam.layers.set(mode === 'dinamik' ? REFLECT_LAYER : SKY_LAYER);
    this._timer = 1e9;
    this._lastHour = -99;
    if (this.target) this.scene.environment = this.target.texture;
  }

  setIntensity(v) {
    this.intensity = v;
    this.scene.environmentIntensity = v;
  }

  /**
   * @param {number} dt
   * @param {{x:number,y:number,z:number}} focus where the camera should sit
   * @param {number} hour used to notice that the sky has changed colour
   */
  update(dt, focus, hour) {
    if (this.mode === 'kapalı') return;
    this._timer += dt;

    const sky = this.mode === 'gökyüzü';
    // The sky alone only needs re-grabbing when the light has moved; a
    // dynamic capture also has to follow the car through the city.
    const moved = Math.hypot(focus.x - this._lastX, focus.z - this._lastZ);
    const stale = sky
      ? Math.abs(hour - this._lastHour) > 0.12
      : this._timer >= this.interval && (moved > 6 || this._timer >= this.interval * 6);
    if (!stale) return;

    this._timer = 0;
    this._lastHour = hour;
    this._lastX = focus.x;
    this._lastZ = focus.z;
    this.capture(focus);
  }

  /** Grabs the surroundings right now. */
  capture(focus) {
    // Up on the roofline: from down at the sill half the cube is tarmac.
    this.cubeCam.position.set(focus.x, focus.y + 1.6, focus.z);
    this.cubeCam.updateMatrixWorld(true);

    const renderer = this.renderer;
    const shadows = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;      // no shadow pass for a blurred cube
    this.cubeCam.update(renderer, this.scene);
    renderer.shadowMap.enabled = shadows;

    this.target = this.pmrem.fromCubemap(this.cubeRT.texture, this.target);
    this.scene.environment = this.target.texture;
    this.scene.environmentIntensity = this.intensity;
  }

  dispose() {
    this.cubeRT.dispose();
    this.target?.dispose();
    this.pmrem.dispose();
    this.scene.remove(this.cubeCam);
  }
}
