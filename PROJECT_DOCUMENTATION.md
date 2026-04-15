# Vitesse Eco — Technical Project Documentation

> Full-stack business management system for an **e-bikes, accessories & spare parts** trading business.
> Arabic-first, RTL, voice-driven data entry, multi-role RBAC, deployed on Vercel with a Neon Postgres database.

---

## 0. System Scope — read this first

Vitesse Eco is a **hybrid system** with two faces. Understanding the split is critical for anyone changing the code, especially anything that touches invoices, VAT, or the cancellation flow.

### 0.1 Internal face — Arabic management UI

Everything behind `/login` (sales entry, deliveries, stock, clients, summary, my-bonus, settlements, users, settings) is an **internal operations tool**. It is Arabic-first, RTL, role-gated, and exists only for the business's own staff. It is **not** a legal or accounting system — the numbers it shows (revenue, profit, bonus liability, client debt) are managerial aggregates for day-to-day decisions, not audit-grade figures.

### 0.2 Customer-facing face — French legal Facture

At delivery confirmation ([lib/db.js:1318-1321](lib/db.js#L1318-L1321)), the system issues a **legally-binding French invoice** ("Facture") via [lib/invoice-generator.js](lib/invoice-generator.js). This document:

- Carries the French SAS's SIRET, SIREN, APE code, and TVA number
- Shows VAT back-calculated from the TTC-entered price (20% default, configurable via `settings.vat_rate`)
- Includes IBAN, BIC, and signature blocks
- Is titled "Facture" in French and conforms to Code de commerce expectations for commercial documents

The external accountant works **directly from these Factures** — there is no separate accounting export, and FEAT-02 (monthly CSV export) was killed in the Sprint 3 decisions because the Facture itself is the accountant's input.

### 0.3 Why the split matters

- **Pricing is always TTC.** Sellers enter the final customer-facing amount. The Facture back-calculates HT + TVA from that. The internal UI never asks the seller to think about VAT.
- **"No VAT computation needed"** (a frequent clarification from the user) refers to the *internal UI*, not to the Facture. The Facture does compute VAT, and that computation is legally required.
- **Changes to `lib/invoice-generator.js`, `settings.vat_rate`, or the invoice-generation step of `updateDelivery(confirm)` have legal implications** in France and should be reviewed accordingly. Do not "simplify" the Facture into a generic receipt without legal sign-off — the document you see at delivery time is what the customer walks away with and what the accountant books.
- **Cancellation of a confirmed sale voids the Facture** (soft-void: `UPDATE invoices SET status='ملغي'` in `voidInvoice()`, [lib/db.js:1859](lib/db.js#L1859)). The voided Facture is still retained for audit purposes — it is not deleted from the DB.

### 0.4 What this means for future work

- Treat the invoice-generator as frozen unless there is a specific legal reason to modify it.
- The FEAT-05 cancellation helper must soft-void invoices by default (`invoiceMode='soft'`), not hard-delete them — deleting a Facture that was issued to a customer is an accounting break.
- If a new "scope" of document is added (e.g., a non-invoice delivery receipt separate from the Facture), it must live alongside the Facture, not replace it.

---

## 1. Technology Stack

### Runtime & Framework
| Layer | Tech | Version | Role |
|---|---|---|---|
| Framework | **Next.js** (App Router) | 16.2.3 | Pages, server components, API routes, middleware |
| UI library | **React** | 19.2.4 | Client components, hooks-based state |
| Language | JavaScript (ESM) | — | No TypeScript; `jsconfig.json` provides `@/*` alias |
| Styling | **Tailwind CSS** | v4 | Utility classes + custom theme in `app/globals.css` |
| Fonts | Google **Cairo** | — | Arabic typography, RTL (`dir="rtl"`) |

### Auth
| Tech | Version | Role |
|---|---|---|
| **next-auth** | 4.24.13 | JWT sessions, Credentials provider |
| **bcryptjs** | 3.0.3 | 12-round password hashing |

### Database
| Tech | Version | Role |
|---|---|---|
| **PostgreSQL** (Neon serverless) | — | Primary store |
| **@vercel/postgres** | 0.10.0 | SQL template-tag client, parameterized queries, pooling |

### AI / Voice
| Tech | Version | Role |
|---|---|---|
| **groq-sdk** | 1.1.2 | Whisper-large-v3 (Arabic STT) + **Llama 3.1 8B Instant** (primary structured-extraction LLM after PERF-03) |
| **fuse.js** | 7.3.0 | Fuzzy entity search (products / clients / suppliers) |

> Note: the Google Gemini dependency was removed in PERF-03 — Llama 3.1 8B Instant via Groq is now the single LLM path. `@google/generative-ai` may still appear in `package.json` history but is no longer imported anywhere in `app/` or `lib/`.

### Visualization
| Tech | Version | Role |
|---|---|---|
| **recharts** | 3.8.1 | Dashboard charts (bar / pie / line) |

### Tooling
- ESLint (`eslint-config-next`) — `eslint.config.mjs`
- PostCSS — `postcss.config.mjs`
- Vercel — hosting + Postgres + env vars

---

## 2. Repository Layout

```
d:/mohammad_nl/
├── app/                          Next.js App Router (pages + api/)
│   ├── api/                      REST endpoints (route.js per resource)
│   ├── login/                    Login page
│   ├── summary/                  Admin/Manager dashboard (P&L)
│   ├── sales/  purchases/
│   ├── deliveries/  invoices/
│   ├── stock/                    Inventory
│   ├── clients/  clients/[id]/   Customers + debt detail
│   ├── expenses/
│   ├── my-bonus/  settlements/   Bonus + payouts
│   ├── users/                    User mgmt (admin only)
│   ├── layout.js  page.js  globals.css
│
├── components/                   9 reusable client components
│   ├── Providers.js              SessionProvider wrapper
│   ├── AppLayout.js  Sidebar.js  Layout shell, role-aware nav
│   ├── VoiceButton.js            MediaRecorder (≤ 30s)
│   ├── VoiceConfirm.js           Pre-fill + confidence highlight
│   ├── SmartSelect.js            Autocomplete
│   ├── Toast.js  ConfirmModal.js  DetailModal.js
│
├── lib/                          Business + infra logic
│   ├── db.js                     ~2530 lines — schema init + ALL DB ops + bonus engine + alias system
│   ├── auth.js                   NextAuth config (Credentials + JWT)
│   ├── utils.js                  formatNumber, calculateClientDebt, EXPENSE_CATEGORIES
│   ├── entity-resolver.js        Layered fuzzy matching
│   └── voice-normalizer.js       Arabic dialect → canonical text
│
├── middleware.js                 Auth + RBAC for pages & API
├── next.config.mjs  jsconfig.json
├── README.md  SETUP.md  AI_ARCHITECTURE_REVIEW.md
└── package.json
```

---

## 3. Authentication & Authorization

### 3.1 Login flow
1. Browser POSTs username/password to `/api/auth/callback/credentials`.
2. [lib/auth.js](lib/auth.js) `authorize()` queries `users WHERE username=? AND active=true`, verifies hash with bcryptjs, returns `{ id, name, role, username }`.
3. **No hardcoded fallback.** An earlier revision allowed `admin/admin123` to pass auth even when the DB was unreachable — that was removed because a hardcoded fallback is a permanent backdoor ([lib/auth.js:30-35](lib/auth.js#L30-L35)). The **seeded** default admin row in `initDatabase()` at [lib/db.js:439-442](lib/db.js#L439-L442) still uses `admin/admin123` as the first-login credentials; rotate immediately via `/users`.
4. NextAuth issues a **JWT** stored in an httpOnly cookie. Session shape: `{ user: { id, name, role, username } }`.

### 3.2 Roles
`admin`, `manager`, `seller`, `driver` — column `users.role`.

### 3.3 Page-level RBAC ([middleware.js](middleware.js))
```js
PAGE_ROLES = {
  '/summary'    : ['admin','manager'],
  '/purchases'  : ['admin','manager'],
  '/stock'      : ['admin','manager'],
  '/clients'    : ['admin','manager'],
  '/expenses'   : ['admin','manager'],
  '/sales'      : ['admin','manager','seller'],
  '/invoices'   : ['admin','manager','seller'],
  '/deliveries' : ['admin','manager','seller','driver'],
  '/my-bonus'   : ['seller','driver'],
  '/users'      : ['admin'],
  '/settlements': ['admin'],
}
```
- No session → redirect `/login?callbackUrl=…`
- Wrong role → redirect to that role’s default landing page
- API equivalents return `401 { error: 'غير مصرح' }`

### 3.4 Field-level rules
- **Sellers** never receive `buy_price` from `/api/products`.
- **Sellers** cannot sell below the recommended `sell_price` (server enforces).
- **Sellers** can only edit their own orders **while status = `محجوز`**.
- **Drivers** see only deliveries assigned to them; can only set status to `تم التوصيل`.

### 3.5 Sale cancellation — locked rule (v1.0)

The cancel-authority matrix is enforced by a single shared helper
[lib/cancel-rule.js](lib/cancel-rule.js) — imported from both
server routes and UI button visibility on `/sales` and
`/clients/[id]`. Defense in depth: UI hides buttons per the rule,
routes reject with `403 { error: 'ليس لديك صلاحية إلغاء هذا الطلب' }`
if somehow bypassed.

| role | `محجوز` (reserved) | `مؤكد` (confirmed) |
|---|---|---|
| admin | ✅ allowed | ✅ allowed |
| manager | ✅ allowed | ❌ **BLOCKED** |
| seller | ✅ own sale only | ❌ BLOCKED |
| driver | ❌ blocked | ❌ blocked |

A sale already in `ملغي` state is never re-cancellable by any role
(the idempotency guard in `cancelSale` — see § 6.5 — throws
`'الطلب مُلغى مسبقاً'` even for admin).

Enforcement points:
- [app/api/sales/[id]/cancel/route.js](app/api/sales/[id]/cancel/route.js) `POST` — the admin/manager cancel entry.
- [app/api/sales/route.js](app/api/sales/route.js) `DELETE` — the seller delete-own-reserved entry and secondary admin/manager path.
- [components/CancelSaleDialog.js](components/CancelSaleDialog.js) — invoked from `/sales` and `/clients/[id]`.

**Any new cancel entry point MUST import `canCancelSale` from the
helper.** Inlining the matrix anywhere else creates drift risk.
Regression coverage lives at [tests/cancel-rule-rbac.test.js](tests/cancel-rule-rbac.test.js) — 11 tests covering every cell.

---

## 4. Database — Engine & Conventions

- **Engine:** PostgreSQL on Neon (serverless), accessed through `@vercel/postgres`.
- **Schema bootstrap:** `initDatabase()` in [lib/db.js](lib/db.js) (lines 13–307) — runs on demand via `/api/init`.
- **All inserts/updates** use parameterized SQL template tags (no string concatenation → injection-safe).
- **Audit trail (project rule):** every business table carries `created_by TEXT` populated with `session.user.username`.
- **Dates** stored as `TEXT` in `YYYY-MM-DD` (no timezone — single-region assumption).
- **Reference codes** generated by `generateRefCode(prefix)` → `SL-YYYYMMDD-NNN`, `PU-…`, `DL-…`, `INV-…`.

### 4.1 Tables — full schema

#### `users`  *(authentication)*
| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `username` | TEXT UNIQUE NOT NULL | |
| `password` | TEXT NOT NULL | bcryptjs (12 rounds) |
| `name` | TEXT NOT NULL | Display name (Arabic) |
| `role` | TEXT NOT NULL DEFAULT 'seller' | admin / manager / seller / driver |
| `active` | BOOLEAN DEFAULT true | Soft delete flag |
| `created_at` | TIMESTAMP DEFAULT now() | |

#### `products`  *(inventory master)*
| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | TEXT UNIQUE NOT NULL | |
| `category` | TEXT | e.g. دراجات, بطاريات, إكسسوارات |
| `unit` | TEXT | |
| `buy_price` | REAL | **Weighted average**, recomputed on each purchase |
| `sell_price` | REAL | Recommended selling price |
| `stock` | REAL | Decremented at sale (reserved), incremented at purchase |
| `notes` | TEXT | |
| `created_by` | TEXT | |

#### `suppliers`
`id, name UNIQUE, phone, address, notes`

#### `clients`  *(customers)*
`id, name UNIQUE, phone, email, address, notes, created_by`

#### `purchases`  *(incoming inventory)*
| Column | Notes |
|---|---|
| `id`, `date`, `supplier`, `item`, `quantity`, `unit_price`, `total` | core line |
| `payment_type` | كاش / بنك (default نقدي) |
| `notes`, `ref_code` (`PU-…`), `created_by` | |

#### `sales`  *(outgoing orders)*
| Column | Notes |
|---|---|
| `id`, `date`, `client_name`, `item`, `quantity` | |
| `cost_price`, `cost_total`, `unit_price`, `total`, `profit` | profit snapshotted at sale time |
| `payment_method`, `payment_type`, `paid_amount`, `remaining` | |
| `status` | `محجوز` (reserved) → `مؤكد` (confirmed) → `ملغي` (cancelled) |
| `recommended_price` | Snapshot for bonus calc |
| `vin` | Bike serial (set at delivery) |
| `notes`, `ref_code` (`SL-…`), `created_by` | seller username |

#### `deliveries`  *(fulfillment)*
| Column | Notes |
|---|---|
| `id`, `date`, `client_name`, `client_phone`, `client_email`, `address`, `items`, `total_amount` | |
| `status` | قيد الانتظار → جاري التوصيل → تم التوصيل / ملغي |
| `driver_name`, `assigned_driver`, `notes`, `ref_code` (`DL-…`), `created_by` | |
| `sale_id` | **FK** → `sales.id` (replaced an older notes-regex link) |

#### `invoices`  *(generated only after delivery confirmed)*
`id, ref_code (INV-…), date, sale_id, delivery_id, client_name, client_phone, client_email, client_address, item, quantity, unit_price, total, payment_type, vin, seller_name, driver_name, status (مؤكد/ملغي), created_at`

#### `payments`  *(debt collection on credit sales)*
`id, date, client_name, amount, sale_id?, notes, created_by`

#### `expenses`
`id, date, category, description, amount, payment_type, notes, created_by`
Categories enumerated in [lib/utils.js](lib/utils.js) (`EXPENSE_CATEGORIES`): إيجار, رواتب, نقل وشحن, صيانة وإصلاح, تسويق وإعلان, كهرباء وماء, تأمين, أدوات ومعدات, أخرى.

#### `bonuses`  *(seller & driver commissions)*
`id, date, username, role, sale_id, delivery_id, item, quantity, recommended_price, actual_price, fixed_bonus, extra_bonus, total_bonus, settled BOOL, settlement_id`

#### `settlements`  *(payouts)*
`id, date, type (seller_payout/driver_payout/profit_distribution), username, description, amount, settled_by, notes`

#### `settings`
Key/value: `seller_bonus_fixed` (10), `seller_bonus_percentage` (50), `driver_bonus_fixed` (5).

#### `price_history`  *(audit)*
`id, date, product_name, old_buy_price, new_buy_price, old_sell_price, new_sell_price, purchase_id, changed_by`

### 4.2 AI / learning tables
| Table | Purpose |
|---|---|
| `voice_logs` | Raw transcript + normalized text per voice action |
| `ai_corrections` | (transcript, ai_output, user_correction, field_name) — fed back into next extraction prompt |
| `entity_aliases` | Learned name → entity_id mappings; indexed by `(entity_type, normalized_alias)` for O(1) match |
| `ai_patterns` | Spoken phrase → canonical value (payment types, etc.) |

### 4.3 Indexes
- All PKs auto-indexed.
- Explicit: `idx_entity_aliases_lookup ON entity_aliases(entity_type, normalized_alias)` for instant alias resolution.
- FKs `deliveries.sale_id`, `bonuses.delivery_id` are queried on join paths.

---

## 5. API Surface (`app/api/**`)

| Route | Methods | Notes |
|---|---|---|
| `/api/auth/[...nextauth]` | NextAuth | Login / session / callback |
| `/api/sales` | GET POST PUT DELETE | Sellers see only own; PUT/DELETE allowed only on `محجوز` |
| `/api/purchases` | GET POST DELETE | POST updates stock + weighted avg buy price |
| `/api/deliveries` | GET POST PUT DELETE | PUT to `تم التوصيل` triggers invoice + bonuses; `ملغي` reverses everything |
| `/api/clients` | GET POST PUT DELETE | `?withDebt=true` returns calculated debt |
| `/api/products` | GET POST PUT DELETE | `buy_price` stripped for sellers |
| `/api/suppliers` | GET POST DELETE | |
| `/api/payments` | GET POST | `?client=…` filter |
| `/api/expenses` | GET POST DELETE | |
| `/api/invoices` | GET PUT | PUT = void (admin) |
| `/api/users` | GET POST PUT DELETE | Admin only |
| `/api/bonuses` | GET | Admin all; sellers/drivers own |
| `/api/settlements` | GET POST | POST flips `bonuses.settled=true` and writes `settlement_id` |
| `/api/summary` | GET | `?from&to` — admin/manager P&L |
| `/api/settings` | GET POST | Bonus parameters |
| `/api/init` | GET POST | GET = idempotent init. POST body `{}` = same. POST `{action:'clean'\|'reset', confirm:'احذف كل البيانات نهائيا', keepLearning?:bool}` = destructive. Query-param form was removed in BUG-03. |
| `/api/voice/process` | POST | Audio → Whisper → normalize → LLM → JSON. The only voice extraction route. |
| `/api/voice/learn` | POST | Persists user corrections to `ai_corrections` + `entity_aliases` |

> Voice flow uses `/api/voice/process` exclusively. Earlier dual-route architecture
> (`/api/voice/extract` for text-only and `/api/voice/transcribe` for legacy
> Whisper-only) was removed in PERF-03 — both routes had zero `fetch()` callers.

Every handler reads `getToken()` then enforces:
1. Token exists.
2. `token.role` is in the allow-list.
3. For sellers/drivers, results are filtered by `created_by` / `assigned_driver`.

---

## 6. Business Domain & Workflows

### 6.1 Entity relationships
```
suppliers → purchases → products → price_history
                              │
                              ▼
clients ──► sales ──► deliveries ──► invoices
              │            │
              │            ├──► bonuses ──► settlements
              │            └──► (cancellation reverses all)
              ▼
           payments  (only for آجل / credit sales)
```

### 6.2 Purchase flow — `addPurchase()` ([lib/db.js:587](lib/db.js#L587))
1. Insert into `purchases`.
2. Update `products.stock += qty`.
3. Recompute `buy_price` as weighted average:
   `(stock·old + qty·new) / (stock + qty)`.
4. Insert audit row in `price_history`.

### 6.3 Sale creation — `addSale()` ([lib/db.js:718](lib/db.js#L718))
1. Snapshot `cost_price`, compute `profit`.
2. Insert with `status = 'محجوز'`.
3. **Reserve stock immediately** (`stock -= qty`) — prevents overselling even before delivery.
4. Auto-create the matching `clients` row if missing.
5. Auto-create a paired `deliveries` row with `status = 'قيد الانتظار'`, linked through `sale_id`.

> **ARC-03 note — `addClient` transaction boundary.** The `addClient()` call inside `addSale()` ([lib/db.js:762](lib/db.js#L762)) runs against the **global `sql` connection**, not the transaction client (`withTx`). This means a rolled-back `addSale` still leaves behind any newly-created client row. This is **intentional**: the comment at [lib/db.js:755-760](lib/db.js#L755-L760) documents that an orphan client row is harmless (clients are identified by `(name+phone)` OR `(name+email)` partial unique indexes, so the next retry is idempotent) and that refactoring `addClient` to accept an optional transaction client was considered but deferred. If you touch this path, either preserve the boundary (keep `addClient` on global `sql`) or thread the tx client through and update this note.

### 6.4 Delivery confirmation — `updateDelivery()` ([lib/db.js:1242](lib/db.js#L1242))
On `status → تم التوصيل`:
1. Set `sales.status = 'مؤكد'`, store VIN if provided.
2. If `payment_type ∈ {كاش, بنك}` → `paid_amount = total, remaining = 0`.
   If `آجل` → leaves debt outstanding.
3. **Generate invoice** (`INV-…`) with full client/seller/driver snapshot.
4. **Compute bonuses**:
   - Seller (`role='seller'` only): `fixed (10) + (actual − recommended) · qty · 50%`
   - Driver (`role='driver'` only): `fixed (5)`
   - Inserted into `bonuses` with `settled=false`.

### 6.5 Sale cancellation — FEAT-05 + idempotency guard

The atomic cancel helper is `cancelSale()` ([lib/db.js:979](lib/db.js#L979)),
reached via four entry points that all share the same 12-step flow:

1. `commitCancelSale` — the commit wrapper used by `/api/sales/[id]/cancel` POST
2. `previewCancelSale` — read-only preview for the `CancelSaleDialog` before confirm
3. `cancelDelivery` — used by the deliveries page admin flow
4. `voidInvoice` — used by the invoices page admin flow
5. `deleteSale` — used by the `DELETE /api/sales?id=X` route (seller + admin)

All five share the helper → any correctness fix lives in one place.

**Locked cancel rule** — role × status matrix is enforced by
[lib/cancel-rule.js](lib/cancel-rule.js). See § 3.5 for the full table.
Both `POST /api/sales/[id]/cancel` and `DELETE /api/sales` import
`canCancelSale` and reject forbidden combinations with a 403 before
the helper runs.

**Idempotency guard (Session 8 Phase 0.5 hotfix)** — `cancelSale` throws
`'الطلب مُلغى مسبقاً'` if the sale row is already `ملغي` in commit
mode. Preview mode is still allowed so the admin dialog can render the
"already cancelled" state. Without this guard, a double-cancel would
re-run Step 5 (the refund insert loop) and Step 11 (the cancellations
audit insert), doubly-negating already-refunded collections on confirmed
sales and polluting the audit table. The UI prevents double-click in
practice, but the BUG 4 submit-retry hotfix re-enables buttons after
errors so a network-slow click can race — hence the server-side guard.
Regression coverage: [tests/idempotency-double-cancel.test.js](tests/idempotency-double-cancel.test.js).

Effect on the ledger: stock is returned, sale row → `ملغي`, invoice
soft-voided (or hard-deleted in `invoiceMode='delete'`), bonuses for
that `delivery_id` are disposed per `bonusActions` (keep or remove),
an audit row is written to `cancellations`, and the payment refund
loop writes one negative-amount payment row per original collection.

### 6.6 Debt & payments

- Only sales with `payment_type = 'آجل'` accrue debt at creation time;
  any confirmed sale (including partial-cash or dpe mixed sales) can
  carry remaining balance post-delivery.
- [`sales.paid_amount`](lib/db.js) and [`sales.remaining`](lib/db.js)
  are the **ledger of truth**. They are maintained by:
  - `updateDelivery` on confirm (writes down_payment_expected)
  - `applyCollectionInTx` on every collection (writes collection rows + updates aggregates)
  - `cancelSale` on cancel (zeroes both + writes negative refund rows)
- `getClients(withDebt=true)` aggregate reads **only from the sales
  ledger** — see Bug 3 fix note below.
- Client detail page [app/clients/[id]/page.js](app/clients/[id]/page.js)
  renders client info, a full payment-registration form (FIFO +
  specific-sale picker + live TVA preview), the sales history table
  (with per-row invoice PDF and cancel buttons wired to the locked
  rule), and the payments history table (with method + linked sale id
  columns).

#### Bug 3 fix — `getClients` aggregate (v1 pre-delivery)

**FEAT-04 regression.** Pre-FEAT-04, cash/bank sales had no payment
row — money was counted by `SUM(sales.total WHERE cash/bank confirmed)`.
FEAT-04 added a `type='collection'` payment row on every delivery
confirm ([lib/db.js:2181-2194](lib/db.js#L2181-L2194)), so the legacy
aggregate started double-counting: both the sale's `total` (one branch)
AND the matching payment row (another branch). Production example: Ali
Test with one 900€ cash sale reported `totalPaid=1800`.

The fix ([lib/db.js:1395-1424](lib/db.js#L1395-L1424)) rewrites the
aggregate to read solely from the sales ledger:

```js
const totalSales = clientSales
  .filter((s) => s.status !== 'ملغي')
  .reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);

const totalPaid = clientSales
  .filter((s) => s.status === 'مؤكد')
  .reduce((sum, s) => sum + (parseFloat(s.paid_amount) || 0), 0);

const remainingDebt = clientSales
  .filter((s) => s.status === 'مؤكد' && s.payment_status !== 'paid' && s.payment_status !== 'cancelled')
  .reduce((sum, s) => sum + (parseFloat(s.remaining) || 0), 0);
```

Zero `payments` table scan — the collection rows are mirrors of
`sales.paid_amount`, not additional evidence. The sales ledger is the
single source of truth and was verified at 100% pass rate across 540
stress ops in Phase 0.5.

**Convention for future contributors:** never compute client totals by
scanning both `sales` and `payments`. Pick one source (sales for
outstanding balances, payments for audit-trail reports) and stick to it.
Regression coverage: [tests/clients-aggregate-correctness.test.js](tests/clients-aggregate-correctness.test.js) — 4 tests including the exact Ali Test 900→1800 case.

### 6.7 Bonus settlement
Admin records a payout in `/settlements`; backend updates matched bonus rows to `settled=true, settlement_id=X`.

### 6.8 Dashboard P&L (`/api/summary`)
Returns: total revenue, cost, gross profit, expenses by category, net profit, sales by client/product, delivery counts by status, total client debt — filterable by date range.

### 6.9 Bonus system — behavior and quirks

Both **seller** and **driver** bonuses are first-class rows in the `bonuses` table, distinguished by the `role` column (`'seller'` or `'driver'`). One `UNIQUE(delivery_id, role)` index prevents duplicate rows per confirmed delivery. Bonuses are created by `calculateBonusInTx()` ([lib/db.js:1704](lib/db.js#L1704)), called from a single site: `updateDelivery()` when a delivery transitions to `تم التوصيل`.

#### Formulas

- **Seller bonus:** `fixed (default 10) + max(0, actual_price − recommended_price) · quantity · percentage/100 (default 50)`. Rewards up-selling over the recommended price; the fixed portion is guaranteed.
- **Driver bonus:** flat `fixed (default 5)` per delivery. No quantity or quality multiplier.

Tuning lives in the `settings` table under `seller_bonus_fixed`, `seller_bonus_percentage`, and `driver_bonus_fixed`. Admin-editable from `/users`.

#### Role guards — the "why don't I see seller bonuses?" quirk

`calculateBonusInTx` has two guards that can silently skip bonus creation:

1. **Seller bonus fires only if** `sale.created_by` is a user whose `role` is literally `'seller'` ([lib/db.js:1727](lib/db.js#L1727)). Admin-created or manager-created sales get **no seller bonus row** — this is deliberate so managers don't collect commission on sales they entered on behalf of a seller. If you test by logging in as `admin` and creating a sale, you will see a driver bonus but no seller bonus, and the system is working as designed.

2. **Driver bonus fires only if** `deliveries.assigned_driver` is a user whose `role` is literally `'driver'` ([lib/db.js:1751](lib/db.js#L1751)). Deliveries without a real assigned driver (e.g., admin confirming a walk-in sale) get no driver bonus row.

A given confirmed sale may therefore have 0, 1, or 2 bonus rows depending on who created the sale and who delivered it. Any code that assumes "every confirmed sale has both bonuses" will be wrong in production.

#### Settlement and clawback

Bonuses are paid out via `/settlements` (admin-only). `addSettlement()` walks the recipient's unsettled bonus rows oldest-first and flips `settled=true` + `settlement_id=X`. Once settled, the money has left the business and cannot be trivially reversed — cancelling a sale with a settled bonus throws `'لا يمكن إلغاء فاتورة مرتبطة بمكافآت مُسواة بالفعل'` in `voidInvoice()` ([lib/db.js:1832-1835](lib/db.js#L1832-L1835)). The FEAT-05 cancellation helper will extend this check to all four cancel paths.

---

## 7. Voice & AI Pipeline

7-stage flow ([AI_ARCHITECTURE_REVIEW.md](AI_ARCHITECTURE_REVIEW.md) has the long version):

1. **Capture** — `VoiceButton` records WebM/Opus, max 30 s.
2. **STT** — Groq Whisper-large-v3, `language=ar`, vocabulary prompt seeded with current product/client/supplier names.
3. **Normalize** — [lib/voice-normalizer.js](lib/voice-normalizer.js): converts spoken Arabic numerals (`سبعمية وخمسين` → `750`), unifies Alif variants (`أ/إ/آ → ا`), strips Tatweel, transliterates spoken Latin (`في 20 برو` → `V20 Pro`).
4. **LLM extraction** — **Groq Llama 3.1 8B Instant** via JSON-mode (switched in PERF-03 from a dual Gemini-primary / Groq-fallback architecture — the old dual path added latency without materially improving extraction quality). Prompt is enriched with: product list, recent transactions, learned `ai_patterns`, recent `ai_corrections`.
5. **Entity resolution** — [lib/entity-resolver.js](lib/entity-resolver.js), three layers:
   - L0: O(1) lookup in `entity_aliases` (`normalized_alias` index).
   - L1: Fuse.js fuzzy + Jaro-Winkler distance.
   - L2: Context boost — recently used names rank higher.
   Final score: `0.4·fuse + 0.35·jw + 0.25·context` → `matched / ambiguous / not_found`. 5-minute Fuse index cache.
6. **Confirm** — `VoiceConfirm` modal. Fields with confidence < 0.7 are highlighted yellow; user can edit.
7. **Submit & learn** — calls the appropriate domain endpoint (`/api/sales`, …) **and** `/api/voice/learn`, which writes the correction to `ai_corrections` and upserts an alias to `entity_aliases` so future extractions improve.

> Note: feedback memory `feedback_audit_trail.md` and the recent commit `5a4f3b5` ("LLM strips Arabic prepositions") relate to this layer — the system must preserve `created_by` on every insert and the LLM must not eat prepositions like `من عند` when parsing client names.

---

## 8. Frontend Patterns

- **No global store** (no Redux/Zustand). Each page is a client component with its own `useState` + `useEffect` fetch.
- **Auth context:** `useSession()` from `next-auth/react`, provided by `Providers.js`.
- **Toasts:** `useToast()` from `Toast.js` — 4 s auto-dismiss, types `info|success|error|warning`.
- **Modals:** `ConfirmModal` (destructive actions) and `DetailModal` (view/edit).
- **Layout shell:** `AppLayout` + role-aware `Sidebar` (different link sets per role).
- **Styling:** Tailwind v4 utilities + a hand-written design system in `app/globals.css` (`.card`, `.data-table`, `.btn-primary`, …). RTL (`dir="rtl"`) and Cairo font set in `app/layout.js`.

---

## 9. Security Notes

| Area | Status |
|---|---|
| Password hashing | ✅ bcryptjs (12 rounds) |
| Session storage | ✅ httpOnly JWT cookie, NextAuth CSRF |
| SQL injection | ✅ parameterized template tags throughout `lib/db.js` |
| RBAC | ✅ middleware + per-route checks + per-row filters |
| Field exposure | ✅ `buy_price` stripped for sellers |
| Rate limiting | ⚠️ none |
| Input validation | ⚠️ ad-hoc, no Zod/Joi schemas |
| Error redaction | ⚠️ raw error strings sometimes returned |
| Admin action audit log | ⚠️ none beyond `created_by` columns |

---

## 10. Environment & Deployment

**Host:** Vercel — `https://mohammadnl.vercel.app`
**DB:** Neon PostgreSQL

`.env.local` keys:
```
POSTGRES_URL=postgresql://...
POSTGRES_URL_NON_POOLING=postgresql://...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=https://mohammadnl.vercel.app
GROQ_API_KEY=...
GEMINI_API_KEY=...
```

Run locally:
```bash
npm install
npm run dev      # next dev
npm run build    # next build
npm start        # next start
```

Database is initialized/idempotently migrated by hitting `/api/init` (admin only). Destructive operations use **POST body**, not query params (BUG-03 fix):

- `POST {}` → idempotent init (runs `CREATE TABLE IF NOT EXISTS` + safe ALTERs)
- `POST {"action":"reset","confirm":"احذف كل البيانات نهائيا"}` → full wipe. **Blocked in `NODE_ENV=production`** and requires `ALLOW_DB_RESET=true` in the env.
- `POST {"action":"clean","confirm":"احذف كل البيانات نهائيا","keepLearning":true}` → wipe business data, keep users/settings. With `keepLearning:true`, also preserves `ai_corrections`, `ai_patterns`, `entity_aliases`.

> ⚠️ Per project rule (`feedback_no_data_loss.md`): never run `action:'reset'` against a deployment with real user data. Use `action:'clean'` + `keepLearning:true` when refreshing a dev or test environment.

### 10.1 Canonical name

The project has operated under several names historically (Neon project `accounting-db`, Vercel project `mohammad_nl`, repo `zmsaddi/mohammad-nl`, seeded company `VITESSE ECO SAS`). Per ARC-05, the **canonical project name going forward is `vitesse-eco`**. New docs, branches, and scripts should use this name. The deployment URL (`mohammadnl.vercel.app`) and the Neon project name are out of scope for the docs sweep — they require infrastructure-side renames that have not been performed yet.

---

## 11. Decision-Making Process — Three-Mind Architecture

For non-trivial changes, this project uses **Three-Mind Architecture**: three perspectives collaborate before code is written.

1. **User** brings business context, real-world constraints, dialect knowledge, and final authority on what should be built.
2. **Claude (chat)** brings architectural patterns, trade-off analysis, prompt design, and synthesis across the conversation.
3. **Claude Code** brings actual code knowledge, latent bug detection, edge case awareness, and verification against the real codebase.

### When to use Three-Mind

- New features touching multiple files
- Schema changes
- Business logic involving money or persistent state
- Refactors that span more than one module
- Anything that would be hard to reverse

### When NOT to use Three-Mind

- Single-line bug fixes
- Doc-only commits
- Test additions
- Dependency updates
- Anything where designing takes longer than implementing

### The workflow

1. User proposes a feature or raises a concern
2. Chat analyzes and writes an *advisory* prompt to Claude Code (architectural questions, no code)
3. Claude Code reads the actual code, answers the questions, proposes alternatives, flags risks
4. User and chat review the architectural report together
5. User makes the final decision (chat presents trade-offs, doesn't decide unilaterally)
6. Chat writes the *implementation* prompt incorporating the agreed design
7. Claude Code executes with confidence

### Examples of Three-Mind catches

- **PERF-03**: Claude Code discovered `/api/voice/extract` was dead code before the optimization spec was applied to it, saving hours of fixing the wrong route.
- **FEAT-01**: Claude Code discovered an entity-stealing bug in `addAlias()` before the auto-generator could trigger it. The fix (separate `addGeneratedAlias()` with first-writer-wins) was designed in from day one rather than discovered as an intermittent production bug.
- **FEAT-01**: Claude Code discovered the resolver Fuse cache invalidation gap. Without `invalidateCache()` in the generator helper, freshly-added entities would be unrecognized for up to 5 minutes — an intermittent UX bug that would have been very hard to debug in production.

---

## 12. Key File Index

| File | Purpose |
|---|---|
| [lib/db.js](lib/db.js) | Schema init + every DB operation (~2600 lines) |
| [lib/auth.js](lib/auth.js) | NextAuth Credentials provider, JWT callbacks |
| [lib/cancel-rule.js](lib/cancel-rule.js) | **Locked cancel rule matrix** — `canCancelSale(sale, user)` pure function, single source of truth for sale cancellation authority. Used by both routes and UI. See § 3.5 and § 6.5. |
| [lib/use-sorted-rows.js](lib/use-sorted-rows.js) | Click-to-sort hook for list pages. Non-destructive, numeric-aware, NULL-handling. Wired to all 8 list pages. See § 17.1. |
| [lib/invoice-generator.js](lib/invoice-generator.js) | French facture HTML generator (v1: client signature block removed). |
| [lib/utils.js](lib/utils.js) | `formatNumber`, `getTodayDate`, `calculateClientDebt`, `EXPENSE_CATEGORIES`, `generateRefCode` |
| [lib/entity-resolver.js](lib/entity-resolver.js) | 3-layer fuzzy matching |
| [lib/voice-normalizer.js](lib/voice-normalizer.js) | Arabic numerals + dialect normalization |
| [middleware.js](middleware.js) | Page + API auth & RBAC |
| [app/api/sales/[id]/cancel/route.js](app/api/sales/[id]/cancel/route.js) | FEAT-05 cancel endpoint — preview + commit. Calls `canCancelSale` for 403 gating. |
| [app/api/sales/route.js](app/api/sales/route.js) | `DELETE` also uses `canCancelSale` (seller delete-own-reserved path). |
| [app/api/voice/process/route.js](app/api/voice/process/route.js) | Whisper → normalize → LLM pipeline (the only voice extraction route after PERF-03) |
| [app/api/deliveries/route.js](app/api/deliveries/route.js) | Delivery PUT triggers invoice + bonuses |
| [app/api/summary/route.js](app/api/summary/route.js) | Dashboard aggregates |
| [app/clients/[id]/page.js](app/clients/[id]/page.js) | Client detail page — profile, payment-registration form, sales + payments history tables with invoice PDF + cancel buttons. |
| [components/CancelSaleDialog.js](components/CancelSaleDialog.js) | Admin cancel dialog (preview + confirm with bonus disposition). |
| [components/VoiceButton.js](components/VoiceButton.js) | MediaRecorder UX |
| [components/VoiceConfirm.js](components/VoiceConfirm.js) | Edit + confidence review |
| [tests/cancel-rule-rbac.test.js](tests/cancel-rule-rbac.test.js) | 11-test matrix coverage for the cancel rule. |
| [tests/clients-aggregate-correctness.test.js](tests/clients-aggregate-correctness.test.js) | 4-test regression guard against Bug 3 double-count (real Neon branch). |
| [tests/idempotency-double-cancel.test.js](tests/idempotency-double-cancel.test.js) | Session 8 Phase 0.5 hotfix coverage for `cancelSale` re-execution guard. |
| [scripts/smoke-test.mjs](scripts/smoke-test.mjs) | Phase 0 production smoke (86 assertions). |
| [scripts/stress-test.mjs](scripts/stress-test.mjs) | Phase 0.5 production stress (540 ops, 6 rules, 46 assertions). |
| [README.md](README.md) / [SETUP.md](SETUP.md) / [AI_ARCHITECTURE_REVIEW.md](AI_ARCHITECTURE_REVIEW.md) | Existing docs |
| [docs/v1-pre-delivery-study.md](docs/v1-pre-delivery-study.md) | Session 9 Phase A scope study (7 items, v1.0 vs v1.1 split). |
| [docs/pre-delivery-checklist.md](docs/pre-delivery-checklist.md) | Session 10 handoff checklist. |

---

## 13. Glossary (Arabic ⇄ English)

| Arabic | English |
|---|---|
| محجوز | Reserved (sale awaiting delivery) |
| مؤكد | Confirmed (delivered) |
| ملغي | Cancelled |
| قيد الانتظار | Pending |
| جاري التوصيل | In transit |
| تم التوصيل | Delivered |
| كاش / بنك / آجل | Cash / Bank / Credit |
| نقدي | Cash (alt) |
| إيجار / رواتب / صيانة | Rent / Salaries / Maintenance |

---

## 14. Error Monitoring and Observability

### Where production errors go

Every `console.error()` in an API route handler, every unhandled
exception, and every 5xx response ends up in **Vercel Function Logs**.
There is no external error aggregator configured — the only place to
see what's going wrong in production is the Vercel dashboard.

### How to access function logs

1. https://vercel.com → Project `mohammad_nl` → **Deployments**
2. Click the most recent production deployment (the one marked
   "Production")
3. Click the **Functions** tab
4. Click any route (`/api/sales`, `/api/voice/process`, etc.)
5. Click **Logs** — shows the last ~1 hour of invocations, newest first
6. Filter by severity: `error` to isolate failures, `warn` for soft
   failures

**Shortcut:** `https://vercel.com/<team>/mohammad_nl/logs` goes
directly to the logs for the current production deploy.

**Log retention:** 1 hour on Hobby plan, 1 day on Pro, 7 days on
Enterprise. Plan accordingly — if you need longer retention, enable
Vercel's Log Drain integration to forward to an external store.

### Critical routes to watch

These are the routes where silent failures would cause the most
business damage. Monitor their error rates during the first week
after go-live.

| Route | Why it matters | BUG-02 log pattern |
|---|---|---|
| `/api/sales/[id]/cancel` | Financial state change — wrong refund = wrong client balance | `[cancel] ...` / `[sale-cancel]` |
| `/api/sales/[id]/collect` | Payment record insert — FEAT-04 collection flow | `[collect] error: ...` |
| `/api/clients/[id]/collect` | FIFO walker — multi-sale atomic transaction | `[clients/collect] error: ...` |
| `/api/voice/process` | Rate-limited, Groq failures, Whisper noise | `[voice/process] ...` |
| `/api/invoices/[id]/pdf` | PDF generation failures = lost document trail | `[Invoice PDF]` |
| `/api/auth/[...nextauth]` | Auth flow errors — wrong secret, wrong URL, JWT decode failures | Next-Auth internals (harder to grep) |
| `/api/payments` | Legacy BUG-5A guard — should fire rarely now that FEAT-04 exists | `[payments] POST:` |

### BUG-02 / BUG-07 log pattern

The codebase uses a consistent `console.error` prefix convention from
BUG-02 and BUG-07 so you can grep the logs:

```js
console.error('[sales] POST:', err);
console.error('[voice/process] context lookup:', err);
console.error('[cancel] commit error:', err);
```

When scanning Vercel logs, filter by the bracketed route tag to find
the source module. Every silent `catch` across `app/api/**` was audited
in BUG-02 and now emits a structured log line — anything that should
go wrong will leave a fingerprint.

### Known noise patterns to ignore

- `[voice/process] context lookup:` 500ms timeouts during cold starts —
  harmless, the catch block returns empty arrays and the request
  still succeeds
- `[voice/process] alias learning:` background fire-and-forget IIFE
  errors — voice still returns the parsed result, only the alias
  persistence silently fails
- `[voice/process] voice_logs insert:` non-critical logging table
  insert failures — voice still returns successfully
- `[voice/process] getTopEntities:` similar — falls back to empty
  entity list, voice still works
- Next.js 16 RSC prefetch 404s on `/login?...` — harmless client-side
  navigation noise

### When to escalate

Treat these as urgent and investigate the same day:

- **Unhandled exceptions** (not `console.error` — actual 500s with
  stack traces) — indicates a missed try/catch boundary
- **Database connection failures** (`connection refused`, `SSL handshake
  failed`, `password authentication failed`) — check Neon status page
  first, then verify `POSTGRES_URL` hasn't been rotated accidentally
- **Repeated auth failures** (429 rate-limit on CSRF, `getToken returned
  null` loops) — possible NEXTAUTH_SECRET mismatch between env var
  and signing key
- **Voice route returning 500 with `GROQ_API_KEY missing`** — the env
  var disappeared or was set for wrong scope
- **Any `BONUS_CHOICE_REQUIRED` error reaching the user as a 500** —
  the cancel dialog should catch this and show the bonus-choice UI;
  if it's 500ing, the route layer needs investigation

### v1.1 recommendation: Sentry

Proactive alerting via Vercel function logs requires opening the
dashboard and scanning. For a single-operator deployment this is
usually fine. When the user base grows past ~50 daily active users,
add Sentry free tier:

- 5,000 events/month on free tier (more than enough for this app's
  volume)
- Email alerts on unhandled exceptions
- Source maps for stack traces (trivial to configure with Next.js)
- Integration guide: https://docs.sentry.io/platforms/javascript/guides/nextjs/

**Not a v1.0 requirement** — the current `console.error` + Vercel
logs pattern is adequate for launch.

---

## 15. Accountant Compliance

**Status:** Confirmed — all four compliance questions approved.
**Confirmation date:** 2026-04-14
**Channel:** Direct accountant review (user-mediated)

### The four questions

1. **Cash-basis accounting (Q1)**
   Question: Is cash-basis accounting (recognizing profit only
   upon full collection) legally acceptable in France for an SAS?
   Answer: ✅ Approved.
   Implication: [`getSummaryData()`](lib/db.js) dual-view P&L
   (accrual + cash-basis) is legally valid. Profit recognition
   waits for `remaining = 0` on each sale. See [§ 3.5 Cash-Basis
   Accounting](#35-cash-basis-accounting) above.

2. **Proportional TVA (Q2)**
   Question: Is declaring TVA proportionally with each received
   payment (amount ÷ 6) acceptable, or must TVA be declared in
   full at delivery?
   Answer: ✅ Approved.
   Implication: Payment-time TVA calculation at
   [`lib/db.js applyCollection()`](lib/db.js) and the payment row
   insertion in `updateDelivery(confirm)` are correct. VAT is
   reported as payments arrive, not at invoice issue. The
   `totalVatCollected` aggregate in `getSummaryData()` sums
   `payments.tva_amount` in the period.

3. **Single facture, three states (Q3)**
   Question: Is one invoice number evolving through three states
   (EN ATTENTE → PARTIELLE → PAYÉE) acceptable, or must a
   Facture d'acompte be issued at delivery separately from the
   Facture définitive at full payment?
   Answer: ✅ Approved.
   Implication: [`lib/invoice-generator.js`](lib/invoice-generator.js)
   three-state rendering is legally compliant.
   [`lib/invoice-modes.js`](lib/invoice-modes.js)
   `single_facture_three_states` mode is the production mode.
   The `facture_d_acompte_separate` mode remains a
   NOT_IMPLEMENTED stub for future regulatory changes.

4. **Mentions légales (Q4)**
   Question: Does the current facture template contain all
   legally required mentions for an SAS in France (SIRET, SIREN,
   APE, TVA, IBAN, BIC, Capital social, RCS, conditions de vente,
   etc.)?
   Answer: ✅ Approved — all required mentions present.
   Implication: No changes to `lib/invoice-generator.js` needed.
   The current layout at the `generateInvoiceHTML()` function is
   legally compliant as-is.

### Compliance guarantees

- Cash-basis accounting is the production default
- TVA is declared per payment, not per invoice
- One invoice number per sale, evolving through three states
- All mentions légales present in current template
- Accountant review completed pre-delivery

### What this means for operations

- Sellers create sales with an expected down payment amount
- Drivers collect the down payment at delivery
- Admins record subsequent collections via
  `/api/sales/[id]/collect` (specific sale) or
  `/api/clients/[id]/collect` (FIFO walker across open sales)
- Profit is recognized only when a sale reaches `remaining = 0`
- VAT (20%) is tallied per collected payment for monthly
  declarations
- Invoice PDFs reflect the current state (pending / partial /
  paid) at download time

### Deferred regulatory scenarios (not active)

- **`facture_d_acompte_separate` mode:** if French regulations
  ever require separate Facture d'acompte + Facture définitive
  documents, activate the stub at
  [`lib/invoice-modes.js:28`](lib/invoice-modes.js#L28) and
  implement the two-document flow per the accountant's updated
  guidance. The stub currently throws `NOT_IMPLEMENTED` as a
  forcing function so it cannot silently bypass compliance.

---

## 16. Voice Stack (Assist Mode)

**Status:** Production-ready as assist mode.
**Decision date:** 2026-04-14
**Path:** A (ship as-is)

### Architecture

The voice stack is a five-stage pipeline:

1. **Whisper transcription** (`groq/whisper-large-v3`) —
   transcribes Arabic audio to text. Returns raw transcript.
   Rate-limited to 10 requests per 60-second rolling window per
   user at [`app/api/voice/process/route.js`](app/api/voice/process/route.js).

2. **Normalization** ([`lib/voice-normalizer.js`](lib/voice-normalizer.js))
   — cleans common Whisper errors: letter collapsing
   (`إس تي` → `ST`), number-word normalization (`خمسين` → `50`),
   whitespace fixes. Does NOT transliterate names — that happens
   at the DB boundary via `ensureLatin()`. Scope was deliberately
   shrunk during the Session 3 surgical detox pass (no more
   hardcoded Vitesse SKUs).

3. **Extraction** ([`lib/voice-prompt-builder.js`](lib/voice-prompt-builder.js)
   + Llama 3.1 8B Instant) — prompts Llama with anonymized
   few-shot examples (post-surgical-detox) to extract action type
   (sale/purchase/expense), entities (client, supplier, item),
   and numeric fields. Returns a structured JSON object matching
   `SaleSchema` / `PurchaseSchema` / `ExpenseSchema` from
   [`lib/schemas.js`](lib/schemas.js).

4. **Rule override** ([`lib/voice-action-classifier.js`](lib/voice-action-classifier.js))
   — post-LLM check for explicit verbs (`بعت` → sale, `اشتريت`
   → purchase, `دفعت` → expense) to override Llama if it
   misclassified. Zero LLM calls, deterministic. Documented gap
   with JS `\b` vs Arabic — uses substring alternation instead,
   see BUG-01d cross-reference.

5. **User review** ([`components/VoiceConfirm.js`](components/VoiceConfirm.js))
   — always-shown dialog with extracted fields. User reviews and
   corrects before save. This is the trust gate. The dialog
   cannot be bypassed — no auto-save path exists.

### Assist mode framing

The voice feature is explicitly framed as "assist mode, not
autopilot":

- VoiceConfirm dialog always shows before save (cannot be
  bypassed)
- Every field is editable by the user
- Subtitle reads: `🔬 وضع المساعد التجريبي — راجع كل حقل قبل
  الحفظ` ("Experimental assist mode — review each field before
  saving")
- Review banner shows regardless of missing_fields state (Session
  4 change)
- Backdrop click-outside is disabled (Session 7b hotfix) — users
  can't accidentally dismiss and lose voice extraction data
- Submit button resets on error (BUG 4 hotfix) so the user can
  correct and retry

Users are expected to always review voice-extracted data before
saving. The system does not auto-save any voice entry.

### Schema robustness (BUG 1 hotfix heritage)

The schema layer at [`lib/schemas.js`](lib/schemas.js) uses a
`nullable()` preprocess wrapper on all optional fields. This
means voice flows can send `null` for empty optional fields
(phone, email, address, notes) and the schemas accept them
without error. Added in the 2026-04-14 hotfix after a production
null-field rejection.

### Name normalization (BUG 5 hotfix heritage)

Client and supplier names are automatically transliterated from
Arabic to Latin at the DB boundary via `ensureLatin()` in
[`lib/db.js`](lib/db.js). Voice can extract Arabic names freely
— they land in the DB in Latin form for French invoice
compliance.

The transliteration uses a two-layer approach:
1. Dictionary lookup (~30 common names) for exact matches
2. Character-level ALA-LC fallback for unknown names

Both voice-extracted and manual entries flow through this path.
Tested with 17 unit tests in
[`tests/latin-transformation.test.js`](tests/latin-transformation.test.js).

### Known limitations

- **Duplicate-key bug:** VoiceConfirm.js emits duplicate
  camelCase + snake_case keys in the POST body (`unit_price: 600`
  AND `unitPrice: 600`). Zod strips unknown keys by default so
  this is harmless, but the VoiceConfirm submit handler should
  be cleaned up in v1.1.
- **Null vs undefined:** VoiceConfirm.js emits `null` instead
  of `undefined` for empty optional fields. The schema
  `nullable()` wrapper handles this, but cleaner is to stop
  emitting nulls in the first place. Deferred to v1.1.
- **Levantine dialect WER:** 20-30% range for Llama 3.1 8B on
  unfamiliar product names. Users should expect to correct
  product names in the dialog.
- **Audio quality dependency:** voice extraction quality depends
  on audio clarity and background noise. In a busy shop
  environment, accuracy drops.
- **Cold starts reset rate limit state** — rate limiter uses an
  in-memory `Map`, not `@vercel/kv`. Acceptable for 10-20 user
  load. Under higher load, migrate to shared state (see
  rate-limiter comment block at
  [`app/api/voice/process/route.js:19`](app/api/voice/process/route.js#L19)).

### Rate limiting

Voice endpoint (`/api/voice/process`) is rate-limited to 10
requests per 60-second rolling window, keyed by username.
Module-scoped `Map` persists across warm serverless invocations.
Cold starts reset the limiter. Adequate for 10-20 user load.

### v1.1 recommendations

- **Rewrite VoiceConfirm.js submit handler** to emit a single
  canonical camelCase shape with `undefined` for empty fields
  (removes duplicate-key and null-vs-undefined workarounds)
- **Consider Whisper large-v3-turbo** for 2-3× speedup at minor
  accuracy cost (benchmark on real Arabic audio first)
- **Add explicit "retry recording" button** if Whisper
  confidence is low
- **Consider gpt-oss-20b** with strict JSON schema for
  higher-accuracy extraction (requires measuring real Levantine
  WER first, not marketing numbers)
- **E2E voice test harness** — record 30 Arabic audio samples,
  run them through the full pipeline, assert extraction
  correctness. Deferred to v1.1 alongside VoiceConfirm rewrite.

---

## 17. v1.0 Pre-Delivery Polish (Sessions 8-9)

The comprehensive pre-delivery PR ([master `4bb7b69`](../../commit/4bb7b69))
bundles two critical production bugs and six UI/UX items into a
single deploy. This section is the "what's new for contributors"
summary — each change has a deeper reference above or in its own
file.

### 17.1 Conventions introduced

**Shared cancel-rule helper — [lib/cancel-rule.js](lib/cancel-rule.js).**
Pure function that takes `(sale, user)` and returns a boolean. Used
by both server routes and UI button visibility. See § 3.5 for the
matrix and § 6.5 for the idempotency guard. Any new cancel entry
point must import this helper — inlining the rule anywhere else
creates drift risk. 11 unit tests at [tests/cancel-rule-rbac.test.js](tests/cancel-rule-rbac.test.js).

**Sortable tables hook — [lib/use-sorted-rows.js](lib/use-sorted-rows.js).**
~75 LOC hook with a tiny API: `const { sortedRows, requestSort,
getSortIndicator } = useSortedRows(rows, defaultSort)`. Non-
destructive, numeric-aware (coerces NUMERIC-as-string from
@vercel/postgres), NULL-handling (trailing). Wired to all 8 list
pages with click-to-sort headers and ↑↓ indicators. Any new list
page should use it.

**Client-side filter bars.** `/sales`, `/clients`, and `/deliveries`
now expose filter bars (date range + entity search + status + payment
status + seller/driver dropdowns where relevant). Pattern: `useState`
per filter + inline `.filter()` on the rows array, fed into
`useSortedRows`. Client-side because row volumes are under 500 on
every page. Reference implementation is [app/sales/page.js](app/sales/page.js).
The remaining 5 list pages (purchases, expenses, settlements,
invoices, stock) are deferred to v1.1 — same pattern when added.

**Single source of truth for client aggregates.** `getClients(withDebt=true)`
now reads only from the sales ledger. Never compute client totals
by scanning both `sales` and `payments` — see § 6.6 Bug 3 fix.

### 17.2 Bugs fixed

- **Bug 1 — `/clients/[id]` string/number coercion.** Next.js 16
  `use(params).id` is always a string; the JSON payload returns
  `c.id` as a number. `Array.find((c) => c.id === id)` never matched
  → 100% of client detail pages showed "not found". Fixed at
  [app/clients/[id]/page.js:37](app/clients/[id]/page.js#L37) with
  `Number(id)`. Lesson: any future param-driven `.find` must coerce
  to the expected primitive type.

- **Bug 3 — `getClients` aggregate double-count.** See § 6.6. Ali Test
  in production reported `totalPaid=1800` for a single 900€ cash sale.

- **Bug 2 — confirmed not a bug.** The user-reported "withDebt filter
  broken" was a misread of the API contract. `withDebt` is an
  enrichment flag (populates `totalSales/totalPaid/remainingDebt`), not
  a filter. Documented in the JSDoc at [lib/db.js:1382](lib/db.js#L1382).

### 17.3 UI/UX items shipped

- **Item 1 — invoice signature.** Client signature block removed from
  [lib/invoice-generator.js](lib/invoice-generator.js). Only
  `Signature du vendeur` remains. `Mode de paiement` preserved.
  Single shared template → applies to all three invoice states.

- **Item 2 — filters on 3 pages.** Sales/clients/deliveries (see § 17.1
  convention note).

- **Item 3 — column sorting on 8 pages.** Via the shared hook.

- **Item 5a — invoice PDF button** per confirmed sale on the client
  detail page. Wired via a `LEFT JOIN invoices` added to `getSales()`
  so the payload includes `invoice_ref_code`.

- **Item 5b — cancel button** per sale on the client detail page.
  Visibility gated by `canCancelSale`.

- **Item 5c — payments history enrichment.** `payment_method` and
  `sale_id` columns added to the payments table display. Refund rows
  (negative amounts) render in red; collections in green.

### 17.4 Deferred to v1.1

**Item 4 — توزيع أرباح (profit distribution) multi-recipient split dialog.**
The `profit_distribution` settlement type already exists in the UI
and [`addSettlement`](lib/db.js#L3027) accepts it — the gap is the
multi-recipient percentage-split UI. Deferred because the business
rules are not pinned down. Seven open questions for the accountant,
documented in full at [docs/v1-pre-delivery-study.md](docs/v1-pre-delivery-study.md) § Item 4. Summary of blockers:

1. What is the "base" being distributed — gross collected revenue, net
   profit after costs, or a custom formula?
2. Should percentages be pre-configured per user (`users.profit_share`
   column) or entered per distribution?
3. Must percentages sum to exactly 100%, or can the company retain a
   share?
4. **French SAS tax treatment** — declared as bonuses (payroll, social
   charges) or dividends (annual declaration)? **← accountant question.**
5. Does profit distribution appear on the cash-basis P&L as an expense,
   or below-the-line like bonuses?
6. Recipient eligibility — admin + manager only, or any role?
7. Reversibility — can a committed profit distribution be cancelled,
   and if so, does it reverse the individual recipient rows or create
   negative settlements?

**Item 2 completion.** Filters for the remaining 5 list pages
(purchases, expenses, settlements, invoices, stock-beyond-search).
Non-blocking — same `useState` + `.filter()` + `useSortedRows` pattern.

**Voice pipeline.** See § 16 v1.1 recommendations.

### 17.5 Test count

v0.9 (Session 7) had 338 unit tests. Session 8 + Session 9 delivered:

| Session | Tests added | Total |
|---|---:|---:|
| Session 8 Phase 0.5 stress hotfix | +4 (idempotency-double-cancel) | 371 |
| Session 9 v1 pre-delivery | +15 (11 cancel-rule-rbac + 4 clients-aggregate-correctness) | **386** |

Plus non-vitest production verification:
- **Phase 0 smoke** — 86/86 assertions against production (HTTP + DB reads)
- **Phase 0.5 stress** — 46/46 assertions at 540 operations, including the
  Rule 6 idempotency regression (20 double-cancels blocked + 20
  double-confirms silent-no-op)
