// BUG-30 mirror: /api/products PUT must reject sell_price < buy_price
// updates. Only fires when sell_price is part of the payload — editing
// notes/category on a product with a legacy bad price state still
// succeeds per the user's explicit decision.
//
// Run with:  npx vitest run tests/bug30-products-put-mirror.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Programmable mock: each test stages the current product row returned
// by the SELECT buy_price lookup. The subsequent UPDATE is a no-op in
// the mock — we only care about the pre-update guard.
const staged = { currentRow: null };

const sqlCallLog = [];

vi.mock('@vercel/postgres', () => ({
  sql: vi.fn(async (strings) => {
    const joined = Array.isArray(strings) ? strings.join('?') : String(strings);
    sqlCallLog.push(joined);
    if (joined.includes('SELECT buy_price')) {
      return { rows: staged.currentRow ? [staged.currentRow] : [] };
    }
    // UPDATE or anything else → no-op success
    return { rows: [] };
  }),
}));

vi.mock('@/lib/db', () => ({
  getProducts: vi.fn(async () => []),
  addProduct: vi.fn(async () => ({ id: 1 })),
  deleteProduct: vi.fn(async () => {}),
}));

vi.mock('@/lib/entity-resolver', () => ({
  invalidateCache: vi.fn(),
}));

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(async () => ({ username: 'admin', role: 'admin' })),
}));

function buildPutRequest(body) {
  return { json: async () => body };
}

describe('BUG-30: /api/products PUT mirror check', () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    staged.currentRow = null;
    sqlCallLog.length = 0;
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('rejects PUT with sell_price < current buy_price', async () => {
    staged.currentRow = { buy_price: 200 };

    const { PUT } = await import('../app/api/products/route.js');
    const res = await PUT(buildPutRequest({ id: 1, sell_price: 150 }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('150');
    expect(body.error).toContain('200');
    expect(body.error).toContain('سعر البيع الموصى');
  });

  it('accepts PUT with sell_price == current buy_price (equality allowed)', async () => {
    staged.currentRow = { buy_price: 200 };

    const { PUT } = await import('../app/api/products/route.js');
    const res = await PUT(buildPutRequest({ id: 1, sell_price: 200 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('accepts PUT with sell_price > current buy_price', async () => {
    staged.currentRow = { buy_price: 200 };

    const { PUT } = await import('../app/api/products/route.js');
    const res = await PUT(buildPutRequest({ id: 1, sell_price: 300 }));
    const body = await res.json();

    expect(res.status).toBe(200);
  });

  it('editing notes only on a legacy-bad-state product still succeeds', async () => {
    // The mirror should NOT fire on an unrelated update, even if the
    // product's existing state would violate the rule. User decision:
    // "don't block admin from editing notes just because the product
    // has a legacy price state."
    staged.currentRow = { buy_price: 200 };  // current state is irrelevant

    const { PUT } = await import('../app/api/products/route.js');
    const res = await PUT(
      buildPutRequest({ id: 1, notes: 'updated description' })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    // The SELECT buy_price query should NOT have been issued at all —
    // the mirror is gated on sell_price being in the payload.
    const selectCalls = sqlCallLog.filter((s) => s.includes('SELECT buy_price'));
    expect(selectCalls.length).toBe(0);
  });

  it('buy_price == 0 on the current row → mirror skipped', async () => {
    // Brand-new product, no purchase history. Admin setting the first
    // sell_price should go through without friction.
    staged.currentRow = { buy_price: 0 };

    const { PUT } = await import('../app/api/products/route.js');
    const res = await PUT(buildPutRequest({ id: 1, sell_price: 100 }));
    const body = await res.json();

    expect(res.status).toBe(200);
  });

  it('sell_price == 0 in the payload → mirror skipped (unsetting the recommended)', async () => {
    // Admin may want to clear a product's recommended price (set to 0).
    // This should NOT trigger the mirror, because the rule is phrased as
    // "if you're setting a non-zero sell_price, it must be >= buy_price."
    // Setting sell_price=0 is the "no recommendation" state.
    staged.currentRow = { buy_price: 200 };

    const { PUT } = await import('../app/api/products/route.js');
    const res = await PUT(buildPutRequest({ id: 1, sell_price: 0 }));
    const body = await res.json();

    expect(res.status).toBe(200);
  });

  it('missing id → 400 (preserves existing gate)', async () => {
    const { PUT } = await import('../app/api/products/route.js');
    const res = await PUT(buildPutRequest({ sell_price: 200 }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('معرف');
  });
});
