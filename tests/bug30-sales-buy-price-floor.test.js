// BUG-30: server-side buy_price floor enforcement on /api/sales POST.
//
// The rule: sale.unit_price >= product.buy_price, for all roles, always.
// Error message is role-dependent: admin/manager see the actual cost in
// the message, sellers see vague language (buy_price is sensitive — see
// app/sales/page.js:229-232 for the existing exposure gate).
//
// Run with:  npx vitest run tests/bug30-sales-buy-price-floor.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Programmable mock for @vercel/postgres: each test sets the product row
// the SELECT-buy_price query should return. The mock accepts any sql``
// template-tag call and returns { rows: [...] } from the staged state.
const staged = { productRow: null, addSaleResult: { saleId: 1, deliveryId: 2, refCode: 'SL-TEST' } };

vi.mock('@vercel/postgres', () => ({
  sql: vi.fn(async () => ({
    rows: staged.productRow ? [staged.productRow] : [],
  })),
}));

vi.mock('@/lib/db', () => ({
  getSales: vi.fn(async () => []),
  addSale: vi.fn(async () => staged.addSaleResult),
  deleteSale: vi.fn(async () => {}),
  updateSale: vi.fn(async () => {}),
}));

vi.mock('@/lib/entity-resolver', () => ({
  invalidateCache: vi.fn(),
}));

const tokenMock = { username: 'test-user', role: 'admin' };
vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(async () => tokenMock),
}));

function buildPostRequest(body) {
  return {
    json: async () => body,
    url: 'http://localhost:3000/api/sales',
  };
}

function basePayload(overrides = {}) {
  return {
    date: '2026-04-13',
    clientName: 'Test Client',
    item: 'V20 Pro',
    quantity: 1,
    unitPrice: 150,
    paymentType: 'كاش',
    ...overrides,
  };
}

describe('BUG-30: /api/sales POST buy_price floor', () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    staged.productRow = null;
    tokenMock.role = 'admin';
    tokenMock.username = 'test-admin';
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('admin: unit_price < buy_price → 400 with cost visible in message', async () => {
    staged.productRow = { sell_price: 0, buy_price: 200 };
    tokenMock.role = 'admin';

    const { POST } = await import('../app/api/sales/route.js');
    const res = await POST(buildPostRequest(basePayload({ unitPrice: 150 })));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('سعر التكلفة');
    expect(body.error).toContain('200');  // buy_price visible
    expect(body.error).toContain('خسارة'); // "loss" language
  });

  it('manager: unit_price < buy_price → 400 with cost visible', async () => {
    staged.productRow = { sell_price: 0, buy_price: 200 };
    tokenMock.role = 'manager';

    const { POST } = await import('../app/api/sales/route.js');
    const res = await POST(buildPostRequest(basePayload({ unitPrice: 150 })));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('سعر التكلفة');
    expect(body.error).toContain('200');
  });

  it('seller: unit_price < buy_price → 400 WITHOUT cost in message (privacy)', async () => {
    // sell_price=0 so the existing recommended-price check skips and we
    // land on the BUG-30 check. Seller sees vague language.
    staged.productRow = { sell_price: 0, buy_price: 200 };
    tokenMock.role = 'seller';

    const { POST } = await import('../app/api/sales/route.js');
    const res = await POST(buildPostRequest(basePayload({ unitPrice: 150 })));
    const body = await res.json();

    expect(res.status).toBe(400);
    // Seller-visible message does NOT contain the actual cost
    expect(body.error).not.toContain('200');
    expect(body.error).not.toContain('سعر التكلفة');
    // But DOES contain the vague language
    expect(body.error).toContain('غير مقبول');
  });

  it('admin: unit_price == buy_price → passes (equality allowed)', async () => {
    staged.productRow = { sell_price: 0, buy_price: 200 };
    tokenMock.role = 'admin';

    const { POST } = await import('../app/api/sales/route.js');
    const res = await POST(buildPostRequest(basePayload({ unitPrice: 200 })));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('admin: unit_price > buy_price → passes', async () => {
    staged.productRow = { sell_price: 0, buy_price: 200 };
    tokenMock.role = 'admin';

    const { POST } = await import('../app/api/sales/route.js');
    const res = await POST(buildPostRequest(basePayload({ unitPrice: 300 })));
    const body = await res.json();

    expect(res.status).toBe(200);
  });

  it('admin: product.buy_price == 0 → floor skipped, sale passes', async () => {
    // A brand-new product with no purchase history has buy_price=0.
    // BUG-30 must skip — otherwise admin can never set a first price.
    staged.productRow = { sell_price: 0, buy_price: 0 };
    tokenMock.role = 'admin';

    const { POST } = await import('../app/api/sales/route.js');
    const res = await POST(buildPostRequest(basePayload({ unitPrice: 50 })));
    const body = await res.json();

    expect(res.status).toBe(200);
  });

  it('admin: non-existent product → BUG-30 skips (addSale handles it)', async () => {
    // The product lookup returns zero rows, so neither the seller check
    // nor the BUG-30 check fires. addSale() is responsible for rejecting
    // an unknown item.
    staged.productRow = null;
    tokenMock.role = 'admin';

    const { POST } = await import('../app/api/sales/route.js');
    const res = await POST(buildPostRequest(basePayload({ unitPrice: 50 })));
    const body = await res.json();

    expect(res.status).toBe(200);
  });

  it('seller: sell_price floor takes precedence over buy_price floor', async () => {
    // When sell_price=300 and buy_price=200, a seller trying unitPrice=150
    // should get the recommended-price error (more specific), not the cost
    // floor error.
    staged.productRow = { sell_price: 300, buy_price: 200 };
    tokenMock.role = 'seller';

    const { POST } = await import('../app/api/sales/route.js');
    const res = await POST(buildPostRequest(basePayload({ unitPrice: 150 })));
    const body = await res.json();

    expect(res.status).toBe(400);
    // Recommended-price error, not cost-floor error
    expect(body.error).toContain('السعر الموصى');
    expect(body.error).toContain('300');
  });
});
