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

async function seedCollection(amount, date = '2026-04-15') {
  await sql`
    INSERT INTO payments (client_name, amount, payment_method, date, type, notes, created_by)
    VALUES ('test', ${amount}, 'كاش', ${date}, 'collection', '', 'test-seed')
  `;
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
    // Pool: 2,000€ collected. Distribute 1,500€ to f002-admin.
    await seedCollection(2000);
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
    // With no sales, netProfit = 0 - 0 - 0 - 1500 = -1500
    // This is mathematically correct: distributing 1500 of cash as profit
    // when gross profit is 0 creates a 1500 paper loss. Real operators
    // would also have sales to offset this; the test just checks the term
    // flows through the formula.
    expect(summary.netProfit).toBe(-1500);
    expect(summary.netProfitCashBasis).toBe(-1500);
    // distributable clamps negative at 0
    expect(summary.distributable).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // T3 — multiple distributions sum correctly
  // ─────────────────────────────────────────────────────────────
  it('T3 — multiple distributions across different periods sum correctly', async () => {
    // Seed collection in BOTH April and May so the F-001 cap doesn't block.
    await seedCollection(2000, '2026-04-10'); // April pool
    await seedCollection(2000, '2026-05-10'); // May pool
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
    // netProfit = 0 gross - 0 expenses - 0 bonuses - 1500 distributed
    expect(summary.netProfit).toBe(-1500);
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
    await seedCollection(3000);
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
    expect(summary.netProfit).toBe(-1500);
  });

  // ─────────────────────────────────────────────────────────────
  // T6 — distributable clamps at 0
  // ─────────────────────────────────────────────────────────────
  it('T6 — distributable clamps negative netProfitCashBasis at 0', async () => {
    await seedCollection(1000);
    await addProfitDistribution({
      baseAmount: 900,
      recipients: [{ username: 'f002-admin', percentage: 100 }],
      basePeriodStart: '2026-04-01',
      basePeriodEnd:   '2026-04-30',
      createdBy: 'f002-admin',
    });
    const summary = await getSummaryData();
    // No sales → cash-basis revenue = 0, netProfitCashBasis = 0 - 0 - 0 - 900 = -900
    expect(summary.netProfitCashBasis).toBe(-900);
    expect(summary.distributable).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // T7 — cash-basis reflects the subtraction
  // ─────────────────────────────────────────────────────────────
  it('T7 — cash-basis netProfit identity holds: gross - expenses - bonuses - distributed', async () => {
    await seedCollection(2000);
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
    await seedCollection(3000);
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
