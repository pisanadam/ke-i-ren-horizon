# Ankara Sürüş

Ankara'da geçen **3D serbest sürüş oyunu**. Tarayıcıda çalışır, hiçbir eklenti
veya indirme gerektirmez. Keçiören'in tepelerinden Ulus'a, Kızılay'dan
Çankaya'ya, Anıtkabir'den Sincan'a ve Esenboğa'ya uzanan **10 × 10 km'lik bir
şehir**; içinde sürebileceğin **10 farklı araç**, caddeleri dolduran **canlı
trafik** ve viyadükleri üzerinde gerçekten işleyen **beş hatlı metro** var.

![tür](https://img.shields.io/badge/tür-serbest%20sürüş-ff8a3d) ![motor](https://img.shields.io/badge/motor-three.js-34d3ff) ![lisans](https://img.shields.io/badge/varlık-%100%20prosedürel-5ce08a)

---

## Oynamak için: tek dosya

**[`index.html`](index.html)** — indir, çift tıkla, oyna.

Hepsi bu. Kurulum yok, sunucu yok, internet bağlantısı bile gerekmiyor. Three.js
motoru, oyunun tüm kodu ve arayüzü bu tek 0,7 MB'lık HTML dosyasının içine
gömülüdür; açıldığında dışarıya **hiçbir istek** göndermez. USB'ye atıp başka
bilgisayarda da açabilirsin, dilediğin ismi verebilirsin.

Gereken tek şey WebGL 2 destekli güncel bir tarayıcı (Chrome, Edge, Firefox,
Safari). Harita, binalar, araçlar, dokular ve sesler dahil **her şey açılışta
üretilir** — depoda tek bir model, resim veya ses dosyası yoktur.

### GitHub Pages

Aynı dosya sitenin kökünde durduğu için Pages'te ek ayar gerekmez: deponun
Pages kaynağını **bu dal + `/ (root)`** olarak seçmen yeterli, adres açıldığında
oyun doğrudan başlar. Sayfa yüklenirken tek bir HTTP isteği yapılır (dosyanın
kendisi); harici script, CDN veya varlık dosyası yoktur.

> Kökteki `index.html` **üretilmiş** dosyadır — elle düzenleme, `npm run build`
> onu her seferinde yeniden yazar. Geliştirme şablonu `src/index.html`'dir.

### Geliştirmek için

Oyunu değiştirmek istersen kaynak, `src/` altında okunabilir modüller hâlinde
duruyor:

```bash
npm install
npm run dev        # canlı yenilemeli geliştirme sunucusu
npm run build      # kaynağı tekrar kökteki index.html içine paketler
npm run build:dist # isteyen olursa klasik çok dosyalı dist/ çıktısı
```

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
| `M` | Haritayı aç / kapat |
| `G` | Garaja dön |
| `X` | Sesi aç/kapat |
| `F` | Tam ekran |
| `Esc` / `P` | Duraklat |

Fare ile sürükleyerek çevrede dönebilir, tekerlekle uzaklaşıp
yakınlaşabilirsin. Oyun kolu (gamepad) da desteklenir. Küçük haritanın üstünde
tekerlek çevirerek yakınlaştırma, üstüne tıklayarak büyük haritayı açma
yapılır.

### Telefon ve tablet

Oyun dokunmatik cihazlarda tam olarak oynanabilir; kumanda ekrana kendiliğinden
gelir:

- **Sol yarı** — direksiyon. Parmağını basılı tutup sağa sola kaydır; direksiyon
  ne kadar kaydırdığına göre kademeli döner (sadece sağ/sol düğmesi değil).
- **Sağ alt** — GAZ ve FREN pedalları.
- **Sağ üst** — el freni, klakson, kamera, harita ve duraklat düğmeleri.

Yatay tutuş önerilir; oyun başlarken tam ekrana geçmeyi ve ekranı yatay
kilitlemeyi dener. Telefonlarda harita, bina ve trafik yoğunluğu ile gölge
kalitesi otomatik olarak düşürülür. Kademeyi elle seçmek istersen adresin
sonuna `?kalite=dusuk` veya `?kalite=yuksek` ekleyebilirsin.

### Harita ve hedef işaretleme

`M` tuşu, küçük harita üzerine tıklama ya da mobildeki 🗺 düğmesi tüm ilçeyi
gösteren haritayı açar. Harita açıkken oyun duraklar.

- **Sürükle** kaydırır, **tekerlek / çift parmak** yakınlaştırır
- **Haritaya dokun** → oraya bir hedef işareti koyar
- İşaret koyduğunda küçük haritada bayrak, ekranda ise hedefe olan **yön oku ve
  uzaklık** belirir; hedefe vardığında kendiliğinden silinir
- **HEDEFİ SİL** ve **ARACIMA GİT** düğmeleri üst şeritte

---

## Haritada ne var

Harita 9.2 × 9.2 km'lik bir alan. Ankara'nın gerçek yerleşimi yaklaşık 3,5'te
bire sıkıştırılmıştır: ilçeler doğru yönde ve doğru sırada, ama aralarındaki
mesafe bir oyunda sürülebilecek kadar. Kuzeyde Keçiören'in vadisi, ortada Ulus
ve kale tepesi, güneyde Kızılay ve Çankaya sırtı, batıda ova boyunca Etimesgut
ve Sincan, doğuda Elmadağ'ın etekleri.

**Ana arterler** — Atatürk Bulvarı (Keçiören'den Çankaya'ya inen omurga),
İstanbul Yolu (Batıkent–Etimesgut–Sincan), Eskişehir Yolu (Söğütözü–ODTÜ–
Çayyolu), Samsun Yolu (Mamak), Esenboğa Yolu, Konya Yolu, Anıtkabir ve Cebeci
caddeleri, şehri saran Çevre Yolu, ve kuzeyde Keçiören'in kendi caddeleri
(Fatih, Kızlarpınarı, Gazino, Sanatoryum, Estergon, Kalaba…). Yerleşim
alanlarının içini ara sokak ızgaraları doldurur; aradaki tepeler boştur.

**İlçeler** — Keçiören, Altındağ/Ulus, Çankaya, Kızılay, Cebeci, Dikmen,
Bahçelievler, Balgat, Söğütözü, Yenimahalle, Ostim, Batıkent, Etimesgut,
Sincan, ODTÜ/Bilkent/Çayyolu, Mamak, Pursaklar, Esenboğa ve Gölbaşı.

**Metro** — beş hat, elli istasyon, viyadük üzerinde: **M4** Keçiören–Kızılay,
**M1** Kızılay–Batıkent, **M3** Batıkent–Sincan, **M2** Kızılay–Çayyolu ve
**Ankaray** AŞTİ–Dikimevi. Trenler istasyondan kalkar, hat hızına çıkar, bir
sonraki perona tam yerinde frenler, bekler ve yeniden hareket eder; hattın
ucunda yön değiştirir. Hatlar haritada kendi renkleriyle çizilidir.

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
- **Anıtkabir**, **Ankara Kalesi**, **Kocatepe Camii**, **TBMM**, **Atakule**,
  **Gençlik Parkı**, **AŞTİ**, **Ankara Hipodromu**, **19 Mayıs Stadyumu**,
  **ODTÜ** ve **Bilkent** kampüsleri, **Armada AVM**, **Esenboğa Havalimanı**,
  **Mogan Gölü**, **Ostim Sanayi**

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

**Arazi ve yol kotu.** Yollar araziyi izleyen, yumuşatılmış bir profili takip
eder ve doğal zeminden en fazla birkaç metre ayrılabilir; kavşaklara küçük bir
doğrusal düzeltmeyle bağlanır. Kalan dolgular yol kenarına inen şevlerle
desteklenir, böylece hiçbir yerde yol havada asılı kalmaz.

**Metro.** Beş hat kendi viyadüğü üzerinde kurulur: kirişler, ayaklar, raylar,
ada peronlar, saçaklar ve merdiven kuleleri. Ayaklar asfaltın üstüne düşmesin
diye her biri yoldan uzağa kaydırılır; kaydıracak yer yoksa o açıklık boş
geçilir. Trenler bir zaman çizelgesiyle işler ve oyuncudan uzaktakiler çizim
dışı bırakılır.

**Dünya akışı.** Ankara 90 km²; hepsini tek seferde örgülemek dakikalar
sürerdi. Uzak manzara tek ve kaba bir arazi meshiyle karşılanır, oyuncunun
çevresindeki ayrıntılı arazi ise 620 m'lik karelere bölünüp araba yaklaştıkça
kare başına birkaç milisaniyelik bütçeyle örülür ve bir daha atılmaz. 150
km/h'te bile arabanın altında örülmemiş zemin kalmaz.

**Diğer.** Lastik izleri ve duman, sentezlenmiş motor sesi (elektrikli araçta
uğultu), hıza ve pedala bağlı **fren sesi** (yavaşlarken gıcırtıya döner),
fren/geri/sinyal lambaları, yayalar, park etmiş araçlar, otobüs
durakları, elektrik telleri, çatılarda su depoları ve çanak antenler,
dönen trafik ışıkları, analog gösterge paneli ve dönebilen küçük harita.

---

## Kod düzeni

```
index.html               ← oynanan tek dosya (üretilmiş; Pages de bunu sunar)
scripts/build-single.mjs   her şeyi o tek dosyaya gömen paketleyici
src/
├── index.html           geliştirme şablonu (tek dosyanın iskeleti)
├── main.js              oyun döngüsü, durumlar, gece/gündüz sürücüsü
├── quality.js           masaüstü / telefon kalite kademesi
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
└── ui/
    ├── hud.js           gösterge paneli
    ├── mapPlan.js       bir kez çizilen sokak planı
    ├── minimap.js       köşedeki küçük harita
    ├── mapview.js       tam ekran harita ve hedef işareti
    └── menu.js          garaj
```

Harita rastgele değil ama **deterministik**: her açılışta aynı şehir kurulur.
Yeni bir cadde eklemek için `src/world/mapData.js` içindeki `ROADS` dizisine
bir satır yazmak yeterli — kesişimler, kotlar, kaldırımlar, binalar, trafik ve
küçük harita otomatik olarak güncellenir.

---

## Performans notları

Masaüstünde sahne yaklaşık 2,2 milyon üçgen ve ~180 çizim çağrısı üretir;
telefon kademesinde 1,4 milyon üçgen ve ~170 çağrıya iner. Geometriler malzeme
başına birleştirilir; ağaçlar, lambalar ve trafik `InstancedMesh` ile çizilir.
Oyuncunun aracı yaklaşık 11.000 üçgenlik yoğun bir ağ kullanır, trafik araçları
ise ayrı bir düşük detay seviyesiyle üretilir.

Bütün kademe ayarları tek yerde: `src/quality.js`. Harita, bina ve trafik
yoğunluğu, gölge çözünürlüğü, arazi çözünürlüğü ve piksel oranı buradan
belirlenir.
