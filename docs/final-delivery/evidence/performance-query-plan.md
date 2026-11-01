# Lead search cold-statistics regression

The fresh aggregate run found an actual performance failure: early 10,000-contact searches exceeded the unchanged five-second acceptance bound, while later requests were fast after statistics refreshed. This was not treated as a timing waiver.

Captured the actual Prisma page/count SQL and executed `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on the isolated PostgreSQL test database under `av8_runtime` with tenant RLS. The fixture inserted 10,000 synthetic contacts/leads inside a transaction after analyzing only the small existing baseline. No post-insert `ANALYZE` could hide the stale-statistics behavior. All diagnostic inserts and the experimental index were rolled back afterward.

| Exact query | Before index | With `(tenant_id, customer_id)` index |
|---|---:|---:|
| Page | 7,908.285 ms | 14.300 ms |
| Count | 8,018.685 ms | 10.042 ms |

The old nested-loop plan estimated one customer but found 10,000, repeatedly scanning 10,031 tenant leads and rejecting 100,300,000 join pairs. The index changed each inner join to a one-row index lookup; the count used an index-only scan. Captured plan-node evidence is in [performance-plan-comparison.json](performance-plan-comparison.json).

Delivered additive migration `20261101005000_av8_lead_customer_join`, matched by the Prisma `Av8Lead` index. Search semantics, branch/company filtering and RLS were not relaxed. No earlier migration checksum changed. Migration 43 was applied to the isolated test database; other deployment targets remain the release owner's migration gate.

`delivery-performance.database.spec.ts` now includes a first-search regression using the actual `Av8Service.leads` method inside a rollback-only bulk-insert transaction, with an explicit check of runtime role and effective lead-table RLS. The test retains the original `<5000ms` requirement. Existing 20 paginated list searches, Arabic normalization, duplicate-preview and collections-report checks remain.

Latest focused execution: **2/2 tests passed**, 19.122 seconds. First search before statistics refresh: **40.62ms**. Twenty list queries: **p95 50.09ms; maximum 60.46ms**. Duplicate preview 100 rows: maximum 296.09ms. Collections report 50 persisted synthetic rows: maximum 18.28ms. API TypeScript checking passed. Logs: `.av8/performance-cold-regression.log`, `.av8/performance-cold-types.log`; machine-readable measurements: `output/performance/evidence.json`.

These are local service/database measurements, not a hosted concurrency or latency SLA. The final aggregate run and exact release commit remain separately recorded by the release owner.
