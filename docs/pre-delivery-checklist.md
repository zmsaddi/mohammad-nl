# Pre-Delivery Readiness Checklist

Snapshot of production readiness as of Session 9 (v1.0.0
candidate, pre-tag).

**Current state:** master @ `4bb7b69` (comprehensive PR) + Session 9
docs sweep, **386 unit tests passing**, production healthy at
https://mohammadnl.vercel.app.

**Phase 0 smoke:** 86/86 ✅ (last run 2026-04-15, post-comprehensive-PR).
**Phase 0.5 stress:** 46/46 at 540 ops ✅ (Rule 6 idempotency verified).

Items marked `[x]` are complete. Items marked `[ ]` require user
action (Vercel / Neon dashboards, or Session 10 execution).

---

## Environment (user verifies on Vercel dashboard)

Go to **Vercel → Project `mohammad_nl` → Settings → Environment
Variables** and confirm:

- [ ] `NEXTAUTH_SECRET` is 32+ random chars — NOT a template
      placeholder like `supersecretkey1`, `changeme`, or the value
      from `.env.local.example`. Verify by generating a fresh one
      with `openssl rand -base64 32` if in doubt.
- [ ] `NEXTAUTH_URL` is exactly `https://mohammadnl.vercel.app`
      (no trailing slash, https scheme, matches the current Vercel
      production domain)
- [ ] `GROQ_API_KEY` is present and is production-tier (not dev /
      rate-limited). Format-check alone cannot verify tier —
      confirm from the Groq console.
- [ ] `POSTGRES_URL` points to the production Neon branch (project
      `accounting-db`, branch `main`). This is the **pooled**
      connection URL.
- [ ] `POSTGRES_URL_NON_POOLING` points to the same Neon branch
      via direct (non-pooler) connection. Used for migrations and
      long-running queries.
- [ ] Every env var above is set for the **Production** scope
      (not just Preview or Development). Check the scope chips
      next to each row.

## Auth & security (verified in Session 7)

- [x] `/api/auth/csrf` returns 200 with `csrfToken` JSON field
- [x] `/` returns 307 → `/login?callbackUrl=%2F`
- [x] `http://` → `https://` via 308 permanent redirect
- [x] CSRF cookie has `__Host-` prefix + `HttpOnly` + `Secure` +
      `SameSite=Lax`
- [x] Callback-URL cookie has `__Secure-` prefix + `HttpOnly` +
      `Secure` + `SameSite=Lax`
- [x] `Strict-Transport-Security: max-age=63072000;
      includeSubDomains; preload` (2 years + preload list eligible)
- [x] Rate limiter documented at [app/api/voice/process/route.js:21](../app/api/voice/process/route.js#L21)

## Data safety (user verifies on Neon dashboard)

Go to **https://console.neon.tech → `accounting-db` → branch
`main`** and confirm:

- [ ] Point-in-time restore is enabled
- [ ] Retention window is at least 7 days (Free tier default — upgrade
      to Pro if the business case justifies longer retention)
- [ ] Restore procedure tested on a temporary branch (follow
      [SETUP.md § 10](../SETUP.md) — create a throwaway branch from
      ~1 hour ago, verify schema, delete)
- [ ] Disaster Recovery section in SETUP.md reviewed and understood

## Production state

- [x] master at `4bb7b69` + Session 9 docs sweep
- [x] `v1.0.0-rc1` tagged and pushed (Session 7)
- [x] **386 tests passing** (338 → 371 after Session 8 idempotency hotfix → 386 after Session 9 comprehensive PR)
- [x] Vercel deploy success (latest: v1-prerelease comprehensive PR)
- [x] Production smoke: `/` → 307, `/api/auth/csrf` → 200
- [x] **Phase 0 smoke 86/86** against deployed fix (Session 9 verification)
- [x] **Phase 0.5 stress 46/46** at 540 ops including Rule 6 idempotency (Session 8)

## Documentation

- [x] [SETUP.md § 8 First-Time Admin Password Rotation](../SETUP.md)
- [x] [SETUP.md § 9 Secret Rotation Procedure](../SETUP.md)
- [x] [SETUP.md § 10 Disaster Recovery (Neon PITR)](../SETUP.md)
- [x] [PROJECT_DOCUMENTATION.md § 14 Error Monitoring and Observability](../PROJECT_DOCUMENTATION.md)
- [x] [PROJECT_DOCUMENTATION.md § 15 Accountant Compliance](../PROJECT_DOCUMENTATION.md) (Session 5)
- [x] [PROJECT_DOCUMENTATION.md § 16 Voice Stack Assist Mode](../PROJECT_DOCUMENTATION.md) (Session 6)
- [x] [PROJECT_DOCUMENTATION.md § 3.5 Cancel Rule](../PROJECT_DOCUMENTATION.md) (Session 9)
- [x] [PROJECT_DOCUMENTATION.md § 6.5 Sale Cancellation + Idempotency Guard](../PROJECT_DOCUMENTATION.md) (Sessions 8, 9)
- [x] [PROJECT_DOCUMENTATION.md § 6.6 Bug 3 Aggregate Fix](../PROJECT_DOCUMENTATION.md) (Session 9)
- [x] [PROJECT_DOCUMENTATION.md § 17 v1.0 Pre-Delivery Polish](../PROJECT_DOCUMENTATION.md) (Session 9)
- [x] [docs/v1-pre-delivery-study.md](v1-pre-delivery-study.md) — 7-item scope study with v1.0/v1.1 split
- [x] [docs/pre-delivery-smoke-tests.md](pre-delivery-smoke-tests.md) — Phase 1 UI scenarios (user-executed)
- [x] [docs/smoke-test-phase0-results.json](smoke-test-phase0-results.json) — Phase 0 API smoke results
- [x] [docs/stress-test-results.json](stress-test-results.json) — Phase 0.5 stress results
- [x] This checklist refreshed for Session 9

## Pending (user actions before go-live)

These are operational, not engineering. They happen during Session 10
or in the first day of production use.

- [ ] Admin password rotated from `admin123` to a strong password
      (follow [SETUP.md § 8](../SETUP.md))
- [ ] Real product catalog entered (31 products per the user's list)
- [ ] Real clients entered (if any pre-existing)
- [ ] Real suppliers entered (if any pre-existing)
- [ ] Settings configured:
  - [ ] Bonus values (seller fixed + percentage, driver fixed)
  - [ ] VAT rate (20% France)
  - [ ] Company info (SIRET, SIREN, IBAN, BIC, address, VAT number)
- [ ] Sessions 5, 6, 8, 9, 10 completed
- [ ] Accountant questions answered and integrated
- [ ] Voice feature decision made and implemented

## Session completion status

- [x] **Session 5** — accountant compliance: **Path A confirmed
      on 2026-04-14.** Q1-Q4 approved, documentation-only update
      (see [PROJECT_DOCUMENTATION.md § 15](../PROJECT_DOCUMENTATION.md)).
      No code changes.
- [x] **Session 6** — voice feature decision: **Path A confirmed
      on 2026-04-14.** User tested voice after the Combined
      Hotfix and confirmed working. Ship as assist mode,
      documented in [PROJECT_DOCUMENTATION.md § 16](../PROJECT_DOCUMENTATION.md).
      Zero voice pipeline code changes. VoiceConfirm cleanup
      deferred to v1.1.
- [x] **Session 7** — pre-delivery hardening + `v1.0.0-rc1` tag.
- [x] **Session 8** — Phase 0 smoke (86/86) + Phase 0.5 stress (46/46
      at 540 ops) + idempotency hotfix for `cancelSale` double-execution.
      Full report in [commits master f849fbd → 787234a].
- [x] **Session 9 Phase A** — scope study ([docs/v1-pre-delivery-study.md](v1-pre-delivery-study.md)) +
      clients-trio-bugs investigation.
- [x] **Session 9 Phase B** — comprehensive PR: Bug 1, Bug 3, locked
      cancel rule, filters on 3 pages, sorting on all 8 pages, client
      detail enhancements, invoice signature removal.
      Commit [master 4bb7b69](../../commit/4bb7b69).
- [x] **Session 9 Phase C (this commit)** — docs sweep
      ([PROJECT_DOCUMENTATION.md § 17](../PROJECT_DOCUMENTATION.md),
      README.md features, this checklist refresh).
- [ ] **Session 10** — `v1.0.0` tag + customer handoff (pending user
      Phase 1 UI smoke approval).

## Deferred to v1.1

From [docs/v1-pre-delivery-study.md](v1-pre-delivery-study.md):

- **Item 4 — توزيع أرباح** (profit distribution multi-recipient split
  dialog). Needs accountant review on 7 open business-rule questions
  (SAS tax treatment, base amount definition, retained share, etc.).
  The `profit_distribution` settlement type already exists and accepts
  single-recipient rows today; the gap is the multi-recipient UI.
- **Item 2 — filter completion** on the remaining 5 list pages
  (purchases, expenses, settlements, invoices, stock). Same
  `useSortedRows` + client-side `.filter()` pattern as sales/clients/
  deliveries.
- **Voice pipeline v1.1** recommendations — see
  [PROJECT_DOCUMENTATION.md § 16](../PROJECT_DOCUMENTATION.md).

---

## Session 9 findings summary

**Zero blockers.** The comprehensive pre-delivery PR
([master 4bb7b69](../../commit/4bb7b69)) shipped clean:
386 unit tests green (371 → 386, +15 new idempotency + cancel-rule +
aggregate tests), production build succeeded, Phase 0 smoke re-verified
86/86 against the deployed fix, Bug 3 verified at the API level (zero
clients with `totalPaid > totalSales`), and the locked cancel rule is
enforced at two routes + two UI surfaces via a shared
[lib/cancel-rule.js](../lib/cancel-rule.js) helper.

**Two production bugs fixed:**
- Bug 1 — `/clients/[id]` showed "not found" for every client due to a
  Next.js 16 `use(params).id` string-vs-number mismatch. One-char fix.
- Bug 3 — `getClients` aggregate double-counted cash sales post-FEAT-04.
  Rewrote to read only from the sales ledger. Regression coverage at
  [tests/clients-aggregate-correctness.test.js](../tests/clients-aggregate-correctness.test.js).

**Six UI/UX items shipped:** invoice signature removal, filters on 3
high-value pages, sorting on all 8 list pages, invoice PDF button on
client detail, cancel button on client detail, payments history
enrichment.

**Locked cancel rule** (see § 3.5 of PROJECT_DOCUMENTATION.md) — 11-test
matrix coverage at [tests/cancel-rule-rbac.test.js](../tests/cancel-rule-rbac.test.js).

**Pre-existing test hygiene:** Widened `/^INV-\d{6}-\d{3}$/` regex at
[tests/sale-lifecycle.test.js:222](../tests/sale-lifecycle.test.js#L222)
to `\d{3,}` so the shared test Neon branch's 4-digit invoice counter
(currently at ~1744) no longer cascade-fails Tests 2 + 3.

**Release candidate:** still at `v1.0.0-rc1`. Session 10 will tag
`v1.0.0` after user Phase 1 UI smoke sign-off.
