// Treasury (Phase 1) — unit tests for the funding/handover dual-confirm
// state machine (initiateHandoverInTx / confirmHandoverInTx / rejectHandoverInTx).
// Mocked client, no real DB (same approach as bug08 / emitCashMovement tests).
//
// Run with:  npx vitest run tests/treasury-handover.test.js

import { describe, it, expect, vi } from 'vitest';

vi.mock('@vercel/postgres', () => ({
  sql: Object.assign(async () => ({ rows: [] }), { query: async () => ({ rows: [] }) }),
}));

// Records calls; answers box-resolution + handover-fetch SELECTs from canned data.
function buildMockClient({ boxId = 9, handoverRow = null } = {}) {
  const calls = [];
  const client = {
    sql: async (strings, ...values) => {
      const text = strings.join('?');
      calls.push({ text, values });
      if (/FROM cash_boxes WHERE owner_username/.test(text)) return { rows: [{ id: boxId }] };
      if (/FROM cash_boxes WHERE type = 'main'/.test(text)) return { rows: [{ id: boxId }] };
      if (/FROM cash_handovers WHERE id/.test(text)) return { rows: handoverRow ? [handoverRow] : [] };
      if (/INSERT INTO cash_handovers/.test(text)) return { rows: [{ id: 100 }] };
      return { rows: [] };
    },
  };
  return { client, calls };
}
const re = (calls, pattern) => calls.filter((c) => pattern.test(c.text));

describe('initiateHandoverInTx', () => {
  it('throws when treasury is disabled', async () => {
    delete process.env.TREASURY_ENABLED;
    const { initiateHandoverInTx } = await import('../lib/db.js');
    const { client } = buildMockClient();
    await expect(initiateHandoverInTx(client, {
      fromOwner: 'driver1', toGeneral: true, amount: 100, initiatedBy: 'driver1',
    })).rejects.toThrow(/غير مفعّل/);
  });

  it('rejects a non-positive amount', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { initiateHandoverInTx } = await import('../lib/db.js');
    const { client } = buildMockClient();
    await expect(initiateHandoverInTx(client, {
      fromOwner: 'driver1', toGeneral: true, amount: 0, initiatedBy: 'driver1',
    })).rejects.toThrow(/أكبر من صفر/);
    delete process.env.TREASURY_ENABLED;
  });

  it('creates a pending handover (no balance moves)', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { initiateHandoverInTx } = await import('../lib/db.js');
    // distinct box ids for from (owner) and to (general): mock returns same id,
    // so use explicit ids to avoid the same-box guard.
    const { client, calls } = buildMockClient();
    const res = await initiateHandoverInTx(client, {
      fromBoxId: 5, toBoxId: 1, amount: 250, method: 'كاش', kind: 'handover', initiatedBy: 'driver1',
    });
    expect(res.id).toBe(100);
    expect(re(calls, /INSERT INTO cash_handovers/)).toHaveLength(1);
    // no balance updates on initiate
    expect(re(calls, /UPDATE cash_boxes SET balance/)).toHaveLength(0);
    delete process.env.TREASURY_ENABLED;
  });

  it('refuses transfer to the same box', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { initiateHandoverInTx } = await import('../lib/db.js');
    const { client } = buildMockClient();
    await expect(initiateHandoverInTx(client, {
      fromBoxId: 7, toBoxId: 7, amount: 100, initiatedBy: 'admin',
    })).rejects.toThrow(/نفس الصندوق/);
    delete process.env.TREASURY_ENABLED;
  });
});

describe('confirmHandoverInTx', () => {
  it('throws when treasury is disabled', async () => {
    delete process.env.TREASURY_ENABLED;
    const { confirmHandoverInTx } = await import('../lib/db.js');
    const { client } = buildMockClient();
    await expect(confirmHandoverInTx(client, 100, 'admin')).rejects.toThrow(/غير مفعّل/);
  });

  it('refuses a handover that is not pending', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { confirmHandoverInTx } = await import('../lib/db.js');
    const { client } = buildMockClient({ handoverRow: { id: 100, status: 'confirmed', from_box_id: 5, to_box_id: 1, amount: 250, method: 'كاش', kind: 'handover' } });
    await expect(confirmHandoverInTx(client, 100, 'admin')).rejects.toThrow(/غير معلّق/);
    delete process.env.TREASURY_ENABLED;
  });

  it('moves balances both ways and marks confirmed on a pending handover', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { confirmHandoverInTx } = await import('../lib/db.js');
    const { client, calls } = buildMockClient({ handoverRow: { id: 100, status: 'pending', from_box_id: 5, to_box_id: 1, amount: 250, method: 'كاش', kind: 'handover' } });
    const res = await confirmHandoverInTx(client, 100, 'admin');
    expect(res.success).toBe(true);
    // two movement rows + two balance updates
    expect(re(calls, /INSERT INTO cash_movements/)).toHaveLength(2);
    const upd = re(calls, /UPDATE cash_boxes SET balance/);
    expect(upd).toHaveLength(2);
    // from box (5) debited (balance - 250), to box (1) credited (balance + 250).
    // The sign lives in the SQL text; the bound value is the positive amount.
    expect(upd.some((c) => /balance = balance - /.test(c.text) && c.values.includes(5))).toBe(true);
    expect(upd.some((c) => /balance = balance \+ /.test(c.text) && c.values.includes(1))).toBe(true);
    // status flipped to confirmed
    expect(re(calls, /UPDATE cash_handovers SET status = 'confirmed'/).length).toBeGreaterThanOrEqual(1);
    delete process.env.TREASURY_ENABLED;
  });
});

describe('rejectHandoverInTx', () => {
  it('voids a pending handover without moving balances', async () => {
    const { rejectHandoverInTx } = await import('../lib/db.js');
    const { client, calls } = buildMockClient({ handoverRow: { id: 100, status: 'pending' } });
    const res = await rejectHandoverInTx(client, 100, 'admin');
    expect(res.success).toBe(true);
    expect(re(calls, /UPDATE cash_boxes SET balance/)).toHaveLength(0);
    expect(re(calls, /INSERT INTO cash_movements/)).toHaveLength(0);
  });

  it('refuses to reject a non-pending handover', async () => {
    const { rejectHandoverInTx } = await import('../lib/db.js');
    const { client } = buildMockClient({ handoverRow: { id: 100, status: 'confirmed' } });
    await expect(rejectHandoverInTx(client, 100, 'admin')).rejects.toThrow(/غير معلّق/);
  });
});
