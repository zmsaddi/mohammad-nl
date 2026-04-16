# v1.0 Pre-Delivery Study

Investigation of 7 user-reported items from manual production testing
before v1.0 delivery. **Phase A — READ-ONLY investigation only.** No
production code changed. User will review and approve Phase B scope.

Base: master @ [787234a](../../commit/787234a), 371 unit tests green,
86/86 smoke + 46/46 stress (540 ops) on deployed production.

---

## Executive summary

| # | Item | Category | Real scope | v1.0 recommendation |
|---|---|---|---|---|
| 1 | Invoice signature block removal | Cosmetic | ~10 min | ✅ Include |
| 2 | Filters on list pages | Feature | ~3–5 h | 🟡 Selective (see below) |
| 3 | Column header sorting | Feature | ~2–3 h | 🟢 Include (cheap, high value) |
| 4 | Profit distribution system (توزيع أرباح) | Major new | ~6–10 h + accountant | ⚠️ **Defer to v1.1** |
| 5a | Client detail page — invoice PDF link | UI gap | ~30 min | ✅ Include |
| 5b | Client detail page — cancel sale button | UI gap | ~20 min | ✅ Include |
| 5c | Client detail page — enrich payments history | UI polish | ~15 min | ✅ Include |

**Critical surprise finding: Item 5 is ~85% already built.** The
[`/clients/[id]` page](../app/clients/[id]/page.js) already has the
client profile card, a full payment-registration form with FIFO +
specific-sale picker + live TVA preview + كاش/بنك method radio, a
sales-history table, and a payments-history table. The user's
statement "THE CURRENT SYSTEM DID NOT ALLOW ME FOR INVOICE OR CLIENT
SETLMENT" is largely inaccurate — the real gaps are narrower and
cheaper than the prompt implied.

**Total recommended v1.0 scope:** items 1 + 3 + 5a + 5b + 5c + selective
item 2 filters on 3–4 highest-value pages. **≈ 4–6 hours Claude Code
time**, single day of work plus testing.

**Recommended deferral:** item 4 (profit distribution) needs business
rule + accountant confirmation before any schema design. Not a
blocker for v1.0 delivery because the current `profit_distribution`
settlement type already exists and accepts single-recipient rows;
the gap is the multi-recipient percentage split UI.

---

## Item 1 — Invoice signature block removal

### Current state

Single HTML template in [`lib/invoice-generator.js`](../lib/invoice-generator.js)
shared across all three invoice states (EN ATTENTE / PARTIELLE / PAYÉE).
The three-state rendering happens elsewhere (state card + pill + payments
history table) and is unaffected by the signatures block.

Signatures block at [lib/invoice-generator.js:307-316](../lib/invoice-generator.js#L307-L316):

```html
<div class="signatures">
  <div class="sig-block">
    <h4>Signature du vendeur</h4>
    <div class="sig-box"><span>Signature autorisée</span></div>
  </div>
  <div class="sig-block">
    <h4>Bon pour accord — Client</h4>
    <div class="sig-box"><span>Signature du client</span></div>
  </div>
</div>
```

CSS at [L151](../lib/invoice-generator.js#L151):
```css
.signatures { display:grid; grid-template-columns:1fr 1fr; gap:32px; ... }
```

### Required change

Remove lines 312–315 (the second `.sig-block` — client signature).
Change `grid-template-columns:1fr 1fr` → `grid-template-columns:1fr`
(or `max-width:50%` to keep the seller signature half-width instead
of stretching across).

### Test impact

Searched [tests/feat04-invoice-modes.test.js](../tests/feat04-invoice-modes.test.js) for
`Signature|signatures|Bon pour|sig-block|sig-box` — **zero matches**. No
existing tests reference the signatures block. Nothing to update.

### Scope estimate

| Metric | Value |
|---|---|
| LOC change | 4 deletions + 1 CSS tweak |
| Files touched | 1 |
| Tests to update | 0 |
| Claude Code time | ~10 minutes |
| Risk | LOW (cosmetic, accountant-approved in Session 5) |

---

## Item 2 — Filters on list pages

### Current state audit

| Page | Filters present | Gap |
|---|---|---|
| [`app/sales/page.js`](../app/sales/page.js) | **None** | date range, client, status, payment_status, seller |
| [`app/purchases/page.js`](../app/purchases/page.js) | **None** | date range, supplier, buyer |
| [`app/clients/page.js`](../app/clients/page.js) | Name/phone search only | has_debt toggle, city |
| [`app/clients/[id]/page.js`](../app/clients/[id]/page.js) | **None** | n/a (detail page, not a list) |
| [`app/stock/page.js`](../app/stock/page.js) | ✅ **Full** — search + stock status (all/in/low/out) + category | — |
| [`app/deliveries/page.js`](../app/deliveries/page.js) | Status filter only | date range, driver |
| [`app/expenses/page.js`](../app/expenses/page.js) | **None** | date range, category, amount range |
| [`app/settlements/page.js`](../app/settlements/page.js) | **None** | date range, type, username |
| [`app/invoices/page.js`](../app/invoices/page.js) | Search (name/code/VIN) | date range, payment_status |
| [`app/summary/page.js`](../app/summary/page.js) | ✅ dateFrom/dateTo | (not a list) |

[`app/stock/page.js`](../app/stock/page.js) is the reference implementation
— it has the richest filter UI and is the pattern to follow.

### Recommended filter set per page

Minimum viable filters (all client-side since current data volumes
are well under 500 rows on any page):

| Page | Recommended filters | Priority |
|---|---|---|
| Sales | date range, client search, status, payment_status | **HIGH** |
| Clients | search (already), has_debt toggle | MED |
| Deliveries | date range, status (already), driver search | MED |
| Expenses | date range, category, search | MED |
| Purchases | date range, supplier search | LOW |
| Settlements | date range, type, username search | LOW |
| Invoices | search (already), date range, payment_status | MED |

### Implementation approach

All pages have small row counts (Phase 0.5 production data: sales ~200,
clients ~60, invoices ~150). **Client-side filtering via `.filter()`
on the `rows` array is sufficient and simpler than server-side query
params.** Matches the existing stock page pattern.

Pattern per page (reusing the stock page layout):

```jsx
const [dateFrom, setDateFrom] = useState('');
const [dateTo, setDateTo] = useState('');
const [statusFilter, setStatusFilter] = useState('all');
const [textSearch, setTextSearch] = useState('');

const filtered = useMemo(() => rows.filter((r) => {
  if (dateFrom && r.date < dateFrom) return false;
  if (dateTo && r.date > dateTo) return false;
  if (statusFilter !== 'all' && r.status !== statusFilter) return false;
  if (textSearch && !r.client_name?.includes(textSearch)) return false;
  return true;
}), [rows, dateFrom, dateTo, statusFilter, textSearch]);
```

### Scope estimate

| Path | Pages | Claude Code time |
|---|---|---|
| **Minimum** (sales + clients + deliveries) | 3 | ~1.5 h |
| **Balanced** (+ expenses + invoices) | 5 | ~2.5 h |
| **Full** (all 8 list pages) | 8 | ~4 h |

**v1.0 recommendation:** Minimum set (sales + clients + deliveries)
— these are the three pages the user explicitly called out as
"hard to manage." Defer the other five to v1.1 unless they're
needed for the first weeks of production use.

| Metric | Value |
|---|---|
| LOC per page | ~30–50 |
| Tests to add | Optional — React component tests for filters are non-trivial and current test suite has no component tests; skip for v1.0 |
| Risk | LOW (additive, no existing logic changes) |

---

## Item 3 — Column header sorting

### Current state

- **Zero pages implement sorting.** Grep across [app/](../app/) for
  `sortKey|sortBy|sortField|sortColumn|sortDirection|sortOrder|\.sort\(`
  returned zero matches.
- **No shared `Table` component** in [components/](../components/) —
  every page renders `<table className="data-table">` inline with
  hardcoded `<th>` elements.

### Two possible approaches

**Approach A — Tiny sort hook per page (recommended for v1.0):**

Create [`lib/useSortedRows.js`](../lib/useSortedRows.js) exporting a
~20-line hook:

```js
export function useSortedRows(rows, initial = null) {
  const [sort, setSort] = useState(initial); // { key, dir: 'asc'|'desc' }
  const sorted = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort]);
  const toggleSort = (key) => setSort((prev) =>
    prev?.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' }
  );
  return { sorted, sort, toggleSort };
}
```

Then per page:

```jsx
const { sorted, sort, toggleSort } = useSortedRows(filtered);
// ...
<th onClick={() => toggleSort('date')} style={{ cursor: 'pointer' }}>
  التاريخ {sort?.key === 'date' && (sort.dir === 'asc' ? '↑' : '↓')}
</th>
// ... render `sorted` instead of `filtered`
```

Per page: ~10 line change. 8 list pages × ~15 min = ~2 hours total.

**Approach B — Refactor all tables to a shared `<SortableTable>` component:**

Bigger upfront work (~4–6 hours) but reusable for future pages and
produces consistent headers/styles across the app. **Not recommended
for v1.0** — the existing inline tables work fine and changing every
page's table markup is a regression risk without clear benefit.

### Scope estimate

| Metric | Value |
|---|---|
| New file | `lib/useSortedRows.js` (~25 lines) |
| Pages to update | 8 list pages |
| Per-page diff | ~10–15 lines (import, call hook, add onClick to headers, render `sorted`) |
| Tests to add | Optional (small unit test for the hook) |
| Claude Code time | ~2–3 h |
| Risk | LOW (additive, no existing filter logic changes) |

**v1.0 recommendation:** **Include.** Low-risk, high-user-value, and
interacts naturally with Item 2's filter additions (same pages get
both benefits in a single edit pass).

---

## Item 4 — توزيع أرباح (Profit Distribution System)

### Critical surprise findings

**Finding 1: The `profit_distribution` settlement type ALREADY EXISTS in the UI.**

[`app/settlements/page.js:8-12`](../app/settlements/page.js#L8-L12):

```js
const TYPES = {
  seller_payout: { label: 'دفع عمولة بائع', color: '#16a34a', bg: '#dcfce7' },
  driver_payout: { label: 'دفع عمولة سائق', color: '#7c3aed', bg: '#ede9fe' },
  profit_distribution: { label: 'توزيع أرباح', color: '#1e40af', bg: '#dbeafe' },
};
```

The type selector at [L122-125](../app/settlements/page.js#L122-L125)
already lists it. An admin can select "توزيع أرباح", enter a username
and amount, and save — **and it WILL save**. The settlement row is
written to the `settlements` table just like any other type.

**Finding 2: `addSettlement` accepts profit_distribution, it just skips bonus-marking.**

[`lib/db.js:3041`](../lib/db.js#L3041):

```js
// Partial settlement: mark bonuses settled FIFO up to the paid amount
if (data.username && (data.type === 'seller_payout' || data.type === 'driver_payout')) {
  // walks unsettled bonuses FIFO
}
```

The `if` guard only runs the bonus-walker for the two payout types.
`profit_distribution` inserts the parent row at L3034 and returns —
no bonus linkage, no error, just a bare settlement record.

**Finding 3: The real gap is multi-recipient percentage split, not "it does not register."**

The user's example: *"collected 2000 I chose settlement bonus it said
collected 2000 admin1 25% admin2 15% manager1 20% manager2 20%
manager3 20% make calculation"* — describes a **dialog that takes one
pool, N recipients, and N percentages** and produces N settlement rows
atomically. The current form is single-user / single-amount, so the
user would have to manually compute each person's cut and enter them
as 5 separate settlements. That's what "I CAN NOT MAKE توزيع أرباح" is
really saying — not that the type is missing, but that the form can't
express a group split.

### Current schema

[`lib/db.js:188-196`](../lib/db.js#L188-L196) (users):
```sql
CREATE TABLE users (id, username, password, name, role, active, created_at)
```
**No `profit_share` column.**

[`lib/db.js:227-237`](../lib/db.js#L227-L237) (settlements):
```sql
CREATE TABLE settlements (id, date, type, username, description, amount, settled_by, notes)
```
**No `base_amount`, `percentage`, or `distribution_group_id` column.**

### Three implementation options

#### Option A — Minimal schema change, new dialog, group by notes+date (smallest)

- **Schema:** Add `settlements.distribution_group_id UUID NULL` — one column.
- **API:** New `POST /api/profit-distributions` that accepts
  `{ date, baseAmount, recipients: [{ username, percentage }] }` and
  inserts N settlement rows in one transaction, all sharing a generated
  `distribution_group_id`.
- **UI:** New form in `/settlements` (or a new tab) that lets the admin
  dynamically add/remove recipient rows, validates percentages sum to
  100 (or ≤ 100 if retained share allowed), computes amounts live, and
  submits to the new endpoint.
- **History rendering:** Existing settlements table groups rows by
  `distribution_group_id` when present, showing a collapsed summary with
  a "details" expand.

Scope: ~6 hours Claude Code time. One small migration.

#### Option B — Full two-table normalization (bigger, cleanest)

New tables `profit_distributions` (header) + `profit_distribution_rows`
(child) linked by FK. More ceremony. ~10 hours.

#### Option C — Defer entirely to v1.1 (recommended)

**The business rules are not pinned down.** This is a new financial
flow that:
1. Affects the company's P&L (profit distribution is itself a cost)
2. Has French SAS tax implications (dividend vs bonus vs salary)
3. Needs accountant review before any schema is committed
4. Has open questions the user hasn't answered yet

### Open business/accountant questions (all blockers for Phase B on Item 4)

1. **What is the "base" being distributed?**
   - Gross collected revenue for the period?
   - Net profit (revenue − COGS − expenses − bonuses)?
   - Something else specific to the business?

2. **Should percentages be pre-configured per user or per-distribution?**
   - Pre-configured → add `users.profit_share` column, auto-fill the
     dialog.
   - Per-distribution → admin types percentages every time.
   - Hybrid → defaults from settings, override per-distribution.

3. **Must percentages sum to 100%, or can the company retain a share?**
   - Example: 5 people at 25/15/20/20/20 = 100% → no retained share.
   - Example: 80% distributed / 20% kept in company → sum check ≤ 100%.

4. **French SAS tax / legal treatment?** (accountant question)
   - Are these payouts declared as bonuses (payroll, social
     contributions) or as dividends (declared annually, different tax)?
   - Does the accountant need these rows to appear on a specific
     report?

5. **How does profit distribution interact with the P&L dashboard?**
   - Is it a deductible expense that lowers cash-basis profit?
   - Or does it sit below-the-line like bonuses currently do?

6. **Recipient eligibility:**
   - Admin + manager only (per user statement)?
   - Or should it be flexible (any role)?

7. **Reversibility:**
   - Can a committed profit distribution be cancelled?
   - If yes, does it reverse the individual recipient rows, or create
     negative settlements?

### v1.0 recommendation: defer to v1.1 with a minimal stopgap

- **v1.0:** Leave the existing `profit_distribution` type in the
  settlement form as-is. Document clearly in [PROJECT_DOCUMENTATION.md](../PROJECT_DOCUMENTATION.md)
  (Session 9 docs sweep) that the admin can record manual profit
  distributions today, one recipient at a time, by entering each
  person's computed amount as a separate settlement.
- **v1.1:** After accountant confirms the business rules above, build
  the multi-recipient split dialog with Option A schema.

### Scope estimate (if built now against user-guessed rules)

| Metric | Value |
|---|---|
| Schema migration | 1 column (distribution_group_id) |
| New API route | 1 (POST /api/profit-distributions) |
| New UI form | 1 dynamic recipient-list form |
| History rendering change | Existing table groups by distribution_group_id |
| Tests | Integration test against real Neon branch |
| Claude Code time | ~6–10 h |
| Risk | **HIGH** (new financial flow + accountant approval outstanding) |

---

## Item 5 — Client detail page functionality

### Critical finding — the page is ~85% built

Read [`app/clients/[id]/page.js`](../app/clients/[id]/page.js) in
full (339 lines). **The user's statement "THE CURRENT SYSTEM DID NOT
ALLOW ME FOR INVOICE OR CLIENT SETLMENT" is inaccurate against the
current code.** Features that already exist:

#### Already implemented ✅

| Feature | Lines | Status |
|---|---|---|
| Client profile card (name, phone, email, address) | 138–172 | ✅ Full |
| Financial summary (total sales, paid, remaining) | 157–170 | ✅ Full |
| **Payment registration form** | 174–242 | ✅ **Full** |
| &nbsp;&nbsp;→ Amount input | 183–192 | ✅ |
| &nbsp;&nbsp;→ Method radio (كاش / بنك) | 194–217 | ✅ |
| &nbsp;&nbsp;→ **FIFO / specific-sale picker dropdown** | 219–232 | ✅ FEAT-04 |
| &nbsp;&nbsp;→ Live TVA preview | 234–236 | ✅ |
| &nbsp;&nbsp;→ Routes to `/api/clients/[id]/collect` or `/api/sales/[id]/collect` | 69–82 | ✅ |
| Sales history table | 244–294 | ✅ date, item, qty, unit price, total, payment type, paid, remaining |
| Payments history table | 296–327 | ✅ date, amount, notes (minimal columns) |

The payment form supports **both** FIFO (walks oldest-first) and
specific-sale (pick the exact sale from the dropdown). The Phase 0.5
stress test exercised this path 100 times at 100% pass rate
(Rule 2 FIFO). **The backend is not the issue — the user may simply
not have seen this page, or the "التفاصيل" link on
[`/clients`](../app/clients/page.js) wasn't obvious.**

Verified: [`app/clients/page.js:239-241`](../app/clients/page.js#L239-L241)
does render a working `Link href={"/clients/${client.id}"}` "التفاصيل"
button per row. The navigation works.

### Real gaps (the actual v1.0 work)

#### Gap 5a — Invoice PDF button per sale row

**Current state:** sales history table rows show sale details but
have no way to open the invoice PDF.

**Pattern to reuse:** [`app/invoices/page.js:111-121`](../app/invoices/page.js#L111-L121)
already opens `/api/invoices/${inv.ref_code}/pdf` in a new tab. The
PDF route at [`app/api/invoices/[id]/pdf/route.js:39`](../app/api/invoices/[id]/pdf/route.js#L39)
accepts ref_code OR numeric id via `WHERE i.ref_code = ${id} OR i.id = ${numericId}`.

**Obstacle:** [`lib/db.js:824-829`](../lib/db.js#L824-L829) `getSales`
returns `SELECT * FROM sales` — no join on invoices. The client
detail page's sales array doesn't know the invoice id.

**Fix:** One-line change to `getSales` to LEFT JOIN invoices on
`i.sale_id = s.id` and return `invoice_ref_code` in the payload.
Then the client detail page adds a column:

```jsx
<td>
  {row.status === 'مؤكد' && row.invoice_ref_code && (
    <button onClick={() => window.open(`/api/invoices/${row.invoice_ref_code}/pdf`, '_blank')}>
      📄 PDF
    </button>
  )}
</td>
```

**Scope:** 1 SQL line in [`lib/db.js`](../lib/db.js), ~8 lines in the
client detail page. ~30 minutes.

#### Gap 5b — Cancel sale button per sale row (admin only)

**Current state:** cancel is available only from
[`/sales`](../app/sales/page.js) and
[`/deliveries`](../app/deliveries/page.js). Not from the client
detail page.

**Pattern to reuse:** [`components/CancelSaleDialog.js`](../components/CancelSaleDialog.js)
is the existing dialog used by `/sales` at [L581-588](../app/sales/page.js#L581-L588)
and [L589-593](../app/sales/page.js#L589-L593). Import it, add an
admin-only button column, wire up `setCancelSale({ saleId, invoiceMode: 'delete' })`.

**Scope:** ~15 lines in the client detail page (import + state + button
column + dialog render). ~20 minutes.

#### Gap 5c — Enrich payments history table

**Current state:** payments history shows only `date | amount | notes`.
The payments table in the DB already has `payment_method` and
`sale_id` columns — they're just not displayed.

**Fix:** Add two columns to the existing table at
[`app/clients/[id]/page.js:308-314`](../app/clients/[id]/page.js#L308-L314):

```jsx
<th>التاريخ</th>
<th>المبلغ</th>
<th>الطريقة</th>        // NEW
<th>طلب #</th>          // NEW
<th>ملاحظات</th>
```

And render `row.payment_method` + `row.sale_id` cells. The `payments`
array already has these fields — no backend change needed.

**Scope:** ~5 lines. ~15 minutes.

### Scope estimate — item 5 total

| Sub-item | Scope | Time |
|---|---|---|
| 5a — Invoice PDF button | 1 SQL line + ~8 JSX lines | ~30 min |
| 5b — Cancel sale button | ~15 JSX lines | ~20 min |
| 5c — Payments history columns | ~5 JSX lines | ~15 min |
| **Total** | 1 db change + ~28 JSX lines + 1 import | **~1 hour** |

| Metric | Value |
|---|---|
| Files touched | 2 (lib/db.js + app/clients/[id]/page.js) |
| New endpoints | 0 |
| Schema changes | 0 |
| Tests to add | Optional (integration test for `getSales` JOIN) |
| Risk | LOW (tiny diff, existing patterns reused) |

---

## Cross-cutting concerns

### Phase 1 UI testing impact

The user's outstanding Phase 1 UI smoke tests
([docs/pre-delivery-smoke-tests.md](pre-delivery-smoke-tests.md)):

- **Scenario 7** (driver sees to_collect display-only) — unaffected
- **Scenarios 15/16/17** (invoice PDF states) — **AFFECTED by Item 1**
  (signature block removal). These scenarios should be re-run
  after Item 1 ships so the user visually verifies the new layout.
- **Scenario 21/22/23** (voice flows) — unaffected
- **Scenario 24** (multi-window cache) — unaffected
- **Scenario 25** (dialog click-outside) — unaffected by any item

Item 5's changes to `/clients/[id]` do not overlap with any Phase 1
scenario (none of them test the client detail page directly), so Phase
1 can proceed in parallel with Phase B implementation.

### Accountant review trigger

**Only Item 4 needs accountant review.** Items 1, 2, 3, 5 are
UI/UX changes with no accounting impact.

Proposed accountant question for Item 4 (to be sent when user decides
to build profit distribution):

> Bonjour, we need to add a profit distribution (توزيع أرباح) feature
> for the admin + manager team. Example: the business collects 2000€
> in a period; the admin wants to split this between admin1 (25%),
> admin2 (15%), manager1 (20%), manager2 (20%), manager3 (20%). Three
> questions:
> 1. What base should we use — gross collected revenue, or net profit
>    after costs and bonuses?
> 2. In a French SAS, should these payouts be declared as bonuses
>    (payroll, social charges) or as dividends (annual declaration)?
> 3. Should the company retain a share (e.g., 80% to the team, 20% to
>    the company account) or must the split total 100%?

### Dependency map

- **Items 1, 4** are independent of everything else.
- **Items 2, 3** touch the same 8 pages — build them in a single
  pass to edit each page's table once.
- **Items 5a, 5b, 5c** are tightly coupled (all touch
  [`app/clients/[id]/page.js`](../app/clients/[id]/page.js)). Build
  together in one PR.
- **Item 5a** requires a one-line change in
  [`lib/db.js`](../lib/db.js) `getSales` — the only non-UI touch
  in the v1.0 recommended scope.

### Risk assessment

| Risk | Items | Rationale |
|---|---|---|
| LOW | 1, 3, 5a, 5b, 5c | Small scope, existing patterns, additive only |
| MEDIUM | 2 | Wider scope (8 pages) but all additive and client-side |
| HIGH | 4 | New financial flow, schema change, accountant approval required |

---

## Recommendations

### Path A — Minimum viable v1.0 (ships fastest)

- Item 1 (invoice cleanup) — 10 min
- Item 5a + 5b + 5c (client page completeness) — ~1 h
- Skip items 2, 3, 4

**Timeline:** ~1.5 h Claude Code + user smoke of items 1 & 5.
**Verdict:** Ships the hard gaps but leaves filter/sort as v1.1
surprises.

### Path B — Balanced v1.0 (recommended)

- Path A items (1, 5a, 5b, 5c)
- Item 3 (sorting — small, reusable hook, 8 pages benefit)
- Item 2 **selective** — filters on sales + clients + deliveries only
  (the three pages the user explicitly called out)

**Timeline:** ~4–5 h Claude Code + user smoke. Single day.
**Verdict:** Covers all the user's explicit pain points without
biting off item 4's scope. **This is the recommended path.**

### Path C — Full scope

- All 7 items including item 4.

**Timeline:** ~12–18 h Claude Code + accountant consult for item 4.
3–5 business days.
**Verdict:** Delays v1.0 by days and commits to a profit-distribution
flow without accountant approval. Not recommended for v1.0.

---

## Proposed v1.0 / v1.1 split

### v1.0 (deliver ASAP)

- ✅ **Item 1** — invoice signature removal (10 min)
- ✅ **Item 3** — column sorting via reusable hook (2–3 h)
- ✅ **Item 2** selective — filters on sales + clients + deliveries (1.5 h)
- ✅ **Item 5a/5b/5c** — client detail page gaps (1 h)

**Total: ~5–6 hours Claude Code time, one business day of work.**

### v1.1 backlog

- ⏩ **Item 2 full** — filters on the remaining 5 list pages (~2.5 h)
- ⏩ **Item 4** — profit distribution multi-recipient system (~6–10 h + accountant)

---

## Open questions for the user

**Blocking Phase B (before we can start implementation):**

1. **Which path do you want — A, B, or C?** (Recommended: B.)
2. **For Item 5b (cancel sale from client detail):** should non-admin
   users see the cancel button? (Current `/sales` page allows the
   original seller to cancel their own *reserved* sales. Should the
   same rule apply on the client detail page?)

**Blocking Item 4 only (can be deferred):**

3. What "base" should profit distribution use — gross revenue, net
   profit, or custom?
4. Should percentages be pre-configured on the user profile or set
   per-distribution?
5. Must percentages sum to 100% or can the company retain a share?
6. Should this be declared as bonuses (payroll) or dividends (annual)
   per the French SAS accountant?
7. Should profit distributions be reversible?

**Non-blocking, nice to answer:**

8. For Item 2 filters, are there any specific filter fields beyond
   the recommended set that you use frequently on paper today?
9. For Item 3 sorting, do you want a default sort on any page
   (e.g., sales always sorted by date desc)?

---

## Next steps

1. **User reviews this study** and picks Path A / B / C (or a custom
   subset).
2. **User answers the blocking open questions** above (questions 1–2
   at minimum; 3–7 only if item 4 is in scope).
3. **Claude Code begins Phase B** on the approved scope with a fresh
   branch `hotfix/v1-pre-delivery-fixes` (or similar).
4. **Phase 1 UI scenarios** defer to post-Phase B for items affected
   by the changes (scenarios 15/16/17 for item 1; optionally re-test
   client detail page after items 5a/b/c).
5. **Session 9 docs sweep** happens after Phase B lands, including a
   note on the deferred item 4 profit-distribution design.
6. **Session 10 (v1.0.0 tag + customer handoff)** after Session 9
   green.
