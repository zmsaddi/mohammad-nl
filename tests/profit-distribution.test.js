// v1.0.2 Feature 2 — profit_distributions (توزيع أرباح)
//
// Verifies the schema, the 100%-sum rule, role eligibility, amount
// computation, grouped history, and collected-revenue period helper.
//
// Run with: npx vitest run tests/profit-distribution.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import bcryptjs from 'bcryptjs';
import {
  initDatabase,
  addProfitDistribution,
  getProfitDistributions,
  getAdminManagerUsers,
  getCollectedRevenueForPeriod,
} from '../lib/db.js';

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

async function seedUsers() {
  const hash = bcryptjs.hashSync('test-password', 12);
  const rows = [
    ['pd-admin1',   'Admin 1',   'admin'],
    ['pd-admin2',   'Admin 2',   'admin'],
    ['pd-manager1', 'Manager 1', 'manager'],
    ['pd-manager2', 'Manager 2', 'manager'],
    ['pd-manager3', 'Manager 3', 'manager'],
    ['pd-seller',   'Seller',    'seller'],
    ['pd-driver',   'Driver',    'driver'],
  ];
  for (const [username, name, role] of rows) {
    await sql`
      INSERT INTO users (username, password, name, role, active)
      VALUES (${username}, ${hash}, ${name}, ${role}, true)
      ON CONFLICT (username) DO UPDATE SET active = true, role = ${role}, name = ${name}
    `;
  }
}

// v1.2 — F-001 cap is now computed from net profit on paid sales (cash
// basis), not from raw payment rows. Feature-2 mechanics tests below
// don't specify periods (null period = all-time bucket). Tests that
// only verify split math / row persistence call seedCapPool() to ensure
// the cap is non-binding. Tests that exercise the cap itself live in
// tests/invariants/profit-distribution-solvency.test.js. Test 7
// (getCollectedRevenueForPeriod) does NOT call seedCapPool because it
// audits the pool math directly.
async function seedCapPool(amount = 10000) {
  // Seed a paid confirmed sale with no costs so net profit = revenue = amount.
  // This satisfies the v1.2 cap (lib/db.js:2549-2571) without binding it.
  const { rows } = await sql`
    INSERT INTO sales (
      date, client_name, item, quantity, cost_price, unit_price, total,
      cost_total, profit, payment_method, payment_type,
      paid_amount, remaining, status, payment_status, created_by
    )
    VALUES (
      '2026-01-01', 'cap-seed', 'CAP-POOL', 1, 0, ${amount}, ${amount},
      0, ${amount}, 'كاش', 'كاش',
      ${amount}, 0, 'مؤكد', 'paid', 'test-seed'
    )
    RETURNING id
  `;
  await sql`
    INSERT INTO payments (date, client_name, amount, sale_id, type, payment_method, tva_amount, created_by, notes)
    VALUES ('2026-01-01', 'cap-seed', ${amount}, ${rows[0].id}, 'collection', 'كاش', 0, 'test-seed', 'F-001 test pool')
  `;
}

describe('Feature 2 — profit_distributions', () => {
  beforeAll(async () => { await initDatabase(); }, 30000);
  beforeEach(async () => {
    await truncateBusinessTables();
    await sql`DELETE FROM users WHERE username LIKE 'pd-%'`;
    await seedUsers();
  });
  afterAll(async () => {
    await truncateBusinessTables();
    await sql`DELETE FROM users WHERE username LIKE 'pd-%'`;
  });

  // ──────────────────────────────────────────────────────────────
  it('Test 1 — valid distribution (sum = 100%) succeeds + rows persisted', async () => {
    await seedCapPool();
    const result = await addProfitDistribution({
      baseAmount: 2000,
      recipients: [
        { username: 'pd-admin1',   percentage: 50 },
        { username: 'pd-manager1', percentage: 50 },
      ],
      createdBy: 'pd-admin1',
    });
    expect(result.group_id).toMatch(/^PD-/);
    expect(result.recipients_count).toBe(2);
    expect(result.total_distributed).toBe(2000);

    const { rows } = await sql`
      SELECT username, percentage, amount FROM profit_distributions
      WHERE group_id = ${result.group_id}
      ORDER BY username
    `;
    expect(rows).toHaveLength(2);
    expect(parseFloat(rows[0].amount) + parseFloat(rows[1].amount)).toBe(2000);
  });

  // ──────────────────────────────────────────────────────────────
  it('Test 2 — rejects sum != 100% with Arabic error', async () => {
    await expect(
      addProfitDistribution({
        baseAmount: 1000,
        recipients: [
          { username: 'pd-admin1', percentage: 60 },
          { username: 'pd-admin2', percentage: 30 },
        ],
        createdBy: 'pd-admin1',
      })
    ).rejects.toThrow(/يجب أن يساوي 100%/);
  });

  // ──────────────────────────────────────────────────────────────
  it('Test 3 — rejects empty recipients', async () => {
    await expect(
      addProfitDistribution({
        baseAmount: 1000,
        recipients: [],
        createdBy: 'pd-admin1',
      })
    ).rejects.toThrow(/مستلم واحد على الأقل/);
  });

  // ──────────────────────────────────────────────────────────────
  it('Test 4 — rejects non-admin/manager recipients', async () => {
    // Seller trying to be a recipient → should fail the role check
    await expect(
      addProfitDistribution({
        baseAmount: 1000,
        recipients: [
          { username: 'pd-admin1', percentage: 50 },
          { username: 'pd-seller', percentage: 50 },
        ],
        createdBy: 'pd-admin1',
      })
    ).rejects.toThrow(/pd-seller.*ليس مديراً أو مشرفاً/);

    // Driver should fail too
    await expect(
      addProfitDistribution({
        baseAmount: 1000,
        recipients: [
          { username: 'pd-admin1', percentage: 80 },
          { username: 'pd-driver', percentage: 20 },
        ],
        createdBy: 'pd-admin1',
      })
    ).rejects.toThrow(/pd-driver.*ليس مديراً أو مشرفاً/);

    // Non-existent user should fail with a different message
    await expect(
      addProfitDistribution({
        baseAmount: 1000,
        recipients: [
          { username: 'pd-admin1',    percentage: 50 },
          { username: 'pd-nonexistent', percentage: 50 },
        ],
        createdBy: 'pd-admin1',
      })
    ).rejects.toThrow(/غير موجود/);
  });

  // ──────────────────────────────────────────────────────────────
  it('Test 5 — computes amounts correctly for 25/15/20/20/20 split of 2000', async () => {
    await seedCapPool();
    // Matches the user example: 2000 base, 5 recipients
    const result = await addProfitDistribution({
      baseAmount: 2000,
      recipients: [
        { username: 'pd-admin1',   percentage: 25 },
        { username: 'pd-admin2',   percentage: 15 },
        { username: 'pd-manager1', percentage: 20 },
        { username: 'pd-manager2', percentage: 20 },
        { username: 'pd-manager3', percentage: 20 },
      ],
      createdBy: 'pd-admin1',
    });
    expect(result.recipients_count).toBe(5);
    // 500 + 300 + 400 + 400 + 400 = 2000
    expect(result.total_distributed).toBe(2000);

    const { rows } = await sql`
      SELECT username, amount FROM profit_distributions
      WHERE group_id = ${result.group_id}
      ORDER BY username
    `;
    const map = Object.fromEntries(rows.map((r) => [r.username, parseFloat(r.amount)]));
    expect(map['pd-admin1']).toBe(500);
    expect(map['pd-admin2']).toBe(300);
    expect(map['pd-manager1']).toBe(400);
    expect(map['pd-manager2']).toBe(400);
    expect(map['pd-manager3']).toBe(400);
  });

  // ──────────────────────────────────────────────────────────────
  it('Test 6 — getProfitDistributions returns grouped rows with recipients array', async () => {
    await seedCapPool();
    await addProfitDistribution({
      baseAmount: 1000,
      recipients: [
        { username: 'pd-admin1',   percentage: 60 },
        { username: 'pd-manager1', percentage: 40 },
      ],
      notes: 'Q1 distribution',
      createdBy: 'pd-admin1',
    });
    // Second distribution to verify ordering (newest first)
    await addProfitDistribution({
      baseAmount: 500,
      recipients: [
        { username: 'pd-admin1', percentage: 100 },
      ],
      createdBy: 'pd-admin1',
    });

    const list = await getProfitDistributions();
    expect(list).toHaveLength(2);
    // newest first — the 500-base distribution is the second one added
    expect(list[0].base_amount).toBe(500);
    expect(list[0].recipients).toHaveLength(1);
    expect(list[0].recipients[0].username).toBe('pd-admin1');
    expect(list[0].recipients[0].percentage).toBe(100);

    expect(list[1].base_amount).toBe(1000);
    expect(list[1].notes).toBe('Q1 distribution');
    expect(list[1].recipients).toHaveLength(2);
    // recipients sorted by percentage DESC inside each group
    expect(list[1].recipients[0].percentage).toBe(60);
    expect(list[1].recipients[1].percentage).toBe(40);
  });

  // ──────────────────────────────────────────────────────────────
  it('Test 7 — getCollectedRevenueForPeriod sums collection payments in range', async () => {
    // Seed a few collection rows in payments (no FK constraint on
    // payments.sale_id so we can use NULL).
    await sql`
      INSERT INTO payments (date, client_name, amount, sale_id, type, payment_method, tva_amount, created_by, notes)
      VALUES
        ('2026-04-10', 'Client 1', 500,  NULL, 'collection', 'كاش', 0, 'admin', ''),
        ('2026-04-12', 'Client 2', 300,  NULL, 'collection', 'بنك', 0, 'admin', ''),
        ('2026-04-15', 'Client 3', 200,  NULL, 'collection', 'كاش', 0, 'admin', ''),
        ('2026-04-20', 'Client 4', 100,  NULL, 'collection', 'كاش', 0, 'admin', ''),
        ('2026-04-12', 'Client 5', 1000, NULL, 'refund',     'كاش', 0, 'admin', '')
    `;

    // All time
    const allTime = await getCollectedRevenueForPeriod(null, null);
    expect(allTime).toBe(1100); // 500 + 300 + 200 + 100 (refund excluded by type filter)

    // Range 2026-04-12 → 2026-04-15 inclusive
    const inRange = await getCollectedRevenueForPeriod('2026-04-12', '2026-04-15');
    expect(inRange).toBe(500); // 300 + 200

    // Only start bound
    const fromRange = await getCollectedRevenueForPeriod('2026-04-15', null);
    expect(fromRange).toBe(300); // 200 + 100

    // Only end bound
    const toRange = await getCollectedRevenueForPeriod(null, '2026-04-12');
    expect(toRange).toBe(800); // 500 + 300
  });

  // ──────────────────────────────────────────────────────────────
  it('getAdminManagerUsers — returns admin + manager only, sorted', async () => {
    const users = await getAdminManagerUsers();
    const usernames = users.map((u) => u.username).filter((u) => u.startsWith('pd-'));
    expect(usernames).toContain('pd-admin1');
    expect(usernames).toContain('pd-admin2');
    expect(usernames).toContain('pd-manager1');
    expect(usernames).toContain('pd-manager2');
    expect(usernames).toContain('pd-manager3');
    expect(usernames).not.toContain('pd-seller');
    expect(usernames).not.toContain('pd-driver');
  });
});
