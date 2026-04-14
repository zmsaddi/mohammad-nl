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
- **Sellers** can only edit/cancel their own orders **while status = `محجوز`**.
- **Drivers** see only deliveries assigned to them; can only set status to `تم التوصيل`.

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

### 6.5 Delivery cancellation
Atomic reversal: stock returned, sale → `ملغي`, invoice deleted, bonuses for that `delivery_id` deleted.

### 6.6 Debt & payments
- Only sales with `payment_type = 'آجل'` accrue debt.
- `calculateClientDebt(sales, payments)` in [lib/utils.js](lib/utils.js) — `ΣcreditSales − Σpayments`.
- Client detail page lists sales, payments, running balance.

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
| [lib/db.js](lib/db.js) | Schema init + every DB operation (~2530 lines) |
| [lib/auth.js](lib/auth.js) | NextAuth Credentials provider, JWT callbacks |
| [lib/utils.js](lib/utils.js) | `formatNumber`, `getTodayDate`, `calculateClientDebt`, `EXPENSE_CATEGORIES`, `generateRefCode` |
| [lib/entity-resolver.js](lib/entity-resolver.js) | 3-layer fuzzy matching |
| [lib/voice-normalizer.js](lib/voice-normalizer.js) | Arabic numerals + dialect normalization |
| [middleware.js](middleware.js) | Page + API auth & RBAC |
| [app/api/voice/process/route.js](app/api/voice/process/route.js) | Whisper → normalize → LLM pipeline (the only voice extraction route after PERF-03) |
| [app/api/deliveries/route.js](app/api/deliveries/route.js) | Delivery PUT triggers invoice + bonuses |
| [app/api/summary/route.js](app/api/summary/route.js) | Dashboard aggregates |
| [components/VoiceButton.js](components/VoiceButton.js) | MediaRecorder UX |
| [components/VoiceConfirm.js](components/VoiceConfirm.js) | Edit + confidence review |
| [README.md](README.md) / [SETUP.md](SETUP.md) / [AI_ARCHITECTURE_REVIEW.md](AI_ARCHITECTURE_REVIEW.md) | Existing docs |

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
