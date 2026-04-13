// BUG-03: production env gate on POST /api/init {action:"reset"}.
//
// Proves that even with a valid admin token and the correct confirm phrase,
// a production runtime (or a missing ALLOW_DB_RESET flag) blocks the reset
// branch with 403 and NEVER calls resetDatabase().
//
// Run with:  npx vitest run tests/bug03-init-reset-gate.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const resetDatabaseMock = vi.fn(async () => {});
const initDatabaseMock = vi.fn(async () => {});

vi.mock('@/lib/db', () => ({
  resetDatabase: resetDatabaseMock,
  initDatabase: initDatabaseMock,
}));

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(async () => ({ username: 'admin', role: 'admin' })),
}));

vi.mock('@vercel/postgres', () => ({
  sql: vi.fn(async () => ({ rows: [] })),
}));

function buildRequest(body) {
  return {
    json: async () => body,
  };
}

describe('BUG-03: /api/init reset production gate', () => {
  let errorSpy;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllow = process.env.ALLOW_DB_RESET;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    resetDatabaseMock.mockClear();
    initDatabaseMock.mockClear();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.clearAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllow === undefined) delete process.env.ALLOW_DB_RESET;
    else process.env.ALLOW_DB_RESET = originalAllow;
  });

  it('blocks reset with 403 when NODE_ENV=production (even with ALLOW_DB_RESET=true)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DB_RESET = 'true';

    const { POST } = await import('../app/api/init/route.js');
    const res = await POST(buildRequest({
      action: 'reset',
      confirm: 'احذف كل البيانات نهائيا',
    }));

    expect(res.status).toBe(403);
    expect(resetDatabaseMock).not.toHaveBeenCalled();
  });

  it('blocks reset with 403 when ALLOW_DB_RESET is unset', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_DB_RESET;

    const { POST } = await import('../app/api/init/route.js');
    const res = await POST(buildRequest({
      action: 'reset',
      confirm: 'احذف كل البيانات نهائيا',
    }));

    expect(res.status).toBe(403);
    expect(resetDatabaseMock).not.toHaveBeenCalled();
  });

  it('blocks reset with 403 when ALLOW_DB_RESET is literally "false"', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DB_RESET = 'false';

    const { POST } = await import('../app/api/init/route.js');
    const res = await POST(buildRequest({
      action: 'reset',
      confirm: 'احذف كل البيانات نهائيا',
    }));

    expect(res.status).toBe(403);
    expect(resetDatabaseMock).not.toHaveBeenCalled();
  });

  it('allows reset in dev with ALLOW_DB_RESET=true and correct confirm phrase', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DB_RESET = 'true';

    const { POST } = await import('../app/api/init/route.js');
    const res = await POST(buildRequest({
      action: 'reset',
      confirm: 'احذف كل البيانات نهائيا',
    }));

    expect(res.status).toBe(200);
    expect(resetDatabaseMock).toHaveBeenCalledOnce();
  });

  it('still rejects reset in dev with ALLOW_DB_RESET=true but wrong confirm phrase', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DB_RESET = 'true';

    const { POST } = await import('../app/api/init/route.js');
    const res = await POST(buildRequest({
      action: 'reset',
      confirm: 'oops',
    }));

    expect(res.status).toBe(400);
    expect(resetDatabaseMock).not.toHaveBeenCalled();
  });
});
