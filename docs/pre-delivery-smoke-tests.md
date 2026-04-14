# Pre-Delivery Smoke Tests

Execute these 25 scenarios manually on production before the
v1.0.0 tag. Each scenario has setup, steps, and expected outcome.

**Production URL:** https://mohammadnl.vercel.app
**Test executor:** User (manual)
**Results log:** Fill in the table at the bottom after each run
**Target:** all critical scenarios pass (1–17); voice and
cache/dialog scenarios (21–25) can be partial if time-limited.

---

## Prerequisites

- Admin access to production (`admin` / current admin password)
- Ability to create test seller + driver accounts from `/users`
- Secondary browser window (Chrome Incognito) for multi-user tests
- Mobile device for touch-based tests (optional but recommended)
- DB should be in test state (not real customer data). If real
  customer data is already present, prefix all test entity names
  with `SMOKE-` so they can be identified and deleted afterwards.

**Before starting:** note the current test count and the latest
git SHA on master. After smoke tests, if any scenario requires
a code change, the test count and SHA will both change.

---

## Admin Flows (4 scenarios)

### Scenario 1: Admin creates product + client + supplier

**Setup:** Logged in as admin. Empty or test-only DB.

**Steps:**
1. Navigate to `/stock`, click the "إضافة منتج" button (or
   similar) and create a product `SMOKE V20 Pro`:
   - category: دراجات كهربائية
   - buy_price: 600
   - sell_price: 950
   - stock: 5
2. Navigate to `/clients`, create a client `SMOKE AHMAD`:
   - name: `Ahmad Smoke` (Latin — BUG 5 hint)
   - phone: `+31600000001`
   - address: `123 rue de Paris, 75001 Paris`
3. Navigate to `/purchases`, type a new supplier in the supplier
   field: `Wahid Smoke` (Latin), phone: `+31600000002`.
   Don't submit the purchase yet — just verify the supplier
   auto-create path works.

**Expected:**
- Product appears in `/stock` list with stock = 5
- Client appears in `/clients` with the Latin name and address
- Supplier is auto-created and available in the dropdown on
  subsequent loads of `/purchases`

**Pass criteria:** all 3 entities visible without hard refresh.

---

### Scenario 2: Admin creates cash sale (full payment at creation)

**Setup:** Products and clients exist from Scenario 1.

**Steps:**
1. Navigate to `/sales`, click "إنشاء بيع جديد"
2. Select client `Ahmad Smoke` (should auto-fill phone + address)
3. Select product `SMOKE V20 Pro`
4. Quantity: 1, unit price: 950
5. Payment type: `كاش`
6. `down_payment_expected` should auto-fill to 950 (full total)
7. Submit

**Expected:**
- Sale created with `status='محجوز'`, `payment_status='pending'`
- Stock decreases from 5 to 4
- A linked delivery row is auto-created with
  `down_payment_expected = 950`
- NO payments row yet (driver hasn't confirmed delivery)

**Pass criteria:** sale visible in `/sales`, stock updated
without hard refresh, no payment row.

---

### Scenario 3: Admin creates credit sale (آجل, no down payment)

**Setup:** Stock = 4.

**Steps:**
1. New sale: client `Ahmad Smoke`, product `SMOKE V20 Pro`,
   qty 1, price 950, payment type `آجل`
2. `down_payment_expected` should auto-fill to 0
3. Submit

**Expected:**
- Sale created, stock = 3, `payment_status='pending'`
- NO payments row yet
- Delivery row has `down_payment_expected = 0`

**Pass criteria:** sale visible, stock = 3, `dpe = 0`.

---

### Scenario 4: Admin creates mixed sale (cash with partial dpe)

**Setup:** Stock = 3.

**Steps:**
1. New sale: client `Ahmad Smoke`, product `SMOKE V20 Pro`,
   qty 1, price 900, payment type `كاش`
2. Override `down_payment_expected` to 300 (not 900)
3. Submit

**Expected:**
- Sale created, stock = 2
- `down_payment_expected = 300`
- After delivery confirm: `paid_amount = 300`, `remaining = 600`,
  `payment_status = 'partial'`

**Pass criteria:** sale visible, dpe is 300 not 900.

---

## Driver Flows (3 scenarios)

### Scenario 5: Driver confirms delivery — full cash sale

**Setup:** Login as driver (test driver account). Scenario 2
sale is pending delivery.

**Steps:**
1. Navigate to `/deliveries`
2. Find the Scenario 2 sale
3. Click "تأكيد التوصيل"
4. The modal shows `المبلغ المطلوب تحصيله الآن: 950€`
5. Driver **cannot edit the amount** — verify the field is
   display-only (no input, no edit button)
6. Complete the confirmation flow (enter VIN if bike category
   triggers the VIN prompt)

**Expected:**
- Sale status → `مؤكد` (confirmed)
- `payment_status` → `paid`
- `remaining` → 0
- A payments row inserted with `type='collection'`,
  `payment_method='كاش'`, `amount=950`, `tva_amount≈158.33`
  (approximately 950/6)
- Seller and driver bonus rows created (amounts depend on
  settings)

**Pass criteria:** invoice generated, payment row exists with
correct TVA, driver never saw an editable amount field.

---

### Scenario 6: Driver confirms delivery — partial sale (dpe=300)

**Setup:** Login as driver, Scenario 4 sale is pending delivery.

**Steps:**
1. Navigate to `/deliveries`, find Scenario 4 sale
2. Click "تأكيد التوصيل"
3. Modal shows `المبلغ المطلوب تحصيله الآن: 300€`
4. Below the amount: `المتبقي بعد هذه الدفعة: 600` (hint)
5. Complete confirmation

**Expected:**
- `payment_status` → `partial`
- `paid_amount = 300`
- `remaining = 600`
- One payments row for 300 with `type='collection'`,
  `tva_amount≈50`

**Pass criteria:** partial status, correct remaining, one
payment row with correct TVA.

---

### Scenario 7: Driver sees only to_collect amount

**Setup:** Any pending sale with a known `down_payment_expected`
different from `total`.

**Steps:**
1. As driver, open confirm modal on the sale
2. Verify the amount shown is `down_payment_expected`, not
   `total`
3. Try to modify the amount field (should not be possible —
   it's a display div, not an input)
4. (Optional advanced test) Open devtools network tab. Try to
   POST to `/api/deliveries` PUT with a modified `paid_amount`
   in the body. The BUG-04 rebuild pattern at
   [app/api/deliveries/route.js](app/api/deliveries/route.js)
   should strip any driver-sent amounts.

**Expected:**
- Driver sees the correct `to_collect` amount
- Cannot modify via UI
- Backend strips any modified amounts from PUT body

**Pass criteria:** UI shows correct amount, UI has no input
field, backend enforcement holds (advanced test optional).

---

## Collection Flows (3 scenarios)

### Scenario 8: Admin records collection — FIFO default

**Setup:** Scenario 3 credit sale has remaining = 950,
Scenario 4 mixed sale has remaining = 600 (after Scenario 6
confirmed). Total open debt for `Ahmad Smoke`: 1550.

**Steps:**
1. As admin, navigate to the client detail page (`/clients/[id]`)
2. The collection form should show at the top
3. Enter amount: 1500
4. Payment method: `كاش`
5. Leave the sale picker on default (`FIFO — توزيع تلقائي`)
6. Submit

**Expected:**
- Toast: `تم توزيع الدفعة على 2 طلبات`
- Older sale (Scenario 3): fully collected (`remaining = 0`,
  `payment_status = 'paid'`)
- Newer sale (Scenario 4 remaining 600): 550 collected and 50
  remaining (`payment_status = 'partial'`)
- Two new payments rows with `type='collection'`,
  `payment_method='كاش'`

**Pass criteria:** FIFO walker distributes across both sales,
older sale fully paid, newer sale partial.

---

### Scenario 9: Admin records collection — specific sale picker

**Setup:** Create a new credit sale for `Ahmad Smoke` with
unit price 500, payment type `آجل`. Confirm delivery.

**Steps:**
1. On client detail page, use collection form
2. Amount: 500
3. Payment method: `بنك`
4. Select the specific sale from the dropdown (not FIFO)
5. Submit

**Expected:**
- Only that specific sale is updated, not any other
- Collection row inserted with `payment_method='بنك'`,
  `tva_amount≈83.33` (500/6)
- Sale transitions to `payment_status='paid'`

**Pass criteria:** specific sale fully collected, bank method
recorded, TVA computed.

---

### Scenario 10: Admin cannot overpay

**Setup:** Scenario 4 sale has `remaining = 50` (from
Scenario 8).

**Steps:**
1. On client detail page, try to record a 1000€ collection
2. Select the Scenario 4 sale specifically (not FIFO)
3. Submit

**Expected:**
- Error toast: `لا يمكن تسجيل مبلغ أكبر من المتبقي (50€)`
- Rejected with Arabic error message
- No payment row inserted
- Sale unchanged

**Pass criteria:** overpayment rejected with correct Arabic
error, no state change.

---

## Cancellation Flows (4 scenarios)

### Scenario 11: Cancel reserved sale (no bonuses yet)

**Setup:** Create a new sale, **don't confirm delivery**
(stays in `محجوز` state). Note the current stock.

**Steps:**
1. As admin, open the sale detail
2. Click "إلغاء البيع"
3. The CancelSaleDialog opens
4. Enter a reason: `SMOKE Test 11 — reserved cancel`
5. No bonus choice needed (no bonuses exist yet)
6. Confirm cancellation

**Expected:**
- Stock restored to the pre-sale value
- Sale status → `ملغي`
- No payment row reversed (no payment existed)
- A cancellations audit row written
- No bonus audit trail (bonuses not paid yet)

**Pass criteria:** stock restored, sale cancelled, audit row
present.

---

### Scenario 12: Cancel confirmed sale — bonuses kept

**Setup:** Scenario 2 sale (full cash, confirmed, bonuses
created). Verify bonuses exist in `/settlements` or the bonus
admin view before starting.

**Steps:**
1. Cancel the sale
2. Choose "إبقاء البونص" (keep bonus) for both seller and
   driver in the CancelSaleDialog
3. Reason: `SMOKE Test 12 — keep bonuses`
4. Confirm

**Expected:**
- Stock restored
- Payment row from Scenario 2 reversed with a negative amount
  (refund row inserted, total client balance back to zero)
- Bonuses NOT reversed — still visible, marked as kept in
  cancellation audit
- Cancellations audit row has `bonus_action = 'keep'`

**Pass criteria:** stock restored, payment refunded, bonuses
survive, audit reflects the keep choice.

---

### Scenario 13: Cancel confirmed sale — bonuses removed + refund

**Setup:** Create another full-cash sale, confirm delivery,
then cancel.

**Steps:**
1. Open cancel dialog
2. Choose "إزالة البونص" (remove bonus) for both seller and
   driver
3. Reason: `SMOKE Test 13 — remove bonuses`
4. Confirm

**Expected:**
- Stock restored
- Payment refunded (negative payment row)
- Bonuses reversed (seller_bonus and driver_bonus both negated
  in the cancellations audit table)
- Cancellations audit row has `bonus_action = 'remove'`

**Pass criteria:** full reversal including bonuses, audit
reflects remove choice.

---

### Scenario 14: BUG-22 settled bonus protection

**Setup:** Create a sale, confirm delivery, then record a
bonus settlement (either via `/settlements` UI or directly in
the DB). The seller_bonus row should have `settled=true` or
equivalent.

**Steps:**
1. Try to cancel the sale
2. In CancelSaleDialog, attempt to choose "remove bonus"
3. Confirm

**Expected:**
- The cancellation is BLOCKED
- Error message explains that the bonus is already settled
  and cannot be reversed
- The user is prompted to reverse the settlement first
- No cancellation audit row written
- Sale remains `مؤكد`

**Pass criteria:** BUG-22 protection fires, settled bonus
cannot be silently reversed.

---

## Invoice Flows (3 scenarios)

### Scenario 15: Invoice PDF shows EN ATTENTE pill

**Setup:** A pending sale with `payment_status='pending'`
(create one fresh, don't confirm delivery).

**Steps:**
1. Navigate to `/invoices`
2. Find the pending sale's invoice (or generate one if not
   auto-created)
3. Click "عرض PDF" / download
4. Open the PDF

**Expected:**
- **Yellow `EN ATTENTE` pill** at top of the invoice
- **No payments history** section (no collections yet)
- **Footer state:** `⏳ En attente de règlement — Acompte
  attendu à la livraison : X,XX €`
- All mentions légales present (SIRET, SIREN, APE, TVA, IBAN,
  BIC)

**Pass criteria:** yellow pending pill, no history table,
acompte footer.

---

### Scenario 16: Invoice PDF shows PARTIELLE pill with history

**Setup:** Scenario 4 sale (now partially paid) or any sale
with `payment_status='partial'` and at least one collection
row.

**Steps:**
1. Generate invoice PDF for the partial sale
2. Open the PDF

**Expected:**
- **Orange `PARTIELLE` pill**
- **Payments history table** shows all collections made so
  far with columns: Date / Mode / Montant TTC / TVA
- **Footer row:** `Solde restant: X,XX €`
- **State footer card:** `⚠️ Solde restant : X,XX € — à
  régler ultérieurement`

**Pass criteria:** orange pill, history table populated,
remaining balance shown.

---

### Scenario 17: Invoice PDF shows PAYÉE pill

**Setup:** A sale where `payment_status='paid'` (fully
collected).

**Steps:**
1. Generate invoice PDF for the paid sale
2. Open the PDF

**Expected:**
- **Green `PAYÉE` pill**
- **Payments history complete** showing all collection rows
- **State footer card:** `✓ PAYÉE EN INTÉGRALITÉ`
- No `Solde restant` line (or it shows 0)

**Pass criteria:** green pill, complete history, fully paid
confirmation.

---

## Dashboard Flows (3 scenarios)

### Scenario 18: Dashboard shows accrual + cash-basis P&L

**Setup:** Mix of paid and partial sales from the scenarios
above.

**Steps:**
1. Navigate to `/summary`
2. Locate the P&L cards section

**Expected:**
- **Two P&L cards side-by-side:**
  - **Accrual P&L** — counts all confirmed sales (the
    traditional view)
  - **Cash-basis P&L** — counts only fully-paid sales
    (`remaining = 0`), with the sky-blue accent from the
    FEAT-04 shipped change
- If partial sales exist, the two cards show **different
  values** — cash-basis is lower
- Revenue / COGS / Gross Profit / Net Profit all present in
  both cards

**Pass criteria:** both cards render, values differ when
partial sales exist.

---

### Scenario 19: Pending collections widget accuracy

**Setup:** Several partial sales exist.

**Steps:**
1. On `/summary`, find the "التحصيلات والضريبة" widget
2. Note the values shown

**Expected:**
- **المبلغ المستحق التحصيل** = sum of `remaining` across all
  partial sales (manually verify by querying or counting)
- **TVA ضمن المتبقي** = `pendingRevenue / 6`
- **Count** of partial sales matches the number you've created
- **TVA محصّلة في الفترة** = sum of `tva_amount` from all
  collection payments in the period

**Pass criteria:** values match a manual calculation.

---

### Scenario 20: Manual cross-check P&L arithmetic

**Setup:** Test DB with known sales from the scenarios above.

**Steps:**
1. Manually compute the sum of `sale.total` for sales where
   `payment_status = 'paid'` AND `status = 'مؤكد'`
2. Compare to `totalRevenueCashBasis` displayed in the
   dashboard's cash-basis card
3. Also verify: `grossProfit = totalRevenue - totalCOGS` in
   both accrual and cash-basis views

**Expected:**
- Exact match between manual calculation and dashboard value
- `grossProfit` equality in both views

**Pass criteria:** arithmetic sanity check passes.

---

## Voice Flows (3 scenarios — Path A assist mode)

### Scenario 21: Voice sale end-to-end

**Steps:**
1. Click the voice button (floating button, usually
   bottom-right)
2. Record: `بعت دراجة لأحمد بألف`
3. Wait for VoiceConfirm to open with extracted fields
4. **Verify the review banner is visible** — Session 7b
   hotfix requires it always shown, not just on missing fields
5. **Verify the subtitle** reads `🔬 وضع المساعد التجريبي —
   راجع كل حقل قبل الحفظ`
6. **Click outside the dialog** — verify it stays open
   (Session 7b hotfix)
7. Review fields, correct any that voice misheard, then save

**Expected:**
- Voice extraction produces a sale action
- Client name `Ahmad` (Latin, from ensureLatin auto-
  transliteration — BUG 5 hotfix)
- Item extracted or manually corrected
- Amount 1000
- Sale lands in `/sales` list

**Pass criteria:** voice extraction works, dialog cannot be
accidentally dismissed, client name is Latin in the DB.

---

### Scenario 22: Voice purchase end-to-end

**Steps:**
1. Voice button, record: `اشتريت خمس دراجات من علي بألفين`
2. VoiceConfirm opens
3. Review and save (add supplier phone if prompted for
   disambiguation — BUG-21)

**Expected:**
- Purchase action extracted
- Supplier name `Ali` (Latin)
- Quantity 5, unit price 2000
- Total 10000
- Purchase lands in `/purchases` list

**Pass criteria:** voice extraction works for purchases,
supplier Latin name stored.

---

### Scenario 23: Voice expense end-to-end

**Steps:**
1. Voice button, record: `دفعت مصروف مية يورو للوقود`
2. VoiceConfirm opens
3. Review and save

**Expected:**
- Expense action extracted
- Amount 100
- Category fuel-related (`وقود` or similar — check
  `EXPENSE_CATEGORIES`)
- Expense lands in `/expenses` list

**Pass criteria:** voice extraction works for expenses.

---

## Multi-User Cache + Dialog Verification (2 scenarios)

### Scenario 24: Stock page consistency across windows

**Setup:** Two browser windows logged in to production.
Window A is regular Chrome as admin. Window B is Chrome
Incognito as the same admin (or a different admin if you have
multiple accounts).

**Steps:**
1. In Window A: navigate to `/stock`
2. In Window B: navigate to `/stock`
3. In Window A: create a new product `SMOKE Cache Test`
4. In Window B: click the sidebar `/stock` link (not hard
   refresh — just navigate)

**Expected:**
- Product appears in Window B **immediately** without hard
  refresh
- `cache: 'no-store'` hotfix (Session 7b) verified working

**Pass criteria:** Window B shows the new product on
navigation.

---

### Scenario 25: Dialog click-outside verification

**Setup:** Open VoiceConfirm (by recording voice) or
CancelSaleDialog (by cancelling a confirmed sale).

**Steps:**
1. With the dialog open, try each of:
   - Click on the dim backdrop outside the dialog box
   - (Mobile) tap outside the dialog box
   - Press ESC key (Session 7b hotfix explicitly blocks this
     too)
2. Verify the dialog stays open after each
3. Now click the explicit ✓ save or ✕ cancel button

**Expected:**
- Backdrop click: dialog stays open ✓
- Mobile tap outside: dialog stays open ✓
- ESC: no effect ✓
- Explicit button: closes as expected ✓

**Pass criteria:** dialog only closes on explicit button, not
on backdrop or ESC.

---

## Results log

Fill in after user execution. Status values: ✅ pass, ❌ fail,
⚠️ partial pass, ⏭️ skipped.

| # | Scenario | Status | Notes |
|---|----------|--------|-------|
| 1 | Admin creates entities | | |
| 2 | Cash sale (full) | | |
| 3 | Credit sale (آجل, dpe=0) | | |
| 4 | Mixed sale (dpe=300) | | |
| 5 | Driver confirm cash | | |
| 6 | Driver confirm partial | | |
| 7 | Driver sees to_collect only | | |
| 8 | FIFO collection | | |
| 9 | Specific sale collection | | |
| 10 | Overpay rejection | | |
| 11 | Cancel reserved | | |
| 12 | Cancel + keep bonus | | |
| 13 | Cancel + remove bonus | | |
| 14 | BUG-22 settled block | | |
| 15 | Invoice EN ATTENTE | | |
| 16 | Invoice PARTIELLE | | |
| 17 | Invoice PAYÉE | | |
| 18 | Dashboard dual P&L | | |
| 19 | Pending widget | | |
| 20 | P&L arithmetic | | |
| 21 | Voice sale | | |
| 22 | Voice purchase | | |
| 23 | Voice expense | | |
| 24 | Multi-window cache | | |
| 25 | Dialog click-outside | | |

---

## Critical vs nice-to-have

**Critical (must pass before v1.0.0 tag):**

- Scenarios 1–14 — core business flows (sales, drivers,
  collections, cancellations)
- Scenarios 15–17 — invoice rendering (legal compliance)
- Scenarios 18–20 — dashboard accuracy (financial reporting)

**Nice to have (can be partial if time-limited):**

- Scenarios 21–23 — voice (Path A ships as assist mode, known
  limitations already documented in
  [PROJECT_DOCUMENTATION.md § 16](../PROJECT_DOCUMENTATION.md))
- Scenarios 24–25 — cache + dialog hotfix verification
  (already verified locally, smoke just confirms production
  parity)

---

## After execution

Two outcomes:

### ✅ All critical pass

- Update the results table with `✅` entries
- Commit the updated file as a follow-up on this branch
  (Session 8 Phase 2)
- Proceed to Session 10 (v1.0.0 tag + handoff)

### ❌ One or more critical fail

- Log the failures in the results table with `❌` and a note
- STOP Session 8
- Investigate root cause
- Fix in a new branch (hotfix scope)
- Deploy fix
- Re-run the failed scenarios
- Document the hotfix and re-execution in the results log
- Only proceed to Session 10 once all critical scenarios pass

---

## Pre-execution checklist

Before starting the smoke tests, confirm:

- [ ] Production is at master @ `[current SHA]`
- [ ] Test count is 367
- [ ] Vercel deploy is healthy (curl smoke returned 307 + 200)
- [ ] You have time for ~45-60 minutes of uninterrupted testing
- [ ] You have a way to reset test data afterwards (either
      delete `SMOKE-*` entities manually or restore a Neon
      point-in-time branch)
- [ ] Documentation references open in side tabs:
  - [PROJECT_DOCUMENTATION.md](../PROJECT_DOCUMENTATION.md)
    (especially § 15 accountant compliance and § 16 voice stack)
  - [SETUP.md § 8 admin rotation](../SETUP.md) if you need to
    change admin password first
  - [docs/pre-delivery-checklist.md](pre-delivery-checklist.md)
    for context

Good luck. Report results in the table above and commit as
Phase 2.
