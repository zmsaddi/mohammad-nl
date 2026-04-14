# Pre-Delivery Readiness Checklist

Snapshot of production readiness as of Session 7 (v1.0.0-rc1).

**Current state:** master @ `ab56cec` + Session 7 docs commits,
338 tests passing, production healthy at
https://mohammadnl.vercel.app.

Items marked `[x]` were verified during Session 7. Items marked
`[ ]` require user action on external dashboards or during
Sessions 8/9/10.

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

- [x] master at `ab56cec` + Session 7 hardening commits
- [x] `v1.0.0-rc1` tagged and pushed
- [x] 338 tests passing
- [x] Vercel deploy success (docs-only changes)
- [x] Production smoke: `/` → 307, `/api/auth/csrf` → 200

## Documentation

- [x] [SETUP.md § 8 First-Time Admin Password Rotation](../SETUP.md)
- [x] [SETUP.md § 9 Secret Rotation Procedure](../SETUP.md)
- [x] [SETUP.md § 10 Disaster Recovery (Neon PITR)](../SETUP.md)
- [x] [PROJECT_DOCUMENTATION.md § 14 Error Monitoring and Observability](../PROJECT_DOCUMENTATION.md)
- [x] This checklist exists

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

## Conditional (depends on Sessions 5 / 6)

- [x] **Session 5** — accountant compliance: **Path A confirmed
      on 2026-04-14.** Q1-Q4 approved, documentation-only update
      (see [PROJECT_DOCUMENTATION.md § 15](../PROJECT_DOCUMENTATION.md)).
      No code changes.
- [ ] **Session 6** — voice feature decision: Path A (ship assist-only
      as-is), B (disable button until v1.1), or C (full rework).
      Gated on user voice testing results.
- [ ] **Session 8** — E2E manual smoke tests against production
- [ ] **Session 9** — final documentation sweep before delivery
- [ ] **Session 10** — `v1.0.0` tag + customer handoff

---

## Session 7 findings summary

**Zero blockers.** All auth flow probes returned expected shapes
with proper security headers. Rate limiter is well-scoped for the
10-20 user target deployment. The only critical unknowns are the
five env vars the user must verify on the Vercel dashboard (marked
above).

**One small code change shipped:** Session 7 hardening comment block
on the voice rate limiter. No behavior change.

**Three documentation additions:** Admin rotation, secret rotation,
disaster recovery (SETUP.md); error monitoring (PROJECT_DOCUMENTATION.md);
this checklist (docs/pre-delivery-checklist.md).

**Release candidate:** `v1.0.0-rc1` tagged and pushed.
