# Kassenbuch Pro — Devam Bilgisi / Handoff

Dil: Türkçe konuşuyoruz. Program arayüzü Almanca.

Kullanıcı: Murat Toere.

Repo: `mtoere55/kassenbuch-pro`

Yerel klasör: `C:\kassenbuch-pro`

## Güvenli lokal güncelleme

PowerShell `npm.ps1` engeli olursa `npm` değil `npm.cmd` kullanılacak.

Hard reset önermeyin. Kullanıcı eski `m2-manual-cashbook` branch'inde merge conflict yaşamıştı.

Güvenli akış:

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

## Ana proje

Kassenbuch Pro, Almanya'daki telefon/telekom dükkânı için yerel çalışan muhasebe/kasa programıdır.

Ana modüller:

- Kunden
- Geräte / IMEI
- Verkauf
- Gerät ankaufen
- Beleg scannen
- Dokumente
- Kassenbuch
- Bank & PayPal
- Einstellungen / Datensicherung
- §25a Differenzbesteuerung
- Z-Bericht / Tagesabschluss
- PayPal, Bank, Flatpay, UniTel entegrasyonları

## Main branch güncel durum

`main` şu an local-first çalışan ana hat.

Önemli birleşmiş işler:

- KAS backup import ve KAS review/correction workflow
- PayPal CSV detaylı import ve bookkeeping workflow
- Flatpay Umsatzbericht PDF import
- Sparkasse Bank-PDF/CSV import ve robust parser
- IndexedDB attachment storage: büyük PDF/resim/OCR verileri localStorage yerine IndexedDB tarafına ayrılıyor
- UniTel Monatsabrechnung kontrol sistemi
- UniTel / Pin-Sales günlük Guthaben importu

## UniTel günlük Pin-Sales importu

Ekran yolu:

```text
Bank & PayPal
→ UniTel Guthaben
→ Tagesliste importieren
```

Dosya TXT/TSV/CSV olabilir.

Dosyada ödeme şekli yok. Program ödeme türünü uydurmaz.

Import ekranında 3 seçenek çıkar:

- `Alles bar`
- `Alles Karte`
- `Tagesweise aufteilen`

Muhasebe mantığı:

- Guthaben satışlarının tamamı normal ciro değildir.
- Verkaufssumme önce `1590 · Durchlaufende Posten / UniTel` clearing hesabına gider.
- Bar kısmı `1000 · Kasse` bakiyesini artırır.
- Karte kısmı `1360 · Geldtransit und Karte` üzerinden izlenir ve fiziksel kasayı artırmaz.
- Gerçek gelir sadece aylık komisyon/provision kısmıdır.
- Komisyon ayda bir defa `8400` hesabına 19% USt ile yazılır.
- Komisyonun karşı hesabı `1590`dır.
- Aylık UniTel PDF sadece kontrol ve arşiv içindir; günlük satışları tekrar kasa yazmaz.

Gerçek Pin-Sales örnek dosyası `Eingefügter Text.txt` için beklenen ön izleme:

- 698 ürün satırı
- 1.308 Aufladungen
- 73 Verkaufstage
- Zeitraum: 01.04.2026 – 30.06.2026
- Verkaufssumme: 18.445,00 €
- Einkaufssumme / An UniTel: 17.329,46 €
- Brüt komisyon: 1.115,54 €

Aylık dağılım:

| Ay | Verkauf | Einkauf / UniTel | Brüt komisyon |
| --- | ---: | ---: | ---: |
| Nisan 2026 | 6.792,50 € | 6.380,35 € | 412,15 € |
| Mayıs 2026 | 5.552,50 € | 5.213,95 € | 338,55 € |
| Haziran 2026 | 6.100,00 € | 5.735,16 € | 364,84 € |

Program 698 satırı 698 ayrı kasa kaydı yapmaz. Günlük toplam yapar. Aynı gün için en fazla iki kayıt oluşur: Bar ve Karte. Ayrıca her ay için bir komisyon kaydı oluşur.

## Açık / dikkatli taşınacak iş

PR #15 / `m14-july-controls` açık ve merge edilmemiştir.

İçerik:

- July bookkeeping workflow
- supplier rules
- differential-tax sale selection
- internal record numbering
- owner settings
- special settlement bookings
- document creation from existing income

Bu branch `main`den ayrışmış durumda. Direkt merge edilmemeli. Gerekirse faydalı parçalar `main` üzerinden yeni temiz branch'e tek tek taşınmalı.

## Sonraki güvenli görevler

1. Kullanıcı UniTel günlük import ekran görüntüsü gönderirse toplamlar kontrol edilecek.
2. Parser hatası çıkarsa `src/lib/unitel-daily-report.ts` düzeltilecek.
3. Bankadan UniTel'e giden aylık ödemeler `1590` clearing hesabını kapatacak şekilde eşleştirilecek.
4. Haziran Monats-PDF gelince Haziran kontrolü de yapılacak.
5. Bar/Karte ayrımı bilinmiyorsa kullanıcı Z-Bericht/Flatpay ile gün bazında ayıracak.
6. PR #15 içindeki faydalı işler, main üzerine güvenli şekilde yeniden kurulacak.

## Cevap stili

- Türkçe, pratik, doğrudan.
- Almanca UI isimleri aynen kullan.
- Uzun teori yerine yapılacak komutu ve neyin değiştiğini söyle.
- Hard reset verme.
- `npm.cmd` kullan.
