# Critical User Journeys & Manual QA Checklist

> **Purpose.** This is the production safety net for the frontend improvement
> work (Commits 1–4). Before merging any visual/UX change, every flow below
> must still pass by hand on **mobile + desktop**. These flows move money,
> stock, or legal documents — a silent regression here is a production incident,
> and the automated suite (`tests/ui/*`) only covers a thin slice of them.
>
> Created in Commit 1 (safety net). Update it whenever a flow changes.

## How to use
1. Run the app: `npm run dev`.
2. Walk each flow on a phone-width viewport (≤480px) **and** desktop.
3. Watch the **Network tab**: the request payloads/params must not change
   across a UX-only commit — that is the contract these commits promise to keep.
4. Tick the QA checklist at the bottom before pushing.

---

## The 8 production-critical flows

### 1. New sale  →  `app/sales/page.js`  ·  `POST /api/sales`
- Open "بيع جديد", pick/create a client via SmartSelect, pick a product.
- Enter quantity + unit price. **Price-floor guard**: a sell price below buy
  price must show the inline red error and disable the submit button.
- Credit (آجل) sale: down-payment must be within range or show its inline error.
- Submit → toast success → row appears → optional WhatsApp share modal.
- ⚠️ Must protect: price-floor block, down-payment validation, bonus preview.

### 2. Delivery lifecycle  →  `app/deliveries/page.js`  ·  `PUT /api/deliveries`
- Create a delivery (client autofill, driver assignment).
- Move a row through **pending → delivered → cancelled**.
- Bank-pending confirmation flow (`confirm-bank`).
- ⚠️ Must protect: status transitions, driver-only PUT scope, VIN preservation.

### 3. Invoice view / PDF / VIN edit  →  `app/invoices/page.js`
- List loads; search by name / ref / VIN works.
- "PDF" opens the action modal (download + WhatsApp).
- "✎ VIN" (admin/manager only) requires the explicit old→new confirm.
- ⚠️ Must protect: VIN edit double-confirm, role gating of the VIN button.

### 4. Purchase + pay supplier  →  `app/purchases/page.js`  ·  `POST /api/purchases`, `/[id]/pay`
- Add a purchase (category required, sell ≥ buy guard).
- Pay a supplier from the row dialog; over-payment must be blocked inline.
- ⚠️ Must protect: sell-price floor, paid-amount ≤ total guard.

### 5. Treasury operations  →  `app/treasury/page.js`  ·  `/api/treasury/*`
- Custody handover, funding, capital injection/withdrawal, opening balance.
- Each money action must validate amount > 0 before submit.
- ⚠️ Must protect: confirmation before opening-balance + system toggle;
  no double-submit (Commit 2 adds the disabled-button guard here).

### 6. Settlements & profit distribution  →  `app/settlements/page.js`, `app/profit-distributions/page.js`
- Settlement amount must respect available credit (live red/green indicator).
- Distribution percentages must sum to 100% before the confirm modal.
- ⚠️ Must protect: pre-submit re-check of pool/credit, ConfirmModal breakdown.

### 7. Client debt collection  →  `app/clients/[id]/page.js`  ·  `/api/clients/[id]/collect`
- Open a client with debt, record a collection.
- ⚠️ Must protect: debt recalculation, aggregate correctness.

### 8. Login & role-based navigation  →  `app/login/page.js`, `components/Sidebar.js`, `components/AppLayout.js`
- Log in; unauthenticated users are redirected to `/login`.
- Sidebar shows only the links allowed for the role
  (admin / manager / seller / driver).
- ⚠️ Must protect: redirect-when-no-session, per-role link visibility.

---

## Manual QA checklist (run before pushing any UX commit)

**Mobile (≤480px) & small tablet (≤768px)**
- [ ] No horizontal page scroll anywhere.
- [ ] Filters do not bury the data below the fold (post-Commit 3: open via the sheet).
- [ ] All tap targets (row actions, close buttons, nav) ≥ 44px.
- [ ] Money/quantity fields open a numeric keyboard (post-Commit 2: `inputMode`).
- [ ] Modals fit the screen, scroll internally, and close.

**Tablet (769–1024px)**
- [ ] Sidebar drawer opens/closes; overlay dismisses it.
- [ ] Two-column grids (summary cards, forms) align.

**Desktop (>1024px)**
- [ ] Tables sort on header click; pagination works; sidebar is fixed.

**Forms**
- [ ] Required fields marked; inline validation errors show.
- [ ] Submit button disables while submitting — **no double submit**.

**Filters**
- [ ] Same result set before/after the change for the same inputs.
- [ ] A saved/shared URL with query params restores the same filtered view.
- [ ] "مسح" resets every key.

**API behaviour (the contract these commits must not break)**
- [ ] Request URLs, query params, and POST/PUT bodies are unchanged for an
      identical user action (compare Network tab against `master`).

**Accessibility**
- [ ] Keyboard: Tab through a form, Esc closes modals.
- [ ] Pinch-zoom still allowed; text contrast readable.

**Regression**
- [ ] `npm run lint` clean · `npm run typecheck` clean · `npm test` green
      (incl. `tests/ui/*`).
- [ ] The 8 flows above all complete by hand.
