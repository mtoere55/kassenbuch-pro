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
- PayPal, Bank, Flatpay, UniTel, Prifoto entegrasyonları

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
- Prifoto Tagesverkäufe PDF importu, Prifoto Detail-Abrechnung mantığı ile clearing ayrımı
- Prifoto import artık `.pdf` uzantısı olmayan ama içerik imzası `%PDF-` olan dosyaları da kabul eder
- Kontenplan içinde `8401 · Erlöse 19 Prozent / Prifoto Eigenanteil` var; manuel Buchung seçeneğinde görünmelidir
- Kassenbuch yazdırma akışı: `Drucken`, `Drucken mit Belegen`, `CSV-Datei`
- Kassenbuch satırına tıklayınca `Buchung bearbeiten` kartı açılır; tarih, art, Buchungskonto, Zahlungsart, Betrag, MwSt., Beleg, Text ve Notiz düzenlenebilir
- Kassenbuch Konto kolonu cash/account ana hesabı yerine karşı hesap mantığıyla gösterilir; UniTel bar satırında `1590 · Durchlaufende Posten / UniTel`, Prifoto bar satırında `1592 · Durchlaufende Posten / Prifoto` görünmelidir

## Prifoto Tagesverkäufe PDF importu

Ekran yolu:

```text
Bank & PayPal
→ Prifoto Tagesverkäufe
→ Prifoto-PDF importieren
```

Yüklenen örnek dosyalar:

```text
RE-010620263320_Tagesverkäufe
RE-010620263320_Detail
```

Bu dosyalar PDF olmasına rağmen uzantısız gelebilir. Yazılım artık dosya adından değil, içerikteki `%PDF-` imzasından PDF olduğunu anlar.

Tagesverkäufe PDF içeriği:

- Anbieter: Prifoto GmbH
- Kundennummer: 168
- Rechnungnummer: RE-010620263320
- Rechnungsdatum: 04.07.2026
- Zeitraum: Juni 2026
- Gesamtumsatz / Kundenzahlungen: 480,00 €
- Bestellungen: 30
- 15 Verkaufstage

Detail / Abrechnungsübersicht içeriği:

- Brutto Einnahmen Fotografie: 480,00 €
- Anteil Prifoto: 240,00 €
- Gesamtbetrag Brutto: 240,00 €
- Eigener Bruttoanteil: 240,00 €

Muhasebe mantığı:

- Prifoto satışlarının tamamı doğrudan normal ciro değildir.
- Müşteriden tahsil edilen toplam önce `1592 · Durchlaufende Posten / Prifoto` clearing hesabına gider.
- Bar seçilirse `1000 · Kasse` 480,00 € kadar artabilir.
- Karte seçilirse `1360 · Geldtransit und Karte` kullanılır, fiziksel kasa artmaz.
- `Prifoto Detail-Abrechnung` ikinci alana yüklenirse `Anteil Prifoto` otomatik okunur.
- Manuel gerekirse `Anteil Prifoto / Gesamtbetrag Brutto` alanına bu örnekte `240,00` yazılır.
- Gerçek gelir sadece kalan kendi brüt paydır; bu örnekte 240,00 €.
- Kendi payı `8401 · Erlöse 19 Prozent / Prifoto Eigenanteil` olarak ve karşı hesap `1592` ile yazılır.
- Prifoto’ya ödeme yapıldığında sonraki adım `1592` hesabını kapatacak banka ödeme eşleştirmesidir.
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

PR #15 / `m14-july-controls` açık ve merge edilmemiştir. Bu branch `main`den ayrışmış durumda. Direkt merge edilmemeli. Gerekirse faydalı parçalar `main` üzerinden yeni temiz branch'e tek tek taşınmalı.

## Sonraki güvenli görevler

1. Kullanıcı UniTel günlük import ekran görüntüsü gönderirse toplamlar kontrol edilecek.
2. Parser hatası çıkarsa `src/lib/unitel-daily-report.ts` düzeltilecek.
3. Prifoto import test edilecek: uzantısız `RE-010620263320_Tagesverkäufe` ve `RE-010620263320_Detail` dosyaları kabul ediliyor mu.
4. Bankadan UniTel'e ve Prifoto'ya giden aylık ödemeler ilgili clearing hesabını kapatacak şekilde eşleştirilecek.
5. Bar/Karte ayrımı bilinmiyorsa kullanıcı Z-Bericht/Flatpay ile gün bazında ayıracak.
6. PR #15 içindeki faydalı işler, main üzerine güvenli şekilde yeniden kurulacak.

## Cevap stili

- Türkçe, pratik, doğrudan.
- Almanca UI isimleri aynen kullan.
- Uzun teori yerine yapılacak komutu ve neyin değiştiğini söyle.
- Hard reset verme.
- `npm.cmd` kullan.
