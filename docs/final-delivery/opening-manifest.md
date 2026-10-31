# Opening manifest version 1

All money fields ending in `Minor` are exact integer **strings**, never decimal floats. Student tuition, allocations and academy obligations are USD cents. `currency` on an original receipt, resource or service uses that configured currency's minor-unit precision. `usdRateMicros` is USD per original unit × 1,000,000; `baseRateMicros` is book-currency units per original unit × 1,000,000. Preserve source rates and explain their provenance. USD-to-USD must be 1,000,000.

Endpoint contract:

- `POST /api/av8/opening/preview`: the manifest directly as JSON or multipart file field `manifest`.
- `POST /api/av8/opening/commit`: `{manifest,previewHash,reason}` plus `Idempotency-Key`, or multipart `manifest` file plus `previewHash` and `reason` fields.
- `GET /api/av8/opening`: scoped immutable batches with imported ID mappings and original control balances.

Preview returns `{valid,errors:[{path,message}],counts,totals,previewHash,existingRows,applicationCount,resourceCount,dateBasis,createsCashTransactions:false}`. Commit requires Finance adjustment and Accounting journal posting permission, valid assigned scope, a reason, matching preview hash and an independently approved posted manual opening journal in an open cutover fiscal period. A repeat returns the original mapping; changing content under an existing source ID is rejected. The full file is one database transaction. Limits: 200 applications, 120 schedule entries/application, 500 historical funds per collection, 120 services/application, 100 pending refund cases/application, 200 resource/control entries, 20 MB uploaded JSON and 4 MB per original signed document. Use smaller, reviewed cutovers for operational timeouts.

The following is a **schema example**, not an executable business instruction. Replace IDs, dates, references, rate provenance, original values, cutoff and original file with approved source evidence. No synthetic signed document is provided. The illustrative controls do not define approved financial policy.

```json
{
  "version": 1,
  "sourceSystem": "approved-legacy-register",
  "cutoverDate": "2026-01-01",
  "openingJournalId": "REPLACE_WITH_APPROVED_POSTED_JOURNAL_ID",
  "resources": [
    {"bankAccountId":"REPLACE","currency":"USD","openingMinor":"100000","baseMinor":"5000000","baseRateMicros":"50000000","rateProvenance":"REPLACE_WITH_SOURCE_RATE_EVIDENCE"}
  ],
  "customerLiabilities": [
    {"accountId":"REPLACE_LIABILITY_ACCOUNT","currency":"USD","amountMinor":"100000","baseMinor":"5000000","baseRateMicros":"50000000","rateProvenance":"REPLACE_WITH_APPROVED_CONTROL"}
  ],
  "supplierBalances": [],
  "expectedTotals": {
    "studentContractMinor":"200000",
    "studentPaidMinor":"100000",
    "studentOutstandingMinor":"100000",
    "academyEntitlementMinor":"50000",
    "academyTransferredMinor":"50000"
  },
  "applications": [
    {
      "sourceId":"legacy-application-1","personSourceId":"legacy-person-1",
      "reference":"REPLACE_ORIGINAL_APPLICATION_REFERENCE",
      "name":"REPLACE_ORIGINAL_STUDENT_NAME","phone":"REPLACE_ORIGINAL_PHONE",
      "branchId":"REPLACE","ownerId":"REPLACE","academyId":"REPLACE",
      "program":"REPLACE_ORIGINAL_PROGRAMME",
      "contract": {
        "planKey":"A","reference":"REPLACE_ORIGINAL_SIGNED_REFERENCE","signedDate":"2025-12-01",
        "policyReference":"REPLACE_ORIGINAL_SIGNED_POLICY",
        "document":{"fileName":"original-signed-agreement.pdf","mimeType":"application/pdf","base64":"REPLACE_WITH_ORIGINAL_SIGNED_FILE_BASE64"}
      },
      "schedule":[{"sourceId":"charge-1","key":"TUITION","label":"Original agreed tuition","currency":"USD","amountMinor":"200000","creditMinor":"0","paidMinor":"100000","dueDate":"2026-06-01","predeparture":false,"deferred":false}],
      "academyObligations":[{"sourceId":"obligation-1","amountMinor":"50000","paidMinor":"50000","dueDate":"2025-12-15","evidenceReference":"REPLACE_ORIGINAL_ENTITLEMENT_EVIDENCE"}],
      "receipts":[{"sourceId":"receipt-1","confirmed":true,"reference":"ORIGINAL_RECEIPT_1","date":"2025-12-10","rateDate":"2025-12-10","method":"BANK","bankAccountId":"REPLACE","liabilityAccountId":"REPLACE_LIABILITY_ACCOUNT","amountMinor":"200000","currency":"USD","usdMinor":"200000","usdRateMicros":"1000000","baseRateMicros":"50000000","rateProvenance":"REPLACE_ORIGINAL_RATE_EVIDENCE","allocations":[{"sourceId":"charge-1","amountMinor":"100000"}]}],
      "remittances":[{"sourceId":"transfer-1","confirmed":true,"reference":"ORIGINAL_TRANSFER_1","date":"2025-12-15","rateDate":"2025-12-15","method":"BANK","bankAccountId":"REPLACE","amountMinor":"50000","currency":"USD","usdMinor":"50000","usdRateMicros":"1000000","baseRateMicros":"50000000","rateProvenance":"REPLACE_ORIGINAL_RATE_EVIDENCE","allocations":[{"sourceId":"obligation-1","amountMinor":"50000"}]}],
      "services":[],"pendingRefunds":[]
    }
  ]
}
```

`customerId` may explicitly link an existing authorized company contact. Otherwise `personSourceId` maintains repeat application identity. A possible existing phone/email duplicate blocks preview until it is explicitly linked or `duplicateReviewed:true` documents the choice to keep a separate person. The importer does not merge two people automatically. Original `inquiryDate`, email, city, guardian source data and departedAt can be supplied. Missing admission state becomes `IMPORTED_REVIEW_REQUIRED`; missing medical/visa/travel remains pending/preparing. No elapsed-time approval is inferred.

An original signed agreement is optional only for a source application that genuinely has none. When present, preserve the original PDF/image; its magic bytes/hash are checked. `originalPolicySnapshot` may preserve the original structured policy. A deferred charge requires `contract.settlement:{deferredPassThrough:true,approvalReference:"original approved source reference"}`. Other policy values are not filled in from today's defaults. Imported schedules remain their actual original amounts and dates. Subsequent reviewed corrections must retain the signed original.

Service entry: `{sourceId,type:"ACCOMMODATION"|"TRANSPORT",provider,collectionParty:"AV8"|"PROVIDER",period:"YYYY-MM",amountMinor,paidMinor,currency,evidenceReference,receiptSourceId?}`. Paid AV8 services link an imported receipt in the same currency; tuition plus services cannot exceed it. Direct provider payments have no AV8 cash. Unless `ongoing:true` is explicitly supplied, the agreement ends with the supplied month's last day. Optional source startDate/endDate preserve the actual period.

Pending refund entry: `{sourceId,amountMinor,terminationDate,deadline,policyReference,approvalReference?,reason?}`. It remains decision-required, with no payout, until the separate reviewed refund workflow reconciles original approvals and prior payments. Supplier balance entry: `{supplierId,accountId,currency,amountMinor,baseMinor,baseRateMicros,rateProvenance}`. All supplier and customer control entries for each GL account sum to its approved opening journal liability balance. Supplier controls are immutable opening reconciliation evidence, not a newly created payable invoice.

Dry run checks source identity collisions, dates, currencies/precision, exact source totals, allocation ownership/limits, signed evidence, same-company resources/academy, scope, approved journal controls and duplicate opening baselines. All historical receipts/remittances must have source-confirmed clearance. Pending cheque/collection instructions must be reviewed separately; importing them as paid would falsify the source.

After import, Business settings shows each supplier's original, paid and remaining amount with its settlement history. The supplier statement includes the same opening and linked settlements. Finance-confirm users can link an already posted payment (or an actual receipt for a supplier credit), or an independently approved posted manual journal with bank resource, original amount, documented decimal rate and evidence. This creates no second cash event or supplier invoice. Partial settlements remain open; duplicate source use and amounts above the remaining balance fail.

Integration contract: `POST /api/av8/opening/supplier-settlement` with idempotency key and `{sourceSystem,batchSourceId,balanceIndex,bankTransactionId,evidenceReference,reason}`. The manual journal alternative uses `{sourceKind:"JOURNAL",sourceSystem,batchSourceId,balanceIndex,journalEntryId,bankAccountId,amount,baseRate,rateProvenance,evidenceReference,reason}`. History remains an array of batches, each with `supplierBalances` containing supplier name, currency precisions, original/paid/remaining minor strings and immutable `settlements`. Import controls require finance-adjust; settlement requires finance-confirm; visibility requires finance-view and original company/resource scope.
