# Ankara Sürüş

Ankara'da geçen **3D serbest sürüş oyunu**. Tarayıcıda çalışır, hiçbir eklenti
veya indirme gerektirmez. Keçiören'in tepelerinden Ulus'a, Kızılay'dan
Çankaya'ya, Anıtkabir'den Sincan'a ve Esenboğa'ya uzanan **10 × 10 km'lik bir
şehir**; içinde sürebileceğin **45 farklı araç**, caddeleri dolduran **canlı
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

## Birlikte oynamak (co-op)

Duraklat ekranındaki **CO-OP** düğmesi, 6 haneli bir oda kodu ve varsan
adın. Aynı kodu giren herkes aynı Ankara'da buluşur; arkadaşının aracı
haritada ve yolda görünür.

**İkiniz de aynı kodu yazıp BAĞLAN diyorsunuz** — kimin oda kuracağına oyun
kendi karar veriyor, yanlış düğme diye bir şey yok. Kurulum yok, sunucu yok:
bağlantı kurulduktan sonra araçlar WebRTC veri kanalıyla doğrudan cihazdan
cihaza gider. Oyun verisi kimsenin sunucusundan geçmez.

Roller şöyle dağıtılıyor: iki taraf da odanın `-lobby` konusuna bir selam
bırakır, kısa bir dinleme penceresinden sonra **küçük id odayı alır**. Sonradan
gelen, oda sahibinin "buradayım" cevabını duyup id'sine bakmadan misafir olur.
Selam kaybolur da iki oda birden açılırsa taraflar birbirini duyduğu anda
büyük id çekilip misafir olarak geri girer. (Eskiden bunu düğmeyle seçmek
gerekiyordu; ikisi de aynı düğmeye basınca oda sessizce hiç kurulmuyordu.)

Tek bir yerde dışarıya ihtiyaç var: iki cihazın birbirini **bulması**. WebRTC
bağlanmadan önce iki tarafın adres bilgisini (SDP ve ICE adayları) takas
etmesi gerekir ve tarayıcı gelen bağlantı dinleyemediği için bu takasa bir
aracı şarttır. Aracı olarak `ntfy.sh` kullanılıyor — kayıt istemeyen, ücretsiz
bir bildirim servisi. 6 haneli kod orada yalnızca bir konu adı:
`anksur-483920-join`. Tanışma bitince o servisle işimiz kalmaz.

Tek nokta arıza olmasın diye her mesaj **iki aynaya** birden gönderilir
(`ntfy.sh` ve `ntfy.envs.net`) ve ikisi birden dinlenir; aynı mesaj id'siyle
tekilleştirilir. Servisin mesaj sınırını aşan oturum tanımları numaralı
parçalara bölünüp karşıda birleştirilir.

**Arkadaşın haritada.** Odaya giren herkes hem köşedeki küçük haritada hem de
tam ekran haritada görünür: aracının renginde bir işaret ve adı. Küçük haritanın
dışında kalanlar kaybolmaz, hangi yöndeyse çemberin o kenarına sivri uçlu bir
işaretle tutturulur — "nerede bu?" sorusunun cevabı haritaya bakmanın sebebidir.

**Olmuyorsa ne olduğunu söyler.** Bağlanamamanın iki ayrı sebebi var ve
ikisinin çaresi ayrı. 7 saniye içinde aracıya tek bir mesaj bile geçmediyse
ekran *"buluşma servisine ulaşılamıyor"* der ve elle bağlanma bölümünü kendisi
açar. Mesajlar gidiyor ama 32 saniyede kimse gelmediyse *"arkadaşına
ulaşılamadı"* der. Sessizce dönen bir tekerlek yok.

**Aracı engellenirse.** Okul ve iş ağları böyle servisleri kapatabiliyor. O
zaman co-op ekranındaki *Elle bağlan* bölümünden kendi kodunu üretip
(yaklaşık 900 karakter, WhatsApp'a rahat sığar) karşı tarafa yollayabilir,
onun kodunu yapıştırıp bağlanabilirsin. Burada aday toplama bitene kadar
beklenir, çünkü tek seferlik metnin içinde her adresin bulunması gerekir.

Bilinen sınır: yalnızca STUN var, TURN yok. İki taraf da katı simetrik NAT
arkasındaysa doğrudan bağlantı kurulamaz — TURN sunucusu hesap ve para
istediği için "bağımlılık yok" kuralını bozmamak adına konmadı.

### Araçlar neden zıplamıyor

Gelen her paketi geldiği anda uygulamak, aracın paketler arasında durup
sonra sıçraması demektir — ışınlanma hissi buradan gelir. Onun yerine uzak
oyuncular **140 ms geçmişte** çizilir: elde neredeyse her zaman ileride bir
paket daha olduğu için araç iki anlık görüntü arasında **süzülür**. Ara
değer düz bir doğru değil, iki uçtaki hızı teğet alan bir Hermite eğrisidir;
böylece viraja giren araç köşeyi kesip geri sıçramaz, virajı takip eder.
Paketin gecikmesi hâlinde son bilinen hızla en fazla 0,35 saniye tahmin
yürütülür, sonrası beklenir.

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
| `R` | Aracı yola geri al ve kaportayı onar (hurdaysa yenisini getir) |
| `E` | Araçtan in / bin |
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
| Canavar Kamyonet | Canavar | 92 cm tekerler, her yerden geçer |
| Dehşet Motorlu Kamyon | Canavar | 12 ton, 210 kW, önüne geleni siler |

Tablo garajdaki **45 aracın** ilk onunu ve iki canavarı gösteriyor; kalanlar
aile arabalarından hiper otomobillere ve elektriklilere uzanır (tam liste
`src/vehicles/catalog.js` ve `catalogExtra.js` içindedir).

Her aracın rengi, jantı, motoru ve turbosu garajda değiştirilebilir; araç
Estergon Kalesi'nin altında dönen kamerayla sergilenir.

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

**Yıkım.** Şehirdeki hiçbir şey kendiliğinden yıkılmaz; kırılması için senin
çarpman gerekir ve her şeyin bir eşiği vardır: lamba direği 18 km/s, ağaç
25 km/s, park etmiş araba 29 km/s, bina duvarı 79 km/s. Eşiği geçince nesne
birleştirilmiş meshten silinir, yerini rijit gövde çözücüsüne bırakır ve
gerçekten devrilir, savrulur, yuvarlanır. Duvarlar bütün hâlinde yıkılmaz:
tabandaki 4,4 m'lik şerit 2,2 m'lik hücrelere bölünmüştür, çarptığın yerde
araba genişliğinde bir delik açılır, üst katlar ayakta kalır ve açılan delikten
binanın içine girilir — içerisi artık bir kabuktur, ortası boştur. Çarpma sesi
sertliğe göre değişir (teneke ezilmesi, cam, çeliğin çınlaması), moloz ve toz
saçılır.

**Aracının hasarı.** Kaportan da nasibini alır: çarptığın panel gerçekten içeri
göçer. Köşe noktası aracın kendi eksenine çevrilir, o noktanın çevresindeki
köşeler darbe yönünde bastırılır ve üstüne düşük frekanslı bir gürültü
eklenerek metal kırışır. Yer değiştirme yalnızca köşenin başlangıç konumuna
bağlıdır; bu yüzden dikiş yerlerinde üst üste duran ikizler hep birlikte hareket
eder ve gövde asla yırtılmaz (ölçüldü: en kötü dikiş açıklığı 1,2 × 10⁻⁷ m).
Göstergedeki **HASAR** çubuğu dolunca — üç şeritte 150 ile duvara, ya da birkaç
binadan geçerek — araç patlar: alev, is, 18 parça enkaz ve yeni bir araç.
`R` her an kaportayı düzeltir. Patlamayı istemiyorsan **Ayarlar → Oyun →
Araç hurdaya çıksın** kapatılır: kaporta yine yamulur ama araç asla hurdaya
çıkmaz.

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
├── effects.js           lastik izi, duman ve alev havuzları
├── audio.js             WebAudio ile sentezlenen motor/lastik/klakson/patlama
├── input.js             klavye + gamepad + dokunmatik
├── cameraRig.js         6 kamera modu
├── util/math.js         yardımcı matematik, deterministik rastgelelik
├── world/
│   ├── mapData.js       caddeler, mahalleler, yapılar — haritanın kaynağı
│   ├── heightfield.js   Keçiören tepelerinin yükseklik fonksiyonu
│   ├── network.js       yol grafiği: kesişimler, kenarlar, kotlar, ışıklar
│   ├── ground.js        arazi ağı ve zemin yüksekliği sorguları
│   ├── terrainChunks.js oyuncunun çevresinde örülen ayrıntılı arazi
│   ├── roads.js         asfalt, kaldırım, bordür, yol çizgileri
│   ├── ramps.js         yol dolgularını araziye bağlayan şevler
│   ├── buildings.js     apartmanlar, dükkânlar, çatı detayları, duvar hücreleri
│   ├── props.js         ağaçlar, lambalar, ışıklar, park hâlindeki araçlar
│   ├── landmarks.js     Estergon, hastane, cami, stadyum, teleferik…
│   ├── metro.js         viyadükler, peronlar, tarifeyle işleyen trenler
│   ├── colliders.js     statik çarpışma ızgarası, delikler ve kabuklar
│   ├── breakables.js    kırılan direk, ağaç, araba ve duvarlar
│   ├── rigid.js         enkaz için rijit gövde çözücüsü
│   ├── tiles.js         şehri karelere bölen çizim/eleme katmanı
│   ├── reflections.js   araç yansımaları için ortam sondası
│   ├── route.js         hedefe yol tarifi
│   └── skyEnv.js        gökyüzü, güneş, gece
├── vehicles/
│   ├── catalog.js       araç listesi ve sürüş değerleri
│   ├── catalogExtra.js  ek araçlar (canavar kamyonet, dehşet motorlu kamyon…)
│   ├── tuning.js        modifiye: renk, jant, motor, turbo
│   ├── carModel.js      prosedürel araç gövdeleri
│   ├── vehicle.js       sürüş fiziği
│   ├── damage.js        gövde yamulması ve aracın parçalanması
│   ├── traffic.js       yapay zekâ trafiği
│   ├── onFoot.js        araçtan inip yürüme, metroya binme
│   └── person.js        yaya modeli ve yürüyüş animasyonu
├── net/
│   ├── coop.js          oda kurma/katılma ve oyuncu senkronu
│   ├── rtc.js           WebRTC veri kanalı, yıldız topolojisi
│   └── signal.js        ntfy üzerinden SDP/ICE takası
└── ui/
    ├── hud.js           gösterge paneli
    ├── mapPlan.js       bir kez çizilen sokak planı
    ├── minimap.js       köşedeki küçük harita
    ├── mapview.js       tam ekran harita ve hedef işareti
    ├── settings.js      video ve ses ayarları
    └── menu.js          garaj
```

Harita rastgele değil ama **deterministik**: her açılışta aynı şehir kurulur.
Yeni bir cadde eklemek için `src/world/mapData.js` içindeki `ROADS` dizisine
bir satır yazmak yeterli — kesişimler, kotlar, kaldırımlar, binalar, trafik ve
küçük harita otomatik olarak güncellenir.

---

## Performans notları

Masaüstünde, şehrin ortasında, sahne karede ~1,16 milyon üçgen ve ~333 çizim
çağrısı üretir (ölçüldü; aynı yer daha önce 2,21 milyon üçgen ve 521 çağrıydı).
Geometriler malzeme başına birleştirilir; ağaçlar, lambalar ve trafik
`InstancedMesh` ile çizilir. Oyuncunun aracı yaklaşık 22.000 üçgenlik yoğun bir
ağ kullanır, trafik araçları ise ayrı bir düşük detay seviyesiyle üretilir.

Kareyi asıl ucuzlatan dört şey, hepsi ölçüme bakılarak seçildi:

- **Katman başına çizim uzaklığı.** Her katman aynı ufka kadar çizilmez. Çatı
  klimaları tek başına karede 385 bin üçgendi — altındaki cephelerden fazla —
  çünkü iki kilometre ötede bir buçuk piksel kaplayan su deposu tam detayla
  çiziliyordu. Siluet (cephe, çatı, asfalt, ağaç) tam ufku korur; direk, kaldırım,
  yol çizgisi, park etmiş araba ve çatı detayı çok daha yakında kesilir.
  Birbirine ait olanlar aynı uzaklığı paylaşır, yoksa direksiz lamba başı ya da
  gövdesiz ağaç tacı kalır.
- **Gölge haritasına mesafeyle giriş.** Güneşin gölge kutusu aracın çevresinde
  bir kare; sınırlarına ulaşamayacak hiçbir parça oraya ikinci kez çizilmez.
  Gölge pası 252 bin üçgenden 90 bine indi.
- **İki kademeli arazi.** Aracın çevresindeki 3×3 kare sekiz metre çözünürlükte
  örülür, ötesi on altı metrede — arazi 450 binden 134 bin üçgene iner. Uzak
  ağ 28 cm aşağı çekilir, yoksa köşe kesen yamaç asfaltın içinden çıkar.
- **Üç kademeli trafik.** Bir trafik arabasının 3.688 üçgeninin %47'si
  tekerlekti; arkadaki araçlar artık 72 üçgenlik tekerlek kullanıyor. 95
  metreye kadar her şey ve gölge, 210 metreye kadar gövde ile tampon, ötesinde
  yalnız gövde. Yakın ve uzak takım ayrı `InstancedMesh`'ler: bir örnek yığını
  ya tamamen gölge atar ya hiç atmaz, ikiye bölmenin sebebi bu.
- **Katman başına parça boyu.** Bir parça hem bir çizim çağrısı hem de eleme
  birimi, dolayısıyla doğru boy katmanın ne kadar geometri taşıdığına bağlı.
  Asfalt çağrı başına 767 üçgendi — boşa harcanan bir çağrı; asfalt, şev, çatı,
  kaldırım, dükkân ve metro artık iki kat büyük parçalarda. Cepheler küçük
  parçada kaldı: onlarda eleme, kazanılan çağrıdan değerli.
- **Kapaksız ağaç gövdesi.** Alt kapak toprağın içinde, üst kapak tacın
  içindeydi: gövdenin 24 üçgeninin 12'si, üç bin ağaç çarpı.

Gölge pası 252 bin üçgen ve 49 çağrıdan 56 bin üçgen ve 16 çağrıya indi.
Sürerken kare başına CPU 3,23 ms'den 2,64 ms'ye, yeni araziye girerken en kötü
kare 90,6 ms'den 30,1 ms'ye indi: bir kare artık bölünmez bir iş değil, önce
ucuz kaba ağ konur, ince ağ birkaç kare sonra sırasını bulur.

Bütün kademe ayarları tek yerde: `src/quality.js`. Harita, bina ve trafik
yoğunluğu, gölge çözünürlüğü, arazi çözünürlüğü ve piksel oranı buradan
belirlenir.
