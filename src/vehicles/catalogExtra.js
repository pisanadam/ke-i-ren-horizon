/**
 * The rest of the garage: family cars, sports cars, supercars and a Japanese
 * shelf, plus the two electrics people actually ask for by name.
 *
 * Only the numbers that make a car itself are spelled out; `car()` fills in
 * the rest of the body proportions so every entry stays readable.
 *
 * `voice` is what the car sounds like. `cyl` sets the firing frequency (a V8
 * fires twice as often per rev as a four), `harm`/`gain` shape the harmonics,
 * `q` is how much the resonance growls, `cut` is the filter sweep and `ex`
 * how much exhaust noise sits under it.
 */

const BODY = {
  length: 4.5, width: 1.8, wheelBase: 2.65, rideHeight: 0.24,
  bodyHeight: 0.60, cabinHeight: 0.54, wheelRadius: 0.32, wheelWidth: 0.22,
  cabinBack: -0.60, cabinFront: 0.28, roofBack: 0.18, roofFront: 0.22
};

const VOICE = {
  i4: { cyl: 4, harm: [1, 2.02, 0.5], gain: [0.40, 0.22, 0.30], type: ['sawtooth', 'sawtooth', 'square'], q: 6, cut: [420, 2600], ex: 1 },
  i4turbo: { cyl: 4, harm: [1, 2.01, 0.5], gain: [0.38, 0.30, 0.26], type: ['sawtooth', 'sawtooth', 'square'], q: 8, cut: [380, 3000], ex: 1.25, turbo: 0.7 },
  i6: { cyl: 6, harm: [1, 1.5, 2.0], gain: [0.34, 0.26, 0.22], type: ['sawtooth', 'sawtooth', 'triangle'], q: 5, cut: [400, 3200], ex: 1.0 },
  v6: { cyl: 6, harm: [1, 2.0, 0.5], gain: [0.36, 0.24, 0.28], type: ['sawtooth', 'square', 'sawtooth'], q: 7, cut: [360, 2900], ex: 1.1 },
  v8: { cyl: 8, harm: [1, 0.5, 1.5], gain: [0.40, 0.38, 0.20], type: ['sawtooth', 'square', 'sawtooth'], q: 9, cut: [260, 2600], ex: 1.5 },
  v10: { cyl: 10, harm: [1, 2.0, 3.0], gain: [0.34, 0.28, 0.18], type: ['sawtooth', 'sawtooth', 'sawtooth'], q: 8, cut: [420, 4200], ex: 1.4 },
  v12: { cyl: 12, harm: [1, 2.0, 4.0], gain: [0.30, 0.26, 0.16], type: ['sawtooth', 'sawtooth', 'triangle'], q: 6, cut: [520, 5200], ex: 1.35 },
  flat6: { cyl: 6, harm: [1, 2.0, 3.02], gain: [0.32, 0.30, 0.20], type: ['sawtooth', 'sawtooth', 'sawtooth'], q: 10, cut: [440, 4000], ex: 1.2 },
  rotary: { cyl: 3, harm: [1, 2.0, 3.0], gain: [0.22, 0.34, 0.26], type: ['sawtooth', 'sawtooth', 'sawtooth'], q: 12, cut: [700, 5600], ex: 1.3, redline: 8800 },
  kei: { cyl: 3, harm: [1, 2.0, 0.5], gain: [0.30, 0.26, 0.20], type: ['sawtooth', 'square', 'square'], q: 7, cut: [520, 3400], ex: 0.85, turbo: 0.5 },
  diesel: { cyl: 4, harm: [1, 0.5, 2.6], gain: [0.34, 0.40, 0.16], type: ['square', 'square', 'sawtooth'], q: 4, cut: [180, 1500], ex: 1.1, redline: 4600, clatter: 1 },
  electric: { electric: true, whine: [220, 34], q: 3, cut: 1100 }
};

function car(o) {
  const spec = { ...BODY, ...o };
  if (!spec.stats) {
    const pw = spec.power / spec.mass;
    spec.stats = {
      speed: Math.min(1, spec.topSpeed / 86),
      accel: Math.min(1, pw / 15),
      grip: Math.min(1, spec.grip / 1.5),
      brake: Math.min(1, spec.brake / 23000)
    };
  }
  return spec;
}

export const EXTRA_CARS = [
  // =========================== AİLE ARABALARI ===========================
  car({
    id: 'aile-sedan', name: 'Aile Sedanı', class: 'Aile',
    desc: 'Bagajı geniş, süspansiyonu yumuşak. Uzun yolda yormaz, şehirde uysal.',
    colours: [0xd8dde3, 0x2b3a55, 0x8f2f2f, 0x4a4d52, 0xe8e6df],
    length: 4.72, width: 1.83, wheelBase: 2.78, bodyHeight: 0.62, cabinHeight: 0.55,
    cabinBack: -0.58, cabinFront: 0.26, wheelRadius: 0.33,
    mass: 1420, power: 7200, topSpeed: 51, grip: 1.02, brake: 13500, steerMax: 0.58,
    voice: VOICE.i4
  }),
  car({
    id: 'station', name: 'Station Wagon', class: 'Aile',
    desc: 'Arkası uzun, tavan barı hazır. Bütün aile ve bavulları tek seferde.',
    colours: [0x36414d, 0xd9d5c9, 0x2f5f4a, 0x7a2f2a],
    length: 4.86, width: 1.84, wheelBase: 2.82, bodyHeight: 0.62, cabinHeight: 0.62,
    cabinBack: -0.72, cabinFront: 0.30, roofBack: 0.06, roofFront: 0.22, roofRack: true,
    wheelRadius: 0.33,
    mass: 1520, power: 7600, topSpeed: 50, grip: 1.00, brake: 13800, steerMax: 0.57,
    voice: VOICE.diesel
  }),
  car({
    id: 'kompakt', name: 'Kompakt Hatchback', class: 'Aile',
    desc: 'Küçük motor, düşük tüketim. Dar sokakta ve otoparkta hayat kurtarır.',
    colours: [0xe8e8e6, 0x2f6fae, 0xd84a3a, 0x1b1d21, 0x8fae4a],
    length: 4.02, width: 1.74, wheelBase: 2.54, bodyHeight: 0.60, cabinHeight: 0.56,
    cabinBack: -0.78, cabinFront: 0.34, wheelRadius: 0.30,
    mass: 1120, power: 6200, topSpeed: 46, grip: 1.02, brake: 12200, steerMax: 0.62,
    voice: VOICE.i4
  }),
  car({
    id: 'mpv', name: 'Aile MPV', class: 'Aile',
    desc: 'Yedi koltuk, yüksek tavan. Ağır ama içine bir mahalle sığar.',
    colours: [0xdad8d2, 0x39485c, 0x6a4a32],
    length: 4.72, width: 1.88, wheelBase: 2.86, rideHeight: 0.30,
    bodyHeight: 0.58, cabinHeight: 1.00, cabinBack: -0.82, cabinFront: 0.62,
    tall: true, wheelRadius: 0.33,
    mass: 1780, power: 8000, topSpeed: 45, grip: 0.94, brake: 13000, steerMax: 0.55,
    voice: VOICE.diesel
  }),
  car({
    id: 'crossover', name: 'Crossover', class: 'Aile',
    desc: 'SUV gibi görünür, sedan gibi sürülür. Ankara’nın en kalabalık türü.',
    colours: [0xb8bcc2, 0x2b3138, 0xe8e6df, 0x2f5f8f, 0x7a3f2a],
    length: 4.44, width: 1.84, wheelBase: 2.68, rideHeight: 0.32,
    bodyHeight: 0.68, cabinHeight: 0.60, cabinBack: -0.70, cabinFront: 0.30,
    wheelRadius: 0.35,
    mass: 1560, power: 8200, topSpeed: 49, grip: 1.04, brake: 13800, steerMax: 0.58,
    voice: VOICE.i4turbo
  }),
  car({
    id: 'mini-suv', name: 'Küçük SUV', class: 'Aile',
    desc: 'Yüksek oturuş, kısa gövde. Bozuk yolda rahat, park etmesi kolay.',
    colours: [0xe0dcd2, 0x30506b, 0x9a3a32, 0x3c4a3a],
    length: 4.24, width: 1.80, wheelBase: 2.60, rideHeight: 0.34,
    bodyHeight: 0.70, cabinHeight: 0.60, cabinBack: -0.72, cabinFront: 0.30,
    wheelRadius: 0.35,
    mass: 1440, power: 7400, topSpeed: 47, grip: 1.02, brake: 13000, steerMax: 0.60,
    voice: VOICE.i4
  }),
  car({
    id: 'ekonomik', name: 'Ekonomik Sedan', class: 'Aile',
    desc: 'Filoların vazgeçilmezi. Süsü yok, işi var; bozulmaz, yakmaz.',
    colours: [0xe8e8e6, 0x9aa0a6, 0x2b3a55, 0x1b1d21],
    length: 4.48, width: 1.78, wheelBase: 2.66, bodyHeight: 0.60, cabinHeight: 0.54,
    mass: 1260, power: 6000, topSpeed: 46, grip: 0.96, brake: 12000, steerMax: 0.58,
    voice: VOICE.i4
  }),
  car({
    id: 'hibrit', name: 'Hibrit Hatchback', class: 'Aile',
    desc: 'Şehirde elektrikle sessiz, yolda benzinle uzun menzilli.',
    colours: [0xdfe3e6, 0x2f6f5a, 0x1d2b3a, 0xc9d2d8],
    length: 4.36, width: 1.78, wheelBase: 2.70, bodyHeight: 0.58, cabinHeight: 0.54,
    cabinBack: -0.74, cabinFront: 0.30, wheelRadius: 0.31,
    mass: 1380, power: 7000, topSpeed: 47, grip: 1.06, brake: 13200, steerMax: 0.58,
    voice: { ...VOICE.i4, ex: 0.5, cut: [380, 2200] }
  }),
  car({
    id: 'ust-sedan', name: 'Üst Segment Sedan', class: 'Aile',
    desc: 'Uzun aks mesafesi, sessiz kabin. Arka koltuk için alınır.',
    colours: [0x1b1d21, 0xe8e6df, 0x2b3a55, 0x5c4a3a, 0x8f9298],
    length: 5.02, width: 1.90, wheelBase: 3.00, bodyHeight: 0.62, cabinHeight: 0.56,
    cabinBack: -0.56, cabinFront: 0.24, wheelRadius: 0.35,
    mass: 1820, power: 11000, topSpeed: 62, grip: 1.14, brake: 16500, steerMax: 0.55,
    voice: VOICE.i6
  }),
  car({
    id: 'minivan', name: 'Minivan', class: 'Aile',
    desc: 'Sürgülü kapı, düz zemin. Kalabalık aileler ve kalabalık bagajlar için.',
    colours: [0xdad8d2, 0x39485c, 0x8a8f95, 0x2f6fae],
    length: 4.96, width: 1.94, wheelBase: 3.06, rideHeight: 0.30,
    bodyHeight: 0.56, cabinHeight: 1.14, cabinBack: -0.86, cabinFront: 0.70,
    tall: true, acUnit: true, wheelRadius: 0.34,
    mass: 2000, power: 8600, topSpeed: 43, grip: 0.92, brake: 13500, steerMax: 0.53,
    voice: VOICE.diesel
  }),

  // ============================ SPOR ARABALAR ============================
  car({
    id: 'hot-hatch', name: 'Sıcak Hatchback', class: 'Spor',
    desc: 'Küçük gövdeye büyük turbo. Virajda inatçı, düz yolda şaşırtıcı.',
    colours: [0xd11f1f, 0xf0f0ee, 0x1b4fa0, 0x1b1d21, 0xf5a623],
    length: 4.12, width: 1.82, wheelBase: 2.58, rideHeight: 0.19,
    bodyHeight: 0.56, cabinHeight: 0.50, cabinBack: -0.76, cabinFront: 0.32,
    frontWidth: 0.99, spoiler: true, wheelRadius: 0.32, wheelWidth: 0.25,
    mass: 1310, power: 12000, topSpeed: 69, grip: 1.30, brake: 18500, steerMax: 0.58,
    voice: VOICE.i4turbo
  }),
  car({
    id: 'coupe-ri', name: 'Arka İtiş Coupé', class: 'Spor',
    desc: 'Uzun kaput, kısa arka. Gazla dönmeyi seven klasik kurulum.',
    colours: [0x1b1d21, 0xe8e6df, 0x8a1f2f, 0x2f4f8f],
    length: 4.54, width: 1.86, wheelBase: 2.70, rideHeight: 0.17,
    bodyHeight: 0.52, cabinHeight: 0.44, cabinBack: -0.52, cabinFront: 0.20,
    frontWidth: 0.98, noseDrop: 0.14, wheelRadius: 0.33, wheelWidth: 0.26,
    mass: 1480, power: 14000, topSpeed: 76, grip: 1.28, brake: 19000, steerMax: 0.56,
    voice: VOICE.i6
  }),
  car({
    id: 'kas', name: 'Kas Arabası', class: 'Spor',
    desc: 'Büyük V8, kalın lastik, gürültülü egzoz. Virajı sevmez, düzlüğü sever.',
    colours: [0x1f2225, 0xd11f1f, 0xf0a500, 0x2f4f8f, 0xe8e6df],
    length: 4.82, width: 1.96, wheelBase: 2.78, rideHeight: 0.18,
    bodyHeight: 0.54, cabinHeight: 0.44, cabinBack: -0.48, cabinFront: 0.18,
    rearWidth: 1.02, noseDrop: 0.10, spoiler: true, wheelRadius: 0.35, wheelWidth: 0.30,
    mass: 1720, power: 18000, topSpeed: 79, grip: 1.20, brake: 19500, steerMax: 0.52,
    voice: VOICE.v8
  }),
  car({
    id: 'roadster', name: 'Roadster', class: 'Spor',
    desc: 'Üstü açık, hafif, küçük. Hız değil his arabası.',
    colours: [0xd8dde3, 0x8a1f2f, 0x2f6f5a, 0x1b1d21, 0xf5c518],
    length: 3.96, width: 1.74, wheelBase: 2.32, rideHeight: 0.16,
    bodyHeight: 0.50, cabinHeight: 0.30, cabinBack: -0.42, cabinFront: 0.08,
    noseDrop: 0.14, wheelRadius: 0.31, wheelWidth: 0.24,
    mass: 1020, power: 9600, topSpeed: 63, grip: 1.32, brake: 16000, steerMax: 0.62,
    voice: { ...VOICE.i4, q: 8, cut: [500, 3400] }
  }),
  car({
    id: 'gt-coupe', name: 'GT Coupé', class: 'Spor',
    desc: 'Uzun yolun hızlısı. Ağır ama çok stabil, otobanda evinde.',
    colours: [0x2b3138, 0xe8e6df, 0x1b4fa0, 0x5c4a3a],
    length: 4.78, width: 1.94, wheelBase: 2.86, rideHeight: 0.17,
    bodyHeight: 0.52, cabinHeight: 0.44, cabinBack: -0.50, cabinFront: 0.20,
    noseDrop: 0.13, wheelRadius: 0.34, wheelWidth: 0.28,
    mass: 1690, power: 17000, topSpeed: 82, grip: 1.30, brake: 20500, steerMax: 0.53,
    voice: VOICE.v8
  }),
  car({
    id: 'ralli', name: 'Ralli Sedanı', class: 'Spor',
    desc: 'Dört çeker, kanatlı, yüksek. Toprakta asfalttan hızlı.',
    colours: [0x1b4fa0, 0xe8e6df, 0xd11f1f, 0x2b3138],
    length: 4.52, width: 1.84, wheelBase: 2.66, rideHeight: 0.24,
    bodyHeight: 0.58, cabinHeight: 0.52, cabinBack: -0.58, cabinFront: 0.26,
    spoiler: true, wheelRadius: 0.33, wheelWidth: 0.26,
    mass: 1480, power: 14500, topSpeed: 72, grip: 1.34, brake: 19000, steerMax: 0.60,
    voice: { ...VOICE.i4turbo, turbo: 1 }
  }),
  car({
    id: 'turbo-coupe', name: 'Turbo Coupé', class: 'Spor',
    desc: 'Turbo devreye girene kadar sakin, sonra bambaşka bir araba.',
    colours: [0xf0a500, 0x1b1d21, 0xd8dde3, 0x2f6f5a],
    length: 4.42, width: 1.88, wheelBase: 2.62, rideHeight: 0.16,
    bodyHeight: 0.50, cabinHeight: 0.42, cabinBack: -0.52, cabinFront: 0.20,
    frontWidth: 0.99, noseDrop: 0.14, spoiler: true, wheelRadius: 0.33, wheelWidth: 0.27,
    mass: 1420, power: 15500, topSpeed: 78, grip: 1.31, brake: 19500, steerMax: 0.56,
    voice: { ...VOICE.v6, turbo: 0.9 }
  }),
  car({
    id: 'pist', name: 'Pist Canavarı', class: 'Spor',
    desc: 'Klimasız, halısız, kafesli. Tek işi tur atmak.',
    colours: [0xf0f0ee, 0xd11f1f, 0x1b1d21, 0x34d3ff],
    length: 4.30, width: 1.94, wheelBase: 2.58, rideHeight: 0.12,
    bodyHeight: 0.46, cabinHeight: 0.38, cabinBack: -0.50, cabinFront: 0.18,
    frontWidth: 1.00, noseDrop: 0.16, spoiler: true, wheelRadius: 0.33, wheelWidth: 0.30,
    mass: 1180, power: 16000, topSpeed: 80, grip: 1.46, brake: 22000, steerMax: 0.56,
    voice: { ...VOICE.flat6, ex: 1.5 }
  }),
  car({
    id: 'cabrio-gt', name: 'Cabrio GT', class: 'Spor',
    desc: 'Üstü açık büyük tur arabası. Çankaya sırtlarında akşamüstü.',
    colours: [0xe8e6df, 0x8a1f2f, 0x2b3a55, 0x5c4a3a],
    length: 4.66, width: 1.90, wheelBase: 2.74, rideHeight: 0.17,
    bodyHeight: 0.54, cabinHeight: 0.28, cabinBack: -0.46, cabinFront: 0.10,
    noseDrop: 0.12, wheelRadius: 0.34, wheelWidth: 0.27,
    mass: 1620, power: 14800, topSpeed: 74, grip: 1.24, brake: 19000, steerMax: 0.55,
    voice: VOICE.v8
  }),
  car({
    id: 'super-hatch', name: 'Süper Hatch', class: 'Spor',
    desc: 'Beş kapılı ama süper otomobil hızında. Ailesini de alıp gider.',
    colours: [0x2f6f5a, 0xf0f0ee, 0x1b1d21, 0xd11f1f],
    length: 4.28, width: 1.86, wheelBase: 2.62, rideHeight: 0.18,
    bodyHeight: 0.56, cabinHeight: 0.50, cabinBack: -0.74, cabinFront: 0.32,
    frontWidth: 0.99, spoiler: true, wheelRadius: 0.33, wheelWidth: 0.27,
    mass: 1490, power: 15000, topSpeed: 75, grip: 1.34, brake: 20000, steerMax: 0.58,
    voice: { ...VOICE.i6, turbo: 0.8 }
  }),

  // =========================== SÜPER OTOMOBİLLER ==========================
  car({
    id: 'v12-super', name: 'V12 Süper Spor', class: 'Süper',
    desc: 'Ön ortada devasa V12. Sesi tek başına bir sebep.',
    colours: [0xd11f1f, 0x1b1d21, 0xf0f0ee, 0xf5c518, 0x1b4fa0],
    length: 4.72, width: 2.00, wheelBase: 2.72, rideHeight: 0.11,
    bodyHeight: 0.44, cabinHeight: 0.36, cabinBack: -0.44, cabinFront: 0.14,
    frontWidth: 1.00, rearWidth: 1.04, noseDrop: 0.18, spoiler: true,
    wheelRadius: 0.35, wheelWidth: 0.32,
    mass: 1620, power: 24000, topSpeed: 94, grip: 1.44, brake: 23000, steerMax: 0.52,
    voice: VOICE.v12
  }),
  car({
    id: 'v8-orta', name: 'Orta Motor V8', class: 'Süper',
    desc: 'Motor tam sırtında. Ağırlık ortada, tepki anında.',
    colours: [0xf0a500, 0x1b1d21, 0xd8dde3, 0x2f6f5a, 0x8a1f2f],
    length: 4.54, width: 1.98, wheelBase: 2.64, rideHeight: 0.10,
    bodyHeight: 0.42, cabinHeight: 0.34, cabinBack: -0.30, cabinFront: 0.24,
    frontWidth: 0.96, rearWidth: 1.06, noseDrop: 0.20, spoiler: true,
    wheelRadius: 0.35, wheelWidth: 0.33,
    mass: 1480, power: 23000, topSpeed: 92, grip: 1.48, brake: 23000, steerMax: 0.53,
    voice: { ...VOICE.v8, q: 11, cut: [320, 4200], redline: 8200 }
  }),
  car({
    id: 'hiper', name: 'Hipersport', class: 'Süper',
    desc: 'Dört haneli beygir. Ankara’yı bir uçtan bir uca dakikalarla ölçer.',
    colours: [0x1b1d21, 0x34d3ff, 0xf0f0ee, 0x8a1f2f],
    length: 4.62, width: 2.02, wheelBase: 2.70, rideHeight: 0.09,
    bodyHeight: 0.40, cabinHeight: 0.32, cabinBack: -0.34, cabinFront: 0.20,
    frontWidth: 0.97, rearWidth: 1.06, noseDrop: 0.22, spoiler: true,
    wheelRadius: 0.36, wheelWidth: 0.34,
    mass: 1560, power: 30000, topSpeed: 108, grip: 1.50, brake: 23000, steerMax: 0.50,
    voice: { ...VOICE.v12, turbo: 1, ex: 1.6 }
  }),
  car({
    id: 'prototip', name: 'Yarış Prototipi', class: 'Süper',
    desc: 'Kapalı tekerlekli yarış arabası. Yere yapışır, sertliğini hissedersin.',
    colours: [0x1b4fa0, 0xd11f1f, 0xf0f0ee, 0x2f6f5a],
    length: 4.76, width: 2.04, wheelBase: 2.86, rideHeight: 0.07,
    bodyHeight: 0.36, cabinHeight: 0.30, cabinBack: -0.28, cabinFront: 0.22,
    frontWidth: 0.94, rearWidth: 1.08, noseDrop: 0.24, tailDrop: 0.02, spoiler: true,
    wheelRadius: 0.35, wheelWidth: 0.34,
    mass: 1080, power: 26000, topSpeed: 102, grip: 1.60, brake: 23000, steerMax: 0.50,
    voice: VOICE.v10
  }),
  car({
    id: 'e-hiper', name: 'Elektrikli Hiper', class: 'Süper',
    desc: 'Sessizce kaybolur. Tork ilk milisaniyeden itibaren tam.',
    colours: [0xd8dde3, 0x1b1d21, 0x34d3ff, 0x8a1f2f],
    length: 4.66, width: 1.98, wheelBase: 2.76, rideHeight: 0.10,
    bodyHeight: 0.44, cabinHeight: 0.34, cabinBack: -0.40, cabinFront: 0.18,
    frontWidth: 0.97, rearWidth: 1.04, noseDrop: 0.20, spoiler: true,
    wheelRadius: 0.35, wheelWidth: 0.33, electric: true,
    mass: 1900, power: 34000, topSpeed: 100, grip: 1.52, brake: 23000, steerMax: 0.51,
    voice: { ...VOICE.electric, whine: [260, 46] }
  }),

  // =========================== JAPON ARABALARI ===========================
  car({
    id: 'rotary', name: 'Rotary Coupé', class: 'Japon',
    desc: 'Wankel motor: pistonsuz, tiz ve devirli. Sesi başka hiçbir şeye benzemez.',
    colours: [0xf0f0ee, 0xd11f1f, 0x1b1d21, 0xf5c518],
    length: 4.30, width: 1.76, wheelBase: 2.42, rideHeight: 0.14,
    bodyHeight: 0.48, cabinHeight: 0.38, cabinBack: -0.48, cabinFront: 0.16,
    frontWidth: 0.97, noseDrop: 0.17, wheelRadius: 0.32, wheelWidth: 0.25,
    mass: 1270, power: 12500, topSpeed: 72, grip: 1.30, brake: 18000, steerMax: 0.58,
    voice: VOICE.rotary
  }),
  car({
    id: 'supra6', name: 'Sıra 6 Turbo', class: 'Japon',
    desc: 'Efsanevi altı silindir. Turbolarla birlikte sonu gelmeyen çekiş.',
    colours: [0xf0a500, 0xf0f0ee, 0x1b1d21, 0x2f6f5a, 0x8a1f2f],
    length: 4.52, width: 1.86, wheelBase: 2.56, rideHeight: 0.15,
    bodyHeight: 0.50, cabinHeight: 0.40, cabinBack: -0.46, cabinFront: 0.16,
    frontWidth: 0.98, noseDrop: 0.15, spoiler: true, wheelRadius: 0.33, wheelWidth: 0.27,
    mass: 1520, power: 16500, topSpeed: 83, grip: 1.30, brake: 19500, steerMax: 0.55,
    voice: { ...VOICE.i6, turbo: 1, ex: 1.25 }
  }),
  car({
    id: 'awd-japon', name: 'Dört Çeker Japon', class: 'Japon',
    desc: 'Dört tekerlekten çekiş ve akıllı diferansiyel. Islak zeminde bile ateşlenir.',
    colours: [0x2b3138, 0xd8dde3, 0x1b4fa0, 0xd11f1f],
    length: 4.66, width: 1.90, wheelBase: 2.78, rideHeight: 0.15,
    bodyHeight: 0.52, cabinHeight: 0.42, cabinBack: -0.50, cabinFront: 0.20,
    frontWidth: 0.98, noseDrop: 0.14, spoiler: true, wheelRadius: 0.34, wheelWidth: 0.29,
    mass: 1740, power: 19500, topSpeed: 86, grip: 1.42, brake: 21000, steerMax: 0.54,
    voice: { ...VOICE.v6, turbo: 1, q: 9 }
  }),
  car({
    id: 'kei', name: 'Kei Spor', class: 'Japon',
    desc: 'Minicik gövde, minicik motor, kocaman keyif. Trafikte her yere sığar.',
    colours: [0xf5e663, 0xd8dde3, 0x2f6fae, 0x1b1d21],
    length: 3.40, width: 1.48, wheelBase: 2.28, rideHeight: 0.15,
    bodyHeight: 0.48, cabinHeight: 0.36, cabinBack: -0.44, cabinFront: 0.14,
    noseDrop: 0.13, wheelRadius: 0.28, wheelWidth: 0.20,
    mass: 840, power: 5200, topSpeed: 47, grip: 1.22, brake: 12500, steerMax: 0.66,
    voice: VOICE.kei
  }),
  car({
    id: 'drift', name: 'Drift Coupé', class: 'Japon',
    desc: 'Arkadan itiş, kilitli diferansiyel, bol direksiyon açısı. Düz gitmek için değil.',
    colours: [0xf0f0ee, 0x1b1d21, 0x34d3ff, 0xd11f1f, 0xf0a500],
    length: 4.44, width: 1.78, wheelBase: 2.54, rideHeight: 0.15,
    bodyHeight: 0.50, cabinHeight: 0.42, cabinBack: -0.50, cabinFront: 0.18,
    frontWidth: 0.98, noseDrop: 0.14, spoiler: true, wheelRadius: 0.32, wheelWidth: 0.26,
    mass: 1290, power: 13000, topSpeed: 71, grip: 1.06, brake: 17500, steerMax: 0.78,
    voice: { ...VOICE.i4turbo, turbo: 1, ex: 1.35 }
  }),

  // ============================== ELEKTRİKLİ =============================
  car({
    id: 'tesla', name: 'Tesla Model S', class: 'Elektrikli',
    desc: 'Uzun menzilli elektrikli sedan. Sessiz, ağır, ve düz hızlanmada acımasız.',
    colours: [0xd8dde3, 0x1b1d21, 0x8a1f2f, 0x2b3a55, 0x9aa0a6],
    length: 4.98, width: 1.96, wheelBase: 2.96, rideHeight: 0.20,
    bodyHeight: 0.58, cabinHeight: 0.50, cabinBack: -0.64, cabinFront: 0.26,
    frontWidth: 0.97, noseDrop: 0.14, wheelRadius: 0.35, wheelWidth: 0.26,
    electric: true,
    mass: 2160, power: 26000, topSpeed: 90, grip: 1.34, brake: 20000, steerMax: 0.55,
    voice: { ...VOICE.electric, whine: [200, 40] }
  }),
  car({
    id: 'togg', name: 'Togg T10X', class: 'Elektrikli',
    desc: 'Türkiye’nin elektrikli SUV’u. Gemlik’ten çıkıp Ankara caddelerine.',
    colours: [0x1d3d5c, 0xd8dde3, 0x1b1d21, 0x8a2f3a, 0x2f6f5a],
    length: 4.60, width: 1.88, wheelBase: 2.89, rideHeight: 0.30,
    bodyHeight: 0.66, cabinHeight: 0.56, cabinBack: -0.66, cabinFront: 0.28,
    frontWidth: 0.98, wheelRadius: 0.36, wheelWidth: 0.25,
    electric: true,
    mass: 2000, power: 15000, topSpeed: 51, grip: 1.20, brake: 17500, steerMax: 0.57,
    voice: { ...VOICE.electric, whine: [190, 30] }
  })
];
