# Architecture

## Product principle

The user performs a business action, not an accounting entry.

```text
Customer → Device → Purchase → Stock → Sale → Document → Payment → Ledger
```

Every action creates linked records. The UI hides accounting terms unless the owner or tax adviser opens the advanced modules.

## Current architecture

The M1 prototype is a static Next.js application with a typed domain store.

```text
AppShell
 ├─ dashboard
 ├─ purchase workflow
 ├─ sale workflow
 ├─ customer registry
 ├─ IMEI inventory
 ├─ document archive
 ├─ OCR scanner
 ├─ ledger
 ├─ bank/PayPal CSV reconciliation
 └─ settings and backup

Domain store
 ├─ Customer
 ├─ Device
 ├─ Purchase
 ├─ Sale
 ├─ BusinessDocument
 ├─ LedgerEntry
 └─ ImportedTransaction
```

All domain objects use stable IDs and explicit links. This allows the browser repository to be replaced by a database repository later.

## Production target

```text
apps/web             Next.js user interface
apps/api             authenticated application API
apps/worker          OCR, matching, export and report jobs
apps/admin           SaaS operations

packages/accounting  double-entry and cash-book rules
packages/tax         VAT and §25a rules
packages/documents   OCR, E-Rechnung and document lifecycle
packages/connectors  bank, PayPal, TSE, DATEV
packages/audit       append-only event and change log
packages/contracts   schemas and API contracts
```

### Infrastructure target

- PostgreSQL with tenant-scoped row access
- S3-compatible encrypted document storage
- background queue for OCR and connector synchronization
- short-lived signed document URLs
- audit events stored separately from mutable projections
- encrypted backups with restore tests
- observability for connector failures and accounting exceptions

## Security boundaries

- API credentials never enter the browser bundle.
- Bank access is read-only and implemented through an approved provider.
- Original documents are retained separately from OCR output.
- OCR output is a proposal, never the source document.
- Posted entries are corrected by reversal, not silent deletion.
- Each tenant receives a separate authorization boundary.
