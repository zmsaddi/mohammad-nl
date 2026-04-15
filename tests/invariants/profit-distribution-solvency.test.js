// v1.1 Sprint 2 F-001 — profit_distribution solvency cap regression.
//
// The v1.0.3 incident that triggered the entire v1.1 study:
//
//   5,700€ distributed against 2,850€ collected. Two groups created
//   18 minutes apart, each distributing 100% of the same period's
//   collected revenue. No check, no decrement, no unique constraint
//   on the period — addProfitDistribution just inserted the rows.
//
// Sprint 2 closes the write-path hole by adding inside withTx:
//   1. pg_advisory_xact_lock(hashtext(period)) — serializes concurrent
//      callers with the same period
//   2. SELECT net collected = collection - refund for the period
//   3. SELECT already-distributed = SUM(profit_distributions.amount)
//      for the exact period tuple
//   4. Reject if baseAmount > (collected - alreadyDistributed) + 0.01
//   5. Recipient eligibility check moved inside the transaction so
//      concurrent toggleUserActive can't race
//
// This file locks the behavior with 8 cases:
//   T1 — single 100% split succeeds when collected >= baseAmount
//   T2 — second call with same period fails when pool would overflow
//   T3 — over-cap on first call rejected immediately
//   T4 — Promise.all race: two concurrent calls totaling exactly the
//        pool both succeed; two totaling more than the pool — exactly
//        one succeeds, one fails
//   T5 — different period tuples are independent (not blocked by lock)
//   T6 — refunds reduce the distributable pool
//   T7 — null period uses all-time pool and contends with other nulls
//   T8 — startDate > endDate rejected immediately
//
// Run with: npx vitest run tests/invariants/profit-distribution-solvency.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import bcryptjs from 'bcryptjs';
import {
  initDatabase,
  addProfitDistribution,
  getProfitDistributions,
} from '../../lib/db.js';

const TRUNCATE_TABLES = [
  'profit_distributions',
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
    VALUES (${username}, ${hash}, ${'PD ' + username}, 'admin', true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = 'admin'
  `;
}

async function seedCollection(amount, date) {
  // Direct INSERT — simulates a confirmed cash-sale collection row.
  // The F-001 cap reads the payments table directly, so the shape
  // just needs to be type='collection' with amount + date.
  await sql`
    INSERT INTO payments (client_name, amount, payment_method, date, type, notes, created_by)
    VALUES ('test', ${amount}, 'كاش', ${date}, 'collection', '', 'test-seed')
  `;
}

async function seedRefund(amount, date) {
  // Cancellation compensating row — negative amount, type='refund'.
  await sql`
    INSERT INTO payments (client_name, amount, payment_method, date, type, notes, created_by)
    VALUES ('test', ${-Math.abs(amount)}, 'كاش', ${date}, 'refund', 'cancel', 'test-seed')
  `;
}

const P1 = { basePeriodStart: '2026-04-01', basePeriodEnd: '2026-04-30' };
const P2 = { basePeriodStart: '2026-05-01', basePeriodEnd: '2026-05-31' };
const P_NULL = { basePeriodStart: null, basePeriodEnd: null };

describe('v1.1 F-001 — profit distribution solvency cap', () => {
  beforeAll(async () => { await initDatabase(); }, 60000);

  beforeEach(async () => {
    await wipe();
    await seedAdmin('pd-admin');
    await seedAdmin('pd-manager');
    // v1.0.x seed: pd-manager is actually role='admin' in seedAdmin
    // for simplicity — the cap doesn't care about role subtype, just
    // that the user passes eligibility. Override to manager:
    await sql`UPDATE users SET role = 'manager' WHERE username = 'pd-manager'`;
  });

  afterAll(async () => {
    await wipe();
    await sql`DELETE FROM users WHERE username IN ('pd-admin', 'pd-manager')`;
  });

  // ─────────────────────────────────────────────────────────────
  // T1 — single 100% split succeeds when pool is sufficient
  // ─────────────────────────────────────────────────────────────
  it('T1 — single 100% split succeeds (2,850€ collected, 2,850€ distributed)', async () => {
    await seedCollection(2850, '2026-04-15');

    const res = await addProfitDistribution({
      baseAmount: 2850,
      recipients: [
        { username: 'pd-admin',   percentage: 50 },
        { username: 'pd-manager', percentage: 50 },
      ],
      ...P1,
      createdBy: 'pd-admin',
    });

    expect(res.recipients_count).toBe(2);
    expect(res.total_distributed).toBe(2850);
    expect(res.cap_collected).toBe(2850);
    expect(res.cap_already_distributed).toBe(0);
    expect(res.cap_remaining_after).toBe(0);

    const rows = await getProfitDistributions();
    const mine = rows.filter(r => r.group_id === res.group_id);
    expect(mine).toHaveLength(1);
    expect(parseFloat(mine[0].base_amount)).toBe(2850);
  });

  // ─────────────────────────────────────────────────────────────
  // T2 — second call for same period fails (the v1.0.3 bug)
  // ─────────────────────────────────────────────────────────────
  it('T2 — second distribution for same period is rejected with Arabic cap error', async () => {
    await seedCollection(2850, '2026-04-15');

    // First call: OK — uses the full pool
    await addProfitDistribution({
      baseAmount: 2850,
      recipients: [{ username: 'pd-admin', percentage: 100 }],
      ...P1,
      createdBy: 'pd-admin',
    });

    // Second call: must fail. Arabic message includes "المبلغ المطلوب"
    // and "يتجاوز المبلغ المتاح للتوزيع".
    await expect(
      addProfitDistribution({
        baseAmount: 2850,
        recipients: [{ username: 'pd-admin', percentage: 100 }],
        ...P1,
        createdBy: 'pd-admin',
      })
    ).rejects.toThrow(/يتجاوز المبلغ المتاح للتوزيع/);

    // Assert no second group landed in the DB
    const rows = await getProfitDistributions();
    expect(rows).toHaveLength(1);
  });

  // ─────────────────────────────────────────────────────────────
  // T3 — first call over-cap rejected immediately
  // ─────────────────────────────────────────────────────────────
  it('T3 — first call over-cap is rejected (1,000€ pool, 1,500€ requested)', async () => {
    await seedCollection(1000, '2026-04-10');
    await expect(
      addProfitDistribution({
        baseAmount: 1500,
        recipients: [{ username: 'pd-admin', percentage: 100 }],
        ...P1,
        createdBy: 'pd-admin',
      })
    ).rejects.toThrow(/يتجاوز المبلغ المتاح للتوزيع/);

    const rows = await getProfitDistributions();
    expect(rows).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────
  // T4 — Promise.all race: lock serializes, one wins one fails
  // ─────────────────────────────────────────────────────────────
  it('T4 — concurrent same-period: exactly one of two overlapping calls succeeds', async () => {
    // Pool 2,000€. Both callers request 1,500€. Only one can fit.
    await seedCollection(2000, '2026-04-20');

    const a = addProfitDistribution({
      baseAmount: 1500,
      recipients: [{ username: 'pd-admin', percentage: 100 }],
      ...P1,
      createdBy: 'pd-admin',
    });
    const b = addProfitDistribution({
      baseAmount: 1500,
      recipients: [{ username: 'pd-manager', percentage: 100 }],
      ...P1,
      createdBy: 'pd-manager',
    });

    const results = await Promise.allSettled([a, b]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected  = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/يتجاوز المبلغ المتاح للتوزيع/);

    const rows = await getProfitDistributions();
    expect(rows).toHaveLength(1);
  });

  it('T4b — concurrent same-period: two halves of the pool both succeed', async () => {
    await seedCollection(2000, '2026-04-20');

    const a = addProfitDistribution({
      baseAmount: 1000,
      recipients: [{ username: 'pd-admin', percentage: 100 }],
      ...P1,
      createdBy: 'pd-admin',
    });
    const b = addProfitDistribution({
      baseAmount: 1000,
      recipients: [{ username: 'pd-manager', percentage: 100 }],
      ...P1,
      createdBy: 'pd-manager',
    });

    const results = await Promise.allSettled([a, b]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(2);

    const rows = await getProfitDistributions();
    expect(rows).toHaveLength(2);
  });

  // ─────────────────────────────────────────────────────────────
  // T5 — different period tuples are independent
  // ─────────────────────────────────────────────────────────────
  it('T5 — different period tuples do not contend on the lock', async () => {
    await seedCollection(2000, '2026-04-15'); // P1 (April)
    await seedCollection(3000, '2026-05-15'); // P2 (May)

    await addProfitDistribution({
      baseAmount: 2000,
      recipients: [{ username: 'pd-admin', percentage: 100 }],
      ...P1,
      createdBy: 'pd-admin',
    });
    await addProfitDistribution({
      baseAmount: 3000,
      recipients: [{ username: 'pd-manager', percentage: 100 }],
      ...P2,
      createdBy: 'pd-manager',
    });

    const rows = await getProfitDistributions();
    expect(rows).toHaveLength(2);
  });

  // ─────────────────────────────────────────────────────────────
  // T6 — refunds reduce the distributable pool
  // ─────────────────────────────────────────────────────────────
  it('T6 — refund rows subtract from the cap (cancelled sale)', async () => {
    await seedCollection(2000, '2026-04-10');
    await seedRefund(500, '2026-04-12'); // net 1,500

    await expect(
      addProfitDistribution({
        baseAmount: 1600, // over the refunded net
        recipients: [{ username: 'pd-admin', percentage: 100 }],
        ...P1,
        createdBy: 'pd-admin',
      })
    ).rejects.toThrow(/يتجاوز المبلغ المتاح للتوزيع/);

    const ok = await addProfitDistribution({
      baseAmount: 1500,
      recipients: [{ username: 'pd-admin', percentage: 100 }],
      ...P1,
      createdBy: 'pd-admin',
    });
    expect(ok.cap_collected).toBe(1500);
    expect(ok.total_distributed).toBe(1500);
  });

  // ─────────────────────────────────────────────────────────────
  // T7 — null period uses the all-time pool
  // ─────────────────────────────────────────────────────────────
  it('T7 — null period bucket uses all-time collected and enforces cap', async () => {
    await seedCollection(500, '2026-04-10');
    await seedCollection(500, '2026-06-20');

    // First null-period call: can distribute up to 1,000 (all-time collected)
    const ok = await addProfitDistribution({
      baseAmount: 800,
      recipients: [{ username: 'pd-admin', percentage: 100 }],
      ...P_NULL,
      createdBy: 'pd-admin',
    });
    expect(ok.cap_collected).toBe(1000);

    // Second null-period call: only 200 left
    await expect(
      addProfitDistribution({
        baseAmount: 300,
        recipients: [{ username: 'pd-admin', percentage: 100 }],
        ...P_NULL,
        createdBy: 'pd-admin',
      })
    ).rejects.toThrow(/يتجاوز المبلغ المتاح للتوزيع/);
  });

  // ─────────────────────────────────────────────────────────────
  // T8 — malformed period range rejected
  // ─────────────────────────────────────────────────────────────
  it('T8 — startDate > endDate rejected with Arabic error', async () => {
    await seedCollection(1000, '2026-04-10');
    await expect(
      addProfitDistribution({
        baseAmount: 500,
        recipients: [{ username: 'pd-admin', percentage: 100 }],
        basePeriodStart: '2026-04-30',
        basePeriodEnd:   '2026-04-01',
        createdBy: 'pd-admin',
      })
    ).rejects.toThrow(/قبل تاريخ النهاية/);
  });
});
