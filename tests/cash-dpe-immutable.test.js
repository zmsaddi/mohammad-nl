// v1.0.3 Bug A — cash/bank sales must collect the full total at delivery
//
// Pre-v1.0.3 the addSale validation was symmetric `[0, total]` — a seller
// could submit a كاش sale with dpe < total, the form would let them, the
// schema would let them, the row would persist with dpe < total, the
// driver dialog would later display the partial amount, and the company
// would silently lose the difference. Live evidence from production:
// sales.id=1 had payment_type='كاش', total=950, down_payment_expected=500.
//
// v1.0.3 closes this with a hard guard at the addSale layer, mirrored
// in the SaleSchema Zod refine, and disabled by default in the UI.
//
// Run with: npx vitest run tests/cash-dpe-immutable.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import { initDatabase, addSale } from '../lib/db.js';

const TRUNCATE_TABLES = [
  'profit_distribution_groups', 'profit_distributions',
  'cancellations', 'settlements', 'bonuses', 'payments',
  'invoices', 'deliveries', 'sales', 'purchases',
  'supplier_payments', 'expenses', 'clients', 'products',
  'suppliers',
];

async function truncateBusinessTables() {
  const list = TRUNCATE_TABLES.map((t) => `"${t}"`).join(', ');
  await sql.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function seedProduct() {
  await sql`
    INSERT INTO products (name, category, unit, buy_price, sell_price, stock, created_by, notes)
    VALUES ('CASH-DPE Bike', 'e-bike', '', 50, 100, 50, 'test-seed', '')
  `;
}

const baseSaleArgs = {
  date: new Date().toISOString().slice(0, 10),
  clientName: 'TESTBUG_cash_dpe',
  clientPhone: '+31600000099',
  clientAddress: 'Test Addr',
  item: 'CASH-DPE Bike',
  quantity: 1,
  unitPrice: 100,
  createdBy: 'admin',
};

describe('Bug A — cash/bank sales require dpe = total', () => {
  beforeAll(async () => { await initDatabase(); }, 30000);
  beforeEach(async () => {
    await truncateBusinessTables();
    await seedProduct();
  });
  afterAll(async () => { await truncateBusinessTables(); });

  it('Test 1 — cash sale with dpe = total succeeds', async () => {
    const result = await addSale({
      ...baseSaleArgs,
      paymentType: 'كاش',
      downPaymentExpected: 100,
    });
    expect(result.saleId).toBeGreaterThan(0);

    const { rows } = await sql`SELECT total, down_payment_expected, payment_type FROM sales WHERE id = ${result.saleId}`;
    expect(parseFloat(rows[0].total)).toBe(100);
    expect(parseFloat(rows[0].down_payment_expected)).toBe(100);
    expect(rows[0].payment_type).toBe('كاش');
  });

  it('Test 2 — cash sale with dpe < total throws Arabic error', async () => {
    await expect(
      addSale({
        ...baseSaleArgs,
        paymentType: 'كاش',
        downPaymentExpected: 50,
      })
    ).rejects.toThrow(/البيع النقدي\/البنكي يتطلب دفع المبلغ بالكامل/);

    // Confirm the sale row was NOT persisted on rollback
    const { rows } = await sql`SELECT id FROM sales WHERE client_name = 'TESTBUG_cash_dpe'`;
    expect(rows).toHaveLength(0);
  });

  it('Test 3 — bank sale with dpe < total throws Arabic error', async () => {
    await expect(
      addSale({
        ...baseSaleArgs,
        paymentType: 'بنك',
        downPaymentExpected: 30,
      })
    ).rejects.toThrow(/البيع النقدي\/البنكي يتطلب دفع المبلغ بالكامل/);
  });

  it('Test 4 — credit sale (آجل) with dpe < total succeeds (legitimate)', async () => {
    const result = await addSale({
      ...baseSaleArgs,
      paymentType: 'آجل',
      downPaymentExpected: 30,
    });
    expect(result.saleId).toBeGreaterThan(0);
    const { rows } = await sql`SELECT total, down_payment_expected, payment_type FROM sales WHERE id = ${result.saleId}`;
    expect(parseFloat(rows[0].total)).toBe(100);
    expect(parseFloat(rows[0].down_payment_expected)).toBe(30);
    expect(rows[0].payment_type).toBe('آجل');
  });

  it('Test 5 — credit sale (آجل) with dpe = 0 succeeds (pure credit)', async () => {
    const result = await addSale({
      ...baseSaleArgs,
      paymentType: 'آجل',
      downPaymentExpected: 0,
    });
    expect(result.saleId).toBeGreaterThan(0);
    const { rows } = await sql`SELECT down_payment_expected FROM sales WHERE id = ${result.saleId}`;
    expect(parseFloat(rows[0].down_payment_expected)).toBe(0);
  });

  it('Test 6 — cash sale with dpe omitted defaults to total (backward compat)', async () => {
    const result = await addSale({
      ...baseSaleArgs,
      paymentType: 'كاش',
      // downPaymentExpected omitted entirely
    });
    expect(result.saleId).toBeGreaterThan(0);
    const { rows } = await sql`SELECT down_payment_expected FROM sales WHERE id = ${result.saleId}`;
    expect(parseFloat(rows[0].down_payment_expected)).toBe(100);
  });
});
