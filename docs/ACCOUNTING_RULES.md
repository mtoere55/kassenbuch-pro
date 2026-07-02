# Accounting and Device-Trade Rules

## Device purchase

A completed purchase creates:

1. a purchase record
2. a unique device stock record
3. a purchase contract document
4. an expense ledger entry
5. a permanent link to the seller/customer

The IMEI is normalized to digits and checked with the Luhn algorithm. Duplicate IMEIs are rejected.

## Device sale

A completed sale creates:

1. a sale record
2. an invoice or receipt
3. an income ledger entry
4. a stock-status change to `sold`
5. permanent links to device and customer

The original purchase is never overwritten.

## Differential taxation

For a qualifying §25a item:

```text
gross margin = sale price - purchase price
contained VAT = positive gross margin × 19 / 119
operational result = sale - purchase - repair costs - contained VAT
```

If the margin is negative, differential VAT is zero.

Repair and platform costs reduce operational profit but do not change the purchase/sale difference used by the implemented §25a calculation.

A §25a customer document does not show VAT as a separately deductible amount.

## Standard taxation

For a standard 19% gross sale:

```text
contained VAT = gross amount × 19 / 119
```

## Z-report

A scanned Z-report can be stored in two modes:

- **reconciliation only:** archive and compare; do not create sales again
- **book daily sales:** create separate cash and card income entries

This prevents the same turnover from being booked twice when individual sales already exist.

The combination of report date and Z-report number is treated as unique.

## Bank and PayPal

Imported transactions are payment evidence, not automatically new revenue or expense.

Matching uses:

- absolute amount
- date proximity
- document number in transaction text

PayPal-to-bank transfers and other own-account transfers must be represented as internal transfers in the production accounting engine.
