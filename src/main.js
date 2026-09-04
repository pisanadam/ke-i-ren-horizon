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
import { buildRamps } from './world/ramps.js';
import { ColliderGrid } from './world/colliders.js';
import { SkyEnv } from './world/skyEnv.js';
import { Reflections, markReflective } from './world/reflections.js';
import { RigidWorld } from './world/rigid.js';
import { Breakables } from './world/breakables.js';
import { TileWorld } from './world/tiles.js';
import { ZONES, SPAWN_POINTS, LANDMARKS, DISTRICT_GRIDS } from './world/mapData.js';
import { findRoute, TURN_LABEL, TURN_ARROW } from './world/route.js';
import {
  RaceGates, RaceSession, prepareAll, loadBests, saveBest,
  medalFor, formatTime, formatDelta, MEDAL
} from './race.js';

import { createPlayerCar, sillHeight } from './vehicles/carModel.js';
import { Vehicle } from './vehicles/vehicle.js';
import { BodyDamage, scatterWreck } from './vehicles/damage.js';
import { Traffic } from './vehicles/traffic.js';
import { OnFoot } from './vehicles/onFoot.js';
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
import { Coop } from './net/coop.js';
import { RtcTransport } from './net/rtc.js';
import { clamp, damp, lerp } from './util/math.js';
import { installTouchGuards } from './util/touchGuards.js';
import { QUALITY, IS_TOUCH } from './quality.js';

// Showroom spot: on the ramp below Estergon Kalesi, castle in the backdrop.
const SHOWCASE = { x: 556, z: -184, yaw: -0.55 };

/** How fast you have to be going, in m/s, to take each thing out. */
const NEED_SPEED = { lamba: 5, agac: 7, park: 8, bina: 22 };
/** What is left of your speed once you have. */
const TOLL = { lamba: 0.94, agac: 0.86, park: 0.76, bina: 0.42 };
/** And what it costs your own bodywork, as a share of the speed you hit it at. */
const DENT_TOLL = { lamba: 0.42, agac: 0.55, park: 0.62, bina: 0.38 };
/** How long the wreck lies there before you are given a car back. */
const WRECK_TIME = 3.6;
/** What a wreck asks of the physics: nothing, with the brakes on. */
const DEAD_INPUT = { steer: 0, throttle: 0, brake: 1, handbrake: true };

/**
 * How far each layer of the city is worth drawing, as a share of the view
 * distance.
 *
 * Measured: the roof clutter alone was 385k triangles a frame — more than the
 * facades under it — because water tanks two kilometres away were being drawn
 * at full detail to occupy a pixel. Silhouette (facades, roofs, tarmac, tree
 * canopies) keeps the full horizon; the small stuff stops where it stops
 * being resolvable.
 */
const LAYER_RANGE = {
  'roof-details': 0.30,
  'lamp-pools': 0.26,
  // Pairs that belong together get the same reach, or you get the half of one
  // that is left: a lamp head floating where its pole stopped, a canopy over
  // no trunk, a signal lens beside no signal.
  'lamp-heads': 0.40,
  poles: 0.40,
  'signal-lenses': 0.34,
  furniture: 0.34,
  'tree-trunks': 0.60,
  'tree-canopies': 0.60,
  'parked-cars': 0.40,
  markings: 0.42,
  kerb: 0.50,
  pavement: 0.62,
  shops: 0.85
};

/**
 * Layers with no business in the shadow map. Both of these are lit decals —
 * the pool of light a lamp throws on the tarmac and the lens of a signal —
 * so casting a shadow from them is not a saving, it is a bug waiting.
 * Trees are not on this list: their shadows are the ones you actually notice.
 */
const NO_SHADOW_LAYERS = new Set(['lamp-pools', 'signal-lenses']);

class Game {
  constructor() {
    this.state = 'loading';
    this.clockTime = 0;
    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._msUpdate = 0;
    this._msDraw = 0;
    this.msUpdate = 0;
    this.msDraw = 0;
    this._lensTimer = 0;
    this._showcaseAngle = 0;
    this._hornWas = false;
    this.waypoint = null;
    this.clockScale = 1;
    this.shakeScale = 1;
    this.useMph = false;
    this.canWreck = true;
    this.race = null;          // the attempt in progress, if any
    this.racePlan = null;      // every race this map can hold, prepared once
    this.raceBests = loadBests();
    this._raceResultT = 0;
    this._raceGoHide = 0;
    this._ambientAcc = 0;
    /**
     * Dynamic resolution.
     *
     * Every other optimisation makes the frame cheaper by a fixed amount and
     * then hopes it was enough; this one aims at a frame rate and holds it.
     * The scene is drawn into a smaller buffer and scaled up when the machine
     * cannot keep up, and the buffer grows back the moment it can — which is
     * the only way to promise a frame rate without knowing what it is running
     * on. Held between 60% and 100% of the chosen resolution: below that the
     * softness costs more than the frames are worth.
     */
    this.fpsTarget = 60;
    this._resAuto = 1;
    this._resHold = 0;
    this._frameAvg = 1 / 60;
    // How long the world streamer may spend building ground each frame.
    // More cores means more headroom for it without costing frame rate.
    this.streamBudget = Math.max(3, Math.min(10, (navigator.hardwareConcurrency || 4)));

    installTouchGuards();

    this.canvas = document.getElementById('scene');
    // Multisampling is fixed when the context is made, so unlike everything
    // else in the settings it has to be read before there is a Settings to
    // read it from.
    let aa = true;
    try {
      const saved = JSON.parse(localStorage.getItem('ankara-surus-ayarlar') || '{}');
      if (saved.antialias === 0) aa = false;
    } catch { /* bozuk kayıt kenarları yumuşak bıraksın */ }
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: aa,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap is deprecated in this version of three and silently
    // falls back to PCF anyway, so ask for PCF and get the softening from a
    // stable, texel-snapped shadow camera instead (see world/skyEnv.js).
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
    this.backdrop = this.ground.buildBackdrop();
    this.scene.add(this.backdrop);
    this.terrain = new TerrainChunks(this.ground, this.scene);

    await step(34, 'Asfalt döşeniyor…');
    this.roadGroup = buildRoads(this.network);
    this.scene.add(this.roadGroup);

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

    this.scene.add(buildRamps(this.ground, this.colliders));

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

    // Loose objects: everything that gets knocked down lands in here.
    this.rigid = new RigidWorld(this.ground, this.scene);
    this.breakables = new Breakables(this.rigid);
    for (const b of props.breakables) this.breakables.add(b);
    for (const b of buildings.breakables) this.breakables.add(b);
    // With a wall missing you look straight through the shell, so the facades
    // stop culling their back faces the first time one is opened up.
    this.breakables.onOpened = () => {
      if (this._facadesOpen) return;
      this._facadesOpen = true;
      for (const m of buildings.materials || []) {
        m.side = THREE.DoubleSide;
        m.needsUpdate = true;
      }
    };
    this.breakables.onBreak = (item, blow) => {
      const hard = Math.min(1, (blow?.speed ?? 8) / 28);
      // one crash a frame however many things went down at once, or ploughing
      // into a row of parked cars fires a dozen overlapping sounds
      this._crash = Math.max(this._crash ?? 0, hard);
      this._crashKind = item.kind;
      this.rig?.addShake(Math.min(0.7, hard) * this.shakeScale);

      // dust: masonry throws up a cloud, a lamp post barely anything
      const dust = { bina: 44, park: 12, agac: 16, lamba: 6 }[item.kind] ?? 8;
      this.effects?.burst(
        blow?.x ?? item.x,
        (blow?.y ?? item.y) + 0.8,
        blow?.z ?? item.z,
        Math.round(dust * (0.5 + hard)),
        {
          vx: blow?.vx ?? 0,
          vz: blow?.vz ?? 0,
          spread: item.kind === 'bina' ? 3.4 : 1.8,
          lift: item.kind === 'bina' ? 4.5 : 2.4,
          size: item.kind === 'bina' ? 2.2 : 1.3,
          life: item.kind === 'bina' ? 2.2 : 1.2,
          tint: item.kind === 'agac' ? [0.42, 0.55, 0.3] : [0.76, 0.73, 0.68]
        }
      );
    };

    await step(90, 'Trafik akıyor…');
    this.skyEnv = new SkyEnv(this.scene, this.renderer);
    this.effects = new Effects(this.scene);
    this.traffic = new Traffic(this.world, this.scene);
    this.traffic.rigid = this.rigid;
    this.scene.add(this.traffic.group);

    // ---- what a car sees when it looks around itself ---------------------
    // Only the big, still things go into the reflection probe. Trees, street
    // furniture, traffic and the player's own car are left out: six extra
    // renders of the whole city would cost more than the reflection is worth,
    // and a car that reflects itself looks wrong anyway.
    this.reflections = new Reflections(this.renderer, this.scene);
    markReflective(this.skyEnv.sky, true);
    markReflective(this.skyEnv.stars, true);
    markReflective(this.skyEnv.moon, true);
    markReflective(this.backdrop);
    markReflective(this.roadGroup);
    markReflective(this.terrain.group);
    markReflective(buildings.group);
    markReflective(landmarks.group);
    this.terrain.onChunk = (mesh) => markReflective(mesh);

    // Everything static is merged one tile at a time rather than into a
    // handful of map-sized meshes, so the renderer can throw away what is
    // behind you and the view-distance setting can switch off the rest.
    this.tiles = new TileWorld();
    // The sun's shadow box is a square around the car; anything whose bounding
    // sphere cannot reach into it has nothing to cast and no reason to be
    // drawn a second time. The diagonal is what has to be cleared, not the side.
    this.tiles.shadowDistance = (this.skyEnv?.shadowExtent ?? QUALITY.shadowExtent) * 1.45;
    for (const set of this.roadGroup.userData.tileSets || []) {
      this.tiles.add(set, { range: LAYER_RANGE[set.group.name] ?? 1, casts: false });
    }
    for (const set of buildings.tileSets || []) {
      this.tiles.add(set, { range: LAYER_RANGE[set.group.name] ?? 1 });
    }
    for (const set of this.metro.tileSets || []) {
      this.tiles.add(set, { range: LAYER_RANGE[set.group.name] ?? 1 });
    }
    for (const set of props.tileSets || []) {
      this.tiles.add(set, {
        range: LAYER_RANGE[set.group.name] ?? 1,
        casts: !NO_SHADOW_LAYERS.has(set.group.name)
      });
    }

    await step(96, 'Araçlar hazırlanıyor…');
    this.audio = new AudioEngine();
    this.input = new Input();
    this.input.bind(window);
    this.rig = new CameraRig(this.camera, this.canvas);
    this.hud = new Hud();
    this.plan = new MapPlan(this.network);
    this.minimap = new MiniMap(this.plan);
    this.mapView = new MapView(this.plan, this);

    // the player character: Ankara's own, and the one you step out as
    this.onFoot = new OnFoot(this.world, {
      skin: 0x6b4227, hair: 0x140f0c, shirt: 0x2b3f5c,
      trousers: 0x24262b, shoes: 0x131417, build: 1.22
    });
    this.scene.add(this.onFoot.group);

    this._setupPlayer(CARS[0], CARS[0].colours[0]);
    this._setupHeadlights();

    this.menu = new Menu({
      onSelect: () => this._setupPlayer(this.menu.spec, this.menu.colour, true),
      onColour: (colour) => this.playerCar.setColour(colour),
      getSpec: () => this.menu.spec,
      onDrive: () => this.startDriving()
    });

    this._setupPlayer(this.menu.spec, this.menu.colour, false);

    this.settings = new Settings(this);
    this.settings.applyAll();
    this.coop = new Coop(this);
    this._bindCoop();
    this.raceGates = new RaceGates(this.scene);
    this._bindRaces();

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
    this.audio?.setVehicle(spec);
    this.playerCar = createPlayerCar(spec, colour);
    this.scene.add(this.playerCar.group);
    // the panels remember the shape they were built with, so they can be bent
    this.bodyDamage = new BodyDamage(this.playerCar);
    this._wreckTimer = 0;

    this.vehicle = new Vehicle(spec, this.world);
    // what happens when the car meets something that can be knocked down
    this.vehicle.onFrail = (box, speed, dx, dz, px, pz) => {
      if (!box.brk || !this.breakables) return false;
      const item = box.brk;
      // What it takes to go through, and what it costs you. A lamp column is
      // barely there; a wall is a wall, and needs a proper run at it.
      const need = NEED_SPEED[item.kind] ?? 5;
      if (speed < need) return false;
      if (!this.breakables.smash(item, {
        speed, vx: dx * speed, vz: dz * speed, x: px, z: pz
      })) return false;
      this.vehicle.velocity.multiplyScalar(TOLL[item.kind] ?? 0.9);
      this.vehicle.impact = Math.max(this.vehicle.impact, Math.min(1, speed / 22));
      // It gave way, so it costs the car less than a wall would — but a
      // column through the front of the bonnet still leaves the front of the
      // bonnet somewhere else.
      this.vehicle.addDent(px, pz, -dx, -dz, speed * (DENT_TOLL[item.kind] ?? 0.5));
      return true;
    };
    if (keepPlace && prev) {
      this.vehicle.position.copy(prev.position);
      this.vehicle.yaw = prev.yaw;
      this.vehicle.position.y = this.ground.heightAt(prev.position.x, prev.position.z);
    } else {
      this._placeOnRoad(SHOWCASE.x, SHOWCASE.z, SHOWCASE.yaw);
    }
    this.effects?.clearSkids();
    // the lamps sit at this car's corners, so the rig is rebuilt with it
    if (this.headlights) {
      this.headlights.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m?.dispose());
      });
      const manual = this.headlightsManual;
      const main = this.mainBeam;
      this._setupHeadlights();
      this.headlightsManual = manual;
      this.mainBeam = main;
    }
  }

  /**
   * Headlights.
   *
   * One spotlight aimed down the middle was the old rig, which lit the road
   * as an even wash with no shape to it. A real pair throws two overlapping
   * cones from where the lamps actually are, with a dipped beam that stops
   * short and a main beam that reaches; the glow cones and the pool of light
   * on the tarmac are what sell it in the dark, since the scene has no
   * volumetric lighting to do it for free.
   */
  _setupHeadlights() {
    const rig = new THREE.Group();
    const spec = this.vehicle?.spec ?? CARS[0];
    const half = spec.width * 0.34;
    const lampY = sillHeight(spec) + spec.bodyHeight * 0.55;
    const lampZ = spec.length * 0.5 - 0.06;

    this.headBeams = [];
    this.headCones = [];

    for (const side of [-1, 1]) {
      const beam = new THREE.SpotLight(0xfff2d8, 0, 120, 0.44, 0.55, 1.4);
      beam.position.set(side * half, lampY, lampZ);
      // aimed down and slightly outboard, like a dipped beam
      beam.target.position.set(side * half * 3.4, -1.1, lampZ + 30);
      rig.add(beam, beam.target);
      this.headBeams.push(beam);

      // the visible shaft of light, only worth drawing after dark
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(1, 1, 18, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xffeec8, transparent: true, opacity: 0, depthWrite: false,
          // Additive *and* fogged renders the fog colour into the shape, which
          // turns an invisible glow into a solid grey wedge after dark.
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false
        })
      );
      // apex at the lamp, opening away from the car — the other way round
      // puts the wide end on the bonnet and the beam points backwards
      cone.rotation.x = -Math.PI / 2;
      cone.scale.set(2.2, 22, 2.2);
      cone.position.set(side * half, lampY - 0.18, lampZ + 11);
      cone.renderOrder = 3;
      rig.add(cone);
      this.headCones.push(cone);
    }

    // Pool on the tarmac. Shaped like a beam pattern — narrow at the car,
    // spreading out and fading at the cut-off — instead of a plain rectangle.
    const poolGeo = new THREE.PlaneGeometry(1, 1, 12, 18);
    const pp = poolGeo.attributes.position;
    const alpha = new Float32Array(pp.count);
    for (let i = 0; i < pp.count; i++) {
      const u = pp.getX(i) + 0.5;        // 0..1 across
      const v = pp.getY(i) + 0.5;        // 0..1 along
      const spread = 0.35 + v * 0.65;
      pp.setX(i, (u - 0.5) * spread);
      // bright just ahead of the bumper, fading out at the cut-off
      const along = Math.sin(Math.min(1, v * 1.15) * Math.PI) ** 0.8;
      const across = 1 - Math.pow(Math.abs((u - 0.5) * 2), 2.2);
      alpha[i] = Math.max(0, along * across);
    }
    poolGeo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    poolGeo.rotateX(-Math.PI / 2);

    const poolMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uColour: { value: new THREE.Color(0xffe9bf) } },
      vertexShader: `
        attribute float aAlpha;
        varying float vA;
        void main() {
          vA = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uOpacity;
        uniform vec3 uColour;
        varying float vA;
        void main() {
          gl_FragColor = vec4(uColour, vA * uOpacity);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.scale.set(spec.width * 4.4, 1, 26);
    pool.position.set(0, 0.05, 13);
    pool.renderOrder = 2;
    rig.add(pool);

    this.headlights = rig;
    this.headlightPool = pool;
    this.headlightsManual = null;
    this.mainBeam = false;
    if (this.playerCar) this.playerCar.group.add(rig);
  }

  // -------------------------------------------------------------- waypoint
  setWaypoint(p) {
    this.waypoint = p ? { x: p.x, z: p.z } : null;
    this._buildRoute();
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

  // ------------------------------------------------------------- on foot
  /**
   * The E key. What it does depends on where you are standing: get out of
   * the car, get back in, board a waiting train, or step off one.
   */
  _interact() {
    if (this.state === 'driving') {
      if (this.vehicle.dead) {
        this.hud.showToast('Araç hurda · R ile yenisini al', 1.6);
        return;
      }
      if (Math.abs(this.vehicle.speedKmh) > 6) {
        this.hud.showToast('Önce dur', 1.2);
        return;
      }
      this._exitCar();
      return;
    }
    if (this.state !== 'foot') return;

    if (this.onFoot.riding) {
      this.onFoot.alight(this.metro);
      this.hud.showToast('Metrodan indin', 1.8);
      this.rig.snapToActor(this.onFoot);
      return;
    }
    const platform = this.onFoot.nearestPlatform(this.metro);
    const train = this.onFoot.trainAt(this.metro, platform);
    if (train) {
      this.onFoot.board(train);
      this.hud.showToast(`${train.line.id} hattına bindin`, 2.4);
      this.audio.blip(720, 0.12, 0.06);
      return;
    }
    if (this.onFoot.nearestCar(this.vehicle)) {
      this._enterCar();
      return;
    }
    if (platform) this.hud.showToast('Tren bekleniyor…', 1.6);
  }

  _exitCar() {
    this.abortRace('Yarış bitti · araçtan indin');
    this.state = 'foot';
    this.input.releaseAll();
    this.onFoot.exit(this.vehicle);
    this.rig.snapToActor(this.onFoot);
    this.audio.horn(false);
    this._hornWas = false;
    this.hud.showToast('Araçtan indin · E ile bin', 2.6);
  }

  _enterCar() {
    this.state = 'driving';
    this.onFoot.active = false;
    this.onFoot.riding = null;
    this.onFoot.group.visible = false;
    this.input.releaseAll();
    this.rig.snapTo(this.vehicle);
    this.hud.showToast('Araca bindin', 1.6);
  }

  /** The little "press E to…" line under the HUD. */
  _updatePrompt() {
    const el = document.getElementById('prompt');
    if (!el) return;
    let text = '';
    if (this.state === 'driving' && Math.abs(this.vehicle.speedKmh) < 6) {
      text = 'E — araçtan in';
    } else if (this.state === 'foot') {
      if (this.onFoot.riding) text = 'E — metrodan in';
      else if (this.onFoot.nearestCar(this.vehicle)) text = 'E — araca bin';
      else {
        const platform = this.onFoot.nearestPlatform(this.metro);
        if (platform) {
          text = this.onFoot.trainAt(this.metro, platform)
            ? 'E — metroya bin'
            : `${platform.stop.name} · tren bekleniyor`;
        }
      }
    }
    el.textContent = text;
    el.classList.toggle('hidden', !text);
  }

  /** Recomputes the suggested route from wherever the player is now. */
  _buildRoute() {
    if (!this.waypoint) {
      this.route = null;
      this._routeLeg = 0;
      return;
    }
    const p = this.state === 'foot' ? this.onFoot.position : this.vehicle.position;
    this.route = findRoute(this.network, p.x, p.z, this.waypoint.x, this.waypoint.z);
    this._routeLeg = 0;
    this._routeAge = 0;
  }

  /**
   * The turn banner. Shows the distance to the next manoeuvre and what it is,
   * and steps through the legs as they are passed.
   */
  _updateNav(dt) {
    const el = document.getElementById('nav');
    if (!el) return;
    if (!this.route || !this.waypoint) {
      el.classList.add('hidden');
      return;
    }
    const p = this.state === 'foot' ? this.onFoot.position : this.vehicle.position;

    // step past any leg we have already reached
    while (this._routeLeg < this.route.legs.length - 1) {
      const leg = this.route.legs[this._routeLeg];
      if (Math.hypot(leg.x - p.x, leg.z - p.z) > 26) break;
      this._routeLeg++;
    }
    const leg = this.route.legs[this._routeLeg];
    const d = Math.hypot(leg.x - p.x, leg.z - p.z);

    // if the player has wandered well off the line, plan again
    this._routeAge = (this._routeAge ?? 0) + dt;
    if (this._routeAge > 2.5) {
      this._routeAge = 0;
      let best = Infinity;
      for (const q of this.route.points) {
        best = Math.min(best, (q.x - p.x) ** 2 + (q.z - p.z) ** 2);
      }
      if (best > 90 * 90) this._buildRoute();
    }

    el.classList.remove('hidden');
    document.getElementById('nav-arrow').textContent = TURN_ARROW[leg.turn] ?? '↑';
    document.getElementById('nav-dist').textContent =
      d > 950 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 10) * 10} m`;
    document.getElementById('nav-step').textContent =
      leg.name ? `${TURN_LABEL[leg.turn]} · ${leg.name}` : TURN_LABEL[leg.turn];
  }

  /**
   * Back-face culling.
   *
   * Three.js already culls back faces by default, but a handful of surfaces
   * are deliberately double-sided — the embankments, the ramp skirts, the
   * headlight cones — because they are open shells you can end up behind.
   * "Agresif" forces even those to a single side, which halves their
   * fragment cost at the price of the odd surface vanishing from behind.
   */
  setCulling(level) {
    if (this._cullLevel === level) return;
    this._cullLevel = level;
    const seen = new Set();
    this.scene.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || seen.has(m)) continue;
        seen.add(m);
        if (m.userData.baseSide === undefined) m.userData.baseSide = m.side;
        if (level === 0) m.side = THREE.DoubleSide;
        else if (level >= 2) m.side = THREE.FrontSide;
        else m.side = m.userData.baseSide;
        m.needsUpdate = true;
      }
    });
  }

  // ---------------------------------------------------------------- co-op
  _bindCoop() {
    const el = document.getElementById('coop');
    const input = document.getElementById('coop-input');
    const nameEl = document.getElementById('coop-name');
    const status = document.getElementById('coop-status');
    const list = document.getElementById('coop-list');

    document.getElementById('coop-hint').textContent =
      'İkiniz de aynı 6 haneli kodu yazıp BAĞLAN deyin. Kimin oda kuracağını ' +
      'oyun kendi seçer; bağlantı doğrudan cihazlar arasında kurulur.';
    nameEl.value = localStorage.getItem('ankara-coop-ad') || '';
    input.value = localStorage.getItem('ankara-coop-oda') || '';

    const refresh = () => {
      status.textContent = this.coop.active
        ? `Bağlı · ${this.coop.count} oyuncu · oda ${this.coop.room}`
        : this.coop.status;
      list.innerHTML = '';
      for (const p of this.coop.peers.values()) {
        const li = document.createElement('li');
        li.textContent = p.name;
        list.appendChild(li);
      }
      const badge = document.getElementById('coop-badge');
      if (badge) {
        badge.classList.toggle('on', this.coop.active);
        badge.textContent = `👥 ${this.coop.count}`;
      }
    };
    this.coop.onChange = refresh;

    document.getElementById('btn-coop').addEventListener('click', () => {
      if (this.state === 'driving') this.pause();
      this.input?.releaseAll();
      el.classList.remove('hidden');
      refresh();
    });
    document.getElementById('coop-close').addEventListener('click', () => {
      el.classList.add('hidden');
      this.input?.clearActions();
    });
    document.getElementById('coop-new').addEventListener('click', () => {
      input.value = String(Math.floor(100000 + Math.random() * 900000));
    });
    document.getElementById('coop-leave').addEventListener('click', () => {
      this.coop.leave();
      this.hud.showToast('Co-op kapatıldı', 1.6);
    });
    // One button, because there is no longer a wrong one to press: both
    // players type the same code and the room sorts out who hosts it.
    document.getElementById('coop-join').addEventListener('click', () => {
      let code = input.value.replace(/\D/g, '');
      if (code.length !== 6) {
        code = String(Math.floor(100000 + Math.random() * 900000));
        input.value = code;
        this.hud.showToast(`Kod üretildi: ${code} · arkadaşına söyle`, 3.4);
      }
      localStorage.setItem('ankara-coop-oda', code);
      localStorage.setItem('ankara-coop-ad', nameEl.value);
      if (!this.coop.join(code, nameEl.value || 'Oyuncu')) return;
      this.hud.showToast(`${code} odasına bağlanılıyor…`, 2.6);
    });

    // When it is not going to work, say why and put the way out on screen
    // instead of leaving a spinner running for ever.
    this.coop.onTrouble = (kind) => {
      const help = document.getElementById('coop-manual-help');
      if (kind === 'signal' && help) help.open = true;
      this.hud.showToast(
        kind === 'signal'
          ? 'Buluşma servisine ulaşılamıyor — ağ engelliyor olabilir, elle bağlanmayı dene'
          : 'Arkadaşına ulaşılamadı — ikiniz de aynı kodu yazıp BAĞLAN dediniz mi?',
        5
      );
    };

    // ---- copy-and-paste rescue -----------------------------------------
    const mine = document.getElementById('coop-mine');
    const theirs = document.getElementById('coop-theirs');
    document.getElementById('coop-mk').addEventListener('click', async () => {
      mine.value = 'üretiliyor…';
      try {
        mine.value = await this.coop.manualOffer(nameEl.value || 'Oyuncu');
        mine.select();
      } catch (err) {
        mine.value = `hata: ${err.message}`;
      }
    });
    document.getElementById('coop-ma').addEventListener('click', async () => {
      const text = theirs.value.trim();
      if (!text) return;
      try {
        const reply = await this.coop.manualAccept(text, nameEl.value || 'Oyuncu');
        // pasting an offer makes us the host, and produces an answer to send back
        if (reply) { mine.value = reply; mine.select(); }
        else this.hud.showToast('Bağlanılıyor…', 2);
      } catch (err) {
        this.hud.showToast(`Kod okunamadı: ${err.message}`, 3);
      }
    });

    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
    });
    refresh();
  }

  // ------------------------------------------------------------------ races
  /**
   * The race list and the buttons around it.
   *
   * The routes are only prepared the first time the list is opened: every one
   * of them costs a handful of Dijkstra runs to measure, and a player who
   * never opens the list should not pay for that at load.
   */
  _bindRaces() {
    const el = document.getElementById('races');
    const list = document.getElementById('race-list');
    const quit = document.getElementById('races-quit');

    const close = () => {
      el.classList.add('hidden');
      this.input?.clearActions();
    };

    const render = () => {
      if (!this.racePlan) this.racePlan = prepareAll(this.network, this.colliders);
      list.innerHTML = '';
      for (const r of this.racePlan) {
        const best = this.raceBests[r.def.id];
        const medal = best ? medalFor(best.time, r.par) : null;
        const item = document.createElement('button');
        item.className = 'race-item';
        item.innerHTML = `
          <span class="ri-medal">${medal ? MEDAL[medal].icon : '🏁'}</span>
          <span class="ri-body">
            <b class="ri-name">${r.def.name}</b>
            <span class="ri-blurb">${r.def.blurb}</span>
            <span class="ri-len">${(r.length / 1000).toFixed(1)} km · ${r.checkpoints.length} kapı</span>
          </span>
          <span class="ri-num">
            <span><i>hedef</i><b>${formatTime(r.par)}</b></span>
            <span><i>rekorun</i><b class="${best ? 'has' : ''}">${best ? formatTime(best.time) : '—'}</b></span>
          </span>`;
        item.addEventListener('click', () => { close(); this.startRace(r); });
        list.appendChild(item);
      }
      if (!this.racePlan.length) {
        list.innerHTML = '<li class="ri-blurb">Bu haritada sürülebilir yarış bulunamadı.</li>';
      }
      quit.classList.toggle('hidden', !this.race);
    };

    this.openRaces = () => {
      if (this.state === 'map') this.closeMap();
      if (this.state === 'driving') this.pause();
      if (this.state === 'garage') return;
      this.input?.releaseAll();
      el.classList.remove('hidden');
      render();
    };
    this.closeRaces = close;
    document.getElementById('btn-races').addEventListener('click', () => this.openRaces());
    document.getElementById('races-close').addEventListener('click', close);
    quit.addEventListener('click', () => { this.abortRace('Yarış bırakıldı'); close(); });
  }

  /** Puts the car on the line and starts the count-in. */
  startRace(prepared) {
    if (this.state === 'paused') this.resume();
    if (this.state === 'foot') this._enterCar();
    if (this.state !== 'driving') return;

    this.abortRace(null);
    this._wpBeforeRace = this.waypoint;

    const first = prepared.checkpoints[0];
    const yaw = Math.atan2(first.x - prepared.start.x, first.z - prepared.start.z);
    this._repairCar();
    this._placeOnRoad(prepared.start.x, prepared.start.z, yaw);
    this.rig.snapTo(this.vehicle);
    this.effects.clearSkids();

    this.race = new RaceSession(prepared);
    this.raceGates.show();
    this.raceGates.update(0, prepared.checkpoints, 0, this.ground);
    document.getElementById('race-hud').classList.remove('hidden');
    document.getElementById('hud').classList.add('racing');
    document.getElementById('race-title').textContent = prepared.def.name;
    document.getElementById('race-result').classList.add('hidden');
    this._raceResultT = 0;
    this._raceAimAt(first);
    this.hud.showToast(`${prepared.def.name} · hedef ${formatTime(prepared.par)}`, 2.6);
  }

  /** Points the navigation at a gate without the "destination set" ceremony. */
  _raceAimAt(cp) {
    this.waypoint = { x: cp.x, z: cp.z };
    this._buildRoute();
    document.getElementById('waypoint').classList.add('hidden');
  }

  /** Ends an attempt early. `msg` null means "no announcement, just clear". */
  abortRace(msg = 'Yarış iptal edildi') {
    if (!this.race) return;
    this.race = null;
    this.raceGates.hide();
    document.getElementById('race-hud').classList.add('hidden');
    document.getElementById('hud').classList.remove('racing');
    document.getElementById('race-count').classList.add('hidden');
    this.waypoint = this._wpBeforeRace || null;
    this._wpBeforeRace = null;
    this._buildRoute();
    document.getElementById('waypoint').classList.toggle('hidden', !this.waypoint);
    if (msg) this.hud.showToast(msg, 2.2);
  }

  /** The clock, the gates, and what a passed gate is worth. */
  _updateRace(dt) {
    const card = document.getElementById('race-result');
    if (this._raceResultT > 0) {
      this._raceResultT -= dt;
      if (this._raceResultT <= 0) card.classList.add('hidden');
    }
    const race = this.race;
    if (!race) return;

    // a wreck is the end of the attempt, whatever the clock says
    if (this.vehicle.dead) {
      this.abortRace(null);
      this._showRaceResult(null, 'Araç hurdaya çıktı', null);
      return;
    }

    const p = this.vehicle.position;
    const event = race.update(dt, p.x, p.z);
    const count = document.getElementById('race-count');

    if (race.state === 'countdown') {
      count.classList.remove('hidden');
      if (event === 'tick') {
        count.innerHTML = `<b>${Math.ceil(race.countdown)}</b>`;
        this.audio.blip(620, 0.14, 0.07);
      }
    } else if (event === 'go') {
      count.innerHTML = '<b>BAŞLA!</b>';
      this.audio.blip(980, 0.22, 0.09);
      this._raceGoHide = 0.7;
    }
    if (this._raceGoHide > 0) {
      this._raceGoHide -= dt;
      if (this._raceGoHide <= 0) count.classList.add('hidden');
    }

    if (event === 'gate' || event === 'finish') {
      const best = this.raceBests[race.race.def.id];
      const ref = best?.splits?.[race.index - 1];
      race.delta = Number.isFinite(ref) ? race.time - ref : null;
      this.audio.blip(event === 'finish' ? 1180 : 860, 0.16, 0.08);
    }
    if (event === 'gate') this._raceAimAt(race.target);

    if (event === 'finish') {
      const def = race.race.def;
      const time = race.time;
      const prev = this.raceBests[def.id];
      const record = !prev || time < prev.time;
      if (record) saveBest(this.raceBests, def.id, time, race.splits);
      const medal = medalFor(time, race.race.par);
      this.abortRace(null);
      this._showRaceResult(time, def.name, medal, record, prev?.time);
      return;
    }

    this.raceGates.update(dt, race.race.checkpoints, race.index, this.ground);
    this._raceHud(race);
  }

  _raceHud(race) {
    document.getElementById('race-time').textContent =
      race.state === 'countdown' ? formatTime(0) : formatTime(race.time);
    document.getElementById('race-cp').textContent = `${race.index}/${race.total}`;
    document.getElementById('race-next').textContent = race.target?.name || '';
    const d = document.getElementById('race-delta');
    if (race.delta === null) {
      d.textContent = '';
    } else {
      d.textContent = formatDelta(race.delta);
      d.classList.toggle('ahead', race.delta < 0);
      d.classList.toggle('behind', race.delta >= 0);
    }
    const dist = document.getElementById('race-dist');
    const m = race.dist;
    dist.textContent = race.state === 'countdown' ? ''
      : (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
  }

  /** The card that says how it went, for a few seconds. */
  _showRaceResult(time, title, medal, record = false, prevBest = null) {
    const card = document.getElementById('race-result');
    const icon = time === null ? '💥' : (medal ? MEDAL[medal].icon : '🏁');
    let note = '';
    if (time === null) note = 'Yarış yarıda kaldı';
    else if (record && prevBest) note = `Yeni rekor · ${formatDelta(time - prevBest)} sn`;
    else if (record) note = 'İlk kez bitirdin';
    else note = `Rekorun ${formatTime(prevBest)}`;
    card.innerHTML = `
      <div class="rr-medal">${icon}</div>
      <h3>${title}</h3>
      <div class="rr-time">${time === null ? '--:--' : formatTime(time)}</div>
      <p class="rr-note${record && time !== null ? ' best' : ''}">${note}</p>`;
    card.classList.remove('hidden');
    this._raceResultT = 6;
    if (time !== null) this.hud.showToast(medal ? `${MEDAL[medal].label} madalya!` : 'Yarış bitti', 2.6);
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
    this.abortRace(null);
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

  /**
   * The state of the bodywork, once a frame.
   *
   * Dents are pushed in here rather than in the physics step because bending
   * a panel means walking a vertex buffer, and the solver has no business
   * knowing what the car looks like. Two a frame is the cap: driving the
   * length of a wall can raise a dozen contacts in one step and there is
   * nothing to see in the last ten of them.
   */
  _updateDamage(dt) {
    const v = this.vehicle;

    if (v.dents.length) {
      if (this.bodyDamage && !v.dead) {
        for (const d of v.dents.slice(0, 2)) this.bodyDamage.dent(d);
      }
      v.dents.length = 0;
    }

    if (v.dead) {
      this._wreckTimer -= dt;
      // the wreck goes on smoking where it stopped
      this._smokeAcc = (this._smokeAcc ?? 0) + dt;
      if (this._smokeAcc > 0.08) {
        this._smokeAcc = 0;
        this.effects?.emitSmoke(
          v.position.x + (Math.random() - 0.5) * 1.6,
          v.position.y + 0.7,
          v.position.z + (Math.random() - 0.5) * 1.6,
          (Math.random() - 0.5) * 0.9, 1.6 + Math.random(), (Math.random() - 0.5) * 0.9,
          2.4, 2.2, [0.16, 0.15, 0.14]
        );
      }
      if (this._wreckTimer <= 0) this._reviveCar();
      return;
    }

    if (v.damage >= 1) {
      // With wrecking switched off the shell still takes everything it can —
      // it simply never gives up. The bar sits full and you drive on in it.
      if (this.canWreck) {
        this._wreckCar();
        return;
      }
      v.damage = 0.995;
    }

    // Past two thirds gone the engine bay starts smoking, which is the only
    // warning you get that the next wall is the last one.
    if (v.damage > 0.62) {
      this._smokeAcc = (this._smokeAcc ?? 0) + dt;
      const every = 0.34 - (v.damage - 0.62) * 0.6;
      if (this._smokeAcc > every) {
        this._smokeAcc = 0;
        const nose = v.spec.length * 0.42;
        const grey = 0.5 - (v.damage - 0.62) * 0.9;
        this.effects?.emitSmoke(
          v.position.x + Math.sin(v.yaw) * nose + (Math.random() - 0.5) * 0.5,
          v.position.y + 0.9,
          v.position.z + Math.cos(v.yaw) * nose + (Math.random() - 0.5) * 0.5,
          -v.velocity.x * 0.2 + (Math.random() - 0.5) * 0.6,
          1.4 + Math.random(),
          -v.velocity.z * 0.2 + (Math.random() - 0.5) * 0.6,
          1.1, 1.3, [grey, grey * 0.96, grey * 0.92]
        );
      }
    }
  }

  /** The shell has taken everything it can. */
  _wreckCar() {
    const v = this.vehicle;
    if (v.dead) return;
    v.dead = true;
    v.damage = 1;
    this._wreckTimer = WRECK_TIME;
    this._smokeAcc = 0;

    // what is left of it goes to the solver, and the car itself stops being
    scatterWreck(this.rigid, v.spec, this.playerCar.paintMat.color.getHex(),
      v.position, v.yaw, v.velocity);
    this.playerCar.group.visible = false;
    v.velocity.multiplyScalar(0.1);

    this.audio.explode(1);
    this.rig.addShake(1.35 * this.shakeScale);
    const p = v.position;
    this.effects?.blast(p.x, p.y + 0.7, p.z, 1.15);
    this.hud.showToast('Araç hurdaya çıktı', 2.6);
  }

  /** A fresh one, straightened out, back on the road. */
  _reviveCar() {
    const v = this.vehicle;
    v.dead = false;
    v.damage = 0;
    v.dents.length = 0;
    this._wreckTimer = 0;
    this.bodyDamage?.repair();
    this.playerCar.group.visible = true;
    this._placeOnRoad(v.position.x, v.position.z, v.yaw);
    this.rig.snapTo(v);
    this.hud.showToast('Yeni araç geldi', 2);
  }

  /** Panel-beats whatever is left of it without waiting for the explosion. */
  _repairCar() {
    this.vehicle.damage = 0;
    this.vehicle.dead = false;
    this.vehicle.dents.length = 0;
    this._wreckTimer = 0;
    this.bodyDamage?.repair();
    if (this.playerCar) this.playerCar.group.visible = true;
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
      // off -> dipped -> main -> off
      if (this.headlightsManual === null) this.headlightsManual = this.skyEnv.lightsOn < 0.5;
      if (!this.headlightsManual) { this.headlightsManual = true; this.mainBeam = false; }
      else if (!this.mainBeam) this.mainBeam = true;
      else { this.headlightsManual = false; this.mainBeam = false; }
      this.hud.showToast(
        !this.headlightsManual ? 'Farlar kapalı' : (this.mainBeam ? 'Uzun far' : 'Kısa far'), 1.4
      );
    }
    if (input.consume('mute')) {
      this.audio.setMuted(!this.audio.muted);
      this.hud.showToast(this.audio.muted ? 'Ses kapalı' : 'Ses açık', 1.4);
    }
    if (input.consume('fullscreen')) this.toggleFullscreen();
    if (input.consume('settings')) {
      this.settings.isOpen ? this.settings.close() : this.openSettings();
    }
    if (input.consume('races')) {
      const open = !document.getElementById('races').classList.contains('hidden');
      open ? this.closeRaces?.() : this.openRaces?.();
    }
    if (input.consume('interact')) this._interact();

    if (this.state === 'foot') {
      if (input.consume('respawn')) {
        this._placeOnRoad(this.vehicle.position.x, this.vehicle.position.z, this.vehicle.yaw);
        this._enterCar();
      }
      return;
    }
    if (this.state !== 'driving') return;

    // A wreck takes no orders but the one that ends it early
    if (this.vehicle.dead) {
      if (input.consume('respawn')) this._reviveCar();
      return;
    }

    if (input.consume('respawn')) {
      this._repairCar();
      this._placeOnRoad(this.vehicle.position.x, this.vehicle.position.z, this.vehicle.yaw);
      this.rig.snapTo(this.vehicle);
      this.hud.showToast('Araç yola alındı ve onarıldı', 1.8);
    }
    if (input.consume('teleport')) {
      this.abortRace();
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
        this.msUpdate = this._msUpdate / this._fpsFrames;
        this.msDraw = this._msDraw / this._fpsFrames;
        this._fpsAcc = 0;
        this._fpsFrames = 0;
        this._msUpdate = 0;
        this._msDraw = 0;
      }

      this._adaptResolution(dt);
      /**
       * Where the frame went, for the corner readout.
       *
       * The clock after `render` returns does not include the GPU's own work —
       * the driver is still busy when the call comes back — so what is being
       * timed is the CPU cost of walking the scene and submitting the draws.
       * That is the honest thing to show, because on this game it is the part
       * that was the bottleneck, and it is the one number the graphics
       * settings could never move.
       */
      const t0 = performance.now();
      this.update(dt);
      const t1 = performance.now();
      this.renderer.render(this.scene, this.camera);
      this._msUpdate += t1 - t0;
      this._msDraw += performance.now() - t1;
    };
    requestAnimationFrame(tick);
  }

  /**
   * Keeps the frame rate at the target by moving the resolution.
   *
   * The frame time is smoothed hard, because a single long frame is usually a
   * chunk of ground being built and not a machine that cannot cope. Changes
   * are small and rare — one twentieth at a time, at most twice a second —
   * since resizing the drawing buffer costs a frame of its own, and a
   * resolution that hunts up and down is worse to look at than a slightly soft
   * one that stays put.
   */
  _adaptResolution(dt) {
    if (!this.fpsTarget) return;
    this._frameAvg += (Math.min(dt, 0.25) - this._frameAvg) * 0.06;
    this._resHold -= dt;
    if (this._resHold > 0) return;

    const target = 1 / this.fpsTarget;
    const was = this._resAuto;
    // 12% of headroom either way, so a frame rate sitting on the target is
    // left alone instead of being nudged every half second
    if (this._frameAvg > target * 1.12) this._resAuto = Math.max(0.6, was - 0.05);
    else if (this._frameAvg < target * 0.88) this._resAuto = Math.min(1, was + 0.05);
    if (this._resAuto === was) return;

    this._resHold = 0.5;
    this._applyPixelRatio();
  }

  /** The user's resolution setting, with whatever the auto scaler decided. */
  _applyPixelRatio() {
    const base = Math.min(window.devicePixelRatio || 1, QUALITY.pixelRatio);
    this.renderer.setPixelRatio(base * (this.resScale ?? 1) * this._resAuto);
  }

  update(dt) {
    const input = this.input.update(dt);
    this._handleActions();

    const driving = this.state === 'driving';
    const onFoot = this.state === 'foot';
    const paused = this.state === 'paused' || this.state === 'map';

    // ---- vehicle -------------------------------------------------------
    if (driving) {
      const prevImpact = this.vehicle.impact;
      this._crash = 0;
      this._crashKind = null;
      // a wreck steers itself: no throttle, and the brakes locked on
      this.vehicle.update(dt, this.vehicle.dead ? DEAD_INPUT : input);
      // a car sent flying counts as a crash too, not a bump
      if (this.vehicle.crash > 0) {
        this._crash = Math.max(this._crash, this.vehicle.crash);
        this._crashKind = this._crashKind || 'park';
        this.vehicle.crash = 0;
      }
      if (this._crash > 0) {
        this.audio.crash(this._crash, this._crashKind);
        this.rig.addShake(Math.min(0.9, this._crash) * this.shakeScale);
      } else if (this.vehicle.impact > prevImpact + 0.05) {
        this.audio.thud(this.vehicle.impact);
        this.rig.addShake(this.vehicle.impact * 0.9 * this.shakeScale);
      }
      this._updateDamage(dt);
      this._updateRace(dt);
      this.clockTime += dt;
      this.terrain.update(this.vehicle.position.x, this.vehicle.position.z, this.streamBudget);
    } else if (onFoot) {
      input.cameraYaw = this.rig.orbitYaw ?? this.rig.yaw;
      this.onFoot.update(dt, input);
      this.clockTime += dt;
      this.terrain.update(this.onFoot.position.x, this.onFoot.position.z, this.streamBudget);
      // the parked car settles on its springs while you are away from it
      this.vehicle.velocity.multiplyScalar(Math.exp(-6 * dt));
      this.vehicle.position.y = damp(
        this.vehicle.position.y,
        this.ground.heightAt(this.vehicle.position.x, this.vehicle.position.z), 8, dt
      );
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
    if (onFoot || this.onFoot?.riding) this.onFoot.applyToModel();

    // ---- world ---------------------------------------------------------
    if (!paused) {
      this.network.updateLights(this.clockTime);
      this.traffic.update(dt, this.vehicle);
      this.teleferik.update(dt);
      const focus = onFoot ? this.onFoot.position : this.vehicle.position;
      this.metro.update(dt, focus);
      this.props.pedestrians.update(dt, this.clockTime, focus);
      this.effects.update(dt);
      this.rigid.update(dt, focus);
      this._emitTyreEffects(dt);
      this.skyEnv.update(dt * this.clockScale, onFoot ? this.onFoot.position : this.vehicle.position);
      this.reflections.update(
        dt, onFoot ? this.onFoot.position : this.vehicle.position, this.skyEnv.hour
      );
      // The first environment map the game builds gets checked before it is
      // trusted. On a stack where it comes out broken the whole world renders
      // unlit, and that is not a thing to ship and hope about.
      if (this.reflections.target && !this.reflections.checked) {
        if (!this.reflections.selfTest(this.camera)) {
          this.hud?.showToast('Yansımalar bu cihazda çalışmadı, kapatıldı', 3.4);
        }
      }
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
    } else if (onFoot) {
      // the camera trails behind whichever way the character is facing
      this.rig.orbitYaw = this.onFoot.yaw;
      this.rig.follow(dt, this.onFoot, this.ground);
    } else if (!paused) {
      this.rig.update(dt, this.vehicle, this.ground);
    }

    // ---- what is worth having in the scene at all ----------------------
    // After the camera has moved, not before: the tiles are chosen by what
    // this frame's camera can see, and a frame-old frustum on a fast turn is
    // exactly where the edge of the world would blink.
    if (!paused) {
      const eye = onFoot ? this.onFoot.position : this.vehicle.position;
      this.tiles.update(eye.x, eye.z, this.camera);
    }

    // ---- audio ---------------------------------------------------------
    if (onFoot) {
      // the engine is off; only the world is audible
      this.audio.update(this.vehicle, { throttle: 0, brake: 0, handbrake: false }, dt);
      this._updateAmbient(dt);
    } else if (driving) {
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

    this.coop?.update(dt);
    this._updatePrompt();
    if (driving || onFoot) this._updateNav(dt); else document.getElementById('nav')?.classList.add('hidden');

    // ---- ui ------------------------------------------------------------
    if (driving || onFoot || paused) {
      const district = this._districtName();
      this.hud.setDistrict(district);
      this.hud.update(dt, this.vehicle, {
        clock: this.skyEnv.clockText,
        fps: this.fps,
        msUpdate: this.msUpdate,
        msDraw: this.msDraw,
        calls: this.renderer.info.render.calls
      });
      this.minimap.draw(this.vehicle, this.traffic, district, this.waypoint, this.coop?.peers);
      this._updateWaypointHud();
    }
  }

  /** Bearing and distance to the marked destination. */
  _updateWaypointHud() {
    // during a race the marker belongs to the gate the race is aiming at,
    // and arriving at it is the race's business, not the waypoint's
    if (!this.waypoint || this.race) return;
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
    const main = on && this.mainBeam;
    const target = on ? (main ? 30 : 17) : 0;
    for (const beam of this.headBeams) {
      beam.intensity = damp(beam.intensity, target, 7, dt);
      beam.visible = beam.intensity > 0.05;
      // main beam looks further ahead and flattens out
      beam.angle = damp(beam.angle, main ? 0.36 : 0.46, 5, dt);
      beam.distance = main ? 165 : 105;
    }
    const coneTarget = on ? (0.012 + night * 0.022) * (main ? 1.5 : 1) : 0;
    for (const cone of this.headCones) {
      cone.material.opacity = damp(cone.material.opacity, coneTarget, 6, dt);
      cone.visible = cone.material.opacity > 0.004;
      const reach = main ? 34 : 22;
      cone.scale.y = damp(cone.scale.y, reach, 5, dt);
      cone.position.z = (this.vehicle.spec.length * 0.5 - 0.06) + cone.scale.y * 0.5;
    }
    const pool = this.headlightPool.material.uniforms.uOpacity;
    pool.value = damp(pool.value, on ? (0.16 * night + 0.05) * (main ? 1.35 : 1) : 0, 6, dt);
    this.headlightPool.scale.z = damp(this.headlightPool.scale.z, main ? 40 : 26, 5, dt);
    this.headlightPool.position.z = this.headlightPool.scale.z * 0.5;
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

    const list = this.props.signalLenses;
    if (!list.length) return;
    const c = new THREE.Color();
    const OFF = 0.055;
    const touched = new Set();
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const slot = s.slot;
      if (!slot) continue;
      const state = s.light.state[s.group];
      let hex = 0x000000;
      if (s.lens === 0) hex = state === 'red' ? 0xff2b1a : 0x2a0a08;
      else if (s.lens === 1) hex = state === 'yellow' ? 0xffc21a : 0x2a2008;
      else hex = state === 'green' ? 0x2bff6a : 0x082a12;
      c.setHex(hex);
      if (state !== 'red' && s.lens === 0) c.multiplyScalar(OFF * 6);
      slot.mesh.setColorAt(slot.index, c);
      touched.add(slot.mesh);
    }
    // the lenses live in one instanced mesh per tile now
    for (const m of touched) if (m.instanceColor) m.instanceColor.needsUpdate = true;
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
// the transport on its own, so a room can be tried without a live service
window.kecioren.RtcTransport = RtcTransport;
