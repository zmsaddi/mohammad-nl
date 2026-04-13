// TEST-01: full sale-lifecycle integration test against a real Postgres.
//
// Runs three sequential `it` blocks that share state:
//   1. addSale        → reservation + auto-delivery + client upsert
//   2. updateDelivery → confirmation → invoice + bonuses + sale paid
//   3. voidInvoice    → reversal → stock restored + bonuses deleted
//
// No mocks. Real withTx transactions. Real Neon endpoint pulled from
// Vercel production env into .env.test. The business tables are
// TRUNCATEd before and after so this test does not collide with any
// other data.
//
// Explicit NO-TOUCH: users, settings. Those tables are preserved.
// The beforeAll saves the relevant settings rows, forces them to
// known test values, and afterAll restores whatever was there before.
//
// Run with: npx vitest run tests/sale-lifecycle.test.js

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import bcryptjs from 'bcryptjs';
import {
  initDatabase,
  addSale,
  updateDelivery,
  voidInvoice,
} from '../lib/db.js';

const TRUNCATE_TABLES = [
  'sales', 'purchases', 'deliveries', 'invoices', 'bonuses',
  'settlements', 'payments', 'expenses', 'clients', 'products',
  'suppliers', 'voice_logs', 'ai_corrections', 'entity_aliases',
  'ai_patterns', 'price_history',
];

// Shared state between the three sequential `it` blocks.
const ctx = {
  saleId: null,
  deliveryId: null,
  invoiceId: null,
  savedSettings: {},
};

async function truncateBusinessTables() {
  // Quoted identifiers would be safer against SQL injection, but the
  // table names here are a fixed literal array we control. CASCADE
  // handles any residual foreign-key constraints.
  const list = TRUNCATE_TABLES.map((t) => `"${t}"`).join(', ');
  await sql.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function getSetting(key) {
  const { rows } = await sql`SELECT value FROM settings WHERE key = ${key}`;
  return rows[0]?.value ?? null;
}

async function setSetting(key, value) {
  await sql`
    INSERT INTO settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = ${value}
  `;
}

describe('TEST-01: full sale lifecycle against real DB', () => {
  // BUG-27 / ARC-06: beforeAll does a Neon cold-start + initDatabase which
  // now runs ~30 extra ARC-06 ALTER statements on first call. The default
  // 10s hook timeout is too tight — bumped to 30s to absorb cold starts.
  beforeAll(async () => {
    // Ensure schema is current.
    await initDatabase();

    // Save current bonus settings so we can restore them in afterAll.
    ctx.savedSettings.seller_bonus_fixed      = await getSetting('seller_bonus_fixed');
    ctx.savedSettings.seller_bonus_percentage = await getSetting('seller_bonus_percentage');
    ctx.savedSettings.driver_bonus_fixed      = await getSetting('driver_bonus_fixed');

    // Force the bonus settings to the values the test expects.
    await setSetting('seller_bonus_fixed',      '10');
    await setSetting('seller_bonus_percentage', '50');
    await setSetting('driver_bonus_fixed',      '5');

    // Wipe the business tables. users and settings are NOT in this list.
    await truncateBusinessTables();

    // Seed product.
    await sql`
      INSERT INTO products (name, category, unit, buy_price, sell_price, stock, created_by, notes)
      VALUES ('V20 Test Pro', 'e-bike', '', 1000, 1500, 10, 'test-seed', '')
    `;

    // Seed test users (bcrypt 12 rounds, same as production).
    const hash = bcryptjs.hashSync('test-password', 12);
    await sql`
      INSERT INTO users (username, password, name, role, active)
      VALUES ('test-seller', ${hash}, 'Test Seller', 'seller', true)
      ON CONFLICT (username) DO UPDATE SET
        password = EXCLUDED.password,
        name     = EXCLUDED.name,
        role     = EXCLUDED.role,
        active   = true
    `;
    await sql`
      INSERT INTO users (username, password, name, role, active)
      VALUES ('test-driver', ${hash}, 'Test Driver', 'driver', true)
      ON CONFLICT (username) DO UPDATE SET
        password = EXCLUDED.password,
        name     = EXCLUDED.name,
        role     = EXCLUDED.role,
        active   = true
    `;
  }, 30000); // BUG-27: 30s timeout — default 10s was too tight after ARC-06.

  afterAll(async () => {
    // Wipe the business tables again so the test leaves no residue.
    await truncateBusinessTables();

    // Restore any pre-existing settings values.
    for (const [key, value] of Object.entries(ctx.savedSettings)) {
      if (value !== null) {
        await setSetting(key, value);
      }
    }

    // Remove the test users we created. Other users are untouched.
    await sql`DELETE FROM users WHERE username IN ('test-seller', 'test-driver')`;
  });

  it('Test 1 — addSale reserves stock, creates delivery, upserts client', async () => {
    const today = new Date().toISOString().slice(0, 10);

    const result = await addSale({
      date:        today,
      clientName:  'Test Client',
      item:        'V20 Test Pro',
      quantity:    2,
      unitPrice:   1500,
      paymentType: 'كاش',
      clientPhone: '+212600000001',
      createdBy:   'test-seller',
    });

    expect(result.saleId).toBeGreaterThan(0);
    expect(result.deliveryId).toBeGreaterThan(0);
    expect(result.refCode).toMatch(/^SL-\d{8}-/);

    ctx.saleId     = result.saleId;
    ctx.deliveryId = result.deliveryId;

    // Sales: exactly one row, reserved, quantity 2, total 3000.
    const { rows: sales } = await sql`SELECT * FROM sales`;
    expect(sales).toHaveLength(1);
    expect(sales[0].id).toBe(ctx.saleId);
    expect(sales[0].status).toBe('محجوز');
    expect(parseFloat(sales[0].quantity)).toBe(2);
    expect(parseFloat(sales[0].total)).toBe(3000);
    expect(sales[0].created_by).toBe('test-seller');

    // Products: stock dropped from 10 to 8.
    const { rows: prods } = await sql`SELECT stock FROM products WHERE name = 'V20 Test Pro'`;
    expect(parseFloat(prods[0].stock)).toBe(8);

    // Deliveries: exactly one row, linked, pending.
    const { rows: dels } = await sql`SELECT * FROM deliveries`;
    expect(dels).toHaveLength(1);
    expect(dels[0].id).toBe(ctx.deliveryId);
    expect(dels[0].sale_id).toBe(ctx.saleId);
    expect(dels[0].status).toBe('قيد الانتظار');

    // Clients: exactly one row.
    const { rows: clients } = await sql`SELECT * FROM clients WHERE name = 'Test Client'`;
    expect(clients).toHaveLength(1);
  });

  it('Test 2 — updateDelivery(تم التوصيل) confirms sale, creates invoice + bonuses', async () => {
    // updateDelivery expects a full-shape payload — read the current
    // row and rebuild it with the fields the test wants to change.
    const { rows: existingDel } = await sql`SELECT * FROM deliveries WHERE id = ${ctx.deliveryId}`;
    const existing = existingDel[0];

    // First: we need `assigned_driver` set so the calculateBonusInTx
    // driver path matches the username. The current route-layer PUT
    // sets assignedDriver separately; the db function reads it straight.
    await updateDelivery({
      id:             ctx.deliveryId,
      date:           existing.date,
      clientName:     existing.client_name,
      clientPhone:    existing.client_phone || '',
      address:        existing.address || '',
      items:          existing.items,
      totalAmount:    parseFloat(existing.total_amount) || 0,
      status:         'تم التوصيل',
      driverName:     'Test Driver',
      assignedDriver: 'test-driver',
      notes:          existing.notes || '',
      vin:            'TEST-VIN-001',
    });

    // Sale is now confirmed and paid in full (paymentType كاش).
    const { rows: sale } = await sql`SELECT * FROM sales WHERE id = ${ctx.saleId}`;
    expect(sale[0].status).toBe('مؤكد');
    expect(parseFloat(sale[0].paid_amount)).toBe(3000);
    expect(parseFloat(sale[0].remaining)).toBe(0);
    expect(sale[0].vin).toBe('TEST-VIN-001');

    // Invoice row created.
    const { rows: inv } = await sql`SELECT * FROM invoices WHERE sale_id = ${ctx.saleId}`;
    expect(inv).toHaveLength(1);
    expect(inv[0].ref_code).toMatch(/^INV-\d{6}-\d{3}$/);
    expect(parseFloat(inv[0].total)).toBe(3000);
    expect(inv[0].client_name).toBe('Test Client');
    expect(inv[0].vin).toBe('TEST-VIN-001');
    ctx.invoiceId = inv[0].id;

    // Bonuses: one for test-seller (10), one for test-driver (5),
    // both unsettled. Seller extra_bonus is 0 because unit_price
    // (1500) equals recommended_price (1500) — no overcharge.
    const { rows: bonuses } = await sql`
      SELECT * FROM bonuses WHERE sale_id = ${ctx.saleId} ORDER BY role
    `;
    expect(bonuses).toHaveLength(2);

    const driver = bonuses.find((b) => b.role === 'driver');
    const seller = bonuses.find((b) => b.role === 'seller');
    expect(driver).toBeTruthy();
    expect(seller).toBeTruthy();

    expect(driver.username).toBe('test-driver');
    expect(parseFloat(driver.total_bonus)).toBe(5);
    expect(driver.settled).toBe(false);

    expect(seller.username).toBe('test-seller');
    expect(parseFloat(seller.total_bonus)).toBe(10);
    expect(parseFloat(seller.extra_bonus)).toBe(0);
    expect(seller.settled).toBe(false);
  });

  it('Test 3 — voidInvoice reverses sale, restores stock, deletes unsettled bonuses', async () => {
    // FEAT-05: cancellation now requires explicit bonusActions whenever
    // the sale has non-settled bonuses. This test exercises the "remove
    // both" choice. The bonusActions preserve pre-FEAT-05 behavior
    // (both bonuses deleted on void). Separate tests exist for the
    // BONUS_CHOICE_REQUIRED sentinel and the "keep" disposition in
    // tests/feat05-cancel-sale.test.js.
    await voidInvoice(ctx.invoiceId, {
      cancelledBy: 'test-admin',
      reason: 'Lifecycle test void',
      bonusActions: { seller: 'remove', driver: 'remove' },
    });

    // Invoice voided.
    const { rows: inv } = await sql`SELECT * FROM invoices WHERE id = ${ctx.invoiceId}`;
    expect(inv[0].status).toBe('ملغي');

    // Sale cancelled and zeroed.
    const { rows: sale } = await sql`SELECT * FROM sales WHERE id = ${ctx.saleId}`;
    expect(sale[0].status).toBe('ملغي');
    expect(parseFloat(sale[0].paid_amount)).toBe(0);
    expect(parseFloat(sale[0].remaining)).toBe(0);
    // FEAT-05: cancellation now also writes payment_status='cancelled'.
    expect(sale[0].payment_status).toBe('cancelled');

    // Stock back to 10.
    const { rows: prods } = await sql`SELECT stock FROM products WHERE name = 'V20 Test Pro'`;
    expect(parseFloat(prods[0].stock)).toBe(10);

    // Unsettled bonuses for this sale are gone.
    const { rows: bonuses } = await sql`SELECT * FROM bonuses WHERE sale_id = ${ctx.saleId}`;
    expect(bonuses).toHaveLength(0);

    // FEAT-05: a cancellations audit row was written.
    const { rows: audit } = await sql`
      SELECT * FROM cancellations WHERE sale_id = ${ctx.saleId} ORDER BY id DESC LIMIT 1
    `;
    expect(audit).toHaveLength(1);
    expect(audit[0].cancelled_by).toBe('test-admin');
    expect(audit[0].reason).toBe('Lifecycle test void');
    expect(audit[0].invoice_mode).toBe('soft');
    expect(audit[0].seller_bonus_kept).toBe(false);
    expect(audit[0].driver_bonus_kept).toBe(false);
  });
});
