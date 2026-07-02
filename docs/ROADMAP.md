# Roadmap

## M1 — Local shop workflow — completed in this repository

- simple responsive interface
- customers and suppliers
- IMEI inventory
- device purchase and purchase contract
- device sale and invoice/receipt
- §25a calculation
- ledger generation
- image OCR for Z-report and supplier invoice
- bank/PayPal CSV import and matching
- printable documents
- local backup/restore
- tests and CI

## M2 — Production data foundation

- PostgreSQL schema and migrations
- authentication and role permissions
- multi-tenant company boundaries
- encrypted object storage
- append-only audit events
- server-side document numbering locks
- automated backup and tested restore

## M3 — Document intelligence

- server-side OCR queue
- PDF and multi-page document support
- confidence scoring per field
- supplier learning rules
- duplicate document fingerprints
- e-mail document inbox
- human review queue

## M4 — Money connectors

- licensed open-banking provider
- PayPal Business partner connector
- Flatpay settlement import
- fees, refunds and chargebacks
- own-account transfer detection
- partial payment and open-item matching

## M5 — Professional accounting

- double-entry posting engine
- SKR03/SKR04 mappings
- debtors and creditors
- open items and reminders
- VAT-period reports
- DATEV export with document links
- BWA/GuV/SuSa preparation
- tax-adviser read-only workspace

## M6 — Germany fiscal and e-invoice layer

- certified TSE adapter
- DSFinV-K export
- ZUGFeRD
- XRechnung
- immutable period closing
- audit export
- generated process documentation templates

## M7 — Commercial SaaS

- subscriptions and usage limits
- onboarding wizard
- branch management
- support and admin console
- monitoring and incident workflow
- white-label partner edition
