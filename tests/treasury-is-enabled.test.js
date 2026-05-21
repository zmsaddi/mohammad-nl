// Treasury — regression tests for isTreasuryEnabled(client).
//
// Bug: isTreasuryEnabled extracted the tx client's `sql` into a local
// (`const run = client.sql; run\`…\``). @vercel/postgres' transaction client
// exposes `sql` as a CLASS METHOD that needs `this === client`; calling it
// unbound throws, and the function's catch silently returned `false`. Effect
// in production: the settings-backed flag read true in the boxes route (which
// passes no client → uses the standalone `sql`) but false inside every
// transaction — so capital/handover ops were rejected with "نظام الصناديق غير
// مفعّل" and emitCashMovement silently no-op'd even with the treasury ON.
//
// These tests pass a mock client whose `sql` DEPENDS on `this`, with the env
// override unset, so they exercise the exact path the old code broke.
//
// Run with:  npx vitest run tests/treasury-is-enabled.test.js

import { describe, it, expect, vi } from 'vitest';

vi.mock('@vercel/postgres', () => ({
  // Standalone sql (no `this` dependency) — used when no client is passed.
  sql: Object.assign(async () => ({ rows: [{ value: 'false' }] }), { query: async () => ({ rows: [] }) }),
}));

// Faithful stand-in for the @vercel/postgres tx client: `sql` is a method that
// reads `this`. If it is called unbound (the old bug), `this` is undefined and
// the property access throws — which is precisely what the fix prevents.
class MockTxClient {
  constructor(rows) { this._rows = rows; }
  sql() {
    if (!this || !this._rows) throw new TypeError("called unbound: `this` is undefined");
    return Promise.resolve({ rows: this._rows });
  }
}

describe('isTreasuryEnabled', () => {
  it('reads the flag through the tx client without losing `this` (regression)', async () => {
    delete process.env.TREASURY_ENABLED;
    const { isTreasuryEnabled } = await import('../lib/db.js');
    const client = new MockTxClient([{ value: 'true' }]);
    expect(await isTreasuryEnabled(client)).toBe(true);
  });

  it('returns false when the settings flag is not "true"', async () => {
    delete process.env.TREASURY_ENABLED;
    const { isTreasuryEnabled } = await import('../lib/db.js');
    const client = new MockTxClient([{ value: 'false' }]);
    expect(await isTreasuryEnabled(client)).toBe(false);
  });

  it('returns false when no settings row exists', async () => {
    delete process.env.TREASURY_ENABLED;
    const { isTreasuryEnabled } = await import('../lib/db.js');
    const client = new MockTxClient([]);
    expect(await isTreasuryEnabled(client)).toBe(false);
  });

  it('env override short-circuits to true before any DB read', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { isTreasuryEnabled } = await import('../lib/db.js');
    // null client must NOT be dereferenced when the env override is set.
    expect(await isTreasuryEnabled(null)).toBe(true);
    delete process.env.TREASURY_ENABLED;
  });
});
