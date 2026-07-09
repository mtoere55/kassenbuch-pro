# Kassenbuch Pro

Kassenbuch Pro is a German-first, mobile-friendly operating system for small device retailers, repair shops and second-hand electronics businesses.

It combines the daily shop workflow in one simple interface:

- customer and supplier records
- device inventory with IMEI and serial-number history
- device purchase (`Ankauf`) with purchase contract
- device sale with invoice or receipt
- §25a differential-tax calculations
- cash-book entries generated from business actions
- image/PDF OCR for Z-reports, supplier invoices and document archive work
- KAS backup import and review workflow for unresolved `0000` entries
- detailed PayPal CSV import with fees, refunds and bank-transfer separation
- Sparkasse bank CSV/PDF import with statement reconciliation
- Flatpay Umsatzbericht PDF import and reconciliation
- UniTel / Pin-Sales daily Guthaben import plus monthly PDF control
- printable invoices, receipts and purchase contracts
- local JSON backup and restore
- German, Turkish and English navigation labels

The visible interface is intentionally simple. Accounting rules and cross-links are handled in the background.

## Current delivery status

This repository contains the current **local-first shop and bookkeeping prototype** on `main`. It can be started and used immediately without an external database.

Implemented end-to-end workflows:

1. Create or select a customer.
2. Buy a device and record IMEI, purchase price, payment method and tax mode.
3. Automatically create the device stock item, purchase, purchase contract and expense entry.
4. Sell an in-stock device.
5. Automatically calculate margin and differential VAT, remove the item from stock, create the invoice/receipt and income entry.
6. Scan images and PDFs in the browser.
7. Recognize and book a German Z-report or supplier invoice after user review.
8. Import and review KAS backup files, including unresolved `0000 · Nicht zugeordnet` entries.
9. Import PayPal CSV exports with gross, fee, net, refunds, bank funding and PayPal-to-bank withdrawals.
10. Import Sparkasse bank PDFs/CSVs and keep own-account transfers separate from revenue.
11. Import Flatpay Umsatzbericht PDFs and reconcile them against ledger entries.
12. Import UniTel / Pin-Sales daily Guthaben lists as daily clearing totals, then control them with monthly UniTel PDFs.
13. Print documents and export/import the complete local dataset.

Open work that is **not** part of current `main` yet:

- PR #15 / `m14-july-controls` adds July bookkeeping workflow ideas, supplier rules, internal numbering, owner settings and special settlement bookings. It is not merged and must be carried forward carefully because `main` has moved on.

## UniTel accounting rule

UniTel Guthaben sales are treated as clearing money, not full revenue.

- Daily sale totals are booked to `1590 · Durchlaufende Posten / UniTel`.
- Cash parts increase physical cash (`1000 · Kasse`).
- Card parts use `1360 · Geldtransit und Karte` and do not increase physical cash.
- Only the monthly commission/provision is real revenue.
- The commission is posted once per month with 19% VAT and counteraccount `1590`.
- Monthly UniTel PDFs are control/archive documents and do not create duplicate daily sales.

See [`docs/unitel-daily-import.md`](docs/unitel-daily-import.md).

## Important scope boundary

The prototype is **not yet a certified fiscal cash register, tax filing service or production SaaS**.

The following require external providers, credentials, legal validation and production infrastructure:

- licensed PSD2/open-banking connection
- PayPal partner/API onboarding
- certified TSE integration
- DSFinV-K export validation
- DATEV production export validation
- XRechnung/ZUGFeRD generation and validation
- PostgreSQL multi-tenant backend
- authentication, user roles and encrypted object storage
- immutable production audit log and retention policies

The code separates these future connectors from the shop workflow so they can be added without redesigning the user interface.

## Technology

- Next.js 16
- React 19
- TypeScript
- Tesseract.js browser OCR
- pdfjs-dist for local PDF reading/rendering
- Vitest
- plain responsive CSS, no UI framework
- browser `localStorage` for compact state metadata
- browser IndexedDB for large document files, OCR text and attachment payloads

## Run locally

Requirements: Node.js 20.9 or newer. CI currently runs on Node.js 22.

PowerShell on Windows can block `npm.ps1`. In that case use `npm.cmd`:

```powershell
npm.cmd install
npm.cmd run dev
```

On shells without the PowerShell execution-policy issue:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Safe update flow for the local working copy:

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

If `git status --short` is not empty, inspect the local changes before pulling.

## Quality checks

```bash
npm run check
```

This runs ESLint, TypeScript, unit tests and the production build.

## Data storage in this milestone

Compact state metadata is stored in the current browser under:

```text
kassenbuch-pro-state-v1
```

Large document payloads are split out to browser IndexedDB under:

```text
kassenbuch-pro-local-files
```

This avoids localStorage quota errors when PDFs, receipt photos and OCR text become large. Use **Einstellungen → JSON-Sicherung herunterladen** regularly. The production milestone will replace browser-only storage with a server-side PostgreSQL database and encrypted document storage.

## Repository structure

```text
src/app/                 Next.js application and global design system
src/components/          shell, forms, printable documents and pages
src/lib/                 accounting rules, data store, OCR parser and CSV/PDF parsers
docs/                    architecture, product, import and compliance decisions
.github/workflows/       continuous integration
```

## Core accounting rules already tested

- differential VAT is calculated only on a positive purchase/sale margin
- 19% VAT extraction from gross values
- repair cost affects operational profit, not the §25a tax margin
- IMEI uses a 15-digit Luhn checksum
- duplicate IMEI records are blocked
- duplicate Z-report number/date combinations are blocked
- KAS imported rows can be reviewed and corrected
- bank/PayPal imports are de-duplicated
- transfers are not automatically treated as new sales in the domain design
- UniTel daily imports are grouped into daily clearing entries, not hundreds of product ledger rows
- UniTel monthly PDFs are archive/control documents and reconcile live against current ledger entries

## Product direction

Kassenbuch Pro is designed to become a commercial subscription product for:

- used-phone dealers
- phone repair stores
- tablet, computer and console retailers
- telecom/prepaid/Guthaben shops
- small second-hand electronics businesses

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the staged production plan.

## Legal and tax notice

Accounting and tax behavior must be reviewed with a German tax adviser before production use. Software alone does not guarantee GoBD compliance; configuration, operating procedures, document retention and the company’s process documentation are also relevant.

Copyright © 2026 Murat Toere. All rights reserved.
