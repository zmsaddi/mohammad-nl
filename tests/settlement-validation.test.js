// v1.0.1 Feature 1 — addSettlement financial validation
//
// Guards against over-paying a user's unsettled bonus balance. The
// check runs inside the same transaction that FIFO-walks bonuses,
// so a concurrent double-payout race is blocked by FOR UPDATE row
// locks on the bonuses rows.
//
// Run with: npx vitest run tests/settlement-validation.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import bcryptjs from 'bcryptjs';
import {
  initDatabase,
  addSettlement,
  getAvailableCredit,
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

async function seedSellerWithBonus({ username, role = 'seller', total }) {
  const hash = bcryptjs.hashSync('test-password', 12);
  await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES (${username}, ${hash}, ${'User ' + username}, ${role}, true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = ${role}
  `;
  // bonuses.delivery_id has a FK to deliveries.id with ON DELETE CASCADE
  // (see lib/db.js:289). Seed a minimal placeholder delivery row first
  // and use its id on the bonus insert. Per-bonus delivery so we don't
  // collide with the bonuses_delivery_role_unique index.
  const today = new Date().toISOString().slice(0, 10);
  const { rows: delRows } = await sql`
    INSERT INTO deliveries (date, client_name, address, items, total_amount, status, assigned_driver, notes)
    VALUES (${today}, 'val-fixture-client', 'addr', 'fixture', 0, 'قيد الانتظار', '', '')
    RETURNING id
  `;
  const deliveryId = delRows[0].id;
  await sql`
    INSERT INTO bonuses (date, username, role, sale_id, delivery_id, item, quantity, recommended_price, actual_price, fixed_bonus, extra_bonus, total_bonus, settled)
    VALUES (${today}, ${username}, ${role},
            NULL, ${deliveryId}, 'TEST Item', 1, 0, 0, 0, 0, ${total}, false)
  `;
}

describe('Feature 1 — settlement amount validation', () => {
  beforeAll(async () => { await initDatabase(); }, 30000);
  beforeEach(async () => { await truncateBusinessTables(); });
  afterAll(async () => {
    await truncateBusinessTables();
    await sql`DELETE FROM users WHERE username LIKE 'val-%'`;
  });

  it('Test 1 — bonus settlement within available credit succeeds', async () => {
    await seedSellerWithBonus({ username: 'val-seller1', total: 100 });
    const before = await getAvailableCredit('val-seller1', 'seller_payout');
    expect(before).toBe(100);

    const id = await addSettlement({
      date: '2026-04-15',
      type: 'seller_payout',
      username: 'val-seller1',
      description: 'Test settlement within credit',
      amount: 50,
      settledBy: 'admin',
    });
    expect(typeof id).toBe('number');

    // After 50 payout on a 100 bonus, the bonus row remains unsettled
    // (partial coverage leaves it for the next payout), so available
    // credit is still 100. This is existing FIFO walker behavior.
    const after = await getAvailableCredit('val-seller1', 'seller_payout');
    expect(after).toBe(100);
  });

  it('Test 2 — bonus settlement exceeding available credit throws Arabic error', async () => {
    await seedSellerWithBonus({ username: 'val-seller2', total: 100 });
    await expect(
      addSettlement({
        date: '2026-04-15',
        type: 'seller_payout',
        username: 'val-seller2',
        description: 'Over-payment attempt',
        amount: 200,
        settledBy: 'admin',
      })
    ).rejects.toThrow(/يتجاوز الرصيد المتاح/);
  });

  it('Test 3 — 1 cent tolerance allowed (rounding drift)', async () => {
    await seedSellerWithBonus({ username: 'val-seller3', total: 100 });
    const id = await addSettlement({
      date: '2026-04-15',
      type: 'seller_payout',
      username: 'val-seller3',
      description: 'Exact match with rounding',
      amount: 100.005,
      settledBy: 'admin',
    });
    expect(typeof id).toBe('number');
  });

  // v1.1 S1.8 [F-005] — profit_distribution was the v1.0.1 "no cap" escape
  // hatch that let admins write uncapped payouts through the settlements
  // path. v1.1 removes it from the write path entirely (new splits go
  // through /profit-distributions which has the F-001 cap). The READ-side
  // helper `getAvailableCredit` still returns null (since null meant
  // "no cap" historically and UI code may check that), but the write
  // must be rejected. This test verifies both.
  it('Test 4 — profit_distribution: write path rejected, read path still null [v1.1 F-005]', async () => {
    const hash = bcryptjs.hashSync('test-password', 12);
    await sql`
      INSERT INTO users (username, password, name, role, active)
      VALUES ('val-admin', ${hash}, 'Admin User', 'admin', true)
      ON CONFLICT (username) DO UPDATE SET active = true, role = 'admin'
    `;
    // Read path: getAvailableCredit still returns null for profit_distribution
    // — semantic is "no strict cap in the legacy sense". Callers shouldn't use
    // this anymore; kept for backwards compat with any lingering UI checks.
    const available = await getAvailableCredit('val-admin', 'profit_distribution');
    expect(available).toBeNull();

    // Write path: addSettlement rejects with Arabic F-005 message.
    await expect(
      addSettlement({
        date: '2026-04-15',
        type: 'profit_distribution',
        username: 'val-admin',
        description: 'Profit share',
        amount: 5000,
        settledBy: 'admin',
      })
    ).rejects.toThrow(/profit_distribution.*لم يعد مقبولاً/);
  });

  it('Test 5 — zero available credit blocks any positive amount', async () => {
    const hash = bcryptjs.hashSync('test-password', 12);
    await sql`
      INSERT INTO users (username, password, name, role, active)
      VALUES ('val-seller-empty', ${hash}, 'Empty Seller', 'seller', true)
      ON CONFLICT (username) DO UPDATE SET active = true, role = 'seller'
    `;
    const available = await getAvailableCredit('val-seller-empty', 'seller_payout');
    expect(available).toBe(0);

    await expect(
      addSettlement({
        date: '2026-04-15',
        type: 'seller_payout',
        username: 'val-seller-empty',
        description: 'No credit attempt',
        amount: 1,
        settledBy: 'admin',
      })
    ).rejects.toThrow(/يتجاوز الرصيد المتاح/);
  });
});
