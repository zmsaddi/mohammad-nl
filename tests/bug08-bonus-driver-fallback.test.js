// BUG-08: calculateBonusInTx must NOT silently fall back to the caller-passed
// driverUsername when the deliveries row lookup returns empty or has no
// assigned_driver. It must throw instead.
//
// Previous behavior at lib/db.js:1747 was:
//     const confirmedDriver = delRow[0]?.assigned_driver || driverUsername;
// which silently paid the bonus to whatever the caller guessed. Because this
// code path is only reached after a FOR-UPDATE-protected confirm, an empty
// delRow at this point is a broken invariant. Loud failure is better than
// silent miscrediting of a money row.
//
// Run with:  npx vitest run tests/bug08-bonus-driver-fallback.test.js

import { describe, it, expect, vi } from 'vitest';

// Mock @vercel/postgres so that importing lib/db.js does not require a real DB
// connection. We only need the module-level `sql` export to be a no-op; the
// actual function-under-test uses the `client` parameter passed in, which we
// construct manually below.
vi.mock('@vercel/postgres', () => ({
  sql: Object.assign(
    async () => ({ rows: [] }),
    { query: async () => ({ rows: [] }) },
  ),
}));

// Build a mock `client` whose `.sql` is a tagged-template-like function that
// returns canned rows keyed by the order of calls. `calculateBonusInTx` makes,
// in order for the BUG-08 trigger scenario:
//   1. SELECT * FROM settings          → []    (fall back to hardcoded defaults)
//   2. SELECT * FROM sales WHERE id=?  → one sale row with empty created_by
//   3. (seller block skipped because created_by is empty)
//   4. SELECT assigned_driver FROM deliveries WHERE id=?  → []  ← the trigger
// At step 4, the function must throw.
function buildMockClient(responses) {
  let callIndex = 0;
  return {
    sql: async (_strings, ..._values) => {
      const resp = responses[callIndex] ?? { rows: [] };
      callIndex++;
      return resp;
    },
  };
}

describe('BUG-08: calculateBonusInTx driver fallback is now an explicit throw', () => {
  it('throws when the deliveries row is missing an assigned_driver', async () => {
    const { calculateBonusInTx } = await import('../lib/db.js');

    const client = buildMockClient([
      { rows: [] }, // settings
      { rows: [{
        id: 1,
        created_by: '',              // skips seller block entirely
        item: 'test-bike',
        quantity: 1,
        unit_price: 1000,
        recommended_price: 1000,
      }] },                          // sales
      { rows: [] },                  // deliveries — BUG-08 trigger: empty
    ]);

    await expect(
      calculateBonusInTx(client, 1, 1, 'some-stale-driver-name')
    ).rejects.toThrow(/requires a confirmed delivery row/);
  });

  it('throws when the deliveries row exists but assigned_driver is empty string', async () => {
    const { calculateBonusInTx } = await import('../lib/db.js');

    const client = buildMockClient([
      { rows: [] }, // settings
      { rows: [{
        id: 1,
        created_by: '',
        item: 'test-bike',
        quantity: 1,
        unit_price: 1000,
        recommended_price: 1000,
      }] },
      { rows: [{ assigned_driver: '' }] }, // BUG-08 trigger: empty string
    ]);

    await expect(
      calculateBonusInTx(client, 1, 1, 'some-stale-driver-name')
    ).rejects.toThrow(/requires a confirmed delivery row/);
  });
});
