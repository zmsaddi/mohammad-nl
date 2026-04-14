// FEAT-04: getSummaryData cash-basis aggregates tests.
//
// Verifies that the summary payload now carries separate accrual vs
// cash-basis P&L aggregates + pending collection totals + period VAT.
//
// Run with: npx vitest run tests/feat04-cash-basis-summary.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import bcryptjs from 'bcryptjs';
import {
  initDatabase,
  addSale,
  updateDelivery,
  applyCollection,
  getSummaryData,
} from '../lib/db.js';

const TRUNCATE_TABLES = [
  'cancellations',
  'sales', 'purchases', 'deliveries', 'invoices', 'bonuses',
  'settlements', 'payments', 'expenses', 'clients', 'products',
  'suppliers', 'voice_logs', 'ai_corrections', 'entity_aliases',
  'ai_patterns', 'price_history',
];

async function truncateBusinessTables() {
  const list = TRUNCATE_TABLES.map((t) => `"${t}"`).join(', ');
  await sql.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function seedUsers() {
  const hash = bcryptjs.hashSync('test-password', 12);
  await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES ('feat04-sum-seller', ${hash}, 'Sum Seller', 'seller', true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = 'seller'
  `;
  await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES ('feat04-sum-driver', ${hash}, 'Sum Driver', 'driver', true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = 'driver'
  `;
}

async function createConfirmed(name, price, dpe, date) {
  await sql`
    INSERT INTO products (name, category, unit, buy_price, sell_price, stock, created_by, notes)
    VALUES (${name}, 'e-bike', '', 500, ${price}, 10, 'test-seed', '')
    ON CONFLICT (name) DO UPDATE SET stock = 10, buy_price = 500, sell_price = ${price}
  `;
  const { saleId, deliveryId } = await addSale({
    date,
    clientName: `Client-${name}`,
    clientAddress: 'Test Address',
    item: name,
    quantity: 1,
    unitPrice: price,
    paymentType: dpe === price ? 'كاش' : 'آجل',
    downPaymentExpected: dpe,
    createdBy: 'feat04-sum-seller',
  });
  await sql`UPDATE deliveries SET assigned_driver = 'feat04-sum-driver' WHERE id = ${deliveryId}`;
  await updateDelivery({
    id: deliveryId,
    date,
    clientName: `Client-${name}`,
    clientPhone: '',
    address: '',
    items: `${name} (1)`,
    totalAmount: price,
    status: 'تم التوصيل',
    driverName: 'feat04-sum-driver',
    assignedDriver: 'feat04-sum-driver',
    notes: '',
    vin: `VIN-SUM-${saleId}`,
  });
  return saleId;
}

describe('FEAT-04: getSummaryData cash-basis aggregates', () => {
  beforeAll(async () => {
    await initDatabase();
  }, 30000);

  beforeEach(async () => {
    await truncateBusinessTables();
    await seedUsers();
  });

  afterAll(async () => {
    await truncateBusinessTables();
    await sql`DELETE FROM users WHERE username IN ('feat04-sum-seller', 'feat04-sum-driver')`;
  });

  it('mixed paid/partial sales: accrual ≠ cash-basis', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Paid cash sale: 1000
    await createConfirmed('Sum Paid A', 1000, 1000, today);
    // Partial credit: 2000 total, 800 dpe, 1200 remaining
    await createConfirmed('Sum Partial B', 2000, 800, today);

    const data = await getSummaryData();

    // Accrual counts both as revenue
    expect(data.totalRevenueAccrued).toBe(3000);
    expect(data.totalRevenue).toBe(3000);

    // Cash-basis counts only the fully-paid one
    expect(data.totalRevenueCashBasis).toBe(1000);
    expect(data.paidSalesCount).toBe(1);
    expect(data.partialSalesCount).toBe(1);
  });

  it('pendingRevenue equals sum of partial sales remaining', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await createConfirmed('Sum Pend A', 1500, 500, today); // remaining 1000
    await createConfirmed('Sum Pend B', 2400, 900, today); // remaining 1500

    const data = await getSummaryData();
    expect(data.pendingRevenue).toBe(2500);
    expect(data.pendingTva).toBeCloseTo(2500 / 6, 2);
  });

  it('totalVatCollected equals sum of payments.tva_amount in period', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Full cash sale — writes 1200€ collection with 200 TVA
    await createConfirmed('Sum VAT A', 1200, 1200, today);

    const data = await getSummaryData();
    expect(data.totalVatCollected).toBeCloseTo(200, 2);

    // Add a manual collection on a credit sale
    const saleId = await createConfirmed('Sum VAT B', 600, 0, today);
    await applyCollection(saleId, 300, 'كاش', 'test-admin');

    const data2 = await getSummaryData();
    // 200 (from dpe) + 50 (from manual collection 300/6)
    expect(data2.totalVatCollected).toBeCloseTo(250, 2);
  });

  it('empty DB returns zero for all new aggregates', async () => {
    const data = await getSummaryData();
    expect(data.totalRevenueCashBasis).toBe(0);
    expect(data.totalCOGSCashBasis).toBe(0);
    expect(data.grossProfitCashBasis).toBe(0);
    expect(data.pendingRevenue).toBe(0);
    expect(data.pendingTva).toBe(0);
    expect(data.totalVatCollected).toBe(0);
    expect(data.paidSalesCount).toBe(0);
    expect(data.partialSalesCount).toBe(0);
  });
});
