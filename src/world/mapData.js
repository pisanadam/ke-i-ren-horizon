import { makeRng } from '../util/math.js';

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
  half: 4600,          // playable area spans -4600..4600 on both axes
  groundSize: 11800    // backdrop terrain is larger so the horizon stays filled
};

/**
 * Ankara is roughly 45 km across; driving that at 1:1 would be forty minutes
 * of empty motorway. Distances are squeezed by about three and a half to one,
 * more in the far suburbs, which keeps every district a believable drive apart
 * while the layout still reads like the real city: Keçiören in the north,
 * Ulus and the castle below it, Kızılay in the middle, Çankaya on the ridge,
 * Eskişehir Yolu running out to the south-west and İstanbul Yolu to Sincan in
 * the west.
 */

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
  },

  // ======================= ANKARA GENELİ =======================
  // ---------- omurga: Atatürk Bulvarı ----------
  {
    name: 'Atatürk Bulvarı', type: 'avenue', major: true,
    points: [[30, 880], [44, 1120], [34, 1360], [24, 1620], [16, 1900],
      [8, 2170], [0, 2450], [-14, 2740], [-30, 3020], [-44, 3260]]
  },
  {
    name: 'Konya Yolu', type: 'highway', major: true,
    points: [[-44, 3260], [30, 3520], [140, 3800], [246, 4080], [330, 4340]]
  },

  // ---------- batı: İstanbul Yolu ve Sincan ----------
  {
    name: 'İstanbul Yolu', type: 'highway', major: true,
    points: [[24, 1620], [-330, 1520], [-760, 1420], [-1240, 1310],
      [-1760, 1200], [-2260, 1120], [-2820, 1060], [-3400, 1010],
      [-3960, 980], [-4420, 960]]
  },
  {
    name: 'Ostim Bulvarı', type: 'avenue', major: true,
    points: [[-2260, 1120], [-2180, 860], [-2060, 620], [-1900, 430]]
  },
  {
    name: 'Batıkent Bulvarı', type: 'avenue', major: true,
    points: [[-2820, 1060], [-2760, 780], [-2640, 520], [-2480, 320]]
  },
  {
    name: 'Sincan Caddesi', type: 'main', major: true,
    points: [[-4420, 960], [-4460, 700], [-4400, 450], [-4260, 250]]
  },
  {
    name: 'Etimesgut Caddesi', type: 'main', major: true,
    points: [[-3400, 1010], [-3440, 1260], [-3380, 1500], [-3240, 1680]]
  },

  // ---------- güneybatı: Eskişehir Yolu ----------
  {
    name: 'Eskişehir Yolu', type: 'highway', major: true,
    points: [[8, 2170], [-360, 2270], [-780, 2390], [-1220, 2530],
      [-1680, 2680], [-2140, 2830], [-2620, 2960], [-3080, 3060]]
  },
  {
    name: 'Söğütözü Bulvarı', type: 'avenue', major: true,
    points: [[-1220, 2530], [-1280, 2780], [-1240, 3020], [-1120, 3220]]
  },
  {
    name: 'ODTÜ Yolu', type: 'main',
    points: [[-1680, 2680], [-1780, 2940], [-1840, 3200], [-1760, 3440]]
  },
  {
    name: 'Bilkent Bulvarı', type: 'main', major: true,
    points: [[-2140, 2830], [-2260, 3080], [-2320, 3340], [-2240, 3580]]
  },
  {
    name: 'Çayyolu Caddesi', type: 'main', major: true,
    points: [[-2620, 2960], [-2760, 3200], [-2820, 3460], [-2720, 3700]]
  },

  // ---------- doğu: Samsun Yolu ve Mamak ----------
  {
    name: 'Samsun Yolu', type: 'highway', major: true,
    points: [[16, 1900], [430, 1850], [860, 1810], [1300, 1780],
      [1760, 1760], [2220, 1750], [2660, 1760]]
  },
  {
    name: 'Mamak Caddesi', type: 'main', major: true,
    points: [[860, 1810], [960, 2060], [1030, 2320], [1060, 2580], [1010, 2820]]
  },
  {
    name: 'Natoyolu', type: 'main', major: true,
    points: [[1300, 1780], [1420, 1520], [1480, 1250], [1440, 1000]]
  },
  {
    name: 'Tuzluçayır Caddesi', type: 'street',
    points: [[1060, 2580], [1300, 2660], [1540, 2700], [1760, 2680]]
  },

  // ---------- kuzeydoğu: Esenboğa Yolu ----------
  {
    name: 'Esenboğa Yolu', type: 'highway', major: true,
    points: [[58, -520], [330, -760], [640, -1080], [960, -1480],
      [1300, -1960], [1640, -2500], [1960, -3060], [2260, -3620], [2500, -4080]]
  },
  {
    name: 'Pursaklar Caddesi', type: 'main', major: true,
    points: [[960, -1480], [780, -1700], [680, -1960], [700, -2220]]
  },
  {
    name: 'Esenboğa Havalimanı Yolu', type: 'main', major: true,
    points: [[2260, -3620], [2520, -3760], [2760, -3860]]
  },

  // ---------- çevre yolu ----------
  {
    name: 'Batı Çevre Yolu', type: 'highway', major: true,
    points: [[-3960, 980], [-3720, 620], [-3300, 280], [-2760, 20],
      [-2140, -180], [-1460, -360], [-890, -742]]
  },
  {
    name: 'Doğu Çevre Yolu', type: 'highway', major: true,
    points: [[890, -724], [1320, -560], [1740, -300], [2060, 60],
      [2280, 500], [2400, 980], [2440, 1440]]
  },
  {
    name: 'Güney Çevre Yolu', type: 'highway', major: true,
    points: [[2440, 1440], [2400, 1960], [2280, 2460], [2040, 2940],
      [1660, 3340], [1160, 3620], [600, 3800], [330, 4340]]
  },
  {
    name: 'Güneybatı Çevre Yolu', type: 'highway', major: true,
    points: [[-3080, 3060], [-2560, 3400], [-1960, 3700], [-1280, 3900],
      [-620, 3980], [80, 3960], [600, 3800]]
  },

  // ---------- Ulus - Kızılay - Çankaya çekirdeği ----------
  {
    name: 'Anıtkabir Caddesi', type: 'avenue', major: true,
    points: [[8, 2170], [-230, 2110], [-470, 2060], [-700, 2080], [-880, 2180]]
  },
  {
    name: 'Celal Bayar Bulvarı', type: 'avenue', major: true,
    points: [[-880, 2180], [-900, 1940], [-840, 1700], [-700, 1520], [-500, 1420]]
  },
  {
    name: 'Cebeci Caddesi', type: 'main', major: true,
    points: [[8, 2170], [280, 2250], [540, 2330], [800, 2400], [1030, 2440]]
  },
  {
    name: 'Dikmen Caddesi', type: 'main', major: true,
    points: [[-14, 2740], [-180, 2960], [-300, 3200], [-360, 3450], [-330, 3680]]
  },
  {
    name: 'Bahçelievler Caddesi', type: 'main', major: true,
    points: [[-360, 2270], [-520, 2470], [-620, 2700], [-660, 2930]]
  },
  {
    name: 'Necatibey Caddesi', type: 'street',
    points: [[8, 2170], [-160, 2280], [-300, 2420], [-380, 2580]]
  },
  {
    name: 'Talatpaşa Bulvarı', type: 'main',
    points: [[24, 1620], [280, 1700], [520, 1790], [740, 1880]]
  },
  {
    name: 'Hipodrom Caddesi', type: 'main',
    points: [[-330, 1520], [-380, 1760], [-420, 2000], [-470, 2060]]
  },
  {
    name: 'Etlik Bağlantısı', type: 'main', major: true,
    points: [[-520, 700], [-420, 940], [-300, 1180], [-160, 1400], [24, 1620]]
  },
  {
    name: 'Yenimahalle Caddesi', type: 'main', major: true,
    points: [[-760, 1420], [-960, 1560], [-1120, 1740], [-1200, 1960]]
  },
  {
    name: 'Balgat Caddesi', type: 'street',
    points: [[-780, 2390], [-900, 2600], [-960, 2820], [-920, 3020]]
  },
  {
    name: 'Kavaklıdere Sokak', type: 'street',
    points: [[0, 2450], [220, 2520], [420, 2620], [580, 2740]]
  },
  {
    name: 'Gaziosmanpaşa Sokak', type: 'street',
    points: [[-30, 3020], [180, 3080], [380, 3160], [540, 3280]]
  },
  {
    name: 'Gölbaşı Caddesi', type: 'main', major: true,
    points: [[246, 4080], [460, 4200], [700, 4280], [940, 4300]]
  }
];

/**
 * Minor connectors filled in between the arteries so the blocks feel dense.
 * Generated deterministically at build time (see network.js).
 *
 * One patch per built-up area rather than a blanket over the whole map: the
 * hills between the districts are genuinely empty, and covering 92 km² in
 * side streets would be both wrong and unaffordable.
 */
export const DISTRICT_GRIDS = [
  // Keçiören — the original district, the densest street pattern on the map
  { x: 0, z: 0, w: 1780, h: 1780, spacing: 132, keep: 0.62, jitter: 26 },
  // Ulus / Altındağ / kale çevresi
  { x: 60, z: 1620, w: 900, h: 700, spacing: 118, keep: 0.72, jitter: 22 },
  // Kızılay / Sıhhiye / Cebeci
  { x: 180, z: 2240, w: 1150, h: 780, spacing: 124, keep: 0.7, jitter: 20 },
  // Çankaya / Kavaklıdere / Gaziosmanpaşa
  { x: 120, z: 2900, w: 1000, h: 720, spacing: 136, keep: 0.6, jitter: 24 },
  // Maltepe / Anıtkabir / Bahçelievler
  { x: -540, z: 2280, w: 900, h: 800, spacing: 130, keep: 0.62, jitter: 22 },
  // Dikmen
  { x: -300, z: 3350, w: 700, h: 640, spacing: 138, keep: 0.5, jitter: 26 },
  // Yenimahalle
  { x: -1000, z: 1700, w: 780, h: 700, spacing: 134, keep: 0.58, jitter: 24 },
  // Balgat / Söğütözü
  { x: -1080, z: 2820, w: 720, h: 640, spacing: 140, keep: 0.5, jitter: 22 },
  // Mamak
  { x: 1080, z: 2280, w: 820, h: 860, spacing: 142, keep: 0.52, jitter: 26 },
  // Batıkent
  { x: -2680, z: 700, w: 760, h: 720, spacing: 138, keep: 0.54, jitter: 24 },
  // Ostim
  { x: -2060, z: 760, w: 620, h: 560, spacing: 146, keep: 0.46, jitter: 22 },
  // Etimesgut
  { x: -3340, z: 1380, w: 660, h: 600, spacing: 142, keep: 0.5, jitter: 24 },
  // Sincan
  { x: -4340, z: 640, w: 620, h: 660, spacing: 138, keep: 0.54, jitter: 24 },
  // Çayyolu / Bilkent
  { x: -2520, z: 3300, w: 860, h: 700, spacing: 150, keep: 0.44, jitter: 26 },
  // Pursaklar
  { x: 760, z: -1950, w: 560, h: 560, spacing: 144, keep: 0.46, jitter: 24 },
  // Gölbaşı
  { x: 620, z: 4200, w: 700, h: 460, spacing: 148, keep: 0.42, jitter: 24 }
];



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
  { name: 'Kuzey Çevre Yolu', x: -500, z: -790 },

  // ---- Ankara geneli ----
  { name: 'Dışkapı', x: 38, z: 1180 },
  { name: 'Ulus', x: 22, z: 1660 },
  { name: 'Ankara Kalesi', x: 130, z: 1600 },
  { name: 'Sıhhiye', x: 16, z: 1950 },
  { name: 'Kızılay', x: 8, z: 2200 },
  { name: 'Cebeci', x: 560, z: 2340 },
  { name: 'Kavaklıdere', x: 0, z: 2470 },
  { name: 'Gaziosmanpaşa', x: 260, z: 3090 },
  { name: 'Çankaya', x: -30, z: 3020 },
  { name: 'Dikmen', x: -310, z: 3380 },
  { name: 'Maltepe', x: -240, z: 2120 },
  { name: 'Anıtkabir', x: -520, z: 2070 },
  { name: 'Tandoğan', x: -880, z: 2180 },
  { name: 'Bahçelievler', x: -560, z: 2520 },
  { name: 'Emek', x: -650, z: 2860 },
  { name: 'Balgat', x: -930, z: 2700 },
  { name: 'Söğütözü', x: -1250, z: 2800 },
  { name: 'Eskişehir Yolu', x: -1700, z: 2690 },
  { name: 'ODTÜ', x: -1800, z: 3080 },
  { name: 'Bilkent', x: -2260, z: 3160 },
  { name: 'Çayyolu', x: -2740, z: 3320 },
  { name: 'Hipodrom', x: -390, z: 1780 },
  { name: 'Yenimahalle', x: -1080, z: 1740 },
  { name: 'İstanbul Yolu', x: -1500, z: 1260 },
  { name: 'Ostim', x: -2100, z: 780 },
  { name: 'Batıkent', x: -2700, z: 720 },
  { name: 'Etimesgut', x: -3400, z: 1400 },
  { name: 'Sincan', x: -4380, z: 700 },
  { name: 'Mamak', x: 1000, z: 2300 },
  { name: 'Tuzluçayır', x: 1450, z: 2680 },
  { name: 'Natoyolu', x: 1450, z: 1300 },
  { name: 'Samsun Yolu', x: 1800, z: 1760 },
  { name: 'Pursaklar', x: 720, z: -1980 },
  { name: 'Esenboğa', x: 2400, z: -3700 },
  { name: 'Gölbaşı', x: 640, z: 4230 },
  { name: 'Konya Yolu', x: 150, z: 3800 },
  { name: 'Doğu Çevre Yolu', x: 2300, z: 700 }
];

/**
 * Hand-placed landmarks. `radius` keeps procedural buildings and trees away.
 */
export const LANDMARKS = [
  { id: 'estergon',  name: 'Estergon Kalesi',        x: 596, z: -232, rot: -0.4, radius: 92 },
  { id: 'hospital',  name: 'Etlik Şehir Hastanesi',  x: -700, z: 268, rot: 0.18, radius: 130 },
  { id: 'belediye',  name: 'Keçiören Belediyesi',    x: 78, z: 216, rot: -0.06, radius: 62 },
  { id: 'botanik',   name: 'Keçiören Botanik Parkı', x: -30, z: -470, rot: 0, radius: 175, green: true },
  { id: 'camii',     name: 'Atapark Camii',          x: -262, z: 402, rot: 0.35, radius: 60 },
  { id: 'stadyum',   name: 'Aktepe Stadyumu',        x: -428, z: -520, rot: 0.1, radius: 108, green: true },
  { id: 'metro',     name: 'Keçiören Metro İstasyonu', x: -30, z: 92, rot: 0, radius: 26 },
  { id: 'kultur',    name: 'Neşet Ertaş Sanat Merkezi', x: 300, z: 60, rot: -0.2, radius: 48 },
  { id: 'pazar',     name: 'Kalaba Pazar Yeri',      x: 130, z: -600, rot: 0.05, radius: 58 },
  { id: 'avm',       name: 'Keçiören AVM',           x: 300, z: -100, rot: 0.12, radius: 70 },

  // ---- Ankara geneli ----
  { id: 'anitkabir', name: 'Anıtkabir',              x: -520, z: 2070, rot: 0, radius: 260, green: true },
  { id: 'kale',      name: 'Ankara Kalesi',          x: 130, z: 1600, rot: 0.3, radius: 120 },
  { id: 'kocatepe',  name: 'Kocatepe Camii',         x: 150, z: 2330, rot: -0.15, radius: 78 },
  { id: 'tbmm',      name: 'TBMM',                   x: -300, z: 2330, rot: 0.1, radius: 150 },
  { id: 'atakule',   name: 'Atakule',                x: -40, z: 2980, rot: 0, radius: 62 },
  { id: 'genclik',   name: 'Gençlik Parkı',          x: -110, z: 1830, rot: 0, radius: 165, green: true },
  { id: 'asti',      name: 'AŞTİ Otogar',            x: -700, z: 2350, rot: -0.12, radius: 130 },
  { id: 'hipodrom',  name: 'Ankara Hipodromu',       x: -420, z: 1790, rot: 0.08, radius: 190, green: true },
  { id: 'stat19',    name: '19 Mayıs Stadyumu',      x: -180, z: 1980, rot: 0.05, radius: 100 },
  { id: 'odtu',      name: 'ODTÜ Kampüsü',           x: -1800, z: 3080, rot: 0.2, radius: 300, green: true },
  { id: 'bilkent',   name: 'Bilkent Üniversitesi',   x: -2260, z: 3160, rot: -0.15, radius: 200, green: true },
  { id: 'armada',    name: 'Armada AVM',             x: -1180, z: 2660, rot: 0.1, radius: 86 },
  { id: 'esenboga',  name: 'Esenboğa Havalimanı',    x: 2660, z: -3800, rot: 0.12, radius: 340 },
  { id: 'golbasi',   name: 'Mogan Gölü',             x: 700, z: 4260, rot: 0, radius: 320, green: true },
  { id: 'ostimsan',  name: 'Ostim Sanayi',           x: -2100, z: 780, rot: 0.06, radius: 180 },
  { id: 'sincanmrk', name: 'Sincan Meydanı',         x: -4380, z: 700, rot: 0, radius: 90 },
  { id: 'batikent',  name: 'Batıkent Meydanı',       x: -2700, z: 720, rot: 0.1, radius: 90 },
  { id: 'mamakmrk',  name: 'Mamak Belediyesi',       x: 1000, z: 2300, rot: -0.1, radius: 70 }
];

/**
 * Ankara Metrosu. The alignments follow the real network — M4 down the
 * Keçiören valley to Kızılay, M1 out to Batıkent, M3 on to Sincan, M2 along
 * Eskişehir Yolu to Çayyolu, and the Ankaray crossing east-west through
 * Kızılay. Everything runs on a viaduct here rather than in tube: a metro you
 * cannot see is not much of a metro to drive past.
 *
 * `stations` are stops in order; the running line is a smooth curve through
 * them. `gauge` metres is the spacing between the two tracks.
 */
export const METRO_LINES = [
  {
    id: 'M4', name: 'M4 Keçiören — Kızılay', colour: 0xd0342c, gauge: 4.2,
    stations: [
      { name: 'Keçiören', x: -30, z: 92 },
      { name: 'Kuyubaşı', x: 4, z: 392 },
      { name: 'Dutluk', x: 26, z: 664 },
      { name: 'Meydan', x: 36, z: 902 },
      { name: 'Dışkapı', x: 46, z: 1148 },
      { name: 'Meteoroloji', x: 38, z: 1372 },
      { name: 'AKM', x: 28, z: 1560 },
      { name: 'Ulus', x: 20, z: 1690 },
      { name: 'Sıhhiye', x: 12, z: 1922 },
      { name: 'Kızılay', x: 4, z: 2186 }
    ]
  },
  {
    id: 'M1', name: 'M1 Kızılay — Batıkent', colour: 0x1f6fd0, gauge: 4.2,
    stations: [
      { name: 'Kızılay', x: 22, z: 2206 },
      { name: 'Sıhhiye', x: 30, z: 1942 },
      { name: 'Ulus', x: 38, z: 1706 },
      { name: 'AKM', x: 46, z: 1572 },
      { name: 'Akköprü', x: -140, z: 1524 },
      { name: 'İvedik', x: -420, z: 1478 },
      { name: 'Yenimahalle', x: -760, z: 1444 },
      { name: 'Demetevler', x: -1100, z: 1374 },
      { name: 'Hastane', x: -1420, z: 1318 },
      { name: 'Macunköy', x: -1780, z: 1226 },
      { name: 'Ostim', x: -2120, z: 1152 },
      { name: 'Batıkent', x: -2520, z: 1098 }
    ]
  },
  {
    id: 'M3', name: 'M3 Batıkent — Sincan', colour: 0x2e9e5b, gauge: 4.2,
    stations: [
      { name: 'Batıkent', x: -2520, z: 1122 },
      { name: 'Şentepe', x: -2800, z: 1088 },
      { name: 'Erler', x: -3120, z: 1052 },
      { name: 'Etimesgut', x: -3420, z: 1030 },
      { name: 'Eryaman', x: -3760, z: 1004 },
      { name: 'Törekent', x: -4120, z: 982 },
      { name: 'Sincan', x: -4440, z: 966 }
    ]
  },
  {
    id: 'M2', name: 'M2 Kızılay — Çayyolu', colour: 0xe08a1e, gauge: 4.2,
    stations: [
      { name: 'Kızılay', x: -8, z: 2226 },
      { name: 'Necatibey', x: -180, z: 2300 },
      { name: 'Milli Kütüphane', x: -380, z: 2296 },
      { name: 'Söğütözü', x: -800, z: 2414 },
      { name: 'MTA', x: -1240, z: 2554 },
      { name: 'ODTÜ', x: -1700, z: 2704 },
      { name: 'Bilkent', x: -2160, z: 2854 },
      { name: 'Beytepe', x: -2400, z: 2916 },
      { name: 'Ümitköy', x: -2640, z: 2984 },
      { name: 'Çayyolu', x: -2860, z: 3046 },
      { name: 'Koru', x: -3100, z: 3084 }
    ]
  },
  {
    id: 'A1', name: 'Ankaray AŞTİ — Dikimevi', colour: 0x3fb6cf, gauge: 4.0,
    stations: [
      { name: 'AŞTİ', x: -716, z: 2374 },
      { name: 'Emek', x: -566, z: 2452 },
      { name: 'Bahçelievler', x: -454, z: 2384 },
      { name: 'Beşevler', x: -372, z: 2312 },
      { name: 'Anadolu', x: -262, z: 2216 },
      { name: 'Maltepe', x: -132, z: 2192 },
      { name: 'Kızılay', x: 18, z: 2242 },
      { name: 'Kolej', x: 216, z: 2286 },
      { name: 'Kurtuluş', x: 436, z: 2334 },
      { name: 'Dikimevi', x: 672, z: 2382 }
    ]
  }
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
  { name: 'Yayla', x: 692, z: -50, yaw: 0 },

  // ---- Ankara geneli ----
  { name: 'Ulus', x: 22, z: 1660, yaw: Math.PI },
  { name: 'Kızılay', x: 8, z: 2200, yaw: Math.PI },
  { name: 'Anıtkabir', x: -700, z: 2080, yaw: Math.PI / 2 },
  { name: 'Çankaya', x: -20, z: 2900, yaw: 0 },
  { name: 'Atakule', x: -30, z: 3020, yaw: Math.PI },
  { name: 'AŞTİ', x: -780, z: 2390, yaw: Math.PI / 2 },
  { name: 'ODTÜ', x: -1680, z: 2680, yaw: -Math.PI / 2 },
  { name: 'Çayyolu', x: -2620, z: 2960, yaw: Math.PI / 2 },
  { name: 'Mamak', x: 860, z: 1810, yaw: Math.PI },
  { name: 'Yenimahalle', x: -760, z: 1420, yaw: Math.PI / 2 },
  { name: 'Ostim', x: -2100, z: 780, yaw: 0 },
  { name: 'Batıkent', x: -2760, z: 780, yaw: 0 },
  { name: 'Etimesgut', x: -3400, z: 1010, yaw: Math.PI / 2 },
  { name: 'Sincan', x: -4420, z: 960, yaw: 0 },
  { name: 'Pursaklar', x: 780, z: -1700, yaw: Math.PI },
  { name: 'Esenboğa Havalimanı', x: 2500, z: -4080, yaw: Math.PI },
  { name: 'Gölbaşı', x: 330, z: 4340, yaw: -Math.PI / 2 }
];

/**
 * Ankara does not stop between its districts, and neither should the map:
 * outside the named centres the ground was empty hillside for kilometres.
 *
 * Smaller settlements are laid on a jittered lattice over everything the hand
 * -placed districts do not already cover — the villages, industrial strips
 * and outer neighbourhoods that fill the gaps in the real city. Each is a
 * small grid of streets; the roads that join them up are generated with them.
 */
const FILLER = (() => {
  const rng = makeRng(90210);
  const grids = [];
  const links = [];
  const centres = [];
  const STEP = 610;
  const EDGE = MAP.half - 260;

  const insideNamed = (x, z) => DISTRICT_GRIDS.some((g) =>
    Math.abs(x - g.x) < g.w * 0.5 + 300 && Math.abs(z - g.z) < g.h * 0.5 + 300);
  const onLandmark = (x, z) => LANDMARKS.some((l) =>
    Math.hypot(x - l.x, z - l.z) < l.radius + 160);

  for (let gx = -EDGE; gx <= EDGE; gx += STEP) {
    for (let gz = -EDGE; gz <= EDGE; gz += STEP) {
      const x = Math.round(gx + (rng() - 0.5) * STEP * 0.45);
      const z = Math.round(gz + (rng() - 0.5) * STEP * 0.45);
      if (Math.abs(x) > EDGE || Math.abs(z) > EDGE) continue;
      if (insideNamed(x, z) || onLandmark(x, z)) continue;

      // the further from the centre, the smaller and sparser the settlement
      const far = Math.min(1, Math.hypot(x, z - 1600) / (MAP.half * 0.9));
      const size = Math.round(500 - far * 150);
      grids.push({
        x, z, w: size, h: Math.round(size * (0.8 + rng() * 0.4)),
        spacing: Math.round(150 + far * 44),
        keep: 0.62 - far * 0.22,
        jitter: 18 + Math.round(rng() * 14)
      });
      centres.push({ x, z });
    }
  }

  // join each settlement to its two nearest neighbours, so nothing is stranded
  const seen = new Set();
  for (let i = 0; i < centres.length; i++) {
    const a = centres[i];
    const near = centres
      .map((c, j) => ({ c, j, d: Math.hypot(c.x - a.x, c.z - a.z) }))
      .filter((o) => o.j !== i && o.d < STEP * 1.9)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2);
    for (const n of near) {
      const key = i < n.j ? `${i}-${n.j}` : `${n.j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = n.c;
      // a gently bent connector rather than a dead-straight line
      const mx = (a.x + b.x) / 2 + (rng() - 0.5) * 130;
      const mz = (a.z + b.z) / 2 + (rng() - 0.5) * 130;
      links.push({
        name: `Bağlantı Yolu ${links.length + 1}`,
        type: n.d > STEP * 1.35 ? 'main' : 'street',
        points: [
          [a.x, a.z],
          [Math.round(a.x + (mx - a.x) * 0.55), Math.round(a.z + (mz - a.z) * 0.55)],
          [Math.round(mx), Math.round(mz)],
          [Math.round(mx + (b.x - mx) * 0.55), Math.round(mz + (b.z - mz) * 0.55)],
          [b.x, b.z]
        ]
      });
    }
  }
  return { grids, links };
})();

DISTRICT_GRIDS.push(...FILLER.grids);
ROADS.push(...FILLER.links);

/**
 * Jump ramps. Placed beside the arteries where there is room to get a run at
 * them; the height field knows about these, so they are driven up rather than
 * driven through.
 */
export const RAMPS = [
  { x: 210, z: -120, yaw: 0.1, len: 22, wide: 9, rise: 3.4 },
  { x: -300, z: -350, yaw: 1.6, len: 26, wide: 10, rise: 4.2 },
  { x: 620, z: 300, yaw: -1.5, len: 20, wide: 8, rise: 3.0 },
  { x: -120, z: 1310, yaw: 0.05, len: 28, wide: 11, rise: 4.6 },
  { x: 300, z: 1880, yaw: -1.55, len: 24, wide: 9, rise: 3.8 },
  { x: -560, z: 2600, yaw: 0.9, len: 26, wide: 10, rise: 4.4 },
  { x: 900, z: 2000, yaw: 3.0, len: 22, wide: 9, rise: 3.4 },
  { x: -1180, z: 2450, yaw: -0.4, len: 30, wide: 11, rise: 5.2 },
  { x: -2000, z: 980, yaw: 1.2, len: 26, wide: 10, rise: 4.2 },
  { x: -3100, z: 1120, yaw: 0.2, len: 24, wide: 9, rise: 3.8 },
  { x: 1450, z: -2100, yaw: -0.8, len: 28, wide: 10, rise: 4.8 },
  { x: 60, z: 3600, yaw: 0.4, len: 30, wide: 11, rise: 5.4 },
  { x: 1750, z: 900, yaw: 2.2, len: 24, wide: 9, rise: 3.6 },
  { x: -700, z: -520, yaw: -1.1, len: 22, wide: 9, rise: 3.2 }
];

/** Local ramp coordinates for a world point, or null if it is not on one. */
export function rampAt(x, z) {
  for (const r of RAMPS) {
    const dx = x - r.x;
    const dz = z - r.z;
    // into the ramp's frame: u runs up the slope, v across it. Forward is
    // (sin yaw, cos yaw) and right is (cos yaw, -sin yaw), the same basis
    // ramps.js meshes with — getting the sign wrong skews the drivable
    // surface away from the one you can see.
    const c = Math.cos(r.yaw);
    const sn = Math.sin(r.yaw);
    const u = dx * sn + dz * c;
    const v = dx * c - dz * sn;
    if (u < 0 || u > r.len) continue;
    if (Math.abs(v) > r.wide / 2) continue;
    return { ramp: r, u: u / r.len, v: v / (r.wide / 2) };
  }
  return null;
}
