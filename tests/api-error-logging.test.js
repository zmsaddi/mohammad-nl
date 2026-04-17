// BUG-02: representative route forced-error test.
//
// Proves that the silent-catch → console.error rewrite actually fires
// when a dependency throws. One representative route is enough per the
// BUG-02 spec — we pick `/api/bonuses` because it has the simplest
// dependency surface (single DB call, single handler).
//
// Run with:  npx vitest run tests/api-error-logging.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock both modules the route depends on. @/lib/db for getBonuses, and
// next-auth/jwt for getToken. Must be set up before the dynamic import
// of the route so the module graph sees the mocks.
vi.mock('@/lib/db', () => ({
  getBonuses: vi.fn(async () => {
    throw new Error('forced DB failure (BUG-02 test)');
  }),
}));

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(async () => ({ username: 'admin', role: 'admin' })),
}));

describe('BUG-02: forced-error logging on /api/bonuses', () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('catches a thrown DB error, logs with [bonuses GET] prefix, returns 500', async () => {
    // Dynamic import so the vi.mock() calls above take effect on the
    // route's dependency graph before it resolves.
    const { GET } = await import('../app/api/bonuses/route.js');

    // Minimal Request stand-in — the route only uses it as an argument
    // to getToken(), which is mocked above to ignore it.
    const request = new Request('http://localhost/api/bonuses');
    const response = await GET(request);

    expect(response.status).toBe(500);

    // The Arabic user-facing error message must still be returned intact
    const body = await response.json();
    expect(body.error).toBe('خطأ في جلب البيانات');

    // v1.1 S4.7 F-057 unified the logging surface via lib/api-errors.js.
    // The pre-F-057 test expected `console.error('[bonuses] GET:', Error)`
    // (two args). The new helper formats the prefix + message as a single
    // interpolated string, so the assertion now checks for that single
    // argument containing both the '[bonuses GET]' prefix and the forced
    // error message. See lib/api-errors.js:38 for the log template.
    expect(errorSpy).toHaveBeenCalled();
    const firstCall = errorSpy.mock.calls[0];
    expect(firstCall[0]).toContain('[bonuses GET]');
    expect(firstCall[0]).toContain('forced DB failure (BUG-02 test)');
  });
});
