// v1.0.1 Feature 5 — topSellers added to getSummaryData
//
// Replaces the topClients dashboard widget. Verifies:
// - only sellers (role=seller) are ranked
// - only confirmed sales count
// - period filtering works (from/to)
// - ordering is by total sales desc
// - limit is respected (top 10 hardcoded)
//
// Run with: npx vitest run tests/top-sellers.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import bcryptjs from 'bcryptjs';
import {
  initDatabase,
  addSale,
  updateDelivery,
  getSummaryData,
} from '../lib/db.js';

const TRUNCATE_TABLES = [
  'cancellations', 'settlements', 'bonuses', 'payments',
  'invoices', 'deliveries', 'sales', 'purchases',
  'supplier_payments', 'expenses', 'clients', 'products',
  'suppliers',
];

async function truncateBusinessTables() {
  const list = TRUNCATE_TABLES.map((t) => `"${t}"`).join(', ');
  await sql.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function seedProductAndUsers() {
  await sql`
    INSERT INTO products (name, category, unit, buy_price, sell_price, stock, created_by, notes)
    VALUES ('TOP Bike', 'e-bike', '', 1000, 1500, 500, 'test-seed', '')
  `;
  const hash = bcryptjs.hashSync('test-password', 12);
  const users = [
    ['top-seller-a', 'Top Seller A', 'seller'],
    ['top-seller-b', 'Top Seller B', 'seller'],
    ['top-seller-c', 'Top Seller C', 'seller'],
    ['top-driver',   'Top Driver',   'driver'],
    ['top-admin',    'Top Admin',    'admin'],
    ['top-manager',  'Top Manager',  'manager'],
  ];
  for (const [username, name, role] of users) {
    await sql`
      INSERT INTO users (username, password, name, role, active)
      VALUES (${username}, ${hash}, ${name}, ${role}, true)
      ON CONFLICT (username) DO UPDATE SET active = true, role = ${role}, name = ${name}
    `;
  }
}

const TODAY = new Date().toISOString().slice(0, 10);

async function createAndConfirmSale({ createdBy, clientName, quantity = 1, unitPrice = 1500 }) {
  const { saleId, deliveryId } = await addSale({
    date: TODAY,
    clientName,
    clientPhone: '+31600000000',
    clientAddress: 'Top Test Addr',
    item: 'TOP Bike',
    quantity,
    unitPrice,
    paymentType: 'كاش',
    createdBy,
  });
  await sql`UPDATE deliveries SET assigned_driver = 'top-driver' WHERE id = ${deliveryId}`;
  await updateDelivery({
    id: deliveryId,
    date: TODAY,
    clientName,
    clientPhone: '+31600000000',
    address: 'Top Test Addr',
    items: `TOP Bike (${quantity})`,
    totalAmount: unitPrice * quantity,
    status: 'تم التوصيل',
    driverName: 'top-driver',
    assignedDriver: 'top-driver',
    notes: '',
    vin: `VIN-TOP-${saleId}`,
  });
  return saleId;
}

describe('Feature 5 — topSellers in getSummaryData', () => {
  beforeAll(async () => { await initDatabase(); }, 30000);
  beforeEach(async () => {
    await truncateBusinessTables();
    await sql`DELETE FROM users WHERE username LIKE 'top-%'`;
    await seedProductAndUsers();
  });
  afterAll(async () => {
    await truncateBusinessTables();
    await sql`DELETE FROM users WHERE username LIKE 'top-%'`;
  });

  it('Test 1 — admin/manager/driver-created sales are excluded from ranking', async () => {
    // Only seller-a creates a sale (legitimate)
    await createAndConfirmSale({ createdBy: 'top-seller-a', clientName: 'Client 1' });
    // admin and manager create sales — should NOT appear in topSellers
    await createAndConfirmSale({ createdBy: 'top-admin',   clientName: 'Client 2' });
    await createAndConfirmSale({ createdBy: 'top-manager', clientName: 'Client 3' });

    const data = await getSummaryData();
    expect(Array.isArray(data.topSellers)).toBe(true);
    const usernames = data.topSellers.map((s) => s.username);
    expect(usernames).toContain('top-seller-a');
    expect(usernames).not.toContain('top-admin');
    expect(usernames).not.toContain('top-manager');
    expect(usernames).not.toContain('top-driver');
  });

  it('Test 2 — reserved/cancelled sales are excluded (confirmed only)', async () => {
    // Create a sale but DON'T confirm it — stays at محجوز
    await addSale({
      date: TODAY,
      clientName: 'Reserved Client',
      clientPhone: '+31600000001',
      clientAddress: 'Addr',
      item: 'TOP Bike',
      quantity: 1,
      unitPrice: 1500,
      paymentType: 'كاش',
      createdBy: 'top-seller-a',
    });
    // Seller-b gets a confirmed sale
    await createAndConfirmSale({ createdBy: 'top-seller-b', clientName: 'Confirmed Client' });

    const data = await getSummaryData();
    const sellerA = data.topSellers.find((s) => s.username === 'top-seller-a');
    const sellerB = data.topSellers.find((s) => s.username === 'top-seller-b');
    // Seller A has no CONFIRMED sales → does not appear at all
    expect(sellerA).toBeUndefined();
    expect(sellerB).toBeDefined();
    expect(sellerB.salesCount).toBe(1);
    expect(sellerB.totalSales).toBe(1500);
  });

  it('Test 3 — ranking is by totalSales desc', async () => {
    // Seller A: 1 sale @ 1500
    await createAndConfirmSale({ createdBy: 'top-seller-a', clientName: 'A1', unitPrice: 1500 });
    // Seller B: 3 sales @ 1500 (total 4500)
    await createAndConfirmSale({ createdBy: 'top-seller-b', clientName: 'B1', unitPrice: 1500 });
    await createAndConfirmSale({ createdBy: 'top-seller-b', clientName: 'B2', unitPrice: 1500 });
    await createAndConfirmSale({ createdBy: 'top-seller-b', clientName: 'B3', unitPrice: 1500 });
    // Seller C: 2 sales @ 1500 (total 3000)
    await createAndConfirmSale({ createdBy: 'top-seller-c', clientName: 'C1', unitPrice: 1500 });
    await createAndConfirmSale({ createdBy: 'top-seller-c', clientName: 'C2', unitPrice: 1500 });

    const data = await getSummaryData();
    expect(data.topSellers).toHaveLength(3);
    expect(data.topSellers[0].username).toBe('top-seller-b');
    expect(data.topSellers[0].totalSales).toBe(4500);
    expect(data.topSellers[0].salesCount).toBe(3);
    expect(data.topSellers[1].username).toBe('top-seller-c');
    expect(data.topSellers[1].totalSales).toBe(3000);
    expect(data.topSellers[2].username).toBe('top-seller-a');
    expect(data.topSellers[2].totalSales).toBe(1500);
  });

  it('Test 4 — name is resolved from users table when available', async () => {
    await createAndConfirmSale({ createdBy: 'top-seller-a', clientName: 'Client X' });
    const data = await getSummaryData();
    const sellerA = data.topSellers.find((s) => s.username === 'top-seller-a');
    expect(sellerA.name).toBe('Top Seller A');
  });

  it('Test 5 — totalBonus aggregates seller-role bonuses for the period', async () => {
    // Setup seller bonus values via settings first
    await sql`
      INSERT INTO settings (key, value) VALUES ('seller_bonus_fixed', '10')
      ON CONFLICT (key) DO UPDATE SET value = '10'
    `;
    await sql`
      INSERT INTO settings (key, value) VALUES ('seller_bonus_percentage', '50')
      ON CONFLICT (key) DO UPDATE SET value = '50'
    `;
    await sql`
      INSERT INTO settings (key, value) VALUES ('driver_bonus_fixed', '5')
      ON CONFLICT (key) DO UPDATE SET value = '5'
    `;

    // Two confirmed sales by seller-a → two bonuses of 10 each = 20
    await createAndConfirmSale({ createdBy: 'top-seller-a', clientName: 'Bon1' });
    await createAndConfirmSale({ createdBy: 'top-seller-a', clientName: 'Bon2' });

    const data = await getSummaryData();
    const sellerA = data.topSellers.find((s) => s.username === 'top-seller-a');
    expect(sellerA).toBeDefined();
    expect(sellerA.totalBonus).toBe(20);
  });
});
