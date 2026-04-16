// v1.1 S4.1 — extracted from lib/db.js. Contains initDatabase,
// resetDatabase, seedProductAliases, and the invoice sequence generator.
import { sql, ignoreExpectedDdl } from './_shared.js';

// #region INVOICE SEQUENCE

// DONE: Step 1 — atomic monthly invoice number generator.
// Returns INV-YYYYMM-NNN. Safe under concurrent serverless calls because the
// INSERT ... ON CONFLICT DO UPDATE is a single PostgreSQL statement.
/**
 * Atomic monthly invoice number generator.
 * @returns {Promise<string>} Invoice ref in `INV-YYYYMM-NNN` format.
 */
export async function getNextInvoiceNumber() {
  const now = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const dateStr = `${year}${String(month).padStart(2, '0')}`;

  const { rows } = await sql`
    INSERT INTO invoice_sequence (year, month, last_number)
    VALUES (${year}, ${month}, 1)
    ON CONFLICT (year, month)
    DO UPDATE SET last_number = invoice_sequence.last_number + 1
    RETURNING last_number
  `;
  const seq = String(rows[0].last_number).padStart(3, '0');
  return `INV-${dateStr}-${seq}`;
}

// #endregion

// #region INIT / SEED

/**
 * Drops every business table and re-runs `initDatabase()`. Destructive.
 * Gated at the route layer — see `app/api/init/route.js` (BUG-03).
 * @returns {Promise<boolean>} Resolves `true` when re-init completes.
 */
export async function resetDatabase() {
  await sql`DROP TABLE IF EXISTS purchases, sales, expenses, clients, payments, products, suppliers, deliveries, users, settings, bonuses, settlements CASCADE`;
  return initDatabase();
}

/**
 * Idempotent schema bootstrap. Creates every table, runs safe ALTER
 * migrations, seeds default settings + admin user, and fires
 * `seedProductAliases` + `autoLearnFromHistory`. Safe to call on every
 * cold start.
 * @returns {Promise<boolean>} Always `true` on success.
 */
export async function initDatabase() {
  await sql`
    CREATE TABLE IF NOT EXISTS purchases (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      supplier TEXT NOT NULL,
      item TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total REAL NOT NULL,
      payment_type TEXT DEFAULT 'كاش',
      notes TEXT DEFAULT ''
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      client_name TEXT NOT NULL,
      item TEXT NOT NULL,
      quantity REAL NOT NULL,
      cost_price REAL DEFAULT 0,
      unit_price REAL NOT NULL,
      total REAL NOT NULL,
      cost_total REAL DEFAULT 0,
      profit REAL DEFAULT 0,
      payment_method TEXT NOT NULL,
      payment_type TEXT DEFAULT 'كاش',
      paid_amount REAL DEFAULT 0,
      remaining REAL DEFAULT 0,
      status TEXT DEFAULT 'محجوز',
      notes TEXT DEFAULT ''
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_type TEXT DEFAULT 'كاش',
      notes TEXT DEFAULT ''
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT ''
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      client_name TEXT NOT NULL,
      amount REAL NOT NULL,
      sale_id INTEGER DEFAULT NULL,
      notes TEXT DEFAULT ''
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      category TEXT DEFAULT '',
      unit TEXT DEFAULT '',
      buy_price REAL DEFAULT 0,
      sell_price REAL DEFAULT 0,
      stock REAL DEFAULT 0,
      notes TEXT DEFAULT ''
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS suppliers (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT ''
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS deliveries (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      client_name TEXT NOT NULL,
      client_phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      items TEXT NOT NULL,
      total_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'قيد الانتظار',
      driver_name TEXT DEFAULT '',
      notes TEXT DEFAULT ''
    )
  `;

  // === NEW TABLES FOR ROLES & BONUSES ===

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'seller',
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS bonuses (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      sale_id INTEGER,
      delivery_id INTEGER NOT NULL,
      item TEXT DEFAULT '',
      quantity REAL DEFAULT 0,
      recommended_price REAL DEFAULT 0,
      actual_price REAL DEFAULT 0,
      fixed_bonus REAL DEFAULT 0,
      extra_bonus REAL DEFAULT 0,
      total_bonus REAL DEFAULT 0,
      settled BOOLEAN DEFAULT false,
      settlement_id INTEGER
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS settlements (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      username TEXT,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      settled_by TEXT NOT NULL,
      notes TEXT DEFAULT ''
    )
  `;

  // v1.1 F-007 — per-user bonus rate overrides. Falls back to the global
  // settings values (seller_bonus_fixed, seller_bonus_percentage,
  // driver_bonus_fixed) when no override row exists for a user.
  await sql`
    CREATE TABLE IF NOT EXISTS user_bonus_rates (
      username TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
      seller_fixed NUMERIC(19,2),
      seller_percentage NUMERIC(5,2),
      driver_fixed NUMERIC(19,2),
      updated_by TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // === SAFE MIGRATIONS (ALTER TABLE - never loses data) ===
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT DEFAULT ''`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS client_email TEXT DEFAULT ''`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS ref_code TEXT DEFAULT ''`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS ref_code TEXT DEFAULT ''`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS ref_code TEXT DEFAULT ''`.catch(ignoreExpectedDdl);
  // Audit trail - who did what
  await sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS assigned_driver TEXT DEFAULT ''`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`.catch(ignoreExpectedDdl);

  // v1.1 F-008 — updated_by / updated_at audit columns on every business
  // table. Pre-v1.1 only created_by existed; no table tracked who last
  // modified a row or when. updated_at defaults to NULL (never updated)
  // and is set to NOW() explicitly in every UPDATE that represents a
  // user-initiated edit. System-internal transitions (stock adjustments,
  // status flips from delivery confirm, etc.) set updated_by = NULL.
  const auditTables = [
    'sales', 'clients', 'products', 'purchases', 'expenses',
    'deliveries', 'payments', 'invoices', 'suppliers',
    'settlements', 'profit_distributions',
  ];
  for (const tbl of auditTables) {
    await sql.query(`ALTER TABLE "${tbl}" ADD COLUMN IF NOT EXISTS updated_by TEXT`).catch(ignoreExpectedDdl);
    await sql.query(`ALTER TABLE "${tbl}" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`).catch(ignoreExpectedDdl);
  }

  // Price history audit trail
  await sql`
    CREATE TABLE IF NOT EXISTS price_history (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      product_name TEXT NOT NULL,
      old_buy_price REAL DEFAULT 0,
      new_buy_price REAL DEFAULT 0,
      old_sell_price REAL DEFAULT 0,
      new_sell_price REAL DEFAULT 0,
      purchase_id INTEGER,
      changed_by TEXT DEFAULT ''
    )
  `.catch(ignoreExpectedDdl);

  // sale_id FK for deliveries (replaces fragile notes regex)
  await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS sale_id INTEGER DEFAULT NULL`.catch(ignoreExpectedDdl);
  // One-time backfill: extract sale_id from legacy notes for old rows that pre-date the column
  await sql`
    UPDATE deliveries
    SET sale_id = CAST(substring(notes from 'بيع رقم ([0-9]+)') AS INTEGER)
    WHERE sale_id IS NULL AND notes ~ 'بيع رقم [0-9]+'
  `.catch(ignoreExpectedDdl);
  // Prevent duplicate bonus rows on double-tap delivery confirmation
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS bonuses_delivery_role_unique ON bonuses(delivery_id, role)`.catch(ignoreExpectedDdl);
  // Unique ref_code per table — catches any race-condition duplicates at the DB level
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS sales_ref_code_unique     ON sales(ref_code)     WHERE ref_code <> ''`.catch(ignoreExpectedDdl);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS purchases_ref_code_unique ON purchases(ref_code) WHERE ref_code <> ''`.catch(ignoreExpectedDdl);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS deliveries_ref_code_unique ON deliveries(ref_code) WHERE ref_code <> ''`.catch(ignoreExpectedDdl);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS invoices_ref_code_unique  ON invoices(ref_code)  WHERE ref_code <> ''`.catch(ignoreExpectedDdl);
  // FK constraints (NOT VALID = enforced on new rows only, safe on existing data).
  // .catch(ignoreExpectedDdl) absorbs the "already exists" outcome on repeat
  // init calls while rethrowing any unexpected error — see the helper at
  // the top of this file for the accept-list.
  await sql`ALTER TABLE deliveries ADD CONSTRAINT fk_deliveries_sale     FOREIGN KEY (sale_id)     REFERENCES sales(id) ON DELETE SET NULL  NOT VALID`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE bonuses    ADD CONSTRAINT fk_bonuses_sale        FOREIGN KEY (sale_id)     REFERENCES sales(id) ON DELETE CASCADE   NOT VALID`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE bonuses    ADD CONSTRAINT fk_bonuses_delivery    FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE NOT VALID`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE invoices   ADD CONSTRAINT fk_invoices_sale       FOREIGN KEY (sale_id)     REFERENCES sales(id) ON DELETE CASCADE   NOT VALID`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE invoices   ADD CONSTRAINT fk_invoices_delivery   FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE NOT VALID`.catch(ignoreExpectedDdl);

  // DONE: Step 1 — fix client identity. Name alone is NOT a unique key:
  // two real people can share the same name. A unique client = name + phone OR name + email.
  // Drop old name-only unique, then add (name+phone) and (name+email) partial unique indexes.
  // DONE: Step 1 — per-product low-stock threshold (default 3). Product-specific so an
  // admin can set "alert me when bikes drop below 2" but "alert me when batteries drop below 10".
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 3`.catch(ignoreExpectedDdl);
  // DONE: Step 6 — purchases also store the category at the row level so the
  // purchases history report can show the category column without joining products.
  await sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS category TEXT DEFAULT ''`.catch(ignoreExpectedDdl);

  // v1.0.1 — Feature 6 supplier credit: partial payment tracking on purchases.
  // Existing rows backfill to paid_amount = total (fully paid) for backward compat.
  await sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(19,2) DEFAULT 0`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'paid'`.catch(ignoreExpectedDdl);
  // One-time backfill: any pre-existing row with paid_amount=0 gets treated
  // as fully paid (historical data was entered as total-on-delivery). New
  // rows will set paid_amount explicitly via addPurchase.
  await sql`UPDATE purchases SET paid_amount = total WHERE paid_amount = 0 AND total > 0`.catch(ignoreExpectedDdl);
  await sql`UPDATE purchases SET payment_status = CASE WHEN paid_amount >= total THEN 'paid' WHEN paid_amount > 0 THEN 'partial' ELSE 'pending' END`.catch(ignoreExpectedDdl);

  // v1.0.1 — Feature 6 audit trail for supplier incremental payments.
  // Each row in supplier_payments represents one paySupplier() call;
  // the sum across a purchase_id should equal purchases.paid_amount.
  await sql`
    CREATE TABLE IF NOT EXISTS supplier_payments (
      id SERIAL PRIMARY KEY,
      purchase_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      amount NUMERIC(19,2) NOT NULL,
      payment_method TEXT DEFAULT 'كاش',
      notes TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `.catch(ignoreExpectedDdl);
  await sql`CREATE INDEX IF NOT EXISTS supplier_payments_purchase_id_idx ON supplier_payments(purchase_id)`.catch(ignoreExpectedDdl);

  // v1.0.2 Feature 2 — profit_distributions (توزيع أرباح). One logical
  // distribution is N rows sharing the same group_id (one per recipient),
  // each with their own percentage + computed amount. base_amount is
  // denormalized onto every row so a single-row query can rebuild the
  // full distribution without a self-join. Period columns are optional
  // — they record the revenue window the distribution was computed from.
  await sql`
    CREATE TABLE IF NOT EXISTS profit_distributions (
      id SERIAL PRIMARY KEY,
      group_id TEXT NOT NULL,
      username TEXT NOT NULL,
      base_amount NUMERIC(19,2) NOT NULL,
      percentage NUMERIC(5,2) NOT NULL,
      amount NUMERIC(19,2) NOT NULL,
      base_period_start TEXT,
      base_period_end TEXT,
      notes TEXT DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `.catch(ignoreExpectedDdl);
  await sql`CREATE INDEX IF NOT EXISTS profit_distributions_group_idx ON profit_distributions(group_id)`.catch(ignoreExpectedDdl);
  await sql`CREATE INDEX IF NOT EXISTS profit_distributions_username_idx ON profit_distributions(username)`.catch(ignoreExpectedDdl);
  await sql`CREATE INDEX IF NOT EXISTS profit_distributions_created_idx ON profit_distributions(created_at DESC)`.catch(ignoreExpectedDdl);

  await sql`ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_name_key`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS latin_name TEXT DEFAULT ''`.catch(ignoreExpectedDdl);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS clients_name_phone_unique
    ON clients(name, phone)
    WHERE phone <> ''
  `.catch(ignoreExpectedDdl);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS clients_name_email_unique
    ON clients(name, email)
    WHERE email <> ''
  `.catch(ignoreExpectedDdl);

  // BUG-21: drop the supplier UNIQUE(name) constraint and replace with a
  // partial UNIQUE(name, phone) index. Lets two real suppliers share a
  // name as long as they have different phones — the ambiguity flow in
  // addSupplier() handles the name-only case by returning candidates.
  // Mirrors the clients migration above.
  await sql`ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_name_key`.catch(ignoreExpectedDdl);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS suppliers_name_phone_unique
    ON suppliers(name, phone)
    WHERE phone <> ''
  `.catch(ignoreExpectedDdl);

  // VIN + Invoices
  await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS vin TEXT DEFAULT ''`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS recommended_price REAL DEFAULT 0`.catch(ignoreExpectedDdl);
  await sql`
    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      ref_code TEXT NOT NULL,
      date TEXT NOT NULL,
      sale_id INTEGER NOT NULL,
      delivery_id INTEGER NOT NULL,
      client_name TEXT NOT NULL,
      client_phone TEXT DEFAULT '',
      client_email TEXT DEFAULT '',
      client_address TEXT DEFAULT '',
      item TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total REAL NOT NULL,
      payment_type TEXT DEFAULT 'كاش',
      vin TEXT DEFAULT '',
      seller_name TEXT DEFAULT '',
      driver_name TEXT DEFAULT '',
      status TEXT DEFAULT 'مؤكد',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `.catch(ignoreExpectedDdl);

  // Voice logs
  await sql`
    CREATE TABLE IF NOT EXISTS voice_logs (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      username TEXT NOT NULL,
      transcript TEXT DEFAULT '',
      normalized_text TEXT DEFAULT '',
      action_type TEXT DEFAULT '',
      action_id INTEGER,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `.catch(ignoreExpectedDdl);

  // AI corrections - machine learning from user edits
  await sql`
    CREATE TABLE IF NOT EXISTS ai_corrections (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      username TEXT NOT NULL,
      transcript TEXT NOT NULL,
      ai_output TEXT NOT NULL,
      user_correction TEXT NOT NULL,
      action_type TEXT NOT NULL,
      field_name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `.catch(ignoreExpectedDdl);

  // Entity aliases - learned name mappings for instant matching
  await sql`
    CREATE TABLE IF NOT EXISTS entity_aliases (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      alias TEXT NOT NULL,
      normalized_alias TEXT NOT NULL,
      source TEXT DEFAULT 'user',
      frequency INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `.catch(ignoreExpectedDdl);
  await sql`CREATE INDEX IF NOT EXISTS idx_entity_aliases_lookup ON entity_aliases(entity_type, normalized_alias)`.catch(ignoreExpectedDdl);

  // AI context - recent patterns per user
  await sql`
    CREATE TABLE IF NOT EXISTS ai_patterns (
      id SERIAL PRIMARY KEY,
      pattern_type TEXT NOT NULL,
      spoken_text TEXT NOT NULL,
      correct_value TEXT NOT NULL,
      field_name TEXT NOT NULL,
      frequency INTEGER DEFAULT 1,
      last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `.catch(ignoreExpectedDdl);
  // DONE: Step 1A — per-user patterns (username='' means a global pattern shared by all users)
  await sql`ALTER TABLE ai_patterns ADD COLUMN IF NOT EXISTS username TEXT DEFAULT ''`.catch(ignoreExpectedDdl);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_patterns_unique
    ON ai_patterns(spoken_text, correct_value, field_name, username)
  `.catch(ignoreExpectedDdl);

  // Default settings
  await sql`INSERT INTO settings (key, value) VALUES ('seller_bonus_fixed', '10') ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);
  await sql`INSERT INTO settings (key, value) VALUES ('seller_bonus_percentage', '50') ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);
  await sql`INSERT INTO settings (key, value) VALUES ('driver_bonus_fixed', '5') ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);

  // DONE: Step 1 — official Vitesse Eco SAS company data (vitesse-eco.fr/mentions-legales)
  // ON CONFLICT DO NOTHING ensures admin overrides via the settings UI are never wiped on init
  await sql`INSERT INTO settings (key, value) VALUES ('shop_name',        'VITESSE ECO SAS')                       ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);
  await sql`INSERT INTO settings (key, value) VALUES ('shop_legal_form',  'SAS')                                    ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);
  await sql`INSERT INTO settings (key, value) VALUES ('shop_siren',       '100 732 247')                            ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);
  await sql`INSERT INTO settings (key, value) VALUES ('shop_siret',       '100 732 247 00018')                      ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);
  await sql`INSERT INTO settings (key, value) VALUES ('shop_ape',         '46.90Z')                                 ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);
  await sql`INSERT INTO settings (key, value) VALUES ('shop_address',     '32 Rue du Faubourg du Pont Neuf')        ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);
  await sql`INSERT INTO settings (key, value) VALUES ('shop_city',        '86000 Poitiers, France')                 ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);
  await sql`INSERT INTO settings (key, value) VALUES ('shop_email',       'contact@vitesse-eco.fr')                 ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);
  await sql`INSERT INTO settings (key, value) VALUES ('shop_website',     'www.vitesse-eco.fr')                     ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);
  await sql`INSERT INTO settings (key, value) VALUES ('shop_vat_number',  'FR -- (à compléter)')                    ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);
  await sql`INSERT INTO settings (key, value) VALUES ('shop_iban',        'FR -- (à compléter)')                    ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);
  await sql`INSERT INTO settings (key, value) VALUES ('shop_bic',         '(à compléter)')                          ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);
  await sql`INSERT INTO settings (key, value) VALUES ('vat_rate',         '20')                                     ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);
  await sql`INSERT INTO settings (key, value) VALUES ('invoice_currency', 'EUR')                                    ON CONFLICT (key) DO NOTHING`.catch(ignoreExpectedDdl);

  // DONE: Step 1 — monthly invoice sequence (atomic increment, resets per (year, month))
  await sql`
    CREATE TABLE IF NOT EXISTS invoice_sequence (
      year        INTEGER NOT NULL,
      month       INTEGER NOT NULL,
      last_number INTEGER DEFAULT 0,
      PRIMARY KEY (year, month)
    )
  `.catch(ignoreExpectedDdl);

  // Default admin user (password: admin123)
  const bcryptjs = (await import('bcryptjs')).default;
  const adminHash = bcryptjs.hashSync('admin123', 12);
  await sql`INSERT INTO users (username, password, name, role, active) VALUES ('admin', ${adminHash}, 'المدير العام', 'admin', true) ON CONFLICT (username) DO NOTHING`.catch(ignoreExpectedDdl);

  // ═══════════════════════════════════════════════════════════════════════════
  // ARC-06: REAL → NUMERIC(19,2) migration for every money/quantity column.
  //
  // Rationale: PostgreSQL REAL is float4 (~7 significant decimal digits),
  // which is technically wrong for currency and causes sub-cent drift on
  // aggregates. Under the Sprint 3 Tier 2 cash-basis rules, VAT is computed
  // as `ttc / 6` per payment and summed across a month for the accountant's
  // declaration — that aggregation needs exact decimal arithmetic.
  //
  // NUMERIC(19,2) is PostgreSQL's fixed-point decimal: 19 total digits,
  // 2 after the decimal point. Holds amounts up to ±9.99 × 10^16, more than
  // enough for this business. NUMERIC strictly widens REAL so no data is
  // lost on the migration.
  //
  // Each ALTER is wrapped in .catch(ignoreExpectedDdl) so re-running
  // initDatabase after the migration succeeds is a silent no-op (the column
  // is already NUMERIC and Postgres returns "type is already the desired
  // type" which matches the accept-list). Any genuinely new error still
  // propagates — see the helper at the top of this file.
  //
  // ⚠ @vercel/postgres returns NUMERIC columns as STRING, not number. Every
  // arithmetic site reading one of these columns must parseFloat() it first.
  // See the consumer audit landed alongside this migration.
  // ═══════════════════════════════════════════════════════════════════════════
  // purchases
  await sql`ALTER TABLE purchases ALTER COLUMN unit_price TYPE NUMERIC(19,2) USING unit_price::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE purchases ALTER COLUMN total      TYPE NUMERIC(19,2) USING total::numeric`.catch(ignoreExpectedDdl);
  // sales (inline columns + recommended_price from an earlier ALTER)
  await sql`ALTER TABLE sales ALTER COLUMN cost_price        TYPE NUMERIC(19,2) USING cost_price::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE sales ALTER COLUMN unit_price        TYPE NUMERIC(19,2) USING unit_price::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE sales ALTER COLUMN total             TYPE NUMERIC(19,2) USING total::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE sales ALTER COLUMN cost_total        TYPE NUMERIC(19,2) USING cost_total::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE sales ALTER COLUMN profit            TYPE NUMERIC(19,2) USING profit::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE sales ALTER COLUMN paid_amount       TYPE NUMERIC(19,2) USING paid_amount::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE sales ALTER COLUMN remaining         TYPE NUMERIC(19,2) USING remaining::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE sales ALTER COLUMN quantity          TYPE NUMERIC(19,2) USING quantity::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE sales ALTER COLUMN recommended_price TYPE NUMERIC(19,2) USING recommended_price::numeric`.catch(ignoreExpectedDdl);
  // expenses
  await sql`ALTER TABLE expenses ALTER COLUMN amount TYPE NUMERIC(19,2) USING amount::numeric`.catch(ignoreExpectedDdl);
  // payments
  await sql`ALTER TABLE payments ALTER COLUMN amount TYPE NUMERIC(19,2) USING amount::numeric`.catch(ignoreExpectedDdl);
  // products
  await sql`ALTER TABLE products ALTER COLUMN buy_price  TYPE NUMERIC(19,2) USING buy_price::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE products ALTER COLUMN sell_price TYPE NUMERIC(19,2) USING sell_price::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE products ALTER COLUMN stock      TYPE NUMERIC(19,2) USING stock::numeric`.catch(ignoreExpectedDdl);
  // deliveries
  await sql`ALTER TABLE deliveries ALTER COLUMN total_amount TYPE NUMERIC(19,2) USING total_amount::numeric`.catch(ignoreExpectedDdl);
  // bonuses
  await sql`ALTER TABLE bonuses ALTER COLUMN quantity          TYPE NUMERIC(19,2) USING quantity::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE bonuses ALTER COLUMN recommended_price TYPE NUMERIC(19,2) USING recommended_price::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE bonuses ALTER COLUMN actual_price      TYPE NUMERIC(19,2) USING actual_price::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE bonuses ALTER COLUMN fixed_bonus       TYPE NUMERIC(19,2) USING fixed_bonus::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE bonuses ALTER COLUMN extra_bonus       TYPE NUMERIC(19,2) USING extra_bonus::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE bonuses ALTER COLUMN total_bonus       TYPE NUMERIC(19,2) USING total_bonus::numeric`.catch(ignoreExpectedDdl);
  // settlements
  await sql`ALTER TABLE settlements ALTER COLUMN amount TYPE NUMERIC(19,2) USING amount::numeric`.catch(ignoreExpectedDdl);
  // price_history
  await sql`ALTER TABLE price_history ALTER COLUMN old_buy_price  TYPE NUMERIC(19,2) USING old_buy_price::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE price_history ALTER COLUMN new_buy_price  TYPE NUMERIC(19,2) USING new_buy_price::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE price_history ALTER COLUMN old_sell_price TYPE NUMERIC(19,2) USING old_sell_price::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE price_history ALTER COLUMN new_sell_price TYPE NUMERIC(19,2) USING new_sell_price::numeric`.catch(ignoreExpectedDdl);
  // invoices
  await sql`ALTER TABLE invoices ALTER COLUMN quantity   TYPE NUMERIC(19,2) USING quantity::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE invoices ALTER COLUMN unit_price TYPE NUMERIC(19,2) USING unit_price::numeric`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE invoices ALTER COLUMN total      TYPE NUMERIC(19,2) USING total::numeric`.catch(ignoreExpectedDdl);

  // ═══════════════════════════════════════════════════════════════════════════
  // Sprint 3 Tier 2 — FEAT-04 schema foundations (partial payments + cash-basis)
  // ═══════════════════════════════════════════════════════════════════════════
  // sales: expected down payment at sale creation + derived payment status
  await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS down_payment_expected NUMERIC(19,2) DEFAULT 0`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_status        TEXT          DEFAULT 'pending'`.catch(ignoreExpectedDdl);
  await sql`
    ALTER TABLE sales ADD CONSTRAINT sales_payment_status_check
    CHECK (payment_status IN ('pending','partial','paid','cancelled')) NOT VALID
  `.catch(ignoreExpectedDdl);
  await sql`CREATE INDEX IF NOT EXISTS sales_payment_status_idx ON sales(payment_status)`.catch(ignoreExpectedDdl);

  // payments: distinguish collection vs refund, track payment method + TVA
  await sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS type           TEXT         DEFAULT 'collection'`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method TEXT         DEFAULT 'كاش'`.catch(ignoreExpectedDdl);
  await sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS tva_amount     NUMERIC(19,2) DEFAULT 0`.catch(ignoreExpectedDdl);
  await sql`
    ALTER TABLE payments ADD CONSTRAINT payments_type_check
    CHECK (type IN ('collection','refund','advance')) NOT VALID
  `.catch(ignoreExpectedDdl);
  await sql`
    ALTER TABLE payments ADD CONSTRAINT payments_method_check
    CHECK (payment_method IN ('كاش','بنك')) NOT VALID
  `.catch(ignoreExpectedDdl);

  // ═══════════════════════════════════════════════════════════════════════════
  // Sprint 3 Tier 2 — FEAT-05 schema foundations (atomic cancellation audit)
  // ═══════════════════════════════════════════════════════════════════════════
  await sql`
    CREATE TABLE IF NOT EXISTS cancellations (
      id                     SERIAL PRIMARY KEY,
      sale_id                INTEGER      NOT NULL,
      cancelled_by           TEXT         NOT NULL,
      cancelled_at           TIMESTAMPTZ  DEFAULT NOW(),
      reason                 TEXT         NOT NULL,
      refund_amount          NUMERIC(19,2) DEFAULT 0,
      delivery_status_before TEXT,
      bonus_status_before    TEXT,
      invoice_mode           TEXT         NOT NULL CHECK (invoice_mode IN ('soft','delete')),
      seller_bonus_kept      BOOLEAN,
      driver_bonus_kept      BOOLEAN,
      notes                  TEXT
    )
  `.catch(ignoreExpectedDdl);
  await sql`CREATE INDEX IF NOT EXISTS cancellations_sale_id_idx ON cancellations(sale_id)`.catch(ignoreExpectedDdl);

  // DONE: Fix 8 — seed common Arabic→English product aliases so the voice flow
  // works on day one without waiting for user corrections to accumulate.
  await seedProductAliases().catch(ignoreExpectedDdl);
  // DONE: Step 1E — auto-learn from existing transaction history on every cold start.
  // Idempotent: re-running will only update frequencies upward, never duplicate rows.
  await autoLearnFromHistory().catch(ignoreExpectedDdl);

  return true;
}

// DONE: Fix 8 — idempotent seeder for known Arabic spoken aliases.
// Only inserts if the corresponding English product actually exists in the DB,
// and only if the alias is not already present.
//
// PRESERVED HAND-CURATED NICKNAMES
//
// These are cultural product labels that customers and sellers actually use
// but that cannot be derived from the English name by any algorithm. They
// were collected from real customer interactions and represent local idioms,
// descriptive metaphors, and brand-specific nicknames — NOT transliterations.
//
// Mechanical transliterations like "في عشرين برو" or "إس عشرين برو" are
// generated automatically by lib/alias-generator.js when the product is
// added via addProduct(). Do NOT add mechanical transliterations here —
// they belong in the generator. FEAT-01 trimmed those entries from this list.
//
// The split is intentional and load-bearing:
//   - lib/alias-generator.js handles MECHANICAL cases (transliteration)
//   - confirmed_action learning handles IDIOMATIC cases discovered through
//     real spoken usage
//   - this hand-curated list handles DOMAIN-SPECIFIC labels that neither
//     of the other two sources can produce
/**
 * Inserts hand-curated Arabic→English product aliases for the voice flow.
 * Skips aliases whose English product does not exist in `products` and
 * those that are already registered. Idempotent.
 * @returns {Promise<void>}
 */
export async function seedProductAliases() {
  const { normalizeForMatching } = await import('../voice-normalizer');

  const KNOWN_ALIASES = [
    // V20 Mini — descriptors
    { arabic: 'الميني',         english: 'V20 Mini' },
    { arabic: 'دراجة صغيرة',    english: 'V20 Mini' },

    // V20 Pro — local nicknames + partial transliterations
    { arabic: 'الفيشن',         english: 'V20 Pro' },
    { arabic: 'في عشرين',       english: 'V20 Pro' },  // bare model, no "Pro" suffix
    { arabic: 'الفي٢٠',        english: 'V20 Pro' },  // article-prefixed Eastern numerals
    { arabic: 'البيست سيلر',    english: 'V20 Pro' },  // "the bestseller"

    // V20 Limited — descriptor
    { arabic: 'الليمتد',          english: 'V20 Limited' },
    { arabic: 'السادل الطويل',   english: 'V20 Limited' },  // "the long saddle"

    // V20 Limited Pro — descriptor
    { arabic: 'الليمتد برو',      english: 'V20 Limited Pro' },
    { arabic: 'مية كيلو',         english: 'V20 Limited Pro' },  // "100 kg" load capacity

    // S20 Pro — local nickname + bare model
    { arabic: 'إس عشرين',      english: 'S20 Pro' },  // bare model, no "Pro" suffix
    { arabic: 'السينا',         english: 'S20 Pro' },

    // V20 Cross — descriptor
    { arabic: 'الكروس',          english: 'V20 Cross' },
    { arabic: 'كروس بالسبيكر',  english: 'V20 Cross' },  // "Cross with speaker"

    // Q30 Pliable — descriptors and local nicknames
    { arabic: 'الطوي',           english: 'Q30 Pliable' },
    { arabic: 'القابلة للطي',   english: 'Q30 Pliable' },  // "the foldable one"
    { arabic: 'الطايبة',         english: 'Q30 Pliable' },

    // D50 — gendered descriptors
    { arabic: 'الليدي الكبيرة',   english: 'D50' },  // "the big lady"
    { arabic: 'للبنات الكبيرة',   english: 'D50' },  // "for older girls"

    // C28 — gendered descriptors
    { arabic: 'الليدي الصغيرة',    english: 'C28' },  // "the small lady"
    { arabic: 'للبنات الصغيرة',    english: 'C28' },  // "for younger girls"

    // EB30 — variant nickname
    { arabic: 'الدوبل',         english: 'EB30' },  // "the double" (battery)
    { arabic: 'دوبل باتري',     english: 'EB30' },

    // V20 Max — descriptors
    { arabic: 'الماكس',          english: 'V20 Max' },
    { arabic: 'للطوال',          english: 'V20 Max' },  // "for tall people"
    { arabic: 'الكبيرة 24',      english: 'V20 Max' },  // "the big 24-inch"
  ];

  for (const { arabic, english } of KNOWN_ALIASES) {
    try {
      // Find product by exact name OR by name prefix (so "V20 Pro - Noir" still matches "V20 Pro")
      const { rows: prod } = await sql`
        SELECT id FROM products
        WHERE name = ${english} OR name LIKE ${english + '%'}
        LIMIT 1
      `;
      if (!prod.length) continue;

      const entityId = prod[0].id;
      const normalizedAlias = normalizeForMatching(arabic);

      const { rows: existing } = await sql`
        SELECT id FROM entity_aliases
        WHERE entity_type = 'product' AND normalized_alias = ${normalizedAlias}
      `;
      if (existing.length === 0) {
        await sql`
          INSERT INTO entity_aliases
            (entity_type, entity_id, alias, normalized_alias, source, frequency)
          VALUES
            ('product', ${entityId}, ${arabic}, ${normalizedAlias}, 'seed', 5)
        `;
      }
    } catch (e) {
      console.error(`[seedProductAliases] Failed for "${arabic}":`, e.message);
    }
  }
}

// #endregion
