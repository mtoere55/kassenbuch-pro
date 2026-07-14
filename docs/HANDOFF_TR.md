# Kassenbuch Pro — Devam Bilgisi / Handoff

Dil: Türkçe konuşuyoruz. Program arayüzü Almanca.

Kullanıcı: Murat Toere.

Repo: `mtoere55/kassenbuch-pro`

Yerel klasör: `C:\kassenbuch-pro`

## Güvenli lokal güncelleme

PowerShell `npm.ps1` engeli olursa `npm` değil `npm.cmd` kullanılacak. Hard reset önermeyin.

```powershell
Ctrl+C
cd C:\kassenbuch-pro
git status --short
git fetch origin
git switch main
git pull --ff-only origin main
npm.cmd install
npm.cmd run dev
```

Eğer `git status --short` boş değilse önce değişiklikleri kontrol et.

## Canlı domain / deployment kuralı

Kassenbuch Pro canlı yayında `cidentia.live` altında yayınlanmayacak. Root domain `handyreparatur.shop` da kullanılmayacak. Doğru canlı subdomain:

```text
https://kassenbuch.handyreparatur.shop
```

CidenDB SDK Redirect URI:

```text
https://kassenbuch.handyreparatur.shop/cid/callback
```

Deployment notu:

```text
docs/deployment-handyreparatur-shop.md
```

`cidentiaapp.com` sadece CID oluşturma / CidenDB erişim kapısı olarak kalabilir; Kassenbuch Pro uygulama domaini `kassenbuch.handyreparatur.shop` olmalı.

## Ana yön

Kassenbuch Pro artık sadece Murat’ın dükkânına özel panellerden oluşmamalı. Tek doğru ürün hattı:

```text
Universal Beleg Import
```

Her kullanıcı PDF, fotoğraf, CSV, TXT, Kontoauszug, Tagesabschluss, Eingangsrechnung, Zahlungsdienstleister-Export ve aylık raporları tek panelden yüklemeli. Prifoto, UniTel, Flatpay, PayPal, Bank gibi özel destekler arkada tanıma/işleme kuralı olarak kalabilir; arayüz vendor-neutral görünmelidir.

## Güncel modüller

- Übersicht
- Verkaufen
- Gerät ankaufen
- Reparatur / Service
- Universal Beleg Import
- Kunden
- Geräte
- Dokumente
- Kassenbuch
- Bank & Zahlungsabgleich
- Einstellungen / Datensicherung

## Yeni Service/Reparatur mantığı

`Reparatur / Service` sayfası eklendi.

Kullanım:

```text
Reparatur / Service
→ Kunde seç veya Laufkundschaft
→ Marke / Modell / IMEI / Seriennummer / Code / Zubehör
→ Fehlerbeschreibung
→ Leistung / Reparaturtext
→ Dokument seç: Kostenvoranschlag, Rechnung veya Quittung
→ Preis brutto
→ Zahlungsart
```

Muhasebe:

- `Kostenvoranschlag`: belge oluşturur ama Kassenbuch’a kayıt atmaz.
- `Rechnung` / `Quittung`: belge oluşturur ve otomatik Kassenbuch kaydı atar.
- Hesap: `8402 · Erlöse 19 Prozent / Reparatur Service`.
- Bar ise Kasse artar, Karte ise Geldtransit olur, Bank/PayPal fiziksel kasayı artırmaz.
- Service belge numarası `REP`, belge numarası `KV`, `RE` veya `QU` ile gider.

## Universal Beleg Import

Eski `Beleg scannen` paneli artık universal import olarak çalışır.

Kabul edilenler:

- PDF, uzantısız PDF dahil (`%PDF-` imzası)
- JPG / PNG / WEBP
- CSV
- TXT / TSV
- Kontoauszug PDF
- Zahlungsdienstleister CSV
- Tagesabschluss / Z-Bericht
- Eingangsrechnung / Beleg

Akış:

```text
Universal Beleg Import
→ dosya yükle
→ Universal Import auslesen
→ sistem tanırsa önerir
→ kullanıcı değerleri ve Konto’yu kontrol eder
→ Geprüfte Daten übernehmen
```

Tanıma başarısız olursa belge Eingangsrechnung / Beleg olarak manuel kontrol edilebilir. Böylece başka kullanıcılarda Prifoto/UniTel/Flatpay olmasa bile sistem çalışır.

## Bank & Zahlungsabgleich

`Bank & PayPal` görünümü vendor-neutral hale getirildi:

```text
Bank & Zahlungsabgleich
```

Burada dosya yükleme değil, import edilmiş konto hareketlerini kontrol/abgleich yapılır. Yeni dosyalar `Universal Beleg Import` üzerinden alınır. Özel provider isimleri arayüzün ana yüzünden kaldırıldı.

## CID / CidenDB giriş kapısı

Program açılışında `CidGateway` vardır. CID yoksa ana program açılmaz.

- Manuel CID girişi localStorage içine `kassenbuch-pro.cid-session` olarak yazılır.
- CID oluşturma bağlantısı `https://cidentiaapp.com` kalabilir.
- Gerçek CidenDB dönüşü `/cid/callback` route’u üzerinden alınır.
- Callback doğru canlı domainde şu olmalı: `https://kassenbuch.handyreparatur.shop/cid/callback`.

## Önceden başarıyla test edilen özel kurallar

Bu kurallar silinmedi, ama artık arka planda tanıma kuralı olarak düşünülmeli:

- PayPal CSV detaylı import ve fee/internal transfer mantığı
- Sparkasse Bank-PDF/CSV parser
- Flatpay Umsatzbericht PDF parser
- UniTel / Pin-Sales günlük Guthaben import mantığı
- UniTel Monatsabrechnung kontrol mantığı
- Prifoto Tagesverkäufe + Detail-Abrechnung clearing mantığı
- `1590 · Durchlaufende Posten / UniTel`
- `1592 · Durchlaufende Posten / Prifoto`
- `8401 · Erlöse 19 Prozent / Prifoto Eigenanteil`
- `8402 · Erlöse 19 Prozent / Reparatur Service`

## Kassenbuch / Dokument / Druck

- Kassenbuch satırına tıklanınca `Buchung bearbeiten` açılır.
- `Buchung löschen` vardır.
- §25a satışta MwSt satış toplamından değil alış-satış farkından hesaplanmalıdır. Örn. alış 40 €, satış 150 €, Marge 110 €, MwSt 17,56 €.
- Yazdırma `src/lib/print.ts` üzerinden yapılır; body/modal CSS ile eski gizle-göster print mantığına dönülmemeli.
- Ankaufvertrag, Rechnung, Quittung, Kostenvoranschlag, Kassenbuch ve Buchung kartı print test edilmeli.

## Açık / dikkatli taşınacak iş

PR #15 / `m14-july-controls` açık ve merge edilmemiştir. Direkt merge edilmemeli. Gerekirse faydalı parçalar main üzerinden temiz branch’e tek tek taşınmalı.

## Cevap stili

- Türkçe, pratik, doğrudan.
- Almanca UI isimleri aynen kullan.
- Uzun teori yerine yapılan commitleri, komutu ve neyin değiştiğini söyle.
- Hard reset verme.
- `npm.cmd` kullan.
