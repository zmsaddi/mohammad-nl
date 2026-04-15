// v1.1 S1.3 — F-066 regression test (FALSE POSITIVE lockdown)
//
// Domain 5 audit agent reported POST /api/expenses had no role check.
// Manual inspection at commit 427f2c3 proved this wrong —
// app/api/expenses/route.js:26 enforces ['admin','manager'] only.
// Drivers and sellers return 403.
//
// Lock the behavior with a regression test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const addExpenseMock = vi.fn(async () => 7);
const getExpensesMock = vi.fn(async () => []);
const deleteExpenseMock = vi.fn(async () => {});
const updateExpenseMock = vi.fn(async () => {});

vi.mock('@/lib/db', () => ({
  addExpense: addExpenseMock,
  getExpenses: getExpensesMock,
  deleteExpense: deleteExpenseMock,
  updateExpense: updateExpenseMock,
}));

const getTokenMock = vi.fn();
vi.mock('next-auth/jwt', () => ({
  getToken: (...args) => getTokenMock(...args),
}));

let POST;
beforeEach(async () => {
  vi.clearAllMocks();
  addExpenseMock.mockResolvedValue(7);
  const mod = await import('@/app/api/expenses/route.js');
  POST = mod.POST;
});

afterEach(() => {
  vi.resetModules();
});

function makeRequest(body) {
  return { json: async () => body };
}

const validBody = {
  date: '2026-04-15',
  category: 'مكتبية',
  description: 'office supplies',
  amount: 50,
  paymentType: 'كاش',
  notes: '',
};

describe('F-066 regression — POST /api/expenses admin+manager gate', () => {
  it('admin can POST', async () => {
    getTokenMock.mockResolvedValueOnce({ username: 'admin', role: 'admin' });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    expect(addExpenseMock).toHaveBeenCalledTimes(1);
  });

  it('manager can POST', async () => {
    getTokenMock.mockResolvedValueOnce({ username: 'manager1', role: 'manager' });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    expect(addExpenseMock).toHaveBeenCalledTimes(1);
  });

  it('seller is rejected 403', async () => {
    getTokenMock.mockResolvedValueOnce({ username: 'seller1', role: 'seller' });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    expect(addExpenseMock).not.toHaveBeenCalled();
  });

  it('driver is rejected 403', async () => {
    getTokenMock.mockResolvedValueOnce({ username: 'driver1', role: 'driver' });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    expect(addExpenseMock).not.toHaveBeenCalled();
  });

  it('unauthenticated is rejected 401', async () => {
    getTokenMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    expect(addExpenseMock).not.toHaveBeenCalled();
  });
});
