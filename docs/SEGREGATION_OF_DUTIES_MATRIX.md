# Segregation of duties matrix

Current status: maker-checker prevents a document or journal submitter from approving the same
record when tenant policy is enabled, and outgoing supplier payments always require a different
authorized checker to approve or reject. Persisted tenant-scoped `WARN`/`BLOCK` rules seed four
warnings, expose conflicts in effective-access/review/simulation results, and reject configured
`BLOCK` conflicts on role create/update/duplicate, user primary/additional-role and override changes,
temporary grants and delegations. The current final suite passed these regression paths. A generalized
configurable same-record rule engine and governed exceptions are not claimed.

| Capability | Classification | Boundary |
|---|---|---|
| Same-record document/journal/payment maker-checker | Tested | dedicated server checks cover document and journal submission/approval plus outgoing payment maker/checker, including transition-race PostgreSQL regressions |
| Effective-access conflict warnings | Tested | Seeded `WARN` rules evaluate effective role, override, temporary and delegated permissions in access views, reviews and simulation |
| Configured assignment-time blocking | Partially implemented | Persisted `BLOCK` rules reject role create/update/duplicate, user primary/additional-role and override changes, temporary grants and delegations; this classification does not extend to same-record decisions |
| Generalized same-record rules and governed exceptions | Not implemented | Current document/journal maker-checker is a dedicated submitter check, not a configurable `BLOCK_SAME_RECORD` engine; exception requests, independent approval, expiry and compensating-control evidence are absent |
| Provider or external compliance attestation | Requires external/provider evidence | Organizational ownership, policy approval and external audit evidence are outside repository assertions |

The required-disposition column is the control objective, not a claim that every row is configured or
blocked today.

| Conflict | Permission groups | Required disposition | Current repository state |
|---|---|---|---|
| Supplier master maker and approver | supplier create + supplier approve | Separate assignment or independently approved exception | Seeded `WARN`; configured `BLOCK` is enforced on current permission assignments, but an operational supplier-approval workflow does not exist |
| Outgoing-payment maker and approver | payment create + payment approve | Separate assignment or independently approved exception | Seeded `WARN` plus a dedicated same-payment maker/checker check; configured `BLOCK` is enforced on current permission assignments |
| Purchase-order maker and approver | PO create + PO approve | Separate assignment and block same-record action | Seeded `WARN`; the general document maker/checker blocks self-approval, but it is not a configurable same-record SoD rule |
| Manual-journal maker and approver/poster | journal create/edit + journal approve/post | Separate assignment and block same-record action | Seeded `WARN`; document/journal submitter maker-checker exists, but no configurable same-record rule |
| Customer master and credit override | customer create/edit + credit-limit/credit-hold override | Warn and require compensating review | Not seeded/configured by the migration |
| Payroll preparer and approver/payer | payroll calculate + approve/post/pay | Separate assignment and same-record action | Not seeded/configured; operational payroll workflow is absent |
| Bank transfer initiator and approver | transfer create + transfer approve/post | Separate assignment and same-record action | Not seeded/configured |
| Stock-adjustment maker and approver | adjustment create/edit + approve/post | Separate assignment and same-record action | Not seeded/configured |
| Refund processor and approver | return/refund create + approve/pay | Separate assignment and same-record action | Not seeded/configured |
| Security administration and audit deletion/retention | permission manage + audit retention | Mutually exclusive duties | Not seeded/configured; governed audit deletion/retention action is absent |
| Period-close preparer and sole approver | period close + close approve | Separate assignment and same-record action | Not seeded/configured; enterprise close approval is absent |
| POS sale and unrestricted override/refund | sale use + override/refund approve | Supervisor or after-the-fact review | Not seeded/configured |
| Bank-account master and reconciliation | account create/edit + statement reconcile | Independent review | Not seeded/configured |

## Current evaluator and remaining target

The current evaluator expands wildcard matches and evaluates supplied/effective permission sets
against active tenant rules. `WARN` conflicts are returned in effective-access, review and safe-
preview evidence. `BLOCK` conflicts raise a conflict response before current role, user, temporary-
grant or delegation permission-set mutations are committed. Resource assignments and Company
membership changes do not themselves grant action-permission combinations, so they are bounded by
their own company/resource rules rather than this permission-pair evaluator.

The next depth is one common policy path for every access mutation plus configurable same-record
rules across supported business workflows. A future exception model requires a reason, requester,
independent approver, start/end dates, compensating control and append-only evidence. No current
exception lifecycle or expiring-exception report is claimed.
