import * as THREE from 'three';
import './styles.css';

import { RoadNetwork } from './world/network.js';
import { Ground } from './world/ground.js';
import { TerrainChunks } from './world/terrainChunks.js';
import { buildRoads } from './world/roads.js';
import { buildBuildings } from './world/buildings.js';
import { buildProps } from './world/props.js';
import { buildLandmarks, buildTeleferik } from './world/landmarks.js';
import { Metro } from './world/metro.js';
import { ColliderGrid } from './world/colliders.js';
import { SkyEnv } from './world/skyEnv.js';
import { ZONES, SPAWN_POINTS, LANDMARKS, DISTRICT_GRIDS } from './world/mapData.js';

import { createPlayerCar } from './vehicles/carModel.js';
import { Vehicle } from './vehicles/vehicle.js';
import { Traffic } from './vehicles/traffic.js';
import { CARS } from './vehicles/catalog.js';

import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { CameraRig } from './cameraRig.js';
import { Hud } from './ui/hud.js';
import { MiniMap } from './ui/minimap.js';
import { MapPlan } from './ui/mapPlan.js';
import { MapView } from './ui/mapview.js';
import { Menu } from './ui/menu.js';
import { Settings } from './ui/settings.js';
import { clamp, damp, lerp } from './util/math.js';
import { installTouchGuards } from './util/touchGuards.js';
import { QUALITY, IS_TOUCH } from './quality.js';

// Showroom spot: on the ramp below Estergon Kalesi, castle in the backdrop.
const SHOWCASE = { x: 556, z: -184, yaw: -0.55 };

class Game {
  constructor() {
    this.state = 'loading';
    this.clockTime = 0;
    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._lensTimer = 0;
    this._showcaseAngle = 0;
    this._hornWas = false;
    this.waypoint = null;
    this.clockScale = 1;
    this.shakeScale = 1;
    this.useMph = false;
    this._ambientAcc = 0;

    installTouchGuards();

    this.canvas = document.getElementById('scene');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.4, 6000);

    window.addEventListener('resize', () => this._onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'driving') this.pause();
    });
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  // ------------------------------------------------------------------ boot
  async load() {
    const bar = document.getElementById('load-bar');
    const text = document.getElementById('load-text');
    const step = async (pct, label) => {
      bar.style.width = `${pct}%`;
      text.textContent = label;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    };

    await step(6, 'Ankara yol ağı çiziliyor…');
    this.network = new RoadNetwork().build();

    await step(20, 'Ankara ovası ve tepeleri şekilleniyor…');
    this.ground = new Ground(this.network);
    this.colliders = new ColliderGrid();
    this.scene.add(this.ground.buildBackdrop());
    this.terrain = new TerrainChunks(this.ground, this.scene);

    await step(34, 'Asfalt döşeniyor…');
    this.scene.add(buildRoads(this.network));

    this.world = {
      network: this.network,
      ground: this.ground,
      colliders: this.colliders
    };

    await step(46, 'Estergon Kalesi ve şehir hastanesi kuruluyor…');
    const landmarks = buildLandmarks(this.ground, this.colliders);
    this.scene.add(landmarks.group);
    this.landmarks = landmarks;

    await step(52, 'Teleferik hattı geriliyor…');
    this.teleferik = buildTeleferik(this.ground);
    this.scene.add(this.teleferik.group);

    await step(60, 'Metro hatları döşeniyor…');
    this.metro = new Metro(this.ground, this.colliders, this.network);
    this.scene.add(this.metro.group);

    await step(68, 'Apartmanlar dikiliyor…');
    const buildings = buildBuildings(this.network, this.ground, this.colliders);
    this.scene.add(buildings.group);
    this.buildings = buildings;

    await step(82, 'Ağaçlar, direkler ve lambalar…');
    const props = buildProps(this.network, this.ground, this.colliders);
    this.scene.add(props.group);
    this.props = props;

    await step(90, 'Trafik akıyor…');
    this.skyEnv = new SkyEnv(this.scene, this.renderer);
    this.effects = new Effects(this.scene);
    this.traffic = new Traffic(this.world, this.scene);
    this.scene.add(this.traffic.group);

    await step(96, 'Araçlar hazırlanıyor…');
    this.audio = new AudioEngine();
    this.input = new Input();
    this.input.bind(window);
    this.rig = new CameraRig(this.camera, this.canvas);
    this.hud = new Hud();
    this.plan = new MapPlan(this.network);
    this.minimap = new MiniMap(this.plan);
    this.mapView = new MapView(this.plan, this);

    this._setupPlayer(CARS[0], CARS[0].colours[0]);
    this._setupHeadlights();

    this.menu = new Menu({
      onSelect: (car, colour) => this._setupPlayer(car, colour, true),
      onColour: (colour) => this.playerCar.setColour(colour),
      onDrive: () => this.startDriving()
    });

    this.settings = new Settings(this);
    this.settings.applyAll();

    document.getElementById('btn-fullscreen').addEventListener('click', () => this.toggleFullscreen());
    document.getElementById('btn-settings').addEventListener('click', () => this.openSettings());
    document.getElementById('btn-pause-settings').addEventListener('click', () => this.openSettings());
    document.getElementById('btn-resume').addEventListener('click', () => this.resume());
    document.getElementById('btn-garage').addEventListener('click', () => this.toGarage());
    // pointerup, not click: the double-tap guard can swallow the synthetic
    // click that follows a fast tap, and the minimap is tapped in a hurry
    this.minimap.canvas.addEventListener('pointerup', () => this.openMap());

    await step(100, 'Hazır!');
    document.getElementById('loading').classList.add('hidden');
    this.toGarage(true);
  }

  // ---------------------------------------------------------------- player
  _setupPlayer(spec, colour, keepPlace = false) {
    const prev = this.vehicle;
    if (this.playerCar) {
      // detach the shared headlight rig first, or its geometry gets disposed
      // along with the old body and the beam comes back broken
      if (this.headlights) this.playerCar.group.remove(this.headlights);
      this.scene.remove(this.playerCar.group);
      this.playerCar.group.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m?.dispose());
      });
    }
    this.playerCar = createPlayerCar(spec, colour);
    this.scene.add(this.playerCar.group);
    if (this.headlights) this.playerCar.group.add(this.headlights);

    this.vehicle = new Vehicle(spec, this.world);
    if (keepPlace && prev) {
      this.vehicle.position.copy(prev.position);
      this.vehicle.yaw = prev.yaw;
      this.vehicle.position.y = this.ground.heightAt(prev.position.x, prev.position.z);
    } else {
      this._placeOnRoad(SHOWCASE.x, SHOWCASE.z, SHOWCASE.yaw);
    }
    this.effects?.clearSkids();
  }

  _setupHeadlights() {
    const rig = new THREE.Group();
    const beam = new THREE.SpotLight(0xfff0d0, 0, 90, 0.62, 0.45, 1.2);
    beam.position.set(0, 1.0, 1.6);
    beam.target.position.set(0, -0.4, 26);
    rig.add(beam, beam.target);

    // soft pool on the tarmac so the beam reads even where nothing is lit
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 26),
      new THREE.MeshBasicMaterial({
        color: 0xffe9bf, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
      })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.06, 12);
    rig.add(pool);

    this.headlights = rig;
    this.headlightBeam = beam;
    this.headlightPool = pool;
    this.headlightsManual = null;
    if (this.playerCar) this.playerCar.group.add(rig);
  }

  // -------------------------------------------------------------- waypoint
  setWaypoint(p) {
    this.waypoint = p ? { x: p.x, z: p.z } : null;
    const el = document.getElementById('waypoint');
    el.classList.toggle('hidden', !this.waypoint);
    if (this.waypoint) {
      this.hud.showToast('Hedef işaretlendi', 1.8);
      this.audio.blip(760, 0.1, 0.06);
    }
  }

  /**
   * Feeds the ambient bed with what is actually around the car: how built-up
   * the surroundings are, how much parkland, and whether it is dark.
   */
  _updateAmbient(dt) {
    this._ambientAcc += dt;
    if (this._ambientAcc < 0.35) {
      this.audio.updateAmbient(dt, this._ambientEnv || { builtUp: 0, green: 0, night: 0 });
      return;
    }
    this._ambientAcc = 0;

    const p = this.vehicle.position;
    let built = 0;
    for (const g of DISTRICT_GRIDS) {
      const dx = Math.abs(p.x - g.x) / (g.w * 0.5 + 500);
      const dz = Math.abs(p.z - g.z) / (g.h * 0.5 + 500);
      const d = Math.max(dx, dz);
      if (d < 1) built = Math.max(built, 1 - d * d);
    }
    let green = 0;
    for (const l of LANDMARKS) {
      if (!l.green) continue;
      const d = Math.hypot(p.x - l.x, p.z - l.z) / (l.radius * 2.2);
      if (d < 1) green = Math.max(green, 1 - d);
    }
    // open countryside counts as green too
    green = Math.max(green, (1 - built) * 0.55);

    this._ambientEnv = { builtUp: built, green, night: 1 - (this.skyEnv?.lightsOn ?? 0 ? 0 : 1) };
    this._ambientEnv.night = clamp(this.skyEnv?.lightsOn ?? 0, 0, 1);
    this.audio.updateAmbient(dt, this._ambientEnv);
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  }

  openSettings() {
    if (this.state === 'driving') this.pause();
    this.input?.releaseAll();
    this.settings.open();
  }

  settingsClosed() {
    this.input?.clearActions();
  }

  openMap() {
    if (this.state !== 'driving' && this.state !== 'paused') return;
    this._beforeMap = this.state;
    this.state = 'map';
    this.input.releaseAll();
    this.audio.horn(false);
    this._hornWas = false;
    this.mapView.show();
  }

  closeMap() {
    if (this.state !== 'map') return;
    this.mapView.close();
    this.state = this._beforeMap === 'paused' ? 'paused' : 'driving';
    this.input.clearActions();
  }

  // ----------------------------------------------------------------- states
  toGarage(initial = false) {
    this.state = 'garage';
    this.mapView?.close();
    this.input?.releaseAll();
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('touch').classList.add('hidden');
    document.getElementById('pause').classList.add('hidden');
    this.menu?.show();
    this._placeOnRoad(SHOWCASE.x, SHOWCASE.z, SHOWCASE.yaw);
    this._showcaseAngle = this.vehicle.yaw;
    if (initial) this.rig.snapTo(this.vehicle);
    this.audio.horn(false);
  }

  startDriving() {
    this.audio.start();
    this.audio.resume();
    this.menu.hide();
    document.getElementById('hud').classList.remove('hidden');
    if (this.input.hasTouch || IS_TOUCH) {
      document.getElementById('touch').classList.remove('hidden');
      // phones only give us the full viewport once we ask, and only from a tap
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      screen.orientation?.lock?.('landscape').catch(() => {});
    }
    this.state = 'driving';
    this.input.clearActions();

    // drop the car on the nearest road, pointing along it
    this._placeOnRoad(SHOWCASE.x, SHOWCASE.z, SHOWCASE.yaw);
    this.rig.setMode('chase');
    this.rig.snapTo(this.vehicle);
    this.hud.showToast(`${this.vehicle.spec.name} · Ankara'ya hoş geldin`, 3.2);
  }

  pause() {
    if (this.state !== 'driving') return;
    this.state = 'paused';
    document.getElementById('pause').classList.remove('hidden');
    document.getElementById('pause-stats').innerHTML = `
      <div><b>${(this.vehicle.distance / 1000).toFixed(2)} km</b>gidilen yol</div>
      <div><b>${Math.round(this.vehicle.topSpeedSeen)} km/s</b>en yüksek hız</div>
      <div><b>${this.skyEnv.clockText}</b>saat</div>
      <div><b>${this._districtName()}</b>konum</div>`;
    this.audio.horn(false);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'driving';
    document.getElementById('pause').classList.add('hidden');
    this.input.clearActions();
  }

  /** Drops the car in the right-hand lane of whichever road is closest. */
  _placeOnRoad(x, z, fallbackYaw) {
    const near = this.network.nearestRoad(x, z);
    if (!near) {
      this.vehicle.reset(x, z, fallbackYaw);
      return;
    }
    const edge = this.network.edges[near.edge];
    const s = clamp(near.s, 6, Math.max(6, edge.length - 6));
    const probe = this.network.pointAlong(edge, s, true);

    // keep whichever direction of travel is closest to the requested heading
    let dx = probe.dx;
    let dz = probe.dz;
    if (Math.sin(fallbackYaw) * dx + Math.cos(fallbackYaw) * dz < 0) {
      dx = -dx;
      dz = -dz;
    }
    const rx = -dz;              // right of travel
    const rz = dx;
    const lane = Math.min(edge.width * 0.25, edge.width * 0.5 - 1.6);
    this.vehicle.reset(probe.x + rx * lane, probe.z + rz * lane, Math.atan2(dx, dz));
    // dropping in somewhere new must not land the car on unbuilt terrain
    this.terrain?.preload(this.vehicle.position.x, this.vehicle.position.z);
  }

  _districtName() {
    let best = ZONES[0];
    let bestD = Infinity;
    for (const z of ZONES) {
      const d = (z.x - this.vehicle.position.x) ** 2 + (z.z - this.vehicle.position.z) ** 2;
      if (d < bestD) { bestD = d; best = z; }
    }
    // a landmark right next to you wins
    for (const l of LANDMARKS) {
      const d = Math.hypot(l.x - this.vehicle.position.x, l.z - this.vehicle.position.z);
      if (d < l.radius + 30) return l.name;
    }
    return best.name;
  }

  // ------------------------------------------------------------------ input
  _handleActions() {
    const input = this.input;

    if (input.consume('map')) {
      if (this.state === 'map') this.closeMap();
      else this.openMap();
    }
    if (input.consume('pause')) {
      if (this.state === 'map') this.closeMap();
      else if (this.state === 'driving') this.pause();
      else if (this.state === 'paused') this.resume();
    }
    if (input.consume('garage')) {
      if (this.state === 'map') this.closeMap();
      if (this.state === 'driving' || this.state === 'paused') this.toGarage();
      else if (this.state === 'garage') this.startDriving();
    }
    if (input.consume('camera')) {
      const m = this.rig.next();
      if (this.state === 'driving') this.hud.showToast(`Kamera: ${m.label}`, 1.4);
    }
    if (input.consume('time')) {
      this.skyEnv.advance(3);
      if (this.state === 'driving') this.hud.showToast(`Saat ${this.skyEnv.clockText}`, 1.6);
    }
    if (input.consume('lights')) {
      this.headlightsManual = this.headlightsManual === null
        ? this.skyEnv.lightsOn < 0.5
        : !this.headlightsManual;
      this.hud.showToast(this.headlightsManual ? 'Farlar açık' : 'Farlar kapalı', 1.4);
    }
    if (input.consume('mute')) {
      this.audio.setMuted(!this.audio.muted);
      this.hud.showToast(this.audio.muted ? 'Ses kapalı' : 'Ses açık', 1.4);
    }
    if (input.consume('fullscreen')) this.toggleFullscreen();
    if (input.consume('settings')) {
      this.settings.isOpen ? this.settings.close() : this.openSettings();
    }
    if (this.state !== 'driving') return;

    if (input.consume('respawn')) {
      this._placeOnRoad(this.vehicle.position.x, this.vehicle.position.z, this.vehicle.yaw);
      this.rig.snapTo(this.vehicle);
      this.hud.showToast('Araç yola alındı', 1.6);
    }
    if (input.consume('teleport')) {
      const p = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
      this._placeOnRoad(p.x, p.z, p.yaw);
      this.rig.snapTo(this.vehicle);
      this.effects.clearSkids();
      this.hud.showToast(`${p.name}'e ışınlandın`, 2.2);
      this.audio.blip(880, 0.12, 0.07);
    }
  }

  // ------------------------------------------------------------------- loop
  start() {
    let last = performance.now();
    const tick = (now) => {
      requestAnimationFrame(tick);
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1;
      if (dt <= 0) return;

      this._fpsAcc += dt;
      this._fpsFrames++;
      if (this._fpsAcc > 0.5) {
        this.fps = Math.round(this._fpsFrames / this._fpsAcc);
        this._fpsAcc = 0;
        this._fpsFrames = 0;
      }

      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(tick);
  }

  update(dt) {
    const input = this.input.update(dt);
    this._handleActions();

    const driving = this.state === 'driving';
    const paused = this.state === 'paused' || this.state === 'map';

    // ---- vehicle -------------------------------------------------------
    if (driving) {
      const prevImpact = this.vehicle.impact;
      this.vehicle.update(dt, input);
      if (this.vehicle.impact > prevImpact + 0.05) {
        this.audio.thud(this.vehicle.impact);
        this.rig.addShake(this.vehicle.impact * 0.9 * this.shakeScale);
      }
      this.clockTime += dt;
      this.terrain.update(this.vehicle.position.x, this.vehicle.position.z, 6);
    } else if (!paused) {
      // slowly rotate the showcase car in the garage
      this._showcaseAngle += dt * 0.22;
      this.vehicle.yaw = this._showcaseAngle;
      this.vehicle.position.y = damp(
        this.vehicle.position.y,
        this.ground.heightAt(this.vehicle.position.x, this.vehicle.position.z),
        8, dt
      );
      this.vehicle.wheelSpin = 0;
      this.vehicle.steer = 0;
      this.clockTime += dt;
    }
    this.vehicle.applyTo(this.playerCar);

    // ---- world ---------------------------------------------------------
    if (!paused) {
      this.network.updateLights(this.clockTime);
      this.traffic.update(dt, this.vehicle);
      this.teleferik.update(dt);
      this.metro.update(dt, this.vehicle.position);
      this.props.pedestrians.update(dt, this.clockTime, this.vehicle.position);
      this.effects.update(dt);
      this._emitTyreEffects(dt);
      this.skyEnv.update(dt * this.clockScale, this.vehicle.position);
      this._updateNight(dt);
      this._updateSignalLenses(dt);
      this._updateFlags();
    }

    // ---- camera --------------------------------------------------------
    if (this.state === 'garage') {
      // Slow turntable. The aim point sits below the car so it frames up in
      // the top half of the screen, clear of the info card.
      const t = this.clockTime * 0.15 + 2.2;
      const r = 4.6 + this.vehicle.spec.length * 0.72;
      this.camera.position.set(
        this.vehicle.position.x + Math.sin(t) * r,
        this.vehicle.position.y + 2.9 + Math.sin(t * 0.6) * 0.3,
        this.vehicle.position.z + Math.cos(t) * r
      );
      // aim just under the car so it frames up clear of the info card
      this.camera.lookAt(
        this.vehicle.position.x,
        this.vehicle.position.y - 0.30,
        this.vehicle.position.z
      );
      this.camera.fov = 40;
      this.camera.updateProjectionMatrix();
    } else if (!paused) {
      this.rig.update(dt, this.vehicle, this.ground);
    }

    // ---- audio ---------------------------------------------------------
    if (driving) {
      this.audio.update(this.vehicle, input, dt);
      this._updateAmbient(dt);
      if (input.horn !== this._hornWas) {
        this.audio.horn(input.horn);
        this._hornWas = input.horn;
      }
    } else if (this._hornWas) {
      this.audio.horn(false);
      this._hornWas = false;
    }

    // ---- ui ------------------------------------------------------------
    if (driving || paused) {
      const district = this._districtName();
      this.hud.setDistrict(district);
      this.hud.update(dt, this.vehicle, { clock: this.skyEnv.clockText, fps: this.fps });
      this.minimap.draw(this.vehicle, this.traffic, district, this.waypoint);
      this._updateWaypointHud();
    }
  }

  /** Bearing and distance to the marked destination. */
  _updateWaypointHud() {
    if (!this.waypoint) return;
    const v = this.vehicle;
    const dx = this.waypoint.x - v.position.x;
    const dz = this.waypoint.z - v.position.z;
    const dist = Math.hypot(dx, dz);

    // arrive: clear the marker once you are on top of it
    if (dist < 22) {
      this.setWaypoint(null);
      this.hud.showToast('Hedefe vardın', 2.2);
      this.audio.blip(980, 0.16, 0.08);
      return;
    }

    const sinY = Math.sin(v.yaw);
    const cosY = Math.cos(v.yaw);
    const fwd = dx * sinY + dz * cosY;
    const right = -dx * cosY + dz * sinY;
    const deg = (Math.atan2(right, fwd) * 180) / Math.PI;

    const arrow = document.querySelector('#waypoint svg');
    if (arrow) arrow.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    const label = document.getElementById('wp-dist');
    if (label) {
      label.textContent = dist >= 1000
        ? `${(dist / 1000).toFixed(2)} km`
        : `${Math.round(dist)} m`;
    }
  }

  /** Rubber and smoke from the driven wheels. */
  _emitTyreEffects(dt) {
    if (this.state !== 'driving') return;
    const v = this.vehicle;
    const spec = v.spec;
    const slip = v.slip;
    const speed = v.speed;
    if (slip < 0.16 || speed < 2.5) return;

    const sinY = Math.sin(v.yaw);
    const cosY = Math.cos(v.yaw);
    const rear = -spec.wheelBase / 2;
    const track = spec.width / 2 - spec.wheelWidth * 0.55;

    for (const sx of [-1, 1]) {
      const lx = sx * track;
      const x = v.position.x + cosY * lx + sinY * rear;
      const z = v.position.z - sinY * lx + cosY * rear;
      const y = this.ground.heightAt(x, z);

      if (v.onRoad) {
        this.effects.addSkid(
          `r${sx}`, x, y, z, sinY, cosY, spec.wheelWidth * 1.5, clamp(slip * 1.3, 0, 1)
        );
      }

      if (Math.random() < clamp(slip, 0, 1) * dt * 42) {
        const tint = v.onRoad ? [0.85, 0.85, 0.84] : [0.72, 0.64, 0.46];
        this.effects.emitSmoke(
          x + (Math.random() - 0.5) * 0.5,
          y + 0.25,
          z + (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 2 - v.velocity.x * 0.08,
          0.5 + Math.random() * 0.7,
          (Math.random() - 0.5) * 2 - v.velocity.z * 0.08,
          0.6 + Math.random() * 0.5,
          0.9 + Math.random() * 0.7,
          tint
        );
      }
    }
  }

  /** Everything that switches on after dark. */
  _updateNight(dt) {
    const night = this.skyEnv.lightsOn;
    const on = this.headlightsManual === null ? night > 0.5 : this.headlightsManual;

    // window lights
    for (const mat of this.buildings.nightMaterials) {
      mat.emissive.setScalar(night * 0.95);
      mat.emissiveIntensity = 1.15;
    }
    // street lamps and the pools of light they throw
    this.props.lampMaterial.emissiveIntensity = night * 2.6;
    this.props.lampPoolMaterial.opacity = night * 0.34;
    this.props.lampPoolMaterial.visible = night > 0.02;
    // landmark uplighting
    if (this.landmarks.glowMesh) {
      this.landmarks.glowMesh.material.emissiveIntensity = 0.25 + night * 1.1;
    }
    // traffic lights and other cars
    this.traffic.setNight(night > 0.4);

    // player lights
    const beamTarget = on ? 26 : 0;
    this.headlightBeam.intensity = damp(this.headlightBeam.intensity, beamTarget, 6, dt);
    this.headlightBeam.visible = this.headlightBeam.intensity > 0.05;
    this.headlightPool.material.opacity = damp(
      this.headlightPool.material.opacity, on ? 0.10 * night + 0.02 : 0, 6, dt
    );
    this.playerCar.headMat.color.setScalar(on ? 1 : 0.33);

    const braking = this.input.state.brake > 0.05 && this.vehicle.forwardSpeed > 0.4;
    const tail = braking ? 1 : (on ? 0.55 : 0.22);
    this.playerCar.tailMat.color.setRGB(tail, tail * 0.14, tail * 0.11);
    this.playerCar.signMat.color.setScalar(lerp(0.42, 1, night));
  }

  _updateSignalLenses(dt) {
    this._lensTimer -= dt;
    if (this._lensTimer > 0) return;
    this._lensTimer = 0.12;

    const mesh = this.props.lensMesh;
    const list = this.props.signalLenses;
    if (!mesh || !list.length) return;
    const c = new THREE.Color();
    const OFF = 0.055;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const state = s.light.state[s.group];
      let hex = 0x000000;
      if (s.lens === 0) hex = state === 'red' ? 0xff2b1a : 0x2a0a08;
      else if (s.lens === 1) hex = state === 'yellow' ? 0xffc21a : 0x2a2008;
      else hex = state === 'green' ? 0x2bff6a : 0x082a12;
      c.setHex(hex);
      if (state !== 'red' && s.lens === 0) c.multiplyScalar(OFF * 6);
      mesh.setColorAt(i, c);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  _updateFlags() {
    const t = this.clockTime;
    for (const flag of this.landmarks.flagMeshes) {
      const pos = flag.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const wave = Math.sin(t * 3.2 + x * 1.6) * 0.16 * ((x + 1.8) / 3.6);
        pos.setZ(i, wave + Math.sin(t * 2.1 + y * 2.2) * 0.05 * ((x + 1.8) / 3.6));
      }
      pos.needsUpdate = true;
      flag.geometry.computeVertexNormals();
    }
  }
}

const game = new Game();
game.load().then(() => game.start());

// expose for quick tinkering in the console
window.kecioren = game;
