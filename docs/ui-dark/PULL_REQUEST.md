The ERP previously used a light layout and a collapsible sidebar. This change applies the supplied dark navy/electric blue reference across the shared frontend system, with a horizontal module menu, mobile drawer, permission-filtered page search and consistent forms, tables, dialogs and reports.

The financial dashboard now presents existing scoped KPIs, currency-separated document trends, recent documents and inventory/financial panels. AV8 daily operations remain available through the AV8 menu and `/dashboard?view=daily`. Backend services, APIs, authentication, financial/inventory rules and dependencies are unchanged.

### Scope and evidence

- 78 registered routes share the new design; the route tracker also covers auxiliary/dynamic entries, redirects and nested workflows.
- English/Arabic, RTL, keyboard focus, mobile widths and print styling are covered.
- [Route checklist](https://github.com/mohammaddashraff/odin-erp/blob/feature/odin-erp-glass-redesign/docs/ODIN_UI_REDESIGN_TRACKER.md)
- [Verification and screenshot gallery](https://github.com/mohammaddashraff/odin-erp/blob/feature/odin-erp-glass-redesign/docs/ui-dark/VERIFICATION.md)
- [Dashboard screenshot](https://github.com/mohammaddashraff/odin-erp/blob/feature/odin-erp-glass-redesign/docs/ui-dark/screenshots/dashboard-desktop.png)

### Validation

- Frontend production build and TypeScript passed.
- 8 redesign browser tests; 5 existing navigation/localization/permission tests; 2 existing date tests; 3 exact-money tests.
- Screenshots and browser interactions use explicit test-only fixtures. Application components continue to use the existing APIs.
- Repository-wide type checking and backend integration remain blocked by the ungenerated Prisma Client; the current environment blocks its download host. The translation audit has pre-existing findings and no new findings from this change.

Keep this PR in draft until live isolated-backend workflows are verified. No production deployment or merge is authorized by this PR. See the verification document for untested CRUD, posting, MFA, attachments, exports and full business workflows.
