// Treasury (Phase 1, P1b) — unit tests for emitCashMovement.
//
// emitCashMovement(client, opts) is the single primitive every money flow
// calls to record a shadow cash movement + update a box balance. These tests
// inject a mock `client` (no real DB, same approach as the bug08 test) and
// verify the behaviours that matter for money correctness:
//   1. STRICT no-op when TREASURY_ENABLED is not 'true' (zero queries).
//   2. Box resolution: owner's custody box, the shared general box, or skip.
//   3. Idempotency: a movement already recorded for (source,kind,box) is skipped.
//   4. On a fresh emit: inserts the movement AND updates the box balance by
//      the signed amount.
//
// Run with:  npx vitest run tests/treasury-emit-cash-movement.test.js

import { describe, it, expect, vi } from 'vitest';

vi.mock('@vercel/postgres', () => ({
  sql: Object.assign(async () => ({ rows: [] }), { query: async () => ({ rows: [] }) }),
}));

// Mock client: records every client.sql call and returns canned rows keyed by
// the query shape. `boxRows` answers the box-resolution SELECT; `dupRows`
// answers the idempotency pre-check; INSERT/UPDATE return nothing.
function buildMockClient({ boxRows = [], dupRows = [] } = {}) {
  const calls = [];
  const client = {
    sql: async (strings, ...values) => {
      const text = strings.join('?');
      calls.push({ text, values });
      if (/FROM cash_boxes WHERE owner_username/.test(text)) return { rows: boxRows };
      if (/FROM cash_boxes WHERE type = 'main'/.test(text)) return { rows: boxRows };
      if (/FROM cash_movements/.test(text)) return { rows: dupRows };
      return { rows: [] }; // INSERT cash_movements / UPDATE cash_boxes
    },
  };
  return { client, calls };
}
const inserted = (calls) => calls.filter((c) => /INSERT INTO cash_movements/.test(c.text));
const balanceUpdates = (calls) => calls.filter((c) => /UPDATE cash_boxes SET balance/.test(c.text));

describe('emitCashMovement', () => {
  it('is a strict no-op when TREASURY_ENABLED is off (zero queries)', async () => {
    delete process.env.TREASURY_ENABLED;
    const { emitCashMovement } = await import('../lib/db.js');
    const { client, calls } = buildMockClient({ boxRows: [{ id: 5 }] });
    await emitCashMovement(client, {
      ownerUsername: 'driver1', signedAmount: 100, kind: 'collection',
      sourceTable: 'payments', sourceId: 1,
    });
    expect(calls).toHaveLength(0);
  });

  it('skips when sourceId is missing (no stable idempotency key)', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { emitCashMovement } = await import('../lib/db.js');
    const { client, calls } = buildMockClient({ boxRows: [{ id: 5 }] });
    await emitCashMovement(client, {
      ownerUsername: 'driver1', signedAmount: 100, kind: 'collection',
      sourceTable: 'payments', sourceId: null,
    });
    expect(calls).toHaveLength(0);
    delete process.env.TREASURY_ENABLED;
  });

  it('inserts the movement and updates the box balance on a fresh emit', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { emitCashMovement } = await import('../lib/db.js');
    const { client, calls } = buildMockClient({ boxRows: [{ id: 5 }], dupRows: [] });
    await emitCashMovement(client, {
      ownerUsername: 'driver1', signedAmount: 150.5, method: 'كاش', kind: 'collection',
      sourceTable: 'payments', sourceId: 42, createdBy: 'driver1',
    });
    expect(inserted(calls)).toHaveLength(1);
    const upd = balanceUpdates(calls);
    expect(upd).toHaveLength(1);
    expect(upd[0].values).toContain(150.5); // +150.5 …
    expect(upd[0].values).toContain(5);     // … to box 5
    delete process.env.TREASURY_ENABLED;
  });

  it('is idempotent: a movement already recorded for (source,kind,box) is skipped', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { emitCashMovement } = await import('../lib/db.js');
    const { client, calls } = buildMockClient({ boxRows: [{ id: 5 }], dupRows: [{ exists: 1 }] });
    await emitCashMovement(client, {
      ownerUsername: 'driver1', signedAmount: 150, kind: 'collection',
      sourceTable: 'payments', sourceId: 42,
    });
    expect(inserted(calls)).toHaveLength(0);
    expect(balanceUpdates(calls)).toHaveLength(0);
    delete process.env.TREASURY_ENABLED;
  });

  it('skips when the actor has no box (nothing inserted)', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { emitCashMovement } = await import('../lib/db.js');
    const { client, calls } = buildMockClient({ boxRows: [], dupRows: [] });
    await emitCashMovement(client, {
      ownerUsername: 'ghost', signedAmount: 100, kind: 'collection',
      sourceTable: 'payments', sourceId: 7,
    });
    expect(inserted(calls)).toHaveLength(0);
    expect(balanceUpdates(calls)).toHaveLength(0);
    delete process.env.TREASURY_ENABLED;
  });

  it('routes to the shared general box when general:true', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { emitCashMovement } = await import('../lib/db.js');
    const { client, calls } = buildMockClient({ boxRows: [{ id: 1 }], dupRows: [] });
    await emitCashMovement(client, {
      general: true, signedAmount: -500, kind: 'commission_payout',
      sourceTable: 'settlements', sourceId: 9, createdBy: 'admin',
    });
    expect(calls.some((c) => /FROM cash_boxes WHERE type = 'main'/.test(c.text))).toBe(true);
    const upd = balanceUpdates(calls);
    expect(upd).toHaveLength(1);
    expect(upd[0].values).toContain(-500); // payout decrements the general box
    delete process.env.TREASURY_ENABLED;
  });

  it('debits the box on a negative signed amount (expense/payout)', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { emitCashMovement } = await import('../lib/db.js');
    const { client, calls } = buildMockClient({ boxRows: [{ id: 8 }], dupRows: [] });
    await emitCashMovement(client, {
      ownerUsername: 'manager1', signedAmount: -75.25, kind: 'expense',
      sourceTable: 'expenses', sourceId: 3, createdBy: 'manager1',
    });
    expect(inserted(calls)).toHaveLength(1);
    expect(balanceUpdates(calls)[0].values).toContain(-75.25);
    delete process.env.TREASURY_ENABLED;
  });
});
