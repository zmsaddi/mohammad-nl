// v1.1 S1.2 — F-065 regression test (FALSE POSITIVE lockdown)
//
// The v1.1 comprehensive study (Domain 5 audit agent) reported that
// POST /api/settlements had no role check. Manual code inspection
// at commit 427f2c3 proved this wrong — app/api/settlements/route.js:26
// already enforces `token.role !== 'admin'`. The audit agent missed
// the line.
//
// This test locks the behavior so a future refactor cannot silently
// re-open the hole. For each role other than admin, POST must return
// 403. For admin, POST must proceed to the addSettlement mock.
//
// Pattern follows tests/bug04-deliveries-driver-put.test.js: mock
// @/lib/db, mock next-auth/jwt, spin up the route handler, assert
// status + side effects.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const addSettlementMock = vi.fn(async () => 42);
const getSettlementsMock = vi.fn(async () => []);

vi.mock('@/lib/db', () => ({
  addSettlement: addSettlementMock,
  getSettlements: getSettlementsMock,
}));

const getTokenMock = vi.fn();
vi.mock('next-auth/jwt', () => ({
  getToken: (...args) => getTokenMock(...args),
}));

// Dynamic import so the mocks above take effect before the module under test
// evaluates its imports.
let POST;
beforeEach(async () => {
  vi.clearAllMocks();
  addSettlementMock.mockResolvedValue(42);
  const mod = await import('@/app/api/settlements/route.js');
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
  type: 'seller_payout',
  username: 'yasin',
  description: 'test payout',
  amount: 100,
  notes: '',
};

describe('F-065 regression — POST /api/settlements admin-only gate', () => {
  it('admin can POST and reaches addSettlement', async () => {
    getTokenMock.mockResolvedValueOnce({ username: 'admin', role: 'admin' });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    expect(addSettlementMock).toHaveBeenCalledTimes(1);
    expect(addSettlementMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'seller_payout', username: 'yasin', settledBy: 'admin',
    }));
  });

  it('manager is rejected 403', async () => {
    getTokenMock.mockResolvedValueOnce({ username: 'manager1', role: 'manager' });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    expect(addSettlementMock).not.toHaveBeenCalled();
  });

  it('seller is rejected 403', async () => {
    getTokenMock.mockResolvedValueOnce({ username: 'seller1', role: 'seller' });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    expect(addSettlementMock).not.toHaveBeenCalled();
  });

  it('driver is rejected 403 — the privilege escalation the agent feared', async () => {
    getTokenMock.mockResolvedValueOnce({ username: 'driver1', role: 'driver' });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    expect(addSettlementMock).not.toHaveBeenCalled();
  });

  // v1.1 S4.7 — requireAuth returns 401 for unauthenticated (no token),
  // 403 for wrong role. Pre-S4.7 the route returned 403 for both.
  it('unauthenticated caller is rejected 401', async () => {
    getTokenMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    expect(addSettlementMock).not.toHaveBeenCalled();
  });
});
