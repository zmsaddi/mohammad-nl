# Full Clean Instructions — User Execution

These steps must be executed by **you** via the Vercel + Neon
dashboards. Claude Code has completed the repo-side cleanup (Phase 1)
in commit [`bd2e33b`](../../commit/bd2e33b); this document covers the
remote-environment counterparts that Claude Code cannot execute for
you.

**Order matters.** Execute A → B → C in sequence. Step D hands off
to the existing [docs/delivery-handoff.md](delivery-handoff.md) for
customer onboarding.

| Phase | Owner | Status |
|---|---|---|
| Phase 1 — repo cleanup | Claude Code | ✅ done |
| **Phase 2 — infra cleanup (A + B + C below)** | **You** | **~30 min** |
| Phase D — customer onboarding | You + customer | ~2-4 h |

---

## Step A — Vercel cleanup (~15 minutes)

### A.1 — Delete preview deployments

1. Open https://vercel.com/[your-team]/[project]/deployments
2. Filter by **Environment = "Preview"**
3. For each preview deployment older than 7 days:
   - Click the three-dot menu
   - Click **Delete**
   - Confirm
4. **Production deployments: KEEP all** — they are your rollback
   history.

**Why:** preview deployments accumulate on every commit. Cleaning them
reduces clutter and reclaims storage quota.

### A.2 — Verify environment variables

1. **Settings → Environment Variables**
2. For each variable below, verify the **Production** scope chip is
   ticked (not just Preview or Development):

| Variable | Format | Notes |
|---|---|---|
| `NEXTAUTH_SECRET` | 32+ random chars | Regenerate if in doubt: `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://mohammadnl.vercel.app` | Exact, no trailing slash |
| `POSTGRES_URL` | `postgres://...` | **Pooled** connection from Neon |
| `POSTGRES_URL_NON_POOLING` | `postgres://...` | **Direct** connection from Neon |
| `GROQ_API_KEY` | `gsk_...` | Production-tier key, not dev-tier |

3. Remove any test / demo env vars if present (`TEST_*`, `DEMO_*`,
   `STRESS_*`).

### A.3 — Clear build cache

1. **Settings → General → Build & Development Settings**
2. Scroll to the **"Clear Build Cache"** button
3. Click **Clear** and confirm
4. Trigger a fresh deploy (either by pushing an empty commit or by
   clicking **Redeploy** on the latest production deployment)

**Why:** ensures the next deploy builds from scratch with no stale
artifacts from pre-cleanup commits.

### A.4 — Verify domain configuration

1. **Settings → Domains**
2. Verify `https://mohammadnl.vercel.app` is the production domain
3. If you have a custom domain (e.g. `shop.example.com`), verify the
   DNS is correct and the domain is in the "Production" column
4. Remove any test / staging domains if present

### A.5 — Verify auto-deploy settings

1. **Settings → Git**
2. **Production Branch** should be `master`
3. **Auto-deploy** on push: enabled
4. **Preview Branches**: optional — you can disable preview deploys
   entirely if you want to commit straight to master without Vercel
   spinning up per-commit previews.

### A.6 — Verify deployment protection

1. **Settings → Deployment Protection**
2. Production: choose **"Standard Protection"** or whatever matches
   your business need (Vercel Auth / password-protection if the
   customer site is not yet public)
3. Preview deployments: optional protection

---

## Step B — Neon database cleanup (~10 minutes)

### B.1 — Take safety snapshot

1. Open https://console.neon.tech and select the Vitesse Eco project
2. Click the **Branches** tab
3. Click **Create snapshot** (or "Create branch from current state")
4. Name it: `pre-customer-cleanup-2026-04-15`
5. Wait for it to finish

This is your **insurance policy** — Neon's 7-day PITR is the fallback,
but a named snapshot is cleaner to restore from.

### B.2 — Run the cleanup SQL

1. Click the **SQL Editor** tab
2. In this repo, open
   [scripts/cleanup/v1-pre-delivery-cleanup.sql](../scripts/cleanup/v1-pre-delivery-cleanup.sql)
3. Copy the entire file
4. Paste into the Neon SQL Editor
5. Click **Run**
6. Review the verification table at the bottom of the output —
   every business table should show `remaining: 0` except `users`
   which should show `remaining: 1` (admin only)
7. If the counts look correct, the `COMMIT;` at the end has already
   persisted the delete
8. If anything looks wrong: restore from the Step B.1 snapshot

**Dry-run mode:** change the final `COMMIT;` in the script to
`ROLLBACK;` and run the whole file to see what would be deleted
without persisting.

### B.3 — Verify the clean state with a second query

Paste this into the SQL Editor to confirm:

```sql
SELECT
  (SELECT COUNT(*) FROM sales)         AS sales,
  (SELECT COUNT(*) FROM clients)       AS clients,
  (SELECT COUNT(*) FROM products)      AS products,
  (SELECT COUNT(*) FROM suppliers)     AS suppliers,
  (SELECT COUNT(*) FROM payments)      AS payments,
  (SELECT COUNT(*) FROM bonuses)       AS bonuses,
  (SELECT COUNT(*) FROM cancellations) AS cancellations,
  (SELECT COUNT(*) FROM deliveries)    AS deliveries,
  (SELECT COUNT(*) FROM invoices)      AS invoices,
  (SELECT COUNT(*) FROM purchases)     AS purchases,
  (SELECT COUNT(*) FROM expenses)      AS expenses,
  (SELECT COUNT(*) FROM settlements)   AS settlements,
  (SELECT COUNT(*) FROM users)         AS users;
```

Expected: every column returns `0` except `users` which returns `1`.

### B.4 — Verify PITR retention

1. **Settings → Storage** tab
2. Verify **Restore** shows **7-day retention** enabled
3. If it's not enabled, enable it now

### B.5 — Verify connection strings match Vercel env vars

Don't change anything here — just verify consistency between Neon and
Vercel:

1. **Connection Details** panel (Neon dashboard)
2. Confirm both the pooled and the direct connection strings exist
3. They should match the `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING`
   values you verified in Step A.2

If they differ, the Vercel env var is pointing at the wrong Neon
branch and must be updated (go back to Step A.2).

---

## Step C — Production verification (~5 minutes)

After Steps A + B, do a final manual sweep:

1. Open https://mohammadnl.vercel.app
2. Login as admin (with the rotated password from
   [docs/delivery-handoff.md](delivery-handoff.md) Step 2 — or the
   default `admin/admin123` if you're running verification before
   rotation)
3. Navigate to each of these pages and confirm **all are empty**:
   - `/summary` (dashboard) — all KPIs show `0`
   - `/sales` — empty list
   - `/clients` — empty list
   - `/stock` — empty list
   - `/purchases` — empty list
   - `/deliveries` — empty list
   - `/expenses` — empty list
   - `/settlements` — empty list
   - `/invoices` — empty list
4. Navigate to `/users` — should show **only** the admin user. All
   test users (`testseller`, `testdriver`, `stressseller`,
   `stressdriver`, `stressseller2`, `stressmanager`) should be gone.
5. Navigate to `/settings` — bonus rates and company info will be
   empty (you fill these in during the real-data-entry step of the
   customer handoff).

**If any test data still appears**, re-run the cleanup SQL from
Step B.2, or contact the developer.

---

## Step D — Customer onboarding (continues in delivery-handoff.md)

Once Steps A + B + C are complete, the infrastructure is pristine
and you're ready for the **USER ACTION ITEMS** in
[docs/delivery-handoff.md](delivery-handoff.md). The 8-step handoff
sequence begins with the DB cleanup — which you've already done in
Step B.2 of this document — so in practice:

| Handoff step | Status |
|---|---|
| 1. DB cleanup | ✅ done in B.2 |
| 2. Admin password rotation | ⏭️ next |
| 3. Vercel env vars verified | ✅ done in A.2 |
| 4. Neon backup verified | ✅ done in B.4 |
| 5. Real data entry | ⏭️ after rotation |
| 6. Staff training | ⏭️ |
| 7. First real sale under supervision | ⏭️ |
| 8. 48-hour monitoring window | ⏭️ |

So after finishing this doc, you're effectively starting at Step 2
(admin password rotation) of `delivery-handoff.md`, not Step 1.

---

## Rollback safety

If anything goes wrong during Phase 2:

### If DB cleanup looks wrong (Step B.2)

1. Go to Neon Branches tab
2. Click the `pre-customer-cleanup-2026-04-15` snapshot you took in B.1
3. Restore from snapshot
4. Fix the SQL script, or contact the developer
5. Re-run cleanup when ready

### If Vercel deploy breaks after build cache clear (Step A.3)

Option 1 — trigger a new deploy from the Vercel dashboard:

1. Go to Deployments
2. Click the latest production deployment
3. Click **Redeploy**

Option 2 — push an empty commit:

```bash
git commit --allow-empty -m "chore: nudge vercel rebuild"
git push origin master
```

### If you need to roll back to v1.0.0-rc1

The `v1.0.0-rc1` tag exists at [fa81300](../../tree/fa81300) as a
known-good pre-final-sweep snapshot:

```bash
git checkout v1.0.0-rc1
git checkout -b emergency-rollback
git push origin emergency-rollback
# Then in Vercel dashboard: Settings → Git → change Production
# Branch to emergency-rollback, or manually promote the
# v1.0.0-rc1 deployment from Deployments tab
```

This is very unlikely to be needed — `v1.0.0` has been verified at
540 stress ops + 86 smoke assertions + 386 unit tests.

---

## Done

After Phase 2 (this document, Steps A + B + C) and Phase D
([delivery-handoff.md](delivery-handoff.md), Steps 2-8) are complete,
the customer is using Vitesse Eco v1.0.0 in production with real
data. v1.1 planning begins after 1–2 weeks of production usage — see
[docs/v1.1-backlog.md](v1.1-backlog.md).
