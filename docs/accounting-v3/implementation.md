# Accounting workspace replacement

The former accounting screen reused a journal list for the general ledger, showed a flat account table, offered limited draft editing and printed truncated reports. This replacement supplies separate working surfaces for account hierarchy, journals, fiscal periods, transaction ledgers and financial statements.

## Active screens

| Route | Behavior |
| --- | --- |
| `/accounting/overview` | Live counts of draft, submitted and approved entries; pending review queue; current fiscal period; direct accounting tasks. |
| `/accounting/chart-of-accounts` | Actual saved parent relationships, expand/collapse, ancestor-preserving search, classification/status/company filters, account inspector, posted balance, child creation and protected editing. |
| `/accounting/journals` | Server-paginated register; date/branch/status/origin/search filters; directly addressable complete journal detail; blank balanced-entry editor; full manual draft editing; independent approval, posting and linked reversal. |
| `/accounting/periods` | Year-filtered calendar, open/closed/locked controls, creation with valid and non-overlapping date ranges. |
| `/accounting/general-ledger` | Real posted transaction lines with opening, movement, running and closing balances; account/group scope; server pagination; journal and source-document drill-through. |
| `/accounting/trial-balance` | Opening debit/credit, period debit/credit and closing debit/credit; exact totals and account drill-through. |
| `/accounting/income-statement` | Period revenue, cost of sales, gross profit, operating expenses, operating profit and other income/expenses. |
| `/accounting/balance-sheet` | As-of assets, liabilities, equity and cumulative unclosed earnings with reconciliation difference. |
| `/reports/overview`, `/reports/accounting` | Financial selections use the same new statement/ledger renderers, applied filters and export behavior. Other report types remain available. |

## Preserved rules and data

No schema migration or production business-data conversion is required. Existing account codes and parent relationships are preserved; visual classification headings are not invented ledger accounts. New accounts use the existing schema and permissions. Account edits reject cycles, incompatible parents, unauthorized company mappings and changes to protected used-account settings. Archival validates branch balances and active children.

Journal posting, maker/checker approval, branch access, account assignments, field permissions, source controls, reversal links and monetary storage remain enforced by the existing server. Amounts and financial balances use integer minor units/BigInt without floating-point aggregation. The UI disallows invalid or unbalanced new entries and starts without preset amounts or cost centers.

New account/ledger/journal endpoints add scoped filtering, hierarchy and pagination. The original `/journals` API remains compatible for other modules. Financial reports add consistent date/company/branch/account/cost-center scope. Text search narrows displayed ledger rows while keeping balances based on all movements in the selected financial scope; the screen and outputs explain this distinction.

## Output and identity

The new workbenches retain the source-verified ODIN colors, local Manrope and Noto Sans Arabic fonts, original eye artwork and live OSS. / ERP lockup. Arabic layout mirrors the workbench while keeping identifiers and amounts readable. CSV amounts are exact decimals with currency and formula escaping. PDF output uses branded, paginated tables with all rows, all financial columns, repeated headers, filter context and authoritative totals; Arabic uses embedded fonts.

## Verification and recovery

All mutations used the isolated QA database on loopback port 5547. Public verification is read-only apart from normal sign-in/session/audit events. Detailed final checks and screenshots are recorded alongside this document.

Before-change recovery: `checkpoint/accounting-before-rebuild-2026-09-26` points to `af9d5b0367e56bcf059971e555d419a58a5ae348`. The user's original work and previous UI release also remain in their existing checkpoint branches and `/srv/demo/backups` Git bundles. The prior running image is retained before release. No authentication credentials belong in this documentation or in the checkpoint.
