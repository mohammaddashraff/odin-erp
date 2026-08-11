# Design system and localization architecture

Status date: 2026-08-11. This is the current design contract for the enterprise UI tranche. A design
concept or merged component is not **Tested** until the current immutable application commit passes
the automated and visual checks recorded in `VERIFICATION.md`.

## Status classification

| Capability | Classification | Evidence boundary |
|---|---|---|
| Semantic design and localization contract | Implemented | The tokens, component responsibilities and invariants are defined here for one unified Odin system |
| Western digits in Arabic UI and generated outputs | Implemented | Central web and API/export locale resolution uses `ar-EG-u-nu-latn`; current formatter/full-route/input/export evidence is pending |
| Enterprise loading, skeleton and action-feedback system | Partially implemented | Reusable page/card/table/form/report/chart skeletons, loading buttons, route transitions, dialog/drawer motion, success feedback and reduced-motion CSS exist; not every route/action family has current browser evidence |
| Semantic palette, dashboard hierarchy and module accents | Partially implemented | brand, information, success, warning, danger, analytical and neutral tokens are integrated into KPIs, statuses, charts and module cues; final light/dark contrast and visual verification remain pending |
| RTL/responsive directional behavior | Partially implemented | logical CSS, bidirectional value isolation and desktop/tablet/mobile rules are implemented, including the new governance, attachment and loading components; current full-route browser evidence remains pending |
| Current-tranche automated acceptance sources | Implemented | formatter, rendered-digit, loading geometry, reduced-motion, responsive RTL and overflow assertions exist; no current immutable SHA or exact final totals have been recorded yet |
| Current-tranche visual acceptance record | Partially implemented | fresh local review images exist outside the repository, but final artifact references and immutable-run evidence remain to be recorded in `VERIFICATION.md` |

## Western-digit Arabic policy

Arabic text remains Arabic and the document remains RTL, but every numeric value uses the Latin
numbering system (`latn`): `0 1 2 3 4 5 6 7 8 9`. The policy applies to visible text, input values,
placeholders, accessible labels, toasts, dialogs, tables, charts, reports, CSV/PDF output, dates,
times, identifiers, pagination and print previews. Arabic-Indic (`٠-٩`) and Persian (`۰-۹`) glyphs
must not be emitted by application formatting.

The implementation contract is:

1. One locale resolver returns an Arabic locale with `u-nu-latn`; individual screens do not choose
   their own numbering system.
2. Central formatters own number, quantity, percentage, exchange rate, currency, date, date/time and
   month/year rendering. The API uses an equivalent centralized resolver for generated documents.
3. Translation templates preserve already formatted values. Dynamic record counts use the same
   formatter instead of a separate Arabic-number helper.
4. Identifiers, codes, phone numbers, email, IP, SKU, IBAN/account values and document references use
   `<bdi>` or an LTR value class so their reading order remains stable inside RTL text.
5. No CSS or post-render digit substitution is permitted; values must be correct before rendering,
   exporting or generating a PDF.

## Loading and motion architecture

Loading feedback mirrors the destination layout and preserves geometry:

- Page transitions use a short opacity/vertical reveal without blanking the application shell.
- Dashboard skeletons retain the KPI grid, icon containers, chart regions and activity layout, with
  a modest stagger only after data becomes available.
- Table skeletons retain headers and realistic varied cell widths. Forms, cards, detail panels,
  side panels, reports and charts use purpose-shaped skeleton primitives.
- Action buttons retain their measured width, disable repeated submission and expose contextual,
  localized verbs such as Saving, Posting, Approving or Generating.
- Dialogs and drawers use short enter/exit transitions; success feedback is brief, professional and
  tied to the completed record or posting reference.
- `prefers-reduced-motion: reduce` removes non-essential transforms, shimmer and stagger while
  retaining immediate state communication. Large datasets and table rows are never animated.

CSS transitions and lightweight primitives are preferred. Loading state must not add application
requests, cause avoidable rerenders, move the shell, or delay interaction after data is ready.

## Semantic palette and component contract

Color expresses meaning, not page decoration. Light and dark themes expose the same semantic roles:

| Family | Meaning | Typical use |
|---|---|---|
| Primary/brand | Current selection and principal action | active navigation, primary button, focus accent |
| Information/cyan-blue | Neutral operational information | receivables, operational KPIs, informational alerts |
| Success/green | Completed, paid, healthy or favorable | success feedback, positive KPI trend, paid status |
| Warning/amber | Pending, low stock, approaching limit/deadline | approval queue, attention chip, stock warning |
| Danger/red | Rejected, overdue, failed or critical | destructive action, failed posting, critical alert |
| Analytical/indigo-purple | Analysis/reporting or secondary insight | inventory/report cards and chart series |
| Neutral/slate | Structure and ordinary content | surfaces, borders, typography, inactive state |

Tokens define foreground, subtle background, border and strong accent variants for each family.
Components consume semantic roles rather than raw color values. Status badges, alerts, KPI accents,
icon containers, progress indicators and chart series use the same mapping. A zero or ordinary state
remains neutral; a negative accounting value is not automatically an error unless the business
meaning is adverse.

## Dashboard and module identity

KPI cards share structure but vary by meaning through a restrained edge/icon accent, label hierarchy,
trend treatment and supporting context. Charts use a stable accessible series palette and visible
legends; empty states explain the missing data or next action. Page headers, spacing and information
density remain consistent across modules.

Accounting, Sales, Purchasing, Inventory, POS, HR, Approvals, Reports and Administration may select
one semantic module accent and icon. The accent affects navigation cues, section headers, icon
containers and chart defaults, not foundational layout or component behavior. Modules must continue
to look and behave like one Odin application.

## RTL and responsive contract

Logical CSS properties own layout. Back/forward and disclosure icons respond to semantic direction;
functional icons such as search, print, edit and status do not flip. Breadcrumbs, table headers,
pagination, menus, tooltips, dates, chart legends and drawers are checked independently rather than
assuming global `direction: rtl` is sufficient. Numeric table cells retain stable numeric alignment,
and mixed Arabic/Latin strings use explicit bidirectional isolation.

## Verification and visual references

Automated acceptance must cover formatter outputs, absence of Arabic/Persian digit glyphs on Arabic
routes and input values, RTL attributes/directional controls, reduced-motion behavior, layout-shaped
skeletons, busy-button width/disabled state and zero horizontal overflow at desktop/tablet/mobile
sizes. Fresh screenshots are generated only by a current Playwright run and recorded in
`VERIFICATION.md`.

The following accepted concept images guide implementation but are not PASS evidence. The dashboard
uses six KPIs available from the real dashboard API, and the loading reference mirrors those six KPI
skeletons:

- `docs/design/odin-enterprise-semantic-dashboard-concept-v2.png` — accepted desktop reference
- `docs/design/odin-enterprise-loading-system-concept-v2.png` — accepted loading reference with six
  KPI skeletons matching the real dashboard contract
- `docs/design/odin-enterprise-mobile-rtl-concept.png`

Concept images are directional references, not pixel specifications or seeded-data fixtures. The live
dashboard may use a responsive 3-by-2 KPI grid instead of one six-card row, show current persisted
metrics/activity/exceptions, include an additional balance-composition chart, and render every seeded
inventory row. Those differences are intentional when they preserve the information hierarchy and
real API contract; they must not be reported as screenshot equality.
