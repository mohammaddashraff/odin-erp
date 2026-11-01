# AV8 final delivery handover

The tested application release is **170b929bd4749e3ae53c7dcb0155e90d617210d9**, deployed to isolated Hetzner staging and [production](https://av8.odin-ltd.com). This documentation package records that release; later documentation commits do not change its images.

Technical delivery is ready for secure initial configuration. Live financial/personal-data operations still require the explicit owner/provider actions in the [readiness report](11-release-notes-and-readiness.md). Production email and email alerts are disabled until its separate key is configured. Actual staging reports and alerts were delivered and verified.

| Need | Document |
|---|---|
| Actual readiness, remaining decisions and precise next steps | [Release notes](11-release-notes-and-readiness.md) |
| Exact commit, CI, image IDs, test commands and actual host evidence | [Release verification](14-release-verification.md) |
| Route/control coverage and acceptance results | [Coverage matrix](01-scope-and-route-coverage.md), [test results](05-test-results-and-evidence.md) |
| Daily staff use | [English guide](09-user-guide-en.md), [Arabic guide](10-user-guide-ar.md) |
| Named administrator onboarding, delivery retries and support | [Admin/support runbook](08-admin-and-support-runbook.md) |
| Hosting, migration, rollback and local backup | [Deployment/recovery runbook](07-deployment-and-recovery-runbook.md), [Hetzner procedures](hetzner-deployment.md), [isolated restore procedure](hetzner-local-restore-drill.md) |
| Client decisions, cutover and witnessed demonstration | [Decision sheet](02-business-rules-and-decisions.md), [opening manifest](opening-manifest.md), [client UAT script](13-client-uat-script.md) |
| Preserved execution history and historical review disposition | [Ledger](00-execution-ledger.md), [review disposition](12-historical-review-disposition.md) |

First owner: retrieve the generated setup credential privately from `/srv/av8-erp-final/production/private/bootstrap/initial-owner.json`, enroll MFA, save recovery codes privately and change the temporary password. The issued setup credential expires `2026-11-01T19:58:58.645Z`. No shared/default password or secret is included in this package.

Production email: privately configure a separate `AV8_ACADEMIC_EMAIL_API_KEY` in `/srv/av8-erp-final/production/private/provider.env` and confirm before activation and the controlled production checks. Both private provider files remain service-owned with mode 0600 inside protected directories. Do not reuse the staging credential.

“Off-host encrypted backups and recovery from an off-host destination: deferred by the project owner.”

Local encrypted backup and isolated staging restoration passed. No external disaster recovery, production-data restore or proposed RPO/RTO target is claimed. Available host disk was approximately 2.43 GB after rollout; review capacity and archive retention before large imports/builds.
