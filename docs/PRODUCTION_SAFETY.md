# POS101 Production Safety

Protected baseline before the 2026-10-07 UI cleanup:

- `stable-pos101-2026-10-07` -> `56ab197dd40a3f6ee9e40c43717a3785a379d7c1`
- `stable-gh-pages-2026-10-07` -> `16a101e2101e4c8a7404ecfccb9132b7083d18a6`
- Previous stable refs `stable-pos101-2026-10-03` and `stable-gh-pages-2026-10-03` are unchanged.

Every deployment must check the exact `origin/main` commit, all required `VITE_POS101_*` Firebase values, central Firebase/staff/eligibility regressions, durable sales queue and expense offline recovery, operational-day and pre-close guards, closed-day central reporting, stale-cache protection, settlement correction immutability, financial-center and comprehensive-report regressions, `npm run build`, and `git diff --check`.

The build must fail when POS101 Firebase configuration is missing. Never deploy a bundle with `configured=false`.

Financial invariants: closed-day reports use Firebase central data; open-day reports use merged-safe data; pending queues remain durable until Firebase readback; settlements remain immutable and corrections use `pos101_settlement_corrections` plus `pos101_financial_audit_log`.

Do not modify historical settlements or create production test records. Do not remove durable sales/expense synchronization or realtime subscriptions. Roll back only to the protected refs after confirming the target SHA and bundle.
