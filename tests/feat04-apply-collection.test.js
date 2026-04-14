// FEAT-04: applyCollection helper tests.
//
// Exercises the atomic collection path used by POST /api/sales/[id]/collect
// and (via applyCollectionFIFO) POST /api/clients/[id]/collect.
//
// Run with: npx vitest run tests/feat04-apply-collection.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import bcryptjs from 'bcryptjs';
import {
  initDatabase,
  addSale,
  updateDelivery,
  applyCollection,
  applyCollectionFIFO,
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

async function seedConfirmedCreditSale(opts = {}) {
  const today = opts.date || new Date().toISOString().slice(0, 10);
  const dpe = opts.dpe !== undefined ? opts.dpe : 0;
  const total = opts.total || 1500;
  const clientName = opts.clientName || 'F04 Collect Client';

  await sql`
    INSERT INTO products (name, category, unit, buy_price, sell_price, stock, created_by, notes)
    VALUES ('F04 Collect Bike', 'e-bike', '', 1000, ${total}, 20, 'test-seed', '')
    ON CONFLICT (name) DO UPDATE SET stock = 20
  `;
  const hash = bcryptjs.hashSync('test-password', 12);
  await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES ('feat04-coll-seller', ${hash}, 'Coll Seller', 'seller', true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = 'seller'
  `;
  await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES ('feat04-coll-driver', ${hash}, 'Coll Driver', 'driver', true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = 'driver'
  `;

  const { saleId, deliveryId } = await addSale({
    date: today,
    clientName,
    // Phone is required so addClient upserts by (name + phone) instead of
    // throwing "ambiguous client" when the same name reappears across
    // multiple fixtures in the same test (e.g. the FIFO walker case).
    clientPhone: opts.clientPhone || `+31600${String(total).padStart(6, '0')}`,
    // BUG-6 hotfix 2026-04-14: addSale requires an address when creating
    // a new client. Test fixtures predate this rule — add a placeholder.
    clientAddress: opts.clientAddress || 'Test Address',
    item: 'F04 Collect Bike',
    quantity: 1,
    unitPrice: total,
    paymentType: 'آجل',
    downPaymentExpected: dpe,
    createdBy: 'feat04-coll-seller',
  });
  await sql`UPDATE deliveries SET assigned_driver = 'feat04-coll-driver' WHERE id = ${deliveryId}`;

  await updateDelivery({
    id: deliveryId,
    date: today,
    clientName,
    clientPhone: '',
    address: '',
    items: 'F04 Collect Bike (1)',
    totalAmount: total,
    status: 'تم التوصيل',
    driverName: 'feat04-coll-driver',
    assignedDriver: 'feat04-coll-driver',
    notes: '',
    vin: `VIN-F04-COLL-${saleId}`,
  });

  return { saleId, deliveryId };
}

describe('FEAT-04: applyCollection', () => {
  beforeAll(async () => {
    await initDatabase();
  }, 30000);

  beforeEach(async () => {
    await truncateBusinessTables();
  });

  afterAll(async () => {
    await truncateBusinessTables();
    await sql`DELETE FROM users WHERE username IN ('feat04-coll-seller', 'feat04-coll-driver')`;
  });

  it('happy path: records payment + updates sale aggregates + TVA correct', async () => {
    const { saleId } = await seedConfirmedCreditSale({ total: 1500, dpe: 0 });
    const result = await applyCollection(saleId, 600, 'كاش', 'test-admin');

    expect(result.newPaidAmount).toBe(600);
    expect(result.newRemaining).toBe(900);
    expect(result.newStatus).toBe('partial');
    expect(result.tva).toBeCloseTo(100, 2); // 600/6

    const { rows: sale } = await sql`SELECT * FROM sales WHERE id = ${saleId}`;
    expect(parseFloat(sale[0].paid_amount)).toBe(600);
    expect(parseFloat(sale[0].remaining)).toBe(900);
    expect(sale[0].payment_status).toBe('partial');

    const { rows: payments } = await sql`SELECT * FROM payments WHERE sale_id = ${saleId} AND type = 'collection'`;
    expect(payments).toHaveLength(1);
    expect(parseFloat(payments[0].amount)).toBe(600);
    expect(payments[0].payment_method).toBe('كاش');
  });

  it('final payment transitions sale to paid', async () => {
    const { saleId } = await seedConfirmedCreditSale({ total: 1000, dpe: 0 });
    await applyCollection(saleId, 400, 'كاش', 'test-admin');
    const result = await applyCollection(saleId, 600, 'بنك', 'test-admin');

    expect(result.newStatus).toBe('paid');
    expect(result.newPaidAmount).toBe(1000);
    expect(result.newRemaining).toBe(0);

    const { rows: sale } = await sql`SELECT * FROM sales WHERE id = ${saleId}`;
    expect(sale[0].payment_status).toBe('paid');

    const { rows: payments } = await sql`SELECT COUNT(*)::int AS c FROM payments WHERE sale_id = ${saleId} AND type = 'collection'`;
    expect(payments[0].c).toBe(2);
  });

  it('rejects overpayment', async () => {
    const { saleId } = await seedConfirmedCreditSale({ total: 1000, dpe: 0 });
    await expect(
      applyCollection(saleId, 1500, 'كاش', 'test-admin')
    ).rejects.toThrow(/أكبر من المتبقي/);
  });

  it('rejects collection on a sale that is already paid', async () => {
    const { saleId } = await seedConfirmedCreditSale({ total: 1000, dpe: 0 });
    await applyCollection(saleId, 1000, 'كاش', 'test-admin');
    await expect(
      applyCollection(saleId, 100, 'كاش', 'test-admin')
    ).rejects.toThrow(/مدفوع بالكامل/);
  });

  it('rejects collection on a non-confirmed sale', async () => {
    await sql`
      INSERT INTO products (name, category, unit, buy_price, sell_price, stock, created_by, notes)
      VALUES ('F04 NoConfirm Bike', 'e-bike', '', 500, 800, 10, 'test-seed', '')
      ON CONFLICT (name) DO UPDATE SET stock = 10
    `;
    const today = new Date().toISOString().slice(0, 10);
    const { saleId } = await addSale({
      date: today,
      clientName: 'F04 No-Confirm Client',
      clientAddress: 'Test Address',
      item: 'F04 NoConfirm Bike',
      quantity: 1,
      unitPrice: 800,
      paymentType: 'آجل',
      createdBy: 'feat04-coll-seller',
    });
    // Sale is still 'محجوز' (not delivered yet)
    await expect(
      applyCollection(saleId, 100, 'كاش', 'test-admin')
    ).rejects.toThrow(/قبل تأكيد/);
  });

  it('rejects non-positive amounts', async () => {
    const { saleId } = await seedConfirmedCreditSale({ total: 1000, dpe: 0 });
    await expect(
      applyCollection(saleId, 0, 'كاش', 'test-admin')
    ).rejects.toThrow(/أكبر من صفر/);
    await expect(
      applyCollection(saleId, -50, 'كاش', 'test-admin')
    ).rejects.toThrow(/أكبر من صفر/);
  });
});

describe('FEAT-04: applyCollectionFIFO walker', () => {
  beforeAll(async () => {
    await initDatabase();
  }, 30000);

  beforeEach(async () => {
    await truncateBusinessTables();
  });

  afterAll(async () => {
    await truncateBusinessTables();
    await sql`DELETE FROM users WHERE username IN ('feat04-coll-seller', 'feat04-coll-driver')`;
  });

  it('walks multiple open sales oldest-first and returns per-sale breakdown', async () => {
    // Same clientPhone on both → addClient upserts to a single client row,
    // so the second addSale call doesn't throw "ambiguous client"
    const older = await seedConfirmedCreditSale({
      total: 500,
      dpe: 0,
      date: '2026-01-01',
      clientName: 'FIFO Client',
      clientPhone: '+31699999001',
    });
    const newer = await seedConfirmedCreditSale({
      total: 800,
      dpe: 0,
      date: '2026-02-01',
      clientName: 'FIFO Client',
      clientPhone: '+31699999001',
    });

    // Pay 700 across both — should fully pay older (500) and partially newer (200)
    const result = await applyCollectionFIFO('FIFO Client', 700, 'كاش', 'test-admin');
    expect(result.applied).toHaveLength(2);
    expect(result.applied[0].saleId).toBe(older.saleId);
    expect(result.applied[0].amount).toBe(500);
    expect(result.applied[0].newStatus).toBe('paid');
    expect(result.applied[1].saleId).toBe(newer.saleId);
    expect(result.applied[1].amount).toBe(200);
    expect(result.applied[1].newStatus).toBe('partial');
    expect(result.totalApplied).toBe(700);
  });

  it('rejects FIFO amount larger than total open debt', async () => {
    await seedConfirmedCreditSale({ total: 500, dpe: 0, clientName: 'FIFO Over' });
    await expect(
      applyCollectionFIFO('FIFO Over', 1000, 'كاش', 'test-admin')
    ).rejects.toThrow(/أكبر من إجمالي/);
  });
});
