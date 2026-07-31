import { QUALITY } from '../quality.js';

const KEY = 'ankara-surus-ayarlar';

/**
 * Settings, laid out the way Minecraft lays out its video options: a grid of
 * cells you click to cycle through the values, grouped under a few tabs.
 *
 * Anything that can change while the engine is running does so immediately;
 * the handful that need the world rebuilding say so and take effect on the
 * next load.
 */
const DEFS = [
  // ---------------------------------------------------------------- görüntü
  {
    tab: 'video', key: 'viewDistance', label: 'Görüş mesafesi', live: true,
    values: [
      { v: 1, t: 'Kısa' }, { v: 2, t: 'Normal' },
      { v: 3, t: 'Uzak' }, { v: 4, t: 'Çok uzak' }, { v: 5, t: 'Aşırı' }
    ],
    def: () => QUALITY.chunkRadius,
    note: 'Ne kadar uzağa kadar ayrıntılı zemin örülsün. Yüksek değer daha çok bellek ister.'
  },
  {
    tab: 'video', key: 'shadows', label: 'Gölgeler', live: true,
    values: [{ v: 0, t: 'Kapalı' }, { v: 1, t: 'Düşük' }, { v: 2, t: 'Yüksek' }],
    def: () => 2
  },
  {
    tab: 'video', key: 'resScale', label: 'Çözünürlük ölçeği', live: true,
    values: [
      { v: 0.6, t: '%60' }, { v: 0.75, t: '%75' }, { v: 0.9, t: '%90' },
      { v: 1, t: '%100' }, { v: 1.25, t: '%125' }, { v: 1.5, t: '%150' }
    ],
    def: () => 1,
    note: 'Sahne bu oranda çizilip ekrana ölçeklenir. Düşürmek en çok kare hızı kazandıran ayardır.'
  },
  {
    tab: 'video', key: 'farClip', label: 'Maks. görüş uzaklığı', live: true,
    values: [
      { v: 600, t: '600 m' }, { v: 1200, t: '1,2 km' }, { v: 2000, t: '2 km' },
      { v: 3200, t: '3,2 km' }, { v: 6000, t: '6 km' }
    ],
    def: () => 6000,
    note: 'Bu mesafeden ötesi hiç çizilmez. Düşürmek uzak şehir siluetini kırpar ama çok hızlandırır.'
  },
  {
    tab: 'video', key: 'culling', label: 'Yüz ayıklama', live: true,
    values: [
      { v: 1, t: 'Açık' }, { v: 2, t: 'Agresif' }, { v: 0, t: 'Kapalı' }
    ],
    def: () => 1,
    note: 'Arkaya bakan yüzeyler çizilmez. Agresif, çift yüzlü yüzeyleri de teke indirir.'
  },
  {
    tab: 'video', key: 'fog', label: 'Sis mesafesi', live: true,
    values: [{ v: 0.6, t: 'Yakın' }, { v: 1, t: 'Normal' }, { v: 1.5, t: 'Uzak' }, { v: 2.4, t: 'Kapalı gibi' }],
    def: () => 1
  },
  {
    tab: 'video', key: 'particles', label: 'Parçacıklar', live: true,
    values: [{ v: 0, t: 'Kapalı' }, { v: 0.5, t: 'Az' }, { v: 1, t: 'Normal' }, { v: 1.6, t: 'Çok' }],
    def: () => 1,
    note: 'Lastik dumanı ve toz.'
  },
  {
    tab: 'video', key: 'skidMarks', label: 'Lastik izleri', live: true,
    values: [{ v: 0, t: 'Kapalı' }, { v: 1, t: 'Açık' }],
    def: () => 1
  },
  {
    tab: 'video', key: 'fps', label: 'FPS göstergesi', live: true,
    values: [{ v: 1, t: 'Açık' }, { v: 0, t: 'Kapalı' }],
    def: () => 1
  },
  {
    tab: 'video', key: 'buildings', label: 'Bina yoğunluğu', reload: true,
    values: [{ v: 0.4, t: 'Az' }, { v: 0.7, t: 'Normal' }, { v: 1, t: 'Yoğun' }, { v: 1.4, t: 'Çok yoğun' }],
    def: () => 1
  },
  {
    tab: 'video', key: 'trees', label: 'Ağaç yoğunluğu', reload: true,
    values: [{ v: 0.4, t: 'Az' }, { v: 0.7, t: 'Normal' }, { v: 1, t: 'Yoğun' }, { v: 1.5, t: 'Orman' }],
    def: () => 1
  },

  // -------------------------------------------------------------------- ses
  { tab: 'ses', key: 'volMaster', label: 'Ana ses', live: true, slider: [0, 1], def: () => 0.7 },
  { tab: 'ses', key: 'volEngine', label: 'Motor', live: true, slider: [0, 1], def: () => 1 },
  { tab: 'ses', key: 'volAmbient', label: 'Çevre sesi', live: true, slider: [0, 1], def: () => 1 },
  { tab: 'ses', key: 'volTyres', label: 'Lastik ve fren', live: true, slider: [0, 1], def: () => 1 },

  // ------------------------------------------------------------------ oyun
  {
    tab: 'oyun', key: 'traffic', label: 'Trafik yoğunluğu', live: true,
    values: [{ v: 0, t: 'Yok' }, { v: 0.5, t: 'Az' }, { v: 1, t: 'Normal' }, { v: 1.5, t: 'Yoğun' }],
    def: () => 1
  },
  {
    tab: 'oyun', key: 'pedestrians', label: 'Yaya sayısı', live: true,
    values: [{ v: 0, t: 'Yok' }, { v: 0.5, t: 'Az' }, { v: 1, t: 'Normal' }],
    def: () => 1
  },
  {
    tab: 'oyun', key: 'clockSpeed', label: 'Gün döngüsü hızı', live: true,
    values: [{ v: 0, t: 'Durdur' }, { v: 0.5, t: 'Yavaş' }, { v: 1, t: 'Normal' }, { v: 3, t: 'Hızlı' }],
    def: () => 1
  },
  {
    tab: 'oyun', key: 'camShake', label: 'Kamera sarsıntısı', live: true,
    values: [{ v: 0, t: 'Kapalı' }, { v: 0.5, t: 'Az' }, { v: 1, t: 'Normal' }],
    def: () => 1
  },
  {
    tab: 'oyun', key: 'units', label: 'Hız birimi', live: true,
    values: [{ v: 0, t: 'km/s' }, { v: 1, t: 'mph' }],
    def: () => 0
  }
];

export class Settings {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('settings');
    this.grid = document.getElementById('settings-grid');
    this.note = document.getElementById('settings-note');
    this.tab = 'video';
    this.values = {};

    for (const d of DEFS) this.values[d.key] = d.def();
    this._load();

    for (const b of this.el.querySelectorAll('.settings-tabs .tab')) {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        for (const o of this.el.querySelectorAll('.settings-tabs .tab')) o.classList.toggle('on', o === b);
        this._render();
      });
    }
    document.getElementById('settings-close').addEventListener('click', () => this.close());
    document.getElementById('settings-reset').addEventListener('click', () => {
      for (const d of DEFS) this.values[d.key] = d.def();
      this._save();
      this.applyAll();
      this._render();
      this._say('Varsayılan ayarlara dönüldü.');
    });

    this._render();
  }

  get(key) { return this.values[key]; }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      for (const d of DEFS) {
        if (saved[d.key] !== undefined) this.values[d.key] = saved[d.key];
      }
    } catch { /* bozuk kayıt varsayılanı bozmasın */ }
  }

  _save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch { /* özel mod */ }
  }

  _say(msg) {
    if (this.note) this.note.textContent = msg || '';
  }

  _render() {
    this.grid.innerHTML = '';
    for (const d of DEFS) {
      if (d.tab !== this.tab) continue;
      const cell = document.createElement('button');
      cell.className = 'opt';
      cell.type = 'button';

      if (d.slider) {
        cell.classList.add('wide');
        const name = document.createElement('span');
        name.textContent = d.label;
        const input = document.createElement('input');
        input.type = 'range';
        input.min = d.slider[0];
        input.max = d.slider[1];
        input.step = 0.05;
        input.value = this.values[d.key];
        const val = document.createElement('span');
        val.className = 'val';
        val.textContent = `%${Math.round(this.values[d.key] * 100)}`;
        input.addEventListener('input', () => {
          this.values[d.key] = +input.value;
          val.textContent = `%${Math.round(this.values[d.key] * 100)}`;
          this.applyAll();
          this._save();
        });
        // the slider must not also fire the cell's cycle handler
        input.addEventListener('click', (e) => e.stopPropagation());
        cell.append(name, input, val);
      } else {
        const cur = d.values.findIndex((o) => o.v === this.values[d.key]);
        const idx = cur < 0 ? 0 : cur;
        const name = document.createElement('span');
        name.textContent = d.label;
        const val = document.createElement('span');
        val.className = 'val';
        val.textContent = d.values[idx].t;
        cell.append(name, val);
        cell.addEventListener('click', () => {
          const now = d.values.findIndex((o) => o.v === this.values[d.key]);
          const next = d.values[(now + 1 + d.values.length) % d.values.length];
          this.values[d.key] = next.v;
          val.textContent = next.t;
          this.applyAll();
          this._save();
          this._say(d.reload
            ? `${d.label}: dünya yeniden kurulunca geçerli olur (sayfayı yenile).`
            : (d.note || ''));
        });
      }
      this.grid.appendChild(cell);
    }
    this._say('');
  }

  open() {
    this.el.classList.remove('hidden');
    this._render();
  }

  close() {
    this.el.classList.add('hidden');
    this.game.settingsClosed?.();
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  /** Pushes every live setting into the running game. */
  applyAll() {
    const g = this.game;
    const v = this.values;

    g.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, QUALITY.pixelRatio) * v.resScale
    );
    g.renderer.shadowMap.enabled = v.shadows > 0;
    if (g.skyEnv) g.skyEnv.setShadowQuality?.(v.shadows);

    if (g.terrain) g.terrain.radius = v.viewDistance;
    if (g.skyEnv) g.skyEnv.fogScale = v.fog;

    if (g.camera.far !== v.farClip) {
      g.camera.far = v.farClip;
      g.camera.updateProjectionMatrix();
    }
    g.setCulling?.(v.culling);

    if (g.audio) {
      g.audio.setLevels({
        master: v.volMaster,
        engine: v.volEngine,
        ambient: v.volAmbient,
        tyres: v.volTyres
      });
    }
    if (g.traffic) g.traffic.setDensity?.(v.traffic);
    if (g.props?.pedestrians) g.props.pedestrians.setDensity?.(v.pedestrians);
    if (g.effects) g.effects.setLevels?.(v.particles, v.skidMarks);

    document.getElementById('perf')?.classList.toggle('hidden', !v.fps);
    g.clockScale = v.clockSpeed;
    g.shakeScale = v.camShake;
    g.useMph = !!v.units;
  }
}
