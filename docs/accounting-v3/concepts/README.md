# Accounting workbench concepts

Generated with the built-in Image Gen tool before accounting source implementation. These images guide native components; they are not application assets, source data, or screenshots of the running product. Prompt set: [prompts.json](prompts.json).

## Final references

- [Accounts, Arabic RTL](accounts-tree-ar.png): final tree refinement.
- [Account ledger, English](ledger-en.png).
- [Trial balance, Arabic RTL](trial-balance-ar.png).

The earlier [accounts-ar.png](accounts-ar.png) pass is retained only as generation history and is superseded by accounts-tree-ar.png.

## Shared implementation anatomy

Use the existing authenticated shell, verified original logo image and live OSS. / ERP lockup. The empty white logo region in every concept is intentional; do not generate a replacement. The shell remains navy #102747, white topbar, and light #F4F7FC workspace. Preserve Manrope / Noto Sans Arabic, blue #245DE8 actions (#1545BD hover), #53647B secondary text, #DCE4EF borders, white report/work surfaces. Restrained 6px controls, 1px borders, no gradients, decorative metric grids or marketing content. Primary title 28px, financial row text 14px, auxiliary labels 12px, rows approximately 40px. Controls and headings may grow vertically in Arabic to avoid clipped ascenders/descenders.

Accounting sub-navigation connects Accounts, Journals, Ledger, Trial balance and Financial statements where supported by the existing routes. The selected tab must follow the actual route. Keep labels translated and account codes / numbers isolated LTR. Generated navigation labels and sample branch/user names are illustrative: use the existing permission-aware application navigation and authenticated context.

## Accounts

One split workbench, tree-table on the leading side (~70%) and selected-account inspector on the trailing side (~30%). Arabic reverses the composition. Filters sit above tree rows, with clear search, account-type and active-state fields. Keep no more than necessary controls visible.

The final image is the tree reference: each descendant moves 24px inward with visible connector/elbow lines; depth is data-derived. Roots, groups and posting accounts have different disclosure behavior. Selected row uses pale blue fill and blue leading border. Account code remains LTR next to its label. Group/posting status must be unambiguous; show actual account type separately where existing data supports it.

Inspector: selected name and code, parent, type, normal balance, posting status and active state, followed by edit / ledger / add-child actions. These actions follow actual permissions and API capabilities. The concept's example group codes are not a migration plan or data defaults.

Small screens: tree retains logical hierarchy and scrolls locally as necessary; inspector follows the tree as a stacked region or an accessible selected-account view. Do not compress financial columns into unreadable text.

## Account ledger

Title and export/print actions, compact account + date-range + branch filter area, explicit posted scope, then a continuous four-cell financial strip: opening, debit movement, credit movement, closing. This is one strip with dividers, not four detached KPI cards.

Full-width table below: date, journal/source references, description, debit, credit, running balance. Use exact money arithmetic/formatting and explicit debit/credit balance nature. Journal and source references link to their real records; do not fabricate link destinations. Opening and totals are differentiated without heavy decoration. Pagination/count reflects actual returned API coverage.

Small screens: filters wrap, summary remains readable, table scrolls within its own region. Print removes shell and controls and preserves account, period, branch, currency, scope, entries and totals.

## Trial balance / reports

Filters and CSV/PDF/print actions stay outside a white report sheet. Sheet header contains actual company, report title, selected period, branch and currency. Posted scope is visible. Trial balance uses grouped opening / movement / closing columns with separate debit and credit underneath each heading. Totals receive a strong top rule. Rows link to ledger with the report period carried across.

Use exact backend results and honest availability. Show a balanced indicator only when actual totals balance; do not hide a discrepancy. Other supported financial reports reuse this formal sheet anatomy with their actual row/column structure. Print excludes application controls and retains heading, context, table and footnotes.

## Known image-generation corrections required in code

1. Ledger image accidentally selects the Accounts tab. Select Ledger for the ledger route.
2. Generated account table uses the word type for group/posting kind; use separate accurate type/kind labels where needed and preserve actual server values.
3. The tree image omits a separate visible asset-type column in favor of inspector detail. If a type filter/result requires the table column, add the concise type column without breaking hierarchy.
4. Trial-balance concept has no separate main title outside the report sheet. Keep the existing page heading where necessary for accessibility and route consistency.
5. Example names, dates, balances, row counts and sample account classifications are illustrative. Never ship them as synthetic data.
6. Generated logo region is blank. Existing original logo / live lockup is required in production.
7. Concept shows export formats as desired controls. Only expose a format backed by the existing download flow or a genuinely implemented export; no inert controls.
