# Compliance Design Notes

This document describes the engineering direction, not a legal certification.

## GoBD-oriented controls

Production milestones must include:

- original document retention
- documented import and OCR process
- immutable posting state
- reversal instead of deletion
- complete change history
- user and timestamp attribution
- backup, restore and retention controls
- machine-readable audit export
- process documentation (`Verfahrensdokumentation`)

The local prototype keeps links and avoids duplicate records, but it is not positioned as a complete GoBD archive.

## Fiscal cash register

A production POS mode that records retail payments and issues cash-register receipts must use a certified TSE integration and validated export format. Kassenbuch Pro will expose a provider adapter; it will not attempt to emulate a TSE.

## Bank access

Commercial automatic account access must use an approved open-banking provider and explicit customer consent. Credentials and consent tokens must remain server-side.

## Privacy

Production controls:

- collect only necessary customer data
- role-based access
- tenant isolation
- retention and deletion policies where legally permitted
- encrypted transport and encrypted storage
- no real customer data in development environments
