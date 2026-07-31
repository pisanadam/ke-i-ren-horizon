import { CARS } from '../vehicles/catalog.js';
import {
  MODS, defaultTune, loadTunes, saveTunes, option, tunedSpec
} from '../vehicles/tuning.js';

/** A wider palette than the catalogue's, offered on every car. */
const EXTRA_COLOURS = [
  0xffffff, 0xc9ced4, 0x8f959c, 0x4a4f56, 0x22262b, 0x0d0f12,
  0xd11f1f, 0x8a1f2f, 0xf0a500, 0xf5e663, 0x2f7a4a, 0x1b6b5a,
  0x1b4fa0, 0x2f6fae, 0x34d3ff, 0x6a3fa0, 0xd06aa8, 0x7a4a2a
];

/** Garage screen: pick a car, pick a colour, hit the road. */
export class Menu {
  constructor({ onSelect, onDrive, onColour }) {
    this.el = document.getElementById('menu');
    this.index = 0;
    this.colourIndex = 0;
    this.tunes = loadTunes();
    this.modGroup = 'performans';
    this.modPanel = document.getElementById('mod-panel');
    this.modGrid = document.getElementById('mod-grid');
    this.onSelect = onSelect;
    this.onDrive = onDrive;
    this.onColour = onColour;

    this.name = document.getElementById('car-name');
    this.klass = document.getElementById('car-class');
    this.desc = document.getElementById('car-desc');
    this.colourRow = document.getElementById('color-row');
    this.bars = {
      speed: document.getElementById('st-speed'),
      accel: document.getElementById('st-accel'),
      grip: document.getElementById('st-grip'),
      brake: document.getElementById('st-brake')
    };

    document.getElementById('car-prev').addEventListener('click', () => this.step(-1));
    document.getElementById('car-next').addEventListener('click', () => this.step(1));
    document.getElementById('btn-drive').addEventListener('click', () => this.onDrive());
    document.getElementById('btn-mods')?.addEventListener('click', () => this.toggleMods());
    document.getElementById('mod-reset')?.addEventListener('click', () => {
      this.tunes[this.car.id] = defaultTune();
      saveTunes(this.tunes);
      this.render();
      this.onSelect(this.car, this.colour);
    });
    for (const b of document.querySelectorAll('#mod-tabs .tab')) {
      b.addEventListener('click', () => { this.modGroup = b.dataset.group; this._renderMods(); });
    }

    window.addEventListener('keydown', (e) => {
      if (this.el.classList.contains('hidden')) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.step(-1);
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.step(1);
      if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); this.onDrive(); }
    });
  }

  get car() {
    return CARS[this.index];
  }

  get colour() {
    const t = this.tune;
    if (t.colour !== null && t.colour !== undefined) return t.colour;
    return this.car.colours[this.colourIndex % this.car.colours.length];
  }

  /** The saved build for the selected car, created on first sight. */
  get tune() {
    const id = this.car.id;
    if (!this.tunes[id]) this.tunes[id] = defaultTune();
    return this.tunes[id];
  }

  /** The spec the game should actually drive, mods included. */
  get spec() {
    return tunedSpec(this.car, this.tune);
  }

  setMod(key, value) {
    this.tune[key] = value;
    saveTunes(this.tunes);
    this.render();
    this.onSelect(this.car, this.colour);
  }

  step(dir) {
    this.index = (this.index + dir + CARS.length) % CARS.length;
    this.colourIndex = 0;
    this.render();
    this.onSelect(this.car, this.colour);
  }

  render() {
    const car = this.car;
    this.name.textContent = car.name;
    this.klass.textContent = car.class;
    this.desc.textContent = car.desc;
    // the bars show what the car is *now*, with its mods on
    const spec = this.spec;
    for (const [key, el] of Object.entries(this.bars)) {
      el.style.width = `${Math.round((spec.stats[key] ?? 0.5) * 100)}%`;
    }

    this.colourRow.innerHTML = '';
    const palette = [...new Set([...car.colours, ...EXTRA_COLOURS])];
    const current = this.colour;
    palette.forEach((hex) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (hex === current ? ' on' : '');
      b.style.background = `#${hex.toString(16).padStart(6, '0')}`;
      b.title = 'Renk seç';
      b.addEventListener('click', () => {
        this.tune.colour = hex;
        saveTunes(this.tunes);
        this.render();
        this.onColour(hex);
      });
      this.colourRow.appendChild(b);
    });

    this._renderMods();
  }

  /** The modification grid: one cell per option, click to cycle. */
  _renderMods() {
    if (!this.modGrid) return;
    for (const b of document.querySelectorAll('#mod-tabs .tab')) {
      b.classList.toggle('on', b.dataset.group === this.modGroup);
    }
    this.modGrid.innerHTML = '';
    const t = this.tune;
    for (const mod of MODS) {
      if (mod.group !== this.modGroup) continue;
      const cur = option(mod, t[mod.key] ?? mod.values[0].v);
      const cell = document.createElement('button');
      cell.className = 'opt';
      cell.type = 'button';
      const name = document.createElement('span');
      name.textContent = mod.label;
      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = cur.t;
      cell.append(name, val);
      cell.addEventListener('click', () => {
        const i = mod.values.findIndex((o) => o.v === (t[mod.key] ?? mod.values[0].v));
        const next = mod.values[(i + 1 + mod.values.length) % mod.values.length];
        this.setMod(mod.key, next.v);
      });
      this.modGrid.appendChild(cell);
    }
  }

  toggleMods() {
    if (!this.modPanel) return;
    this.modPanel.classList.toggle('hidden');
    this._renderMods();
  }

  show() {
    this.el.classList.remove('hidden');
    this.render();
  }

  hide() {
    this.el.classList.add('hidden');
  }

  get visible() {
    return !this.el.classList.contains('hidden');
  }
}
