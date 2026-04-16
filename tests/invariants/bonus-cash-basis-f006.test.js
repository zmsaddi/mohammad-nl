// v1.1 F-006 — bonus accrual vs cash-basis P&L.
//
// Pre-v1.1 a credit sale with 0 collected still accrued the full bonus
// at delivery confirm. Cash-basis P&L subtracted totalBonusCost (which
// includes the accrued amount), producing a phantom loss. Example:
//
//   credit sale 1000€, dpe=0, confirmed, 0 collected:
//     cash-basis revenue  = 0
//     cash-basis COGS     = 0
//     totalBonusCost      = 10 (accrued at delivery)
//     netProfitCashBasis  = 0 - 0 - 10 = −10   ← phantom loss
//
// v1.1 splits the bonus cost:
//   totalBonusEarnedCashBasis = bonuses from fully-paid sales only
//   totalBonusAccruedUnearned = the rest (contingent liability)
//   netProfitCashBasis uses totalBonusEarnedCashBasis (not totalBonusCost)
//
// The accrual P&L still uses the full totalBonusCost (correct for accrual).

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import { initDatabase, getSummaryData } from '../../lib/db.js';

const TRUNCATE_TABLES = [
  'profit_distribution_groups', 'profit_distributions', 'cancellations',
  'sales', 'purchases', 'deliveries', 'invoices', 'bonuses',
  'settlements', 'payments', 'expenses', 'clients', 'products',
  'suppliers',
];

async function wipe() {
  const list = TRUNCATE_TABLES.map(t => `"${t}"`).join(', ');
  await sql.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

// Direct-insert fixtures so we control the exact state.
// Must also insert a matching deliveries row because bonuses.delivery_id
// has a FK constraint (fk_bonuses_delivery → deliveries.id).
async function insertBonus({ username, saleId, deliveryId, totalBonus, settled = false }) {
  // Ensure the delivery row exists for the FK
  await sql`
    INSERT INTO deliveries (id, date, client_name, client_phone, address, items,
      total_amount, status, driver_name, assigned_driver, notes, sale_id, created_by)
    VALUES (${deliveryId}, '2026-04-15', 'Test Client', '', '', 'Bike (1)',
      1000, 'تم التوصيل', '', '', '', ${saleId}, 'test-seed')
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO bonuses (date, username, role, sale_id, delivery_id, item, quantity,
      recommended_price, actual_price, fixed_bonus, extra_bonus, total_bonus, settled)
    VALUES ('2026-04-15', ${username}, 'seller', ${saleId}, ${deliveryId}, 'Bike', 1,
      1000, 1000, ${totalBonus}, 0, ${totalBonus}, ${settled})
    ON CONFLICT (delivery_id, role) DO NOTHING
  `;
}

async function insertSale({ id, total, remaining, paymentType, status }) {
  const refCode = `F006-${id}`;
  await sql`
    INSERT INTO sales (id, date, client_name, item, quantity, cost_price, unit_price,
      total, cost_total, profit, payment_method, payment_type,
      paid_amount, remaining, status, ref_code, created_by,
      recommended_price, notes, down_payment_expected, payment_status)
    VALUES (${id}, '2026-04-15', 'Test Client', 'Bike', 1, 400, ${total},
      ${total}, 400, ${total - 400}, ${paymentType}, ${paymentType},
      ${total - remaining}, ${remaining}, ${status}, ${refCode}, 'seller1',
      ${total}, '', ${paymentType === 'آجل' ? 0 : total},
      ${remaining < 0.005 ? 'paid' : 'pending'})
  `;
}

describe('v1.1 F-006 — bonus cash-basis split', () => {
  beforeAll(async () => { await initDatabase(); }, 60000);
  beforeEach(async () => { await wipe(); });
  afterAll(async () => { await wipe(); });

  it('T1 — credit sale 0 collected: cash-basis bonus cost = 0 (not the accrued amount)', async () => {
    // Confirmed credit sale, 1000€, 0 collected, remaining=1000
    await insertSale({ id: 1, total: 1000, remaining: 1000, paymentType: 'آجل', status: 'مؤكد' });
    // Bonus accrued at delivery confirm (10€ seller)
    await insertBonus({ username: 'seller1', saleId: 1, deliveryId: 1, totalBonus: 10 });

    const summary = await getSummaryData();
    // Accrual: still charges the full bonus
    expect(summary.totalBonusCost).toBe(10);
    // Cash-basis: bonus NOT earned yet (sale not fully paid)
    expect(summary.totalBonusEarnedCashBasis).toBe(0);
    expect(summary.totalBonusAccruedUnearned).toBe(10);
    // Cash-basis netProfit: revenue=0, expenses=0, bonus=0, dist=0 → 0 (not -10)
    expect(summary.netProfitCashBasis).toBe(0);
    // Accrual netProfit: revenue=1000 (confirmed), COGS=400, bonus=10 → 590
    expect(summary.netProfit).toBe(1000 - 400 - 10);
  });

  it('T2 — cash sale fully paid: bonus charges on BOTH accrual and cash-basis', async () => {
    await insertSale({ id: 2, total: 1000, remaining: 0, paymentType: 'كاش', status: 'مؤكد' });
    await insertBonus({ username: 'seller1', saleId: 2, deliveryId: 2, totalBonus: 10 });

    const summary = await getSummaryData();
    expect(summary.totalBonusCost).toBe(10);
    expect(summary.totalBonusEarnedCashBasis).toBe(10);
    expect(summary.totalBonusAccruedUnearned).toBe(0);
    // Cash-basis: revenue=1000, COGS=400, bonus=10 → 590
    expect(summary.netProfitCashBasis).toBe(1000 - 400 - 10);
  });

  it('T3 — settled bonus (with settlement row): cash outflow shows in totalBonusPaid', async () => {
    // Credit sale still unpaid
    await insertSale({ id: 3, total: 1000, remaining: 1000, paymentType: 'آجل', status: 'مؤكد' });
    // Bonus settled via a payout settlement
    await insertBonus({ username: 'seller1', saleId: 3, deliveryId: 3, totalBonus: 10, settled: true });
    // The actual payout settlement row (this is what makes the cash outflow real)
    await sql`
      INSERT INTO settlements (date, type, username, description, amount, settled_by, notes)
      VALUES ('2026-04-15', 'seller_payout', 'seller1', 'test payout', 10, 'admin', '')
    `;

    const summary = await getSummaryData();
    // totalBonusPaid captures the settlement, not the bonus
    expect(summary.totalBonusPaid).toBe(10);
    // totalBonusOwed = unsettled bonuses = 0 (the bonus IS settled)
    expect(summary.totalBonusOwed).toBe(0);
    // totalBonusCost = 10 + 0 = 10
    expect(summary.totalBonusCost).toBe(10);
    // Cash-basis earned = settlement payout (10) + unsettled-from-paid-sales (0) = 10
    expect(summary.totalBonusEarnedCashBasis).toBe(10);
    // Unearned = 0 (everything is settled)
    expect(summary.totalBonusAccruedUnearned).toBe(0);
  });

  it('T4 — mix: paid + unpaid sales → only paid-sale bonuses charge cash-basis', async () => {
    await insertSale({ id: 4, total: 1000, remaining: 0, paymentType: 'كاش', status: 'مؤكد' });
    await insertSale({ id: 5, total: 800, remaining: 800, paymentType: 'آجل', status: 'مؤكد' });
    await insertBonus({ username: 'seller1', saleId: 4, deliveryId: 4, totalBonus: 10 });
    await insertBonus({ username: 'seller1', saleId: 5, deliveryId: 5, totalBonus: 8 });

    const summary = await getSummaryData();
    expect(summary.totalBonusCost).toBe(18);
    expect(summary.totalBonusEarnedCashBasis).toBe(10);
    expect(summary.totalBonusAccruedUnearned).toBe(8);
  });

  it('T5 — P&L identity (cash-basis): net + bonus_earned + expenses + dist = gross', async () => {
    await insertSale({ id: 6, total: 1500, remaining: 0, paymentType: 'كاش', status: 'مؤكد' });
    await insertBonus({ username: 'seller1', saleId: 6, deliveryId: 6, totalBonus: 15 });

    const summary = await getSummaryData();
    const sum = summary.netProfitCashBasis
      + summary.totalBonusEarnedCashBasis
      + summary.totalExpenses
      + summary.totalProfitDistributed;
    expect(Math.abs(sum - summary.grossProfitCashBasis)).toBeLessThan(0.01);
  });
});
