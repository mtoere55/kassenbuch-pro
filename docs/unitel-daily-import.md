# UniTel / Pin-Sales daily import

The importer accepts the Pin-Sales TXT, TSV or CSV export with these columns:

- Benutzername
- Kartenname / Katenname
- Einkaufspreis
- Verkaufspreis / Satış fiyatı
- Anzahl
- Einkaufssumme / Einkaufssume
- Verkaufssumme
- Gewinn
- Bestelldatum

The source file is treated as a detailed sales report, not as 698 separate cashbook records.

## Validation

The parser validates every readable product line:

- `Einkaufspreis × Anzahl = Einkaufssumme`
- `Verkaufspreis × Anzahl = Verkaufssumme`
- `Einkaufssumme + Gewinn = Verkaufssumme`

It also compares the declared `Gesamtesumme` line with the calculated line totals when that summary line is present.

## Booking logic

Because the export contains no payment method, the user must explicitly choose one of these import modes:

- `Alles bar`
- `Alles Karte`
- `Tagesweise aufteilen`

No automatic all-cash assumption is allowed.

Cash affects account `1000 · Kasse`.

Card uses account `1360 · Geldtransit und Karte`.

The counteraccount is always `1590 · Durchlaufende Posten / UniTel` for the daily Guthaben clearing turnover.

The gross commission is posted once per month to account `8400` with 19 percent VAT and counteraccount `1590`.

Imported monthly UniTel PDFs remain control-only documents and are recalculated live against the current daily entries. A monthly PDF must not create duplicate daily sales or duplicate commission revenue.

## Expected test file totals

For the current real Pin-Sales export `Eingefügter Text.txt`, the preview should show:

- `18.445,00 €` Verkaufssumme
- `17.329,46 €` Einkaufssumme / An UniTel
- `1.115,54 €` Provision Brutto
- `1.308` Aufladungen
- `73` Verkaufstage
- `01.04.2026 – 30.06.2026`

Monthly totals:

| Month | Verkauf | Einkauf / An UniTel | Provision Brutto |
| --- | ---: | ---: | ---: |
| April 2026 | 6.792,50 € | 6.380,35 € | 412,15 € |
| May 2026 | 5.552,50 € | 5.213,95 € | 338,55 € |
| June 2026 | 6.100,00 € | 5.735,16 € | 364,84 € |

## Manual test flow

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

Then open the browser and press `Ctrl+F5`.

In the app:

```text
Bank & PayPal
→ UniTel Guthaben
→ Tagesliste importieren
→ select Eingefügter Text.txt
```

After the preview is correct, choose the real payment split:

- `Alles bar` if all daily Guthaben money entered the physical cash drawer.
- `Alles Karte` if all money came through card/Geldtransit.
- `Tagesweise aufteilen` if each day must be split manually using Z-Bericht, Flatpay or shop notes.

## Next accounting step

The next missing workflow is bank payment clearing:

- match the outgoing bank payment to UniTel against the monthly payable amount
- example payable amounts: `6.380,35 €`, `5.213,95 €`, `5.735,16 €`
- close the open balance on `1590 · Durchlaufende Posten / UniTel`
