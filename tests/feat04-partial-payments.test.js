// FEAT-04: addSale downPaymentExpected + updateDelivery(confirm) payment row tests.
//
// Real DB integration tests against the Neon test branch. Each test
// truncates business tables at setup and seeds its own fixture data.
//
// Run with: npx vitest run tests/feat04-partial-payments.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import bcryptjs from 'bcryptjs';
import {
  initDatabase,
  addSale,
  updateDelivery,
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

async function seedProduct() {
  await sql`
    INSERT INTO products (name, category, unit, buy_price, sell_price, stock, created_by, notes)
    VALUES ('FEAT04 Bike', 'e-bike', '', 1000, 1500, 20, 'test-seed', '')
  `;
  const hash = bcryptjs.hashSync('test-password', 12);
  await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES ('feat04-seller', ${hash}, 'FEAT04 Seller', 'seller', true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = 'seller'
  `;
  await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES ('feat04-driver', ${hash}, 'FEAT04 Driver', 'driver', true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = 'driver'
  `;
}

describe('FEAT-04: addSale downPaymentExpected', () => {
  beforeAll(async () => {
    await initDatabase();
  }, 30000);

  beforeEach(async () => {
    await truncateBusinessTables();
    await seedProduct();
  });

  afterAll(async () => {
    await truncateBusinessTables();
    await sql`DELETE FROM users WHERE username IN ('feat04-seller', 'feat04-driver')`;
  });

  it('stores explicit downPaymentExpected on insert', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { saleId } = await addSale({
      date: today,
      clientName: 'F04 Client A',
      item: 'FEAT04 Bike',
      quantity: 1,
      unitPrice: 1500,
      paymentType: 'آجل',
      downPaymentExpected: 500,
      createdBy: 'feat04-seller',
    });
    const { rows } = await sql`SELECT down_payment_expected FROM sales WHERE id = ${saleId}`;
    expect(parseFloat(rows[0].down_payment_expected)).toBe(500);
  });

  it('defaults to full total when paymentType=كاش and no override', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { saleId } = await addSale({
      date: today,
      clientName: 'F04 Client B',
      item: 'FEAT04 Bike',
      quantity: 2,
      unitPrice: 1500,
      paymentType: 'كاش',
      createdBy: 'feat04-seller',
    });
    const { rows } = await sql`SELECT total, down_payment_expected FROM sales WHERE id = ${saleId}`;
    expect(parseFloat(rows[0].down_payment_expected)).toBe(parseFloat(rows[0].total));
    expect(parseFloat(rows[0].down_payment_expected)).toBe(3000);
  });

  it('defaults to 0 when paymentType=آجل and no override', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { saleId } = await addSale({
      date: today,
      clientName: 'F04 Client C',
      item: 'FEAT04 Bike',
      quantity: 1,
      unitPrice: 1500,
      paymentType: 'آجل',
      createdBy: 'feat04-seller',
    });
    const { rows } = await sql`SELECT down_payment_expected FROM sales WHERE id = ${saleId}`;
    expect(parseFloat(rows[0].down_payment_expected)).toBe(0);
  });

  it('rejects downPaymentExpected > total', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await expect(
      addSale({
        date: today,
        clientName: 'F04 Client D',
        item: 'FEAT04 Bike',
        quantity: 1,
        unitPrice: 1500,
        paymentType: 'آجل',
        downPaymentExpected: 2000,
        createdBy: 'feat04-seller',
      })
    ).rejects.toThrow(/الدفعة المقدمة|الإجمالي/);
  });
});

describe('FEAT-04: updateDelivery(confirm) writes payment row', () => {
  beforeAll(async () => {
    await initDatabase();
  }, 30000);

  beforeEach(async () => {
    await truncateBusinessTables();
    await seedProduct();
  });

  afterAll(async () => {
    await truncateBusinessTables();
    await sql`DELETE FROM users WHERE username IN ('feat04-seller', 'feat04-driver')`;
  });

  it('full cash sale → payment row + payment_status=paid', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { saleId, deliveryId } = await addSale({
      date: today,
      clientName: 'F04 Cash Client',
      item: 'FEAT04 Bike',
      quantity: 1,
      unitPrice: 1500,
      paymentType: 'كاش',
      createdBy: 'feat04-seller',
    });
    await sql`UPDATE deliveries SET assigned_driver = 'feat04-driver' WHERE id = ${deliveryId}`;

    await updateDelivery({
      id: deliveryId,
      date: today,
      clientName: 'F04 Cash Client',
      clientPhone: '',
      address: '',
      items: 'FEAT04 Bike (1)',
      totalAmount: 1500,
      status: 'تم التوصيل',
      driverName: 'feat04-driver',
      assignedDriver: 'feat04-driver',
      notes: '',
      vin: 'VIN-F04-CASH',
    });

    const { rows: sale } = await sql`SELECT * FROM sales WHERE id = ${saleId}`;
    expect(sale[0].payment_status).toBe('paid');
    expect(parseFloat(sale[0].paid_amount)).toBe(1500);
    expect(parseFloat(sale[0].remaining)).toBe(0);

    const { rows: payments } = await sql`SELECT * FROM payments WHERE sale_id = ${saleId} AND type = 'collection'`;
    expect(payments).toHaveLength(1);
    expect(parseFloat(payments[0].amount)).toBe(1500);
    expect(payments[0].payment_method).toBe('كاش');
    // TVA = amount / 6 → 1500/6 = 250
    expect(parseFloat(payments[0].tva_amount)).toBeCloseTo(250, 2);
  });

  it('credit sale with partial down payment → payment row + payment_status=partial', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { saleId, deliveryId } = await addSale({
      date: today,
      clientName: 'F04 Partial Client',
      item: 'FEAT04 Bike',
      quantity: 1,
      unitPrice: 1500,
      paymentType: 'آجل',
      downPaymentExpected: 600,
      createdBy: 'feat04-seller',
    });
    await sql`UPDATE deliveries SET assigned_driver = 'feat04-driver' WHERE id = ${deliveryId}`;

    await updateDelivery({
      id: deliveryId,
      date: today,
      clientName: 'F04 Partial Client',
      clientPhone: '',
      address: '',
      items: 'FEAT04 Bike (1)',
      totalAmount: 1500,
      status: 'تم التوصيل',
      driverName: 'feat04-driver',
      assignedDriver: 'feat04-driver',
      notes: '',
      vin: 'VIN-F04-PARTIAL',
    });

    const { rows: sale } = await sql`SELECT * FROM sales WHERE id = ${saleId}`;
    expect(sale[0].payment_status).toBe('partial');
    expect(parseFloat(sale[0].paid_amount)).toBe(600);
    expect(parseFloat(sale[0].remaining)).toBe(900);

    const { rows: payments } = await sql`SELECT * FROM payments WHERE sale_id = ${saleId} AND type = 'collection'`;
    expect(payments).toHaveLength(1);
    expect(parseFloat(payments[0].amount)).toBe(600);
    expect(parseFloat(payments[0].tva_amount)).toBeCloseTo(100, 2); // 600/6
  });

  it('pure credit sale with dpe=0 → NO payment row + payment_status=partial', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { saleId, deliveryId } = await addSale({
      date: today,
      clientName: 'F04 Pure Credit',
      item: 'FEAT04 Bike',
      quantity: 1,
      unitPrice: 1500,
      paymentType: 'آجل',
      createdBy: 'feat04-seller',
    });
    await sql`UPDATE deliveries SET assigned_driver = 'feat04-driver' WHERE id = ${deliveryId}`;

    await updateDelivery({
      id: deliveryId,
      date: today,
      clientName: 'F04 Pure Credit',
      clientPhone: '',
      address: '',
      items: 'FEAT04 Bike (1)',
      totalAmount: 1500,
      status: 'تم التوصيل',
      driverName: 'feat04-driver',
      assignedDriver: 'feat04-driver',
      notes: '',
      vin: 'VIN-F04-CREDIT',
    });

    const { rows: sale } = await sql`SELECT * FROM sales WHERE id = ${saleId}`;
    expect(sale[0].payment_status).toBe('partial');
    expect(parseFloat(sale[0].paid_amount)).toBe(0);
    expect(parseFloat(sale[0].remaining)).toBe(1500);

    const { rows: payments } = await sql`SELECT * FROM payments WHERE sale_id = ${saleId} AND type = 'collection'`;
    expect(payments).toHaveLength(0);
  });
});
