# CID owner repair and central Datenimport

## Problem corrected

The first CID-scoped browser migration could assign the old unscoped shop dataset to whichever CID logged in first. A second CID could therefore receive a copied company profile even though subsequent writes were CID-scoped.

The operational upload actions were also visually repeated across Settings, Bank & Zahlungsabgleich and the former Beleg scannen page.

## Required production setting

Set the CID that owns the browser dataset created before CID scoping:

```env
KASSENBUCH_LEGACY_OWNER_CID=CID-26-00004
```

This value is not a secret. It is returned only as a storage migration policy after a verified Cidentia session.

## Repair behavior

- The configured owner receives the legacy unscoped dataset when its CID-scoped dataset is missing or empty.
- A different CID that previously received the legacy dataset is reset to an empty CID-scoped dataset.
- The previous incorrectly assigned JSON state is preserved under a timestamped `kassenbuch-pro-quarantine-v1:*` localStorage key instead of being deleted.
- Legacy IndexedDB attachments remain preserved. They are only linked into the configured owner's state.
- New CIDs start with empty customers, devices, documents, ledger and company details.

## Single import location

The navigation item is now **Datenimport**.

Operational imports are centralized there:

- PDF and image receipts
- supplier invoices
- Z reports / daily closings
- bank statements
- payment-provider CSV files
- TXT / TSV exports
- KAS backups

`Bank & Zahlungsabgleich` contains one navigation action to open Datenimport and otherwise only reviews/reconciles imported transactions.

`Einstellungen` keeps only complete JSON backup export/restore. It no longer accepts KAS operational imports.

## Controlled deployment

1. Download a JSON backup from the owner account.
2. Add `KASSENBUCH_LEGACY_OWNER_CID=CID-26-00004` to `/etc/kassenbuch-pro.env`.
3. Pull and build the new main revision.
4. Restart only `kassenbuch-pro.service` on port 3099.
5. Login once with the previously incorrect CID and verify it starts empty.
6. Login with `CID-26-00004` and verify company settings, customers, devices, documents, ledger and representative attachments.
7. Do not manually delete legacy or quarantine browser keys until the checks are complete.
