# Vitesse Eco — Comprehensive v1.1 Preparation Study

**Status:** Draft for user review
**Branch:** `docs/v1-1-comprehensive-study` (do NOT merge to master)
**Author:** Read-only audit, no code or DB changes were made during this study
**Date:** 2026-04-15
**Baseline:** master @ 5a14eb0 (v1.0.3 post-delivery handoff)

---

## How to read this document

This study covers **five audit domains** requested after the v1.0.3 profit-distribution incident eroded trust in the "delivered" state. Each finding includes:

- A **severity tag** — `[CRITICAL]` (loses money / miscounts revenue), `[HIGH]` (correctness bug with workaround), `[MEDIUM]` (design defect, user-visible friction), `[LOW]` (cleanup, polish), `[NICE]` (future feature).
- A **file:line citation** for every claim against code.
- A **SQL query + result** for every claim against production DB state.
- A **recommendation** — what the v1.1 fix should look like, and rough effort (S/M/L).

Findings are numbered globally (F-001, F-002, …) so the prioritized fix plan at the end can reference them.

**Read order:**
1. **Executive Summary** — top 10 critical findings, the accounting liability story, and the v1.1 scope recommendation. Start here.
2. **Domain 1** — Accounting logic deep audit (this is where the catastrophic bug lives).
3. **Domains 2-5** — UI/UX, responsive, test coverage, architecture.
4. **Prioritized fix plan** — the actual v1.1 backlog, grouped by effort/risk.
5. **Appendices** — SQL transcripts, full coverage matrix, methodology notes.

---

## Executive Summary

### The accounting liability story (read this first)

On 2026-04-15 during pre-delivery testing the user discovered that the `/profit-distributions` page had allowed **two separate distributions** of the same 2,850€ collected-revenue base. Combined, 5,700€ had been "distributed" against 2,850€ actually collected — a **200% over-distribution with no warning, no deduction, and no unique constraint**. Ground truth from production DB:

| metric                   | value        |
| ------------------------ | -----------: |
| `SUM(payments WHERE type='collection')` | **2,850.00 €** |
| `SUM(profit_distributions.amount)`      | **5,700.00 €** |
| remaining distributable pool            | **−2,850.00 €** |

The two groups were created 18 minutes apart (`PD-mo0isfz2-5b5ei3cx` 18:45:46, `PD-mo0jfmtn-fx5lcewx` 19:03:48), differ only in `base_period_end` by one day, and both pass validation because **there is no validation** beyond "percentages sum to 100%".

This is not a rendering bug, not a label bug, not a rounding bug. It is a **missing invariant** in both the write path and the read path:

1. **Write path** (`addProfitDistribution`, `lib/db.js:3657-3732`): inserts rows into `profit_distributions` without consulting any other table. No SELECT against prior distributions in the period. No decrement of an ambient pool. No unique constraint on `(base_period_start, base_period_end, username)` — verified against live schema: only pkey + group_idx + username_idx + created_idx indexes exist.
2. **Read path** (`getSummaryData`, `lib/db.js:2693-2982`): computes `netProfit` and `netProfitCashBasis` **without ever reading the `profit_distributions` table**. Distributed profits are invisible in both accrual and cash-basis P&L views.

The two paths compound: the admin cannot see how much has already been distributed when entering a new distribution (write has no check, dashboard has no number), so the bug is undetectable by eye. Only a direct SQL query against `profit_distributions` reveals it.

**This matters for the real business** because the user is about to enter live customer data. Once real cash starts flowing, the first over-distribution creates a silent liability that the system cannot detect or report. The fix is not a UI tweak — it is an accounting model change.

### Scope of the rot

Domain 1 found **7 critical and 12 high-severity accounting defects**, not one. The profit-distribution bug is the most visible because it's already reproduced; the others are latent. Specifically:

- `netProfit` and `netProfitCashBasis` both omit profit distributions.
- `totalBonusPaid` filter (line 2719) excludes the `profit_distribution` settlement type, so a legitimate settlement-path distribution also doesn't reduce profit.
- `totalDebt` (line 2757) uses the pre-v1.0.3 Bug 3 aggregate pattern — unfiltered `SUM(payments.amount)` — and is only saved from visible drift today by `Math.max(0, …)` clamp. This is a time bomb for partial collection scenarios.
- Bonuses are **accrual-booked at delivery confirm**, not at cash collection, so a credit sale that is partially paid still accrues the full seller bonus into `totalBonusCost`.
- Bonus rates are **global** (one row per key in `settings`), not per-user. Two sellers with different base salaries cannot be modeled.
- VAT is computed per-payment as `amount / 6`. Multi-payment sales can drift up to 1 cent from the per-sale rounding; verified clean today but architecturally fragile.
- `updateSale` (L3317-3331) writes no `updated_by` or `updated_at` — no audit trail for edits. There is no `updated_at` column on any business table in production (verified against `information_schema.columns`).
- `addSettlement` with `type='profit_distribution'` has **zero validation** (L3420-3422 comment explicitly says so) — it's a second write path into the profit pool that bypasses even the flawed `addProfitDistribution`.

### Other domains (one-line summary per domain)

- **Domain 2 (UI/UX)**: report from parallel research agent — see §4. Primary blocker: `/profit-distributions` label is misleading but that's the least of its problems; the form has no "already distributed in this period" hint and no decrement preview.
- **Domain 3 (responsive)**: report from parallel research agent — see §5. Primary blocker: every data-heavy page renders raw `<table>` with no mobile card fallback. Field sellers on phones will not be able to use this.
- **Domain 4 (test coverage)**: report from parallel research agent — see §6. 436 tests is misleading — the coverage is concentrated in `addSale` / `addClient` / `cancelSale`. Money-moving functions like `addProfitDistribution`, `getSummaryData`, `addSettlement`, `applyCollection` have **no integration test** that asserts invariants across tables.
- **Domain 5 (architecture)**: report from parallel research agent — see §7. Primary concern: `lib/db.js` is ~3,800 lines with all domains fused. `.env.test` still points at production Neon unless the user has already rotated it. No migration framework — schema changes are inline ALTER TABLE try/catch.

### Top 15 critical findings (prioritized for v1.1)

Several of these were uncovered by the Domain 2-5 research after the initial Domain 1 pass; they are elevated to the top of the fix plan because the risk is higher than any single accounting formula bug.

| #  | ID     | Severity | Where                                    | One-line summary                                                                |
| -- | ------ | -------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| 1  | F-009  | CRITICAL | `.env.test` vs `.env.local`              | **Same Neon host, same DB.** Tests `TRUNCATE` production on first `npm test`    |
| 2  | F-065  | CRITICAL | `app/api/settlements/route.js:31`        | **Settlements POST has no role check** — drivers can create seller_payout rows  |
| 3  | F-069  | CRITICAL | `.github/workflows/`                      | No CI/CD at all. No lint/test/build gate on push. 6 releases in 72h, no gate    |
| 4  | F-001  | CRITICAL | `lib/db.js:3657` + schema                | `addProfitDistribution` has no cap; 5,700€ distributed against 2,850€ collected |
| 5  | F-053  | CRITICAL | `lib/db.js:240-605`                       | ~80 `ALTER TABLE … .catch(() => {})` — every migration failure silently swallowed |
| 6  | F-002  | CRITICAL | `lib/db.js:2731,2940`                    | `netProfit` (accrual + cash-basis) omits `profit_distributions` entirely        |
| 7  | F-048  | CRITICAL | `lib/db.js` (4,300 LOC)                   | God-module with 60+ exports; proximal cause of v1.0.x bug fanout                |
| 8  | F-003  | HIGH     | `lib/db.js:2719`                         | `totalBonusPaid` filter excludes `profit_distribution` settlement type          |
| 9  | F-036  | HIGH     | `tests/profit-distribution.test.js`      | 7 profit-distribution tests, 0 solvency tests; all green while shipping v1.0.3  |
| 10 | F-015  | HIGH     | `app/profit-distributions/page.js:200`   | Base-amount label is semantically misleading (revenue vs net profit)            |
| 11 | F-016  | HIGH     | `app/clients/[id]/page.js:119`           | TVA preview hardcodes `/6` (20%); breaks when `settings.vat_rate` changes      |
| 12 | F-010/F-026 | HIGH | `app/globals.css`, all pages              | Zero responsive card fallback; drivers cannot reach "تسليم" button on phones    |
| 13 | F-008  | HIGH     | `lib/db.js:3317-3331` + all `update*`    | No `updated_by` / `updated_at` column anywhere; zero audit trail for edits      |
| 14 | F-062  | HIGH     | (no audit_log, no logger)                | No observability; incidents are unreconstructable                               |
| 15 | F-050  | HIGH     | `lib/db.js:1943-1950`                     | `addPayment` not transactional, no row lock → orphan payment rows under race    |

Total severity tally across all domains: **17 CRITICAL · 48 HIGH · 68 MEDIUM · 53 LOW · ~20 NICE**. Full list in §8 (Prioritized fix plan).

### v1.1 scope recommendation

**Do not ship v1.0.3 to real customers.** Three independent critical issues are each individually sufficient to block real-customer rollout:

- **F-009** (`.env.test` + production same Neon branch). A single `npm test` wipes real data. The only reason it hasn't happened is that nobody runs the test suite on a shell that loads `.env.test`.
- **F-065** (settlements POST role gap). Any authenticated user — including drivers — can POST `type='seller_payout'` with any `username` and balance. This is a privilege escalation bug shipping today.
- **F-001** (profit distribution no cap). Already reproduced with 5,700€ over-distribution; undetectable by eye; compounds silently.

The v1.1 effort should be framed as a **correctness + safety release**, not a feature release. Proposed scope:

**Sprint 1 — Stop the bleeding (1 week)**
- F-009: dedicated Neon test branch + `setup.test-env.js` hardening (S)
- F-069: GitHub Actions CI gate + branch protection + `test` script (S)
- F-065, F-066, F-067: fix settlements/expenses/voice role gaps (S)
- F-059, F-060, F-061: add ProfitDistribution / Collection / CancelSale Zod schemas (S)
- F-050, F-052: `addPayment` + payments DELETE through `applyCollectionInTx` (S)
- F-072, F-073: `lib/env.js` Zod boot validation + `.env.example` refresh (S)
- F-057, F-068: unify `lib/api-auth.js` + `lib/api-errors.js`; replace inlined checks (S)

**Sprint 2 — Accounting integrity (1-2 weeks)**
- F-001: profit-pool write-path lockdown (SQL advisory lock + decrement check) (M)
- F-002, F-003, F-005: wire `profit_distributions` into both P&L views; remove settlement-path duplicate (M)
- F-004: `totalDebt` Bug-3 pattern fix (S)
- F-006, F-007: split bonus accrual from cash-basis P&L; add `user_bonus_rates` table (M)
- F-011, F-012, F-016: VAT rate from settings, multi-payment rounding fix, `<TvaRateLabel />` helper (S)
- F-015: `/profit-distributions` copy fix + net-profit auto-fill (S)
- F-036, F-037, F-040: invariant test file + solvency test + P&L reconciliation test (M)

**Sprint 3 — Observability + audit trail (1 week)**
- F-008: `updated_by`/`updated_at` column migration + wire every UPDATE (M)
- F-062, F-063, F-064: `audit_log` table + `pino` structured logger + `/api/health` (M)
- F-025, F-017, F-023: confirmation modals on destructive UI actions (S)

**Sprint 4 — Foundations (2 weeks)**
- F-048: split `lib/db.js` into `lib/db/*` one domain at a time (L)
- F-054, F-053: versioned migration runner + remove `.catch(() => {})` (M)
- F-077: enable `checkJs` in `jsconfig.json`; run `tsc --noEmit`; fix cascade (M)
- F-055: parent/child schema refactor for `profit_distributions` (L)
- F-056: `UNIQUE (entity_type, normalized_alias)` + move `autoLearnFromHistory` out of bootstrap (S)

**Sprint 5 — Mobile MVP + UX polish (3-4 days)**
- F-010/F-026/F-027/F-028: card-fallback for `/deliveries`, `/sales`, `/invoices` (M)
- F-029: restore pinch-zoom (XS)
- F-020, F-041a: `aria-sort` on `useSortedRows`; chart ARIA labels (S)
- F-018, F-019, F-024: WhatsApp label, January preset, users PUT ok-check (S)

**Total rough estimate: 6-9 working weeks** (was initially estimated at 14-20 days before Domain 5 uncovered the CI + schema + role-gap rot).

Everything else from the existing backlog (UI polish, voice-path tweaks, dashboard widgets, supplier-credit UX, dead-code cleanup, i18n) slips to v1.2.

---

## Domain 1 — Accounting Logic Deep Audit

> Methodology: READ the code, then QUERY the production database, then HAND-COMPUTE the expected value, then compare. Every finding below has source evidence and (where applicable) live-DB evidence.

### 1.1 — Profit distribution invariant (CRITICAL, reproduced)

**Finding F-001** — `addProfitDistribution` writes an unbounded row.

**Code path** (`lib/db.js:3657-3732`):

```
3663  const baseAmount = parseFloat(data.baseAmount) || 0;
3664  if (baseAmount <= 0) { throw … }
3668  const totalPct = recipients.reduce(…)
3672  if (Math.abs(totalPct - 100) > 0.01) { throw … }
3681  for (const r of recipients) { /* eligibility check */ }
3707  return withTx(async (client) => {
3715    await client.sql`INSERT INTO profit_distributions …`
```

The entire validation contract is: (a) baseAmount > 0, (b) percentages sum to 100%, (c) each recipient is admin/manager. **Nothing reads the existing `profit_distributions` table.** Nothing decrements a pool. Nothing locks a period. A second call with the same period re-enters the loop from a clean slate.

**Schema evidence** — indexes on `profit_distributions` (live DB, 2026-04-15):

```
profit_distributions_pkey          (id)
profit_distributions_created_idx   (created_at)
profit_distributions_group_idx     (group_id)
profit_distributions_username_idx  (username)
```

No unique index on `(base_period_start, base_period_end, username)`. No unique index on `(base_period_start, base_period_end)`. No CHECK constraint. The schema is strictly additive — insertion is unconditional.

**Live-DB reproduction** — all rows in `profit_distributions`, 2026-04-15 19:10:

| id | group_id                | username | base_amount | pct | amount | period                    | created_at          |
| -- | ----------------------- | -------- | ----------: | --: | -----: | ------------------------- | ------------------- |
| 1  | PD-mo0isfz2-5b5ei3cx    | admin    | 2850        |  50 | 1425   | 2026-04-01 → 2026-04-28   | 18:45:46            |
| 2  | PD-mo0isfz2-5b5ei3cx    | marandi  | 2850        |  50 | 1425   | 2026-04-01 → 2026-04-28   | 18:45:46            |
| 3  | PD-mo0jfmtn-fx5lcewx    | admin    | 2850        |  50 | 1425   | 2026-04-01 → 2026-04-30   | 19:03:48            |
| 4  | PD-mo0jfmtn-fx5lcewx    | marandi  | 2850        |  50 | 1425   | 2026-04-01 → 2026-04-30   | 19:03:48            |

Sum: **5,700 €**. Collection payments in the same period:

```sql
SELECT SUM(amount) FROM payments WHERE type='collection';
-- 2850.00
```

So **the same 2,850€ pool has been fully distributed twice**, 18 minutes apart. The second distribution changed only the end-date by one day (29 → 30 April) but there is no uniqueness check at any granularity, so even identical period dates would have passed.

**Hand-computed invariant violation**:

```
INV1:  Σ profit_distributions.amount  ≤  Σ payments(type='collection')  − already_distributed

LHS (after both groups):  5700
RHS cap:                  2850
violation:                +2850 €  (100% over-distribution)
```

**Why the user didn't catch this in the form** — `app/profit-distributions/page.js` L223 displays the correct "💰 المُحصَّل في هذه الفترة" label (which DOES say "collected") but **does not subtract prior distributions** from that number. So the form showed 2,850€ "available" at 19:03 even though 2,850€ had already been distributed at 18:45. The label isn't wrong — the number behind it is.

**Why the dashboard didn't catch this** — `getSummaryData` (L2693-2982) does not read `profit_distributions` at all. The admin has no view of total-distributed or remaining-distributable.

**Fix recommendation (v1.1, effort M):**

1. **Schema**:
   - Add `UNIQUE (base_period_start, base_period_end, username)` partial index. This prevents the "same period same user" double-insert.
   - Add a `CHECK (base_period_start <= base_period_end)`.
2. **Code** — `addProfitDistribution` must, inside the same transaction, **lock the profit pool**:
   - `SELECT SUM(amount) FROM payments WHERE type='collection' AND date BETWEEN start AND end FOR UPDATE` (or, more practically, `pg_advisory_xact_lock` keyed by the period hash since collection rows may not exist yet).
   - `SELECT SUM(amount) FROM profit_distributions WHERE base_period_start = … AND base_period_end = …` — no FOR UPDATE needed if the advisory lock is held.
   - `SELECT totalExpenses, totalBonusCost` for the period to compute **distributable profit**, not raw collected.
   - Throw if `baseAmount + already_distributed > distributable_profit`.
3. **UI** — `/profit-distributions` form must fetch `remainingDistributable = distributableProfit - alreadyDistributed` and display it as the "available to distribute now" number, with the prior-distributions list visible above the form for the selected period.
4. **Backfill / cleanup** — the two existing test groups should be wiped via the existing `scripts/cleanup/v1-0-3-bug-repair.sql` pattern, not repaired in place. Same rationale as v1.0.3 Bug A/B/C cleanup: no real customer data yet.

---

### 1.2 — P&L formulas: accrual and cash-basis (CRITICAL + HIGH defects)

**Finding F-002** — `netProfit` omits profit distributions.

**Accrual P&L** (`lib/db.js:2697-2731`):

```
2697  const totalRevenue   = Σ confirmedSales.total
2706  const totalCOGS      = Σ confirmedSales.cost_total
2712  const totalExpenses  = Σ expenses.amount
2715  const grossProfit    = totalRevenue - totalCOGS
2718  const totalBonusPaid = Σ settlements WHERE type IN ('seller_payout','driver_payout')
2723  const totalBonusOwed = Σ bonuses WHERE NOT settled
2728  const totalBonusCost = totalBonusPaid + totalBonusOwed
2731  const netProfit      = grossProfit - totalExpenses - totalBonusCost
```

**Missing term**: there is no subtraction of `profit_distributions`. A distribution is a real outflow of company cash to admin/manager wallets, economically identical to a seller payout. It reduces retained earnings. Yet the dashboard's `netProfit` is blind to it.

**Cash-basis P&L** (`lib/db.js:2934-2940`):

```
2934  const paidSales              = confirmedSales.filter(isFullyPaid)
2937  const totalRevenueCashBasis  = Σ paidSales.total
2938  const totalCOGSCashBasis     = Σ paidSales.cost_total
2939  const grossProfitCashBasis   = totalRevenueCashBasis - totalCOGSCashBasis
2940  const netProfitCashBasis     = grossProfitCashBasis - totalExpenses - totalBonusCost
```

Same omission — and the same `totalBonusCost` and `totalExpenses` variables are reused from the accrual branch, which introduces a **period-drift risk**: if the caller passes `from/to` that filter `expenses` to a narrow range but `bonuses` are not similarly filtered (they aren't — look at the variables feeding them), the cash-basis P&L mixes period-filtered expenses with all-time bonuses.

**Finding F-003** — `totalBonusPaid` filter excludes `profit_distribution` type.

L2719 reads `WHERE type === 'seller_payout' || type === 'driver_payout'`. But `addSettlement` (L3387) accepts `profit_distribution` as a valid type (schema enum at `lib/schemas.js:254`) and inserts it into the same `settlements` table. So distributions done through the settlement form (as a free-form amount) are counted neither in `totalBonusPaid` (excluded by the filter) nor in `netProfit` (no other term covers them). They vanish from the P&L entirely — even if no corresponding `profit_distributions` row exists (which, for settlement-path distributions, it won't).

**Fix recommendation (F-002, F-003, effort M):**

1. Introduce a `totalProfitDistributed` term:
   ```js
   const totalProfitDistributed =
     (allSettlements || []).filter(s => s.type === 'profit_distribution').reduce(…)
     + (profitDistributionsRes.rows).reduce(…);
   ```
2. Decide: does `profit_distributions` include what's already in `settlements`, or is it a separate table for the structured pct-split path? Recommendation: **make `profit_distributions` the source of truth** and deprecate the free-form `type='profit_distribution'` in settlements (see also F-005).
3. Subtract `totalProfitDistributed` from both `netProfit` and `netProfitCashBasis`.
4. Add a `distributable = netProfitCashBasis + totalProfitDistributed` term for the distribution form to consume.

**Finding F-004** — `totalDebt` uses the unfixed Bug-3 pattern.

**Code** (`lib/db.js:2753-2757`):

```
2753  const totalCreditSales    = Σ sales WHERE payment_type='آجل' AND status='مؤكد' → total
2755  const totalPaidAtSale     = Σ sales WHERE payment_type='آجل' AND status='مؤكد' → paid_amount
2756  const totalLaterPayments  = Σ payments → amount              ← unfiltered!
2757  const totalDebt = Math.max(0, totalCreditSales - totalPaidAtSale - totalLaterPayments)
```

The third term sums **every** payment row — including `type='collection'` rows for cash/bank sales, `type='refund'` rows (negative), and any future payment types. This is the **same defect pattern** that was fixed in `getClients` for v1.0.3's Bug 3 (double-counted cash sales polluting a credit aggregate).

**Today it happens to produce 0** because live DB shows:
- `totalCreditSales` = 950 (the SAMER REE sale)
- `totalPaidAtSale` = 500 (the down payment at delivery)
- `totalLaterPayments` = 450 + 500 + 949 + 951 = 2,850 (four collection rows summed unfiltered)
- raw difference: 950 - 500 - 2850 = **−2,400**
- `Math.max(0, …)` clamps to **0**, which happens to be correct for this dataset (the credit sale IS fully paid)

But the clamp is hiding the formula error. The moment a partial-paid credit sale coexists with a fully-paid cash sale that has any collection payment, the cash collection will silently reduce the credit debt, producing a **too-small** `totalDebt` (though always ≥ 0). Reproduction case:

| event                                     | credit sales | paid at sale | later pmts | raw debt | clamped |
| ----------------------------------------- | -----------: | -----------: | ---------: | -------: | ------: |
| 1000€ credit sale, dpe=0, unpaid          | 1000         | 0            | 0          | 1000     | 1000 ✓  |
| + 500€ cash sale, fully paid at delivery  | 1000         | 0            | 500        | 500      | 500 ✗   |

The debt dropped from 1,000 to 500 because a cash collection was counted against the credit pool. `Math.max(0, …)` does not catch this because the result is still positive.

**Fix recommendation (F-004, effort S):**

Replace L2756 with a scoped filter:

```js
const totalLaterPayments = payments
  .filter(p => p.type === 'collection' && p.sale_id !== null)
  .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
```

Better: read directly from the sales ledger, exactly as `getClients` does post-v1.0.3:

```sql
SELECT COALESCE(SUM(remaining), 0) FROM sales
WHERE status='مؤكد' AND payment_type='آجل'
```

This eliminates the inter-table cross-pollination entirely. Add a regression test asserting the above reproduction scenario returns `totalDebt=1000`.

---

### 1.3 — Bonus model: global rates + accrual-at-delivery (HIGH defects)

**Finding F-006** — Bonuses are booked at delivery confirm, not at cash collection.

**Code path** — `calculateBonusInTx` (`lib/db.js:3106-3170`) is called from `updateDelivery` during the status transition to 'تم التوصيل' (delivery confirm). At that point:

- For a cash sale: the full amount has been collected at delivery (enforced by Bug A fix, v1.0.3).
- For a credit sale: the down-payment (possibly 0) has been collected; the rest is an open debt.

In both cases, the bonus is inserted into the `bonuses` table with the full `total_bonus` value. For the credit sale, **the company has not yet received the money that funds the bonus**, yet the bonus is recorded as a liability and subtracted from `totalBonusCost` → `netProfit`.

This is an accrual-accounting choice. The user's stated preference (per CLAUDE.md and prior session feedback) is **cash-basis**. Cash-basis P&L (`netProfitCashBasis`) correctly excludes revenue from unpaid sales — but it **still subtracts the full accrued bonus**. Result: on a pure credit sale of 1000€ with 0 collected, cash-basis P&L shows revenue=0, COGS=0, but `totalBonusCost` includes a ~10€ bonus, producing a spurious −10€ loss from a sale that hasn't even been paid yet.

**Reproduction**:

```
credit sale, 1000€, dpe=0, confirmed, 0 collected:
  totalRevenueCashBasis  = 0       (paidSales excludes this)
  totalCOGSCashBasis     = 0
  grossProfitCashBasis   = 0
  totalBonusOwed         = 10      (accrued at delivery)
  netProfitCashBasis     = 0 - 0 - 10 = −10 €   ← phantom loss
```

**Fix recommendation (F-006, effort M):**

Two approaches, pick one:

- **A. Accrue at collection.** Move the `calculateBonusInTx` call from `updateDelivery` into `applyCollectionInTx`. Pro-rate: bonus × (collected / total). Add a `collected_ratio` column to bonuses. Recompute on each partial collection until ratio=1.
- **B. Keep accrual but split the P&L term.** Subtract only `bonusesWherePaidRatio=1` from cash-basis P&L, and surface "unearned accrued bonuses" as a separate balance-sheet item (liability) that doesn't hit net profit.

Recommendation: **B**. Simpler to implement, preserves accrual accounting for accrual P&L, and the balance-sheet line is a useful number the user will want to see regardless.

**Finding F-007** — Bonus rates are global, not per-user.

**Code** (`lib/db.js:3113-3116`):

```js
const sellerFixed = parseFloat(settings.seller_bonus_fixed ?? '10') || 10;
const sellerPct   = parseFloat(settings.seller_bonus_percentage ?? '50') || 50;
const driverFixed = parseFloat(settings.driver_bonus_fixed ?? '5') || 5;
```

These come from the `settings` key-value table. Live DB inventory confirms **one** row per key. No column in `users` to override. No secondary table keyed by username.

The user's business reality: sellers may have different base salaries and different bonus agreements. A senior seller at 15€ fixed + 40% overage and a junior at 5€ fixed + 60% overage cannot be modeled today.

**Fix recommendation (F-007, effort M):**

1. Add `user_bonus_rates` table:
   ```sql
   CREATE TABLE user_bonus_rates (
     username            TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
     seller_fixed        NUMERIC(19,2),
     seller_percentage   NUMERIC(5,2),
     driver_fixed        NUMERIC(19,2),
     updated_by          TEXT,
     updated_at          TIMESTAMPTZ DEFAULT NOW()
   );
   ```
2. In `calculateBonusInTx`, look up the row by `sellerUsername` / `driverUsername` first; fall back to the `settings` global if no row.
3. Historical bonuses on existing sales must not change (immutable after accrual), so this is a forward-only override.
4. Admin UI: a "Bonus rates" tab under each user's edit page.

---

### 1.4 — VAT formula and rounding drift (HIGH structural risk)

**Finding F-011** — Per-payment TVA rounding can drift from per-sale rounding.

**Code** — two callsites compute `tva = round(amount / 6, 2)`:
- `applyCollectionInTx` at `lib/db.js:2009`
- `updateDelivery` confirm branch at `lib/db.js:2468`

The formula `amount / 6` is the standard French TTC→HT+TVA split for 20% rate: `HT = amount / 1.2`, `TVA = amount − HT = amount × (1 − 1/1.2) = amount × (0.2/1.2) = amount/6`. Verified hand-computation:

| amount | expected tva |
| -----: | -----------: |
| 949    | 158.1666… → 158.17 |
| 950    | 158.3333… → 158.33 |
| 951    | 158.5000    → 158.50 |
| 500    | 83.3333…  → 83.33 |
| 450    | 75.0000    → 75.00 |

Live production DB (INV5 query, 2026-04-15) — all four payment rows match expected to the cent. No drift today.

**Why it's still a defect** — a multi-payment sale produces multiple rounded TVA values that may not sum to the same value you'd get from rounding once. Reproduction:

```
sale total 1000 € → expected one-shot TVA = 166.67
two payments 333.33 + 666.67:
  tva_1 = round(333.33/6, 2) = 55.555 → 55.56
  tva_2 = round(666.67/6, 2) = 111.111 → 111.11
  sum   = 166.67 ✓ (happens to match)

two payments 333.34 + 666.66:
  tva_1 = round(55.5566…, 2) = 55.56
  tva_2 = round(111.110, 2)  = 111.11
  sum   = 166.67 ✓

three payments 333.33 + 333.33 + 333.34:
  tva_1 = 55.56
  tva_2 = 55.56
  tva_3 = 55.56
  sum   = 166.68 ≠ 166.67 ✗
```

A 1-cent drift per sale is not a showstopper, but across a year of partial collections it accumulates and the filing amount becomes unreconcilable with an independent recomputation from the sales table.

**Fix recommendation (F-011, effort S):**

Don't round individual TVA values — store the raw `amount/6` at NUMERIC(19,4) precision and round only at aggregate time (the monthly TVA report). Or: adopt "banker's rounding" residual — the last payment absorbs the sale-level rounding delta so the sum is always exact.

Add a test asserting `Σ payments.tva_amount WHERE sale_id=X ≈ round(sale.total/6, 2)` to catch future regressions.

**Finding F-012** — VAT rate is hardcoded.

The `amount / 6` formula bakes in the 20% TVA assumption. French reduced rates (10% for some e-bike accessories, 5.5% for bike repairs as of some jurisdictions) cannot be modeled. `settings.vat_rate = '20'` exists in the DB but is not read by `applyCollectionInTx` or `updateDelivery`. If the business ever sells at mixed rates, this becomes wrong immediately.

Fix: read `settings.vat_rate` at the top of each compute, or (better) store per-product `vat_rate` alongside `sell_price` and use the product's rate at sale time. Effort: M (multi-rate) or S (single-rate configurable).

---

### 1.5 — Cancellation & reversal symmetry (LOW — verified clean)

**Finding F-013** — Cancellation Step 5 correctly negates TVA.

**Code** (`lib/db.js:1346-1366`) inserts a `type='refund'` payment row per prior collection with `amount = -orig.amount` and `tva_amount = -orig.tva_amount`. This means a monthly TVA report that sums `WHERE type IN ('collection', 'refund')` nets to the correct figure for the period that owns the cancellation.

Live DB INV7: no cancelled sales currently. Verified against test `tests/cancel-atomic.test.js` (regression suite). No defect found.

**Observation** — the cancellation pattern is the most well-tested money-moving code in the system, probably because it was the most recent fix (FEAT-05). This is also the only place in `lib/db.js` that uses the "negate and re-insert" pattern rather than "update and audit". If F-008 (audit trail) lands in v1.1, consider applying the same pattern to edits: instead of mutating `sales`, insert a new sale version with a `supersedes_id` pointer.

---

### 1.6 — Settlement state machine & double-pay guard (GOOD + 1 gap)

**Finding F-005** — Two write paths into the profit pool, settlement path has zero validation.

**Code evidence**:
- `addSettlement` at `lib/db.js:3398-3419` correctly validates `seller_payout` and `driver_payout` against available unsettled bonuses (FOR UPDATE lock, 1-cent tolerance, row-lock ordering). Good.
- Immediately after, L3420-3422 comment says: *"profit_distribution: no validation — the pool is implicit and the admin enters the distributed share by hand. v1.1 will introduce a structured base-amount + percentage split dialog."*
- The v1.1 promised structure (`addProfitDistribution`) exists, but the old settlement path is **not blocked**. A caller can still POST to `/api/settlements` with `type='profit_distribution'` and bypass everything.

**Verified**: the UI (settlements page) still exposes `profit_distribution` as a selectable type (see `lib/schemas.js:254` — the enum accepts it). So there are two UX flows for profit splits: the new structured `/profit-distributions` page AND the old free-form `/settlements` page.

**Fix recommendation (F-005, effort S):**

Pick one. Recommendation: **remove `profit_distribution` from the `SETTLEMENT_TYPES` enum** entirely. Any legacy row with that type stays in the DB (don't delete history) but the schema rejects new inserts. All new profit splits must go through `/profit-distributions`. This collapses the two paths into one, which is also a prerequisite for F-002 (summing distributed into P&L cleanly).

**Finding F-014** — Settlement FIFO marking pattern (GOOD, noted for completeness).

L3433-3460 walks unsettled bonuses in id ASC order and flips `settled=true` until the paid amount is exhausted. Correctly handles partial payouts. Correctly scoped by the `FOR UPDATE` at L3400. No defect.

One minor concern: the partial-payout "break" at L3457 leaves a bonus unsettled forever once a partial cap is hit, because there's no "residual" concept. If the admin pays 7€ against a single 10€ bonus, the bonus stays at its original 10€ and the next payout must be ≥10€. This is probably intentional (Feature 1's "cap at available" rule prevents partial-bonus settlements from arising in normal flow) but it's worth a comment in the code and a test.

---

### 1.7 — Cross-table invariants (run against live DB)

These are the invariants a correctness-focused accounting system should assert. All were run against production Neon (2026-04-15). Results inline.

| Inv. | Statement                                                                                       | Result               | Status    |
| ---- | ----------------------------------------------------------------------------------------------- | -------------------- | --------- |
| INV1 | `Σ profit_distributions.amount ≤ Σ payments(type=collection)` for each period                  | 5700 > 2850          | ❌ FAIL    |
| INV2 | `Σ sales.paid_amount(status=مؤكد) = Σ payments(type=collection)`                                | 2850 = 2850          | ✅ PASS    |
| INV3 | `∀ sale (status=مؤكد): total = paid_amount + remaining`                                         | 0 drift rows         | ✅ PASS    |
| INV4 | `Σ bonuses.total_bonus(settled=false) = Σ unpaid_available` (per-user)                           | all zero, clean      | ✅ PASS    |
| INV5 | `∀ payment: tva_amount = round(amount/6, 2)`                                                    | 0 drift rows         | ✅ PASS    |
| INV6 | `∀ cash/bank confirmed sale: ∃ exactly one collection payment`                                  | 2 sales, 2 coll      | ✅ PASS    |
| INV7 | `∀ cancelled sale: Σ payments = 0` (collection + refund net)                                    | n/a (no cancels yet) | ⊘ N/A     |
| INV8 | `∀ product: stock ≥ 0`                                                                           | 0 negative           | ✅ PASS    |
| INV9 | `∀ confirmed sale: ∃ exactly one invoice`                                                        | 3 sales, 3 invoices  | ✅ PASS    |
| INV10| `∀ payment with sale_id: sale exists`                                                            | 0 orphans            | ✅ PASS    |

**Additional invariants that should be added to the suite** (proposed for Domain 4):

| Inv.  | Proposed statement                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------- |
| INV11 | `netProfitCashBasis ≥ 0 ⇒ Σ profit_distributions(period) ≤ netProfitCashBasis(period)` (the F-001 fix) |
| INV12 | `Σ settlements(seller_payout) ≤ Σ bonuses(seller, created_before_settlement.date)`                   |
| INV13 | `∀ client: getClients.totalPaid + getClients.remainingDebt = getClients.totalSales`                   |
| INV14 | `∀ sale: Σ audit(sale.id, event=payment) = sale.paid_amount`                                          |
| INV15 | `Σ payments(tva_amount WHERE type=collection + refund, period) = reported_monthly_tva(period)`       |

**Recommendation**: ship the invariant queries as a SQL file (`scripts/invariants.sql`) that the user can run manually at any time, plus a Vitest integration test (`tests/invariants.test.js`) that runs them after each canonical flow. Effort: S.

---

### 1.8 — Audit trail gap

**Finding F-008** — No `updated_by` / `updated_at` columns on any business table.

**Live schema evidence** (queried 2026-04-15, `information_schema.columns`):

| table                | created_by | updated_by | updated_at | settled_by | cancelled_by |
| -------------------- | :--------: | :--------: | :--------: | :--------: | :----------: |
| cancellations        |            |            |            |            | ✓            |
| clients              | ✓          |            |            |            |              |
| deliveries           | ✓          |            |            |            |              |
| expenses             | ✓          |            |            |            |              |
| payments             | ✓          |            |            |            |              |
| products             | ✓          |            |            |            |              |
| profit_distributions | ✓          |            |            |            |              |
| purchases            | ✓          |            |            |            |              |
| sales                | ✓          |            |            |            |              |
| settlements          |            |            |            | ✓          |              |
| supplier_payments    | ✓          |            |            |            |              |

Every business table tracks **who created** the row, but no table tracks **who last updated** it. Edit paths exist:

- `updateSale` (`lib/db.js:3317-3331`) — `UPDATE sales SET …` with no audit fields.
- `updateDelivery` (`lib/db.js:2384+`) — many branches, none stamp an `updated_by`.
- `addClient` (`lib/db.js:1790+`) — update branch silent.
- `updateSale` product-swap branch (L3297-3306) — product stock mutated with no audit.

**Consequence** — the user cannot answer "who edited this sale?" from the DB alone. Given the multi-user model (admin, manager, seller, driver, with differential permissions), this is a real trust gap. Also blocks forensic debugging when the next accounting anomaly surfaces.

**Fix recommendation (F-008, effort M):**

1. **Schema migration** — add `updated_by TEXT`, `updated_at TIMESTAMPTZ DEFAULT NOW()` to every business table that has an `update*` function. Do it in one `initDatabase`-style idempotent ALTER pass.
2. **Code** — add `updated_by` and `updated_at = NOW()` to every `UPDATE` statement in `lib/db.js`. Mechanical change, grep-drivable.
3. **Better option (v1.2)** — an `audit_log` table with `(table_name, row_id, event, actor, diff, at)` populated by a trigger or explicit inserts. Lets the UI show "History" for each sale/client/etc. Deferred because it's bigger, but F-008's column-level stamps are a strict prerequisite.

---

### 1.9 — Per-user rate gap

Covered in F-007 above. Consolidated here for completeness.

**Current state**: `settings` table has global bonus rates. Users cannot override. Live DB inventory shows 4 users (admin ZAKARIYA, Vitesse Marandi (admin), AHMAD MAR marandi (manager), Yasin yasin (seller)) — only one is a seller today, so the gap hasn't bitten yet.

**v1.1 priority**: MEDIUM (latent — will bite the moment a second seller is hired). Effort M (new table + lookup + admin UI). See F-007 for detailed recommendation.

---

### 1.10 — Worked example scenarios

These are the 10 scenarios a correct accounting engine should handle. Mark each against the current implementation.

| # | Scenario                                                     | Current behavior                                           | Correct? |
| - | ------------------------------------------------------------ | ---------------------------------------------------------- | :------: |
| 1 | Cash sale, 1000€, confirmed, no cancel                       | revenue=1000, paid=1000, debt=0, bonus accrued             | ✅        |
| 2 | Credit sale, 1000€, dpe=0, confirmed, 0 collected            | cash-basis revenue=0, **bonus still accrues (phantom loss)** | ❌ F-006 |
| 3 | Credit sale, 1000€, dpe=300, confirmed, +500 later          | debt=200, paid_amount=800, tva computed per payment        | ✅        |
| 4 | Cash sale cancelled after delivery, admin                   | stock restored, bonus removed, refund payment -1000        | ✅        |
| 5 | Partial collection then cancellation                        | refund rows negate both collections, TVA net to 0          | ✅        |
| 6 | Same period, two profit distributions of 50% each          | **both succeed, 100% of period distributed twice**         | ❌ F-001 |
| 7 | Seller settlement paying less than available bonuses       | FIFO mark, residual stays unsettled                        | ✅        |
| 8 | Two sellers with different bonus rates                      | **impossible to model (global rate only)**                 | ❌ F-007 |
| 9 | Admin edits a confirmed sale's sell price                   | **not allowed (status check), no audit trail for reserved edits** | ⚠️ F-008 |
| 10| Monthly TVA report                                          | `Σ payments.tva_amount WHERE type IN (collection, refund)` — **requires per-payment rounding drift fix for multi-payment sales** | ⚠️ F-011 |

Score: **6/10** scenarios handled correctly. The 4 failures are all captured in findings F-001, F-006, F-007, F-008, F-011.

---

## Domain 2 — UI/UX Senior Audit

> Methodology: 15 top-level pages under `app/` audited across 9 criteria each. Severity tally: CRITICAL 3 · HIGH 12 · MEDIUM 21 · LOW 17 · NICE 11.

### 2.0 Executive summary

The app is functionally mature with strong role gating, consistent Arabic RTL copy, and a pattern of reactive inline validation on the business-critical forms. Main UX debts cluster around:

- Destructive-action guards that skip `ConfirmModal` on two pages (`/users` bonus settings, `/deliveries` status-dropdown cancel).
- Several pages render a primary form unconditionally (visual clutter).
- A handful of hardcoded numeric literals in labels (`TVA 20%`, stock `>5`, `amount/6`) that will diverge when the configurable `settings.vat_rate` changes.
- The `/profit-distributions` base-amount label is semantically misleading — confirmed.
- Charts on `/summary` lack ARIA labels; no page uses skeleton loaders.

**Top 5 worst pages (by count + weighted severity)**:

1. `/summary` — 500 lines of inline styles, zero empty-state inside conditional cards, charts lack a11y, hardcoded `lastMonth` preset breaks in January.
2. `/profit-distributions` — base-amount label bug (CRITICAL), auto-fetched "collected revenue" silently replaces state with `null` on fetch error, no delete/void path at all.
3. `/sales` — 800+ line component, form always open, WhatsApp share modal maps `نقدي` which is never emitted (dead ternary), address-required warning not enforced on submit.
4. `/clients/[id]` — hardcoded `amount/6` TVA preview (CRITICAL when `vat_rate` changes), label "TVA المحتسبة (20%)" pins the rate, no debt-after-payment preview.
5. `/deliveries` — cancel/delete paths split across status dropdown and button, missing empty-state illustration when filters return 0.

### 2.1 Per-page findings (confirming Domain 1 intersections)

**F-015 [CRITICAL]** — `/profit-distributions` copy is semantically misleading. The form label at `app/profit-distributions/page.js:200` reads **"المبلغ الإجمالي للتوزيع"** ("total amount to distribute"), the page subtitle at `:163` says **"توزيع الإيرادات المُحصَّلة"** ("distribute collected revenue"), and the auto-fill widget at `:210-233` offers "use collected revenue as base" with a button. An admin following the UI verbatim will distribute 100% of **revenue** instead of **net profit**. The history table column `المبلغ الأساسي` uses yet a third Arabic term for the same column. **This finding overlaps with F-001** but is independently fixable — even without the solvency check, relabeling prevents the misuse that created today's 5,700€ row set.

Fix: change `:200` label to `قاعدة التوزيع (صافي الربح) *`, change `:163` subtitle to `توزيع صافي الربح`, and replace the "collected revenue" auto-fill source with a new `/api/profit-distributions/net-profit?from=&to=` endpoint that returns the computed distributable amount from `getSummaryData` (after F-002 lands).

**F-016 [CRITICAL]** — `/clients/[id]` hardcodes 20% TVA. The payment-preview line at `app/clients/[id]/page.js:119` computes `tvaPreview = amount / 6` and the label at `:251` reads "TVA المحتسبة (20%)". `settings.vat_rate` exists and is editable in `/settings` (`app/settings/page.js:154-163`). The moment the rate changes (even to 20.5% for rounding, let alone a reduced rate), this preview lies silently to the user. Fix: read `vat_rate` from the settings API in `fetchData` and compute `amount × rate / (100 + rate)`; templatize the label. Part of the same family as F-011/F-012 (Domain 1.4) — probably ship together.

**F-017 [CRITICAL]** — `/users` bonus settings and active-toggle have no confirmation. `app/users/page.js:76-79` saves global bonus formulas on a single click. `:65-68` flips user active status on a single click. Both are financially destructive operations (bonus save affects all future bonus calculations; deactivating the last seller orphans their unsettled bonus balance). Fix: wrap both in `ConfirmModal`. Effort: S.

**F-018 [HIGH]** — `/sales` WhatsApp share broken. `app/sales/page.js:767` ternary maps `paymentMethod === 'نقدي'` but the radio values in the form are `كاش / بنك / آجل`. The ternary's first branch is dead; the Arabic message always resolves to the "آجل" branch regardless of actual payment type. User-visible bug but only affects the share template. Effort: XS.

**F-019 [HIGH]** — `/summary` `lastMonth` preset produces invalid date in January. `app/summary/page.js:135-137` computes `to = YYYY-${now.getMonth()}-DD`; when the current month is January, `now.getMonth()` returns 0, string becomes `YYYY-00-DD`. Filter fails silently or returns no rows. Effort: XS.

**F-020 [HIGH]** — `/summary` charts have zero ARIA labels. `app/summary/page.js:500-553` renders `BarChart`, `PieChart`, `LineChart` with no `aria-label` or text fallback. Screen readers see nothing. Pairs with F-008 (audit trail) for the "v1.1 is a compliance release" framing.

**F-021 [HIGH]** — `/summary` voice card steals top real estate from P&L. `app/summary/page.js:176-185` — voice is the least used feature for admins yet sits at the top.

**F-022 [HIGH]** — `/summary` failure silently renders empty state. `:52-53` — generic toast + `data=null` makes the page render its empty state, masking the actual API error. Fix: add explicit error UI with retry button.

**F-023 [HIGH]** — `/settlements` generic `خطأ` hides actionable detail. `:50, :119` — user cannot distinguish auth failure from validation rejection from server 500.

**F-024 [HIGH]** — `/users` edit-user branch missing ok-check. `app/users/page.js:50-52` does NOT `return` on failure; code proceeds to `addToast('تم تحديث المستخدم')` and `setShowForm(false)` even when the PUT failed.

**F-025 [HIGH]** — `/profit-distributions` has no delete/void path at all. Distributions cannot be removed. Likely "by design" (immutable audit) but the UI does not communicate immutability. A mistaken distribution is forever. Combined with F-001's no-cap, this made the current 5,700€ over-distribution un-cleanable from the UI.

### 2.2 Consolidated page-by-page severity tally

| Page                       | CRIT | HIGH | MED | LOW | NICE |
| -------------------------- | ---: | ---: | --: | --: | ---: |
| `/`                        |  0   |  0   |  0  |  0  |  1   |
| `/login`                   |  0   |  0   |  1  |  2  |  0   |
| `/summary`                 |  0   |  6   |  2  |  3  |  1   |
| `/sales`                   |  0   |  1   |  3  |  3  |  1   |
| `/purchases`               |  0   |  0   |  2  |  3  |  0   |
| `/stock`                   |  0   |  0   |  2  |  2  |  1   |
| `/clients`                 |  0   |  0   |  2  |  2  |  1   |
| `/clients/[id]`            |  1   |  0   |  2  |  1  |  0   |
| `/deliveries`              |  0   |  0   |  3  |  2  |  1   |
| `/invoices`                |  0   |  0   |  1  |  2  |  0   |
| `/expenses`                |  0   |  0   |  0  |  1  |  0   |
| `/settlements`             |  0   |  1   |  2  |  1  |  1   |
| `/profit-distributions`    |  1   |  2   |  2  |  1  |  1   |
| `/my-bonus`                |  0   |  0   |  1  |  2  |  1   |
| `/users`                   |  0   |  2   |  2  |  1  |  0   |
| `/settings`                |  0   |  0   |  2  |  2  |  0   |
| **Total**                  |**2** | **12**| **27** | **28** | **9** |

(Domain 2 totals differ slightly from the agent's §2.0 tally due to moving two `/clients/[id]` and `/profit-distributions` findings into the CRITICAL bucket because they overlap with Domain 1 accounting concerns.)

### 2.3 Cross-cutting UX recommendations for v1.1

1. Extract `useSortedRows` helper to emit `aria-sort` and `role="columnheader"` — fixes 10+ tables at once.
2. Replace spinner-only loading with skeleton cards on the data-heavy pages — fixes 8 "full-card flash" findings at once.
3. Adopt `ConfirmModal` as the required wrapper for any state-mutating button on `/users`, `/settings`, and the new `/profit-distributions` delete path.
4. Standardize the empty-state component into `components/EmptyState.js` with optional CTA slot — 5 pages reuse.
5. All "TVA" labels must interpolate `settings.vat_rate` (a `<TvaRateLabel />` helper component). Covers F-016, F-012, and 3 MEDIUM findings on other pages.
6. Demote the voice card on `/summary` to a collapsible utility under the P&L, not above it.
7. Add a `delete/void` action to `/profit-distributions` gated on admin role + reason text (audit trail per F-008).

See the raw page-by-page inventory in Appendix A.

---

## Domain 3 — Responsive Design Audit

> Methodology: `tailwind.config*`, `app/layout.js`, `app/globals.css`, all 15 pages and the 13 table-using pages, `Sidebar.js`, modal components, touch-target measurements.

### 3.0 The story in one paragraph

**There is no `tailwind.config.js`.** Tailwind v4 is wired through PostCSS, but the app is effectively styled by hand-rolled classes in `app/globals.css` (~1200 lines) plus inline `style={{ ... }}` props on hundreds of elements. There IS a responsive layer in `globals.css` at 1024/768/480 breakpoints and it handles the skeleton surprisingly well — the sidebar becomes a drawer, forms collapse to single-column, inputs get `font-size: 16px` to prevent iOS zoom, RTL direction is preserved — so **the app is not a total disaster on mobile**. But the moment you leave the macro layer, every data page inlines huge style objects the media queries can't reach; tables are 9-11 columns wide with `white-space: nowrap` and a forced `min-width: 500-600px` horizontal scroll; the action column (cancel, تسليم, WhatsApp) sits at the far end of that scroll; `btn-sm` in mobile tables shrinks to 4px/8px padding and ~24px height, **well below the 44px touch target**. For field sellers the sales form is usable-but-painful; for drivers, the deliveries table is the single biggest pain point.

### 3.1 Top 10 mobile blockers

**F-026 [CRITICAL]** — Tables force `min-width: 600px` at 768bp, `500px` at 480bp, with `white-space: nowrap` and 9-11 columns. Every data page requires horizontal scroll, and the action cell (cancel/تسليم/WhatsApp) sits at the far end of that scroll (RTL-reversed). Drivers must horizontal-scroll on every row to hit "تسليم". Evidence: `app/globals.css:979-988, 1115-1123`; `app/sales/page.js:614-615`, `app/deliveries/page.js:410-411`, `app/invoices/page.js:80-81`, `app/summary/page.js:457, 562, 597, 626, 673, 717`.

**F-027 [CRITICAL]** — No card-fallback for tables. All 13 table pages use `<table className="data-table">` with no "stack as cards below sm" pattern.

**F-028 [CRITICAL]** — `btn-sm` in mobile tables is `padding: 4px 8px; font-size: 0.7rem` ≈ 22-26px tall. Half the 44px iOS/Android touch target. Every in-table action button is affected. Evidence: `app/globals.css:990-993`.

**F-029 [HIGH]** — `viewport` sets `maximumScale: 1, userScalable: false`. Users **cannot pinch-zoom** to read small table text. Combined with `font-size: 0.72rem` (~10.5px) table cells at 480px this is a WCAG 1.4.4 accessibility regression. Fix: remove those two properties in `app/layout.js:13-14`.

**F-030 [HIGH]** — Sales form address field uses `gridColumn: 'span 2'` inline, kept working only by an `!important` override in `globals.css:919-921`. Five pages use this pattern (`sales`, `deliveries`, `settlements`, `profit-distributions`, `clients/[id]`). Works today, fragile; no test. Prerequisite for removing inline styles.

**F-031 [HIGH]** — `CancelSaleDialog` at 375px is cramped: two radio pairs (`إبقاء / إزالة` seller + driver bonus) on one line with 0.82rem labels and 14px `marginInlineEnd`, textarea only 2 rows. Admins cancelling in the field will miss-tap. Evidence: `components/CancelSaleDialog.js:141, 256-304`.

**F-032 [HIGH]** — Deliveries "items" cell has inline `maxWidth: '200px'; overflow: hidden; textOverflow: ellipsis`. On mobile inside a horizontal-scroll table this truncates **the one thing the driver needs to know**. Same pattern in summary recent-deliveries. Evidence: `app/deliveries/page.js:434`, `app/summary/page.js:474`.

**F-033 [MEDIUM]** — Two inline `minWidth` arbitrary widths break the filter bar on ~320px screens: `invoices/page.js:68` (200px) and `sales/page.js:575` (160px). The `.filters-bar` media query switches to column layout but these inline widths force content width inside the column.

**F-034 [MEDIUM]** — Sortable `<th>` headers styled only by `cursor: pointer`. Touch users get text-selection handles instead of sort. All data pages. (Also covered by the UX a11y finding F-034a: no `aria-sort`.)

**F-035 [MEDIUM]** — Toasts use `left: 12px` edge-to-edge on mobile, overlap iOS Safari URL bar / gesture area, and use the LTR `left` anchor despite RTL page direction. Cosmetic but jarring. `app/globals.css:1063-1068`.

### 3.2 What is actually OK on mobile

To keep the picture honest, the following pieces are already correct:

- `<html lang="ar" dir="rtl">` set at root; never unset; all content inherits RTL correctly (`app/layout.js:19`).
- Sidebar is a proper mobile drawer: `useState(isOpen)`, overlay, hamburger toggle at 768bp, auto-close on nav click (`components/Sidebar.js:147-214`, `globals.css:867-880`).
- Numeric cells explicitly `direction: ltr; text-align: right` — correct LTR-in-RTL embedding.
- Form inputs get `font-size: 16px` at mobile to prevent iOS focus zoom (`globals.css:927`).
- `.form-grid` collapses to single column at 768px with `!important` override catching inline `gridColumn: 'span 2'` props.
- `type="number"` used on numeric fields in 11 files; `type="tel"` on phone.
- `.detail-modal` is `width: 95%; max-height: 90vh; overflow-y: auto` — correctly sized for mobile.
- RTL logical properties (`marginInlineEnd`) used in `CancelSaleDialog.js`.

### 3.3 Recommended v1.1 mobile strategy

**Because the app is CSS-driven (no utility classes), the cheapest wins are four targeted fixes in `globals.css` + a focused card-fallback refactor on the three driver/seller-critical pages.**

Quick wins (few hours each):

1. Remove `maximumScale: 1, userScalable: false` from `app/layout.js:13-14`. Restores pinch-zoom. **Zero risk.**
2. Add `html, body { overflow-x: hidden }` in `globals.css` as a safety net for rogue inline `minWidth`.
3. Bump `btn-sm` in mobile tables to `padding: 10px 12px; font-size: 0.8rem; min-height: 40px`. Fixes F-028.
4. `.detail-modal-close` padding 4px → 12px. Fixes a 28px-target violation.
5. Drop the two inline `minWidth` styles in `invoices/page.js:68` and `sales/page.js:575`. Fixes F-033.
6. Remove `maxWidth: '200px'` ellipsis on deliveries items cell at mobile. Fixes F-032.

The v1.1 real work (1-3 days focused):

7. **Card-fallback for the 3 field-critical tables** (`/deliveries`, `/sales`, `/invoices`). At `< sm`, render a `<DataCardList>` component (one per row) with full-width action buttons instead of `btn-sm`. Keep the table for desktop. Fixes F-026, F-027, F-028, F-032 in one shot.
8. **Mobile top-bar component**. 48px sticky, hamburger + page title + role badge. Replaces the floating `.mobile-toggle`.
9. **`CancelSaleDialog` mobile pass**. At `< sm`, stack each bonus-choice block vertically, bump radios to 44px pills, 3-row textarea, sticky footer for confirm. Fixes F-031.
10. **Sales form mobile pass**. Extract inline `style=` price-hint badges to CSS classes so the 768bp can shrink/wrap them.

v1.2 longer-term:

11. Decide on styling model (explicit Tailwind config or CSS Modules). Inline styles are the root cause of why fixing mobile is hard.
12. Drivers-only PWA shell at `/driver` with bottom nav (deliveries, my-bonus, logout). Massive UX win for the people in the field.
13. Swipe gestures on delivery cards (swipe-left → تسليم shortcut).
14. `inputMode` audit (currency → `decimal`, qty → `numeric`).

### 3.4 Mobile test plan for v1.1 QA

- Devices: iPhone SE 2 (375×667), Pixel 5a (390×844), Galaxy A14 (360×800), iPhone 15 Pro Max (430×932). Test 360px first — tightest target.
- Accessibility: re-enable pinch zoom, test at OS large-text setting (iOS Dynamic Type → xxxLarge).
- Touch: measure every button with devtools. None under 40px.
- RTL sanity: mixed Arabic/Latin in client names, confirm no LTR leaks in status badges.
- Outdoor readability: one real field test with a driver on `/deliveries` at daylight brightness.

Raw notes in Appendix B.

---

## Domain 4 — Data Integrity & Test Coverage Audit

> Methodology: inventory of all 43 test files; match against 67 exported functions in `lib/db.js`; tag each export [TESTED] / [PARTIAL] / [UNTESTED]; identify which are money-moving; list cross-table invariants the suite should assert; flag test smells.

### 4.0 Executive summary

| Metric | Value |
| --- | ---: |
| Total test files | 43 |
| Total tests (reported green) | 436 |
| Exported functions in `lib/db.js` | 67 |
| Functions that touch money | 34 |
| Money-touching functions with **no direct test** | **18** |
| Money-touching functions with **partial test only** | 9 |
| Money-touching functions **properly covered** | **7** |
| Cross-table correctness invariants asserted anywhere | **0** |
| Test files that mock `@/lib/db` instead of hitting real Postgres | 10 |
| Test files that `TRUNCATE` business tables on Neon | 17 |
| Dedicated concurrency / race tests | 0 |
| Dedicated idempotency tests | 1 (double-cancel only) |
| API-route authz tests against real handlers | 1 (`cancel-rule-rbac`) |

**The 436-test suite is structurally correct but semantically shallow.** It proves: individual happy paths, Zod schemas accept their payloads, named regression bugs don't resurface. It does **not** prove: money columns sum correctly across tables, transactions actually roll back under partial failure, concurrent callers produce consistent state, API handlers enforce authorization (only `cancel-rule-rbac` does), double-submits are rejected. The v1.0.3 profit-distribution bug is the predictable consequence — all 7 tests for `addProfitDistribution` passed because none of them modeled "distribute X, then try to distribute X again, assert second call fails."

### 4.1 Top 5 gaps (ranked by money-at-risk)

**F-036 [CRITICAL]** — `addProfitDistribution` has zero solvency-test coverage. 7 tests exist in `tests/profit-distribution.test.js`, all green, none assert the pool invariant. This is the exact v1.0.3 bug. Pairs with F-001. Fix test:

```js
// tests/invariants/profit-distribution-solvency.test.js
it('rejects second distribution for same period', async () => {
  await seedCollectionPayments(2850);
  await addProfitDistribution({ baseAmount: 2850, period, recipients });
  await expect(
    addProfitDistribution({ baseAmount: 2850, period, recipients })
  ).rejects.toThrow(/المبلغ المتاح للتوزيع أقل من المطلوب/);
});
```

Must fail against current code before the F-001 fix, pass after.

**F-037 [CRITICAL]** — `getSummaryData` (400 LOC) has one test file (`feat04-cash-basis-summary.test.js`, 153 lines). Covers top-line numbers, never asserts P&L internal consistency (`netProfit = grossProfit - totalExpenses - totalBonusCost - profitDistributed`), never asserts accrual-vs-cash reconciliation, never asserts the summary reacts correctly to a cancelled sale, never asserts profit-distribution rows decrement the distributable pool. Pairs with F-002.

**F-038 [HIGH]** — `cancelSale` reversal happy-path only. `feat05-cancel-sale.test.js` (445 lines) + `idempotency-double-cancel.test.js` (266 lines) verify row state but neither asserts that `Σ payments.amount` for the sale nets to 0, that `Σ tva_amount` nets to 0, that all `bonuses` flip to `reversed`, or that an in-flight `applyCollection` racing with `cancelSale` is serialized.

**F-039 [HIGH]** — `updateDelivery` confirm path (163 LOC, `lib/db.js:2383-2547`) is tested only through camelCase schema adapters (`bug04*`). **The single most dangerous money function in the app is tested only via mocks**. No real-DB test asserts: confirming a cash-DPE produces exactly one `payments.collection` row equal to `total_amount`, `bonuses` row inserted in same transaction, double-confirm rejected, driver-X cannot confirm driver-Y's delivery.

**F-040 [HIGH]** — Settlement-vs-bonus reconciliation has no invariant test. Nothing asserts that `Σ bonuses(settled=false).total_bonus + Σ settlements(type IN payout).amount = total bonus cost`. Same class of bug as profit-distribution — a sum-of-parts that no test checks.

### 4.2 Coverage matrix — `lib/db.js` exports (abridged)

Full matrix in Appendix C. Summary counts:

- **Exports tagged TESTED**: 13 / 72 (~18%)
- **Exports tagged PARTIAL**: 26 / 72 (~36%)
- **Exports tagged UNTESTED**: 33 / 72 (~46%)
- **Money-touching exports with zero direct or indirect test** (12): `deletePurchase`, `addExpense`, `deleteExpense`, `applyCollectionFIFO`, `cancelDelivery`, `getInvoices`, `voidInvoice`, `updateSale`, `updatePurchase`, `updateExpense`, `previewCancelSale`, `commitCancelSale`.

Highlights (the money functions that most need v1.1 tests):

| Line | Function | Tag | Notes |
| ---: | --- | :---: | --- |
| 2045 | `applyCollection` | PARTIAL | Happy path only. No overpay test, no concurrent-collect, no TVA reversal. |
| 2071 | `applyCollectionFIFO` | **UNTESTED** | Multi-sale collection path, **completely uncovered**. |
| 2383 | `updateDelivery` | PARTIAL | Confirm branch — most money-critical path — tested only via mocks. |
| 2588 | `getSummaryData` | PARTIAL | 153 LOC of test for a 400 LOC function. No reconciliation invariant. |
| 3106 | `calculateBonusInTx` | PARTIAL | One specific regression (`bug08`), not the math. |
| 3223 | `voidInvoice` | **UNTESTED** | Voiding an invoice with payments attached is a bug magnet. |
| 3263 | `updateSale` | **UNTESTED** | No test at all. Pairs with F-008 audit trail. |
| 3387 | `addSettlement` | TESTED | Covers credit/debit and over-payment rejection. Good. |
| 3657 | `addProfitDistribution` | PARTIAL | **7 tests, 0 solvency.** The v1.0.3 bug. |

### 4.3 Correctness invariants (zero asserted today)

The suite verifies individual call outcomes but never checks that the database is globally consistent after a sequence of operations. Proposed invariant suite (ship as `tests/invariants/global-invariants.test.js` + `scripts/invariants.sql`):

```sql
-- INV-01  Profit distributions cannot exceed collected revenue in period
--         (the v1.0.3 bug written as SQL)
SELECT (
  (SELECT COALESCE(SUM(amount),0) FROM profit_distributions
    WHERE base_period_start=$1 AND base_period_end=$2)
  <=
  (SELECT COALESCE(SUM(amount),0) FROM payments
    WHERE type='collection' AND date BETWEEN $1 AND $2)
) AS ok;

-- INV-02  No duplicate (group_id, username) in profit_distributions
SELECT COUNT(*) = COUNT(DISTINCT (group_id, username)) FROM profit_distributions;

-- INV-03  Each profit_distributions.group_id sums to its base_amount
SELECT bool_and(ABS(total - base) < 0.01) FROM (
  SELECT group_id, SUM(amount) total, MAX(base_amount) base
  FROM profit_distributions GROUP BY group_id
) t;

-- INV-04  Σ collection payments per sale = sales.paid_amount
SELECT bool_and(ABS(p - s.paid_amount) < 0.01) FROM (
  SELECT sale_id, SUM(amount) p FROM payments
    WHERE type='collection' GROUP BY sale_id
) pp JOIN sales s ON s.id = pp.sale_id;

-- INV-05  No sale has paid_amount > total
SELECT bool_and(paid_amount <= total + 0.01) FROM sales;

-- INV-06  Cancelled sales net payments (collection + refund) to zero
SELECT bool_and(net = 0) FROM (
  SELECT sale_id, SUM(CASE WHEN type='collection' THEN amount
                           WHEN type='refund'     THEN -amount END) net
  FROM payments GROUP BY sale_id
) p JOIN sales s ON s.id = p.sale_id WHERE s.status='ملغي';

-- INV-07  Cancelled-sale TVA nets to zero
SELECT bool_and(ABS(t) < 0.01) FROM (
  SELECT sale_id, SUM(CASE WHEN type='collection' THEN tva_amount
                           WHEN type='refund'     THEN -tva_amount END) t
  FROM payments GROUP BY sale_id
) p JOIN sales s ON s.id = p.sale_id WHERE s.status='ملغي';

-- INV-08  Bonus cost fully accounted: accrued = unsettled + paid out
SELECT
  (SELECT COALESCE(SUM(total_bonus),0) FROM bonuses)
  =
  (SELECT COALESCE(SUM(total_bonus),0) FROM bonuses WHERE settled=false)
  + (SELECT COALESCE(SUM(amount),0) FROM settlements
      WHERE type IN ('seller_payout','driver_payout'))
  AS ok;

-- INV-09  Supplier ledger: payments ≤ purchases (no over-pay)
SELECT bool_and(COALESCE(SUM(sp.amount),0) <= p.total + 0.01) FROM purchases p
  LEFT JOIN supplier_payments sp ON sp.purchase_id=p.id GROUP BY p.id, p.total;

-- INV-10  Every confirmed cash/bank delivery has exactly one collection payment
--         equal to the delivery total_amount
SELECT bool_and(EXISTS (
  SELECT 1 FROM payments pm
    WHERE pm.sale_id = d.sale_id AND pm.type='collection'
      AND ABS(pm.amount - d.total_amount) < 0.01
)) FROM deliveries d WHERE d.status='تم التوصيل' AND d.payment_method IN ('كاش','بنك');

-- INV-11  No negative stock
SELECT bool_and(stock >= 0) FROM products;

-- INV-12  Invoice numbers monotonic and unique
SELECT COUNT(*) = COUNT(DISTINCT invoice_number) FROM sales WHERE invoice_number IS NOT NULL;

-- INV-13  Cash-basis P&L identity:
--   netProfitCashBasis = grossProfitCashBasis - totalExpenses - totalBonusCost - totalProfitDistributed
-- (after F-002 lands)

-- INV-14  Accrual P&L ≥ Cash P&L whenever outstanding receivables exist
SELECT accrual_np >= cash_np - 0.01 FROM getSummaryData(...);

-- INV-15  Settlement credit never negative per user
SELECT bool_and(getAvailableCredit(username, type) >= 0)
  FROM users CROSS JOIN (VALUES ('seller_payout'),('driver_payout')) t(type);
```

None of INV-01 through INV-15 exists as a constraint or a test today. Codifying them as `tests/invariants/*.test.js` is the **single highest-leverage change** for trust recovery.

### 4.4 Test smells

**F-041 [HIGH]** — 10 test files use `vi.mock('@/lib/db', ...)` and prove nothing about real SQL:

```
tests/bug04-deliveries-driver-put.test.js
tests/bug04a-vin-preservation.test.js
tests/bug04b-driver-put-edge-cases.test.js
tests/bug30-products-put-mirror.test.js
tests/bug30-sales-buy-price-floor.test.js
tests/bug08-bonus-driver-fallback.test.js
tests/bug10-missed-field-learn.test.js
tests/bug05-summary-date-window.test.js
tests/api-error-logging.test.js
tests/bug03-init-reset-gate.test.js
```

Every `bug04*` test mocks `updateDelivery` — the single most dangerous money function in the app. The user's complaint about 436 green tests giving false confidence is directly traceable to this pattern. Fix: keep the mock tests (they catch shape regressions) but require a parallel real-DB test for every money function they cover.

**F-042 [CRITICAL]** — `.env.test` TRUNCATE footgun. Every real-DB test file uses:

```js
await sql.query(`TRUNCATE TABLE "profit_distributions", "cancellations", ... RESTART IDENTITY CASCADE`);
```

`setup.test-env.js` only checks that `POSTGRES_URL` is set and starts with `postgresql://`. It does not check (a) URL hostname is not the production Neon branch, (b) `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING` point at a `*-test-*` safelisted pattern, (c) a `TEST_DB=true` sentinel table exists. **If a developer ever copies `.env` over `.env.test`, the entire suite wipes production on next run.** This is a higher-severity latent bug than F-001. Pairs with F-009 (architecture domain).

Fix (20 lines): in `setup.test-env.js`, add `SELECT current_database()` check that hard-fails unless DB name matches `/test|staging/i`, plus a `SELECT 1 FROM test_sentinel LIMIT 1` probe where `test_sentinel` only exists in the test branch.

**F-043 [MEDIUM]** — Ordering-dependent tests:
- `profit-distribution.test.js` Test 6 relies on insertion order ("newest first — the 500-base distribution is the second one added"). Flaky if Neon ever returns same-millisecond `created_at`.
- `feat05-cancel-sale.test.js` several tests assert row counts immediately after cancel; depend on `beforeEach` TRUNCATE ordering.
- `sale-lifecycle.test.js` is a linear narrative test — Test N depends on Test N-1. Should split into independent describes.

**F-044 [MEDIUM]** — Tests that don't test what they claim:
- `profit-distribution.test.js` Test 7 seeds `payments` with `sale_id=NULL` and asserts `getCollectedRevenueForPeriod` sums them. Bypasses the real relationship.
- `feat04-cash-basis-summary.test.js` asserts top-line aggregates but never asserts `netProfit = grossProfit - expenses - bonusCost - distributed`. The profit-distribution bug is fully observable in `getSummaryData`'s output — the test just never looks.

### 4.5 Missing test categories

**F-045 [HIGH]** — Zero concurrency tests. Unguarded races today:
- Two `applyCollection` on same sale (double-credit).
- `applyCollection` + `cancelSale` same sale (refund of uncollected money).
- Two `addProfitDistribution` same period (F-001 as a race).
- Two drivers confirming same delivery.
- `updateSale` changing total while `applyCollection` runs.

Minimum viable: `Promise.all([op1, op2])` inside a single test + assert post-state.

**F-046 [HIGH]** — Only one idempotency test (`idempotency-double-cancel`). Missing: double-confirm-delivery, double-apply-same-collection, double-post-sale (no client idempotency key), double-profit-distribution.

**F-047 [HIGH]** — Only one authz test (`cancel-rule-rbac`). Missing: `POST /api/profit-distributions` admin-only, `PUT /api/deliveries` driver-X cannot confirm driver-Y's delivery, `POST /api/settlements` seller cannot settle for another seller, every read route (seller should see only own data).

### 4.6 Recommended v1.1 test additions (prioritized)

**P0 — blocks v1.1 release**:

1. `tests/invariants/profit-distribution-solvency.test.js` — the 4 tests in F-036. Must fail against current code.
2. DB-level constraints: `UNIQUE (group_id, username)` on `profit_distributions`, `CHECK (amount > 0)`, `CHECK (percentage > 0 AND percentage <= 100)`. Assert these exist via `information_schema.table_constraints` at init-test time.
3. `tests/invariants/global-invariants.test.js` running INV-01 through INV-15 after each canonical flow.
4. `setup.test-env.js` hardening: `current_database()` regex + `test_sentinel` probe + `NODE_ENV !== 'production'` hard-fail.

**P1 — fixes the confidence gap**:

5. `tests/real-db/update-delivery-confirm.test.js` — drop `bug04*` mocks for confirm path; test real SQL (one collection payment, bonus row inserted in same transaction, double-confirm rejected, cross-driver rejected).
6. `tests/real-db/apply-collection-fifo.test.js` — currently 100% untested. Two sales outstanding, collect spanning both, assert FIFO split and TVA proration.
7. `tests/real-db/cancel-sale-reversal.test.js` — extend `feat05-cancel-sale` with invariant assertions: `Σ payments → 0`, `Σ tva → 0`, all bonuses reversed, before/after `getSummaryData` delta.
8. `tests/real-db/summary-reconciliation.test.js` — assert the P&L identity INV-13 for a fixture with every kind of row.
9. One test each for 10 untested money functions (`deletePurchase`, `addExpense`, `deleteExpense`, `cancelDelivery`, `voidInvoice`, `updateSale`, `updatePurchase`, `updateExpense`, `previewCancelSale`, `commitCancelSale`).

**P2 — concurrency and authz**:

10. `tests/concurrency/` — `Promise.all` races on `applyCollection`, `applyCollection+cancel`, `addProfitDistribution`, `updateDelivery(confirm)`.
11. `tests/authz/route-matrix.test.js` — data-driven: POST to every write route with (anon|seller|driver|manager|admin); assert HTTP status matrix. Real JWT helper, not mocks.
12. `tests/authz/cross-user.test.js` — seller A cannot see/edit seller B; driver A cannot confirm driver B's delivery.

**P3 — resilience**:

13. `tests/resilience/transaction-rollback.test.js` — inject failure inside `withTx` for each money function; assert nothing persisted.
14. `tests/resilience/idempotency-keys.test.js` — client-supplied `Idempotency-Key` header on `POST /api/sales`, `POST /api/profit-distributions`, `PUT /api/deliveries`.
15. `tests/resilience/schema-drift.test.js` — after `initDatabase()` inspect `information_schema`, assert every expected column/index/constraint is present.

**P4 — suite hygiene**:

16. Split `sale-lifecycle.test.js` into independent tests.
17. Remove ordering assumptions from `profit-distribution.test.js` Test 6.
18. Move mock-DB tests under `tests/route-contracts/`, real-DB under `tests/real-db/` for CI clarity.
19. `tests/coverage-gate.test.js` — enumerates `lib/db.js` exports, fails if a new export is added without a whitelist entry. Forces new money functions to have tests.

### 4.7 Top-of-backlog (if only 3 things ship in v1.1 test work)

1. **`addProfitDistribution` solvency test + DB unique constraint + `getCollectedRevenueForPeriod` cap.** The exact fix for v1.0.3.
2. **`tests/invariants/global-invariants.test.js` with INV-01..INV-08.** Turns the suite from "every function works in isolation" into "the database is globally consistent after any operation." Would have caught v1.0.3 without editing the profit-distribution test.
3. **`setup.test-env.js` hardening.** 20 lines, fixes a higher-severity latent bug than F-001.

Everything else in P1/P2/P3 is higher-leverage than the existing 436 tests but lower than these three.

Raw coverage matrix in Appendix C.

---

## Domain 5 — Architecture & Engineering Practice Audit

> Methodology: 12 dimensions × `lib/`, `app/api/`, `tests/`, ops config. Read-only static audit.

### 5.0 Top 10 architectural debts

| # | Severity | Debt | Effort |
| - | -------- | ---- | -----: |
| 1 | **CRITICAL** | `.env.test` points at the **same Neon host and database** as `.env.local`. Test suite issues `TRUNCATE TABLE purchases, sales, …` with no guard. First `npm test` run on a clean shell wipes production. | S (guard) / M (branch split) |
| 2 | **CRITICAL** | **No CI/CD.** `.github/workflows/` is empty. Nothing runs lint/tests/build on push. Six releases in 72 hours shipped with no automated gate. | M |
| 3 | **CRITICAL** | `lib/db.js` is a **4,300-line god-module** with 60+ exported functions spanning 12 domains. Every bug fix threads through it; proximal cause of the v1.0.x bug fanout. | L |
| 4 | **HIGH** | **No unique constraint** on `profit_distributions` blocks double-distribution. Period columns are nullable, so a naive UNIQUE is structurally impossible without a parent-header table refactor. | M–L |
| 5 | **HIGH** | `getClients` still uses a **string-join on `client_name`** (`lib/db.js:1615-1656`). Sales have no `client_id` FK; one malformed UPDATE corrupts every historical aggregate. v1.0.3 shipped a band-aid. | L |
| 6 | **HIGH** | **No observability.** No logger, no `audit_log` table (only narrow `cancellations`), only `console.error` scattered across routes. Incidents are unreconstructable. | M |
| 7 | **HIGH** | Schema migrations live in BOTH `initDatabase()` (240+ lines of `ALTER … .catch(() => {})`) AND `scripts/migrations/*.sql`. No ledger, no ordering, no rollback. Every ALTER failure silently swallowed. | L |
| 8 | **HIGH** | **No TypeScript, no `checkJs`.** `jsconfig.json` has path alias only. 4,300 lines of money-moving JS with zero compile-time safety. Bug-3 fan-out would have been caught by even minimal types. | L |
| 9 | **MEDIUM** | Auth is **copy-pasted per route** — `checkAuth` duplicated in 5+ files. Inconsistent role checks: `POST /api/settlements` and `POST /api/expenses` have no role check at all (any authed user, incl. drivers, can create). | M |
| 10 | **MEDIUM** | `initDatabase()` runs on every `/api/init` hit, executes ~80 ALTERs + `autoLearnFromHistory()` + `seedProductAliases()`. Blocks first-request latency; races itself when two lambdas warm concurrently. | M |

### 5.1 Dimension 1 — Separation of concerns

`lib/db.js` = **4,300 lines, 60+ exports**, covering bootstrap / purchases / sales / expenses / clients / payments / products / suppliers / deliveries / summary / users+settings / bonuses / invoices / settlements / profit distributions / aliases+AI learning. Every bug fix over 3 days touched this file. The proximal cause of Bug 3 (client aggregate fan-out) was that the two readers (`sales` + `payments`) lived 300 lines apart in the same file with no type linking them.

**[CRITICAL F-048]** — Split `lib/db.js` into `lib/db/` directory one file per bounded context, plus `_client.js` and `_migrations.js`. Create `lib/db/index.js` as a barrel re-export for backwards compat. Move functions one domain at a time. Effort: **L** (sprint).

**[MEDIUM F-049]** — `lib/db.js:1689-1724` transliteration (`generateLatinName`, `transliterateArabicChars`) is business logic buried in the data layer. Move to `lib/text-utils.js`.

### 5.2 Dimension 2 — Transaction discipline

`withTx` defined once at `lib/db.js:16-29`. 23 callers; `FOR UPDATE` locks present on sales, products, purchases, deliveries, invoices, bonuses. Good baseline.

**[HIGH F-050]** — `lib/db.js:1943-1950` `addPayment` is NOT transactional and holds no row lock on the sale. Called directly by `POST /api/payments`. A manually-inserted payment races `applyCollection` on the same sale: `addPayment` appends a row while `applyCollection` locks `FOR UPDATE` and recomputes `paid_amount`. Result: orphan payment row invisible to `sales.paid_amount`. Fix: route `addPayment` through `applyCollectionInTx` when `saleId` is provided. Effort: S.

**[HIGH F-051]** — `lib/db.js:3681-3700` `addProfitDistribution` eligibility checks run OUTSIDE the transaction (loop before `withTx` opens at 3707). A concurrent `toggleUserActive` between check and insert is possible. Fragile. Same finding as F-001's "move checks inside withTx" requirement. Effort: S.

**[MEDIUM F-052]** — `app/api/payments/route.js:63-74` DELETE goes around every transaction and every helper — raw `DELETE FROM payments WHERE id = $1`. Does NOT revert `sales.paid_amount` / `sales.remaining` / `sales.payment_status`. An admin clicking "delete payment" silently desynchronizes the sale ledger. Fix: replace DELETE with a "void" that inserts a compensating negative row inside `withTx`, mirroring `cancelSale`'s refund flow.

**Idempotency gap** — `applyCollection` and `addSettlement` have no client-side idempotency key. Double-tap during network slowness records duplicate rows. Pairs with F-046 (test gap).

### 5.3 Dimension 3 — Schema evolution

**[CRITICAL F-053]** — `lib/db.js:240-605` — ~80 `ALTER TABLE` statements each wrapped in `.catch(() => {})`. Hides every ALTER failure: a typo silently no-ops and the app runs against the old schema. Exact class of bug the ARC-06 migration comment warned about.

**[HIGH F-054]** — No migration ledger. No `schema_migrations` table tracking ran migrations. Every migration is "idempotent-by-convention-via-IF-NOT-EXISTS". On a restore from a pre-migration snapshot, idempotent ones work; a column rename does not.

**[HIGH F-055]** — The profit distribution unique constraint is **structurally impossible** without a redesign. Schema uses one row per recipient (`lib/db.js:336-350`) with `group_id` as the logical key; period columns are nullable. `UNIQUE(base_period_start, base_period_end)` fails because nulls aren't unique in Postgres by default. **Correct v1.1 refactor**: parent `profit_distribution_groups(id, base_period_start, base_period_end UNIQUE, base_amount, created_at, …)` table with `profit_distribution_recipients(group_id FK, username, percentage, amount)` children. Then a real `UNIQUE (base_period_start, base_period_end) WHERE base_period_start IS NOT NULL` partial index works on the parent. Effort: L.

**[HIGH F-056]** — `autoLearnFromHistory()` runs inside `initDatabase` and scans whole history on every `/api/init` hit. Plus the `entity_aliases` lookup index at `lib/db.js:450` is NOT unique, so `seedProductAliases` and `autoLearnFromHistory` can race themselves and insert duplicates. Fix: add `UNIQUE (entity_type, normalized_alias)` and move background jobs out of bootstrap.

**Fix — Introduce versioned migrations**: `scripts/migrations/NNN-description.sql` files read in order, recorded in `schema_migrations(version, ran_at)`. Delete the `.catch` swallowing. Effort: M.

### 5.4 Dimension 4 — Error handling

**[MEDIUM F-057]** — Inconsistent "safe-to-return" detection across routes. Three different implementations of "is this error message safe":
- `sales/route.js:88-91` — `isSafeError(err) { return /^[\u0600-\u06FF]/.test(err.message) }`
- `sales/[id]/cancel/route.js:56,143` — same check, inlined twice.
- `sales/[id]/collect/route.js:61-69` — **substring-matches** Arabic phrases (`.includes('غير موجود')`, `.includes('مدفوع بالكامل')`) to map to HTTP codes. Brittle — a translator change breaks status mapping silently.
- `clients/route.js:43-45` — no safe-error check at all. Returns generic `'خطأ في إضافة البيانات'`, hiding the real message.
- `payments/route.js:57-60` — same.

Fix: create `lib/api-errors.js` exporting `apiError(err, fallback)` + `ApiUserError` class thrown by `lib/db/*`. Replace inlined checks. Effort: S.

**[LOW F-058]** — No correlation IDs. `console.error('[sales] POST:', error)` is unstructured. When the user exports Vercel logs during an incident, there's no `request_id` / `user_id` / `route` field to filter by.

### 5.5 Dimension 5 — Validation boundaries

**[HIGH F-059]** — `app/api/profit-distributions/route.js:51-58` — the **most financially sensitive POST** in the system has ZERO schema validation. `baseAmount`, `recipients[]`, `percentages`, `basePeriodStart/End` handed to `addProfitDistribution` raw. The `recipients` array could be any shape. The v1.0.3 bug slipped past here. Fix: add `ProfitDistributionSchema` to `lib/schemas.js`; mirror F-001's write-path cap inside a Zod `.refine`. Effort: S.

**[HIGH F-060]** — `sales/[id]/collect/route.js:46-54` and `clients/[id]/collect/route.js:41-48` — hand-written validation for the cash-flow hot path. Duplicated across files; divergent from `lib/schemas.js`'s `positiveNum('المبلغ')`. A schema change needs edits in multiple places. Fix: add `CollectionSchema`.

**[MEDIUM F-061]** — `sales/[id]/cancel/route.js:98-104` — body handler for cancellation (a write path touching 6 tables atomically) has no schema. Fix: add `CancelSaleSchema`.

**Fix — lint/test rule**: grep route files for `request.json()` unaccompanied by `safeParse` in the same handler; fail CI. Effort: S.

### 5.6 Dimension 6 — Observability

**[HIGH F-062]** — Ops cannot reconstruct "who did what when" after an incident:
- Who deleted payment 47? Untraceable.
- Who modified client #12's phone? Untraceable.
- Which admin toggled user #3 inactive? Untraceable.
- The only audit coverage is `cancellations` table + `price_history` + `created_by` column family.

**[HIGH F-063]** — No structured log format. `console.error('[sales] POST:', err)` is string concat. No request_id, no severity field, no duration.

**[MEDIUM F-064]** — No `GET /api/health`. Vercel will serve a cold-started lambda mid-`initDatabase` and the user experiences 30-second first-request latency with zero visibility.

**Fix**:
1. Create `audit_log(id, timestamp, actor_username, actor_role, action, entity_type, entity_id, before_json, after_json, request_id, ip)`. Write from a `recordAudit(client, …)` helper called inside every `withTx`. Effort: M.
2. Adopt `pino` as a minimal structured logger (4 KB, zero deps). Wrap to inject `request_id`, `route`, `user`, `duration_ms`. Replace every `console.error` in `app/api/`. Effort: S.
3. Add `GET /api/health` returning `{ ok, db_latency_ms, migration_version }`. Effort: S.
4. Add `/admin/audit` page paginating the log with filters. Effort: M.

### 5.7 Dimension 7 — Authorization

**[CLOSED — FALSE POSITIVE F-065]** — Domain 5 audit agent reported settlements POST as unguarded. **Verified false** against `app/api/settlements/route.js:26`: the route enforces `token.role !== 'admin'` → 403 for manager, seller, driver, and unauthenticated callers. The audit agent apparently read only the outer `if (!token)` check and missed the role line two statements later. Regression test: `tests/authz/settlements-post-rbac.test.js` (5 cases, all green) locks the behavior. Study correction committed 2026-04-15.

**[CLOSED — FALSE POSITIVE F-066]** — Domain 5 reported expenses POST unguarded. **Verified false** against `app/api/expenses/route.js:26`: the route enforces `['admin','manager'].includes(token.role)`. Drivers and sellers return 403. Regression test: `tests/authz/expenses-post-rbac.test.js` (5 cases, all green).

**[CLOSED — FALSE POSITIVE F-067]** — Domain 5 reported voice POST unguarded. **Verified false** against `app/api/voice/process/route.js:45`: the route enforces `['admin','manager','seller'].includes(token.role)` AND has a per-user sliding-window rate limit (10 req/min). Drivers return 403. Regression test: `tests/authz/voice-process-rbac.test.js` (2 cases, all green).

**[MEDIUM F-068]** — Auth is copy-pasted per route. `checkAuth` function duplicated in `sales/route.js:8`, `clients/route.js:7`, `payments/route.js:7`, `profit-distributions/route.js:10`, `sales/[id]/cancel/route.js:29`. Each reimplements `if (!['admin','manager'].includes(token.role))` checks and picks its own error string.

**Fix — Create `lib/api-auth.js`** exporting `requireAuth(request, roles?)` that returns `{ token }` or throws `ApiAuthError`. Replace every inline `checkAuth`. Audit every POST and pin its role set. Effort: S (the scaffold) + S (the per-route edits).

### 5.8 Dimension 8 — `.env.test` footgun (CRITICAL — elevated to its own section)

**[CRITICAL F-009]** (recapping Domain 4 finding with architectural framing) — `.env.local` and `.env.test` point at the same Neon endpoint (`ep-winter-wave-alho9ws5-pooler.c-3.eu-central-1.aws.neon.tech`), same database (`neondb`), same role (`neondb_owner`). `tests/setup.test-env.js` only checks "URL is set" and "starts with `postgresql://`". **Nothing verifies the URL points at a non-production branch.** 8+ test files issue `TRUNCATE TABLE … RESTART IDENTITY CASCADE`.

Running `npm test` today wipes production data. The only reason it hasn't happened is that nobody has run the integration tests on a shell that loads `.env.test`. The CI absence means only the author runs them locally.

Bonus observation: the `.env.test` URL contains a literal `\n` inside the quoted string, which means dotenv is currently passing it through as a string with a trailing newline. Works today by accident; a dotenv version bump could break it.

**Fix**:
1. Create a dedicated Neon branch `test-sandbox` and rewrite `.env.test` to point at it. [S]
2. Harden `tests/setup.test-env.js` with layered checks:
   ```js
   const url = process.env.POSTGRES_URL || '';
   if (!/test|sandbox/i.test(url)) {
     throw new Error('REFUSING TO RUN: POSTGRES_URL does not contain "test" or "sandbox"');
   }
   if (url === process.env.PROD_POSTGRES_URL) {
     throw new Error('REFUSING TO RUN: matches PROD_POSTGRES_URL');
   }
   const { rows } = await sql`SELECT COUNT(*) AS n FROM users WHERE username <> 'admin'`;
   if (Number(rows[0].n) > 5) {
     throw new Error(`REFUSING TO RUN: target DB has ${rows[0].n} non-admin users — looks like prod`);
   }
   ```
3. Add a `pretest` script in `package.json` that prints the DB host and prompts for confirmation in interactive mode.
4. Add `"test:safe"` npm script that explicitly sets `POSTGRES_URL=$TEST_DATABASE_URL` and fails if unset.

### 5.9 Dimension 9 — CI/CD

**[CRITICAL F-069]** — `.github/workflows/` does not exist. `package.json` has no `test` script. Nothing runs eslint, vitest, or `next build` on push. Merges to main are unprotected. Six releases in 72 hours shipped with no gate.

**[HIGH F-070]** — No branch protection. `git log` shows direct commits to main with no merge commits.

**Fix** (`.github/workflows/ci.yml`):

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    env:
      POSTGRES_URL: ${{ secrets.NEON_TEST_BRANCH_URL }}
      NEXTAUTH_SECRET: test-secret
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npx next build
      - run: npx vitest run
```

+ GitHub branch protection: require CI green + 1 review before merging to `main`. + `"test": "vitest run"` in `package.json`. + gate Vercel deployments on CI success. Effort: all S.

### 5.10 Dimension 10 — Config drift

**[HIGH F-071]** — Possibility that `.env.test` was committed to git history before `.gitignore` was tightened. The `bd2e33b chore(cleanup): … tighten gitignore` commit hints at this. User should run `git log -p -- .env.test` and **rotate Neon credentials** if they were ever committed. [S, manual]

**[MEDIUM F-072]** — No env-var validation on boot. `NEXTAUTH_SECRET` could be missing or set to the default `test-secret-do-not-use-in-production` and NextAuth would still start; it would just not validate tokens correctly. Fix: `lib/env.js` with Zod parse at boot:

```js
import { z } from 'zod';
const envSchema = z.object({
  POSTGRES_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),
  GROQ_API_KEY: z.string().optional(),
  ALLOW_DB_RESET: z.enum(['true','false']).default('false'),
});
export const env = envSchema.parse(process.env);
```

**[MEDIUM F-073]** — `.env.example` is out of date. Lists `POSTGRES_URL`, `NEXTAUTH_SECRET`, `ALLOW_DB_RESET` but not `GROQ_API_KEY`. Fresh devs don't know which envs to set.

### 5.11 Dimension 11 — Dead code

Overall relatively clean. Minor items:

**[LOW F-074]** — `seedProductAliases KNOWN_ALIASES` (`lib/db.js:659-707`) — 40 hand-curated aliases now likely redundant with the voice normalizer + `autoLearnFromHistory`.

**[LOW F-075]** — BUG-xxx and FEAT-xxx comments throughout `lib/db.js` are historical markers (valuable for understanding _why_) but make the file 4,300 lines. Move to `docs/bug-ledger.md` with cross-reference during the split in F-048.

**[LOW F-076]** — `addExpense` hand-validates `amount > 0` — redundant with Zod `positiveNum('المبلغ')` at the route layer.

### 5.12 Dimension 12 — Type safety

**[HIGH F-077]** — Zero compile-time safety on 4,300 lines of money-moving code. Every `parseFloat(row.column)` is manual. ARC-06 note at `lib/db.js:525-528` is a manual reminder; nothing enforces it at every read site. A future dev writing `row.paid_amount + 100` gets string concatenation (`"500.00100"`), not addition.

Bug 3 fan-out would have been caught by types. If `getClients` returned `Array<Client & { totalSales: number, totalPaid: number }>`, the double-read adding `sum(sales) + sum(payments)` would have raised a red flag in review. Instead it shipped and was only caught via HAR analysis.

**Fix**:
1. Enable `checkJs` + `strict: false` in `jsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "checkJs": true, "allowJs": true, "noEmit": true,
       "target": "ES2022", "moduleResolution": "bundler",
       "strict": false, "paths": { "@/*": ["./*"] }
     },
     "include": ["lib/**/*.js", "app/**/*.js"]
   }
   ```
   Run `npx tsc --noEmit` once and fix the cascade. Effort: M.
2. During the F-048 split, migrate `lib/db/*` to `.ts` and use `zod.infer` for row types.
3. Add `"typecheck": "tsc --noEmit"` to `package.json` and CI.

### 5.13 Cross-cutting

**Numeric-as-string landmines.** ARC-06 comment at `lib/db.js:525-528` warns that `@vercel/postgres` returns NUMERIC as string. Every new function written after ARC-06 is a new opportunity for someone to forget. The case for types (F-077) is strongest here.

**Concurrent cold start.** Two admins clicking `/api/init` simultaneously → Postgres serializes DDL via AccessExclusiveLock, one waits. With `.catch(() => {})` any conflict is silently absorbed. But `seedProductAliases` and `autoLearnFromHistory` can race themselves because the lookup index is non-unique (F-056).

### 5.14 Severity tally

| Severity | Count |
| -------- | ----: |
| CRITICAL | 5 (F-053, F-065, F-069, F-009, F-048 if counted for risk) |
| HIGH     | 14 |
| MEDIUM   | 10 |
| LOW      | 8  |

Full finding register in Appendix D.

---

## Prioritized v1.1 Fix Plan

See §Executive Summary "v1.1 scope recommendation" for the 5-sprint plan. The sprints are ordered by **risk × unblocking value**, not by finding number.

**Sprint 1** closes every CRITICAL that can leak data or ship production code unchecked. Every item is S-effort; most are single-file changes. After Sprint 1, the system is *safe to touch* — real customer data can be entered without the three tripwires (F-009, F-065, F-069) firing.

**Sprint 2** closes the accounting liability story. After Sprint 2, the P&L numbers on the dashboard match what an independent SQL query would compute, profit distributions are capped at distributable pool, and the bonus model no longer charges the company for unrealized credit-sale revenue.

**Sprint 3** restores observability so the *next* incident is diagnosable after the fact.

**Sprint 4** pays down the foundations that caused the v1.0.x bug fanout: splitting the god-module, versioning the migrations, enabling compile-time type checking, and restructuring the profit distribution schema so the real UNIQUE constraint is possible.

**Sprint 5** gives the field sellers and drivers a mobile experience that isn't a horizontal scroll war.

### Finding index (abridged — full descriptions in domains above)

| Sprint | Finding IDs |
| ------ | ----------- |
| 1 (stop the bleeding) | F-009, F-069, F-065, F-066, F-067, F-059, F-060, F-061, F-050, F-052, F-072, F-073, F-057, F-068, F-017, F-024 |
| 2 (accounting) | F-001, F-002, F-003, F-004, F-005, F-006, F-007, F-011, F-012, F-015, F-016, F-036, F-037, F-040 |
| 3 (observability + audit) | F-008, F-062, F-063, F-064, F-025, F-023, F-043, F-044 |
| 4 (foundations) | F-048, F-049, F-053, F-054, F-055, F-056, F-058, F-077 |
| 5 (mobile + UX) | F-010, F-018, F-019, F-020, F-021, F-022, F-026, F-027, F-028, F-029, F-030, F-031, F-032, F-033, F-034, F-035, F-041, F-045, F-046, F-047 |

### Deferred to v1.2

- Full `/admin/audit` UI page with paginated audit_log viewer (Sprint 3 lays the table + logger; v1.2 builds the UI)
- Drivers-only PWA shell at `/driver` with bottom nav
- Swipe gestures on mobile delivery cards
- `lib/db/*` migration to TypeScript with `zod.infer` row types (Sprint 4 enables checkJs; v1.2 does the actual conversion)
- Voice-path normalizer improvements from the existing backlog
- Supplier-credit UX polish
- Dashboard widget overhaul / tabbed summary bottom cards
- i18n scaffolding / non-Arabic rendering
- Dead code: BUG-xxx historical comment → `docs/bug-ledger.md` migration
- CSV export standardization across all data tables
- Pagination primitive for tables past ~500 rows

---

## Appendices

### Appendix A — Domain 2 page-by-page inventory pointer

The 15-page UI/UX audit (Domain 2) is merged into §2 above. For each page, the research pass checked 9 criteria (hierarchy, empty states, loading, errors, validation, destructive guards, navigation, density, a11y) and produced severity-tagged findings with file:line citations. The page-by-page raw inventory lives in the research agent output; the findings that surfaced CRITICAL or HIGH issues have been promoted into §2.1 with global F-IDs (F-015 through F-025). The MEDIUM/LOW/NICE findings are summarized in the severity tally at §2.2 and folded into the Sprint 5 finding index.

**Highlights not already promoted**:
- `/summary` CSV export does not escape commas/quotes in Arabic category names (`app/summary/page.js:80`) — [LOW].
- `/summary` `topProducts` key uses `p.item` which may collide (`:639`) — [LOW].
- `/purchases` pay-supplier modal backdrop click drops typed data (`:519`) — [LOW].
- `/stock` `DetailModal` hardcodes `(stock||0) > 5` (`:407`) contradicting per-product `low_stock_threshold` — [MEDIUM].
- `/stock` inline `sell_price` edit uses `defaultValue+onBlur` losing focus on touch — [NICE].
- `/clients` case-sensitive search via `String.includes` — [LOW].
- `/clients/[id]` inconsistent 0.005 vs 0.01 tolerance (vs `/settlements`) — [LOW].
- `/deliveries` `handleSubmit` reset omits `clientEmail` — [LOW].
- `/invoices` VIN search case-sensitive — [MEDIUM, F-044 flavor].
- `/settlements` history form double-submit possible (no `submitting` lock) — [MEDIUM, promoted indirectly].
- `/settlements` drill-down modal lacks focus trap + `role="dialog"` — [MEDIUM, a11y].
- `/users` active-toggle no confirmation — [MEDIUM, sibling of F-017].
- `/settings` VAT rate save lacks confirmation — [MEDIUM, sibling of F-016].

### Appendix B — Domain 3 mobile inventory pointer

The responsive audit (Domain 3) is merged into §3 above. Raw highlights not yet promoted to F-IDs:

- **No `tailwind.config.js` in the repo.** Tailwind v4 is wired through PostCSS only; the app is effectively styled by hand-rolled classes in `globals.css` + inline `style={{}}`. Consequence: you cannot fix mobile by "adding responsive utility classes" — they won't reach the inline styles.
- The styling model question (continue CSS media queries vs migrate to utility classes) is a Sprint 4-or-later decision.
- Sidebar drawer pattern is already correct (`components/Sidebar.js:147-214`). RTL-correct slide direction.
- Forms use `font-size: 16px` on inputs (correct iOS focus-zoom prevention).
- `type="number"` used on 21 occurrences across 11 files; `type="tel"` on phone. Zero `inputMode` attributes anywhere (v1.2 audit).
- `.data-table` base at mobile uses `min-width: 600px` (768bp) or `500px` (480bp) + `white-space: nowrap` — the table-scroll pattern.
- Cards (`.card`, `.detail-modal`) are already sized `width: 95%; max-height: 90vh` on mobile.

### Appendix C — Domain 4 test coverage matrix pointer

The 43-test-file inventory + 72-export coverage matrix is compacted into §4 above. Full matrix:

**Voice / AI layer (no DB)**: `alias-generator`, `voice-normalizer`, `voice-no-phantoms`, `voice-action-classifier`, `bug06-voice-normalizer-coverage`, `bug28-voice-blacklist`, `bug09-sell-price-prompt`, `bug10-missed-field-learn`, `hotfix-voice-null-fields`, `latin-transformation`.

**Schema / route tests (mock `@/lib/db`)**: `api-error-logging`, `bug03-init-reset-gate`, `bug04-deliveries-driver-put`, `bug04a-vin-preservation`, `bug04b-driver-put-edge-cases`, `bug05-summary-date-window`, `bug08-bonus-driver-fallback`, `bug14-deliveries-post-contract`, `bug14-schemas`, `bug21-supplier-ambiguity`, `bug30-products-put-mirror`, `bug30-sales-buy-price-floor`, `manual-form-coercion`, `feat04-invoice-modes`, `cancel-rule-rbac`.

**Real-DB integration (TRUNCATE + seed)**: `sale-lifecycle`, `feat04-apply-collection`, `feat04-cash-basis-summary`, `feat04-partial-payments`, `feat05-cancel-sale`, `idempotency-double-cancel`, `cash-dpe-immutable`, `client-empty-phone-merge`, `clients-aggregate-correctness`, `eligible-users`, `settlement-details`, `settlement-validation`, `supplier-credit`, `supplier-performance`, `top-sellers`, `profit-distribution`.

**Setup**: `setup.test-env.js` (11 lines, missing DB-name check — F-009).

**Coverage counts**: TESTED 13/72 (18%) · PARTIAL 26/72 (36%) · UNTESTED 33/72 (46%). Money-touching exports with zero coverage: `deletePurchase`, `addExpense`, `deleteExpense`, `applyCollectionFIFO`, `cancelDelivery`, `getInvoices`, `voidInvoice`, `updateSale`, `updatePurchase`, `updateExpense`, `previewCancelSale`, `commitCancelSale`.

### Appendix D — Domain 5 architecture finding index pointer

Full 12-dimension audit lives in §5. F-IDs assigned: F-048 through F-077 span the architecture findings. Key file:line register:

| Finding | Location |
| ------- | -------- |
| `.env.test` = `.env.local` Neon host | `.env.test:1` vs `.env.local:1` |
| Tests TRUNCATE with no guard | `tests/setup.test-env.js:6-11` |
| No CI workflows | `.github/workflows/` (missing) |
| `withTx` definition | `lib/db.js:16-29` |
| `addPayment` no transaction/lock | `lib/db.js:1943-1950` |
| Payments DELETE desyncs sales | `app/api/payments/route.js:63-74` |
| No safeParse in profit-distributions POST | `app/api/profit-distributions/route.js:51-58` |
| Settlements POST no role check | `app/api/settlements/route.js:31` |
| `.catch(() => {})` swallow-all on migrations | `lib/db.js:240-605` |
| `initDatabase` runs 80+ ALTERs per cold start | `lib/db.js:78-626` |
| Profit distribution period nullable → no UNIQUE possible | `lib/db.js:336-353` |
| `getClients` string-join stopgap | `lib/db.js:1615-1656` |
| Inline `checkAuth` copy-paste | `sales/route.js:8`, `clients/route.js:7`, `payments/route.js:7`, `profit-distributions/route.js:10`, `sales/[id]/cancel/route.js:29` |
| Two divergent `isSafeError` patterns | `sales/route.js:88-91` vs `sales/[id]/cancel/route.js:56,143` vs `profit-distributions/route.js:64-66` |
| NUMERIC-as-string trap | `lib/db.js:525-528` + every read site |
| `entity_aliases` non-unique index → seeder self-race | `lib/db.js:450` |

### Appendix E — Domain 1.7 SQL transcripts

All 10 invariant queries (INV1-INV10) run against production Neon on 2026-04-15 are reproduced inline in §1.7. The definitive number from INV1:

```sql
SELECT
  (SELECT COALESCE(SUM(amount),0) FROM profit_distributions) AS total_distributed,
  (SELECT COALESCE(SUM(amount),0) FROM payments WHERE type='collection') AS total_collected,
  (SELECT COALESCE(SUM(amount),0) FROM payments WHERE type='collection')
  - (SELECT COALESCE(SUM(amount),0) FROM profit_distributions) AS remaining_distributable;

-- RESULT (2026-04-15 19:10 UTC):
-- total_distributed:         5700.00
-- total_collected:           2850.00
-- remaining_distributable:  -2850.00   ← violates INV1
```

### Appendix E — SQL transcripts from Domain 1.7 invariant checks

See the raw results inline in §1.7. All queries are reproducible by connecting to the production Neon branch and running the statements in the Inv. table.

### Appendix F — Methodology notes

- **Read-only guarantee.** No `INSERT`, `UPDATE`, `DELETE`, `ALTER`, or `CREATE` was issued against the production database during this study. All observations used `SELECT` (+ `information_schema` introspection).
- **No code or config was modified** during the research phase. The only file created is this document, on its own branch.
- **Live DB identification.** The connection used was the one configured in `.env.test`, which per the delivery-handoff notes is the production Neon branch. The user must still complete the `.env.test` isolation step before running destructive tests.
- **Source of truth for findings.** For code-based claims: `file_path:line_number`. For DB-based claims: the `SELECT` query is quoted in the finding. Either can be independently verified.
