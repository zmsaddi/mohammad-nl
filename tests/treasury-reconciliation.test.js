// Treasury — getTreasuryReconciliation math.
// integrityDiff = Σ boxes − Σ movements (must be 0).
// coverage.diff = Σ non-opening movements − net cash from the core ledgers
//                 since the cutoff (≈0 when every flow emitted).
// Uses the module `sql`; mock returns canned per-query sums.
//
// Run with:  npx vitest run tests/treasury-reconciliation.test.js

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  boxesTotal: 1000, opening: 800, activity: 200, total: 1000, cutoff: '2026-05-21',
  payments: 300, supplier: 50, expenses: 30, payouts: 20, distributions: 0, capital: 0,
}));

vi.mock('@vercel/postgres', () => {
  const respond = (text) => {
    if (/to_regclass\('cash_boxes'\)/.test(text)) return { rows: [{ t: 'cash_boxes' }] };
    if (/SUM\(balance\)/.test(text)) return { rows: [{ s: h.boxesTotal }] };
    if (/FILTER \(WHERE kind/.test(text)) return { rows: [{ opening: h.opening, activity: h.activity, total: h.total }] };
    if (/MIN\(date\)/.test(text)) return { rows: [{ d: h.cutoff }] };
    if (/FROM payments WHERE date/.test(text)) return { rows: [{ s: h.payments }] };
    if (/FROM supplier_payments WHERE date/.test(text)) return { rows: [{ s: h.supplier }] };
    if (/FROM expenses WHERE date/.test(text)) return { rows: [{ s: h.expenses }] };
    if (/FROM settlements/.test(text)) return { rows: [{ s: h.payouts }] };
    if (/FROM profit_distributions/.test(text)) return { rows: [{ s: h.distributions }] };
    if (/FROM capital_operations/.test(text)) return { rows: [{ s: h.capital }] };
    return { rows: [] };
  };
  const sql = (strings) => Promise.resolve(respond(strings.join('?')));
  sql.query = async () => ({ rows: [] });
  return { sql, db: { connect: async () => ({ sql, release() {} }) } };
});

beforeEach(() => {
  Object.assign(h, {
    boxesTotal: 1000, opening: 800, activity: 200, total: 1000, cutoff: '2026-05-21',
    payments: 300, supplier: 50, expenses: 30, payouts: 20, distributions: 0, capital: 0,
  });
});

describe('getTreasuryReconciliation', () => {
  it('balanced books → integrity 0 and coverage diff 0', async () => {
    const { getTreasuryReconciliation } = await import('../lib/db.js');
    const r = await getTreasuryReconciliation();
    expect(r.available).toBe(true);
    expect(r.boxesTotal).toBe(1000);
    expect(r.openingTotal).toBe(800);
    expect(r.movementsActivity).toBe(200);
    expect(r.integrityDiff).toBe(0);
    expect(r.coverage.coreNet).toBe(200);   // 300 − 50 − 30 − 20 − 0 + 0
    expect(r.coverage.diff).toBe(0);
  });

  it('a missed money flow shows up as a non-zero coverage diff', async () => {
    h.supplier = 150;                        // more cash left per the ledger than the boxes recorded
    const { getTreasuryReconciliation } = await import('../lib/db.js');
    const r = await getTreasuryReconciliation();
    expect(r.coverage.coreNet).toBe(100);    // 300 − 150 − 30 − 20
    expect(r.coverage.diff).toBe(100);       // movementsActivity 200 − coreNet 100
  });

  it('no opening yet → coverage check is disabled (null), integrity still computed', async () => {
    h.cutoff = null;
    const { getTreasuryReconciliation } = await import('../lib/db.js');
    const r = await getTreasuryReconciliation();
    expect(r.available).toBe(true);
    expect(r.cutoff).toBeNull();
    expect(r.coverage).toBeNull();
    expect(r.integrityDiff).toBe(0);
  });
});
