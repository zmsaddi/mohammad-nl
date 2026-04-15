# Vitesse Eco v1.1 — Execution TODO

**Source:** `docs/v1-1-comprehensive-study.md` (study commit `6b612bf`, merged to master as `427f2c3`)
**Started:** 2026-04-15
**Target tag:** v1.1.0
**Branch model:** feature branches off master, `--no-ff` merges, linear history

## Status legend

- `[ ]` not started
- `[~]` in progress
- `[x]` complete (with commit SHA)
- `[!]` blocked (with reason)
- `[s]` skipped (with rationale)
- `[-]` false positive (verified, annotate study)

## Operating rules

1. **S1.1 MUST ship first.** Do not run any DB-touching test before the `.env.test` guard is live.
2. **One F-ID per branch.** Branch name `sprint-N/F-XXX-slug`. `--no-ff` merge. Descriptive commit cites F-ID.
3. **TODO.md updated after every task.** Never batch.
4. **False positives get `[-]` + study annotation** (not `[x]`).
5. **Schema migrations** live under `scripts/migrations/v1-1/NNN-name.sql`. User-executed unless explicitly automated.
6. **Stop-and-ask conditions** — see end of file.

---

## Sprint 1 — Ship Blockers (target: 1 week)

Goal: after this sprint, the system is safe for real customer data. Every CRITICAL from the study is either closed or marked false-positive with evidence.

### S1.1 — F-009: `.env.test` hard guard [CRITICAL, autonomous] — **DONE**

Current state: `.env.test` URL `postgresql://...@ep-winter-wave-alho9ws5-pooler...` appears to be the production Neon branch. `.env.local` on master is a blank template (real credentials only in `.env.test` on the dev machine). `tests/setup.test-env.js` only checks "URL is set" and "starts with postgresql://". Risk: `npm test` on the wrong shell wipes production.

**Autonomous fix (guard-only, SHIPPED):**

- [x] Rewrite `tests/setup.test-env.js` with layered refusal checks (URL class parse, safe-pattern on host OR db name, NODE_ENV, trailing-whitespace strip, NON_POOLING parity)
- [x] Add `scripts/env-test-doctor.mjs` — live `SELECT current_database()` probe + non-seed user count (refuses if > 10)
- [x] Wire `"pretest": "node scripts/env-test-doctor.mjs"` in `package.json` — also added `test`, `test:ui`, `typecheck` scripts
- [x] Add a regression test for the guard itself — `tests/setup.test-env.guard.test.js`, 6 cases, spawns child nodes with poisoned envs, all 6 pass
- [x] Widen `.gitignore` from `.claude/worktrees/` to `.claude/` (prevents local Claude state leaking into commits)
- [x] SETUP.md §4.1/§4.2 documents safe-pattern rule + doctor script + `npm test` entry point
- [x] Build green: `npm run build` passes
- [x] Commit + merge to master — `2dea127` (merge), `07a9c2d` (feature)

**User action still required (tracked as blocker for DB tests):**

- [!] Create a dedicated Neon branch `test-sandbox` (Neon console → Branches → Create). User must do this; Claude has no Neon API access.
- [!] Rotate `neondb_owner` password on production branch (credentials visible in `.env.test` on this dev machine — see F-071).
- [!] Update `.env.test` to point at the new branch URL + new password.

Until the user takes these three steps, **no real-DB test can run**. That's the whole point of the guard. The 6 guard regression tests pass with `POSTGRES_URL='postgresql://test:test@test-host.example.com/neondb-test'` env override as proof of concept.

Tests added: **6** · Merge commit: `2dea127`

---

### S1.2 — F-065: settlements POST role check [CRITICAL — FALSE POSITIVE] — **DONE**

Domain 5 audit reported the route was gated on `!token` only. **Verified false:** `app/api/settlements/route.js:26` already enforces `token.role !== 'admin'`. Only admins can POST. Drivers/sellers/managers get 403.

- [-] Marked as false positive in study doc §5.7
- [x] Regression test `tests/authz/settlements-post-rbac.test.js` — 5 cases (admin→200, manager/seller/driver/anon→403)

Tests added: 5 · Merge commit: `ffbc2ce`

---

### S1.3 — F-066: expenses POST role check [CRITICAL — FALSE POSITIVE] — **DONE**

Domain 5 audit reported no role check. **Verified false:** `app/api/expenses/route.js:26` enforces `['admin','manager'].includes(token.role)`. Drivers and sellers are blocked.

- [-] Marked as false positive in study doc §5.7
- [x] Regression test `tests/authz/expenses-post-rbac.test.js` — 5 cases (admin+manager→200, seller/driver→403, anon→401)

Tests added: 5 · Merge commit: `ffbc2ce`

---

### S1.4 — F-067: voice POST role check [CRITICAL — FALSE POSITIVE] — **DONE**

Domain 5 audit reported no role check. **Verified false:** `app/api/voice/process/route.js:45` enforces `['admin','manager','seller'].includes(token.role)` AND has a per-user sliding-window rate limit (10 req/min).

- [-] Marked as false positive in study doc §5.7
- [x] Regression test `tests/authz/voice-process-rbac.test.js` — 2 cases (driver→403, anon→401)

Tests added: 2 · Merge commit: `ffbc2ce`

---

### S1.5 — F-069: CI/CD GitHub Actions gate [CRITICAL, autonomous]

`.github/workflows/` does not exist. No `test` script in `package.json`. 6 releases in 72h with no gate.

- [ ] Add `"test": "vitest run"`, `"test:ui": "vitest"`, `"typecheck": "tsc --noEmit"` to `package.json`
- [ ] Create `.github/workflows/ci.yml` — checkout, setup-node 20, npm ci, lint, build, test (against `NEON_TEST_BRANCH_URL` repo secret)
- [ ] Document the required GitHub secret in README
- [ ] Commit + push
- [ ] Verify first green build on origin/master

**User action required:**
- [!] Add GitHub repo secret `NEON_TEST_BRANCH_URL` pointing at the Neon test branch (needs S1.1 user action first)
- [!] Enable branch protection on master (Settings → Branches → require 1 review + CI green)

Tests added: CI run itself · Commit: __

---

### S1.6 — F-001: profit_distribution write-path lockdown [CRITICAL, partial autonomous]

The big one. 5,700€ distributed against 2,850€ collected. Two sub-phases:

**Phase A — application-layer cap (autonomous, ships in Sprint 1):**

- [ ] In `lib/db.js` `addProfitDistribution`: open the transaction FIRST (move the eligibility loop inside)
- [ ] Inside withTx: `SELECT pg_advisory_xact_lock(hashtext('profit-dist:' || :from || ':' || :to))` to serialize concurrent inserts
- [ ] Inside withTx: compute `alreadyDistributed = SUM(profit_distributions.amount) WHERE base_period_start >= :from AND base_period_end <= :to`
- [ ] Inside withTx: compute `collected = getCollectedRevenueForPeriod(from, to)` (same connection)
- [ ] Throw Arabic error if `baseAmount + alreadyDistributed > collected`
- [ ] Write `addProfitDistribution` regression tests:
      - Single 100% split succeeds
      - Second call with same period fails with Arabic cap message
      - Over-cap first call rejected
      - `Promise.all([d(1500), d(1500)])` with pool 2850 — exactly one succeeds, one fails
      - Period-overlap (end date +1 day) also rejected under the lock

**Phase B — schema parent/child refactor (Sprint 4, L effort):**

- [ ] Design `profit_distribution_groups(id, base_period_start, base_period_end, base_amount, ...)` parent
- [ ] Design `profit_distribution_recipients(group_id FK, username, percentage, amount)` child
- [ ] Add `UNIQUE (base_period_start, base_period_end)` on parent
- [ ] Migration script with backfill from current table
- [ ] Update all read/write paths

**User cleanup required after Phase A lands:**

- [!] Run `scripts/cleanup/v1-1-profit-distribution-reset.sql` (to be written) to delete the 4 test rows (two groups) that are currently in `profit_distributions`

Tests added: 5+ · Commit: __

---

### S1.7 — F-002: netProfit must subtract profit_distributions [CRITICAL, autonomous]

`getSummaryData` (lib/db.js:2693-2982) computes netProfit without reading `profit_distributions`.

- [ ] In `getSummaryData`: add a scoped `SELECT SUM(amount) FROM profit_distributions WHERE base_period_start <= :to AND base_period_end >= :from` (period-aware)
- [ ] Define `totalProfitDistributed` term
- [ ] Subtract from `netProfit` (accrual) AND `netProfitCashBasis`
- [ ] Return `totalProfitDistributed` and `distributable` in the dashboard payload
- [ ] Update `/summary` page to show the new number
- [ ] Regression test: seed collection+distribution, assert netProfit drops by exactly the distributed amount
- [ ] Commit + push

Tests added: 2 · Commit: __

---

### S1.8 — F-003: totalBonusPaid filter missing `profit_distribution` type [CRITICAL, tied to F-005]

The filter at `lib/db.js:2719` excludes settlement-path profit-distribution rows.

- [ ] Decision: **collapse the two paths** — remove `profit_distribution` from the `SETTLEMENT_TYPES` enum (`lib/schemas.js:254`). All profit splits must go through `/profit-distributions`.
- [ ] Guard in `addSettlement`: throw if caller passes the removed type
- [ ] UI: remove `profit_distribution` option from `/settlements` page form
- [ ] Migration: document that legacy rows of that type in `settlements` stay in the DB for history; the new `getSummaryData` path reads from `profit_distributions` only
- [ ] Regression test: POST with `type='profit_distribution'` → 400 with Arabic error
- [ ] Commit + push

Tests added: 2 · Commit: __

---

### S1.9 — F-053: remove `.catch(() => {})` on DDL in initDatabase [CRITICAL, Sprint 4 candidate but ships autonomous]

`lib/db.js:240-605` — ~80 ALTER statements silently swallow failures.

- [ ] Audit every `.catch(() => {})` in `initDatabase`
- [ ] For each: replace with `.catch(err => { if (!/already exists|duplicate column|duplicate key|does not exist/i.test(err.message)) throw err; })` — throws on real errors, absorbs the idempotent "already X" Postgres messages
- [ ] Run `initDatabase` locally against a scratch DB to verify still idempotent
- [ ] Commit + push

Tests added: integration test that runs initDatabase twice in a row, asserts no throw · Commit: __

---

### S1.10 — F-048: lib/db.js god-module [CRITICAL — deferred to Sprint 4]

4,300-line god-module. Splitting it is L effort; sprint-1 scope only adds the `lib/db/` directory scaffold + barrel file. Real split in Sprint 4.

- [s] Sprint 4: skipped in Sprint 1. Rationale: surgical fixes to the existing file are lower risk mid-sprint.

---

### Sprint 1 bulk items (MEDIUM/LOW from other domains that fit the sprint)

None in Sprint 1 — keep the sprint focused on CRITICALs only.

### Sprint 1 completion criteria

- [ ] S1.1 guard shipped + operational
- [ ] S1.2, S1.3, S1.4 false-positive annotations committed; RBAC tests green
- [ ] S1.5 CI running on every push
- [ ] S1.6 Phase A profit-distribution cap live + tests green
- [ ] S1.7 netProfit formula updated + test green
- [ ] S1.8 `profit_distribution` removed from settlements enum
- [ ] S1.9 DDL swallowing replaced with targeted catch
- [ ] Test count > 436
- [ ] Tag `v1.1.0-sprint1`
- [ ] Sprint completion report to user

---

## Sprint 2 — Accounting Core Rebuild (target: 1.5 weeks)

Closes the remaining HIGH accounting findings.

### S2.1 — F-004: totalDebt Bug-3 pattern [HIGH]

`lib/db.js:2753-2757` uses unfiltered `SUM(payments.amount)`. Saved only by `Math.max(0, …)` clamp.

- [ ] Replace L2756 with filtered `payments.type='collection'` AND `sale_id IS NOT NULL`, or better: read `SUM(sales.remaining) WHERE payment_type='آجل' AND status='مؤكد'`
- [ ] Regression test: 1000€ credit sale + 500€ cash sale, assert totalDebt=1000 (not 500)

### S2.2 — F-005: collapse duplicate profit write paths [HIGH]

Already covered by S1.8 above. Marked as done when S1.8 lands.

- [s] Subsumed by S1.8.

### S2.3 — F-006 + F-007: bonus model split + per-user rates [HIGH]

- [ ] Option B: keep accrual at delivery, but exclude unearned from cash-basis P&L
- [ ] Add `totalBonusEarnedCashBasis` term computed as `Σ bonuses WHERE sale.payment_status='paid'`
- [ ] Subtract that (not `totalBonusCost`) from `netProfitCashBasis`
- [ ] Surface `totalBonusAccruedUnearned` as a liability line in dashboard
- [ ] New schema: `user_bonus_rates(username PK FK, seller_fixed, seller_percentage, driver_fixed, updated_by, updated_at)`
- [ ] Migration script
- [ ] `calculateBonusInTx`: lookup per-user row first; fall back to `settings` globals
- [ ] Admin UI tab under `/users` for per-user override
- [ ] Tests: (a) credit sale partially paid → cash-basis bonus cost 0, (b) seller with override uses override not global

### S2.4 — F-011 + F-012: VAT rate from settings + multi-payment rounding [HIGH]

- [ ] Create `lib/money.js` with `round2(n)`, `tva(amount, rate)`, `toCents/fromCents`
- [ ] Read `settings.vat_rate` once per request (cache); stop hardcoding `/6`
- [ ] Store payment TVA at NUMERIC(19,4); round only at aggregate
- [ ] Update `applyCollectionInTx` (lib/db.js:2009) and `updateDelivery` confirm branch (lib/db.js:2468)
- [ ] Regression: 3-way split 333.33/333.33/333.34 of a 1000€ sale → Σ tva = 166.67 exactly

### S2.5 — F-015: /profit-distributions copy fix + net-profit endpoint [HIGH]

- [ ] Change label at `app/profit-distributions/page.js:200` to `قاعدة التوزيع (صافي الربح) *`
- [ ] Change subtitle at `:163` to `توزيع صافي الربح`
- [ ] Create `GET /api/profit-distributions/distributable?from=&to=` endpoint that returns the computed cap (collected − already distributed − expenses − bonuses)
- [ ] Replace the "use collected revenue as base" button with "use distributable as base"
- [ ] Tooltip warning if the user edits the field to a value > distributable
- [ ] Regression test: form submit with value > distributable → 400

### S2.6 — F-016: /clients/[id] TVA preview [HIGH]

- [ ] Read `settings.vat_rate` in `fetchData`
- [ ] Compute `tvaPreview = amount × rate / (100 + rate)`
- [ ] Label: `TVA المحتسبة ({rate}%)` interpolated
- [ ] Create `<TvaRateLabel rate={rate} />` helper component (reused in 3 more places)
- [ ] Regression test: change settings.vat_rate, assert preview updates

### S2.7 — F-008: updated_by / updated_at audit columns [HIGH]

- [ ] Migration: `ALTER TABLE {sales, clients, products, purchases, expenses, deliveries, payments, invoices, suppliers, settlements, profit_distributions} ADD COLUMN updated_by TEXT, ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW()`
- [ ] Wire every `UPDATE … SET …` in `lib/db.js` to include `updated_by = $token.username, updated_at = NOW()`
- [ ] Regression: updateSale → new row has updated_by stamped
- [ ] Follow-up work for v1.2: `audit_log` table with before/after JSON diffs

### Sprint 2 completion criteria

- [ ] All HIGH accounting findings closed
- [ ] Test count > 500
- [ ] Tag `v1.1.0-sprint2`
- [ ] Sprint report

---

## Sprint 3 — UI/UX + Responsive (target: 2 weeks)

### S3.1 — Mobile card-fallback [CRITICAL mobile]

Findings: F-010, F-026, F-027, F-028, F-032

- [ ] Create `components/DataCardList.js` — card-per-row pattern for `< sm` breakpoint
- [ ] Migrate `/deliveries` page table → card fallback
- [ ] Migrate `/sales` page table → card fallback
- [ ] Migrate `/invoices` page table → card fallback
- [ ] Full-width action buttons inside cards (44px+ touch target)
- [ ] Regression test against 375px viewport (Playwright or visual snapshot)

### S3.2 — Mobile quick wins [HIGH]

Findings: F-029, F-031, F-033, F-034, F-035

- [ ] `app/layout.js:13-14` — remove `maximumScale: 1, userScalable: false`
- [ ] `globals.css` — add `html, body { overflow-x: hidden }`
- [ ] Bump `.data-table .btn-sm` padding to `10px 12px; min-height: 40px`
- [ ] Remove `minWidth: '200px'` from `invoices/page.js:68` and `sales/page.js:575`
- [ ] `DetailModal.close` padding 4px → 12px
- [ ] Remove `maxWidth: '200px'` ellipsis on deliveries items cell at mobile
- [ ] `CancelSaleDialog` — stack bonus-choice blocks vertically at `< sm`, 44px radio pills, 3-row textarea, sticky footer

### S3.3 — Mobile top-bar component [HIGH]

- [ ] `components/MobileTopBar.js` — 48px sticky, hamburger + page title + role badge
- [ ] Replace floating `.mobile-toggle`
- [ ] Accessibility: `<header role="banner">`

### S3.4 — /summary page cleanup [HIGH]

Findings: F-019, F-020, F-021, F-022

- [ ] Fix `lastMonth` preset January edge case (app/summary/page.js:135-137)
- [ ] Add `aria-label` + text fallback to chart components
- [ ] Demote voice input card below P&L
- [ ] Explicit error UI with retry button (not silent empty-state)

### S3.5 — /sales bugs [HIGH]

- [ ] WhatsApp share payment label fix (`sales/page.js:767`) — map from actual radio values
- [ ] Address-required on new client — actually enforce submit-time
- [ ] Form collapse-by-default for admin/manager

### S3.6 — /users + /settings confirmation gates [HIGH]

Findings: F-017

- [ ] Wrap `handleSaveSettings` (`users/page.js:76-79`) in `ConfirmModal`
- [ ] Wrap `handleToggle` (`:65-68`) in `ConfirmModal`
- [ ] Wrap `/settings` VAT rate save in `ConfirmModal`

### S3.7 — Accessibility pass [MEDIUM bulk]

- [ ] Extend `useSortedRows` to emit `aria-sort` + `role="columnheader"`
- [ ] Add `htmlFor`/`id` pairs on all custom `SmartSelect` wrappers
- [ ] Focus trap on `/settlements` drill-down modal
- [ ] Full-page skeleton loaders on `/summary`, `/sales`, `/deliveries`, `/clients`, `/invoices`

### Sprint 3 completion criteria

- [ ] Mobile MVP usable on 360px viewport
- [ ] `useSortedRows` emits `aria-sort` everywhere
- [ ] Tag `v1.1.0-sprint3`
- [ ] Sprint report

---

## Sprint 4 — Architecture (target: 1.5 weeks)

### S4.1 — F-048: split lib/db.js [CRITICAL, L]

- [ ] Create `lib/db/` directory
- [ ] Move: `_client.js` (withTx, generateRefCode, sql), `_migrations.js` (initDatabase), `sales.js`, `purchases.js`, `clients.js`, `payments.js`, `settlements.js`, `profit-distributions.js`, `deliveries.js`, `bonuses.js`, `summary.js`, `products.js`, `suppliers.js`, `users.js`, `invoices.js`, `aliases.js`
- [ ] `lib/db/index.js` barrel re-export for backwards compat
- [ ] Delete `lib/db.js` shim only after all callers updated
- [ ] Each file gets its own test file under `tests/real-db/`

### S4.2 — F-054: migration runner [HIGH]

- [ ] Add `schema_migrations(version, ran_at, checksum)` table
- [ ] `scripts/migrate.mjs` — reads `scripts/migrations/v1-1/NNN-*.sql` in order, records versions, fails loudly
- [ ] Remove duplicate migrations from `initDatabase`
- [ ] Pretest check: `SELECT current_version FROM schema_migrations` matches expected

### S4.3 — F-055: profit_distribution parent/child schema [CRITICAL]

(Phase B of S1.6)

- [ ] Create `profit_distribution_groups(id, base_period_start, base_period_end, base_amount, created_by, created_at, updated_by, updated_at)` parent with `UNIQUE (base_period_start, base_period_end)` partial index
- [ ] Create `profit_distribution_recipients(group_id FK, username, percentage, amount)` child
- [ ] Migration from existing table
- [ ] Update `addProfitDistribution` / `getProfitDistributions` / UI
- [ ] Tests

### S4.4 — F-050 + F-052: addPayment transactional + payment void [HIGH]

- [ ] Make `addPayment` go through `applyCollectionInTx` when `saleId` is provided
- [ ] Replace payments DELETE with void-via-negative-insert inside withTx
- [ ] Tests for both

### S4.5 — F-056: entity_aliases unique + move autoLearn [HIGH]

- [ ] Add `UNIQUE (entity_type, normalized_alias)` index on `entity_aliases`
- [ ] Move `autoLearnFromHistory()` out of `initDatabase`
- [ ] Admin-triggered rebuild endpoint `POST /api/admin/rebuild-aliases`

### S4.6 — F-077: enable checkJs [HIGH]

- [ ] Update `jsconfig.json` with `checkJs: true, strict: false`
- [ ] `npx tsc --noEmit` — fix the cascade
- [ ] Add `"typecheck": "tsc --noEmit"` to CI

### S4.7 — F-057 + F-068: unified api-auth + api-errors [MEDIUM]

- [ ] Create `lib/api-auth.js` exporting `requireAuth(request, roles?)` → throws `ApiAuthError` on failure
- [ ] Create `lib/api-errors.js` exporting `apiError(err, fallback)` + `ApiUserError` class
- [ ] Refactor every route to use them (mechanical change)

### S4.8 — F-072: lib/env.js boot validation [MEDIUM]

- [ ] Zod-validate `POSTGRES_URL`, `NEXTAUTH_SECRET` (min 32), `GROQ_API_KEY` (optional), `ALLOW_DB_RESET` at boot
- [ ] Import at the top of `lib/db/_client.js` and `lib/auth.js`
- [ ] Fail at boot instead of in a request

### S4.9 — F-073: .env.example refresh [LOW]

- [ ] Add `GROQ_API_KEY`, `POSTGRES_URL_NON_POOLING`

### Sprint 4 completion criteria

- [ ] lib/db.js split done, old file deleted
- [ ] Migration runner operational
- [ ] Profit_distribution parent/child live
- [ ] checkJs enabled in CI
- [ ] Tag `v1.1.0-sprint4`
- [ ] Sprint report

---

## Sprint 5 — Hardening + Tests + Observability (target: 1 week)

### S5.1 — Global invariants test suite [CRITICAL]

Findings: F-036, F-037, F-040

- [ ] `tests/invariants/global-invariants.test.js` — runs all 15 invariants (INV1-INV15 in study §1.7 + §4.3)
- [ ] `tests/invariants/profit-distribution-solvency.test.js` — the 4 tests in F-036
- [ ] `scripts/invariants.sql` — user-runnable standalone

### S5.2 — Money-function coverage [HIGH]

- [ ] `tests/real-db/update-delivery-confirm.test.js` — real SQL, not mocks (F-039)
- [ ] `tests/real-db/apply-collection-fifo.test.js` (F-038/new)
- [ ] `tests/real-db/cancel-sale-reversal.test.js` — invariant assertions
- [ ] `tests/real-db/summary-reconciliation.test.js` — P&L identity
- [ ] One test each for 10 untested money functions: `deletePurchase`, `addExpense`, `deleteExpense`, `cancelDelivery`, `voidInvoice`, `updateSale`, `updatePurchase`, `updateExpense`, `previewCancelSale`, `commitCancelSale`

### S5.3 — Concurrency tests [HIGH]

Findings: F-045

- [ ] `tests/concurrency/apply-collection-race.test.js`
- [ ] `tests/concurrency/collection-vs-cancel.test.js`
- [ ] `tests/concurrency/profit-distribution-race.test.js`
- [ ] `tests/concurrency/delivery-confirm-race.test.js`

### S5.4 — Authz matrix test [HIGH]

Findings: F-047

- [ ] `tests/authz/route-matrix.test.js` — data-driven POST to every write route with (anon|seller|driver|manager|admin), assert HTTP status matrix
- [ ] `tests/authz/cross-user.test.js` — seller A cannot edit seller B's sales

### S5.5 — Idempotency + keys [HIGH]

Findings: F-046

- [ ] `tests/resilience/idempotency-keys.test.js`
- [ ] Add `Idempotency-Key` header support on `POST /api/sales`, `POST /api/profit-distributions`, `PUT /api/deliveries(confirm)`

### S5.6 — Observability [HIGH]

Findings: F-062, F-063, F-064

- [ ] Create `audit_log(id, timestamp, actor_username, actor_role, action, entity_type, entity_id, before_json, after_json, request_id, ip)`
- [ ] `recordAudit(client, ...)` helper called inside every `withTx`
- [ ] Adopt `pino` as a minimal structured logger (inject `request_id` via middleware)
- [ ] Replace every `console.error` in `app/api/`
- [ ] `GET /api/health` returning `{ ok, db_latency_ms, migration_version }`

### S5.7 — Coverage gate [MEDIUM]

- [ ] `tests/coverage-gate.test.js` — enumerates `lib/db/` exports, fails if a new export is added without a whitelist entry

### Sprint 5 completion criteria

- [ ] Test count > 700 (from 436)
- [ ] All cross-table invariants green in CI
- [ ] Observability operational
- [ ] Tag `v1.1.0-sprint5`
- [ ] Sprint report

---

## Final v1.1.0 release checklist

- [ ] All sprint completion criteria met
- [ ] All findings closed (or explicitly deferred to v1.2 with rationale below)
- [ ] Test count target: 700+
- [ ] All financial functions covered
- [ ] All cross-table invariants asserted in CI
- [ ] CI/CD operational with branch protection
- [ ] Mobile passes on iPhone SE (375), Pixel 5a (390), Galaxy A14 (360), iPhone 15 Pro Max (430)
- [ ] Production smoke test passes
- [ ] User acceptance test on staging
- [ ] `CHANGELOG.md` full v1.1 entry
- [ ] `PROJECT_DOCUMENTATION.md` updated
- [ ] `README.md` feature list updated
- [ ] `docs/v1-1-comprehensive-study.md` findings annotated CLOSED with commit SHAs
- [ ] `docs/v1.1.0-release-notes.md` created
- [ ] `docs/delivery-handoff.md` updated with v1.1 procedures
- [ ] Tag `v1.1.0`
- [ ] Push tag

## Findings deferred to v1.2 (require explicit user approval)

- **F-058 (correlation IDs in logs)** — partially covered by Sprint 5 pino work. Full coverage deferred.
- **F-074, F-075, F-076 (dead code / BUG-xxx comment migration)** — cosmetic, low value.
- **Full `/admin/audit` UI page** — Sprint 5 adds the table + logger; the UI page is v1.2.
- **Drivers-only PWA shell** — deferred.
- **Swipe gestures on mobile cards** — deferred.
- **Full TypeScript conversion of `lib/db/*`** — Sprint 4 enables `checkJs` only.
- **Voice-path normalizer improvements from backlog** — out of scope.
- **Dashboard widget overhaul / tabbed summary cards** — v1.2.
- **i18n / non-Arabic rendering** — v1.2.
- **Pagination primitive for tables past ~500 rows** — v1.2.

## Open questions for user

1. **S1.1 Neon branch creation.** The guard fix (autonomous) will refuse to run tests against the production branch. But the user needs to actually create a `test-sandbox` Neon branch via the Neon console, rotate `neondb_owner` credentials, and update `.env.test`. Otherwise Sprint 1 tests cannot run.
2. **S1.8 settlements enum collapse.** Removing `profit_distribution` from `SETTLEMENT_TYPES` will reject legacy API clients that still POST it. Is there any external integration posting settlements? (If yes: keep the enum value but make the code path a no-op redirect.)
3. **S2.3 bonus accrual strategy.** Option A (move accrual to collection) vs Option B (keep accrual, exclude unearned from cash-basis P&L). Study recommends B for simplicity. Confirm?
4. **S4.3 profit_distribution schema refactor.** Migration strategy: (a) parallel tables + cutover switch, (b) rename + recreate. Recommend (a) for safety.
5. **F-071 credentials rotation.** The `neondb_owner` password `npg_REDACTED_v1_1_rotated` is visible in `.env.test` on this dev machine. Was `.env.test` ever committed before `.gitignore` was tightened? User must check `git log -p -- .env.test` and rotate if so.

## Stop conditions (overall)

- TODO.md drifts from actual work → STOP, reconcile
- Test suite drops below previous count → STOP, investigate
- Any CRITICAL fix introduces a new CRITICAL → STOP, report
- Schema migration fails on test branch → STOP, do not retry on production
- Vercel deploy fails 3× in a row → STOP, investigate
- Production smoke test fails → STOP, do not rollback without user approval
- User asks to stop → STOP immediately, leave clean state

---

**Last updated:** 2026-04-15 by Claude (initial scaffold)
