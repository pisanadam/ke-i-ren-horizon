# Keçiören Sürüş

Ankara'nın Keçiören ilçesinde geçen **3D serbest sürüş oyunu**. Tarayıcıda
çalışır, hiçbir eklenti veya indirme gerektirmez. Estergon Kalesi'nden Etlik'e,
Kalaba'dan Kuzey Çevre Yolu'na kadar tepelere kurulmuş bir şehir; içinde
sürebileceğin **10 farklı araç** ve caddeleri dolduran **canlı trafik** var.

![tür](https://img.shields.io/badge/tür-serbest%20sürüş-ff8a3d) ![motor](https://img.shields.io/badge/motor-three.js-34d3ff) ![lisans](https://img.shields.io/badge/varlık-%100%20prosedürel-5ce08a)

---

## Oynamak için: tek dosya

**[`kecioren-surus.html`](kecioren-surus.html)** — indir, çift tıkla, oyna.

Hepsi bu. Kurulum yok, sunucu yok, internet bağlantısı bile gerekmiyor. Three.js
motoru, oyunun tüm kodu ve arayüzü bu tek 0,7 MB'lık HTML dosyasının içine
gömülüdür; dosya açıldığında dışarıya **hiçbir istek** göndermez. USB'ye atıp
başka bilgisayarda da açabilirsin.

Gereken tek şey WebGL 2 destekli güncel bir tarayıcı (Chrome, Edge, Firefox,
Safari). Harita, binalar, araçlar, dokular ve sesler dahil **her şey açılışta
üretilir** — depoda tek bir model, resim veya ses dosyası yoktur.

### Geliştirmek için

Oyunu değiştirmek istersen kaynak, `src/` altında okunabilir modüller hâlinde
duruyor:

```bash
npm install
npm run dev      # canlı yenilemeli geliştirme sunucusu
npm run build    # kaynağı tekrar kecioren-surus.html içine paketler
```

`npm run build` her şeyi tek dosyada toplar; klasik çok dosyalı çıktı isteyen
olursa `npm run build:dist` de `dist/` üretir.

---

## Kontroller

| Tuş | İşlev |
| --- | --- |
| `W` / `↑` | Gaz |
| `S` / `↓` | Fren, dururken geri vites |
| `A` `D` / `←` `→` | Direksiyon |
| `Boşluk` | El freni (drift) |
| `C` | Kamera değiştir (takip, geniş, kaput, tampon, serbest, kuşbakışı) |
| `V` | Farlar |
| `H` | Klakson |
| `R` | Aracı yola geri al |
| `T` | Saati 3 saat ilerlet |
| `N` | Haritada rastgele bir noktaya ışınlan |
| `M` | Garaja dön |
| `X` | Sesi aç/kapat |
| `F` | Tam ekran |
| `Esc` / `P` | Duraklat |

Fare ile sürükleyerek çevrede dönebilir, tekerlekle uzaklaşıp
yakınlaşabilirsin. Oyun kolu (gamepad) ve dokunmatik kumanda da desteklenir.
Küçük haritanın üstünde tekerlek çevirerek yakınlaştırma yapılır.

---

## Haritada ne var

Harita 1.8 × 1.8 km'lik bir alan ve Keçiören'in gerçek dokusunu takip eder:
vadi tabanında yoğun apartmanlar, yamaçlarda alçak katlı evler, tepelerde
manzara.

**Ana arterler** — Fatih Caddesi (vadi boyunca uzanan omurga), Kızlarpınarı,
Gazino, Sanatoryum, Estergon, Aktepe Bulvarı, Şehit Cengiz Karaca Caddesi,
Etlik Caddesi, Subayevleri, Aşağı Eğlence, Kalaba Caddesi, Bağlum Yolu ve
haritayı kuzeyden kapatan Kuzey Çevre Yolu. Aralarını ara sokaklardan oluşan
bir ızgara doldurur.

**Yapılar**

- **Estergon Kalesi** — doğudaki tepede, köşe kuleleri, konik kırmızı çatıları
  ve Türk bayrağıyla
- **Keçiören Teleferiği** — kaleden vadinin karşısına uzanan, kabinleri sürekli
  gidip gelen hat
- **Etlik Şehir Hastanesi** — üç bloklu külliye, giriş saçağı ve çatı pisti
- **Keçiören Belediyesi**, **Atapark Camii** (kubbe + iki minare),
  **Aktepe Stadyumu**, **Keçiören Botanik Parkı** (gölet, sera, kameriye),
  **Keçiören Metro İstasyonu**, **Neşet Ertaş Sanat Merkezi**,
  **Kalaba Pazar Yeri**, **Keçiören AVM**

**Mahalleler** — Aşağı ve Yukarı Eğlence, Etlik, Subayevleri, Kalaba, Aktepe,
Kuşcağız, Estergon, Sanatoryum, Güçlükaya, Esertepe, Yayla, İncirli, Ovacık,
Şenlik, Pınarbaşı, Hasköy, Basınevleri, Gümüşdere, Yükseltepe. Hangisinde
olduğun ekranın üstünde yazar.

---

## Araçlar

| Araç | Sınıf | Karakteri |
| --- | --- | --- |
| Şehir Hatchback | Şehir içi | Küçük, çevik, dar sokaklar için |
| Klasik Sedan | Nostalji | Arkadan itiş, kolay savrulur |
| Keçiören Taksi | Ticari | Tepe lambalı sarı taksi |
| Kırmızı Spor | Performans | 0-100 ≈ 3 sn, 280 km/s |
| Dağ SUV | Arazi | Yüksek, ağır, toprakta da tutunur |
| Kamyonet | Ticari | Açık kasa, arkası hafif |
| Dolmuş Minibüs | Toplu taşıma | Yüksek ve ağır |
| Polis Aracı | Resmî | Güçlü motor, tepe lambaları |
| Elektrikli Sedan | Elektrikli | Sessiz, anında tork |
| Belediye Otobüsü | Toplu taşıma | 10,5 metre, yavaş ama durdurulamaz |

Her aracın kendi rengi seçilebilir; garajda araç Estergon Kalesi'nin altında
dönen kamerayla sergilenir.

---

## Sistemler

**Sürüş fiziği.** İki akslı bisiklet modeli: her aks kayma açısından (slip
angle) yanal kuvvet üretir. Araçlar bu yüzden hızlı girilen virajda dışa
kaçar, el freniyle arkadan savrulur ve düşük hızda park manevrası yapabilir
(kinematik moda yumuşak geçişle). Yokuşta yerçekimi, asfalt dışında düşük
tutuş, kaldırıma çıkarken tümsek, çarpışmada itki — hepsi modellenmiştir.

**Trafik.** 90'a kadar yapay zekâ aracı yol grafiği üzerinde dolaşır: sağdan
gider, kavşaklarda genelde düz devam eder, önündeki araca göre yavaşlar,
kırmızı ışıkta durur ve çarptığında itilir. Oyuncunun etrafında sürekli
doğar/silinir, böylece nerede olursan ol cadde dolu görünür.

**Gece / gündüz.** Saat sürekli akar. Güneşin açısına göre gökyüzü, sis,
gölgeler, yıldızlar ve ay değişir; hava kararınca apartman pencereleri yanar,
sokak lambaları asfalta ışık havuzu düşürür, araçlar farlarını yakar.

**Diğer.** Lastik izleri ve duman, sentezlenmiş motor sesi (elektrikli araçta
uğultu), fren/geri/sinyal lambaları, yayalar, park etmiş araçlar, otobüs
durakları, elektrik telleri, çatılarda su depoları ve çanak antenler,
dönen trafik ışıkları, analog gösterge paneli ve dönebilen küçük harita.

---

## Kod düzeni

```
kecioren-surus.html      ← oynanan tek dosya (üretilmiş, çift tıkla çalışır)
scripts/build-single.mjs   her şeyi o tek dosyaya gömen paketleyici
src/
├── main.js              oyun döngüsü, durumlar, gece/gündüz sürücüsü
├── textures.js          canvas ile üretilen tüm dokular
├── effects.js           lastik izi + duman havuzları
├── audio.js             WebAudio ile sentezlenen motor/lastik/klakson
├── input.js             klavye + gamepad + dokunmatik
├── cameraRig.js         6 kamera modu
├── util/math.js         yardımcı matematik, deterministik rastgelelik
├── world/
│   ├── mapData.js       caddeler, mahalleler, yapılar — haritanın kaynağı
│   ├── heightfield.js   Keçiören tepelerinin yükseklik fonksiyonu
│   ├── network.js       yol grafiği: kesişimler, kenarlar, kotlar, ışıklar
│   ├── ground.js        arazi ağı ve zemin yüksekliği sorguları
│   ├── roads.js         asfalt, kaldırım, bordür, yol çizgileri
│   ├── buildings.js     apartmanlar, dükkânlar, çatı detayları
│   ├── props.js         ağaçlar, lambalar, ışıklar, park hâlindeki araçlar
│   ├── landmarks.js     Estergon, hastane, cami, stadyum, teleferik…
│   ├── colliders.js     statik çarpışma ızgarası
│   └── skyEnv.js        gökyüzü, güneş, gece
├── vehicles/
│   ├── catalog.js       araç listesi ve sürüş değerleri
│   ├── carModel.js      prosedürel araç gövdeleri
│   ├── vehicle.js       sürüş fiziği
│   └── traffic.js       yapay zekâ trafiği
└── ui/                  gösterge paneli, küçük harita, garaj
```

Harita rastgele değil ama **deterministik**: her açılışta aynı şehir kurulur.
Yeni bir cadde eklemek için `src/world/mapData.js` içindeki `ROADS` dizisine
bir satır yazmak yeterli — kesişimler, kotlar, kaldırımlar, binalar, trafik ve
küçük harita otomatik olarak güncellenir.

---

## Performans notları

Sahne yaklaşık 1,6 milyon üçgen ve ~170 çizim çağrısı üretir; geometriler
malzeme başına birleştirilir, ağaçlar/lambalar/trafik `InstancedMesh` ile
çizilir. Donanım hızlandırmalı bir GPU'da akıcı çalışır. Daha zayıf makinelerde
`src/main.js` içindeki `setPixelRatio` değerini düşürmek veya
`src/vehicles/traffic.js` içindeki `MAX_AGENTS` sayısını azaltmak en hızlı
kazancı verir.
