// BUG-05: bounded query window on /api/summary for sellers.
//
// Proves that:
//   1. A seller with no prior settlement gets a 90-day fallback window
//      applied to BOTH sales and bonuses queries.
//   2. A seller with a prior settlement gets from = last-settlement-date
//      applied to BOTH sales and bonuses queries.
//   3. A user-supplied from/to overrides the default.
//   4. An invalid date format returns 400 before touching the DB.
//   5. Admin and manager paths are unchanged (still call getSummaryData).
//
// Run with:  npx vitest run tests/bug05-summary-date-window.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getSummaryDataMock = vi.fn(async () => ({ ok: true }));

vi.mock('@/lib/db', () => ({
  getSummaryData: getSummaryDataMock,
}));

// getToken is re-mocked per-test to switch roles.
const getTokenMock = vi.fn();
vi.mock('next-auth/jwt', () => ({
  getToken: (...args) => getTokenMock(...args),
}));

// Capture every sql call as { text, values } so assertions can inspect
// exactly which queries ran and what args they got. Also route responses
// based on the template text so settlements/sales/bonuses return the
// right shape.
const sqlCalls = [];
let settlementsRows = [];
let salesRows = [];
let bonusesRows = [];

vi.mock('@vercel/postgres', () => ({
  sql: vi.fn(async (strings, ...values) => {
    const text = strings.join('?');
    sqlCalls.push({ text, values });
    if (/FROM settlements/i.test(text)) return { rows: settlementsRows };
    if (/FROM sales/i.test(text))       return { rows: salesRows };
    if (/FROM bonuses/i.test(text))     return { rows: bonusesRows };
    return { rows: [] };
  }),
}));

function buildRequest(url) {
  return { url };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

describe('BUG-05: seller summary date window', () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getSummaryDataMock.mockClear();
    sqlCalls.length = 0;
    settlementsRows = [];
    salesRows = [];
    bonusesRows = [];
    getTokenMock.mockReset();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('seller with no prior settlement → 90-day fallback window applied to sales AND bonuses', async () => {
    getTokenMock.mockResolvedValue({ username: 'seller1', role: 'seller' });
    // settlementsRows already [] → MAX(date) returns [{ last_date: null }] in PG;
    // the route resolves null/undefined via `|| null` so fallback fires.
    settlementsRows = [{ last_date: null }];

    const { GET } = await import('../app/api/summary/route.js');
    const res = await GET(buildRequest('http://localhost/api/summary'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sellerView).toBe(true);
    expect(body.window.defaultSource).toBe('ninety-day-fallback');
    expect(body.window.from).toBe(daysAgoISO(90));
    expect(body.window.to).toBe(todayISO());

    // Assert the sales and bonuses queries both received the same window.
    const salesCall = sqlCalls.find((c) => /FROM sales/i.test(c.text));
    const bonusesCall = sqlCalls.find((c) => /FROM bonuses/i.test(c.text));
    expect(salesCall).toBeTruthy();
    expect(bonusesCall).toBeTruthy();
    // values order for sales: [username, from, to]
    expect(salesCall.values).toEqual(['seller1', daysAgoISO(90), todayISO()]);
    expect(bonusesCall.values).toEqual(['seller1', daysAgoISO(90), todayISO()]);
  });

  it('seller with prior settlement → from = last-settlement-date', async () => {
    getTokenMock.mockResolvedValue({ username: 'seller1', role: 'seller' });
    settlementsRows = [{ last_date: '2026-02-01' }];

    const { GET } = await import('../app/api/summary/route.js');
    const res = await GET(buildRequest('http://localhost/api/summary'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.window.defaultSource).toBe('last-settlement');
    expect(body.window.from).toBe('2026-02-01');
    expect(body.window.to).toBe(todayISO());

    const salesCall = sqlCalls.find((c) => /FROM sales/i.test(c.text));
    const bonusesCall = sqlCalls.find((c) => /FROM bonuses/i.test(c.text));
    expect(salesCall.values).toEqual(['seller1', '2026-02-01', todayISO()]);
    expect(bonusesCall.values).toEqual(['seller1', '2026-02-01', todayISO()]);
  });

  it('user-supplied from/to overrides the default', async () => {
    getTokenMock.mockResolvedValue({ username: 'seller1', role: 'seller' });
    settlementsRows = [{ last_date: '2026-02-01' }]; // should be ignored

    const { GET } = await import('../app/api/summary/route.js');
    const res = await GET(buildRequest('http://localhost/api/summary?from=2026-03-01&to=2026-03-31'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.window.from).toBe('2026-03-01');
    expect(body.window.to).toBe('2026-03-31');
    expect(body.window.defaultSource).toBeNull();

    // settlements MAX(date) should NOT have been queried when from is supplied.
    const settlementsCall = sqlCalls.find((c) => /FROM settlements/i.test(c.text));
    expect(settlementsCall).toBeUndefined();
  });

  it('invalid from format → 400 before any DB call', async () => {
    getTokenMock.mockResolvedValue({ username: 'seller1', role: 'seller' });

    const { GET } = await import('../app/api/summary/route.js');
    const res = await GET(buildRequest('http://localhost/api/summary?from=2026-3-1'));

    expect(res.status).toBe(400);
    expect(sqlCalls.length).toBe(0);
  });

  it('admin path is unchanged — delegates to getSummaryData with raw from/to', async () => {
    getTokenMock.mockResolvedValue({ username: 'admin', role: 'admin' });

    const { GET } = await import('../app/api/summary/route.js');
    const res = await GET(buildRequest('http://localhost/api/summary?from=2026-01-01&to=2026-12-31'));

    expect(res.status).toBe(200);
    expect(getSummaryDataMock).toHaveBeenCalledWith('2026-01-01', '2026-12-31');
    // Seller SQL path must not have run.
    expect(sqlCalls.length).toBe(0);
  });
});
