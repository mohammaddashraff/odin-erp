# Accounting PDF verification

The accounting PDF renderer consumes the already-authorized and filtered report returned by the service. It does not query data or calculate balances. The controller forwards the same report metadata used for the visible report and CSV.

## Changes

- Trial balance prints the account code/name plus all six opening/movement/closing debit-credit columns. Ledger prints date, journal, account code/name, description, source, debit, credit, running balance and cost center when present. Financial statements print actual account classification and amounts, then all returned totals.
- All rows and totals are retained, with repeated report context and table headers on every page. Ordinary rows stay together; exceptionally long cells continue across pages without ellipsis.
- Monetary values use BigInt throughout formatting. Wide values expand column allocation and select A3 landscape when necessary; normal reports use A4 landscape. Money stays right aligned.
- Printed context includes authorized company/branch, date range, base currency, posted scope and active account/cost-center/search filters. Search-balance semantics are explicit.
- Original packaged logo and live OSS. / ERP lockup, local Manrope and Noto Sans Arabic, and verified ODIN palette are used. Arabic runs are shaped by fontkit; Latin identifiers and Western digits remain LTR. Contextual Arabic text tags preserve exact dotted characters in extraction.
- Generic invoice/POS PDF exports retain their behavior while removing their 84-row and 6-column truncation limits.

## Verification run

Executed on the QA host with Poppler (`pdftotext`, `pdfinfo`, `pdffonts`, `pdftoppm`):

```sh
PATH=/tmp/odin-runtime/bin:$PATH npm run lint -w @odin/api
PATH=/tmp/odin-runtime/bin:$PATH ODIN_PDF_EVIDENCE_DIR=/tmp/odin-accounting-pdf npm test -w @odin/api -- --runTestsByPath src/accounting-pdf.spec.ts
```

Result: API typecheck passed; 7 tests passed. Coverage: exact monetary values above Number precision; all 105 ledger rows and final totals; all 100 trial rows and eight columns in English and Arabic; packaged fonts embedded; valid raster rendering; final exact large balances; actual controller scope-metadata forwarding; 90-line invoice and POS exports; a 300-phrase description crossing pages without a missing tail.

English and Arabic first/final trial-balance pages and the ledger first page were rendered with Poppler and visually inspected. Joined Arabic text, LTR identifiers, right-aligned exact monetary cells, repeated headers, original logo, and final totals were checked. Evidence PDFs/PNGs are in `/tmp/odin-accounting-pdf`; they contain synthetic test fixtures only. Tests remove temporary artifacts automatically unless ODIN_PDF_EVIDENCE_DIR is set.

No production service, accounting entry or database record was changed by this renderer subtask.


Final release performance check on the real isolated QA ledger (429 rows, maximum field length 45): English 3.186 seconds / 181 MB peak RSS, Arabic 3.322 seconds / 264 MB peak RSS, with a 256 MB V8 heap limit and 30-second external deadline. All 429 rows were rendered. A prior 22-minute request happened while concurrent builds/tests exhausted host RAM and swap; the bounded repeat and exact-image exports passed after jobs were sequenced.

Final PDF suite: eight tests pass, including a 13-account trial balance with its total and difference on one page in both languages. Final backend regression: 23 suites / 213 tests pass.
