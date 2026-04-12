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

// ==================== INIT / SEED ====================

export async function resetDatabase() {
  await sql`DROP TABLE IF EXISTS purchases, sales, expenses, clients, payments, products, suppliers, deliveries, users, settings, bonuses, settlements CASCADE`;
  return initDatabase();
}

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

  // Default settings
  await sql`INSERT INTO settings (key, value) VALUES ('seller_bonus_fixed', '10') ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('seller_bonus_percentage', '50') ON CONFLICT (key) DO NOTHING`.catch(() => {});
  await sql`INSERT INTO settings (key, value) VALUES ('driver_bonus_fixed', '5') ON CONFLICT (key) DO NOTHING`.catch(() => {});

  // Default admin user (password: admin123)
  const bcryptjs = (await import('bcryptjs')).default;
  const adminHash = bcryptjs.hashSync('admin123', 12);
  await sql`INSERT INTO users (username, password, name, role, active) VALUES ('admin', ${adminHash}, 'المدير العام', 'admin', true) ON CONFLICT (username) DO NOTHING`.catch(() => {});

  return true;
}

// ==================== PURCHASES ====================

export async function getPurchases() {
  const { rows } = await sql`SELECT * FROM purchases ORDER BY id DESC`;
  return rows;
}

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

    // Insert the purchase row
    const { rows } = await client.sql`
      INSERT INTO purchases (date, supplier, item, quantity, unit_price, total, payment_type, ref_code, created_by, notes)
      VALUES (${data.date}, ${data.supplier}, ${data.item}, ${qty}, ${price}, ${total}, ${data.paymentType || 'كاش'}, ${refCode}, ${data.createdBy || ''}, ${data.notes || ''})
      RETURNING id, ref_code
    `;

    if (!exists) {
      // First time we see this product — create it with the purchase price
      await client.sql`
        INSERT INTO products (name, buy_price, sell_price, stock, created_by)
        VALUES (${data.item}, ${price}, ${sellPriceProvided > 0 ? sellPriceProvided : 0}, ${qty}, ${data.createdBy || ''})
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

// ==================== SALES ====================

export async function getSales(clientName) {
  if (clientName) {
    const { rows } = await sql`SELECT * FROM sales WHERE client_name = ${clientName} ORDER BY id DESC`;
    return rows;
  }
  const { rows } = await sql`SELECT * FROM sales ORDER BY id DESC`;
  return rows;
}

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

    // Upsert client (inline addClient)
    if (data.clientName) {
      await client.sql`
        INSERT INTO clients (name, phone, address, email, created_by, notes)
        VALUES (${data.clientName}, ${data.clientPhone || ''}, ${data.clientAddress || ''}, ${data.clientEmail || ''}, ${data.createdBy || ''}, '')
        ON CONFLICT (name) DO UPDATE SET
          phone = CASE WHEN EXCLUDED.phone <> '' THEN EXCLUDED.phone ELSE clients.phone END,
          address = CASE WHEN EXCLUDED.address <> '' THEN EXCLUDED.address ELSE clients.address END,
          email = CASE WHEN EXCLUDED.email <> '' THEN EXCLUDED.email ELSE clients.email END
      `;
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

// ==================== EXPENSES ====================

export async function getExpenses() {
  const { rows } = await sql`SELECT * FROM expenses ORDER BY id DESC`;
  return rows;
}

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

export async function deleteExpense(id) {
  await sql`DELETE FROM expenses WHERE id = ${id}`;
}

// ==================== CLIENTS ====================

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

export async function addClient(data) {
  const { rows: existing } = await sql`SELECT id FROM clients WHERE name = ${data.name}`;
  if (existing.length > 0) {
    // Auto-update client info if new data provided
    if (data.phone || data.address || data.email) {
      await sql`
        UPDATE clients SET
          phone = CASE WHEN ${data.phone || ''} != '' THEN ${data.phone || ''} ELSE phone END,
          address = CASE WHEN ${data.address || ''} != '' THEN ${data.address || ''} ELSE address END,
          email = CASE WHEN ${data.email || ''} != '' THEN ${data.email || ''} ELSE email END
        WHERE id = ${existing[0].id}
      `;
    }
    return { id: existing[0].id, exists: true };
  }

  const { rows } = await sql`
    INSERT INTO clients (name, phone, address, email, created_by, notes)
    VALUES (${data.name}, ${data.phone || ''}, ${data.address || ''}, ${data.email || ''}, ${data.createdBy || ''}, ${data.notes || ''})
    RETURNING id
  `;
  return { id: rows[0].id };
}

export async function updateClient(data) {
  await sql`
    UPDATE clients SET name = ${data.name}, phone = ${data.phone || ''}, address = ${data.address || ''}, email = ${data.email || ''}, notes = ${data.notes || ''}
    WHERE id = ${data.id}
  `;
}

export async function deleteClient(id) {
  await sql`DELETE FROM clients WHERE id = ${id}`;
}

// ==================== PAYMENTS ====================

export async function getPayments(clientName) {
  if (clientName) {
    const { rows } = await sql`SELECT * FROM payments WHERE client_name = ${clientName} ORDER BY id DESC`;
    return rows;
  }
  const { rows } = await sql`SELECT * FROM payments ORDER BY id DESC`;
  return rows;
}

export async function addPayment(data) {
  const { rows } = await sql`
    INSERT INTO payments (date, client_name, amount, sale_id, created_by, notes)
    VALUES (${data.date}, ${data.clientName}, ${data.amount}, ${data.saleId || null}, ${data.createdBy || ''}, ${data.notes || ''})
    RETURNING id
  `;
  return rows[0].id;
}

// ==================== PRODUCTS ====================

export async function getProducts() {
  const { rows } = await sql`SELECT * FROM products ORDER BY name`;
  return rows;
}

export async function addProduct(data) {
  const { rows: existing } = await sql`SELECT id FROM products WHERE name = ${data.name}`;
  if (existing.length > 0) return { id: existing[0].id, exists: true };

  const { rows } = await sql`
    INSERT INTO products (name, category, unit, buy_price, sell_price, stock, created_by, notes)
    VALUES (${data.name}, ${data.category || ''}, ${data.unit || ''}, ${data.buyPrice || 0}, ${data.sellPrice || 0}, ${data.stock || 0}, ${data.createdBy || ''}, ${data.notes || ''})
    RETURNING id
  `;
  return { id: rows[0].id };
}

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

// ==================== SUPPLIERS ====================

export async function getSuppliers() {
  const { rows } = await sql`SELECT * FROM suppliers ORDER BY name`;
  return rows;
}

export async function addSupplier(data) {
  const { rows: existing } = await sql`SELECT id FROM suppliers WHERE name = ${data.name}`;
  if (existing.length > 0) return { id: existing[0].id, exists: true };

  const { rows } = await sql`
    INSERT INTO suppliers (name, phone, address, notes)
    VALUES (${data.name}, ${data.phone || ''}, ${data.address || ''}, ${data.notes || ''})
    RETURNING id
  `;
  return { id: rows[0].id };
}

export async function deleteSupplier(id) {
  await sql`DELETE FROM suppliers WHERE id = ${id}`;
}

// ==================== DELIVERIES ====================

export async function getDeliveries(status, assignedDriver) {
  if (status && assignedDriver) {
    const { rows } = await sql`SELECT * FROM deliveries WHERE status = ${status} AND assigned_driver = ${assignedDriver} ORDER BY id DESC`;
    return rows;
  }
  if (assignedDriver) {
    const { rows } = await sql`SELECT * FROM deliveries WHERE assigned_driver = ${assignedDriver} ORDER BY id DESC`;
    return rows;
  }
  if (status) {
    const { rows } = await sql`SELECT * FROM deliveries WHERE status = ${status} ORDER BY id DESC`;
    return rows;
  }
  const { rows } = await sql`SELECT * FROM deliveries ORDER BY id DESC`;
  return rows;
}

export async function addDelivery(data) {
  const refCode = generateRefCode('DL');
  const { rows } = await sql`
    INSERT INTO deliveries (date, client_name, client_phone, client_email, address, items, total_amount, status, driver_name, ref_code, created_by, notes)
    VALUES (${data.date}, ${data.clientName}, ${data.clientPhone || ''}, ${data.clientEmail || ''}, ${data.address}, ${data.items}, ${data.totalAmount || 0}, ${data.status || 'قيد الانتظار'}, ${data.driverName || ''}, ${refCode}, ${data.createdBy || ''}, ${data.notes || ''})
    RETURNING id, ref_code
  `;
  return rows[0].id;
}

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

      const invRef = generateRefCode('INV');
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

export async function deleteDelivery(id) {
  await sql`DELETE FROM deliveries WHERE id = ${id}`;
}

// ==================== SUMMARY ====================

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
    pendingDeliveries: pendingDeliveries.length,
    inTransitDeliveries: inTransitDeliveries.length,
    recentDeliveries: [...pendingDeliveries, ...inTransitDeliveries].slice(0, 5),
  };
}

// ==================== USERS ====================

export async function getUsers() {
  const { rows } = await sql`SELECT id, username, name, role, active, created_at FROM users ORDER BY id`;
  return rows;
}

export async function getUserByUsername(username) {
  const { rows } = await sql`SELECT * FROM users WHERE username = ${username}`;
  return rows[0] || null;
}

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

export async function updateUser(data) {
  if (data.password) {
    const bcryptjs = (await import('bcryptjs')).default;
    const hash = bcryptjs.hashSync(data.password, 12);
    await sql`UPDATE users SET name=${data.name}, role=${data.role}, password=${hash} WHERE id=${data.id}`;
  } else {
    await sql`UPDATE users SET name=${data.name}, role=${data.role} WHERE id=${data.id}`;
  }
}

export async function toggleUserActive(id) {
  await sql`UPDATE users SET active = NOT active WHERE id = ${id}`;
}

export async function deleteUser(id) {
  await sql`DELETE FROM users WHERE id = ${id}`;
}

// ==================== SETTINGS ====================

export async function getSettings() {
  const { rows } = await sql`SELECT * FROM settings`;
  const obj = {};
  rows.forEach((r) => { obj[r.key] = r.value; });
  return obj;
}

export async function updateSettings(data) {
  for (const [key, value] of Object.entries(data)) {
    await sql`INSERT INTO settings (key, value) VALUES (${key}, ${String(value)}) ON CONFLICT (key) DO UPDATE SET value = ${String(value)}`;
  }
}

// ==================== BONUSES ====================

export async function getBonuses(username) {
  if (username) {
    const { rows } = await sql`SELECT * FROM bonuses WHERE username = ${username} ORDER BY id DESC`;
    return rows;
  }
  const { rows } = await sql`SELECT * FROM bonuses ORDER BY id DESC`;
  return rows;
}

// Internal: calculate bonuses inside an existing transaction (uses caller's client).
// The UNIQUE(delivery_id, role) index makes this safe under concurrent confirmation.
async function calculateBonusInTx(client, saleId, deliveryId, driverUsername) {
  const { rows: settingRows } = await client.sql`SELECT * FROM settings`;
  const settings = {};
  settingRows.forEach((r) => { settings[r.key] = r.value; });
  const sellerFixed = parseFloat(settings.seller_bonus_fixed) || 0;
  const sellerPct = parseFloat(settings.seller_bonus_percentage) || 0;
  const driverFixed = parseFloat(settings.driver_bonus_fixed) || 0;

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
    const { rows: driverUser } = await client.sql`SELECT role FROM users WHERE username = ${driverUsername}`;
    const driverRole = driverUser.length > 0 ? driverUser[0].role : '';
    if (driverRole === 'driver') {
      await client.sql`
        INSERT INTO bonuses (date, username, role, sale_id, delivery_id, item, quantity, recommended_price, actual_price, fixed_bonus, extra_bonus, total_bonus)
        VALUES (${today}, ${driverUsername}, 'driver', ${saleId}, ${deliveryId}, ${sale.item}, ${qty}, 0, 0, ${driverFixed}, 0, ${driverFixed})
        ON CONFLICT (delivery_id, role) DO NOTHING
      `;
    }
  }
}

// Public wrapper — opens its own transaction. Kept for any external callers.
export async function calculateBonus(saleId, deliveryId, driverUsername) {
  return withTx((client) => calculateBonusInTx(client, saleId, deliveryId, driverUsername));
}

// ==================== INVOICES ====================

export async function getInvoices(username) {
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

// ==================== EDIT OPERATIONS (admin only) ====================

// Update a reserved sale. The route layer enforces status='محجوز' & ownership;
// here we additionally re-reserve stock if quantity changes and recompute totals.
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
export async function updatePurchase(data) {
  await sql`UPDATE purchases SET notes = ${data.notes || ''} WHERE id = ${data.id}`;
}

export async function updateExpense(data) {
  await sql`UPDATE expenses SET category=${data.category}, description=${data.description}, amount=${data.amount}, notes=${data.notes || ''} WHERE id=${data.id}`;
}

// ==================== SETTLEMENTS ====================

export async function getSettlements() {
  const { rows } = await sql`SELECT * FROM settlements ORDER BY id DESC`;
  return rows;
}

export async function addSettlement(data) {
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

// ==================== ENTITY ALIASES ====================

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

export async function getAllAliases(entityType) {
  try {
    const { rows } = await sql`SELECT * FROM entity_aliases WHERE entity_type = ${entityType} ORDER BY frequency DESC`;
    return rows;
  } catch { return []; }
}

// ==================== AI LEARNING ====================

// Save a correction when user edits AI-extracted data
export async function saveAICorrection(data) {
  try {
    const today = new Date().toISOString().split('T')[0];
    await sql`
      INSERT INTO ai_corrections (date, username, transcript, ai_output, user_correction, action_type, field_name)
      VALUES (${today}, ${data.username}, ${data.transcript}, ${data.aiValue}, ${data.userValue}, ${data.actionType}, ${data.fieldName})
    `;

    // Update or create pattern - KEY FIX: use transcript (what user SAID), not aiValue (what AI extracted)
    const spokenText = data.transcript || data.aiValue; // User's original speech
    const { rows: existing } = await sql`
      SELECT id, frequency FROM ai_patterns WHERE spoken_text = ${spokenText} AND correct_value = ${data.userValue} AND field_name = ${data.fieldName}
    `;
    if (existing.length > 0) {
      await sql`UPDATE ai_patterns SET frequency = frequency + 1, last_used = CURRENT_TIMESTAMP WHERE id = ${existing[0].id}`;
    } else {
      await sql`
        INSERT INTO ai_patterns (pattern_type, spoken_text, correct_value, field_name, frequency)
        VALUES (${data.actionType}, ${spokenText}, ${data.userValue}, ${data.fieldName}, 1)
      `;
    }
    // Auto-create entity alias for name fields
    // Auto-create entity alias: map what user SAID to the correct entity
    const nameFields = { client_name: 'client', supplier: 'supplier', item: 'product' };
    if (nameFields[data.fieldName] && data.userValue && data.aiValue !== data.userValue) {
      const entityType = nameFields[data.fieldName];
      const { normalizeForMatching } = await import('./voice-normalizer');
      // Alias the AI's wrong output AND the original speech to the correct entity
      const normalizedAI = normalizeForMatching(data.aiValue);
      const normalizedSpeech = normalizeForMatching(data.transcript || data.aiValue);

      // Find the entity ID from the corrected value
      let entityId = null;
      if (entityType === 'client') {
        const { rows } = await sql`SELECT id FROM clients WHERE name = ${data.userValue}`.catch(() => ({ rows: [] }));
        entityId = rows[0]?.id;
      } else if (entityType === 'supplier') {
        const { rows } = await sql`SELECT id FROM suppliers WHERE name = ${data.userValue}`.catch(() => ({ rows: [] }));
        entityId = rows[0]?.id;
      } else if (entityType === 'product') {
        const { rows } = await sql`SELECT id FROM products WHERE name = ${data.userValue}`.catch(() => ({ rows: [] }));
        entityId = rows[0]?.id;
      }

      if (entityId) {
        // Create alias for AI's wrong output → correct entity
        await addAlias(entityType, entityId, data.aiValue, normalizedAI, 'ai_correction');
        // Also create alias for original speech → correct entity (if different)
        if (normalizedSpeech !== normalizedAI) {
          await addAlias(entityType, entityId, data.transcript || data.aiValue, normalizedSpeech, 'speech_correction');
        }
      }
    }
  } catch (e) {
    console.error('saveAICorrection error:', e.message);
  }
}

// Get learned patterns for improving AI prompts
export async function getAIPatterns(limit = 20) {
  try {
    const { rows } = await sql`SELECT * FROM ai_patterns ORDER BY frequency DESC, last_used DESC LIMIT ${limit}`;
    return rows;
  } catch { return []; }
}

// Get recent corrections for few-shot learning
export async function getRecentCorrections(limit = 10) {
  try {
    const { rows } = await sql`SELECT * FROM ai_corrections ORDER BY id DESC LIMIT ${limit}`;
    return rows;
  } catch { return []; }
}
