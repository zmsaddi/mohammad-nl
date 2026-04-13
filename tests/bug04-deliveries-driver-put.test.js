// BUG-04: driver PUT schema collision in /api/deliveries.
//
// Proves that when a driver confirms delivery, the body that reaches
// updateDelivery() is pure camelCase (no snake_case keys leaked from
// the raw DB row) AND preserves total_amount → totalAmount instead of
// silently zeroing it.
//
// Run with:  npx vitest run tests/bug04-deliveries-driver-put.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const updateDeliveryMock = vi.fn(async () => {});
const getDeliveriesMock = vi.fn(async () => []);

// Capture whatever updateDelivery was last called with so the assertions
// can inspect the exact parsed object.
let lastUpdateArg = null;
updateDeliveryMock.mockImplementation(async (arg) => {
  lastUpdateArg = arg;
});

vi.mock('@/lib/db', () => ({
  updateDelivery: updateDeliveryMock,
  addDelivery: vi.fn(),
  deleteDelivery: vi.fn(),
  getDeliveries: getDeliveriesMock,
}));

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(async () => ({ username: 'driver1', role: 'driver' })),
}));

// The route uses sql`SELECT * FROM deliveries WHERE id = ${id}` as a
// tagged template. Our mock returns a single row keyed on the last
// interpolated arg.
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

describe('BUG-04: driver PUT builds camelCase body, preserves totalAmount', () => {
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

  it('parsed body has zero snake_case keys and preserves total_amount → totalAmount', async () => {
    sqlRows.set(42, {
      id: 42,
      date: '2026-03-10',
      client_name: 'Ahmed',
      client_phone: '+212600000000',
      address: 'Rue de Casa',
      items: 'e-bike model X',
      total_amount: 4500.5,
      status: 'جاري التوصيل',
      driver_name: 'driver1',
      assigned_driver: 'driver1',
      notes: 'rush order',
      vin: '',
    });

    const { PUT } = await import('../app/api/deliveries/route.js');
    const res = await PUT(buildRequest({
      id: 42,
      status: 'تم التوصيل',
      vin: 'VIN123456',
      items: 'e-bike model X',
    }));

    expect(res.status).toBe(200);
    expect(updateDeliveryMock).toHaveBeenCalledOnce();
    expect(lastUpdateArg).toBeTruthy();

    // No snake_case keys leaked through Zod parsing.
    const snakeKeys = Object.keys(lastUpdateArg).filter((k) => k.includes('_'));
    expect(snakeKeys).toEqual([]);

    // totalAmount was preserved, not defaulted to 0.
    expect(lastUpdateArg.totalAmount).toBe(4500.5);

    // status was overwritten to the confirmation value, vin carried through.
    expect(lastUpdateArg.status).toBe('تم التوصيل');
    expect(lastUpdateArg.vin).toBe('VIN123456');

    // camelCase fields carried forward from the existing row.
    expect(lastUpdateArg.clientName).toBe('Ahmed');
    expect(lastUpdateArg.clientPhone).toBe('+212600000000');
    expect(lastUpdateArg.assignedDriver).toBe('driver1');
  });

  it('coerces a JS Date in the DB row to YYYY-MM-DD so Zod accepts it', async () => {
    sqlRows.set(43, {
      id: 43,
      date: new Date('2026-03-15T12:34:56Z'),
      client_name: 'Sara',
      client_phone: '',
      address: '',
      items: 'scooter',
      total_amount: 1200,
      status: 'جاري التوصيل',
      driver_name: 'driver1',
      assigned_driver: 'driver1',
      notes: '',
      vin: '',
    });

    const { PUT } = await import('../app/api/deliveries/route.js');
    const res = await PUT(buildRequest({
      id: 43,
      status: 'تم التوصيل',
      vin: 'VIN999',
      items: 'scooter',
    }));

    expect(res.status).toBe(200);
    expect(lastUpdateArg.date).toBe('2026-03-15');
  });
});
