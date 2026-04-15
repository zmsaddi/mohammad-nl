// v1.0.1 Feature 2 — getSettlementDetails drill-down
//
// Verifies the settlement → bonus → sale → invoice join pipeline
// used by the admin drill-down modal.
//
// Run with: npx vitest run tests/settlement-details.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import bcryptjs from 'bcryptjs';
import {
  initDatabase,
  addSale,
  updateDelivery,
  addSettlement,
  getSettlementDetails,
} from '../lib/db.js';

const TRUNCATE_TABLES = [
  'cancellations', 'settlements', 'bonuses', 'payments',
  'invoices', 'deliveries', 'sales', 'purchases',
  'supplier_payments', 'expenses', 'clients', 'products',
  'suppliers', 'voice_logs', 'ai_corrections', 'entity_aliases',
  'ai_patterns', 'price_history',
];

async function truncateBusinessTables() {
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

async function seedProductAndUsers() {
  await sql`
    INSERT INTO products (name, category, unit, buy_price, sell_price, stock, created_by, notes)
    VALUES ('DETAIL Bike', 'e-bike', '', 1000, 1500, 50, 'test-seed', '')
  `;
  const hash = bcryptjs.hashSync('test-password', 12);
  await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES ('detail-seller', ${hash}, 'Detail Seller', 'seller', true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = 'seller'
  `;
  await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES ('detail-driver', ${hash}, 'Detail Driver', 'driver', true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = 'driver'
  `;
}

async function seedConfirmedSale() {
  const today = new Date().toISOString().slice(0, 10);
  const { saleId, deliveryId } = await addSale({
    date: today,
    clientName: 'Detail Client',
    clientPhone: '+31600009999',
    clientAddress: 'Detail Test Addr',
    item: 'DETAIL Bike',
    quantity: 1,
    unitPrice: 1500,
    paymentType: 'كاش',
    createdBy: 'detail-seller',
  });
  await sql`UPDATE deliveries SET assigned_driver = 'detail-driver' WHERE id = ${deliveryId}`;
  await updateDelivery({
    id: deliveryId,
    date: today,
    clientName: 'Detail Client',
    clientPhone: '+31600009999',
    address: 'Detail Test Addr',
    items: 'DETAIL Bike (1)',
    totalAmount: 1500,
    status: 'تم التوصيل',
    driverName: 'detail-driver',
    assignedDriver: 'detail-driver',
    notes: '',
    vin: 'VIN-DETAIL',
  });
  return saleId;
}

describe('Feature 2 — getSettlementDetails drill-down', () => {
  const savedSettings = {};

  beforeAll(async () => {
    await initDatabase();
    savedSettings.seller_bonus_fixed = await getSetting('seller_bonus_fixed');
    savedSettings.seller_bonus_percentage = await getSetting('seller_bonus_percentage');
    savedSettings.driver_bonus_fixed = await getSetting('driver_bonus_fixed');
    await setSetting('seller_bonus_fixed', '10');
    await setSetting('seller_bonus_percentage', '50');
    await setSetting('driver_bonus_fixed', '5');
  }, 30000);

  beforeEach(async () => {
    await truncateBusinessTables();
  });

  afterAll(async () => {
    await truncateBusinessTables();
    for (const [key, value] of Object.entries(savedSettings)) {
      if (value !== null) await setSetting(key, value);
    }
    await sql`DELETE FROM users WHERE username IN ('detail-seller', 'detail-driver')`;
  });

  it('Test 1 — returns linked sales for seller_payout', async () => {
    await seedProductAndUsers();
    const saleId = await seedConfirmedSale();

    // Confirm a seller bonus was generated
    const { rows: bonusRows } = await sql`
      SELECT id, total_bonus FROM bonuses WHERE username = 'detail-seller' AND role = 'seller'
    `;
    expect(bonusRows).toHaveLength(1);

    // Settle the seller bonus — 10€ fixed for one sale at recommended price
    const settlementId = await addSettlement({
      date: '2026-04-15',
      type: 'seller_payout',
      username: 'detail-seller',
      description: 'Seller payout',
      amount: 10,
      settledBy: 'admin',
    });

    const details = await getSettlementDetails(settlementId);
    expect(details).toBeTruthy();
    expect(details.type).toBe('seller_payout');
    expect(details.username).toBe('detail-seller');
    expect(details.amount).toBe(10);
    expect(details.linked_items).toHaveLength(1);

    const item = details.linked_items[0];
    expect(item.sale_id).toBe(saleId);
    expect(item.client_name).toBe('Detail Client');
    expect(item.sale_item).toBe('DETAIL Bike');
    expect(item.sale_total).toBe(1500);
    expect(item.role).toBe('seller');
    expect(item.total_bonus).toBe(10);
    // Invoice was created by updateDelivery → ref_code should be populated
    expect(item.invoice_ref_code).toBeTruthy();
    expect(details.linked_total).toBe(10);
  });

  it('Test 2 — returns linked deliveries for driver_payout', async () => {
    await seedProductAndUsers();
    await seedConfirmedSale();

    const settlementId = await addSettlement({
      date: '2026-04-15',
      type: 'driver_payout',
      username: 'detail-driver',
      description: 'Driver payout',
      amount: 5,
      settledBy: 'admin',
    });

    const details = await getSettlementDetails(settlementId);
    expect(details).toBeTruthy();
    expect(details.type).toBe('driver_payout');
    expect(details.linked_items).toHaveLength(1);
    expect(details.linked_items[0].role).toBe('driver');
    expect(details.linked_items[0].total_bonus).toBe(5);
    expect(details.linked_total).toBe(5);
  });

  // v1.1 S1.8 [F-005] — profit_distribution was removed from the
  // settlements write path (addSettlement now throws). Legacy rows of
  // that type still exist in production DBs from v1.0.x — the READ path
  // (getSettlementDetails) must still return them correctly so the
  // history table keeps rendering. This test seeds a legacy-style row
  // via raw INSERT (bypassing addSettlement) and verifies the read path.
  it('Test 3 — getSettlementDetails reads legacy profit_distribution rows (no linked_items)', async () => {
    const hash = bcryptjs.hashSync('test-password', 12);
    await sql`
      INSERT INTO users (username, password, name, role, active)
      VALUES ('detail-admin', ${hash}, 'Detail Admin', 'admin', true)
      ON CONFLICT (username) DO UPDATE SET active = true, role = 'admin'
    `;
    // Legacy row — direct INSERT, not via addSettlement (which now rejects)
    const { rows } = await sql`
      INSERT INTO settlements (date, type, username, description, amount, settled_by, notes)
      VALUES ('2026-04-15', 'profit_distribution', 'detail-admin', 'Legacy profit share Q2', 500, 'admin', '')
      RETURNING id
    `;
    const settlementId = rows[0].id;
    const details = await getSettlementDetails(settlementId);
    expect(details).toBeTruthy();
    expect(details.type).toBe('profit_distribution');
    expect(details.linked_items).toEqual([]);
    expect(details.linked_total).toBe(0);
    await sql`DELETE FROM settlements WHERE id = ${settlementId}`;
    await sql`DELETE FROM users WHERE username = 'detail-admin'`;
  });

  // v1.1 S1.8 [F-005] — the write path is now blocked.
  it('Test 3b — addSettlement rejects type=profit_distribution (F-005 write-path guard)', async () => {
    await expect(
      addSettlement({
        date: '2026-04-15',
        type: 'profit_distribution',
        username: 'admin',
        description: 'Profit share Q2',
        amount: 500,
        settledBy: 'admin',
      })
    ).rejects.toThrow(/profit_distribution.*لم يعد مقبولاً/);
  });

  it('Test 4 — returns null for non-existent settlement', async () => {
    const details = await getSettlementDetails(999999);
    expect(details).toBeNull();
  });
});
