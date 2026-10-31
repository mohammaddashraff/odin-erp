These are the 12 final synthetic PDF specimens reviewed after the mixed Latin/Arabic punctuation correction. Every PDF contains one page; all 12 pages were rendered with Poppler 26.10.0 at 130 DPI and inspected individually. Current PDF hashes, page counts, source-row counts and byte lengths are in [manifest.json](manifest.json); the full checks, source hashes and limitations are in [the visual review](../pdf-visual-review.json).

| Specimen | English | Arabic | Verified values |
|---|---|---|---|
| Plan A agreement | [PDF](plan-a-contract-en.pdf) | [PDF](plan-a-contract-ar.pdf) | 8 rows; USD64,000 |
| Plan B agreement | [PDF](plan-b-contract-en.pdf) | [PDF](plan-b-contract-ar.pdf) | 8 rows; USD64,000 |
| Full-payment agreement | [PDF](cash-contract-en.pdf) | [PDF](cash-contract-ar.pdf) | 2 rows; USD54,000 |
| Partial student statement | [PDF](partial-student-statement-en.pdf) | [PDF](partial-student-statement-ar.pdf) | USD64,000 charged;31,600 paid;32,400 remaining;4,100 separately unapplied |
| Full-payment academy statement | [PDF](cash-academy-statement-en.pdf) | [PDF](cash-academy-statement-ar.pdf) | USD54,000 due;0 paid; January31 +3months = April30 |
| Receipt with student-borne bank deduction | [PDF](bank-fee-receipt-en.pdf) | [PDF](bank-fee-receipt-ar.pdf) | USD2,000 gross less20 fee =1,980 net/principal |

The six saved `.source.json` files preserve the exact synthetic inputs. They are not legal wording approvals, real bank confirmations or actual client signatures. Historical contract anchors in these test fixtures can precede the application-fee date; the bundle verifies rendering and preserved dates, not live chronological correctness. Signature/stamp boxes are deliberately blank.

The automated PDF suite passed3/3, including a50-row bilingual pagination test and a regression that failed before the fix when Arabic punctuation reversed Latin identifiers. The12 specimens above are all single-page; the bundle makes no separate visual claim about multi-page output. No database was read or written while regenerating this bundle.
