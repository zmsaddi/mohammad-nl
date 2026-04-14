// BUG-04a: VIN preservation on driver confirm.
//
// Proves that an admin-prefilled VIN survives a driver's blank-VIN
// confirmation, and that a driver-supplied VIN still wins when present.
//
// Run with:  npx vitest run tests/bug04a-vin-preservation.test.js

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
    id: 100,
    date: '2026-03-10',
    client_name: 'Ahmed',
    client_phone: '',
    address: '',
    items: 'e-bike model X',
    total_amount: 1000,
    status: 'جاري التوصيل',
    driver_name: 'driver1',
    assigned_driver: 'driver1',
    notes: '',
    vin: '',
    ...overrides,
  };
}

describe('BUG-04a: VIN preservation on driver confirm', () => {
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

  it('preserves admin-prefilled VIN when driver submits blank', async () => {
    sqlRows.set(100, baseRow({ vin: 'ABC123' }));

    const { PUT } = await import('../app/api/deliveries/route.js');
    const res = await PUT(buildRequest({
      id: 100,
      status: 'تم التوصيل',
      vin: '',
      items: 'e-bike model X',
    }));

    expect(res.status).toBe(200);
    expect(lastUpdateArg.vin).toBe('ABC123');
  });

  it('driver-supplied VIN overrides the existing VIN when non-blank', async () => {
    sqlRows.set(100, baseRow({ vin: 'ABC123' }));

    const { PUT } = await import('../app/api/deliveries/route.js');
    const res = await PUT(buildRequest({
      id: 100,
      status: 'تم التوصيل',
      vin: 'XYZ789',
      items: 'e-bike model X',
    }));

    expect(res.status).toBe(200);
    expect(lastUpdateArg.vin).toBe('XYZ789');
  });

  it('no regression: null existing VIN + blank driver VIN → empty string (non-bike item)', async () => {
    // items: 'spare parts' avoids the BUG 3C VIN-required guard for bikes.
    sqlRows.set(100, baseRow({ vin: null, items: 'spare parts' }));

    const { PUT } = await import('../app/api/deliveries/route.js');
    const res = await PUT(buildRequest({
      id: 100,
      status: 'تم التوصيل',
      vin: '',
      items: 'spare parts',
    }));

    expect(res.status).toBe(200);
    expect(lastUpdateArg.vin).toBe('');
  });

  it('no regression: empty-string existing VIN + blank driver VIN → empty string (non-bike item)', async () => {
    sqlRows.set(100, baseRow({ vin: '', items: 'spare parts' }));

    const { PUT } = await import('../app/api/deliveries/route.js');
    const res = await PUT(buildRequest({
      id: 100,
      status: 'تم التوصيل',
      vin: '',
      items: 'spare parts',
    }));

    expect(res.status).toBe(200);
    expect(lastUpdateArg.vin).toBe('');
  });
});
