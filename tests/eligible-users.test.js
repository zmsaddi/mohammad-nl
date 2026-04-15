// v1.0.1 Feature 3 — getEligibleUsersForSettlement
//
// Returns users relevant to a given settlement type with their live
// unsettled credit balance. Used by the settlement form dropdown.
//
// Run with: npx vitest run tests/eligible-users.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import bcryptjs from 'bcryptjs';
import {
  initDatabase,
  getEligibleUsersForSettlement,
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

async function seedUsers() {
  const hash = bcryptjs.hashSync('test-password', 12);
  const rows = [
    ['elg-seller-a', 'Seller A', 'seller'],
    ['elg-seller-b', 'Seller B', 'seller'],
    ['elg-driver-a', 'Driver A', 'driver'],
    ['elg-driver-b', 'Driver B', 'driver'],
    ['elg-admin-a',  'Admin A',  'admin'],
    ['elg-manager-a','Manager A','manager'],
  ];
  for (const [username, name, role] of rows) {
    await sql`
      INSERT INTO users (username, password, name, role, active)
      VALUES (${username}, ${hash}, ${name}, ${role}, true)
      ON CONFLICT (username) DO UPDATE SET active = true, role = ${role}, name = ${name}
    `;
  }
}

async function seedBonus({ username, role, amount, settled = false }) {
  // bonuses.delivery_id has a NOT NULL FK; seed a fresh placeholder
  // delivery row per bonus to satisfy the constraint (and the unique
  // (delivery_id, role) index) without coupling tests to real sales.
  const today = new Date().toISOString().slice(0, 10);
  const { rows: delRows } = await sql`
    INSERT INTO deliveries (date, client_name, address, items, total_amount, status, assigned_driver, notes)
    VALUES (${today}, 'elg-fixture', 'addr', 'fixture', 0, 'قيد الانتظار', '', '')
    RETURNING id
  `;
  const deliveryId = delRows[0].id;
  await sql`
    INSERT INTO bonuses (date, username, role, sale_id, delivery_id, item, quantity, recommended_price, actual_price, fixed_bonus, extra_bonus, total_bonus, settled)
    VALUES (${today}, ${username}, ${role},
            NULL, ${deliveryId}, 'TEST Item', 1, 0, 0, 0, 0, ${amount}, ${settled})
  `;
}

describe('Feature 3 — getEligibleUsersForSettlement', () => {
  beforeAll(async () => { await initDatabase(); }, 30000);
  beforeEach(async () => {
    await truncateBusinessTables();
    await sql`DELETE FROM users WHERE username LIKE 'elg-%'`;
    await seedUsers();
  });
  afterAll(async () => {
    await truncateBusinessTables();
    await sql`DELETE FROM users WHERE username LIKE 'elg-%'`;
  });

  it('Test 1 — sale type returns only sellers (role=seller)', async () => {
    const rows = await getEligibleUsersForSettlement('seller_payout');
    const usernames = rows.map((r) => r.username);
    expect(usernames).toContain('elg-seller-a');
    expect(usernames).toContain('elg-seller-b');
    expect(usernames).not.toContain('elg-driver-a');
    expect(usernames).not.toContain('elg-admin-a');
    expect(usernames).not.toContain('elg-manager-a');
  });

  it('Test 2 — delivery type returns only drivers (role=driver)', async () => {
    const rows = await getEligibleUsersForSettlement('driver_payout');
    const usernames = rows.map((r) => r.username);
    expect(usernames).toContain('elg-driver-a');
    expect(usernames).toContain('elg-driver-b');
    expect(usernames).not.toContain('elg-seller-a');
    expect(usernames).not.toContain('elg-admin-a');
    expect(usernames).not.toContain('elg-manager-a');
  });

  it('Test 3 — profit_distribution returns admin + manager, null credit', async () => {
    const rows = await getEligibleUsersForSettlement('profit_distribution');
    const usernames = rows.map((r) => r.username);
    expect(usernames).toContain('elg-admin-a');
    expect(usernames).toContain('elg-manager-a');
    expect(usernames).not.toContain('elg-seller-a');
    expect(usernames).not.toContain('elg-driver-a');
    for (const r of rows) {
      expect(r.available_credit).toBeNull();
    }
  });

  it('Test 4 — available_credit = sum(unsettled bonuses) per role', async () => {
    await seedBonus({ username: 'elg-seller-a', role: 'seller', amount: 50 });
    await seedBonus({ username: 'elg-seller-a', role: 'seller', amount: 30 });
    await seedBonus({ username: 'elg-seller-a', role: 'seller', amount: 20, settled: true });
    await seedBonus({ username: 'elg-seller-b', role: 'seller', amount: 100 });

    const rows = await getEligibleUsersForSettlement('seller_payout');
    const a = rows.find((r) => r.username === 'elg-seller-a');
    const b = rows.find((r) => r.username === 'elg-seller-b');
    expect(a.available_credit).toBe(80); // 50 + 30, settled row excluded
    expect(b.available_credit).toBe(100);
  });

  it('Test 5 — zero-credit users still appear in the list (not filtered)', async () => {
    // Seed only seller-b; seller-a has no bonuses at all
    await seedBonus({ username: 'elg-seller-b', role: 'seller', amount: 50 });
    const rows = await getEligibleUsersForSettlement('seller_payout');
    const a = rows.find((r) => r.username === 'elg-seller-a');
    const b = rows.find((r) => r.username === 'elg-seller-b');
    expect(a).toBeTruthy();
    expect(a.available_credit).toBe(0);
    expect(b.available_credit).toBe(50);
  });
});
