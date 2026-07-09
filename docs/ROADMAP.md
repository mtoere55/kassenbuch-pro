# Roadmap

## Current main — Local-first shop and bookkeeping system

The current `main` branch is the working local-first version for the shop. It is still browser/local-first, but it already contains more than the original M1 scope.

Implemented in the current local-first system:

- simple responsive German-first interface
- customers and suppliers
- IMEI inventory
- device purchase and purchase contract
- device sale and invoice/receipt
- §25a calculation
- ledger generation
- image and PDF scanning/preview
- OCR review for Z-reports and supplier invoices
- KAS backup import and correction workflow for unresolved `0000` entries
- PayPal CSV import with gross, fee, net, refund and transfer separation
- Sparkasse bank CSV/PDF import with reconciliation and robust booking-label handling
- Flatpay Umsatzbericht PDF import and reconciliation
- UniTel monthly PDF control reports
- UniTel / Pin-Sales daily Guthaben import with cash/card allocation and clearing-account logic
- local compact state in localStorage
- large documents, OCR text and attachment payloads in IndexedDB
- printable documents
- local backup/restore
- tests and CI

Open, not merged:

- PR #15 / `m14-july-controls`: July bookkeeping workflow, supplier rules, internal numbering, owner settings, special settlement bookings and document creation from existing income. This branch diverged from `main` and must not be merged blindly.

## Next safe local-first milestones

### M15 — UniTel bank/payment clearing

- Match bank payments to monthly UniTel payable amounts.
- Close `1590 · Durchlaufende Posten / UniTel` with real bank outgoing payments.
- Show open UniTel clearing balance by month.
- Keep daily Guthaben sales, monthly provision and bank payment clearly separated.

### M16 — July workflow rescue from PR #15

- Review PR #15 file by file against current `main`.
- Rebuild useful parts on a fresh branch from `main`.
- Avoid carrying old branch conflicts forward.
- Keep supplier rules, owner settings and special settlement bookings only after tests pass.

### M17 — Reporting polish

- Kassenbuch report view for accountant review.
- Fremdgeld / clearing-money visibility without treating it as normal revenue.
- VAT summary by month.
- DATEV-preparation field mapping draft.
- Export package with documents and ledger JSON/CSV.

## Production data foundation

- PostgreSQL schema and migrations
- authentication and role permissions
- multi-tenant company boundaries
- encrypted object storage
- append-only audit events
- server-side document numbering locks
- automated backup and tested restore

## Document intelligence

- server-side OCR queue
- PDF and multi-page document support beyond browser-only processing
- confidence scoring per field
- supplier learning rules
- duplicate document fingerprints
- e-mail document inbox
- human review queue

## Money connectors

- licensed open-banking provider
- PayPal Business partner connector
- Flatpay settlement connector or stable import workflow
- fees, refunds and chargebacks
- own-account transfer detection
- partial payment and open-item matching

## Professional accounting

- double-entry posting engine
- SKR03/SKR04 mappings
- debtors and creditors
- open items and reminders
- VAT-period reports
- DATEV export with document links
- BWA/GuV/SuSa preparation
- tax-adviser read-only workspace

## Germany fiscal and e-invoice layer

- certified TSE adapter
- DSFinV-K export
- ZUGFeRD
- XRechnung
- immutable period closing
- audit export
- generated process documentation templates

## Commercial SaaS

- subscriptions and usage limits
- onboarding wizard
- branch management
- support and admin console
- monitoring and incident workflow
- white-label partner edition
