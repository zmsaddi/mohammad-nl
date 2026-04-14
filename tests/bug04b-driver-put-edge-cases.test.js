// BUG-04b: edge-case coverage for /api/deliveries PUT driver branch.
//
// Covers the four gaps identified in the BUG-04 self-review that were
// not addressed by BUG-04 or BUG-04a:
//   1. Null date column → Zod rejects → 400
//   2. Missing id in request body → existing guard fires → 403
//   3. Null total_amount in DB row → preserved as 0, route returns 200
//   4. Wrong-driver path against the rebuilt body → 403, no updateDelivery
//
// Run with:  npx vitest run tests/bug04b-driver-put-edge-cases.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const updateDeliveryMock = vi.fn(async () => {});

let lastUpdateArg = null;
updateDeliveryMock.mockImplementation(async (arg) => {
  lastUpdateArg = arg;
});

vi.mock('@/lib/db', () => ({
  updateDelivery: updateDeliveryMock,
  addDelivery: vi.fn(),
  cancelDelivery: vi.fn(),
  getDeliveries: vi.fn(async () => []),
}));

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(async () => ({ username: 'driver1', role: 'driver' })),
}));

const sqlRows = new Map();
vi.mock('@vercel/postgres', () => ({
  sql: vi.fn(async (_strings, ...values) => {
    const id = values[0];
    return { rows: sqlRows.has(id) ? [sqlRows.get(id)] : [] };
  }),
}));

function buildRequest(body) {
  return { json: async () => body };
}

function baseRow(overrides = {}) {
  return {
    id: 200,
    date: '2026-03-10',
    client_name: 'Ahmed',
    client_phone: '',
    address: '',
    items: 'spare parts',
    total_amount: 1000,
    status: 'جاري التوصيل',
    driver_name: 'driver1',
    assigned_driver: 'driver1',
    notes: '',
    vin: '',
    ...overrides,
  };
}

describe('BUG-04b: driver PUT edge cases', () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    updateDeliveryMock.mockClear();
    lastUpdateArg = null;
    sqlRows.clear();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('null date column in DB row → Zod rejects → 400, updateDelivery not called', async () => {
    sqlRows.set(200, baseRow({ date: null }));

    const { PUT } = await import('../app/api/deliveries/route.js');
    const res = await PUT(buildRequest({
      id: 200,
      status: 'تم التوصيل',
      vin: '',
      items: 'spare parts',
    }));

    expect(res.status).toBe(400);
    expect(updateDeliveryMock).not.toHaveBeenCalled();
  });

  it('missing id in request body → existing-row guard fires → 403, updateDelivery not called', async () => {
    // Intentionally do not populate sqlRows — the lookup with id=undefined
    // will return an empty rows array, tripping the !existing guard.
    const { PUT } = await import('../app/api/deliveries/route.js');
    const res = await PUT(buildRequest({
      // id omitted
      status: 'تم التوصيل',
      vin: '',
      items: 'spare parts',
    }));

    expect(res.status).toBe(403);
    expect(updateDeliveryMock).not.toHaveBeenCalled();
  });

  it('null total_amount in DB row → coerced to 0, route returns 200', async () => {
    sqlRows.set(200, baseRow({ total_amount: null }));

    const { PUT } = await import('../app/api/deliveries/route.js');
    const res = await PUT(buildRequest({
      id: 200,
      status: 'تم التوصيل',
      vin: '',
      items: 'spare parts',
    }));

    expect(res.status).toBe(200);
    expect(updateDeliveryMock).toHaveBeenCalledOnce();
    expect(lastUpdateArg.totalAmount).toBe(0);
  });

  it('wrong driver (assigned_driver !== token.username) → 403 before body is rebuilt', async () => {
    sqlRows.set(200, baseRow({ assigned_driver: 'other_driver' }));

    const { PUT } = await import('../app/api/deliveries/route.js');
    const res = await PUT(buildRequest({
      id: 200,
      status: 'تم التوصيل',
      vin: '',
      items: 'spare parts',
    }));

    expect(res.status).toBe(403);
    expect(updateDeliveryMock).not.toHaveBeenCalled();
  });
});
