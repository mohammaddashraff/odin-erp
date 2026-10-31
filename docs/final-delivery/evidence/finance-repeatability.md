# Finance workflow repeatability

A repeat aggregate run failed because the workflow fixture selected the first USD resource from an unordered `refs.banks` array. Earlier successful tests had legitimately created USD cash drawers and branch resources. SQL result order changed, so the fixture selected an unassigned cash drawer for later bank/refund/remittance cases. Authorization correctly rejected that choice; cheque validation correctly rejected a cash drawer as a clearance bank.

Read-only diagnosis of the failed local synthetic run confirmed refund64 and remittances70/75/81 selected bank6 (`CASH-6C59BAFD`, type `CASH`). That resource had no finance or management assignment. The intended banks1/2 (`AV8-USD`, `AV8-EGP`, type `BANK`) retained active, explicit assignments for both actors. The first permission failure caused later journey-dependent assertions to fail; it was not thirteen independent financial defects.

The fixture now resolves its two exact seeded bank codes, verifies both are active `BANK` resources in its tenant with the expected currencies, and uses those IDs from authorized references. Production services, permissions, resource assignments, policies and immutable financial history were not changed. No default currency-wide access grant or super-admin substitution was introduced. Earlier failed prepared instructions remain as history.

Executed the full workflow twice against the **same already-populated isolated database**, without resetting it:

| Run | Result | Duration | Local log |
|---|---|---:|---|
| First | 34/34 passed | 13.766s | `.av8/finance-repeat-1.log` |
| Second | 34/34 passed | 9.851s | `.av8/finance-repeat-2.log` |

API TypeScript checking passed (`.av8/finance-repeat-types.log`). The command for each run was `node scripts/av8/run.mjs test npm exec --workspace @odin/api -- jest --runInBand --testPathPatterns=av8-workflow.database.spec.ts`, using the task's Node24 path. Final aggregate and exact-commit results remain the release owner's separate evidence.
