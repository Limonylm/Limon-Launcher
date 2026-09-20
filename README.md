# Limon Launcher

Electron tabanlı, Feather tarzı bir Minecraft: Java Edition başlatıcısı.

## Özellikler
- Microsoft hesabıyla giriş (yenileme token'ı Windows tarafından şifrelenerek saklanır)
- Çevrimdışı (korsan) hesapla oynama
- Tüm Minecraft sürümleri (release, snapshot, eski sürümler)
- Profiller: sürüm, RAM, pencere boyutu, JVM argümanları
- Gereken Java sürümünü otomatik indirir (Adoptium)
- Skin kütüphanesi ve Microsoft hesabına skin yükleme
- Ayarlar (oyun klasörü, Java yolu, launcher davranışı)
- Market sayfası (şimdilik boş)

## EXE'yi derleme

### Yol 1: GitHub Actions (kurulum gerektirmez)
1. GitHub'da yeni bir repo aç, bu klasörün içeriğini yükle (`main` dalına).
2. Repo sayfasında **Actions** sekmesini aç. Workflow kendiliğinden çalışır (ya da "Run workflow" ile elle başlat).
3. 3-5 dakika sonra **Releases** bölümünde `Limon-Launcher-1.0.0.exe` (portable) ve
   `Limon-Launcher-Kurulum-1.0.0.exe` (kurulum sihirbazı) hazır olur.

### Yol 2: Kendi bilgisayarında
Node.js 20+ kurulu olmalı.
```
npm install
npm run build
```
EXE dosyaları `dist/` klasöründe çıkar. Denemek için: `npm start`

## Klasör yapısı
- `main.js`: ana süreç (hesaplar, sürümler, Java, oyun başlatma, skinler)
- `preload.js`: güvenli köprü
- `src/`: arayüz (HTML, CSS, JS)
