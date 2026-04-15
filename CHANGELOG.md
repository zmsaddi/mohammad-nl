# Changelog

All notable changes to Vitesse Eco are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

## [v1.0.0] — 2026-04-15

First production release. Delivered after 10 sessions of work covering
architecture, feature development, hardening, and pre-delivery polish.

### Core features

#### Sales & Inventory
- Sales lifecycle: cash (`كاش`), credit (`آجل`), and mixed payment types
  with configurable down payment at delivery time
- Stock management with per-product low-stock alert thresholds
- Atomic sale cancellation with bonus disposition choice (keep/remove)
- FIFO collection walker across multiple open sales per client
- Specific-sale collection with payment method (`كاش` / `بنك`)
- Click-to-sort column headers on all 8 list pages
  ([lib/use-sorted-rows.js](lib/use-sorted-rows.js))
- Filters on `/sales`, `/clients`, `/deliveries` (date range, entity
  search, status, payment status, seller/driver)

#### Cash-basis accounting (FEAT-04)
- Profit recognized only at the moment of payment collection
- Proportional VAT declared per payment received (20% TTC → amount / 6)
- Three-state French SAS-compliant invoices: EN ATTENTE → PARTIELLE → PAYÉE
- Single invoice number per sale, evolving through states
- Dual-view dashboard P&L (accrual + cash-basis simultaneously)
- Pending-collections widget
- Accountant-approved 2026-04-14 (Path A, Q1-Q4 confirmed)

#### Atomic cancellation (FEAT-05)
- Stock restoration on every cancellation
- Negative-amount refund row insertion for confirmed-sale cancellations
- Bonus keep vs remove choice per role (seller + driver)
- BUG-22 settled-bonus protection — cannot reverse already-paid bonuses
- Cancellations audit table with full state snapshot
- **Session 8 idempotency guard** — `cancelSale` throws
  `'الطلب مُلغى مسبقاً'` on double-execution to prevent ledger
  corruption from retry races

#### Roles & permissions
- `admin` — full access, business owner
- `manager` — operational oversight
- `seller` — creates sales, earns sale bonuses on own work
- `driver` — confirms deliveries, earns delivery bonuses

#### Locked business rules

**Bonus eligibility** — seller (sale creator) + driver (delivery
confirmer) only. Admin and manager NEVER earn bonuses, even when
performing the same operations. Enforced at
[lib/db.js calculateBonusInTx](lib/db.js) with strict `role ===
'seller'` / `role === 'driver'` guards. Verified empirically at 100
operations in Phase 0.5 Rule 4.

**Cancel authority matrix** — single source of truth at
[lib/cancel-rule.js](lib/cancel-rule.js):

| Role | `محجوز` (reserved) | `مؤكد` (confirmed) |
|---|---|---|
| admin | ✅ | ✅ |
| manager | ✅ | ❌ |
| seller | ✅ own only | ❌ |
| driver | ❌ | ❌ |

Enforced at both `/api/sales/[id]/cancel POST` and `/api/sales DELETE`,
plus UI button visibility. 11 regression tests at
[tests/cancel-rule-rbac.test.js](tests/cancel-rule-rbac.test.js).

#### Voice-assisted data entry
- Arabic Whisper transcription (`whisper-large-v3`)
- Llama 3.1 8B Instant entity extraction (JSON mode)
- Auto-transliteration of Arabic names to Latin (ALA-LC fallback
  for out-of-dictionary names)
- **Mandatory review dialog** before save — always assist mode,
  never autopilot
- Rate limiting: 10 requests / minute / user

#### Client detail page
- Profile card with financial summary (total sales, paid, remaining debt)
- Payment registration form: amount + method + FIFO / specific-sale
  picker + live TVA preview
- Sales history with status, payment_status, remaining per row
- Payments history with payment_method + linked sale_id columns
- Invoice PDF button per confirmed sale
  ([Item 5a](docs/v1-pre-delivery-study.md))
- Cancel button with role-based visibility via `canCancelSale`
  ([Item 5b](docs/v1-pre-delivery-study.md))
- Sortable columns on both tables

#### Multi-user safety
- `cache: 'no-store'` on every client-side `/api/*` fetch
- Idempotency guards on state-transition mutations (cancel, confirm)
- `FOR UPDATE` row locks on accumulator operations (collect, settle)
- Aggregate reads from sales ledger only — single source of truth
  prevents Bug 3 regression

#### Security
- NextAuth v4 with `__Host-` cookie prefix
- HSTS `max-age=63072000; includeSubDomains; preload`
- Cookies: `Secure` + `HttpOnly` + `SameSite=Lax`
- Zod input validation on all mutation routes (BUG-14)
- Role-based access control at middleware, route, and field level
- Point-in-time DB restore (Neon 7-day retention)

### Bugs resolved during pre-delivery

#### Pre-Phase B (BUG 1-6 hotfixed 2026-04-14)
- **BUG 1** Voice null rejection — schema `nullable()` wrapper around
  every `.optional()` field in [lib/schemas.js](lib/schemas.js)
- **BUG 2** Cache staleness — `cache: 'no-store'` added to every
  client-side `/api/*` fetch (63 sites)
- **BUG 3** (pre-Phase B, distinct from later Bug 3) Dialog click-outside —
  no longer closes data-editing dialogs
- **BUG 4** Submit retry — `try/finally` on form handlers so errors don't
  lock the button; login page proactively hardened with same pattern
- **BUG 5** Latin names — Arabic name auto-transliteration via
  `ensureLatin()` at the DB boundary
- **BUG 6** Required address — new-client sales now require a delivery
  address (addresses missing on legacy clients are still accepted)

#### Phase B (HAR analysis discoveries 2026-04-15)
- **Bug 1** `/clients/[id]` rendered "not found" for every client —
  Next.js 16 `use(params).id` is a string, `c.id` is a number, strict
  equality never matched. One-character `Number(id)` coercion at
  [app/clients/[id]/page.js:37](app/clients/[id]/page.js#L37).
- **Bug 3** `totalPaid > totalSales` — FEAT-04 regression where
  `getClients` aggregate double-counted cash sales (both
  `sum(sales.total)` and `sum(payments.collection)` for the same money).
  Rewrote to read sales ledger only at
  [lib/db.js:1395-1424](lib/db.js#L1395-L1424). Production-verified:
  0 violators after fix. Regression test at
  [tests/clients-aggregate-correctness.test.js](tests/clients-aggregate-correctness.test.js).
- **Bug 2** confirmed **not a bug** — misread of the API contract.
  `withDebt=true` is an enrichment flag, not a filter, per the JSDoc
  at [lib/db.js:1382](lib/db.js#L1382).

#### Audit findings
- **Cancel rule drift** — manager could cancel confirmed sales through
  the pre-Phase B cancel route. Centralized to
  [lib/cancel-rule.js](lib/cancel-rule.js) with 11 regression tests
  covering the full 4×2 matrix plus already-cancelled and null-input
  defensive cases.

### Idempotency hardening (Session 8 Phase 0.5)

- `cancelSale` — throws `'الطلب مُلغى مسبقاً'` on re-execution of a
  committed cancel. Preview mode still allowed so the admin dialog can
  render the "already cancelled" state.
- `updateDelivery` confirm — silent idempotent no-op via the existing
  same-status shortcut at
  [lib/db.js:2141](lib/db.js#L2141). No duplicate payment rows, no
  duplicate bonus generation.
- Verified at 40 operations in stress test Rule 6 (20 double-cancel
  blocked + 20 double-confirm silent no-op, zero bonus doubling).

### Test coverage

- **386 unit tests** (Vitest, 32 files)
- **86 API smoke assertions** ([scripts/smoke-test.mjs](scripts/smoke-test.mjs)),
  16 scenarios against production HTTP
- **46 stress test assertions at 540 operations**
  ([scripts/stress-test.mjs](scripts/stress-test.mjs)), 6 rules:
  sale lifecycle, FIFO collection, cancellation integrity, bonus
  eligibility, concurrent operations, idempotency
- **Bonus eligibility** verified at 100 operations in Rule 4
- **Cancel rule** 4×2 matrix coverage (11 tests) in
  [tests/cancel-rule-rbac.test.js](tests/cancel-rule-rbac.test.js)
- **Aggregate correctness** 4 tests in
  [tests/clients-aggregate-correctness.test.js](tests/clients-aggregate-correctness.test.js)
- **Bug 3 production-verified** live via admin-authenticated probe of
  `/api/clients?withDebt=true` — 0 clients with `totalPaid > totalSales`

**Total production assertions: 518+**

### Accountant compliance

All four compliance questions confirmed by the accountant on
2026-04-14 (Path A):

- **Q1** Cash-basis accounting (profit at full collection) ✅
- **Q2** Proportional TVA per payment received ✅
- **Q3** Single `facture` evolving through three states ✅
- **Q4** Mentions légales complete in current template ✅

See [PROJECT_DOCUMENTATION.md § 15](PROJECT_DOCUMENTATION.md) for the
full audit trail.

### Deferred to v1.1

See [docs/v1.1-backlog.md](docs/v1.1-backlog.md) for the complete
32-item roadmap including:

- Profit distribution system (توزيع أرباح) — multi-recipient
  percentage-based split dialog; blocked on 7 accountant questions
- Settlement enhancements (upper-bound validation, smart user-role
  linking, drill-down details, auto-fill amount)
- Dashboard top-sellers widget (replaces top-clients)
- Supplier credit (purchases on credit with partial payments)
- Filters on remaining 5 list pages
- Sentry error monitoring
- Aggregate reporting test category
- Backup beyond Neon PITR
- 24 other items across technical debt, UI polish, operations,
  and process improvements

## [v1.0.0-rc1] — 2026-04-14

Release candidate. Pre-delivery hardening complete.

- Sessions 1-7 code work: ARC-06 NUMERIC migration, FEAT-04/05 cash-
  basis + atomic cancellation, Session 4 polish, Sessions 5/6 accountant
  + voice documentation, Session 7 hardening
- Three hotfix cycles covering BUG 1-6
- Tagged at `fa81300`

## [Pre-rc development] — 2025-Q4 through 2026-04-13

Initial architecture and feature development. Voice surgical detox,
Zod schema foundation, bonus system, entity resolver, alias learning,
dashboard P&L. Extensive documentation at
[UPGRADE_LOG.md](UPGRADE_LOG.md).
