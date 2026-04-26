// v1.1 Sprint 2 F-002 — netProfit subtracts profit_distributions.
//
// Pre-v1.1 getSummaryData computed netProfit as:
//   grossProfit - totalExpenses - totalBonusCost
// and never read the profit_distributions table. A distribution leaving
// the company's bank account as profit to admins/managers was invisible
// in both accrual and cash-basis P&L views.
//
// v1.1 F-002 adds totalProfitDistributed = profit_distributions table +
// legacy settlements with type='profit_distribution' (for backwards
// compat with v1.0.x data), and subtracts it from both netProfit AND
// netProfitCashBasis.
//
// Also surfaces `distributable = max(0, netProfitCashBasis)` so the
// dashboard can show "how much profit is still available to distribute"
// as a soft hint alongside the F-001 cap's collected-based hard check.
//
// Test cases:
//   T1 — clean slate: no distributions → netProfit matches pre-v1.1 formula
//   T2 — one distribution shows up as subtraction
//   T3 — multiple distributions sum correctly
//   T4 — legacy settlement-type profit_distribution rows still count
//   T5 — mixed: table + legacy — both counted once
//   T6 — distributable hint clamps at 0
//   T7 — cash-basis reflects the subtraction too
//   T8 — period filter on created_at scopes the totals
//
// Run with: npx vitest run tests/invariants/net-profit-profit-distributions.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import bcryptjs from 'bcryptjs';
import {
  initDatabase,
  addProfitDistribution,
  getSummaryData,
} from '../../lib/db.js';

const TRUNCATE_TABLES = [
  'profit_distribution_groups', 'profit_distributions',
  'cancellations',
  'sales', 'purchases', 'deliveries', 'invoices', 'bonuses',
  'settlements', 'payments', 'expenses', 'clients', 'products',
  'suppliers', 'voice_logs', 'ai_corrections', 'entity_aliases',
  'ai_patterns', 'price_history',
];

async function wipe() {
  const list = TRUNCATE_TABLES.map(t => `"${t}"`).join(', ');
  await sql.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function seedAdmin(username) {
  const hash = bcryptjs.hashSync('test-password', 12);
  await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES (${username}, ${hash}, ${'F002 ' + username}, 'admin', true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = 'admin'
  `;
}

// v1.2 — the F-001 cap reads net profit from PAID SALES (cash basis)
// rather than payments. To produce a cap of `amount`, we seed a paid
// confirmed sale with no costs so net profit = revenue = amount.
// Pre-v1.2 a payments-only INSERT was sufficient. See lib/db.js:2549-2571.
async function seedPaidSale(amount, date = '2026-04-15') {
  const { rows } = await sql`
    INSERT INTO sales (
      date, client_name, item, quantity, cost_price, unit_price, total,
      cost_total, profit, payment_method, payment_type,
      paid_amount, remaining, status, payment_status, created_by
    )
    VALUES (
      ${date}, 'test-client', 'TEST-ITEM', 1, 0, ${amount}, ${amount},
      0, ${amount}, 'كاش', 'كاش',
      ${amount}, 0, 'مؤكد', 'paid', 'test-seed'
    )
    RETURNING id
  `;
  await sql`
    INSERT INTO payments (client_name, amount, payment_method, date, type, sale_id, notes, created_by)
    VALUES ('test-client', ${amount}, 'كاش', ${date}, 'collection', ${rows[0].id}, '', 'test-seed')
  `;
  return rows[0].id;
}

// Bypass addSettlement (which now rejects profit_distribution) so we can
// simulate a pre-v1.1 production DB with legacy settlement rows.
async function seedLegacyProfitSettlement(amount, date = '2026-04-15') {
  await sql`
    INSERT INTO settlements (date, type, username, description, amount, settled_by, notes)
    VALUES (${date}, 'profit_distribution', 'admin', 'legacy v1.0.x', ${amount}, 'admin', 'pre-v1.1')
  `;
}

describe('v1.1 F-002 — netProfit subtracts profit_distributions', () => {
  beforeAll(async () => { await initDatabase(); }, 60000);

  beforeEach(async () => {
    await wipe();
    await seedAdmin('f002-admin');
  });

  afterAll(async () => {
    await wipe();
    await sql`DELETE FROM users WHERE username = 'f002-admin'`;
  });

  // ─────────────────────────────────────────────────────────────
  // T1 — clean slate
  // ─────────────────────────────────────────────────────────────
  it('T1 — clean slate: no distributions, totalProfitDistributed = 0', async () => {
    const summary = await getSummaryData();
    expect(summary.totalProfitDistributed).toBe(0);
    expect(summary.profitDistFromTable).toBe(0);
    expect(summary.profitDistFromLegacySettlements).toBe(0);
    // With nothing else, netProfit is 0 - 0 - 0 - 0 = 0
    expect(summary.netProfit).toBe(0);
    expect(summary.netProfitCashBasis).toBe(0);
    expect(summary.distributable).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // T2 — one distribution reduces netProfit by its amount
  // ─────────────────────────────────────────────────────────────
  it('T2 — single distribution reduces both netProfit variants', async () => {
    // v1.2 — seed a paid sale so the F-001 cap permits the distribution.
    // Net profit before distribution = 2000 (revenue 2000, no costs).
    // After distributing 1500 → netProfit = 2000 - 1500 = 500.
    await seedPaidSale(2000);
    await addProfitDistribution({
      baseAmount: 1500,
      recipients: [{ username: 'f002-admin', percentage: 100 }],
      basePeriodStart: '2026-04-01',
      basePeriodEnd:   '2026-04-30',
      createdBy: 'f002-admin',
    });

    const summary = await getSummaryData();
    expect(summary.totalProfitDistributed).toBe(1500);
    expect(summary.profitDistFromTable).toBe(1500);
    expect(summary.profitDistFromLegacySettlements).toBe(0);
    // With 2000 in paid sales (no costs) and 1500 distributed:
    // netProfit = 2000 gross - 0 expenses - 0 bonuses - 1500 distributed = 500
    expect(summary.netProfit).toBe(500);
    expect(summary.netProfitCashBasis).toBe(500);
    // 500 still distributable
    expect(summary.distributable).toBe(500);
  });

  // ─────────────────────────────────────────────────────────────
  // T3 — multiple distributions sum correctly
  // ─────────────────────────────────────────────────────────────
  it('T3 — multiple distributions across different periods sum correctly', async () => {
    // v1.2 — seed paid sales in BOTH April and May so the F-001 cap doesn't block.
    await seedPaidSale(2000, '2026-04-10'); // April: 2000 net profit
    await seedPaidSale(2000, '2026-05-10'); // May:   2000 net profit (4000 total)
    await addProfitDistribution({
      baseAmount: 1000,
      recipients: [{ username: 'f002-admin', percentage: 100 }],
      basePeriodStart: '2026-04-01',
      basePeriodEnd:   '2026-04-30',
      createdBy: 'f002-admin',
    });
    await addProfitDistribution({
      baseAmount: 500,
      recipients: [{ username: 'f002-admin', percentage: 100 }],
      basePeriodStart: '2026-05-01',
      basePeriodEnd:   '2026-05-31',
      createdBy: 'f002-admin',
    });

    const summary = await getSummaryData();
    expect(summary.totalProfitDistributed).toBe(1500);
    // netProfit = 4000 gross - 0 expenses - 0 bonuses - 1500 distributed = 2500
    expect(summary.netProfit).toBe(2500);
  });

  // ─────────────────────────────────────────────────────────────
  // T4 — legacy settlement-type profit_distribution rows count
  // ─────────────────────────────────────────────────────────────
  it('T4 — legacy settlement profit_distribution rows still reduce netProfit', async () => {
    await seedLegacyProfitSettlement(800);

    const summary = await getSummaryData();
    expect(summary.profitDistFromTable).toBe(0);
    expect(summary.profitDistFromLegacySettlements).toBe(800);
    expect(summary.totalProfitDistributed).toBe(800);
    expect(summary.netProfit).toBe(-800);
  });

  // ─────────────────────────────────────────────────────────────
  // T5 — mixed: new table + legacy settlements
  // ─────────────────────────────────────────────────────────────
  it('T5 — new table and legacy settlement rows both counted once', async () => {
    // v1.2 — paid sale of 3000 covers both the legacy 500 + new 1000 distributions.
    await seedPaidSale(3000);
    await seedLegacyProfitSettlement(500);
    await addProfitDistribution({
      baseAmount: 1000,
      recipients: [{ username: 'f002-admin', percentage: 100 }],
      basePeriodStart: '2026-04-01',
      basePeriodEnd:   '2026-04-30',
      createdBy: 'f002-admin',
    });

    const summary = await getSummaryData();
    expect(summary.profitDistFromTable).toBe(1000);
    expect(summary.profitDistFromLegacySettlements).toBe(500);
    expect(summary.totalProfitDistributed).toBe(1500);
    // netProfit = 3000 gross - 0 expenses - 0 bonuses - 1500 distributed = 1500
    expect(summary.netProfit).toBe(1500);
  });

  // ─────────────────────────────────────────────────────────────
  // T6 — distributable clamps at 0
  // ─────────────────────────────────────────────────────────────
  it('T6 — distributable clamps negative netProfitCashBasis at 0', async () => {
    // v1.2 — addProfitDistribution now caps at distributable, so we cannot
    // create a negative-netProfit scenario through it. We use a legacy
    // settlement row (which bypasses the cap and represents pre-v1.1 data)
    // to drive netProfit negative and verify the clamp.
    await seedLegacyProfitSettlement(900);
    const summary = await getSummaryData();
    // No sales, no expenses, no bonuses, 900 legacy distributed:
    // netProfitCashBasis = 0 - 0 - 0 - 900 = -900
    expect(summary.netProfitCashBasis).toBe(-900);
    expect(summary.distributable).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // T7 — cash-basis reflects the subtraction
  // ─────────────────────────────────────────────────────────────
  it('T7 — cash-basis netProfit identity holds: gross - expenses - bonuses - distributed', async () => {
    await seedPaidSale(2000);
    await addProfitDistribution({
      baseAmount: 1200,
      recipients: [{ username: 'f002-admin', percentage: 100 }],
      basePeriodStart: '2026-04-01',
      basePeriodEnd:   '2026-04-30',
      createdBy: 'f002-admin',
    });
    const summary = await getSummaryData();
    // Identity: netProfitCashBasis + totalProfitDistributed
    //         + totalExpenses + totalBonusCost
    //         === grossProfitCashBasis
    const sum = summary.netProfitCashBasis + summary.totalProfitDistributed + summary.totalExpenses + summary.totalBonusCost;
    expect(Math.abs(sum - summary.grossProfitCashBasis)).toBeLessThan(0.01);
    // Same identity for accrual
    const sumA = summary.netProfit + summary.totalProfitDistributed + summary.totalExpenses + summary.totalBonusCost;
    expect(Math.abs(sumA - summary.grossProfit)).toBeLessThan(0.01);
  });

  // ─────────────────────────────────────────────────────────────
  // T8 — period filter scopes profit_distributions by created_at
  // ─────────────────────────────────────────────────────────────
  it('T8 — period filter (from/to) scopes profit_distributions by created_at', async () => {
    await seedPaidSale(3000);
    // Seed a distribution NOW (today) with created_at current timestamp
    await addProfitDistribution({
      baseAmount: 1000,
      recipients: [{ username: 'f002-admin', percentage: 100 }],
      basePeriodStart: '2026-04-01',
      basePeriodEnd:   '2026-04-30',
      createdBy: 'f002-admin',
    });

    // Period that EXCLUDES today → totalProfitDistributed in that window = 0
    const pastSummary = await getSummaryData('2020-01-01', '2020-12-31');
    expect(pastSummary.totalProfitDistributed).toBe(0);

    // All-time summary → sees the 1,000
    const allTime = await getSummaryData();
    expect(allTime.totalProfitDistributed).toBe(1000);
  });
});
