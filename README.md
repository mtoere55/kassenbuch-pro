# Kassenbuch Pro

Kassenbuch Pro is a German-first, mobile-friendly operating system for small device retailers, repair shops and second-hand electronics businesses.

It combines the daily shop workflow in one simple interface:

- customer and supplier records
- device inventory with IMEI and serial-number history
- device purchase (`Ankauf`) with purchase contract
- device sale with invoice or receipt
- §25a differential-tax calculations
- cash-book entries generated from business actions
- image OCR for Z-reports and supplier invoices
- bank and PayPal CSV import with document matching
- printable invoices, receipts and purchase contracts
- local JSON backup and restore
- German, Turkish and English navigation labels

The visible interface is intentionally simple. Accounting rules and cross-links are handled in the background.

## Current delivery status

This repository contains a working **M1 local-first prototype**. It can be started and used immediately without an external database.

Implemented end-to-end workflows:

1. Create or select a customer.
2. Buy a device and record IMEI, purchase price, payment method and tax mode.
3. Automatically create the device stock item, purchase, purchase contract and expense entry.
4. Sell an in-stock device.
5. Automatically calculate margin and differential VAT, remove the item from stock, create the invoice/receipt and income entry.
6. Scan an image in the browser with Tesseract OCR.
7. Recognize and book a German Z-report or supplier invoice after user review.
8. Import bank or PayPal CSV transactions and match them against documents.
9. Print documents and export/import the complete local dataset.

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
- Vitest
- plain responsive CSS, no UI framework
- browser `localStorage` for the current prototype

## Run locally

Requirements: Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Quality checks

```bash
npm run check
```

This runs ESLint, TypeScript, unit tests and the production build.

## Data storage in this milestone

Data is stored in the current browser under:

```text
kassenbuch-pro-state-v1
```

Use **Einstellungen → JSON-Sicherung herunterladen** regularly. The production milestone will replace local storage with a server-side PostgreSQL database and encrypted document storage.

## Repository structure

```text
src/app/                 Next.js application and global design system
src/components/          shell, forms, printable documents and pages
src/lib/                 accounting rules, data store, OCR parser and CSV parser
docs/                    architecture, product and compliance decisions
.github/workflows/       continuous integration
```

## Core accounting rules already tested

- differential VAT is calculated only on a positive purchase/sale margin
- 19% VAT extraction from gross values
- repair cost affects operational profit, not the §25a tax margin
- IMEI uses a 15-digit Luhn checksum
- duplicate IMEI records are blocked
- duplicate Z-report number/date combinations are blocked
- bank/PayPal imports are de-duplicated
- transfers are not automatically treated as new sales in the domain design

## Product direction

Kassenbuch Pro is designed to become a commercial subscription product for:

- used-phone dealers
- phone repair stores
- tablet, computer and console retailers
- small second-hand electronics businesses

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the staged production plan.

## Legal and tax notice

Accounting and tax behavior must be reviewed with a German tax adviser before production use. Software alone does not guarantee GoBD compliance; configuration, operating procedures, document retention and the company’s process documentation are also relevant.

Copyright © 2026 Murat Toere. All rights reserved.
