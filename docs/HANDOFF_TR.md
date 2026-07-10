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
- PayPal, Bank, Flatpay, Prifoto, UniTel entegrasyonları

## Main branch güncel durum

`main` şu an local-first çalışan ana hat.

Önemli birleşmiş işler:

- KAS backup import ve KAS review/correction workflow
- PayPal CSV detaylı import ve bookkeeping workflow
- Flatpay Umsatzbericht PDF import
- Prifoto Tagesverkäufe PDF import
- Sparkasse Bank-PDF/CSV import ve robust parser
- IndexedDB attachment storage: büyük PDF/resim/OCR verileri localStorage yerine IndexedDB tarafına ayrılıyor
- UniTel Monatsabrechnung kontrol sistemi
- UniTel / Pin-Sales günlük Guthaben importu
- Kassenbuch yazdırma akışı: `Drucken`, `Drucken mit Belegen`, `CSV-Datei`
- Kassenbuch satırına tıklayınca `Buchung bearbeiten` kartı açılır; tarih, art, Buchungskonto, Zahlungsart, Betrag, MwSt., Beleg, Text ve Notiz düzenlenebilir
- Kassenbuch Konto kolonu artık cash/account ana hesabı yerine karşı hesap mantığıyla gösterilir; UniTel bar satırında `1590 · Durchlaufende Posten / UniTel` görünmelidir

## Prifoto Tagesverkäufe PDF importu

Ekran yolu:

```text
Bank & PayPal
→ Prifoto Tagesverkäufe
→ Prifoto-PDF importieren
```

Yüklenen örnek dosya:

```text
RE-010620263320_Tagesverkäufe
```

PDF içeriği:

- Anbieter: Prifoto GmbH
- Kundennummer: 168
- Rechnungnummer: RE-010620263320
- Rechnungsdatum: 04.07.2026
- Zeitraum: Juni 2026
- Gesamtumsatz: 480,00 €
- Bestellungen: 30
- Tagesdurchschnitt: 32,00 €
- Bester Tag: Montag, 15.06. / 77,00 €
- 15 Verkaufstage

Muhasebe mantığı:

- Prifoto satışları normal 19% USt cirodur.
- Günlük toplamlar `8400 · Erlöse 19 Prozent / Prifoto` hesabına yazılır.
- PDF ödeme şekli ayırmadığı için kullanıcı import sırasında seçim yapar:
  - `Alles bar`
  - `Alles Karte`
  - `Tagesweise aufteilen`
- Bar seçilirse `1000 · Kasse` artar.
- Karte seçilirse `1360 · Geldtransit und Karte` kullanılır, fiziksel kasa artmaz.
- Aynı PDF ikinci kez yüklenirse fingerprint ile mükerrer engellenir.

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
7. Kassenbuch yazdırma ve satır düzenleme test edilecek: satıra tıkla, `Buchung bearbeiten` açılıyor mu; `Drucken` temiz çıktı veriyor mu; `CSV-Datei` indiriyor mu.
8. Prifoto import test edilecek: `RE-010620263320_Tagesverkäufe` PDF'i 480,00 €, 30 Bestellungen, 15 Verkaufstage olarak okunmalı.

## Cevap stili

- Türkçe, pratik, doğrudan.
- Almanca UI isimleri aynen kullan.
- Uzun teori yerine yapılacak komutu ve neyin değiştiğini söyle.
- Hard reset verme.
- `npm.cmd` kullan.
