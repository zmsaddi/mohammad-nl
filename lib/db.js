import { sql } from '@vercel/postgres';

// ==================== INIT / SEED ====================

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
      unit_price REAL NOT NULL,
      total REAL NOT NULL,
      payment_method TEXT NOT NULL,
      payment_type TEXT DEFAULT 'نقدي',
      paid_amount REAL DEFAULT 0,
      remaining REAL DEFAULT 0,
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
      default_price REAL DEFAULT 0,
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

  return true;
}

// ==================== PURCHASES ====================

export async function getPurchases() {
  const { rows } = await sql`SELECT * FROM purchases ORDER BY id DESC`;
  return rows;
}

export async function addPurchase(data) {
  const total = (parseFloat(data.quantity) || 0) * (parseFloat(data.unitPrice) || 0);
  const { rows } = await sql`
    INSERT INTO purchases (date, supplier, item, quantity, unit_price, total, payment_type, notes)
    VALUES (${data.date}, ${data.supplier}, ${data.item}, ${data.quantity}, ${data.unitPrice}, ${total}, ${data.paymentType || 'نقدي'}, ${data.notes || ''})
    RETURNING id
  `;

  // Increase product stock
  const qty = parseFloat(data.quantity) || 0;
  if (qty > 0) {
    await sql`UPDATE products SET stock = stock + ${qty} WHERE name = ${data.item}`;
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
  const total = (parseFloat(data.quantity) || 0) * (parseFloat(data.unitPrice) || 0);
  const paid = data.paymentMethod === 'نقدي' ? total : (parseFloat(data.paidAmount) || 0);
  const remaining = total - paid;

  const { rows } = await sql`
    INSERT INTO sales (date, client_name, item, quantity, unit_price, total, payment_method, payment_type, paid_amount, remaining, notes)
    VALUES (${data.date}, ${data.clientName}, ${data.item}, ${data.quantity}, ${data.unitPrice}, ${total}, ${data.paymentMethod}, ${data.paymentType || 'نقدي'}, ${paid}, ${remaining}, ${data.notes || ''})
    RETURNING id
  `;
  const saleId = rows[0].id;

  // Decrease product stock
  const qty = parseFloat(data.quantity) || 0;
  if (qty > 0) {
    await sql`UPDATE products SET stock = stock - ${qty} WHERE name = ${data.item}`;
  }

  // Auto-create delivery
  const { rows: delRows } = await sql`
    INSERT INTO deliveries (date, client_name, client_phone, address, items, total_amount, status, driver_name, notes)
    VALUES (${data.date}, ${data.clientName}, ${data.clientPhone || ''}, ${data.clientAddress || ''}, ${data.item + ' (' + data.quantity + ')'}, ${total}, 'قيد الانتظار', '', ${'بيع رقم ' + saleId})
    RETURNING id
  `;

  return { saleId, deliveryId: delRows[0].id };
}

export async function deleteSale(id) {
  await sql`DELETE FROM sales WHERE id = ${id}`;
}

// ==================== EXPENSES ====================

export async function getExpenses() {
  const { rows } = await sql`SELECT * FROM expenses ORDER BY id DESC`;
  return rows;
}

export async function addExpense(data) {
  const { rows } = await sql`
    INSERT INTO expenses (date, category, description, amount, payment_type, notes)
    VALUES (${data.date}, ${data.category}, ${data.description}, ${data.amount}, ${data.paymentType || 'نقدي'}, ${data.notes || ''})
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
  if (existing.length > 0) return { id: existing[0].id, exists: true };

  const { rows } = await sql`
    INSERT INTO clients (name, phone, address, notes)
    VALUES (${data.name}, ${data.phone || ''}, ${data.address || ''}, ${data.notes || ''})
    RETURNING id
  `;
  return { id: rows[0].id };
}

export async function updateClient(data) {
  await sql`
    UPDATE clients SET name = ${data.name}, phone = ${data.phone || ''}, address = ${data.address || ''}, notes = ${data.notes || ''}
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
    INSERT INTO payments (date, client_name, amount, sale_id, notes)
    VALUES (${data.date}, ${data.clientName}, ${data.amount}, ${data.saleId || null}, ${data.notes || ''})
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
    INSERT INTO products (name, category, unit, default_price, stock, notes)
    VALUES (${data.name}, ${data.category || ''}, ${data.unit || ''}, ${data.defaultPrice || 0}, ${data.stock || 0}, ${data.notes || ''})
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
  const { rows } = await sql`
    INSERT INTO deliveries (date, client_name, client_phone, address, items, total_amount, status, driver_name, notes)
    VALUES (${data.date}, ${data.clientName}, ${data.clientPhone || ''}, ${data.address}, ${data.items}, ${data.totalAmount || 0}, ${data.status || 'قيد الانتظار'}, ${data.driverName || ''}, ${data.notes || ''})
    RETURNING id
  `;
  return rows[0].id;
}

export async function updateDelivery(data) {
  await sql`
    UPDATE deliveries SET date=${data.date}, client_name=${data.clientName}, client_phone=${data.clientPhone || ''}, address=${data.address}, items=${data.items}, total_amount=${data.totalAmount || 0}, status=${data.status}, driver_name=${data.driverName || ''}, notes=${data.notes || ''}
    WHERE id = ${data.id}
  `;
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

  const totalPurchases = purchases.reduce((s, r) => s + (r.total || 0), 0);
  const totalSales = sales.reduce((s, r) => s + (r.total || 0), 0);
  const totalExpenses = expenses.reduce((s, r) => s + (r.amount || 0), 0);

  // Delivered sales only for profit calculation
  const deliveredClients = new Set(deliveries.filter((d) => d.status === 'تم التوصيل').map((d) => d.notes));
  const deliveredSalesTotal = sales
    .filter((s) => deliveredClients.has('بيع رقم ' + s.id))
    .reduce((sum, s) => sum + (s.total || 0), 0);

  const grossProfit = totalSales - totalPurchases;
  const netProfit = grossProfit - totalExpenses;
  const deliveredProfit = deliveredSalesTotal - totalPurchases - totalExpenses;

  // Cash vs Bank breakdown
  const salesCash = sales.filter((s) => s.payment_type !== 'بنك').reduce((s, r) => s + (r.total || 0), 0);
  const salesBank = sales.filter((s) => s.payment_type === 'بنك').reduce((s, r) => s + (r.total || 0), 0);
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
    const ms = sales.filter((r) => r.date?.startsWith(ym)).reduce((s, r) => s + (r.total || 0), 0);
    const me = expenses.filter((r) => r.date?.startsWith(ym)).reduce((s, r) => s + (r.amount || 0), 0);

    monthlyData.push({ month: monthName, purchases: mp, sales: ms, expenses: me, profit: ms - mp - me });
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
    totalPurchases, totalSales, totalExpenses, grossProfit, netProfit, deliveredProfit, totalDebt,
    salesCash, salesBank, purchasesCash, purchasesBank, expensesCash, expensesBank,
    monthlyData, expenseByCategory, topDebtors,
    pendingDeliveries: pendingDeliveries.length,
    inTransitDeliveries: inTransitDeliveries.length,
    recentDeliveries: [...pendingDeliveries, ...inTransitDeliveries].slice(0, 5),
  };
}
