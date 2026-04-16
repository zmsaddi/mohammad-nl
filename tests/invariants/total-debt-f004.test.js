// v1.1 F-004 — totalDebt Bug-3 pattern fix regression test.
//
// Pre-v1.1 getSummaryData computed totalDebt as:
//   Σ credit_sales.total  −  Σ credit_sales.paid_amount  −  Σ payments.amount
//
// The third term was UNFILTERED — every payment row (cash collection,
// refund, legacy type) summed into the subtraction. A cash sale's
// collection payment would silently reduce the reported credit debt.
// Math.max(0, …) clamped wrong results to 0 so the defect was invisible
// in steady state but surfaced whenever a cash and credit sale coexisted
// in the same period.
//
// The fix: totalDebt = Σ sales.remaining(confirmed credit sales).
// Reads the sales ledger directly; no cross-table pollution.
//
// Strategy: we insert directly into sales + payments via raw SQL. This
// skips the addSale → updateDelivery lifecycle (which is tested elsewhere)
// and lets us construct the exact state the study §1.2 described.
//
// Reproduction case:
//   (a) 1,000€ credit sale, confirmed, 0 paid, remaining=1000
//   (b) 500€ cash sale, confirmed, paid=500, remaining=0
//   (c) 500€ collection payment for (b)
//
// Expected: totalDebt = 1,000 (only (a)'s remaining).
// Pre-v1.1 formula: 1000 - 0 - 500 = 500 ← WRONG, cash collection leaked.
// Post-v1.1 formula: reads sales.remaining → 1,000 correctly.

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

async function insertSale({ client, total, paidAmount, remaining, paymentType, status }) {
  const refCode = `F004-${Math.random().toString(36).slice(2, 8)}`;
  await sql`
    INSERT INTO sales (
      date, client_name, item, quantity, cost_price, unit_price,
      total, cost_total, profit, payment_method, payment_type,
      paid_amount, remaining, status, ref_code, created_by,
      recommended_price, notes, down_payment_expected
    ) VALUES (
      '2026-04-15', ${client}, 'F004 Bike', 1, 400, ${total},
      ${total}, 400, ${total - 400}, ${paymentType}, ${paymentType},
      ${paidAmount}, ${remaining}, ${status}, ${refCode}, 'f004-seller',
      ${total}, '', ${paymentType === 'آجل' ? 0 : total}
    )
  `;
}

async function insertCollectionPayment({ client, amount, saleId = null }) {
  await sql`
    INSERT INTO payments (
      date, client_name, amount, sale_id, type, payment_method,
      tva_amount, created_by, notes
    ) VALUES (
      '2026-04-15', ${client}, ${amount}, ${saleId}, 'collection',
      'كاش', 0, 'f004-seller', ''
    )
  `;
}

describe('v1.1 F-004 — totalDebt Bug-3 pattern fix', () => {
  beforeAll(async () => { await initDatabase(); }, 60000);
  beforeEach(async () => { await wipe(); });
  afterAll(async () => { await wipe(); });

  // ─────────────────────────────────────────────────────────────
  // T1 — the exact reproduction from the study §1.2 F-004.
  // Pre-v1.1 formula computed 500, clamped from -2400 by max(0,…);
  // post-v1.1 formula reads sales.remaining and returns 1000.
  // ─────────────────────────────────────────────────────────────
  it('T1 — 1000€ credit (unpaid) + 500€ cash (paid, collection row): totalDebt = 1000', async () => {
    // (a) confirmed credit sale, 0 paid, remaining=1000
    await insertSale({
      client: 'Credit A',
      total: 1000, paidAmount: 0, remaining: 1000,
      paymentType: 'آجل', status: 'مؤكد',
    });
    // (b) confirmed cash sale, fully paid, remaining=0
    await insertSale({
      client: 'Cash B',
      total: 500, paidAmount: 500, remaining: 0,
      paymentType: 'كاش', status: 'مؤكد',
    });
    // (c) the collection payment for (b) that pre-v1.1 polluted the sum
    await insertCollectionPayment({ client: 'Cash B', amount: 500 });

    const summary = await getSummaryData();
    expect(summary.totalDebt).toBe(1000);
  });

  // ─────────────────────────────────────────────────────────────
  // T2 — multiple credit sales sum their remainings
  // ─────────────────────────────────────────────────────────────
  it('T2 — two confirmed credit sales: totalDebt = sum of their remainings', async () => {
    await insertSale({
      client: 'Credit A',
      total: 800, paidAmount: 0, remaining: 800,
      paymentType: 'آجل', status: 'مؤكد',
    });
    await insertSale({
      client: 'Credit B',
      total: 1200, paidAmount: 200, remaining: 1000,
      paymentType: 'آجل', status: 'مؤكد',
    });
    const summary = await getSummaryData();
    expect(summary.totalDebt).toBe(1800);
  });

  // ─────────────────────────────────────────────────────────────
  // T3 — cancelled credit sales excluded from totalDebt
  // ─────────────────────────────────────────────────────────────
  it('T3 — cancelled credit sale is excluded from totalDebt', async () => {
    await insertSale({
      client: 'Credit Cancelled',
      total: 1500, paidAmount: 0, remaining: 0,
      paymentType: 'آجل', status: 'ملغي',
    });
    const summary = await getSummaryData();
    expect(summary.totalDebt).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // T4 — reserved credit sales excluded from totalDebt
  // ─────────────────────────────────────────────────────────────
  it('T4 — reserved (محجوز) credit sales are excluded from totalDebt', async () => {
    await insertSale({
      client: 'Credit Reserved',
      total: 700, paidAmount: 0, remaining: 700,
      paymentType: 'آجل', status: 'محجوز',
    });
    const summary = await getSummaryData();
    expect(summary.totalDebt).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // T5 — cash-only tenant: totalDebt = 0 regardless of collection rows
  // ─────────────────────────────────────────────────────────────
  it('T5 — no credit sales, only cash + collections: totalDebt = 0', async () => {
    await insertSale({
      client: 'Cash A',
      total: 500, paidAmount: 500, remaining: 0,
      paymentType: 'كاش', status: 'مؤكد',
    });
    await insertSale({
      client: 'Cash B',
      total: 750, paidAmount: 750, remaining: 0,
      paymentType: 'كاش', status: 'مؤكد',
    });
    await insertCollectionPayment({ client: 'Cash A', amount: 500 });
    await insertCollectionPayment({ client: 'Cash B', amount: 750 });

    const summary = await getSummaryData();
    expect(summary.totalDebt).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // T6 — partial collection on credit: totalDebt reflects the
  // remaining balance (not the original total, not 0).
  // ─────────────────────────────────────────────────────────────
  it('T6 — credit sale with partial collection: totalDebt = remaining', async () => {
    // 1000€ credit, 300€ down at delivery, 400€ later collection → remaining=300
    await insertSale({
      client: 'Credit Partial',
      total: 1000, paidAmount: 700, remaining: 300,
      paymentType: 'آجل', status: 'مؤكد',
    });
    // The 300 down row (at delivery confirm) and the 400 later-collection row
    await insertCollectionPayment({ client: 'Credit Partial', amount: 300 });
    await insertCollectionPayment({ client: 'Credit Partial', amount: 400 });

    const summary = await getSummaryData();
    expect(summary.totalDebt).toBe(300);
  });
});
