# UniTel / Pin-Sales daily import

The importer accepts the Pin-Sales TXT, TSV or CSV export with these columns:

- Benutzername
- Kartenname
- Einkaufspreis
- Verkaufspreis
- Anzahl
- Einkaufssumme
- Verkaufssumme
- Gewinn
- Bestelldatum

It validates every row and the declared total, groups detail rows into one daily total, and archives the full original source.

Because the export contains no payment method, the user must explicitly choose all cash, all card, or enter the cash portion for every day. Cash affects account 1000, card uses account 1360, and the counteraccount is 1590 Durchlaufende Posten / UniTel.

The gross commission is posted once per month to 8400 with 19 percent VAT and counteraccount 1590. Imported monthly UniTel PDFs remain control-only documents and are recalculated live against the current daily entries.
