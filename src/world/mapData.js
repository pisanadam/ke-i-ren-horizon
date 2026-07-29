/**
 * Keçiören (Ankara) — stylised street layout.
 *
 * Coordinates are metres. North is -Z, east is +X, so the map reads like a
 * normal city plan when seen from above. The layout follows the real district:
 * Fatih Caddesi runs the length of the valley as the spine, Kızlarpınarı and
 * Gazino run parallel, Etlik and Sanatoryum sit on the western ridge, Estergon
 * Kalesi crowns the eastern hill, and the Kuzey Çevre Yolu closes the map north.
 */

export const MAP = {
  half: 900,           // playable area spans -900..900 on both axes
  groundSize: 2600     // terrain mesh is larger so the horizon stays filled
};

export const ROAD_TYPES = {
  highway: { width: 22, lanes: 4, speed: 30, layer: 0.10, marks: 'highway' },
  avenue:  { width: 16, lanes: 4, speed: 19, layer: 0.07, marks: 'dashed' },
  main:    { width: 12, lanes: 2, speed: 16, layer: 0.05, marks: 'dashed' },
  street:  { width: 8.5, lanes: 2, speed: 12, layer: 0.03, marks: 'none' },
  lane:    { width: 6.5, lanes: 2, speed: 9, layer: 0.02, marks: 'none' }
};

/** Named arteries, drawn as polylines through the district. */
export const ROADS = [
  // ---------- kuzey-güney eksen ----------
  {
    name: 'Fatih Caddesi', type: 'avenue', major: true,
    points: [[30, 880], [18, 640], [4, 400], [-2, 150], [8, -70], [30, -300], [58, -520]]
  },
  {
    name: 'Kızlarpınarı Caddesi', type: 'main', major: true,
    points: [[-150, 830], [-176, 580], [-198, 320], [-192, 50], [-172, -210], [-152, -430]]
  },
  {
    name: 'Gazino Caddesi', type: 'main', major: true,
    points: [[196, 790], [212, 540], [228, 290], [240, 40], [250, -190], [246, -400]]
  },
  {
    name: 'Sanatoryum Caddesi', type: 'main', major: true,
    points: [[-472, 720], [-512, 470], [-538, 220], [-524, -30], [-492, -250], [-470, -430]]
  },
  {
    name: 'Estergon Caddesi', type: 'main', major: true,
    points: [[418, 620], [438, 400], [462, 180], [498, -40], [520, -260], [498, -480]]
  },
  {
    name: 'Aktepe Caddesi', type: 'street',
    points: [[-322, 470], [-336, 290], [-352, 60], [-330, -200], [-302, -430]]
  },
  {
    name: 'İncirli Caddesi', type: 'street',
    points: [[-690, 500], [-706, 330], [-728, 80], [-712, -160], [-690, -330]]
  },
  {
    name: 'Yayla Caddesi', type: 'street',
    points: [[672, 470], [686, 290], [700, 40], [692, -210], [668, -380]]
  },
  {
    name: 'Bağlum Yolu', type: 'avenue', major: true,
    points: [[58, -520], [92, -660], [148, -800], [186, -890]]
  },
  {
    name: 'Ovacık Caddesi', type: 'street',
    points: [[352, -330], [368, -470], [352, -620], [318, -740]]
  },
  {
    name: 'Güçlükaya Caddesi', type: 'street',
    points: [[-560, -120], [-596, -300], [-604, -470], [-566, -620]]
  },

  // ---------- doğu-batı eksen ----------
  {
    name: 'Kuzey Çevre Yolu', type: 'highway', major: true,
    points: [[-890, -742], [-520, -790], [-120, -822], [280, -812], [640, -770], [890, -724]]
  },
  {
    name: 'Kalaba Caddesi', type: 'main', major: true,
    points: [[-640, -518], [-300, -546], [-40, -562], [260, -556], [560, -520]]
  },
  {
    name: 'Aktepe Bulvarı', type: 'avenue', major: true,
    points: [[-830, -300], [-460, -324], [-140, -340], [200, -344], [520, -320], [760, -294]]
  },
  {
    name: 'Şehit Cengiz Karaca Caddesi', type: 'avenue', major: true,
    points: [[-866, -50], [-500, -74], [-180, -92], [140, -96], [470, -74], [742, -46]]
  },
  {
    name: 'Etlik Caddesi', type: 'main', major: true,
    points: [[-842, 190], [-520, 168], [-210, 152], [90, 144], [400, 164], [700, 190]]
  },
  {
    name: 'Subayevleri Caddesi', type: 'main', major: true,
    points: [[-806, 432], [-460, 414], [-150, 402], [180, 396], [500, 418], [742, 444]]
  },
  {
    name: 'Aşağı Eğlence Caddesi', type: 'main', major: true,
    points: [[-628, 664], [-300, 650], [-20, 644], [280, 656], [560, 682]]
  },
  {
    name: 'Basınevleri Caddesi', type: 'street',
    points: [[-430, 846], [-120, 858], [180, 852], [452, 830]]
  },
  {
    name: 'Kuşcağız Caddesi', type: 'street',
    points: [[300, -190], [430, -206], [560, -196], [700, -170]]
  },
  {
    name: 'Şenlik Sokak', type: 'street',
    points: [[120, 268], [300, 262], [470, 274], [640, 296]]
  },
  {
    name: 'Pınarbaşı Sokak', type: 'street',
    points: [[-360, 548], [-80, 540], [180, 546], [420, 560]]
  },
  {
    name: 'Hasköy Sokak', type: 'street',
    points: [[-700, 752], [-420, 744], [-160, 750]]
  },
  {
    name: 'Esertepe Sokak', type: 'street',
    points: [[-780, -170], [-500, -186], [-250, -196], [-40, -204]]
  },
  {
    name: 'Uyanış Sokak', type: 'street',
    points: [[-540, 300], [-300, 292], [-60, 286], [160, 292]]
  },
  {
    name: 'Yükseltepe Sokak', type: 'street',
    points: [[60, -440], [260, -448], [440, -436], [600, -412]]
  },
  {
    name: 'Emrah Sokak', type: 'street',
    points: [[-620, 60], [-400, 48], [-180, 40], [40, 42]]
  },
  {
    name: 'Gümüşdere Sokak', type: 'street',
    points: [[210, 520], [420, 528], [610, 552]]
  },
  {
    name: 'Kavacık Sokak', type: 'street',
    points: [[-660, -640], [-380, -664], [-120, -676], [120, -684]]
  },
  {
    name: 'Atapark Sokak', type: 'lane',
    points: [[-260, 470], [-244, 340], [-236, 210]]
  },
  {
    name: 'Botanik Yolu', type: 'lane',
    points: [[-180, -420], [-90, -470], [30, -486], [150, -466]]
  },
  {
    name: 'Estergon Rampası', type: 'lane',
    points: [[470, -150], [530, -172], [582, -196], [612, -228]]
  },
  {
    name: 'Hastane Yolu', type: 'lane',
    points: [[-536, 120], [-616, 148], [-694, 190], [-720, 250]]
  },
  {
    name: 'Stadyum Yolu', type: 'lane',
    points: [[-336, -330], [-380, -410], [-402, -500]]
  }
];

/**
 * Minor connectors filled in between the arteries so the blocks feel dense.
 * Generated deterministically at build time (see network.js).
 */
export const FILLER_GRID = {
  spacingX: 132,
  spacingZ: 128,
  jitter: 26,
  type: 'lane',
  keepChance: 0.62
};

/** Neighbourhood centres — used for the on-screen "you are here" label. */
export const ZONES = [
  { name: 'Basınevleri', x: 20, z: 840 },
  { name: 'Hasköy', x: -430, z: 750 },
  { name: 'Aşağı Eğlence', x: 40, z: 650 },
  { name: 'Pınarbaşı', x: 260, z: 540 },
  { name: 'Subayevleri', x: -250, z: 420 },
  { name: 'Gümüşdere', x: 470, z: 540 },
  { name: 'Yukarı Eğlence', x: 10, z: 300 },
  { name: 'Etlik', x: -560, z: 210 },
  { name: 'İncirli', x: -720, z: 170 },
  { name: 'Şenlik', x: 330, z: 270 },
  { name: 'Yayla', x: 690, z: 120 },
  { name: 'Sanatoryum', x: -520, z: -60 },
  { name: 'Güçlükaya', x: -740, z: -120 },
  { name: 'Keçiören Merkez', x: 30, z: -80 },
  { name: 'Kuşcağız', x: 470, z: -200 },
  { name: 'Estergon', x: 580, z: -220 },
  { name: 'Esertepe', x: -300, z: -210 },
  { name: 'Aktepe', x: -330, z: -350 },
  { name: 'Yükseltepe', x: 260, z: -440 },
  { name: 'Kalaba', x: -20, z: -556 },
  { name: 'Ovacık', x: 350, z: -560 },
  { name: 'Bağlum Yolu', x: 150, z: -800 },
  { name: 'Kuzey Çevre Yolu', x: -500, z: -790 }
];

/**
 * Hand-placed landmarks. `radius` keeps procedural buildings and trees away.
 */
export const LANDMARKS = [
  { id: 'estergon',  name: 'Estergon Kalesi',        x: 596, z: -232, rot: -0.4, radius: 92 },
  { id: 'hospital',  name: 'Etlik Şehir Hastanesi',  x: -700, z: 268, rot: 0.18, radius: 130 },
  { id: 'belediye',  name: 'Keçiören Belediyesi',    x: 78, z: 216, rot: -0.06, radius: 62 },
  { id: 'botanik',   name: 'Keçiören Botanik Parkı', x: -30, z: -470, rot: 0, radius: 175 },
  { id: 'camii',     name: 'Atapark Camii',          x: -262, z: 402, rot: 0.35, radius: 60 },
  { id: 'stadyum',   name: 'Aktepe Stadyumu',        x: -428, z: -520, rot: 0.1, radius: 108 },
  { id: 'metro',     name: 'Keçiören Metro İstasyonu', x: -30, z: 92, rot: 0, radius: 26 },
  { id: 'kultur',    name: 'Neşet Ertaş Sanat Merkezi', x: 300, z: 60, rot: -0.2, radius: 48 },
  { id: 'pazar',     name: 'Kalaba Pazar Yeri',      x: 130, z: -600, rot: 0.05, radius: 58 },
  { id: 'avm',       name: 'Keçiören AVM',           x: 300, z: -100, rot: 0.12, radius: 70 }
];

/** Cable-car alignment: Estergon hill → Yükseltepe, like the real teleferik. */
export const TELEFERIK = {
  name: 'Keçiören Teleferiği',
  from: [598, -300],
  to: [96, 6],
  towerCount: 5,
  cabinCount: 6,
  cableHeight: 30,
  speed: 5.2
};

/** Where the player can be dropped with the "N" key. */
export const SPAWN_POINTS = [
  { name: 'Keçiören Merkez', x: 0, z: 40, yaw: Math.PI },
  { name: 'Estergon Kalesi', x: 500, z: -150, yaw: -Math.PI / 2 },
  { name: 'Etlik Şehir Hastanesi', x: -620, z: 190, yaw: 0 },
  { name: 'Kalaba', x: -20, z: -540, yaw: Math.PI / 2 },
  { name: 'Botanik Parkı', x: 30, z: -470, yaw: 0 },
  { name: 'Aşağı Eğlence', x: -10, z: 644, yaw: Math.PI },
  { name: 'Kuzey Çevre Yolu', x: -120, z: -816, yaw: Math.PI / 2 },
  { name: 'Subayevleri', x: -150, z: 400, yaw: Math.PI / 2 },
  { name: 'Aktepe Stadyumu', x: -340, z: -420, yaw: Math.PI },
  { name: 'Yayla', x: 692, z: -50, yaw: 0 }
];
