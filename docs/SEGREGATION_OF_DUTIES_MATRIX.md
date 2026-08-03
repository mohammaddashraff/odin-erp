# Segregation of duties matrix

Current status: maker-checker prevents the same submitter from approving a document or journal when tenant policy is enabled. The broader SoD engine below is **not implemented**.

| Conflict | Permission groups | Default severity | Required disposition |
|---|---|---|---|
| Supplier master and supplier payment | supplier create/edit + payment create/post | Critical | block or independently approved exception |
| Customer master and credit override | customer create/edit + credit-limit/credit-hold override | High | warn; require compensating review |
| Purchase order maker and approver | PO create/submit + PO approve | Critical | block same-record action |
| Manual journal maker and poster | journal create/edit/submit + journal post | Critical | block same-record action |
| Payroll preparer and approver/payer | payroll calculate + approve/post/pay | Critical | block combination or same-record action |
| Bank transfer initiator and approver | transfer create + transfer approve/post | Critical | block same-record action |
| Stock adjustment maker and approver | adjustment create/edit + approve/post | High | block same-record action |
| Refund processor and approver | return/refund create + approve/pay | Critical | block same-record action |
| Security administration and audit deletion/retention | permission manage + audit retention | Critical | mutually exclusive duties |
| Period close preparer and sole approver | period close + close approve | Critical | block same-record action |
| POS sale and unrestricted override/refund | sale use + override/refund approve | High | supervisor or after-the-fact review |
| Bank account master and reconciliation | account create/edit + statement reconcile | High | independent review |

## Target evaluator

Evaluate conflicts during role save, user assignment, temporary grant, delegation, and access review. Policies are tenant/company scoped and can be `WARN`, `BLOCK_ASSIGNMENT`, or `BLOCK_SAME_RECORD`. An exception requires reason, requester, independent approver, start/end dates, compensating control, and append-only evidence.

The engine must evaluate effective access, including additional roles, overrides, temporary grants and wildcards. Access-review reports list unresolved conflicts and expiring exceptions.
