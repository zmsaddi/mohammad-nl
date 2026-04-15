// v1.0.1 Feature 6 — supplier credit (partial payment flow)
//
// Verifies the schema migration, addPurchase's paid_amount handling,
// paySupplier's overpay guard, and the getSupplierPayments audit trail.
//
// Run with: npx vitest run tests/supplier-credit.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import {
  initDatabase,
  addPurchase,
  paySupplier,
  getSupplierPayments,
  getPurchases,
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

async function getPurchase(id) {
  const { rows } = await sql`SELECT * FROM purchases WHERE id = ${id}`;
  return rows[0] || null;
}

describe('Feature 6 — supplier credit', () => {
  beforeAll(async () => { await initDatabase(); }, 30000);
  beforeEach(async () => { await truncateBusinessTables(); });
  afterAll(async () => { await truncateBusinessTables(); });

  it('Test 1 — addPurchase with omitted paidAmount → paid in full', async () => {
    const id = await addPurchase({
      date: '2026-04-15',
      supplier: 'SUP Test 1',
      item: 'SUP Item 1',
      category: 'قطع غيار',
      quantity: 10,
      unitPrice: 100,
      paymentType: 'كاش',
      createdBy: 'test-admin',
    });
    const p = await getPurchase(id);
    expect(parseFloat(p.total)).toBe(1000);
    expect(parseFloat(p.paid_amount)).toBe(1000);
    expect(p.payment_status).toBe('paid');
  });

  it('Test 2 — addPurchase with paidAmount=0 → pending', async () => {
    const id = await addPurchase({
      date: '2026-04-15',
      supplier: 'SUP Test 2',
      item: 'SUP Item 2',
      category: 'قطع غيار',
      quantity: 5,
      unitPrice: 200,
      paymentType: 'كاش',
      paidAmount: 0,
      createdBy: 'test-admin',
    });
    const p = await getPurchase(id);
    expect(parseFloat(p.total)).toBe(1000);
    expect(parseFloat(p.paid_amount)).toBe(0);
    expect(p.payment_status).toBe('pending');
  });

  it('Test 3 — addPurchase with paidAmount < total → partial', async () => {
    const id = await addPurchase({
      date: '2026-04-15',
      supplier: 'SUP Test 3',
      item: 'SUP Item 3',
      category: 'قطع غيار',
      quantity: 10,
      unitPrice: 1000,
      paymentType: 'كاش',
      paidAmount: 5000, // half of 10000
      createdBy: 'test-admin',
    });
    const p = await getPurchase(id);
    expect(parseFloat(p.total)).toBe(10000);
    expect(parseFloat(p.paid_amount)).toBe(5000);
    expect(p.payment_status).toBe('partial');
  });

  it('Test 4 — paySupplier increments paid_amount and updates status', async () => {
    const id = await addPurchase({
      date: '2026-04-15',
      supplier: 'SUP Test 4',
      item: 'SUP Item 4',
      category: 'قطع غيار',
      quantity: 10,
      unitPrice: 1000,
      paidAmount: 3000,
      createdBy: 'test-admin',
    });
    const result = await paySupplier({
      purchaseId: id,
      amount: 2000,
      paymentMethod: 'بنك',
      notes: 'Second installment',
      createdBy: 'test-admin',
    });
    expect(result.newPaidAmount).toBe(5000);
    expect(result.newStatus).toBe('partial');

    const p = await getPurchase(id);
    expect(parseFloat(p.paid_amount)).toBe(5000);
    expect(p.payment_status).toBe('partial');
  });

  it('Test 5 — paySupplier rejects overpayment with Arabic error', async () => {
    const id = await addPurchase({
      date: '2026-04-15',
      supplier: 'SUP Test 5',
      item: 'SUP Item 5',
      category: 'قطع غيار',
      quantity: 5,
      unitPrice: 100,
      paidAmount: 400,
      createdBy: 'test-admin',
    });
    // Total 500, already paid 400 → remaining 100
    await expect(
      paySupplier({ purchaseId: id, amount: 200, paymentMethod: 'كاش', createdBy: 'test-admin' })
    ).rejects.toThrow(/يتجاوز إجمالي الشراء/);
  });

  it('Test 6 — paySupplier moves status to paid when fully paid', async () => {
    const id = await addPurchase({
      date: '2026-04-15',
      supplier: 'SUP Test 6',
      item: 'SUP Item 6',
      category: 'قطع غيار',
      quantity: 1,
      unitPrice: 1000,
      paidAmount: 0,
      createdBy: 'test-admin',
    });
    const r1 = await paySupplier({ purchaseId: id, amount: 400, createdBy: 'test-admin' });
    expect(r1.newStatus).toBe('partial');
    const r2 = await paySupplier({ purchaseId: id, amount: 600, createdBy: 'test-admin' });
    expect(r2.newStatus).toBe('paid');
    expect(r2.newPaidAmount).toBe(1000);

    const p = await getPurchase(id);
    expect(p.payment_status).toBe('paid');

    // Audit trail: initial paidAmount=0 → no seed row, then 2 pay rows
    const payments = await getSupplierPayments(id);
    expect(payments).toHaveLength(2);
    expect(payments[0].amount).toBe(400);
    expect(payments[1].amount).toBe(600);
  });

  it('Test 7 — getPurchases returns paid_amount and payment_status', async () => {
    await addPurchase({
      date: '2026-04-15',
      supplier: 'SUP Test 7',
      item: 'SUP Item 7',
      category: 'قطع غيار',
      quantity: 2,
      unitPrice: 500,
      paidAmount: 300,
      createdBy: 'test-admin',
    });
    const rows = await getPurchases();
    const row = rows.find((r) => r.supplier === 'SUP Test 7');
    expect(row).toBeDefined();
    expect(parseFloat(row.paid_amount)).toBe(300);
    expect(parseFloat(row.total)).toBe(1000);
    expect(row.payment_status).toBe('partial');
  });
});
