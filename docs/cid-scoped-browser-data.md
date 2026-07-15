# CID-scoped browser data

Kassenbuch Pro remains local-first in this milestone, but bookkeeping data is no longer shared blindly by every Cidentia login in the same browser.

## Storage model

The active verified CID selects a dedicated compact-state key:

```text
kassenbuch-pro-state-v1:<CID>
```

Large document and OCR payloads remain in IndexedDB, with CID-prefixed attachment keys.

The browser stores only a non-secret active-scope marker. Authentication continues to come exclusively from the signed HttpOnly server cookie.

## One-time legacy migration

Existing installations may already contain data under the former unscoped key:

```text
kassenbuch-pro-state-v1
```

On the first successful Cidentia session after this migration:

1. The legacy state is copied to the verified CID's scoped key.
2. That CID is recorded as the owner of the legacy dataset.
3. Existing unscoped IndexedDB attachments are copied to CID-prefixed attachment keys when loaded.
4. The original legacy records are retained as a rollback source; they are not deleted automatically.

A different CID does not inherit the first CID's data. A new CID starts with an empty dataset and generic business settings instead of demo customers, devices or ledger entries.

## Session changes

When login, restored session or logout changes the active CID scope, the browser reloads the application before rendering bookkeeping pages. This prevents state from the previous CID remaining visible in React memory.

## Deployment safety

Before deploying this migration to a browser containing live bookkeeping data:

1. Open **Einstellungen**.
2. Download a current JSON backup.
3. Confirm the backup file can be selected by the restore workflow.
4. Deploy and log in first with the business owner's normal Cidentia account.
5. Confirm customers, devices, documents, ledger entries and attachments are present.
6. Log out and test a second CID only after the owner dataset is verified.

This is local-browser tenant isolation, not a substitute for the planned PostgreSQL multi-tenant backend, encrypted object storage, server-side authorization and audit events.
