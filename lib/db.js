import { sql, db } from '@vercel/postgres';

// Generate unique reference code: SL-20260411-001XY, PU-20260411-001XY, DL-20260411-001XY
// Appends 3 random Base-36 chars so concurrent serverless invocations at the same
// millisecond still produce distinct codes (probability of collision ≈ 1/46656).
function generateRefCode(prefix) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const ts = String(Date.now()).slice(-6);
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefix}-${date}-${ts}${rand}`;
}

// Run a callback inside a single Postgres transaction. Pass the bound client to
// every query inside so all writes commit atomically (or roll back together).
async function withTx(fn) {
  const client = await db.connect();
  try {
    await client.sql`BEGIN`;
    const result = await fn(client);
    await client.sql`COMMIT`;
    return result;
  } catch (err) {
    await client.sql`ROLLBACK`.catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

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

  // === SAFE MIGRATIONS (ALTER TABLE - never loses data) ===
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT DEFAULT ''`.catch(() => {});
  await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS client_email TEXT DEFAULT ''`.catch(() => {});
  await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS ref_code TEXT DEFAULT ''`.catch(() => {});
  await sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS ref_code TEXT DEFAULT ''`.catch(() => {});
  await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS ref_code TEXT DEFAULT ''`.catch(() => {});
  // Audit trail - who did what
  await sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`.catch(() => {});
  await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`.catch(() => {});
  await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`.catch(() => {});
  await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`.catch(() => {});
  await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS assigned_driver TEXT DEFAULT ''`.catch(() => {});
  await sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`.catch(() => {});
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`.catch(() => {});
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`.catch(() => {});

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
  `.catch(() => {});

  // sale_id FK for deliveries (replaces fragile notes regex)
  await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS sale_id INTEGER DEFAULT NULL`.catch(() => {});
  // One-time backfill: extract sale_id from legacy notes for old rows that pre-date the column
  await sql`
    UPDATE deliveries
    SET sale_id = CAST(substring(notes from 'بيع رقم ([0-9]+)') AS INTEGER)
    WHERE sale_id IS NULL AND notes ~ 'بيع رقم [0-9]+'
  `.catch(() => {});
  // Prevent duplicate bonus rows on double-tap delivery confirmation
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS bonuses_delivery_role_unique ON bonuses(delivery_id, role)`.catch(() => {});
  // Unique ref_code per table — catches any race-condition duplicates at the DB level
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS sales_ref_code_unique     ON sales(ref_code)     WHERE ref_code <> ''`.catch(() => {});
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS purchases_ref_code_unique ON purchases(ref_code) WHERE ref_code <> ''`.catch(() => {});
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS deliveries_ref_code_unique ON deliveries(ref_code) WHERE ref_code <> ''`.catch(() => {});
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS invoices_ref_code_unique  ON invoices(ref_code)  WHERE ref_code <> ''`.catch(() => {});
  // FK constraints (NOT VALID = enforced on new rows only, safe on existing data).
  // .catch(() => {}) swallows "already exists" errors on repeated init calls.
  await sql`ALTER TABLE deliveries ADD CONSTRAINT fk_deliveries_sale     FOREIGN KEY (sale_id)     REFERENCES sales(id) ON DELETE SET NULL  NOT VALID`.catch(() => {});
  await sql`ALTER TABLE bonuses    ADD CONSTRAINT fk_bonuses_sale        FOREIGN KEY (sale_id)     REFERENCES sales(id) ON DELETE CASCADE   NOT VALID`.catch(() => {});
  await sql`ALTER TABLE bonuses    ADD CONSTRAINT fk_bonuses_delivery    FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE NOT VALID`.catch(() => {});
  await sql`ALTER TABLE invoices   ADD CONSTRAINT fk_invoices_sale       FOREIGN KEY (sale_id)     REFERENCES sales(id) ON DELETE CASCADE   NOT VALID`.catch(() => {});
  await sql`ALTER TABLE invoices   ADD CONSTRAINT fk_invoices_delivery   FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE NOT VALID`.catch(() => {});

  // DONE: Step 1 — fix client identity. Name alone is NOT a unique key:
  // two real people can share the same name. A unique client = name + phone OR name + email.
  // Drop old name-only unique, then add (name+phone) and (name+email) partial unique indexes.
  // DONE: Step 1 — per-product low-stock threshold (default 3). Product-specific so an
  // admin can set "alert me when bikes drop below 2" but "alert me when batteries drop below 10".
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 3`.catch(() => {});
  // DONE: Step 6 — purchases also store the category at the row level so the
  // purchases history report can show the category column without joining products.
  await sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS category TEXT DEFAULT ''`.catch(() => {});

  await sql`ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_name_key`.catch(() => {});
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS latin_name TEXT DEFAULT ''`.catch(() => {});
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS clients_name_phone_unique
    ON clients(name, phone)
    WHERE phone <> ''
  `.catch(() => {});
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS clients_name_email_unique
    ON clients(name, email)
    WHERE email <> ''
  `.catch(() => {});

  // VIN + Invoices
  await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS vin TEXT DEFAULT ''`.catch(() => {});
  await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS recommended_price REAL DEFAULT 0`.catch(() => {});
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
  `.catch(() => {});

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
  `.catch(() => {});

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
  `.catch(() => {});

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
  `.catch(() => {});
  await sql`CREATE INDEX IF NOT EXISTS idx_entity_aliases_lookup ON entity_aliases(entity_type, normalized_alias)`.catch(() => {});

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
  `.catch(() => {});
  // DONE: Step 1A — per-user patterns (username='' means a global pattern shared by all users)
  await sql`ALTER TABLE ai_patterns ADD COLUMN IF NOT EXISTS username TEXT DEFAULT ''`.catch(() => {});
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_patterns_unique
    ON ai_patterns(spoken_text, correct_value, field_name, username)
  `.catch(() => {});

  // Default settings
  await sql`INSERT INTO settings (key, value) VALUES ('seller_bonus_fixed', '10') ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('seller_bonus_percentage', '50') ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('driver_bonus_fixed', '5') ON CONFLICT (key) DO NOTHING`.catch(() => {});

  // DONE: Step 1 — official Vitesse Eco SAS company data (vitesse-eco.fr/mentions-legales)
  // ON CONFLICT DO NOTHING ensures admin overrides via the settings UI are never wiped on init
  await sql`INSERT INTO settings (key, value) VALUES ('shop_name',        'VITESSE ECO SAS')                       ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('shop_legal_form',  'SAS')                                    ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('shop_siren',       '100 732 247')                            ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('shop_siret',       '100 732 247 00018')                      ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('shop_ape',         '46.90Z')                                 ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('shop_address',     '32 Rue du Faubourg du Pont Neuf')        ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('shop_city',        '86000 Poitiers, France')                 ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('shop_email',       'contact@vitesse-eco.fr')                 ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('shop_website',     'www.vitesse-eco.fr')                     ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('shop_vat_number',  'FR -- (à compléter)')                    ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('shop_iban',        'FR -- (à compléter)')                    ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('shop_bic',         '(à compléter)')                          ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('vat_rate',         '20')                                     ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('invoice_currency', 'EUR')                                    ON CONFLICT (key) DO NOTHING`.catch(() => {});

  // DONE: Step 1 — monthly invoice sequence (atomic increment, resets per (year, month))
  await sql`
    CREATE TABLE IF NOT EXISTS invoice_sequence (
      year        INTEGER NOT NULL,
      month       INTEGER NOT NULL,
      last_number INTEGER DEFAULT 0,
      PRIMARY KEY (year, month)
    )
  `.catch(() => {});

  // Default admin user (password: admin123)
  const bcryptjs = (await import('bcryptjs')).default;
  const adminHash = bcryptjs.hashSync('admin123', 12);
  await sql`INSERT INTO users (username, password, name, role, active) VALUES ('admin', ${adminHash}, 'المدير العام', 'admin', true) ON CONFLICT (username) DO NOTHING`.catch(() => {});

  // DONE: Fix 8 — seed common Arabic→English product aliases so the voice flow
  // works on day one without waiting for user corrections to accumulate.
  await seedProductAliases().catch(() => {});
  // DONE: Step 1E — auto-learn from existing transaction history on every cold start.
  // Idempotent: re-running will only update frequencies upward, never duplicate rows.
  await autoLearnFromHistory().catch(() => {});

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
  const { normalizeForMatching } = await import('./voice-normalizer');

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

// #region PURCHASES

/**
 * @returns {Promise<Array<object>>} All purchase rows, newest first.
 */
export async function getPurchases() {
  const { rows } = await sql`SELECT * FROM purchases ORDER BY id DESC`;
  return rows;
}

/**
 * Insert a purchase and update the product's weighted-average buy price,
 * sell price, and stock inside a single transaction. Creates the product
 * row if it does not yet exist. Writes a `price_history` audit row.
 * @param {{date:string, supplier:string, item:string, category?:string,
 *   quantity:number|string, unitPrice:number|string, sellPrice?:number|string,
 *   paymentType?:string, createdBy?:string, notes?:string}} data
 * @returns {Promise<number>} The new purchase id.
 */
export async function addPurchase(data) {
  const qty = parseFloat(data.quantity) || 0;
  const price = parseFloat(data.unitPrice) || 0;
  const sellPriceProvided = parseFloat(data.sellPrice) || 0;
  if (qty <= 0) throw new Error('الكمية لازم تكون أكبر من 0');
  if (price <= 0) throw new Error('السعر لازم يكون أكبر من 0');
  const total = qty * price;
  const refCode = generateRefCode('PU');
  const today = new Date().toISOString().split('T')[0];

  return withTx(async (client) => {
    // Lock the product row (if it exists) to serialize concurrent purchases of the same item
    const { rows: oldProduct } = await client.sql`
      SELECT buy_price, sell_price, stock FROM products WHERE name = ${data.item} FOR UPDATE
    `;
    const exists = oldProduct.length > 0;
    const oldBuy = exists ? oldProduct[0].buy_price : 0;
    const oldSell = exists ? oldProduct[0].sell_price : 0;
    const oldStock = exists ? oldProduct[0].stock : 0;

    // Insert the purchase row — DONE: Step 6 stores category alongside the purchase
    const { rows } = await client.sql`
      INSERT INTO purchases (date, supplier, item, category, quantity, unit_price, total, payment_type, ref_code, created_by, notes)
      VALUES (${data.date}, ${data.supplier}, ${data.item}, ${data.category || ''}, ${qty}, ${price}, ${total}, ${data.paymentType || 'كاش'}, ${refCode}, ${data.createdBy || ''}, ${data.notes || ''})
      RETURNING id, ref_code
    `;

    if (!exists) {
      // First time we see this product — create it with the purchase price + category
      await client.sql`
        INSERT INTO products (name, category, buy_price, sell_price, stock, created_by)
        VALUES (${data.item}, ${data.category || ''}, ${price}, ${sellPriceProvided > 0 ? sellPriceProvided : 0}, ${qty}, ${data.createdBy || ''})
      `;
    } else {
      // Weighted average cost: (old_stock * old_price + new_qty * new_price) / (old_stock + new_qty)
      const newStock = oldStock + qty;
      const newBuy = newStock > 0 ? (oldStock * oldBuy + qty * price) / newStock : price;
      const newSell = sellPriceProvided > 0 ? sellPriceProvided : oldSell;
      await client.sql`
        UPDATE products
        SET buy_price = ${newBuy}, sell_price = ${newSell}, stock = ${newStock}
        WHERE name = ${data.item}
      `;
    }

    // Audit price change
    const { rows: newProduct } = await client.sql`SELECT buy_price, sell_price FROM products WHERE name = ${data.item}`;
    if (newProduct.length > 0) {
      await client.sql`
        INSERT INTO price_history (date, product_name, old_buy_price, new_buy_price, old_sell_price, new_sell_price, purchase_id, changed_by)
        VALUES (${today}, ${data.item}, ${oldBuy}, ${newProduct[0].buy_price}, ${oldSell}, ${newProduct[0].sell_price}, ${rows[0].id}, ${data.createdBy || ''})
      `;
    }

    return rows[0].id;
  });
}

/**
 * Delete a purchase and reverse its effect on stock + weighted-average
 * buy price. Throws (Arabic message) if the current stock is already
 * lower than the purchased quantity (part of the batch already sold).
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deletePurchase(id) {
  return withTx(async (client) => {
    const { rows: purchaseRows } = await client.sql`SELECT * FROM purchases WHERE id = ${id} FOR UPDATE`;
    if (!purchaseRows.length) return;
    const p = purchaseRows[0];
    const qty = parseFloat(p.quantity) || 0;
    const price = parseFloat(p.unit_price) || 0;

    // Reverse stock and weighted-average buy price atomically
    if (qty > 0) {
      const { rows: prodRows } = await client.sql`
        SELECT stock, buy_price FROM products WHERE name = ${p.item} FOR UPDATE
      `;
      if (prodRows.length) {
        const curStock = parseFloat(prodRows[0].stock) || 0;
        const curBuy = parseFloat(prodRows[0].buy_price) || 0;
        if (qty > curStock) {
          throw new Error(`لا يمكن حذف المشترى - المخزون الحالي (${curStock}) أقل من كمية المشترى (${qty}) - بيع جزء منه بالفعل`);
        }
        const newStock = curStock - qty;
        // Reverse weighted average: solve for the previous buy_price.
        // curBuy = (newStock * prevBuy + qty * price) / curStock  →  prevBuy = (curBuy * curStock - qty * price) / newStock
        const newBuy = newStock > 0 ? Math.max(0, (curBuy * curStock - qty * price) / newStock) : 0;
        await client.sql`
          UPDATE products SET stock = ${newStock}, buy_price = ${newBuy} WHERE name = ${p.item}
        `;
        const today = new Date().toISOString().split('T')[0];
        await client.sql`
          INSERT INTO price_history (date, product_name, old_buy_price, new_buy_price, old_sell_price, new_sell_price, purchase_id, changed_by)
          VALUES (${today}, ${p.item}, ${curBuy}, ${newBuy}, 0, 0, ${id}, 'reversal')
        `.catch(() => {});
      }
    }

    await client.sql`DELETE FROM purchases WHERE id = ${id}`;
  });
}

// #endregion

// #region SALES

/**
 * @param {string} [clientName] If provided, filters to this client only.
 * @returns {Promise<Array<object>>} Sales rows, newest first.
 */
export async function getSales(clientName) {
  if (clientName) {
    const { rows } = await sql`SELECT * FROM sales WHERE client_name = ${clientName} ORDER BY id DESC`;
    return rows;
  }
  const { rows } = await sql`SELECT * FROM sales ORDER BY id DESC`;
  return rows;
}

/**
 * Create a reserved sale: atomically reserves stock, inserts the sale
 * row, upserts the client (via `addClient`), and creates a linked
 * delivery row (`قيد الانتظار`). Throws (Arabic) on oversell or on
 * ambiguous client identity (same name, no phone/email).
 * @param {{date:string, clientName:string, item:string,
 *   quantity:number|string, unitPrice:number|string, paymentType?:string,
 *   clientPhone?:string, clientEmail?:string, clientAddress?:string,
 *   createdBy?:string, notes?:string}} data
 * @returns {Promise<{saleId:number, deliveryId:number, refCode:string}>}
 */
export async function addSale(data) {
  const qty = parseFloat(data.quantity) || 0;
  const sellPrice = parseFloat(data.unitPrice) || 0;
  if (qty <= 0) throw new Error('الكمية لازم تكون أكبر من 0');
  if (sellPrice <= 0) throw new Error('السعر لازم يكون أكبر من 0');
  const total = qty * sellPrice;

  // ALL sales start unpaid - payment confirmed after delivery.
  // كاش/بنك: يتحول لمدفوع عند تأكيد التوصيل. آجل: يبقى دين بعد التوصيل.
  const validPayments = ['كاش', 'بنك', 'آجل'];
  const paymentType = validPayments.includes(data.paymentType) ? data.paymentType : 'كاش';

  return withTx(async (client) => {
    // Atomic check + reserve: row-level lock prevents concurrent oversell
    const { rows: prodRows } = await client.sql`
      SELECT buy_price, sell_price, stock FROM products WHERE name = ${data.item} FOR UPDATE
    `;
    if (prodRows.length === 0) throw new Error('المنتج غير موجود');
    const currentStock = parseFloat(prodRows[0].stock) || 0;
    if (qty > currentStock) {
      throw new Error(`الكمية المطلوبة (${qty}) أكبر من المخزون المتاح (${currentStock})`);
    }
    const costPrice = parseFloat(prodRows[0].buy_price) || 0;
    const recommendedPrice = parseFloat(prodRows[0].sell_price) || 0;
    const costTotal = qty * costPrice;
    const profit = total - costTotal;

    await client.sql`UPDATE products SET stock = stock - ${qty}::real WHERE name = ${data.item}`;

    const saleRef = generateRefCode('SL');
    const { rows } = await client.sql`
      INSERT INTO sales (date, client_name, item, quantity, cost_price, unit_price, total, cost_total, profit, payment_method, payment_type, paid_amount, remaining, status, ref_code, created_by, recommended_price, notes)
      VALUES (${data.date}, ${data.clientName}, ${data.item}, ${qty}, ${costPrice}, ${sellPrice}, ${total}, ${costTotal}, ${profit}, ${paymentType}, ${paymentType}, 0, ${total}, 'محجوز', ${saleRef}, ${data.createdBy || ''}, ${recommendedPrice}, ${data.notes || ''})
      RETURNING id
    `;
    const saleId = rows[0].id;

    // DONE: Step 3 — Upsert via addClient() with proper identity check.
    // The previous ON CONFLICT (name) relied on the now-dropped UNIQUE(name).
    // addClient() identifies clients by (name + phone) OR (name + email) and throws
    // an Arabic error if the same name exists multiple times with no contact info.
    // Note: addClient uses the global sql connection, not the transaction client —
    // an orphan client row from a rolled-back sale is harmless and idempotent on retry.
    if (data.clientName) {
      const clientResult = await addClient({
        name:      data.clientName,
        phone:     data.clientPhone   || '',
        email:     data.clientEmail   || '',
        address:   data.clientAddress || '',
        createdBy: data.createdBy     || '',
      });
      if (clientResult.ambiguous) {
        throw new Error(
          `يوجد عملاء متعددون باسم "${data.clientName}" — يجب إضافة رقم هاتف أو إيميل للتمييز`
        );
      }
    }

    // Auto-create delivery linked by sale_id
    const delRef = generateRefCode('DL');
    const { rows: delRows } = await client.sql`
      INSERT INTO deliveries (date, client_name, client_phone, client_email, address, items, total_amount, status, driver_name, ref_code, created_by, sale_id, notes)
      VALUES (${data.date}, ${data.clientName}, ${data.clientPhone || ''}, ${data.clientEmail || ''}, ${data.clientAddress || ''}, ${data.item + ' (' + qty + ')'}, ${total}, 'قيد الانتظار', '', ${delRef}, ${data.createdBy || ''}, ${saleId}, ${'بيع رقم ' + saleId})
      RETURNING id, ref_code
    `;

    return { saleId, deliveryId: delRows[0].id, refCode: saleRef };
  });
}

/**
 * Delete a sale and cascade-clean its bonuses, invoices, and linked
 * deliveries inside a single transaction. Returns stock unless the
 * sale was already `ملغي`.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteSale(id) {
  return withTx(async (client) => {
    const { rows: saleData } = await client.sql`SELECT item, quantity, status FROM sales WHERE id = ${id} FOR UPDATE`;
    if (!saleData.length) return;
    if (saleData[0].status !== 'ملغي') {
      const qty = parseFloat(saleData[0].quantity) || 0;
      if (qty > 0) {
        await client.sql`UPDATE products SET stock = stock + ${qty}::real WHERE name = ${saleData[0].item}`;
      }
    }
    // Cascade clean-up — all in the same transaction so a failure rolls back the stock return
    await client.sql`DELETE FROM bonuses WHERE sale_id = ${id}`;
    await client.sql`DELETE FROM invoices WHERE sale_id = ${id}`;
    await client.sql`DELETE FROM deliveries WHERE sale_id = ${id}`;
    await client.sql`DELETE FROM sales WHERE id = ${id}`;
  });
}

// #endregion

// #region EXPENSES

/**
 * @returns {Promise<Array<object>>} All expense rows, newest first.
 */
export async function getExpenses() {
  const { rows } = await sql`SELECT * FROM expenses ORDER BY id DESC`;
  return rows;
}

/**
 * @param {{date:string, category:string, description:string,
 *   amount:number|string, paymentType?:string, createdBy?:string,
 *   notes?:string}} data
 * @returns {Promise<number>} The new expense id.
 */
export async function addExpense(data) {
  if ((parseFloat(data.amount) || 0) <= 0) throw new Error('المبلغ لازم يكون أكبر من 0');
  const validPay = ['كاش', 'بنك'];
  const { rows } = await sql`
    INSERT INTO expenses (date, category, description, amount, payment_type, created_by, notes)
    VALUES (${data.date}, ${data.category}, ${data.description}, ${data.amount}, ${validPay.includes(data.paymentType) ? data.paymentType : 'كاش'}, ${data.createdBy || ''}, ${data.notes || ''})
    RETURNING id
  `;
  return rows[0].id;
}

/**
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteExpense(id) {
  await sql`DELETE FROM expenses WHERE id = ${id}`;
}

// #endregion

// #region CLIENTS

/**
 * @param {boolean} [withDebt=false] When `true`, computes
 *   `totalSales`, `totalPaid`, `remainingDebt` per client using a
 *   debt model that only counts confirmed credit sales.
 * @returns {Promise<Array<object>>}
 */
export async function getClients(withDebt = false) {
  const { rows: clients } = await sql`SELECT * FROM clients ORDER BY id DESC`;

  if (!withDebt) return clients;

  const { rows: sales } = await sql`SELECT * FROM sales`;
  const { rows: payments } = await sql`SELECT * FROM payments`;

  return clients.map((client) => {
    const clientSales = sales.filter((s) => s.client_name === client.name);
    const clientPayments = payments.filter((p) => p.client_name === client.name);

    const totalSales = clientSales.reduce((sum, s) => sum + (s.total || 0), 0);

    // Only confirmed (مؤكد) credit sales constitute real debt.
    // Cancelled (ملغي) sales had their paid_amount reset to 0, so without this
    // filter they would permanently inflate the client's debt balance.
    // Reserved (محجوز) sales are not yet delivered — no obligation has been met.
    const totalCreditSales = clientSales
      .filter((s) => s.payment_type === 'آجل' && s.status === 'مؤكد')
      .reduce((sum, s) => sum + (s.total || 0), 0);
    const totalPaidAtSale = clientSales
      .filter((s) => s.payment_type === 'آجل' && s.status === 'مؤكد')
      .reduce((sum, s) => sum + (s.paid_amount || 0), 0);
    const totalLaterPayments = clientPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

    const totalPaid = clientSales
      .filter((s) => ['كاش', 'بنك'].includes(s.payment_type) && s.status === 'مؤكد')
      .reduce((sum, s) => sum + (s.total || 0), 0) + totalPaidAtSale + totalLaterPayments;

    const remainingDebt = Math.max(0, totalCreditSales - totalPaidAtSale - totalLaterPayments);

    return { ...client, totalSales, totalPaid, remainingDebt };
  });
}

// DONE: Step 4 — best-effort transliteration of common Arabic names to Latin script.
// Used to seed clients.latin_name on insert (for European invoices). It's only a starting
// guess — admin can hand-correct any client's latin_name later through the clients UI.
function generateLatinName(arabicName) {
  if (!arabicName) return '';

  const nameMap = {
    'محمد': 'Mohammad', 'أحمد': 'Ahmad', 'خالد': 'Khaled',
    'عبدالله': 'Abdullah', 'عبد الله': 'Abdullah',
    'يوسف': 'Youssef', 'علي': 'Ali', 'حسن': 'Hassan',
    'حسين': 'Hussein', 'إبراهيم': 'Ibrahim', 'ابراهيم': 'Ibrahim',
    'عمر': 'Omar', 'سعد': 'Saad', 'فهد': 'Fahad',
    'سلطان': 'Sultan', 'منصور': 'Mansour', 'ناصر': 'Nasser',
    'طارق': 'Tariq', 'وليد': 'Walid', 'كريم': 'Karim',
    'سامي': 'Sami', 'رامي': 'Rami', 'باسم': 'Bassem',
    'زياد': 'Ziad', 'نادر': 'Nader', 'هاني': 'Hani',
    'ماهر': 'Maher', 'جمال': 'Jamal', 'أسامة': 'Osama',
    'فيصل': 'Faisal', 'تركي': 'Turki', 'بندر': 'Bandar',
    'عبدالرحمن': 'Abdulrahman', 'عبد الرحمن': 'Abdulrahman',
    'عبدالعزيز': 'Abdulaziz', 'عبد العزيز': 'Abdulaziz',
    // Last / family names
    'الأحمد': 'Al-Ahmad', 'الخالدي': 'Al-Khalidi',
    'العمري': 'Al-Omari', 'الحسن': 'Al-Hassan',
    'المحمد': 'Al-Mohammad',
  };

  const words = arabicName.trim().split(/\s+/);
  const latinWords = words.map((word) => {
    if (nameMap[word]) return nameMap[word];
    if (word.startsWith('ال') && nameMap[word]) return nameMap[word];
    if (word.startsWith('ال')) return 'Al-' + word.slice(2);
    return word; // unknown word — keep as-is until corrected
  });

  return latinWords.join(' ');
}

// DONE: Step 2 — addClient now uses (name + phone) OR (name + email) as the identity key.
// If the caller provides only a name and that name already exists in the table, we return
// an `ambiguous` signal so the caller (UI / addSale) can ask the user to disambiguate
// instead of silently merging two real people into one record.
/**
 * Upsert a client using (name + phone) OR (name + email) as the
 * identity key. If only a name is provided and that name already
 * exists in the table, returns an `ambiguous` signal so the caller
 * can prompt for disambiguation instead of silently merging two
 * real people.
 * @param {{name:string, phone?:string, email?:string, address?:string,
 *   latinName?:string, createdBy?:string, notes?:string}} data
 * @returns {Promise<{id?:number, exists?:boolean, ambiguous?:boolean,
 *   candidates?:Array<object>, message?:string}>}
 */
export async function addClient(data) {
  // Step 1 — try to find existing client by name + phone
  if (data.phone && data.phone.trim() !== '') {
    const { rows } = await sql`
      SELECT id FROM clients
      WHERE name = ${data.name} AND phone = ${data.phone}
    `;
    if (rows.length > 0) {
      await sql`
        UPDATE clients SET
          email   = CASE WHEN ${data.email || ''}   <> '' THEN ${data.email || ''}   ELSE email   END,
          address = CASE WHEN ${data.address || ''} <> '' THEN ${data.address || ''} ELSE address END
        WHERE id = ${rows[0].id}
      `;
      return { id: rows[0].id, exists: true };
    }
  }

  // Step 2 — try to find existing client by name + email
  if (data.email && data.email.trim() !== '') {
    const { rows } = await sql`
      SELECT id FROM clients
      WHERE name = ${data.name} AND email = ${data.email}
    `;
    if (rows.length > 0) {
      await sql`
        UPDATE clients SET
          phone   = CASE WHEN ${data.phone || ''}   <> '' THEN ${data.phone || ''}   ELSE phone   END,
          address = CASE WHEN ${data.address || ''} <> '' THEN ${data.address || ''} ELSE address END
        WHERE id = ${rows[0].id}
      `;
      return { id: rows[0].id, exists: true };
    }
  }

  // Step 3 — caller gave only a name and the same name already exists.
  // Return an ambiguous signal so the UI can ask for phone/email instead of guessing.
  if (!data.phone && !data.email) {
    const { rows } = await sql`
      SELECT id, name, phone, email FROM clients
      WHERE name = ${data.name}
      LIMIT 5
    `;
    if (rows.length > 0) {
      return {
        ambiguous: true,
        candidates: rows,
        message: `يوجد ${rows.length} عميل باسم "${data.name}" — أضف رقم هاتف أو إيميل للتمييز`,
      };
    }
  }

  // Step 4 — genuinely new client → insert with auto-generated latin_name
  const { rows } = await sql`
    INSERT INTO clients (name, phone, address, email, latin_name, created_by, notes)
    VALUES (
      ${data.name},
      ${data.phone || ''},
      ${data.address || ''},
      ${data.email || ''},
      ${data.latinName || generateLatinName(data.name)},
      ${data.createdBy || ''},
      ${data.notes || ''}
    )
    RETURNING id
  `;
  // FEAT-01: auto-generate Arabic aliases for cold-start voice recognition.
  // Only fires in the "genuinely new client" branch — NOT in the update
  // branches above. Re-generating aliases on every contact-info update would
  // explode the alias count for no benefit.
  await generateAndPersistAliases('client', rows[0].id, data.name);
  return { id: rows[0].id };
}

/**
 * @param {{id:number, name:string, phone?:string, address?:string,
 *   email?:string, notes?:string}} data
 * @returns {Promise<void>}
 */
export async function updateClient(data) {
  await sql`
    UPDATE clients SET name = ${data.name}, phone = ${data.phone || ''}, address = ${data.address || ''}, email = ${data.email || ''}, notes = ${data.notes || ''}
    WHERE id = ${data.id}
  `;
}

/**
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteClient(id) {
  await sql`DELETE FROM clients WHERE id = ${id}`;
}

// #endregion

// #region PAYMENTS

/**
 * @param {string} [clientName] If provided, filters to this client only.
 * @returns {Promise<Array<object>>}
 */
export async function getPayments(clientName) {
  if (clientName) {
    const { rows } = await sql`SELECT * FROM payments WHERE client_name = ${clientName} ORDER BY id DESC`;
    return rows;
  }
  const { rows } = await sql`SELECT * FROM payments ORDER BY id DESC`;
  return rows;
}

/**
 * @param {{date:string, clientName:string, amount:number|string,
 *   saleId?:number|null, createdBy?:string, notes?:string}} data
 * @returns {Promise<number>} The new payment id.
 */
export async function addPayment(data) {
  const { rows } = await sql`
    INSERT INTO payments (date, client_name, amount, sale_id, created_by, notes)
    VALUES (${data.date}, ${data.clientName}, ${data.amount}, ${data.saleId || null}, ${data.createdBy || ''}, ${data.notes || ''})
    RETURNING id
  `;
  return rows[0].id;
}

// #endregion

// #region PRODUCTS

/**
 * @returns {Promise<Array<object>>} Products ordered by name ASC.
 */
export async function getProducts() {
  const { rows } = await sql`SELECT * FROM products ORDER BY name`;
  return rows;
}

/**
 * Insert a product if its name is new; otherwise return the existing
 * row's id with `exists: true`.
 * @param {{name:string, category?:string, unit?:string,
 *   buyPrice?:number|string, sellPrice?:number|string,
 *   stock?:number|string, createdBy?:string, notes?:string}} data
 * @returns {Promise<{id:number, exists?:boolean}>}
 */
export async function addProduct(data) {
  const { rows: existing } = await sql`SELECT id FROM products WHERE name = ${data.name}`;
  if (existing.length > 0) return { id: existing[0].id, exists: true };

  const { rows } = await sql`
    INSERT INTO products (name, category, unit, buy_price, sell_price, stock, created_by, notes)
    VALUES (${data.name}, ${data.category || ''}, ${data.unit || ''}, ${data.buyPrice || 0}, ${data.sellPrice || 0}, ${data.stock || 0}, ${data.createdBy || ''}, ${data.notes || ''})
    RETURNING id
  `;
  // FEAT-01: auto-generate Arabic aliases for cold-start voice recognition.
  await generateAndPersistAliases('product', rows[0].id, data.name);
  return { id: rows[0].id };
}

/**
 * Delete a product. Refuses (Arabic throw) if any historical sale or
 * purchase still references it by name, or if remaining stock > 0.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteProduct(id) {
  // Refuse to delete if any sale or purchase still references this product by name —
  // historical reports would otherwise show "ghost" rows that can't be linked back.
  const { rows: prod } = await sql`SELECT name, stock FROM products WHERE id = ${id}`;
  if (!prod.length) return;
  const name = prod[0].name;
  const stockLeft = parseFloat(prod[0].stock) || 0;
  if (stockLeft > 0) {
    throw new Error(`لا يمكن حذف منتج فيه مخزون متبقي (${stockLeft})`);
  }
  const { rows: salesUse } = await sql`SELECT 1 FROM sales WHERE item = ${name} LIMIT 1`;
  if (salesUse.length) throw new Error('لا يمكن حذف منتج مرتبط بمبيعات سابقة');
  const { rows: purchasesUse } = await sql`SELECT 1 FROM purchases WHERE item = ${name} LIMIT 1`;
  if (purchasesUse.length) throw new Error('لا يمكن حذف منتج مرتبط بمشتريات سابقة');
  await sql`DELETE FROM products WHERE id = ${id}`;
}

// #endregion

// #region SUPPLIERS

/**
 * @returns {Promise<Array<object>>} Suppliers ordered by name ASC.
 */
export async function getSuppliers() {
  const { rows } = await sql`SELECT * FROM suppliers ORDER BY name`;
  return rows;
}

/**
 * Insert a supplier if its name is new; otherwise return the existing
 * row's id with `exists: true`.
 * @param {{name:string, phone?:string, address?:string, notes?:string}} data
 * @returns {Promise<{id:number, exists?:boolean}>}
 */
export async function addSupplier(data) {
  const { rows: existing } = await sql`SELECT id FROM suppliers WHERE name = ${data.name}`;
  if (existing.length > 0) return { id: existing[0].id, exists: true };

  const { rows } = await sql`
    INSERT INTO suppliers (name, phone, address, notes)
    VALUES (${data.name}, ${data.phone || ''}, ${data.address || ''}, ${data.notes || ''})
    RETURNING id
  `;
  // FEAT-01: auto-generate Arabic aliases for cold-start voice recognition.
  await generateAndPersistAliases('supplier', rows[0].id, data.name);
  return { id: rows[0].id };
}

/**
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteSupplier(id) {
  await sql`DELETE FROM suppliers WHERE id = ${id}`;
}

// #endregion

// #region DELIVERIES

// BUG 3A — accepts createdBy as a third filter so the seller scope can be
// pushed down to SQL instead of being applied in JavaScript after the fetch.
/**
 * List deliveries with optional SQL-side filtering. Filters combine
 * where sensible (`status + assignedDriver`, `status + createdBy`),
 * otherwise apply individually.
 * @param {string} [status]
 * @param {string} [assignedDriver]
 * @param {string} [createdBy]
 * @returns {Promise<Array<object>>}
 */
export async function getDeliveries(status, assignedDriver, createdBy) {
  if (status && assignedDriver) {
    const { rows } = await sql`SELECT * FROM deliveries WHERE status = ${status} AND assigned_driver = ${assignedDriver} ORDER BY id DESC`;
    return rows;
  }
  if (status && createdBy) {
    const { rows } = await sql`SELECT * FROM deliveries WHERE status = ${status} AND created_by = ${createdBy} ORDER BY id DESC`;
    return rows;
  }
  if (assignedDriver) {
    const { rows } = await sql`SELECT * FROM deliveries WHERE assigned_driver = ${assignedDriver} ORDER BY id DESC`;
    return rows;
  }
  if (createdBy) {
    const { rows } = await sql`SELECT * FROM deliveries WHERE created_by = ${createdBy} ORDER BY id DESC`;
    return rows;
  }
  if (status) {
    const { rows } = await sql`SELECT * FROM deliveries WHERE status = ${status} ORDER BY id DESC`;
    return rows;
  }
  const { rows } = await sql`SELECT * FROM deliveries ORDER BY id DESC`;
  return rows;
}

/**
 * @param {{date:string, clientName:string, clientPhone?:string,
 *   clientEmail?:string, address:string, items:string,
 *   totalAmount?:number|string, status?:string, driverName?:string,
 *   createdBy?:string, notes?:string}} data
 * @returns {Promise<number>} The new delivery id.
 */
export async function addDelivery(data) {
  // BUG-13: defensive coercion for the non-Zod POST route path. Remove
  // once BUG-14 lands a DeliverySchema that uses z.coerce.number().
  data.totalAmount = parseFloat(data.totalAmount) || 0;
  const refCode = generateRefCode('DL');
  const { rows } = await sql`
    INSERT INTO deliveries (date, client_name, client_phone, client_email, address, items, total_amount, status, driver_name, ref_code, created_by, notes)
    VALUES (${data.date}, ${data.clientName}, ${data.clientPhone || ''}, ${data.clientEmail || ''}, ${data.address}, ${data.items}, ${data.totalAmount || 0}, ${data.status || 'قيد الانتظار'}, ${data.driverName || ''}, ${refCode}, ${data.createdBy || ''}, ${data.notes || ''})
    RETURNING id, ref_code
  `;
  return rows[0].id;
}

/**
 * Update a delivery inside a transaction. On status=`تم التوصيل`,
 * confirms the linked sale, marks it paid (unless آجل), saves the
 * VIN, generates an invoice, and creates bonuses via
 * `calculateBonusInTx`. On status=`ملغي`, returns stock, cancels the
 * sale, deletes the invoice, and reverses bonuses. Rejects any
 * transition out of a terminal state (`تم التوصيل` / `ملغي`).
 * @param {{id:number, date:string, clientName:string, clientPhone?:string,
 *   address?:string, items:string, totalAmount?:number|string, status:string,
 *   driverName?:string, assignedDriver?:string, notes?:string, vin?:string}} data
 * @returns {Promise<void>}
 */
export async function updateDelivery(data) {
  return withTx(async (client) => {
    // Lock the delivery row to prevent concurrent confirmation / cancellation
    const { rows: oldRows } = await client.sql`
      SELECT status, notes, sale_id FROM deliveries WHERE id = ${data.id} FOR UPDATE
    `;
    if (!oldRows.length) return;
    const oldStatus = oldRows[0].status || '';
    const oldNotes = oldRows[0].notes || '';
    let saleId = oldRows[0].sale_id;
    if (!saleId) {
      const m = oldNotes.match(/بيع رقم ([0-9]+)/);
      if (m) saleId = parseInt(m[1], 10);
    }

    // Reject illegal status transitions. Once delivered or cancelled, a delivery is
    // terminal — going back to "pending"/"in transit" would desync the sale + invoice.
    const TERMINAL = new Set(['تم التوصيل', 'ملغي']);
    if (TERMINAL.has(oldStatus) && oldStatus !== data.status) {
      throw new Error('لا يمكن تغيير حالة توصيل بعد تأكيده أو إلغائه');
    }

    // Sanitize the new notes — never let a caller inject the magic "بيع رقم N" string,
    // which the legacy regex fallback could otherwise re-target to a different sale.
    const safeNotes = String(data.notes || '').replace(/بيع رقم\s*[0-9]+/g, '').trim();

    await client.sql`
      UPDATE deliveries
      SET date = ${data.date},
          client_name = ${data.clientName},
          client_phone = ${data.clientPhone || ''},
          address = ${data.address},
          items = ${data.items},
          total_amount = ${data.totalAmount || 0},
          status = ${data.status},
          driver_name = ${data.driverName || ''},
          assigned_driver = ${data.assignedDriver || data.driverName || ''},
          notes = ${safeNotes}
      WHERE id = ${data.id}
    `;

    if (!saleId) return;
    // Idempotent: same status as before → nothing to do
    if (oldStatus === data.status) return;

    // DELIVERY CONFIRMED → confirm sale + mark payment + save VIN + create invoice + bonuses
    if (data.status === 'تم التوصيل') {
      const { rows: saleRows } = await client.sql`SELECT * FROM sales WHERE id = ${saleId} FOR UPDATE`;
      if (!saleRows.length) return;
      const sale = saleRows[0];
      if (sale.status === 'ملغي') {
        throw new Error('لا يمكن تأكيد توصيل لطلب ملغي');
      }

      if (data.vin) {
        await client.sql`UPDATE sales SET vin = ${data.vin} WHERE id = ${saleId}`;
      }
      await client.sql`
        UPDATE sales
        SET status = 'مؤكد',
            paid_amount = CASE WHEN payment_type <> 'آجل' THEN total ELSE paid_amount END,
            remaining   = CASE WHEN payment_type <> 'آجل' THEN 0 ELSE remaining END
        WHERE id = ${saleId}
      `;

      // Re-read sale after the update so the invoice captures the correct paid_amount
      const { rows: freshSaleRows } = await client.sql`SELECT * FROM sales WHERE id = ${saleId}`;
      const s = freshSaleRows[0];
      const { rows: delData } = await client.sql`SELECT * FROM deliveries WHERE id = ${parseInt(data.id, 10)}`;
      const d = delData[0] || {};
      const { rows: sellerData } = await client.sql`SELECT name FROM users WHERE username = ${s.created_by || ''}`;
      const sellerName = sellerData.length > 0 ? sellerData[0].name : s.created_by || '';

      // DONE: Step 6 — sequential per-month invoice number (INV-202604-001 ...)
      const invRef = await getNextInvoiceNumber();
      const today = new Date().toISOString().split('T')[0];
      await client.sql`
        INSERT INTO invoices (ref_code, date, sale_id, delivery_id, client_name, client_phone, client_email, client_address, item, quantity, unit_price, total, payment_type, vin, seller_name, driver_name)
        VALUES (${invRef}, ${today}, ${saleId}, ${parseInt(data.id, 10)}, ${s.client_name}, ${d.client_phone || ''}, ${d.client_email || ''}, ${d.address || ''}, ${s.item}, ${s.quantity}, ${s.unit_price}, ${s.total}, ${s.payment_type || 'كاش'}, ${data.vin || s.vin || ''}, ${sellerName}, ${data.driverName || d.driver_name || ''})
      `;

      // Bonuses (uses the same client → same transaction)
      const driverUser = data.driverName || data.assignedDriver || '';
      await calculateBonusInTx(client, saleId, parseInt(data.id, 10), driverUser);
    }

    // DELIVERY CANCELLED → cancel sale + return stock + delete invoice + reverse bonuses
    if (data.status === 'ملغي') {
      const { rows: saleRows } = await client.sql`SELECT item, quantity, status FROM sales WHERE id = ${saleId} FOR UPDATE`;
      if (saleRows.length && saleRows[0].status !== 'ملغي') {
        const qty = parseFloat(saleRows[0].quantity) || 0;
        if (qty > 0) {
          await client.sql`UPDATE products SET stock = stock + ${qty}::real WHERE name = ${saleRows[0].item}`;
        }
        await client.sql`UPDATE sales SET status = 'ملغي', paid_amount = 0, remaining = 0 WHERE id = ${saleId}`;
        await client.sql`DELETE FROM invoices WHERE sale_id = ${saleId}`;
        await client.sql`DELETE FROM bonuses WHERE delivery_id = ${parseInt(data.id, 10)}`;
      }
    }
  });
}

/**
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteDelivery(id) {
  await sql`DELETE FROM deliveries WHERE id = ${id}`;
}

// #endregion

// #region SUMMARY

/**
 * Build the admin/manager dashboard payload: revenue, COGS, gross +
 * net profit, monthly trend, top debtors/products/clients/suppliers,
 * cash-vs-bank splits, and bonus totals. `from`/`to` filter
 * purchases/sales/expenses/bonuses/settlements; payments and
 * deliveries are always all-time (debt snapshot + active deliveries).
 * @param {string} [from] ISO date `YYYY-MM-DD`.
 * @param {string} [to]   ISO date `YYYY-MM-DD`.
 * @returns {Promise<object>} Aggregated dashboard object (~30 fields).
 */
export async function getSummaryData(from, to) {
  let purchases, sales, expenses, payments, deliveries;

  if (from && to) {
    ({ rows: purchases } = await sql`SELECT * FROM purchases WHERE date >= ${from} AND date <= ${to}`);
    ({ rows: sales } = await sql`SELECT * FROM sales WHERE date >= ${from} AND date <= ${to}`);
    ({ rows: expenses } = await sql`SELECT * FROM expenses WHERE date >= ${from} AND date <= ${to}`);
  } else if (from) {
    ({ rows: purchases } = await sql`SELECT * FROM purchases WHERE date >= ${from}`);
    ({ rows: sales } = await sql`SELECT * FROM sales WHERE date >= ${from}`);
    ({ rows: expenses } = await sql`SELECT * FROM expenses WHERE date >= ${from}`);
  } else if (to) {
    ({ rows: purchases } = await sql`SELECT * FROM purchases WHERE date <= ${to}`);
    ({ rows: sales } = await sql`SELECT * FROM sales WHERE date <= ${to}`);
    ({ rows: expenses } = await sql`SELECT * FROM expenses WHERE date <= ${to}`);
  } else {
    ({ rows: purchases } = await sql`SELECT * FROM purchases`);
    ({ rows: sales } = await sql`SELECT * FROM sales`);
    ({ rows: expenses } = await sql`SELECT * FROM expenses`);
  }

  // Payments are always all-time — a payment reduces a client's debt regardless of
  // when the original credit sale was made. Used for the debt snapshot, not the P&L.
  ({ rows: payments } = await sql`SELECT * FROM payments`);
  ({ rows: deliveries } = await sql`SELECT * FROM deliveries`);

  // Settlements and bonuses are filtered to match the selected period so that
  // netProfit reflects only the bonus cost accrued within that date range.
  let allSettlements, allBonuses;
  if (from && to) {
    ({ rows: allSettlements } = await sql`SELECT * FROM settlements WHERE date >= ${from} AND date <= ${to}`);
    ({ rows: allBonuses }    = await sql`SELECT * FROM bonuses    WHERE date >= ${from} AND date <= ${to}`);
  } else if (from) {
    ({ rows: allSettlements } = await sql`SELECT * FROM settlements WHERE date >= ${from}`);
    ({ rows: allBonuses }    = await sql`SELECT * FROM bonuses    WHERE date >= ${from}`);
  } else if (to) {
    ({ rows: allSettlements } = await sql`SELECT * FROM settlements WHERE date <= ${to}`);
    ({ rows: allBonuses }    = await sql`SELECT * FROM bonuses    WHERE date <= ${to}`);
  } else {
    ({ rows: allSettlements } = await sql`SELECT * FROM settlements`);
    ({ rows: allBonuses }    = await sql`SELECT * FROM bonuses`);
  }

  // Get products for inventory value
  let products;
  ({ rows: products } = await sql`SELECT * FROM products`);

  // === PROPER ACCOUNTING ===
  // Only CONFIRMED sales count for revenue/profit (after delivery)

  const confirmedSales = sales.filter((s) => s.status === 'مؤكد');
  const reservedSales = sales.filter((s) => s.status === 'محجوز');
  const cancelledSales = sales.filter((s) => s.status === 'ملغي');

  // Revenue = confirmed sales only (إيرادات فعلية بعد التوصيل)
  const totalRevenue = confirmedSales.reduce((s, r) => s + (r.total || 0), 0);

  // Reserved revenue (إيرادات محجوزة - لم تتأكد بعد)
  const reservedRevenue = reservedSales.reduce((s, r) => s + (r.total || 0), 0);

  // All sales total (for reference)
  const totalAllSales = sales.filter((s) => s.status !== 'ملغي').reduce((s, r) => s + (r.total || 0), 0);

  // COGS = confirmed only (تكلفة البضاعة المباعة فعلياً)
  const totalCOGS = confirmedSales.reduce((s, r) => s + (r.cost_total || 0), 0);

  // Total Purchases (رأس المال المستثمر)
  const totalPurchases = purchases.reduce((s, r) => s + (r.total || 0), 0);

  // Expenses
  const totalExpenses = expenses.reduce((s, r) => s + (r.amount || 0), 0);

  // Gross Profit = confirmed revenue - COGS
  const grossProfit = totalRevenue - totalCOGS;

  // Bonus payouts (business expense - reduces profit)
  const totalBonusPaid = (allSettlements || [])
    .filter((s) => s.type === 'seller_payout' || s.type === 'driver_payout')
    .reduce((s, r) => s + (r.amount || 0), 0);

  // Unsettled bonuses (liability - owed but not yet paid)
  const totalBonusOwed = (allBonuses || [])
    .filter((b) => !b.settled)
    .reduce((s, b) => s + (b.total_bonus || 0), 0);

  // Total bonus cost = paid + owed (both reduce profit)
  const totalBonusCost = totalBonusPaid + totalBonusOwed;

  // Net Profit = Gross Profit - Expenses - ALL Bonuses (paid + owed)
  const netProfit = grossProfit - totalExpenses - totalBonusCost;

  // Confirmed profit
  const confirmedProfit = confirmedSales.reduce((s, r) => s + (r.profit || 0), 0);

  // Reserved profit (expected but not confirmed)
  const reservedProfit = reservedSales.reduce((s, r) => s + (r.profit || 0), 0);

  // Inventory Value
  const inventoryValue = products.reduce((s, p) => s + ((p.stock || 0) * (p.buy_price || 0)), 0);

  // Cash vs Bank vs Credit - confirmed sales only
  const salesCash = confirmedSales.filter((s) => s.payment_type === 'كاش' || (s.payment_type !== 'بنك' && s.payment_type !== 'آجل')).reduce((s, r) => s + (r.total || 0), 0);
  const salesBank = confirmedSales.filter((s) => s.payment_type === 'بنك').reduce((s, r) => s + (r.total || 0), 0);
  const salesCredit = confirmedSales.filter((s) => s.payment_type === 'آجل').reduce((s, r) => s + (r.total || 0), 0);
  const purchasesCash = purchases.filter((p) => p.payment_type !== 'بنك').reduce((s, r) => s + (r.total || 0), 0);
  const purchasesBank = purchases.filter((p) => p.payment_type === 'بنك').reduce((s, r) => s + (r.total || 0), 0);
  const expensesCash = expenses.filter((e) => e.payment_type !== 'بنك').reduce((s, r) => s + (r.amount || 0), 0);
  const expensesBank = expenses.filter((e) => e.payment_type === 'بنك').reduce((s, r) => s + (r.amount || 0), 0);

  // Only confirmed (مؤكد) credit sales constitute real debt — same logic as getClients().
  const totalCreditSales = sales.filter((s) => s.payment_type === 'آجل' && s.status === 'مؤكد').reduce((s, r) => s + (r.total || 0), 0);
  const totalPaidAtSale = sales.filter((s) => s.payment_type === 'آجل' && s.status === 'مؤكد').reduce((s, r) => s + (r.paid_amount || 0), 0);
  const totalLaterPayments = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const totalDebt = Math.max(0, totalCreditSales - totalPaidAtSale - totalLaterPayments);

  // Monthly data
  const monthlyData = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const monthName = d.toLocaleDateString('ar-SA', { month: 'short', year: 'numeric' });

    const mp = purchases.filter((r) => r.date?.startsWith(ym)).reduce((s, r) => s + (r.total || 0), 0);
    const ms = confirmedSales.filter((r) => r.date?.startsWith(ym)).reduce((s, r) => s + (r.total || 0), 0);
    const me = expenses.filter((r) => r.date?.startsWith(ym)).reduce((s, r) => s + (r.amount || 0), 0);
    const mProfit = confirmedSales.filter((r) => r.date?.startsWith(ym)).reduce((s, r) => s + (r.profit || 0), 0);

    const mBonusEarned = (allBonuses || [])
      .filter((b) => b.date?.startsWith(ym))
      .reduce((s, b) => s + (b.total_bonus || 0), 0);
    monthlyData.push({ month: monthName, purchases: mp, sales: ms, expenses: me, profit: mProfit - me - mBonusEarned });
  }

  // Expense by category
  const expenseByCategory = {};
  expenses.forEach((e) => {
    const cat = e.category || 'أخرى';
    expenseByCategory[cat] = (expenseByCategory[cat] || 0) + (e.amount || 0);
  });

  // Top debtors
  const clientDebts = {};
  sales.filter((s) => s.payment_type === 'آجل').forEach((s) => {
    if (!clientDebts[s.client_name]) clientDebts[s.client_name] = { credit: 0, paidAtSale: 0, laterPaid: 0 };
    clientDebts[s.client_name].credit += s.total || 0;
    clientDebts[s.client_name].paidAtSale += s.paid_amount || 0;
  });
  payments.forEach((p) => {
    if (!clientDebts[p.client_name]) clientDebts[p.client_name] = { credit: 0, paidAtSale: 0, laterPaid: 0 };
    clientDebts[p.client_name].laterPaid += p.amount || 0;
  });
  const topDebtors = Object.entries(clientDebts)
    .map(([name, d]) => ({ name, debt: Math.max(0, d.credit - d.paidAtSale - d.laterPaid) }))
    .filter((d) => d.debt > 0)
    .sort((a, b) => b.debt - a.debt)
    .slice(0, 10);

  // DONE: Fix 1 — top products by confirmed sales (qty + revenue + profit)
  const productSales = {};
  confirmedSales.forEach((s) => {
    if (!productSales[s.item]) {
      productSales[s.item] = { item: s.item, count: 0, revenue: 0, profit: 0 };
    }
    productSales[s.item].count   += s.quantity || 0;
    productSales[s.item].revenue += s.total    || 0;
    productSales[s.item].profit  += s.profit   || 0;
  });
  const topProducts = Object.values(productSales)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // DONE: Fix 2 — top clients by confirmed-sale revenue
  const clientSalesMap = {};
  confirmedSales.forEach((s) => {
    if (!clientSalesMap[s.client_name]) {
      clientSalesMap[s.client_name] = { name: s.client_name, count: 0, revenue: 0 };
    }
    clientSalesMap[s.client_name].count++;
    clientSalesMap[s.client_name].revenue += s.total || 0;
  });
  const topClients = Object.values(clientSalesMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // DONE: Fix 5 — supplier performance (orders, distinct items, total spent)
  const supplierMap = {};
  purchases.forEach((p) => {
    if (!supplierMap[p.supplier]) {
      supplierMap[p.supplier] = { name: p.supplier, orders: 0, totalSpent: 0, items: new Set() };
    }
    supplierMap[p.supplier].orders++;
    supplierMap[p.supplier].totalSpent += p.total || 0;
    supplierMap[p.supplier].items.add(p.item);
  });
  const topSuppliers = Object.values(supplierMap)
    .map((s) => ({ name: s.name, orders: s.orders, totalSpent: s.totalSpent, itemCount: s.items.size }))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);

  // Delivery stats
  const pendingDeliveries = deliveries.filter((d) => d.status === 'قيد الانتظار');
  const inTransitDeliveries = deliveries.filter((d) => d.status === 'جاري التوصيل');

  return {
    totalRevenue, totalAllSales, reservedRevenue, totalCOGS, totalPurchases, totalExpenses,
    grossProfit, netProfit, confirmedProfit, reservedProfit, inventoryValue, totalDebt,
    confirmedCount: confirmedSales.length, reservedCount: reservedSales.length, cancelledCount: cancelledSales.length,
    totalBonusPaid, totalBonusOwed, totalBonusCost,
    salesCash, salesBank, salesCredit, purchasesCash, purchasesBank, expensesCash, expensesBank,
    monthlyData, expenseByCategory, topDebtors,
    // DONE: Fix 1, 2, 5 — surface the new dashboard rankings
    topProducts, topClients, topSuppliers,
    pendingDeliveries: pendingDeliveries.length,
    inTransitDeliveries: inTransitDeliveries.length,
    recentDeliveries: [...pendingDeliveries, ...inTransitDeliveries].slice(0, 5),
  };
}

// #endregion

// #region USERS

/**
 * @returns {Promise<Array<object>>} Users (without password hash) ordered
 *   by id ASC.
 */
export async function getUsers() {
  const { rows } = await sql`SELECT id, username, name, role, active, created_at FROM users ORDER BY id`;
  return rows;
}

/**
 * @param {string} username
 * @returns {Promise<object|null>} Full user row (including password hash)
 *   or `null` if no match. Used by the NextAuth credentials provider.
 */
export async function getUserByUsername(username) {
  const { rows } = await sql`SELECT * FROM users WHERE username = ${username}`;
  return rows[0] || null;
}

/**
 * Create a user with bcrypt-hashed password. Role defaults to
 * `'seller'` when not provided.
 * @param {{username:string, password:string, name:string, role?:string}} data
 * @returns {Promise<number>} The new user id.
 */
export async function addUser(data) {
  const bcryptjs = (await import('bcryptjs')).default;
  const hash = bcryptjs.hashSync(data.password, 12);
  const { rows } = await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES (${data.username}, ${hash}, ${data.name}, ${data.role || 'seller'}, true)
    RETURNING id
  `;
  return rows[0].id;
}

/**
 * Update a user's `name` / `role` and, if `data.password` is present,
 * the bcrypt-hashed password.
 * @param {{id:number, name:string, role:string, password?:string}} data
 * @returns {Promise<void>}
 */
export async function updateUser(data) {
  if (data.password) {
    const bcryptjs = (await import('bcryptjs')).default;
    const hash = bcryptjs.hashSync(data.password, 12);
    await sql`UPDATE users SET name=${data.name}, role=${data.role}, password=${hash} WHERE id=${data.id}`;
  } else {
    await sql`UPDATE users SET name=${data.name}, role=${data.role} WHERE id=${data.id}`;
  }
}

/**
 * Flip a user's `active` flag.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function toggleUserActive(id) {
  await sql`UPDATE users SET active = NOT active WHERE id = ${id}`;
}

/**
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteUser(id) {
  await sql`DELETE FROM users WHERE id = ${id}`;
}

// #endregion

// #region SETTINGS

/**
 * @returns {Promise<Object<string,string>>} Settings as a flat object
 *   keyed on `settings.key` → `settings.value` (all values are strings).
 */
export async function getSettings() {
  const { rows } = await sql`SELECT * FROM settings`;
  const obj = {};
  rows.forEach((r) => { obj[r.key] = r.value; });
  return obj;
}

/**
 * Upsert every `data[key] → value` pair into the `settings` table.
 * Values are coerced to strings via `String(value)` before storage.
 * @param {Object<string,*>} data
 * @returns {Promise<void>}
 */
export async function updateSettings(data) {
  for (const [key, value] of Object.entries(data)) {
    await sql`INSERT INTO settings (key, value) VALUES (${key}, ${String(value)}) ON CONFLICT (key) DO UPDATE SET value = ${String(value)}`;
  }
}

// #endregion

// #region BONUSES

/**
 * @param {string} [username] If provided, filters to this user only.
 * @returns {Promise<Array<object>>}
 */
export async function getBonuses(username) {
  if (username) {
    const { rows } = await sql`SELECT * FROM bonuses WHERE username = ${username} ORDER BY id DESC`;
    return rows;
  }
  const { rows } = await sql`SELECT * FROM bonuses ORDER BY id DESC`;
  return rows;
}

// Calculate bonuses inside an existing transaction (uses caller's client).
// The UNIQUE(delivery_id, role) index makes this safe under concurrent confirmation.
// Exported so tests can inject a mocked client — the only production caller is
// updateDelivery() in this same file.
export async function calculateBonusInTx(client, saleId, deliveryId, driverUsername) {
  const { rows: settingRows } = await client.sql`SELECT * FROM settings`;
  const settings = {};
  settingRows.forEach((r) => { settings[r.key] = r.value; });
  // BUG 6A — fall back to the documented business defaults (10/50/5) if the
  // settings row is missing or unparseable. Never silently pay 0 bonus.
  const sellerFixed = parseFloat(settings.seller_bonus_fixed ?? '10') || 10;
  const sellerPct   = parseFloat(settings.seller_bonus_percentage ?? '50') || 50;
  const driverFixed = parseFloat(settings.driver_bonus_fixed ?? '5')  || 5;

  const { rows: saleRows } = await client.sql`SELECT * FROM sales WHERE id = ${saleId}`;
  if (!saleRows.length) return;
  const sale = saleRows[0];

  const recommended = parseFloat(sale.recommended_price) || 0;
  const actual = parseFloat(sale.unit_price) || 0;
  const qty = parseFloat(sale.quantity) || 0;
  const today = new Date().toISOString().split('T')[0];

  // Seller bonus — only when the order's creator is actually a seller (not admin/manager)
  if (sale.created_by) {
    const { rows: sellerUser } = await client.sql`SELECT role FROM users WHERE username = ${sale.created_by}`;
    const sellerRole = sellerUser.length > 0 ? sellerUser[0].role : '';
    if (sellerRole === 'seller') {
      const extra = Math.max(0, actual - recommended) * qty;
      const extraBonus = extra * sellerPct / 100;
      const totalBonus = sellerFixed + extraBonus;
      await client.sql`
        INSERT INTO bonuses (date, username, role, sale_id, delivery_id, item, quantity, recommended_price, actual_price, fixed_bonus, extra_bonus, total_bonus)
        VALUES (${today}, ${sale.created_by}, 'seller', ${saleId}, ${deliveryId}, ${sale.item}, ${qty}, ${recommended}, ${actual}, ${sellerFixed}, ${extraBonus}, ${totalBonus})
        ON CONFLICT (delivery_id, role) DO NOTHING
      `;
    }
  }

  // Driver bonus
  if (driverUsername) {
    // BUG 3D — the caller may pass a stale or wrong driver name.
    // Read assigned_driver from the deliveries row as the source of truth so the
    // bonus is always credited to the actual driver who owns this delivery.
    const { rows: delRow } = await client.sql`
      SELECT assigned_driver FROM deliveries WHERE id = ${deliveryId}
    `;
    // BUG-08 — do NOT silently fall back to the caller-supplied driverUsername.
    // The previous fallback was `delRow[0]?.assigned_driver || driverUsername`, which
    // would silently pay the bonus to the caller's guess whenever the deliveries row
    // lookup came back empty or unassigned. We only reach this block inside the
    // FOR-UPDATE-protected confirm path, so an empty delRow at this point is a broken
    // invariant. Fail loudly instead of silently miscrediting a bonus row.
    if (!delRow[0]?.assigned_driver) {
      throw new Error('Internal error: bonus calculation requires a confirmed delivery row with an assigned driver');
    }
    const confirmedDriver = delRow[0].assigned_driver;

    const { rows: driverUser } = await client.sql`SELECT role FROM users WHERE username = ${confirmedDriver}`;
    const driverRole = driverUser.length > 0 ? driverUser[0].role : '';
    if (driverRole === 'driver') {
      await client.sql`
        INSERT INTO bonuses (date, username, role, sale_id, delivery_id, item, quantity, recommended_price, actual_price, fixed_bonus, extra_bonus, total_bonus)
        VALUES (${today}, ${confirmedDriver}, 'driver', ${saleId}, ${deliveryId}, ${sale.item}, ${qty}, 0, 0, ${driverFixed}, 0, ${driverFixed})
        ON CONFLICT (delivery_id, role) DO NOTHING
      `;
    }
  }
}

// #endregion

// #region INVOICES

// BUG 4A — drivers can now see invoices for deliveries assigned to them.
// The role parameter routes the lookup: 'driver' uses an inner join on
// deliveries.assigned_driver, sellers still use the seller_name subquery.
/**
 * List invoices with role-aware scoping. `driver` role joins on
 * `deliveries.assigned_driver`; any other username matches via the
 * `seller_name IN (SELECT name FROM users WHERE username = ?)`
 * subquery. No username → admin path (all invoices).
 * @param {string} [username]
 * @param {string} [role]
 * @returns {Promise<Array<object>>}
 */
export async function getInvoices(username, role) {
  if (role === 'driver' && username) {
    const { rows } = await sql`
      SELECT i.* FROM invoices i
      JOIN deliveries d ON d.id = i.delivery_id
      WHERE d.assigned_driver = ${username}
      ORDER BY i.id DESC
    `;
    return rows;
  }
  if (username) {
    // Only match via the subquery (display name from users table).
    // The previous OR seller_name = ${username} could leak invoices to a different
    // user whose display name happens to match this user's username.
    const { rows } = await sql`SELECT * FROM invoices WHERE seller_name IN (SELECT name FROM users WHERE username = ${username}) ORDER BY id DESC`;
    return rows;
  }
  const { rows } = await sql`SELECT * FROM invoices ORDER BY id DESC`;
  return rows;
}

/**
 * Atomically reverse a confirmed sale: restore stock, mark the sale
 * `ملغي`, delete unsettled bonuses, and mark the invoice voided.
 * Refuses (Arabic throw) if ANY bonus on this sale was already
 * settled — the money is gone and reversing would break the books.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function voidInvoice(id) {
  // Fully reverses the confirmed sale: restores stock, cancels the sale record,
  // deletes unsettled bonuses, and marks the invoice voided — all atomically.
  return withTx(async (client) => {
    const { rows: inv } = await client.sql`
      SELECT sale_id, delivery_id FROM invoices WHERE id = ${id} FOR UPDATE
    `;
    if (!inv.length) throw new Error('الفاتورة غير موجودة');
    const { sale_id, delivery_id } = inv[0];

    // Block if any bonus for this sale has already been paid out —
    // the money is gone, so reversing the sale would silently break the books.
    const { rows: settled } = await client.sql`
      SELECT 1 FROM bonuses WHERE sale_id = ${sale_id} AND settled = true LIMIT 1
    `;
    if (settled.length) throw new Error('لا يمكن إلغاء فاتورة مرتبطة بمكافآت مُسواة بالفعل');

    // Restore stock
    const { rows: saleRows } = await client.sql`
      SELECT item, quantity, status FROM sales WHERE id = ${sale_id} FOR UPDATE
    `;
    if (!saleRows.length) throw new Error('الطلب المرتبط غير موجود');
    if (saleRows[0].status !== 'ملغي') {
      // Only restore if not already cancelled (idempotent guard)
      const qty = parseFloat(saleRows[0].quantity) || 0;
      if (qty > 0) {
        await client.sql`UPDATE products SET stock = stock + ${qty}::real WHERE name = ${saleRows[0].item}`;
      }
    }

    // Cancel the sale and zero out payment fields
    await client.sql`
      UPDATE sales SET status = 'ملغي', paid_amount = 0, remaining = 0 WHERE id = ${sale_id}
    `;

    // Delete unsettled bonuses for this sale (settled ones were already blocked above)
    await client.sql`DELETE FROM bonuses WHERE sale_id = ${sale_id} AND settled = false`;

    // Mark the invoice voided
    await client.sql`UPDATE invoices SET status = 'ملغي' WHERE id = ${id}`;
  });
}

// #endregion

// #region EDIT OPERATIONS (admin only)

// Update a reserved sale. The route layer enforces status='محجوز' & ownership;
// here we additionally re-reserve stock if quantity changes and recompute totals.
/**
 * Update a reserved sale (status must be `محجوز`). Re-reserves stock
 * on quantity/item changes, recomputes totals from the current product
 * buy/sell prices, and mirrors the edit onto the linked delivery row
 * — all inside a single transaction.
 * @param {{id:number, clientName:string, item?:string,
 *   quantity:number|string, unitPrice:number|string, notes?:string}} data
 * @returns {Promise<void>}
 */
export async function updateSale(data) {
  return withTx(async (client) => {
    const { rows: oldRows } = await client.sql`
      SELECT item, quantity, status, cost_price FROM sales WHERE id = ${data.id} FOR UPDATE
    `;
    if (!oldRows.length) throw new Error('الطلب غير موجود');
    if (oldRows[0].status !== 'محجوز') throw new Error('لا يمكن تعديل طلب بعد التوصيل أو الإلغاء');

    const oldItem = oldRows[0].item;
    const oldQty = parseFloat(oldRows[0].quantity) || 0;
    const newItem = data.item || oldItem;
    const newQty = parseFloat(data.quantity) || 0;
    const newPrice = parseFloat(data.unitPrice) || 0;
    if (newQty <= 0) throw new Error('الكمية لازم تكون أكبر من 0');
    if (newPrice <= 0) throw new Error('السعر لازم يكون أكبر من 0');

    // Adjust reserved stock — return the old reservation, then take the new one (atomic + locked)
    if (newItem === oldItem) {
      const delta = newQty - oldQty;
      if (delta > 0) {
        const { rows: prod } = await client.sql`
          SELECT stock FROM products WHERE name = ${newItem} FOR UPDATE
        `;
        if (!prod.length) throw new Error('المنتج غير موجود');
        if (parseFloat(prod[0].stock) < delta) {
          throw new Error(`المخزون المتاح غير كافٍ للزيادة المطلوبة`);
        }
        await client.sql`UPDATE products SET stock = stock - ${delta}::real WHERE name = ${newItem}`;
      } else if (delta < 0) {
        await client.sql`UPDATE products SET stock = stock + ${-delta}::real WHERE name = ${newItem}`;
      }
    } else {
      // Item swapped: return old, reserve new
      if (oldQty > 0) {
        await client.sql`UPDATE products SET stock = stock + ${oldQty}::real WHERE name = ${oldItem}`;
      }
      const { rows: prod } = await client.sql`
        SELECT buy_price, sell_price, stock FROM products WHERE name = ${newItem} FOR UPDATE
      `;
      if (!prod.length) throw new Error('المنتج غير موجود');
      if (parseFloat(prod[0].stock) < newQty) {
        throw new Error(`الكمية المطلوبة (${newQty}) أكبر من المخزون المتاح`);
      }
      await client.sql`UPDATE products SET stock = stock - ${newQty}::real WHERE name = ${newItem}`;
    }

    // Recompute totals using a fresh read of the (possibly different) product
    const { rows: prodFinal } = await client.sql`SELECT buy_price, sell_price FROM products WHERE name = ${newItem}`;
    const costPrice = prodFinal.length ? parseFloat(prodFinal[0].buy_price) || 0 : parseFloat(oldRows[0].cost_price) || 0;
    const recommended = prodFinal.length ? parseFloat(prodFinal[0].sell_price) || 0 : 0;
    const total = newQty * newPrice;
    const costTotal = newQty * costPrice;
    const profit = total - costTotal;

    await client.sql`
      UPDATE sales
      SET client_name = ${data.clientName},
          item = ${newItem},
          quantity = ${newQty},
          cost_price = ${costPrice},
          unit_price = ${newPrice},
          total = ${total},
          cost_total = ${costTotal},
          profit = ${profit},
          recommended_price = ${recommended},
          remaining = ${total},
          notes = ${data.notes || ''}
      WHERE id = ${data.id}
    `;

    // Mirror the change onto the linked delivery so the dashboard stays consistent
    await client.sql`
      UPDATE deliveries
      SET client_name = ${data.clientName},
          items = ${newItem + ' (' + newQty + ')'},
          total_amount = ${total}
      WHERE sale_id = ${data.id}
    `;
  });
}

// Purchases are immutable in their financial fields (quantity / price) because they
// already moved stock and the weighted-average buy_price. Only notes can be edited.
/**
 * Only `notes` is mutable — quantity/price edits are refused by design
 * because the original purchase already moved stock and the
 * weighted-average buy price.
 * @param {{id:number, notes?:string}} data
 * @returns {Promise<void>}
 */
export async function updatePurchase(data) {
  await sql`UPDATE purchases SET notes = ${data.notes || ''} WHERE id = ${data.id}`;
}

/**
 * @param {{id:number, category:string, description:string,
 *   amount:number|string, notes?:string}} data
 * @returns {Promise<void>}
 */
export async function updateExpense(data) {
  await sql`UPDATE expenses SET category=${data.category}, description=${data.description}, amount=${data.amount}, notes=${data.notes || ''} WHERE id=${data.id}`;
}

// #endregion

// #region SETTLEMENTS

/**
 * @returns {Promise<Array<object>>} All settlements, newest first.
 */
export async function getSettlements() {
  const { rows } = await sql`SELECT * FROM settlements ORDER BY id DESC`;
  return rows;
}

/**
 * Insert a settlement row and, for `seller_payout` / `driver_payout`,
 * mark the user's unsettled bonuses `settled=true` in FIFO order up
 * to the paid amount. Partial coverage leaves the remaining bonus
 * untouched for the next payout. All inside one transaction.
 * @param {{date:string, type:string, username?:string, description:string,
 *   amount:number|string, settledBy:string, notes?:string}} data
 * @returns {Promise<number>} The new settlement id.
 */
export async function addSettlement(data) {
  // BUG-13: defensive coercion for the non-Zod POST route path. Remove
  // once BUG-14 lands a SettlementSchema that uses z.coerce.number().
  data.amount = parseFloat(data.amount) || 0;
  // Wrapped in a transaction so an interrupted payout never leaves the settlement
  // recorded but the matching bonuses unflagged (which would let the admin pay twice).
  return withTx(async (client) => {
    const { rows } = await client.sql`
      INSERT INTO settlements (date, type, username, description, amount, settled_by, notes)
      VALUES (${data.date}, ${data.type}, ${data.username || ''}, ${data.description}, ${data.amount}, ${data.settledBy}, ${data.notes || ''})
      RETURNING id
    `;
    const settlementId = rows[0].id;

    // Partial settlement: mark bonuses settled FIFO up to the paid amount
    if (data.username && (data.type === 'seller_payout' || data.type === 'driver_payout')) {
      const paidAmount = parseFloat(data.amount) || 0;
      const { rows: unsettledBonuses } = await client.sql`
        SELECT id, total_bonus FROM bonuses
        WHERE username = ${data.username} AND settled = false
        ORDER BY id ASC
        FOR UPDATE
      `;
      let remaining = paidAmount;
      for (const bonus of unsettledBonuses) {
        if (remaining <= 0) break;
        const bonusValue = parseFloat(bonus.total_bonus) || 0;
        if (remaining >= bonusValue) {
          await client.sql`
            UPDATE bonuses SET settled = true, settlement_id = ${settlementId} WHERE id = ${bonus.id}
          `;
          remaining -= bonusValue;
        } else {
          // Partial coverage - leave for the next payout
          break;
        }
      }
    }

    return settlementId;
  });
}

// #endregion

// #region ENTITY ALIASES

/**
 * Look up a single alias by `(entity_type, normalized_alias)`.
 * Swallows every DB error as `null` — the AI layer must fail silently
 * so aliasing bugs never break the main voice flow.
 * @param {string} entityType
 * @param {string} normalizedText
 * @returns {Promise<{entity_id:number, alias:string, frequency:number}|null>}
 */
export async function findAlias(entityType, normalizedText) {
  try {
    const { rows } = await sql`
      SELECT entity_id, alias, frequency FROM entity_aliases
      WHERE entity_type = ${entityType} AND normalized_alias = ${normalizedText}
      ORDER BY frequency DESC LIMIT 1
    `;
    return rows[0] || null;
  } catch { return null; }
}

/**
 * Upsert a learned alias. If a row already exists for
 * `(entity_type, normalized_alias)` the frequency is bumped and the
 * `entity_id` is refreshed; otherwise a new row is inserted. All
 * errors are swallowed (AI layer never breaks the voice flow).
 * @param {string} entityType
 * @param {number} entityId
 * @param {string} alias
 * @param {string} normalizedAlias
 * @param {string} [source='user']
 * @returns {Promise<void>}
 */
export async function addAlias(entityType, entityId, alias, normalizedAlias, source) {
  try {
    const { rows: existing } = await sql`
      SELECT id FROM entity_aliases WHERE entity_type = ${entityType} AND normalized_alias = ${normalizedAlias}
    `;
    if (existing.length > 0) {
      await sql`UPDATE entity_aliases SET frequency = frequency + 1, entity_id = ${entityId} WHERE id = ${existing[0].id}`;
    } else {
      await sql`INSERT INTO entity_aliases (entity_type, entity_id, alias, normalized_alias, source) VALUES (${entityType}, ${entityId}, ${alias}, ${normalizedAlias}, ${source || 'user'})`;
    }
  } catch {}
}

/**
 * FEAT-01: insert an auto-generated alias with FIRST-WRITER-WINS semantics.
 *
 * Distinct from addAlias() which uses NEWEST-WRITER-WINS (rewrites entity_id
 * on collision). That semantics is correct for `confirmed_action` writes
 * where the user just confirmed the new entity is right, but UNSAFE for
 * `auto_generated` writes where the generator has zero evidence.
 *
 * Collision policy:
 *   - existing alias for SAME entity_id      → no-op
 *   - existing alias for DIFFERENT entity_id → skip silently (do NOT steal)
 *   - no existing alias                       → INSERT 'auto_generated' freq=1
 *
 * Always uses source='auto_generated' and frequency=1. The low frequency
 * means generated aliases compete on equal footing with default-1 organic
 * learning — they're promoted only by actual usage via the existing
 * confirmed_action freq-bump path in resolveEntity().
 *
 * Errors are swallowed (consistent with the existing addAlias pattern) so
 * the entity creation path is never broken by an alias write failure.
 *
 * @param {'product'|'supplier'|'client'} entityType
 * @param {number} entityId
 * @param {string} alias
 * @param {string} normalizedAlias
 * @returns {Promise<void>}
 */
export async function addGeneratedAlias(entityType, entityId, alias, normalizedAlias) {
  try {
    const { rows: existing } = await sql`
      SELECT id, entity_id FROM entity_aliases
      WHERE entity_type = ${entityType} AND normalized_alias = ${normalizedAlias}
    `;
    if (existing.length > 0) {
      // First-writer-wins: do NOT steal entity_id, do NOT bump frequency.
      return;
    }
    await sql`
      INSERT INTO entity_aliases
        (entity_type, entity_id, alias, normalized_alias, source, frequency)
      VALUES
        (${entityType}, ${entityId}, ${alias}, ${normalizedAlias}, 'auto_generated', 1)
    `;
  } catch {}
}

/**
 * FEAT-01: generate Arabic aliases from an entity name and persist them.
 * Used internally by addProduct/addSupplier/addClient post-INSERT.
 *
 * Closes the cold-start gap where freshly-added entities have zero aliases
 * and the resolver can only fall back to fuzzy-matching the English name.
 *
 * Cache invalidation is non-negotiable: without it, the freshly-added entity
 * is unrecognized for up to 5 minutes (Fuse cache TTL).
 *
 * Uses dynamic imports to match the existing convention in db.js (which
 * lazy-loads voice-related modules) AND to avoid the entity-resolver ↔ db
 * circular import. Cost: ~5-10ms first-run module load per cold start.
 *
 * @param {'product'|'supplier'|'client'} entityType
 * @param {number} entityId
 * @param {string} name
 * @returns {Promise<void>}
 */
async function generateAndPersistAliases(entityType, entityId, name) {
  let generators;
  try {
    generators = await import('./alias-generator.js');
  } catch (err) {
    console.error('[generateAndPersistAliases] alias-generator import failed:', err.message);
    return;
  }

  const fnMap = {
    product:  generators.generateProductAliases,
    supplier: generators.generateSupplierAliases,
    client:   generators.generateClientAliases,
  };
  const gen = fnMap[entityType];
  if (!gen) return;

  const result = gen(name);
  if (result.skip) return;

  let normalizeForMatching;
  try {
    ({ normalizeForMatching } = await import('./voice-normalizer'));
  } catch (err) {
    console.error('[generateAndPersistAliases] voice-normalizer import failed:', err.message);
    return;
  }

  for (const alias of result.aliases) {
    const normalized = normalizeForMatching(alias);
    await addGeneratedAlias(entityType, entityId, alias, normalized);
  }

  // Cache invalidation. invalidateCache() takes no parameter and resets all
  // three Fuse caches — slightly broader than necessary but functionally
  // correct and matches the existing pattern at saveAICorrection lines 2343-44.
  try {
    const erMod = await import('./entity-resolver').catch(() => null);
    if (erMod?.invalidateCache) erMod.invalidateCache();
  } catch {}
}

/**
 * @param {string} entityType
 * @returns {Promise<Array<object>>} Aliases ordered by frequency DESC.
 *   Returns `[]` on any DB error (AI layer failure safety).
 */
export async function getAllAliases(entityType) {
  try {
    const { rows } = await sql`SELECT * FROM entity_aliases WHERE entity_type = ${entityType} ORDER BY frequency DESC`;
    return rows;
  } catch { return []; }
}

// DONE: Step 1C — priority-ordered name lists for the Whisper vocabulary builder.
// Caller passes an optional username to bias the client list toward that seller's
// frequent customers; products and suppliers stay global.
/**
 * Build priority-ordered name lists for the Whisper vocabulary builder.
 * Clients are biased toward the caller's frequent customers when
 * `username` is non-empty; products and suppliers stay global.
 * Returns empty lists on any DB error.
 * @param {string} [username='']
 * @returns {Promise<{products:string[], clients:string[],
 *   suppliers:string[], aliases:string[]}>}
 */
export async function getTopEntities(username = '') {
  try {
    const [topProducts, topClients, topSuppliers, topAliases] = await Promise.all([
      sql`SELECT item AS name, COUNT(*) AS cnt
          FROM sales WHERE status = 'مؤكد'
          GROUP BY item ORDER BY cnt DESC LIMIT 15`,
      username
        ? sql`SELECT client_name AS name, COUNT(*) AS cnt
              FROM sales WHERE created_by = ${username}
              GROUP BY client_name ORDER BY cnt DESC LIMIT 10`
        : sql`SELECT client_name AS name, COUNT(*) AS cnt
              FROM sales GROUP BY client_name ORDER BY cnt DESC LIMIT 10`,
      sql`SELECT supplier AS name, COUNT(*) AS cnt
          FROM purchases GROUP BY supplier ORDER BY cnt DESC LIMIT 8`,
      sql`SELECT alias, frequency FROM entity_aliases
          ORDER BY frequency DESC LIMIT 20`,
    ]);
    return {
      products:  topProducts.rows.map((r) => r.name).filter(Boolean),
      clients:   topClients.rows.map((r) => r.name).filter(Boolean),
      suppliers: topSuppliers.rows.map((r) => r.name).filter(Boolean),
      aliases:   topAliases.rows.map((r) => r.alias).filter(Boolean),
    };
  } catch {
    return { products: [], clients: [], suppliers: [], aliases: [] };
  }
}

// DONE: Step 1D — runs on init and (optionally) periodically. Mines the most-used
// items / clients / suppliers from the historical sales+purchases tables and
// upserts them as entity_aliases so the resolver matches them via Layer 0
// (instant O(1) lookup) instead of falling through to fuzzy matching every time.
//
// Idempotent: uses a manual SELECT-then-INSERT/UPDATE pattern (not ON CONFLICT)
// because entity_aliases has only an index on (entity_type, normalized_alias),
// not a unique constraint, so ON CONFLICT would fail.
/**
 * Mine the most-used items/clients/suppliers from historical sales +
 * purchases and upsert them as `entity_aliases` rows so the resolver
 * matches them via Layer 0 (instant O(1) lookup). Idempotent — frequencies
 * only move upward on re-run.
 * @returns {Promise<{success:boolean}>}
 */
export async function autoLearnFromHistory() {
  try {
    const { normalizeForMatching } = await import('./voice-normalizer');

    const upsertAlias = async (entity_type, entity_id, alias, freq) => {
      const normalized = normalizeForMatching(alias);
      if (!normalized) return;
      const { rows: existing } = await sql`
        SELECT id, frequency FROM entity_aliases
        WHERE entity_type = ${entity_type} AND normalized_alias = ${normalized}
        LIMIT 1
      `;
      if (existing.length > 0) {
        // Bump only upward — never lower an existing learned frequency
        if (freq > (existing[0].frequency || 0)) {
          await sql`UPDATE entity_aliases SET frequency = ${freq} WHERE id = ${existing[0].id}`;
        }
      } else {
        await sql`
          INSERT INTO entity_aliases (entity_type, entity_id, alias, normalized_alias, source, frequency)
          VALUES (${entity_type}, ${entity_id}, ${alias}, ${normalized}, 'auto_history', ${freq})
        `;
      }
    };

    // Top-sold products (status='مؤكد')
    const { rows: products } = await sql`
      SELECT item, COUNT(*) AS cnt FROM sales
      WHERE status = 'مؤكد'
      GROUP BY item ORDER BY cnt DESC LIMIT 30
    `;
    for (const { item, cnt } of products) {
      const { rows: prod } = await sql`SELECT id FROM products WHERE name = ${item} LIMIT 1`;
      if (!prod.length) continue;
      await upsertAlias('product', prod[0].id, item, parseInt(cnt, 10) || 1);
    }

    // Top clients
    const { rows: clients } = await sql`
      SELECT client_name, COUNT(*) AS cnt FROM sales
      GROUP BY client_name ORDER BY cnt DESC LIMIT 30
    `;
    for (const { client_name, cnt } of clients) {
      const { rows: cl } = await sql`SELECT id FROM clients WHERE name = ${client_name} LIMIT 1`;
      if (!cl.length) continue;
      await upsertAlias('client', cl[0].id, client_name, parseInt(cnt, 10) || 1);
    }

    // Top suppliers
    const { rows: suppliers } = await sql`
      SELECT supplier, COUNT(*) AS cnt FROM purchases
      GROUP BY supplier ORDER BY cnt DESC LIMIT 15
    `;
    for (const { supplier, cnt } of suppliers) {
      const { rows: sup } = await sql`SELECT id FROM suppliers WHERE name = ${supplier} LIMIT 1`;
      if (!sup.length) continue;
      await upsertAlias('supplier', sup[0].id, supplier, parseInt(cnt, 10) || 1);
    }

    return { success: true };
  } catch (e) {
    console.error('[autoLearnFromHistory]', e.message);
    return { success: false };
  }
}

// #endregion

// #region AI LEARNING

// DONE: Step 1B — full self-improving correction handler.
// Saves audit trail, per-user + global ai_patterns, and a rich set of entity aliases
// (ai_correction, speech_correction, english_canonical, auto_strip_al, transcript_word).
// Invalidates the entity-resolver Fuse cache so the next request sees the new aliases.
/**
 * Full self-improving correction handler. Writes the raw correction
 * to `ai_corrections` (audit), upserts per-user AND global rows into
 * `ai_patterns`, and (for name fields) produces a rich set of entity
 * aliases (`ai_correction`, `speech_correction`, `english_canonical`,
 * `auto_strip_al`, `transcript_word`). Invalidates the entity-resolver
 * Fuse cache on success. Every branch is wrapped in try/catch and
 * errors are logged to stderr but never thrown.
 * @param {{username?:string, transcript?:string, aiValue:string,
 *   userValue:string, actionType?:string, fieldName:string}} data
 * @returns {Promise<void>}
 */
export async function saveAICorrection(data) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const username = data.username || '';

    // 1. Audit trail — always save raw correction
    await sql`
      INSERT INTO ai_corrections
        (date, username, transcript, ai_output, user_correction, action_type, field_name)
      VALUES
        (${today}, ${username}, ${data.transcript || ''},
         ${data.aiValue}, ${data.userValue}, ${data.actionType || ''}, ${data.fieldName})
    `;

    // 2. Pattern learning — what user SAID → what is correct
    //    Store BOTH per-user (high-priority in prompt) and global (shared baseline) rows.
    const spokenText = data.transcript || data.aiValue;

    // Per-user pattern
    const { rows: userPat } = await sql`
      SELECT id, frequency FROM ai_patterns
      WHERE spoken_text   = ${spokenText}
        AND correct_value = ${data.userValue}
        AND field_name    = ${data.fieldName}
        AND username      = ${username}
    `;
    if (userPat.length > 0) {
      await sql`UPDATE ai_patterns SET frequency = frequency + 1, last_used = CURRENT_TIMESTAMP WHERE id = ${userPat[0].id}`;
    } else {
      await sql`
        INSERT INTO ai_patterns (pattern_type, spoken_text, correct_value, field_name, frequency, username)
        VALUES (${data.actionType || ''}, ${spokenText}, ${data.userValue}, ${data.fieldName}, 1, ${username})
        ON CONFLICT DO NOTHING
      `.catch(() => {});
    }

    // Global pattern (only when this came from a real user — avoid empty/empty rows)
    if (username) {
      const { rows: globalPat } = await sql`
        SELECT id, frequency FROM ai_patterns
        WHERE spoken_text   = ${spokenText}
          AND correct_value = ${data.userValue}
          AND field_name    = ${data.fieldName}
          AND username      = ''
      `;
      if (globalPat.length > 0) {
        await sql`UPDATE ai_patterns SET frequency = frequency + 1, last_used = CURRENT_TIMESTAMP WHERE id = ${globalPat[0].id}`;
      } else {
        await sql`
          INSERT INTO ai_patterns (pattern_type, spoken_text, correct_value, field_name, frequency, username)
          VALUES (${data.actionType || ''}, ${spokenText}, ${data.userValue}, ${data.fieldName}, 1, '')
          ON CONFLICT DO NOTHING
        `.catch(() => {});
      }
    }

    // 3. Entity alias creation for name fields
    const nameFields = { client_name: 'client', supplier: 'supplier', item: 'product' };
    if (nameFields[data.fieldName] && data.userValue && data.aiValue !== data.userValue) {
      const entityType = nameFields[data.fieldName];
      const { normalizeForMatching } = await import('./voice-normalizer');

      const normalizedAI     = normalizeForMatching(data.aiValue);
      const normalizedSpeech = normalizeForMatching(spokenText);
      const normalizedUser   = normalizeForMatching(data.userValue);

      let entityId = null;
      if (entityType === 'client') {
        const { rows } = await sql`SELECT id FROM clients WHERE name = ${data.userValue} LIMIT 1`.catch(() => ({ rows: [] }));
        entityId = rows[0]?.id;
      } else if (entityType === 'supplier') {
        const { rows } = await sql`SELECT id FROM suppliers WHERE name = ${data.userValue} LIMIT 1`.catch(() => ({ rows: [] }));
        entityId = rows[0]?.id;
      } else if (entityType === 'product') {
        const { rows } = await sql`
          SELECT id FROM products WHERE name = ${data.userValue} OR name LIKE ${data.userValue + '%'}
          LIMIT 1
        `.catch(() => ({ rows: [] }));
        entityId = rows[0]?.id;
      }

      if (entityId) {
        // a) AI's wrong output → correct entity
        await addAlias(entityType, entityId, data.aiValue, normalizedAI, 'ai_correction');

        // b) Original speech → correct entity (if different from AI output)
        if (normalizedSpeech !== normalizedAI) {
          await addAlias(entityType, entityId, spokenText, normalizedSpeech, 'speech_correction');
        }

        // c) Canonical English name itself → correct entity
        await addAlias(entityType, entityId, data.userValue, normalizedUser, 'english_canonical');

        // d) Product-specific extra aliases
        if (entityType === 'product') {
          // Strip ال prefix: "الفيشن" → also add "فيشن"
          const withoutAl = data.aiValue.replace(/^ال/, '');
          if (withoutAl !== data.aiValue && withoutAl.length > 1) {
            await addAlias(entityType, entityId, withoutAl, normalizeForMatching(withoutAl), 'auto_strip_al');
          }

          // Mine significant words from the original transcript
          const skipWords = new Set([
            'اشتريت', 'بعت', 'جبت', 'شريت', 'سلمت', 'سلّمت',
            'من', 'في', 'على', 'بـ', 'بسعر', 'كاش', 'بنك', 'آجل',
            'كمية', 'الواحدة', 'واحد', 'اثنين', 'ثلاث',
          ]);
          const transcriptWords = (data.transcript || '').split(/\s+/);
          for (const word of transcriptWords) {
            if (word.length <= 2) continue;
            const nw = normalizeForMatching(word);
            if (nw.length <= 2) continue;
            if (nw === normalizedAI || nw === normalizedUser) continue;
            if ([...skipWords].some((sw) => nw.includes(normalizeForMatching(sw)))) continue;
            await addAlias(entityType, entityId, word, nw, 'transcript_word').catch(() => {});
          }
        }

        // e) Invalidate Fuse cache so next request rebuilds with the new aliases
        const erMod = await import('./entity-resolver').catch(() => null);
        if (erMod?.invalidateCache) erMod.invalidateCache();
      }
    }
  } catch (e) {
    console.error('[saveAICorrection]', e.message);
  }
}

// Get learned patterns for improving AI prompts
// DONE: Step 1 — when username is provided, fetch the user's own patterns first
// then fill remaining slots with global ones. The prompt builder splits them
// back into "your corrections" / "team corrections" sections.
/**
 * Return learned AI patterns for prompt construction. When `username`
 * is provided, fetches that user's own patterns first then tops up
 * with global (`username=''`) rows. Returns `[]` on DB error.
 * @param {number} [limit=20]
 * @param {string} [username='']
 * @returns {Promise<Array<object>>}
 */
export async function getAIPatterns(limit = 20, username = '') {
  try {
    if (username) {
      const { rows: userRows } = await sql`
        SELECT * FROM ai_patterns
        WHERE username = ${username}
        ORDER BY frequency DESC, last_used DESC
        LIMIT ${limit}
      `;
      const remaining = Math.max(0, limit - userRows.length);
      if (remaining === 0) return userRows;
      const { rows: globalRows } = await sql`
        SELECT * FROM ai_patterns
        WHERE username = ''
        ORDER BY frequency DESC, last_used DESC
        LIMIT ${remaining}
      `;
      return [...userRows, ...globalRows];
    }
    const { rows } = await sql`SELECT * FROM ai_patterns ORDER BY frequency DESC, last_used DESC LIMIT ${limit}`;
    return rows;
  } catch { return []; }
}

// Get recent corrections for few-shot learning
/**
 * @param {number} [limit=10]
 * @returns {Promise<Array<object>>} Most recent AI corrections for
 *   few-shot learning. Returns `[]` on DB error.
 */
export async function getRecentCorrections(limit = 10) {
  try {
    const { rows } = await sql`SELECT * FROM ai_corrections ORDER BY id DESC LIMIT ${limit}`;
    return rows;
  } catch { return []; }
}

// #endregion
