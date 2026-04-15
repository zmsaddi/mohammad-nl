// v1.0.2 Feature 3 — supplier performance with total/paid/remaining
//
// Verifies getSummaryData's topSuppliers aggregate now includes
// totalPaid + totalRemaining from the v1.0.1 purchases columns.
//
// Run with: npx vitest run tests/supplier-performance.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import {
  initDatabase,
  addPurchase,
  paySupplier,
  getSummaryData,
} from '../lib/db.js';

const TRUNCATE_TABLES = [
  'profit_distributions',
  'cancellations', 'settlements', 'bonuses', 'payments',
  'invoices', 'deliveries', 'sales', 'purchases',
  'supplier_payments', 'expenses', 'clients', 'products',
  'suppliers',
];

async function truncateBusinessTables() {
  const list = TRUNCATE_TABLES.map((t) => `"${t}"`).join(', ');
  await sql.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

describe('Feature 3 — topSuppliers total/paid/remaining', () => {
  beforeAll(async () => { await initDatabase(); }, 30000);
  beforeEach(async () => { await truncateBusinessTables(); });
  afterAll(async () => { await truncateBusinessTables(); });

  // ──────────────────────────────────────────────────────────────
  it('Test 1 — single supplier, fully paid → remaining = 0', async () => {
    await addPurchase({
      date: '2026-04-15',
      supplier: 'Supplier A',
      item: 'Item A',
      category: 'قطع غيار',
      quantity: 10,
      unitPrice: 100,
      createdBy: 'admin',
    });
    const data = await getSummaryData();
    const supplier = data.topSuppliers.find((s) => s.name === 'Supplier A');
    expect(supplier).toBeDefined();
    expect(supplier.totalSpent).toBe(1000);
    expect(supplier.totalPaid).toBe(1000);
    expect(supplier.totalRemaining).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────
  it('Test 2 — partial payment → totalRemaining = total - paid', async () => {
    await addPurchase({
      date: '2026-04-15',
      supplier: 'Supplier B',
      item: 'Item B',
      category: 'قطع غيار',
      quantity: 10,
      unitPrice: 1000,
      paidAmount: 3000,
      createdBy: 'admin',
    });
    const data = await getSummaryData();
    const supplier = data.topSuppliers.find((s) => s.name === 'Supplier B');
    expect(supplier).toBeDefined();
    expect(supplier.totalSpent).toBe(10000);
    expect(supplier.totalPaid).toBe(3000);
    expect(supplier.totalRemaining).toBe(7000);
  });

  // ──────────────────────────────────────────────────────────────
  it('Test 3 — aggregates across multiple purchases per supplier', async () => {
    // Two purchases from the same supplier, one paid, one partial
    const purchaseId1 = await addPurchase({
      date: '2026-04-10',
      supplier: 'Supplier C',
      item: 'Item C1',
      category: 'قطع غيار',
      quantity: 5,
      unitPrice: 200,  // total 1000, fully paid
      createdBy: 'admin',
    });
    const purchaseId2 = await addPurchase({
      date: '2026-04-12',
      supplier: 'Supplier C',
      item: 'Item C2',
      category: 'قطع غيار',
      quantity: 10,
      unitPrice: 500,  // total 5000
      paidAmount: 2000, // remaining 3000
      createdBy: 'admin',
    });
    // Subsequent supplier payment on purchase 2
    await paySupplier({
      purchaseId: purchaseId2,
      amount: 1000,
      paymentMethod: 'بنك',
      createdBy: 'admin',
    });
    // Now: purchase1 paid 1000/1000, purchase2 paid 3000/5000
    // Totals: spent=6000, paid=4000, remaining=2000

    const data = await getSummaryData();
    const supplier = data.topSuppliers.find((s) => s.name === 'Supplier C');
    expect(supplier).toBeDefined();
    expect(supplier.orders).toBe(2);
    expect(supplier.totalSpent).toBe(6000);
    expect(supplier.totalPaid).toBe(4000);
    expect(supplier.totalRemaining).toBe(2000);
  });

  // ──────────────────────────────────────────────────────────────
  it('Test 4 — orders by totalSpent DESC', async () => {
    // Small supplier
    await addPurchase({
      date: '2026-04-15', supplier: 'Small Supplier',
      item: 'Item S', category: 'قطع غيار',
      quantity: 1, unitPrice: 100, createdBy: 'admin',
    });
    // Big supplier
    await addPurchase({
      date: '2026-04-15', supplier: 'Big Supplier',
      item: 'Item B', category: 'قطع غيار',
      quantity: 100, unitPrice: 100, createdBy: 'admin',
    });
    // Medium supplier
    await addPurchase({
      date: '2026-04-15', supplier: 'Medium Supplier',
      item: 'Item M', category: 'قطع غيار',
      quantity: 10, unitPrice: 100, createdBy: 'admin',
    });

    const data = await getSummaryData();
    const names = data.topSuppliers.map((s) => s.name);
    expect(names.indexOf('Big Supplier')).toBeLessThan(names.indexOf('Medium Supplier'));
    expect(names.indexOf('Medium Supplier')).toBeLessThan(names.indexOf('Small Supplier'));
  });

  // ──────────────────────────────────────────────────────────────
  it('Test 5 — pending purchase (paidAmount=0) → full total is remaining', async () => {
    await addPurchase({
      date: '2026-04-15',
      supplier: 'Pending Supplier',
      item: 'Item P',
      category: 'قطع غيار',
      quantity: 5,
      unitPrice: 500,
      paidAmount: 0,   // nothing paid yet
      createdBy: 'admin',
    });
    const data = await getSummaryData();
    const supplier = data.topSuppliers.find((s) => s.name === 'Pending Supplier');
    expect(supplier).toBeDefined();
    expect(supplier.totalSpent).toBe(2500);
    expect(supplier.totalPaid).toBe(0);
    expect(supplier.totalRemaining).toBe(2500);
  });
});
