// RBAC lock for GET /api/treasury/movements — the per-box money-movement ledger.
// Money privacy must be enforced server-side: a viewer may only read a box that
// is within their getCashBoxesForViewer scope (admin = any, manager = own +
// drivers', driver = own). The UI hides other tabs, but this test guarantees
// the API itself refuses out-of-scope boxes, so a crafted request can't leak
// another person's cash trail.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getCashBoxesForViewerMock = vi.fn();
const getBoxMovementsMock = vi.fn(async () => [{ id: 1, kind: 'collection', signed_amount: 100, running_balance: 100 }]);

vi.mock('@/lib/db', () => ({
  getCashBoxesForViewer: (...a) => getCashBoxesForViewerMock(...a),
  getBoxMovements: (...a) => getBoxMovementsMock(...a),
}));

const getTokenMock = vi.fn();
vi.mock('next-auth/jwt', () => ({ getToken: (...a) => getTokenMock(...a) }));

let GET;
beforeEach(async () => {
  vi.clearAllMocks();
  getBoxMovementsMock.mockResolvedValue([{ id: 1, kind: 'collection', signed_amount: 100, running_balance: 100 }]);
  const mod = await import('@/app/api/treasury/movements/route.js');
  GET = mod.GET;
});
afterEach(() => vi.resetModules());

const req = (boxId) => ({ url: `http://localhost/api/treasury/movements?boxId=${boxId}` });

describe('GET /api/treasury/movements — viewer-scoped money privacy', () => {
  it('admin can read a box within scope', async () => {
    getTokenMock.mockResolvedValueOnce({ username: 'admin', role: 'admin' });
    getCashBoxesForViewerMock.mockResolvedValueOnce([{ id: 5 }, { id: 1 }]);
    const res = await GET(req(5));
    expect(res.status).toBe(200);
    expect(getBoxMovementsMock).toHaveBeenCalledWith(5);
  });

  it('driver can read their OWN box', async () => {
    getTokenMock.mockResolvedValueOnce({ username: 'driver1', role: 'driver' });
    getCashBoxesForViewerMock.mockResolvedValueOnce([{ id: 1 }]);
    const res = await GET(req(1));
    expect(res.status).toBe(200);
    expect(getBoxMovementsMock).toHaveBeenCalledWith(1);
  });

  it('driver is BLOCKED (403) from a box outside their scope', async () => {
    getTokenMock.mockResolvedValueOnce({ username: 'driver1', role: 'driver' });
    getCashBoxesForViewerMock.mockResolvedValueOnce([{ id: 1 }]); // own only
    const res = await GET(req(2));
    expect(res.status).toBe(403);
    expect(getBoxMovementsMock).not.toHaveBeenCalled();
  });

  it('manager is BLOCKED (403) from a box outside their scope', async () => {
    getTokenMock.mockResolvedValueOnce({ username: 'm1', role: 'manager' });
    getCashBoxesForViewerMock.mockResolvedValueOnce([{ id: 1 }, { id: 3 }]); // own + drivers'
    const res = await GET(req(9));
    expect(res.status).toBe(403);
    expect(getBoxMovementsMock).not.toHaveBeenCalled();
  });

  it('seller is rejected 403 by the role gate (no treasury access)', async () => {
    getTokenMock.mockResolvedValueOnce({ username: 's1', role: 'seller' });
    const res = await GET(req(1));
    expect(res.status).toBe(403);
    expect(getCashBoxesForViewerMock).not.toHaveBeenCalled();
    expect(getBoxMovementsMock).not.toHaveBeenCalled();
  });

  it('unauthenticated is rejected 401', async () => {
    getTokenMock.mockResolvedValueOnce(null);
    const res = await GET(req(1));
    expect(res.status).toBe(401);
    expect(getBoxMovementsMock).not.toHaveBeenCalled();
  });

  it('invalid boxId is rejected 400', async () => {
    getTokenMock.mockResolvedValueOnce({ username: 'admin', role: 'admin' });
    const res = await GET(req('abc'));
    expect(res.status).toBe(400);
    expect(getBoxMovementsMock).not.toHaveBeenCalled();
  });
});
