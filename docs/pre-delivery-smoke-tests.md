# Pre-Delivery UI Smoke Tests

Phase 0 (API-level smoke tests, 16 scenarios, 86 assertions) was
executed automatically by Claude Code on 2026-04-14 via
[`scripts/smoke-test.mjs`](../scripts/smoke-test.mjs). Full
results: [`docs/smoke-test-phase0-results.json`](smoke-test-phase0-results.json).

**Phase 0 result: ✅ 86 / 86 passed (0 failures).**

This document covers **Phase 1: 9 UI-level scenarios** that
require human execution — visual verification, voice input,
multi-window cache testing, and dialog interaction. Claude Code
cannot execute these.

---

## Current production state

- **URL:** https://mohammadnl.vercel.app
- **Master:** test/session8-smoke branch (pending FF-merge once
  this doc is committed)
- **Test data from Phase 0:** persists in the DB with the `TEST`
  or `Test` prefix. The entire DB will be **TRUNCATED** before
  v1.0 delivery, so pollution is intentional and acceptable.
- **Test users created in Phase 0:**
  - `testseller` / `testpass123` (role: seller)
  - `testdriver` / `testpass123` (role: driver)

---

## Prerequisites

- Logged in as `admin` / `admin123`
- Two browser windows available (regular Chrome + Chrome
  Incognito) for cache tests
- Microphone permission for voice tests
- Optional: mobile device or touch-screen emulator for dialog
  tests

---

## Phase 1 — UI Scenarios

### Scenario 7: Driver sees `to_collect` amount display-only

**Reason it's UI-only:** the amount field must be verified
visually as a `<div>` not an `<input>`, and touch events on
mobile must not allow modification.

**Setup:** a partial sale exists from Phase 0 — use
`TEST V8 Ultra` sold to `Ali Test` (Scenario 4 in the API
script, which was confirmed with `dpe=300`). Or create a fresh
one via `/sales` if Phase 0 data was truncated.

**Steps:**
1. Log out from admin
2. Log in as `testdriver` / `testpass123`
3. Navigate to `/deliveries`
4. Open a pending delivery confirm modal (e.g. on a new
   partial sale seeded by admin)
5. Visual check: the displayed amount is the
   `down_payment_expected`, not `total`
6. Visual check: there is **no input field** for the amount —
   it renders as read-only text
7. Try to modify (should not be possible)

**Expected:**
- Modal shows `المبلغ المطلوب تحصيله الآن: [dpe]`
- No amount input, no edit button, no way to change the amount
- VIN input IS editable (separate field, driver enters it)

**Backend enforcement note:** Phase 0 verified that the PUT
`/api/deliveries` BUG-04 rebuild pattern strips any driver-sent
`paid_amount` from the body. This UI test verifies the
presentation layer matches.

---

### Scenario 15: Invoice PDF — EN ATTENTE pill (pending)

**Reason it's UI-only:** PDF rendering is visual.

**Setup:** a sale with `payment_status='pending'` — create a
fresh reserved sale via `/sales` as admin, or find one from the
Phase 0 run that wasn't delivered (e.g. Scenario 11 was
cancelled, so use S3/S4 residuals if needed).

**Steps:**
1. Navigate to `/invoices` or directly `/api/invoices/[id]/pdf`
2. Download and open the PDF

**Expected:**
- **Yellow `EN ATTENTE` pill** at the top
- **No payments history** table
- **Footer:** `⏳ En attente de règlement — Acompte attendu à la
  livraison : X,XX €`
- All mentions légales present (SIRET, SIREN, APE, TVA, IBAN,
  BIC)

---

### Scenario 16: Invoice PDF — PARTIELLE pill with history

**Setup:** a sale with `payment_status='partial'` and at least
one collection row. Phase 0 S6 created this state on
`Ali Test`'s mixed sale, but S9 then fully paid it. Create a
fresh partial sale:
1. New sale for `Ahmad Test`, `TEST V20 Pro`, qty 1, price 950,
   payment `آجل`, `dpe=300`
2. Confirm delivery (dpe=300 → one collection row, status
   partial, remaining 650)

**Steps:**
1. Generate invoice PDF for this partial sale
2. Open the PDF

**Expected:**
- **Orange `PARTIELLE` pill**
- **Payments history table** with columns: Date / Mode /
  Montant TTC / TVA
- **Footer row:** `Solde restant: X,XX €`
- **State card:** `⚠️ Solde restant : X,XX € — à régler
  ultérieurement`

---

### Scenario 17: Invoice PDF — PAYÉE pill

**Setup:** A fully-collected sale. Phase 0 S5 confirmed the
cash sale and S9 fully collected the mixed sale — either works.

**Steps:**
1. Generate invoice PDF
2. Open the PDF

**Expected:**
- **Green `PAYÉE` pill**
- **Complete payments history** (all collections listed)
- **State card:** `✓ PAYÉE EN INTÉGRALITÉ`
- No `Solde restant` line (or `0,00 €`)

---

### Scenario 21: Voice sale end-to-end

**Reason it's UI-only:** audio input requires microphone +
human speech.

**Steps:**
1. Log back in as admin if needed
2. Click the voice button (floating mic icon)
3. Record clearly: `بعت دراجة لحسن بألف`
4. Wait for VoiceConfirm modal to appear
5. **Verify the review banner is visible** — Session 7b hotfix
   requires it always shown, not conditional
6. **Verify the subtitle** reads `🔬 وضع المساعد التجريبي —
   راجع كل حقل قبل الحفظ`
7. **Click outside the dialog** — verify it stays open
   (Session 7b hotfix)
8. **Press ESC** — verify it stays open
9. Review and correct any fields, fill address (BUG 6 requires
   it for new clients)
10. Click save

**Expected:**
- VoiceConfirm dialog populates with extracted fields
- Dialog cannot be dismissed by backdrop click or ESC
- Client name lands in the DB as `Hassan` or similar Latin
  (BUG-5 `ensureLatin()` at the DB boundary)
- Sale appears in `/sales` list after save
- Backend ensures Latin client name — no need to manually
  transliterate in the dialog

---

### Scenario 22: Voice purchase end-to-end

**Steps:**
1. Click voice button
2. Record: `اشتريت خمس دراجات من Wahid بألفين`
3. VoiceConfirm opens
4. Review fields, save
5. If Wahid is ambiguous (BUG-21), add a phone to disambiguate
   and retry

**Expected:**
- Purchase action extracted
- Supplier name `Wahid` (or approximated Latin)
- Quantity 5, unit price 2000, total 10000
- Purchase appears in `/purchases` list

---

### Scenario 23: Voice expense end-to-end

**Steps:**
1. Click voice button
2. Record: `دفعت مصروف مية يورو للوقود`
3. Review, save

**Expected:**
- Expense action extracted
- Amount ~100
- Category is fuel-related (`وقود` or similar)
- Expense appears in `/expenses` list

---

### Scenario 24: Multi-window cache consistency

**Reason it's UI-only:** requires two real browser windows with
separate cookie jars.

**Setup:** two browser windows logged in as admin (Window A:
regular Chrome, Window B: Chrome Incognito).

**Steps:**
1. In Window A: navigate to `/stock`
2. In Window B: navigate to `/stock` (to prime the page)
3. In Window A: create a new product `TEST CACHE CHECK`
4. In Window B: click the sidebar `/stock` link (do **not**
   hard refresh)

**Expected:**
- Window B shows `TEST CACHE CHECK` immediately on navigation
- Verifies the Session 7b `cache: 'no-store'` hotfix on every
  `/api/*` client fetch

Repeat on `/sales`, `/purchases`, `/clients` for broader
coverage (optional).

---

### Scenario 25: Dialog click-outside + ESC blocking

**Reason it's UI-only:** click + keyboard events require a
real browser.

**VoiceConfirm test:**
1. Click voice button, record any short phrase
2. Wait for VoiceConfirm modal
3. **Click anywhere on the dim backdrop** outside the modal box
4. Verify: modal stays open
5. **Press ESC key**
6. Verify: modal stays open
7. Click the ✓ save button or × cancel button
8. Verify: modal closes as expected

**CancelSaleDialog test:**
1. Navigate to `/sales`, click cancel on a confirmed sale
2. Dialog appears with bonus-choice radios + reason textarea
3. Enter a reason in the textarea
4. **Click the backdrop** → dialog stays open, textarea content
   preserved
5. **Press ESC** → dialog stays open
6. Click `تأكيد الإلغاء` or `رجوع`

**Delivery confirm flow test:**
1. Navigate to `/deliveries`, open confirm on a pending
   delivery
2. Step 1 (amount display): click backdrop → stays open
3. Click `تأكيد ← التالي`
4. Step 2 (VIN entry): type any VIN
5. Click backdrop → stays open, VIN preserved
6. Press ESC → stays open
7. Click `تأكيد` to complete

**Expected across all three:** dialogs only close via explicit
button clicks, never on backdrop or ESC. Text preserved across
accidental backdrop taps.

---

## Results log

Fill in after executing each scenario. Status legend: ✅ pass,
❌ fail, ⚠️ partial pass, ⏭️ skipped.

| # | Scenario | Status | Notes |
|---|----------|--------|-------|
| 7 | Driver `to_collect` display-only | | |
| 15 | Invoice EN ATTENTE pill | | |
| 16 | Invoice PARTIELLE + history | | |
| 17 | Invoice PAYÉE pill | | |
| 21 | Voice sale end-to-end | | |
| 22 | Voice purchase end-to-end | | |
| 23 | Voice expense end-to-end | | |
| 24 | Multi-window cache consistency | | |
| 25 | Dialog click-outside + ESC | | |

---

## What Phase 0 already verified (don't re-test these)

Claude Code's API script verified all 16 back-end scenarios
with 86 assertions — 100% pass rate. You do NOT need to
re-execute any of:

- Entity creation (products, clients, suppliers)
- Sale creation across all three payment types (cash/credit/
  mixed with dpe)
- Delivery confirmation for full cash and partial
- FIFO collection walker across a client's open sales
- Specific-sale collection via `/api/sales/[id]/collect`
- Overpayment rejection with Arabic error
- Cancel reserved sale (stock restored, no refund)
- Cancel confirmed sale + keep bonuses (refund row inserted,
  bonuses survive)
- Cancel confirmed sale + remove bonuses (refund + bonuses
  deleted)
- BUG-22 settled bonus protection blocks cancel
- Dashboard dual-view P&L (accrual + cash-basis structure +
  arithmetic)
- Pending collections widget arithmetic
- P&L cross-check: `grossProfit = revenue - COGS` in both views

See [`smoke-test-phase0-results.json`](smoke-test-phase0-results.json)
for the full assertion list.

---

## Phase 2 (after user executes Phase 1)

When you finish the 9 scenarios:

1. Fill in the **Results log** table above with ✅/❌ for each
2. Report back to Claude Code with the results
3. Claude Code will commit the updated table as Phase 2
4. If all pass → proceed to Session 9 (docs sweep) + Session 10
   (v1.0.0 tag)
5. If any fail → investigate root cause, fix, re-run just the
   failing scenario

---

## Known side effects from Phase 0

These are expected — Phase 0 ran real business logic on
production:

1. **Sales history:** several `TEST`-prefixed sales exist in
   `/sales` with various statuses (confirmed, cancelled,
   partial, paid)
2. **Stock:** `TEST V20 Pro` and `TEST V8 Ultra` have lower
   stock than their initial 10 (decremented by the sales that
   weren't cancelled)
3. **Payments:** collection and refund rows for Ahmad Test and
   Ali Test
4. **Bonuses:** testseller and testdriver have some rows
   marked `settled=true` from the BUG-22 test's settlement
5. **Cancellations audit table:** has multiple entries from
   S11/S12/S13/S14 testing
6. **Settlements:** one settlement row from S14 (amount 1000,
   settled_by=admin, username=testseller)

**All of this gets wiped by the pre-delivery DB TRUNCATE.**
Nothing here affects the customer's go-live state.
