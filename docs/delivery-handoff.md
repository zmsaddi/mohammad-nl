# Vitesse Eco v1.0.0 — Delivery Handoff Guide

| | |
|---|---|
| **Version** | `v1.0.0` |
| **Production URL** | https://mohammadnl.vercel.app |
| **Test coverage** | 518+ assertions verified |
| **Primary docs** | [README.md](../README.md), [PROJECT_DOCUMENTATION.md](../PROJECT_DOCUMENTATION.md), [SETUP.md](../SETUP.md), [CHANGELOG.md](../CHANGELOG.md), this file, [v1.1-backlog.md](v1.1-backlog.md) |

---

## Pre-handoff verification (Claude Code completed ✅)

- [x] All sessions 1–10 complete
- [x] 386 unit tests passing (32 files)
- [x] Production build green (`npm run build`)
- [x] Vercel deploy healthy
- [x] Production smoke (`/` → 307, `/api/auth/csrf` → 200)
- [x] 8 pre-delivery bugs resolved (BUG 1–6 + Bug 1/Bug 3 from HAR)
- [x] Cancel rule locked + 11 regression tests (full 4×2 matrix)
- [x] Bonus eligibility verified at 100 operations
- [x] Idempotency hotfix shipped + tested (Session 8)
- [x] Accountant compliance confirmed (Path A, 2026-04-14)
- [x] Documentation complete (7 markdown files)
- [x] v1.1 backlog catalogued (32 items across 9 sections)
- [x] DB cleanup script prepared (USER-EXECUTED, not auto-run)
- [x] `v1.0.0` tag created and pushed

---

## USER ACTION ITEMS — 8 steps before customer go-live

**Estimated total: 2–4 hours** depending on real data volume.

### Step 1 — DB cleanup (10 minutes)

The production DB contains test data from Phase 0 / Phase 0.5 / Phase B
runs. Wipe it before entering real customer data.

1. Open https://console.neon.tech and select the Vitesse Eco project.
2. **Click Branches → Create snapshot** (safety backup — your insurance
   policy before any delete).
3. Click **SQL Editor**.
4. In this repo, open
   [scripts/cleanup/v1-pre-delivery-cleanup.sql](../scripts/cleanup/v1-pre-delivery-cleanup.sql).
5. Copy the entire file → paste into the Neon SQL Editor.
6. Click **Run**.
7. Review the verification table at the bottom of the output:
   - Every business table should show `remaining: 0`
   - `users` should show `remaining: 1` (admin only)
8. If correct, the `COMMIT;` at the bottom already persisted the delete.
9. If anything looks wrong, restore from the Step 2 snapshot via Neon.

**Dry-run mode:** change `COMMIT;` at the end of the SQL to `ROLLBACK;`
to see what would be deleted without persisting.

### Step 1.5 — Run the v1.0.1 supplier credit migration (2 minutes)

v1.0.1 added `purchases.paid_amount`, `purchases.payment_status`, and
the `supplier_payments` audit table (Feature 6). The initDatabase()
block in `lib/db.js` applies the same schema changes automatically on
the next deploy, but running the manual migration first makes the
schema state explicit and idempotent.

1. Stay in the Neon SQL Editor from Step 1.
2. In this repo, open [scripts/migrations/2026-04-15-supplier-credit.sql](../scripts/migrations/2026-04-15-supplier-credit.sql).
3. Copy the entire file → paste into the SQL Editor → Run.
4. Review the verification block at the bottom — it prints the new
   columns on `purchases`, confirms `supplier_payments` exists, and
   shows the payment_status distribution on any pre-existing rows.
5. The script is **idempotent** — every ALTER uses `IF NOT EXISTS`
   and every backfill checks zero-state before writing, so running
   it twice is safe.

After this step, the supplier-credit UI on `/purchases` is fully
operational (paid amount field on the form, status column on the
list, and the 💰 دفع button on partial/pending rows).

### Step 1.6 — Run the v1.0.2 profit distribution migration (2 minutes)

v1.0.2 added the `profit_distributions` table (Feature 2). Same
pattern as Step 1.5: idempotent, mirrored in `initDatabase()` for
fresh deploys, provided as a manual SQL file for existing production
DBs.

1. Stay in the Neon SQL Editor.
2. Open [scripts/migrations/2026-04-15-profit-distributions.sql](../scripts/migrations/2026-04-15-profit-distributions.sql).
3. Copy the file → paste → Run.
4. Verify via the embedded `information_schema` queries — the
   `profit_distributions` table and its three indexes should appear.
5. Running the file twice is safe (`CREATE TABLE IF NOT EXISTS` +
   `CREATE INDEX IF NOT EXISTS`).

After this step, the `/profit-distributions` admin page is fully
operational. Only users with `role='admin'` can create a
distribution; managers can view history.

### Step 2 — Admin password rotation (5 minutes)

The default `admin / admin123` must be rotated before exposing the
system to real users.

1. Login at https://mohammadnl.vercel.app as `admin / admin123`.
2. Navigate to `/users`.
3. Click **edit** on the admin row.
4. Set a strong password:
   - Minimum 16 characters
   - Mix of uppercase, lowercase, numbers, symbols
   - Not reused from another account
5. Click **save**.
6. **Write the new password down in a password manager** — there is
   no automated reset flow in v1.0.
7. Logout.
8. Login with the new password to verify.

### Step 3 — Verify Vercel environment variables (10 minutes)

Open the Vercel dashboard for the project. **Settings → Environment
Variables**. Verify all of the following exist and are scoped to the
**Production** environment:

| Variable | Format | Notes |
|---|---|---|
| `NEXTAUTH_SECRET` | 32+ random chars | Generate fresh via `openssl rand -base64 32` if in doubt |
| `NEXTAUTH_URL` | `https://mohammadnl.vercel.app` | Exact, no trailing slash |
| `POSTGRES_URL` | `postgres://...` | Pooled connection from Neon |
| `POSTGRES_URL_NON_POOLING` | `postgres://...` | Direct connection from Neon |
| `GROQ_API_KEY` | `gsk_...` | Required for voice flows |

If any are missing or pointed at staging, update and trigger a
redeploy from the Vercel dashboard.

### Step 4 — Verify Neon backup retention (5 minutes)

1. Open the Neon dashboard for the project.
2. **Settings → Storage tab**.
3. Verify "Restore" shows **7-day retention** enabled.
4. **(Recommended, once)** Test a restore on a throwaway branch:
   - Branches → Create branch
   - Source: *"head of main 6 hours ago"*
   - Verify the branch creates successfully and contains data
   - Delete the throwaway branch after verification

### Step 5 — Real data entry (1–3 hours)

Now populate the production DB with real business data.

#### 5a. Settings (15 minutes)

Navigate to `/settings`. Enter:

- **Company info** — SIRET, SIREN, APE code, TVA number (intracom)
- **Capital social**, RCS registration details
- **IBAN, BIC** for bank-transfer invoices
- **Bonus rates per role**:
  - Seller bonus per sale (default 10€)
  - Seller upsell percentage (default 50% of the over-recommended margin)
  - Driver bonus per delivery (default 5€)
- **VAT rate:** 20% (France)

These drive the invoice PDF `mentions légales` + the `calculateBonusInTx`
formulas.

#### 5b. Stock (30–60 minutes for ~31 products)

Navigate to `/stock`. For each product:

- Name (e.g. `V20 Pro`)
- Category (e.g. `دراجات كهربائية`)
- Buy price (cost)
- Sell price (recommended — the seller's floor)
- Initial stock quantity
- Low-stock alert threshold (per-product, default 3)

**Tip:** voice input (`/sales` page mic button) speeds Arabic product
name entry. Assist mode always shows the review dialog — verify before
save.

#### 5c. Pre-existing clients (~15–30 min, if any)

Only enter clients that exist **before** go-live with their current
outstanding balances. Use voice or manual entry.

#### 5d. Pre-existing suppliers (~10–20 min, if any)

Same approach.

#### 5e. Users (10 minutes)

Navigate to `/users`. Add an account for each real staff member:

- Each seller → `role: seller`
- Each driver → `role: driver`
- Each manager → `role: manager`
- Set a temporary initial password per user; tell each user their
  password in person and have them rotate it on first login.

### Step 6 — Staff training (~45 minutes total)

Cover these topics verbally with each role:

#### Admin training (~25 min)

- Dashboard interpretation (accrual vs cash-basis P&L, pending
  collections widget, low stock alerts, top sellers widget, supplier
  performance with total/paid/remaining)
- Sales lifecycle: create → confirm → collect → optionally cancel
- **Cancel rule** — admin can cancel anything including confirmed;
  manager and seller can only cancel reserved sales
- Settlements: pay accumulated bonuses to seller/driver users (with
  v1.0.1 amount validation + drill-down + auto-fill)
- **Profit distribution** (v1.0.2): `/profit-distributions` page.
  Enter a base amount (optionally auto-fill from collected revenue
  for a date range), pick admin/manager recipients, assign
  percentages that must sum to 100%. Only admin can create; manager
  can view.
- **Supplier credit** (v1.0.1): leave "المدفوع الآن" blank for full
  payment, or enter a partial amount to create a credit purchase.
  Use the 💰 دفع button on the list to record subsequent payments.
- User management
- **Invoice PDF** — now stamped with the official company stamp
  (`public/stamp.png`) instead of text signatures. Prints on a
  single A4 page for typical 1–5 line-item invoices. **Verify
  visually** on the first real sale: open the PDF, press Ctrl+P,
  confirm one page + stamp visible.

#### Seller training (~15 min)

- Login + dashboard
- Create a sale (cash, credit `آجل`, mixed with `downPaymentExpected`)
- Voice input — **always review before save, never autopilot**
- View own accrued bonuses on `/my-bonus`
- Cancel own **reserved** sales (cannot cancel confirmed sales,
  cannot cancel other sellers' sales)
- Cannot see other sellers' bonus details

#### Driver training (~10 min)

- Login + `/deliveries`
- Confirm a delivery: enter VIN, collect the down payment
- The amount shown on the delivery confirm dialog is **display-only**
  — it's what to collect now, not an editable field
- View own accrued bonuses on `/my-bonus`
- **Cannot cancel anything** — routes block drivers entirely

### Step 7 — First real sale under supervision (~15 minutes)

Walk through one real customer sale end-to-end with the customer
present:

1. **Seller creates the sale** (pick cash / credit / mixed)
2. **Driver confirms delivery** and collects the down payment
3. **Generate invoice PDF** — verify all fields:
   - Company block (SIRET, SIREN, IBAN, BIC, TVA number)
   - Client name, phone, address
   - Item description and VIN
   - Total, TVA breakdown (`total / 6` for 20% French rate)
   - Payment state badge (`EN ATTENTE` / `PARTIELLE` / `PAYÉE`)
   - No client signature block (v1.0 removed it per user request)
4. **Verify the customer receives the invoice** as expected
5. **Check dashboard totals** updated as expected

If anything looks wrong, document immediately and investigate before
the next sale.

### Step 8 — 48-hour monitoring window

For the first 48 hours of real production use:

- **Every 6 hours during business hours:** open
  https://vercel.com/[your-team]/[project]/logs and filter for
  `ERROR` level. Any 500 errors → investigate.
- **Watch for user-reported issues** and log them to
  [docs/v1.1-backlog.md § 6 Post-launch discoveries](v1.1-backlog.md).
- **Verify dashboard totals daily** against expected business flow
  (count sales, check against paper receipts).

After 48 hours of clean operation, normal monitoring cadence (see
"Production runbook" below) is sufficient.

---

## Production runbook

### Daily operations

**Morning check (5 min):**

- Open `/summary`
- Scan KPIs: sales today, pending collections, low-stock alerts
- Look for stuck deliveries (status `قيد الانتظار` older than 24h)

**Throughout the day:**

- Sellers create sales (manual or voice)
- Drivers confirm deliveries and collect down payments
- Admin records partial payments via `/clients/[id]` as customers pay

**End of day (optional, 10 min):**

- Review today's P&L
- Note unusual activity for the morning check tomorrow

### Weekly operations

**Pending collections review (15 min):**

- `/clients` → filter "has debt"
- Follow up on aging accounts via WhatsApp (share buttons exist on
  sale rows) or phone

**Bonus settlements (10 min, if applicable):**

- `/settlements` page
- Pay accumulated bonuses to each seller/driver per business cadence
- **v1.0 known limitation:** no upper-bound validation yet; verify
  the amount matches the `بونص مستحق` table above the form before
  submitting. v1.1 adds automatic validation (Tier 1, Item 5.2).

### Monthly operations

**Stock take (30 min):**

- Physical count vs `/stock` display
- Adjust any discrepancies via the edit flow

**Accountant report (manual in v1.0):**

- Export via screenshots or direct SQL for now
- v1.1 adds automated FEC export (Item 4.3)

### Quarterly operations

**Backup verification (10 min):**

- Test PITR restore on a throwaway Neon branch
- Confirm 7-day retention is still active

**Security review (30 min):**

- Rotate `NEXTAUTH_SECRET` annually or on suspected leak (see
  [SETUP.md § 9 Secret Rotation](../SETUP.md))
- Review `/users` — deactivate departed staff

---

## Known limitations (share with customer)

Document these for the customer so expectations are aligned:

- **Voice is assist mode only** — every voice entry shows a review
  dialog; user must verify before save. No autopilot.
- **Levantine Arabic dialect** — Whisper accuracy ~70–80% on
  unfamiliar product names; corrections happen in the dialog.
- **Mobile UI** — responsive basics only. A full mobile optimization
  pass is on the v1.1 roadmap (Item 1.9).
- **No offline mode** — requires an internet connection.
- **No push or SMS notifications** — user checks dashboard for updates.
- **No automated backups beyond Neon PITR (7 days)** — manual weekly
  exports are recommended; v1.1 adds S3 backup (Item 4.1).
- **No Sentry error aggregation** — Vercel function logs are the
  only error sink. v1.1 adds Sentry (Item 1.5).
- **French UI not available** — Arabic only in v1.0.
- **Profit distribution (`توزيع أرباح`)** — single-recipient settlement
  rows work today. Multi-recipient percentage split is v1.1 (Item 1.1)
  and is blocked on 7 accountant questions.
- **Filters** — available only on `/sales`, `/clients`, `/deliveries`.
  Remaining 5 list pages get filters in v1.1 (Item 1.2).
- **Settlement upper-bound validation** — no automatic check that
  settlement amount ≤ user's unsettled credit. Admin must verify
  manually in v1.0. v1.1 adds validation as Tier 1 P0 (Item 5.2).
- **Supplier credit** — purchases must be fully paid at creation in
  v1.0. Partial-payment supplier flow is v1.1 (Item 5.6).

---

## Rollback plan

If a critical issue surfaces during the 48-hour monitoring window
or later:

### Soft revert (recommended)

```bash
git log --oneline -20                    # identify the bad commit
git revert <bad-sha>
git push origin master
```

Vercel auto-deploys the revert within 1–2 minutes.

### Hard reset (DESTRUCTIVE — only if no real customer data)

```bash
git reset --hard <good-sha>
git push origin master --force
```

**Only use this if you have confirmed no real customer data exists
that would be lost.**

### DB rollback (if data corruption)

1. Open the Neon dashboard.
2. Restore the database to a pre-incident timestamp via PITR.
3. **Warning:** rewinds ALL data, including legitimate transactions
   that happened in the rollback window.

### Known-good snapshot

- `v1.0.0-rc1` at `fa81300` is the pre-final-sweep tag, available if
  a deep rollback is needed (Session 7 state before the Session 8/9
  comprehensive PR).
- `v1.0.0` is the delivery tag (this session).

---

## Support contacts

Fill in for your context:

- **Technical issues:** _[dev contact email/phone]_
- **Accountant questions:** _[accountant contact]_
- **Customer training:** _[trainer contact]_
- **Hosting issues:** Vercel + Neon dashboards (or _[hosting contact]_)
- **Domain / DNS:** _[registrar contact]_

---

## Sign-off checklist

When the customer accepts delivery:

- [x] Technical delivery complete (Claude Code, Session 10)
- [ ] Step 1 DB cleanup executed
- [ ] Step 2 admin password rotated
- [ ] Step 3 Vercel env vars verified
- [ ] Step 4 Neon backup verified
- [ ] Step 5 real data entered
- [ ] Step 6 staff trained
- [ ] Step 7 first real sale completed
- [ ] Step 8 48-hour monitoring window complete
- [ ] Customer formally accepts delivery

---

## What's next — v1.1

After 1–2 weeks of production usage:

1. **Collect user feedback** and add real-world discoveries to
   [v1.1-backlog.md § 6 Post-launch discoveries](v1.1-backlog.md).
2. **Scope v1.1 Tier 1** (~3–4 days):
   - Settlement amount validation (**P0**, Item 5.2)
   - Sentry monitoring (P1, Item 1.5)
   - Aggregate reporting tests (P1, Item 2.1)
   - Backup strategy (P1, Item 4.1)
3. **Scope v1.1 Tier 2** (~1–2 weeks):
   - Smart user-role linking in settlements (Item 5.3)
   - Auto-fill settlement amount (Item 5.4)
   - Settlement detail drill-down (Item 5.1)
   - Filters on the remaining 5 list pages (Item 1.2)
   - Top sellers dashboard widget (Item 5.5)
4. **Get accountant answers** on the 7 profit-distribution questions
   if v1.1 should include Item 1.1.

See [docs/v1.1-backlog.md](v1.1-backlog.md) for the complete 32-item
roadmap with priorities, effort estimates, and retrospective lessons
learned from the v1.0 development cycle.
