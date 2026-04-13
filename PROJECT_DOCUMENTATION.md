# Vitesse Eco — Technical Project Documentation

> Full-stack business management system for an **e-bikes, accessories & spare parts** trading business.
> Arabic-first, RTL, voice-driven data entry, multi-role RBAC, deployed on Vercel with a Neon Postgres database.

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
| **groq-sdk** | 1.1.2 | Whisper-large-v3 (Arabic STT) + Llama 3.3 70B fallback LLM |
| **@google/generative-ai** | 0.24.1 | Gemini 2.5 Flash — primary structured-extraction LLM |
| **fuse.js** | 7.3.0 | Fuzzy entity search (products / clients / suppliers) |

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
│   ├── db.js                     ~1166 lines — schema init + ALL DB ops
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
3. Hardcoded fallback `admin / admin123` if DB unreachable (dev/setup safety).
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
| `/api/init` | GET POST | `?reset=true` / `?clean=true` / `?keepLearning=true` (admin) |
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

### 6.2 Purchase flow — `addPurchase()` ([lib/db.js](lib/db.js#L317-L362))
1. Insert into `purchases`.
2. Update `products.stock += qty`.
3. Recompute `buy_price` as weighted average:
   `(stock·old + qty·new) / (stock + qty)`.
4. Insert audit row in `price_history`.

### 6.3 Sale creation — `addSale()` ([lib/db.js](lib/db.js#L379-L438))
1. Snapshot `cost_price`, compute `profit`.
2. Insert with `status = 'محجوز'`.
3. **Reserve stock immediately** (`stock -= qty`) — prevents overselling even before delivery.
4. Auto-create the matching `clients` row if missing.
5. Auto-create a paired `deliveries` row with `status = 'قيد الانتظار'`, linked through `sale_id`.

### 6.4 Delivery confirmation — `updateDelivery()` ([lib/db.js](lib/db.js#L635-L705))
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

---

## 7. Voice & AI Pipeline

7-stage flow ([AI_ARCHITECTURE_REVIEW.md](AI_ARCHITECTURE_REVIEW.md) has the long version):

1. **Capture** — `VoiceButton` records WebM/Opus, max 30 s.
2. **STT** — Groq Whisper-large-v3, `language=ar`, vocabulary prompt seeded with current product/client/supplier names.
3. **Normalize** — [lib/voice-normalizer.js](lib/voice-normalizer.js): converts spoken Arabic numerals (`سبعمية وخمسين` → `750`), unifies Alif variants (`أ/إ/آ → ا`), strips Tatweel, transliterates spoken Latin (`في 20 برو` → `V20 Pro`).
4. **LLM extraction** — Gemini 2.5 Flash via function-calling; falls back to Groq Llama 3.3 70B on failure. Prompt is enriched with: product list, recent transactions, learned `ai_patterns`, recent `ai_corrections`.
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

Database is initialized/idempotently migrated by hitting `/api/init` (admin only). `?reset=true` wipes everything; `?clean=true` keeps users; `?keepLearning=true` preserves AI tables.

> ⚠️ Per project rule (`feedback_no_data_loss.md`): never `reset=true` against a deployment with real user data. Use `clean=true` + `keepLearning=true` when refreshing.

---

## 11. Key File Index

| File | Purpose |
|---|---|
| [lib/db.js](lib/db.js) | Schema init + every DB operation (~1166 lines) |
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

## 12. Glossary (Arabic ⇄ English)

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
