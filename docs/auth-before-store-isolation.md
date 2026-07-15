# CID authentication before bookkeeping storage

## Root cause

The previous browser isolation mounted `KassenProvider` before `CidGateway` had restored or verified the Cidentia session. While logged out, the provider could hydrate the legacy unscoped Handyshop dataset. During the next CID login, the active CID pointer changed before the page reload completed. The already-mounted provider could then persist the in-memory Handyshop state into the newly selected CID key.

This created the observed behavior: the session chip showed different CIDs, but every CID received the same business profile and bookkeeping records.

## Correct architecture

The authentication gateway is now the outer boundary:

1. Restore or verify the signed Cidentia session.
2. Activate and repair the CID-specific browser scope.
3. Only then mount `KassenProvider` and attachment hydration.
4. Unmount the complete bookkeeping store on logout.

No customer, device, business setting, ledger entry, document or attachment is loaded while the user is logged out or before a verified CID scope is active.

## Existing leaked scopes

A versioned one-time repair compares non-owner CID state with the configured legacy owner state. Strong business-identity matches or high record-ID overlap are treated as leaked copies. The leaked state and attachments are quarantined before the CID receives an empty dataset.

Production continues to require:

```env
KASSENBUCH_LEGACY_OWNER_CID=CID-26-00004
```

The quarantine is intentionally retained for recovery and is not shown in the normal application.
