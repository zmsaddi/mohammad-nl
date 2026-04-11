import { sql } from '@vercel/postgres';

// Generate unique reference code: SL-20260411-001, PU-20260411-001, DL-20260411-001
function generateRefCode(prefix) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const ts = String(Date.now()).slice(-6);
  return `${prefix}-${date}-${ts}`;
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
      payment_type TEXT DEFAULT 'نقدي',
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
      payment_type TEXT DEFAULT 'نقدي',
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
      payment_type TEXT DEFAULT 'نقدي',
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
  if (qty <= 0) throw new Error('الكمية لازم تكون أكبر من 0');
  if (price <= 0) throw new Error('السعر لازم يكون أكبر من 0');
  const total = qty * price;
  const refCode = generateRefCode('PU');
  const { rows } = await sql`
    INSERT INTO purchases (date, supplier, item, quantity, unit_price, total, payment_type, ref_code, created_by, notes)
    VALUES (${data.date}, ${data.supplier}, ${data.item}, ${data.quantity}, ${data.unitPrice}, ${total}, ${data.paymentType || 'نقدي'}, ${refCode}, ${data.createdBy || ''}, ${data.notes || ''})
    RETURNING id, ref_code
  `;

  // Log price before change
  const { rows: oldProduct } = await sql`SELECT buy_price, sell_price FROM products WHERE name = ${data.item}`;
  const oldBuy = oldProduct.length > 0 ? oldProduct[0].buy_price : 0;
  const oldSell = oldProduct.length > 0 ? oldProduct[0].sell_price : 0;

  // Increase product stock and update buy price
  if (qty > 0) {
    // Weighted average cost: (old_stock * old_price + new_qty * new_price) / (old_stock + new_qty)
    await sql`
      UPDATE products SET
        buy_price = CASE
          WHEN (stock + ${qty}::real) > 0 THEN (stock * buy_price + ${qty}::real * ${price}::real) / (stock + ${qty}::real)
          ELSE ${price}::real
        END,
        sell_price = CASE
          WHEN ${parseFloat(data.sellPrice) || 0}::real > 0 THEN ${parseFloat(data.sellPrice)}::real
          ELSE sell_price
        END,
        stock = stock + ${qty}::real
      WHERE name = ${data.item}
    `;

    // Log price change
    const { rows: newProduct } = await sql`SELECT buy_price, sell_price FROM products WHERE name = ${data.item}`;
    if (newProduct.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      await sql`INSERT INTO price_history (date, product_name, old_buy_price, new_buy_price, old_sell_price, new_sell_price, purchase_id, changed_by)
        VALUES (${today}, ${data.item}, ${oldBuy}, ${newProduct[0].buy_price}, ${oldSell}, ${newProduct[0].sell_price}, ${rows[0].id}, ${data.createdBy || ''})`.catch(() => {});
    }
  }

  return rows[0].id;
}

export async function deletePurchase(id) {
  await sql`DELETE FROM purchases WHERE id = ${id}`;
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
  const total = qty * sellPrice;

  // ALL sales start unpaid - payment confirmed after delivery
  // كاش/بنك: يتحول لمدفوع عند تأكيد التوصيل
  // آجل: يبقى دين على العميل حتى بعد التوصيل
  // Validate payment type
  const validPayments = ['كاش', 'بنك', 'آجل'];
  const paymentType = validPayments.includes(data.paymentType) ? data.paymentType : 'كاش';

  // Validate quantity and price
  if (qty <= 0) throw new Error('الكمية لازم تكون أكبر من 0');
  if (sellPrice <= 0) throw new Error('السعر لازم يكون أكبر من 0');

  // Get product buy price + check stock
  const { rows: productRows } = await sql`SELECT buy_price, stock, sell_price FROM products WHERE name = ${data.item}`;
  if (productRows.length === 0) throw new Error('المنتج غير موجود');
  const recommendedPrice = productRows[0].sell_price || 0;
  const currentStock = productRows[0].stock || 0;
  if (qty > currentStock) throw new Error(`الكمية المطلوبة (${qty}) أكبر من المخزون المتاح (${currentStock})`);
  const costPrice = productRows[0].buy_price || 0;
  const costTotal = qty * costPrice;
  const profit = total - costTotal;

  // Status = محجوز (reserved) - confirmed only after delivery
  const saleRef = generateRefCode('SL');
  const { rows } = await sql`
    INSERT INTO sales (date, client_name, item, quantity, cost_price, unit_price, total, cost_total, profit, payment_method, payment_type, paid_amount, remaining, status, ref_code, created_by, recommended_price, notes)
    VALUES (${data.date}, ${data.clientName}, ${data.item}, ${data.quantity}, ${costPrice}, ${sellPrice}, ${total}, ${costTotal}, ${profit}, ${paymentType}, ${paymentType}, ${0}, ${total}, 'محجوز', ${saleRef}, ${data.createdBy || ''}, ${recommendedPrice}, ${data.notes || ''})
    RETURNING id
  `;
  const saleId = rows[0].id;

  // Reserve stock (decrease available quantity)
  if (qty > 0) {
    await sql`UPDATE products SET stock = GREATEST(0, stock - ${qty}) WHERE name = ${data.item}`;
  }

  // Auto-update client info if provided
  if (data.clientName) {
    await addClient({
      name: data.clientName,
      phone: data.clientPhone || '',
      address: data.clientAddress || '',
      email: data.clientEmail || '',
      createdBy: data.createdBy || '',
    });
  }

  // Auto-create delivery with full client info
  const delRef = generateRefCode('DL');
  const { rows: delRows } = await sql`
    INSERT INTO deliveries (date, client_name, client_phone, client_email, address, items, total_amount, status, driver_name, ref_code, created_by, sale_id, notes)
    VALUES (${data.date}, ${data.clientName}, ${data.clientPhone || ''}, ${data.clientEmail || ''}, ${data.clientAddress || ''}, ${data.item + ' (' + data.quantity + ')'}, ${total}, 'قيد الانتظار', '', ${delRef}, ${data.createdBy || ''}, ${saleId}, ${'بيع رقم ' + saleId})
    RETURNING id, ref_code
  `;

  return { saleId, deliveryId: delRows[0].id, refCode: saleRef };
}

export async function deleteSale(id) {
  // Return stock before deleting
  const { rows: saleData } = await sql`SELECT item, quantity, status FROM sales WHERE id = ${id}`;
  if (saleData.length > 0 && saleData[0].status !== 'ملغي') {
    const qty = saleData[0].quantity || 0;
    if (qty > 0) {
      await sql`UPDATE products SET stock = stock + ${qty}::real WHERE name = ${saleData[0].item}`;
    }
  }
  // Cascade delete: delivery + invoice + bonuses
  await sql`DELETE FROM deliveries WHERE sale_id = ${id}`.catch(() => {});
  await sql`DELETE FROM invoices WHERE sale_id = ${id}`.catch(() => {});
  await sql`DELETE FROM bonuses WHERE sale_id = ${id}`.catch(() => {});
  await sql`DELETE FROM sales WHERE id = ${id}`;
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

    const totalCreditSales = clientSales
      .filter((s) => s.payment_method === 'آجل')
      .reduce((sum, s) => sum + (s.total || 0), 0);
    const totalPaidAtSale = clientSales
      .filter((s) => s.payment_method === 'آجل')
      .reduce((sum, s) => sum + (s.paid_amount || 0), 0);
    const totalLaterPayments = clientPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

    const totalPaid = clientSales
      .filter((s) => s.payment_method === 'نقدي')
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

export async function getDeliveries(status) {
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
    INSERT INTO deliveries (date, client_name, client_phone, client_email, address, items, total_amount, status, driver_name, ref_code, notes)
    VALUES (${data.date}, ${data.clientName}, ${data.clientPhone || ''}, ${data.clientEmail || ''}, ${data.address}, ${data.items}, ${data.totalAmount || 0}, ${data.status || 'قيد الانتظار'}, ${data.driverName || ''}, ${refCode}, ${data.notes || ''})
    RETURNING id, ref_code
  `;
  return rows[0].id;
}

export async function updateDelivery(data) {
  // Get old status before update
  const { rows: oldRows } = await sql`SELECT status, notes FROM deliveries WHERE id = ${data.id}`;
  const oldStatus = oldRows.length > 0 ? oldRows[0].status : '';
  const deliveryNotes = oldRows.length > 0 ? oldRows[0].notes : '';

  await sql`
    UPDATE deliveries SET date=${data.date}, client_name=${data.clientName}, client_phone=${data.clientPhone || ''}, address=${data.address}, items=${data.items}, total_amount=${data.totalAmount || 0}, status=${data.status}, driver_name=${data.driverName || ''}, notes=${data.notes || ''}
    WHERE id = ${data.id}
  `;

  // Get sale ID - prefer sale_id column, fallback to notes regex
  const { rows: deliveryData } = await sql`SELECT sale_id FROM deliveries WHERE id = ${data.id}`;
  let saleId = deliveryData.length > 0 ? deliveryData[0].sale_id : null;
  if (!saleId) {
    const saleIdMatch = deliveryNotes.match(/بيع رقم (\d+)/);
    if (saleIdMatch) saleId = parseInt(saleIdMatch[1]);
  }
  if (!saleId) return;

  // Prevent double confirmation (race condition)
  const { rows: currentDel } = await sql`SELECT status FROM deliveries WHERE id = ${data.id}`;
  if (currentDel.length > 0 && currentDel[0].status === 'تم التوصيل' && data.status === 'تم التوصيل') return;

  // DELIVERY CONFIRMED → Confirm sale + mark payment + save VIN + create invoice + bonuses
  if (data.status === 'تم التوصيل' && oldStatus !== 'تم التوصيل') {
    // Save VIN if provided
    if (data.vin) {
      await sql`UPDATE sales SET vin = ${data.vin} WHERE id = ${saleId}`;
    }
    // Mark sale as confirmed
    await sql`UPDATE sales SET status = 'مؤكد' WHERE id = ${saleId}`;
    // كاش/بنك → mark as fully paid. آجل → stays as debt
    await sql`UPDATE sales SET paid_amount = CASE WHEN payment_type != 'آجل' THEN total ELSE paid_amount END, remaining = CASE WHEN payment_type != 'آجل' THEN 0 ELSE remaining END WHERE id = ${saleId}`;

    // Create invoice
    const { rows: saleData } = await sql`SELECT * FROM sales WHERE id = ${saleId}`;
    if (saleData.length > 0) {
      const s = saleData[0];
      const invRef = generateRefCode('INV');
      const { rows: delData } = await sql`SELECT * FROM deliveries WHERE id = ${parseInt(data.id)}`;
      const d = delData.length > 0 ? delData[0] : {};
      const { rows: sellerData } = await sql`SELECT name FROM users WHERE username = ${s.created_by || ''}`;
      const sellerName = sellerData.length > 0 ? sellerData[0].name : s.created_by || '';
      await sql`
        INSERT INTO invoices (ref_code, date, sale_id, delivery_id, client_name, client_phone, client_email, client_address, item, quantity, unit_price, total, payment_type, vin, seller_name, driver_name)
        VALUES (${invRef}, ${new Date().toISOString().split('T')[0]}, ${saleId}, ${parseInt(data.id)}, ${s.client_name}, ${d.client_phone || ''}, ${d.client_email || ''}, ${d.address || ''}, ${s.item}, ${s.quantity}, ${s.unit_price}, ${s.total}, ${s.payment_type || 'كاش'}, ${data.vin || s.vin || ''}, ${sellerName}, ${data.driverName || d.driver_name || ''})
      `;
    }

    // Calculate bonuses for seller and driver
    const driverUser = data.driverName || data.assignedDriver || '';
    await calculateBonus(saleId, parseInt(data.id), driverUser);
  }

  // DELIVERY CANCELLED → Cancel sale + return stock
  if (data.status === 'ملغي' && oldStatus !== 'ملغي') {
    const { rows: saleRows } = await sql`SELECT item, quantity, status FROM sales WHERE id = ${saleId}`;
    if (saleRows.length > 0 && saleRows[0].status !== 'ملغي') {
      const qty = saleRows[0].quantity || 0;
      // Return reserved stock
      if (qty > 0) {
        await sql`UPDATE products SET stock = stock + ${qty}::real WHERE name = ${saleRows[0].item}`;
      }
      await sql`UPDATE sales SET status = 'ملغي', paid_amount = 0, remaining = 0 WHERE id = ${saleId}`;
      // Delete orphaned invoice
      await sql`DELETE FROM invoices WHERE sale_id = ${saleId}`.catch(() => {});
      // Reverse bonuses for this delivery
      await sql`DELETE FROM bonuses WHERE delivery_id = ${parseInt(data.id)}`.catch(() => {});
    }
  }
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

  ({ rows: payments } = await sql`SELECT * FROM payments`);
  ({ rows: deliveries } = await sql`SELECT * FROM deliveries`);

  // Get settlements (bonus payouts = business expense)
  let allSettlements;
  ({ rows: allSettlements } = await sql`SELECT * FROM settlements`);

  // Get unsettled bonuses (liability)
  let allBonuses;
  ({ rows: allBonuses } = await sql`SELECT * FROM bonuses`);

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

  const totalCreditSales = sales.filter((s) => s.payment_method === 'آجل').reduce((s, r) => s + (r.total || 0), 0);
  const totalPaidAtSale = sales.filter((s) => s.payment_method === 'آجل').reduce((s, r) => s + (r.paid_amount || 0), 0);
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
  sales.filter((s) => s.payment_method === 'آجل').forEach((s) => {
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

export async function calculateBonus(saleId, deliveryId, driverUsername) {
  // Get settings
  const settings = await getSettings();
  const sellerFixed = parseFloat(settings.seller_bonus_fixed) || 0;
  const sellerPct = parseFloat(settings.seller_bonus_percentage) || 0;
  const driverFixed = parseFloat(settings.driver_bonus_fixed) || 0;

  // Get sale info
  const { rows: saleRows } = await sql`SELECT * FROM sales WHERE id = ${saleId}`;
  if (!saleRows.length) return;
  const sale = saleRows[0];

  // Use recommended price stored at time of sale (not current product price)
  const recommended = sale.recommended_price || 0;
  const actual = sale.unit_price || 0;
  const qty = sale.quantity || 0;

  // Check no duplicate bonus for this delivery
  const { rows: existing } = await sql`SELECT id FROM bonuses WHERE delivery_id = ${deliveryId} AND role = 'seller'`;

  // Seller bonus (only for role=seller, NOT admin/manager)
  const { rows: sellerUser } = await sql`SELECT role FROM users WHERE username = ${sale.created_by || ''}`;
  const sellerRole = sellerUser.length > 0 ? sellerUser[0].role : '';
  if (!existing.length && sale.created_by && sellerRole === 'seller') {
    const extra = Math.max(0, actual - recommended) * qty;
    const extraBonus = extra * sellerPct / 100;
    const totalBonus = sellerFixed + extraBonus;
    const today = new Date().toISOString().split('T')[0];
    await sql`
      INSERT INTO bonuses (date, username, role, sale_id, delivery_id, item, quantity, recommended_price, actual_price, fixed_bonus, extra_bonus, total_bonus)
      VALUES (${today}, ${sale.created_by}, 'seller', ${saleId}, ${deliveryId}, ${sale.item}, ${qty}, ${recommended}, ${actual}, ${sellerFixed}, ${extraBonus}, ${totalBonus})
    `;
  }

  // Driver bonus (only for role=driver, NOT admin/manager)
  const { rows: driverUser } = await sql`SELECT role FROM users WHERE username = ${driverUsername || ''}`;
  const driverRole = driverUser.length > 0 ? driverUser[0].role : '';
  const { rows: driverExisting } = await sql`SELECT id FROM bonuses WHERE delivery_id = ${deliveryId} AND role = 'driver'`;
  if (!driverExisting.length && driverUsername && driverRole === 'driver') {
    const today = new Date().toISOString().split('T')[0];
    await sql`
      INSERT INTO bonuses (date, username, role, sale_id, delivery_id, item, quantity, recommended_price, actual_price, fixed_bonus, extra_bonus, total_bonus)
      VALUES (${today}, ${driverUsername}, 'driver', ${saleId}, ${deliveryId}, ${sale.item}, ${qty}, 0, 0, ${driverFixed}, 0, ${driverFixed})
    `;
  }
}

// ==================== INVOICES ====================

export async function getInvoices(username) {
  if (username) {
    const { rows } = await sql`SELECT * FROM invoices WHERE seller_name IN (SELECT name FROM users WHERE username = ${username}) OR seller_name = ${username} ORDER BY id DESC`;
    return rows;
  }
  const { rows } = await sql`SELECT * FROM invoices ORDER BY id DESC`;
  return rows;
}

export async function voidInvoice(id) {
  await sql`UPDATE invoices SET status = 'ملغي' WHERE id = ${id}`;
}

// ==================== EDIT OPERATIONS (admin only) ====================

export async function updateSale(data) {
  await sql`UPDATE sales SET client_name=${data.clientName}, item=${data.item}, quantity=${data.quantity}, unit_price=${data.unitPrice}, notes=${data.notes || ''} WHERE id=${data.id}`;
}

export async function updatePurchase(data) {
  await sql`UPDATE purchases SET supplier=${data.supplier}, item=${data.item}, quantity=${data.quantity}, unit_price=${data.unitPrice}, notes=${data.notes || ''} WHERE id=${data.id}`;
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
  const { rows } = await sql`
    INSERT INTO settlements (date, type, username, description, amount, settled_by, notes)
    VALUES (${data.date}, ${data.type}, ${data.username || ''}, ${data.description}, ${data.amount}, ${data.settledBy}, ${data.notes || ''})
    RETURNING id
  `;
  const settlementId = rows[0].id;

  // Partial settlement: mark bonuses settled up to the paid amount (FIFO order)
  if (data.username && (data.type === 'seller_payout' || data.type === 'driver_payout')) {
    const paidAmount = parseFloat(data.amount) || 0;
    const { rows: unsettledBonuses } = await sql`
      SELECT id, total_bonus FROM bonuses WHERE username = ${data.username} AND settled = false ORDER BY id ASC
    `;
    let remaining = paidAmount;
    for (const bonus of unsettledBonuses) {
      if (remaining <= 0) break;
      if (remaining >= bonus.total_bonus) {
        // Fully settle this bonus
        await sql`UPDATE bonuses SET settled = true, settlement_id = ${settlementId} WHERE id = ${bonus.id}`;
        remaining -= bonus.total_bonus;
      } else {
        // Partial: don't mark as settled - the amount doesn't cover this bonus fully
        // The remaining will be settled in next settlement
        break;
      }
    }
  }

  return settlementId;
}
