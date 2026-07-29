/**
 * Drivable vehicles. Handling figures are in SI-ish units:
 *   power     — tractive force at a standstill, newtons
 *   topSpeed  — metres per second
 *   grip      — lateral acceleration limit as a multiple of g
 *   brake     — braking force, newtons
 */

export const CARS = [
  {
    id: 'hatchback',
    name: 'Şehir Hatchback',
    class: 'Şehir içi',
    desc: 'Keçiören’in dar sokakları ve dik rampaları için biçilmiş kaftan. Küçük, çevik, park etmesi kolay.',
    colours: [0xd8dde3, 0xc23b32, 0x2f4f8f, 0x1b1d21, 0x6fae5a, 0xe8b33c],
    length: 3.95, width: 1.72, wheelBase: 2.5, rideHeight: 0.24,
    bodyHeight: 0.62, cabinHeight: 0.56, wheelRadius: 0.30, wheelWidth: 0.20,
    cabinBack: -0.86, cabinFront: 0.44, roofBack: 0.06, roofFront: 0.32,
    mass: 1060, power: 6600, topSpeed: 47, grip: 1.05, brake: 12500, steerMax: 0.62,
    stats: { speed: 0.42, accel: 0.5, grip: 0.62, brake: 0.6 }
  },
  {
    id: 'sedan',
    name: 'Klasik Sedan',
    class: 'Nostalji',
    desc: 'Doksanların Ankara sokaklarından fırlamış arkadan itiş sedan. Arkası kolay savrulur, sürmesi keyifli.',
    colours: [0xe6e3da, 0x8c9199, 0x2b3d63, 0x7a2f2a, 0x1f2225, 0xb9a468],
    length: 4.45, width: 1.75, wheelBase: 2.62, rideHeight: 0.25,
    bodyHeight: 0.60, cabinHeight: 0.55, wheelRadius: 0.31, wheelWidth: 0.20,
    cabinBack: -0.52, cabinFront: 0.22, roofBack: 0.18, roofFront: 0.36,
    mass: 1150, power: 6100, topSpeed: 45, grip: 0.90, brake: 10500, steerMax: 0.60,
    stats: { speed: 0.38, accel: 0.42, grip: 0.4, brake: 0.44 }
  },
  {
    id: 'taksi',
    name: 'Keçiören Taksi',
    class: 'Ticari',
    desc: 'Sarı taksi. Estergon’dan Etlik’e müşteri taşımaya alışkın; yolu senden iyi bilir.',
    colours: [0xf5c518, 0xf0a500, 0xe8d84a],
    length: 4.55, width: 1.78, wheelBase: 2.68, rideHeight: 0.25,
    bodyHeight: 0.61, cabinHeight: 0.57, wheelRadius: 0.31, wheelWidth: 0.21,
    cabinBack: -0.50, cabinFront: 0.24, roofBack: 0.16, roofFront: 0.34,
    taxiSign: true,
    mass: 1290, power: 6900, topSpeed: 48, grip: 1.00, brake: 11800, steerMax: 0.60,
    stats: { speed: 0.44, accel: 0.46, grip: 0.55, brake: 0.55 }
  },
  {
    id: 'spor',
    name: 'Kırmızı Spor',
    class: 'Performans',
    desc: 'Kuzey Çevre Yolu’nu birkaç dakikada bitirir. Alçak, geniş ve fena hâlde hızlı.',
    colours: [0xd11f1f, 0x111318, 0xf0f0ee, 0x1b4fa0, 0xf5a623],
    length: 4.32, width: 1.92, wheelBase: 2.60, rideHeight: 0.16,
    bodyHeight: 0.50, cabinHeight: 0.42, wheelRadius: 0.33, wheelWidth: 0.27,
    cabinBack: -0.56, cabinFront: 0.30, roofBack: 0.16, roofFront: 0.34,
    frontWidth: 0.99, noseDrop: 0.12, spoiler: true,
    mass: 1250, power: 14500, topSpeed: 79, grip: 1.36, brake: 19500, steerMax: 0.55,
    stats: { speed: 0.95, accel: 0.92, grip: 0.95, brake: 0.92 }
  },
  {
    id: 'suv',
    name: 'Dağ SUV',
    class: 'Arazi',
    desc: 'Bağlum yolunun bozuk asfaltı umurunda değil. Yüksek, ağır ve toprakta bile tutunur.',
    colours: [0x4a5a48, 0x2b2f34, 0xd9d5c9, 0x6a4a32, 0x24486b],
    length: 4.78, width: 1.96, wheelBase: 2.82, rideHeight: 0.42,
    bodyHeight: 0.72, cabinHeight: 0.66, wheelRadius: 0.38, wheelWidth: 0.27,
    cabinBack: -0.60, cabinFront: 0.28, roofBack: 0.10, roofFront: 0.30,
    roofRack: true, bullBar: true,
    mass: 2100, power: 10800, topSpeed: 53, grip: 1.12, brake: 15500, steerMax: 0.58,
    stats: { speed: 0.52, accel: 0.55, grip: 0.72, brake: 0.66 }
  },
  {
    id: 'kamyonet',
    name: 'Kamyonet',
    class: 'Ticari',
    desc: 'Kalaba pazarına kasa dolusu mal taşır. Boş kasayla arkası hafif, virajda dikkat.',
    colours: [0xdcdcd6, 0x2f5f8f, 0x8a2f2a, 0x3c4a3a, 0x4a4d52],
    length: 5.15, width: 1.88, wheelBase: 3.05, rideHeight: 0.36,
    bodyHeight: 0.66, cabinHeight: 0.60, wheelRadius: 0.35, wheelWidth: 0.24,
    cabinBack: 0.02, cabinFront: 0.58, roofBack: 0.12, roofFront: 0.28,
    bed: true,
    mass: 1900, power: 8600, topSpeed: 44, grip: 0.94, brake: 12500, steerMax: 0.56,
    stats: { speed: 0.36, accel: 0.4, grip: 0.44, brake: 0.5 }
  },
  {
    id: 'dolmus',
    name: 'Dolmuş Minibüs',
    class: 'Toplu taşıma',
    desc: 'Keçiören–Ulus hattının klasiği. Ağır ve yüksek ama dur–kalk trafiğinde evinde.',
    colours: [0xe8e6df, 0x2f6fae, 0xd8a53c, 0x9a3a32],
    length: 5.45, width: 2.02, wheelBase: 3.25, rideHeight: 0.38,
    bodyHeight: 0.55, cabinHeight: 1.32, wheelRadius: 0.36, wheelWidth: 0.24,
    cabinBack: -0.86, cabinFront: 0.80, tall: true, acUnit: true,
    mass: 2450, power: 9200, topSpeed: 39, grip: 0.86, brake: 12000, steerMax: 0.54,
    stats: { speed: 0.3, accel: 0.34, grip: 0.3, brake: 0.42 }
  },
  {
    id: 'polis',
    name: 'Polis Aracı',
    class: 'Resmî',
    desc: 'Tepe lambaları ve güçlü motoruyla devriye aracı. Trafikte kimse önünü kesmez.',
    colours: [0xf2f4f7, 0x1f3f8f, 0x24262b],
    length: 4.68, width: 1.86, wheelBase: 2.78, rideHeight: 0.24,
    bodyHeight: 0.60, cabinHeight: 0.54, wheelRadius: 0.33, wheelWidth: 0.23,
    cabinBack: -0.50, cabinFront: 0.22, roofBack: 0.16, roofFront: 0.34,
    lightBar: true,
    mass: 1520, power: 11500, topSpeed: 63, grip: 1.22, brake: 17000, steerMax: 0.58,
    stats: { speed: 0.72, accel: 0.74, grip: 0.82, brake: 0.82 }
  },
  {
    id: 'elektrikli',
    name: 'Elektrikli Sedan',
    class: 'Elektrikli',
    desc: 'Sessiz ama anında tork. Ağır bataryası sayesinde yere yapışır, şehirde çok rahat.',
    colours: [0x1d2b3a, 0xe8eaec, 0x8a1f2f, 0x2f6f5a, 0xb8bcc2],
    length: 4.72, width: 1.88, wheelBase: 2.92, rideHeight: 0.22,
    bodyHeight: 0.62, cabinHeight: 0.52, wheelRadius: 0.34, wheelWidth: 0.24,
    cabinBack: -0.56, cabinFront: 0.30, roofBack: 0.10, roofFront: 0.26,
    electric: true,
    mass: 1980, power: 16500, topSpeed: 66, grip: 1.26, brake: 18000, steerMax: 0.57,
    stats: { speed: 0.78, accel: 0.98, grip: 0.88, brake: 0.86 }
  },
  {
    id: 'otobus',
    name: 'Belediye Otobüsü',
    class: 'Toplu taşıma',
    desc: 'Keçiören–Kızılay hattı. Ağır, uzun, yavaş — ama önüne çıkanı dinlemez.',
    colours: [0x2f6fae, 0x2f7a4a, 0xd84a3a],
    length: 10.5, width: 2.5, wheelBase: 5.6, rideHeight: 0.40,
    bodyHeight: 0.62, cabinHeight: 1.70, wheelRadius: 0.46, wheelWidth: 0.30,
    cabinBack: -0.90, cabinFront: 0.90, tall: true, acUnit: true,
    mass: 9200, power: 23000, topSpeed: 33, grip: 0.80, brake: 26000, steerMax: 0.46,
    stats: { speed: 0.22, accel: 0.24, grip: 0.24, brake: 0.4 }
  }
];

export const CAR_BY_ID = Object.fromEntries(CARS.map((c) => [c.id, c]));

/** Vehicles the AI uses for background traffic, with how often each appears. */
export const TRAFFIC_MIX = [
  { id: 'hatchback', weight: 26 },
  { id: 'sedan', weight: 22 },
  { id: 'taksi', weight: 14 },
  { id: 'suv', weight: 12 },
  { id: 'kamyonet', weight: 9 },
  { id: 'dolmus', weight: 8 },
  { id: 'elektrikli', weight: 5 },
  { id: 'otobus', weight: 2 },
  { id: 'polis', weight: 2 }
];

export const TRAFFIC_COLOURS = [
  0xd8dbe0, 0x2b3138, 0xf0efe9, 0x8d1f1f, 0x1f3f7a, 0x4b5a3c, 0x9a7b3f,
  0x6e6e73, 0x1b6b5a, 0xd8ccb4, 0x3a3a3a, 0xa03a2a, 0x2f6fae, 0x6a4a72
];
