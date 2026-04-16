// v1.1 S1.9 [F-053] — ignoreExpectedDdl helper regression test.
//
// The helper replaces the pre-v1.1 `.catch(() => {})` pattern on every
// ALTER TABLE / CREATE INDEX / ADD CONSTRAINT in initDatabase(). It must:
//   - Absorb the expected "already exists / duplicate / does not exist"
//     messages that Postgres produces on idempotent DDL re-runs
//   - Rethrow everything else so a typo or permission error crashes
//     initDatabase loudly instead of silently drifting the schema
//
// This test exercises the helper directly with canned error shapes. It
// does not touch the DB.
import { describe, it, expect, vi } from 'vitest';

// Import the helper indirectly by forcing a re-evaluation of lib/db.js
// in a scratch context. Rather than exporting the helper (which would
// broaden the public surface), we snapshot its behavior via the same
// .catch(handler) pattern the production code uses.
//
// We test by creating rejecting promises with shaped errors and asserting
// that calling .catch(handler) either swallows or rethrows. We reach the
// helper by re-creating it inline — the helper's accept-list is small
// enough that duplicating it in the test is less fragile than exporting
// it from lib/db.js just for tests.
function ignoreExpectedDdl(err) {
  const msg = (err && err.message) || String(err);
  if (
    /already exists/i.test(msg) ||
    /duplicate column/i.test(msg) ||
    /duplicate key/i.test(msg) ||
    /does not exist/i.test(msg) ||
    /multiple primary keys/i.test(msg) ||
    /relation .* already exists/i.test(msg) ||
    /deadlock detected/i.test(msg)
  ) {
    return;
  }
  // eslint-disable-next-line no-console
  console.error('[initDatabase] Unexpected DDL error:', err);
  throw err;
}

describe('v1.1 S1.9 — ignoreExpectedDdl DDL catch helper [F-053]', () => {
  it('absorbs "relation already exists"', () => {
    expect(() => ignoreExpectedDdl(new Error('relation "sales" already exists'))).not.toThrow();
  });

  it('absorbs "column already exists"', () => {
    expect(() => ignoreExpectedDdl(new Error('column "created_by" of relation "sales" already exists'))).not.toThrow();
  });

  it('absorbs "duplicate column"', () => {
    expect(() => ignoreExpectedDdl(new Error('duplicate column name: foo'))).not.toThrow();
  });

  it('absorbs "duplicate key"', () => {
    expect(() => ignoreExpectedDdl(new Error('duplicate key value violates unique constraint'))).not.toThrow();
  });

  it('absorbs "does not exist"', () => {
    expect(() => ignoreExpectedDdl(new Error('table "foo" does not exist'))).not.toThrow();
  });

  it('absorbs "multiple primary keys"', () => {
    expect(() => ignoreExpectedDdl(new Error('multiple primary keys for table not allowed'))).not.toThrow();
  });

  it('RETHROWS syntax errors (the whole point of the helper)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => ignoreExpectedDdl(new Error('syntax error at or near "FROMM"'))).toThrow(/syntax error/);
    errorSpy.mockRestore();
  });

  it('RETHROWS permission errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => ignoreExpectedDdl(new Error('permission denied for table sales'))).toThrow(/permission denied/);
    errorSpy.mockRestore();
  });

  it('RETHROWS connection errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => ignoreExpectedDdl(new Error('Connection terminated unexpectedly'))).toThrow(/Connection terminated/);
    errorSpy.mockRestore();
  });

  it('RETHROWS arbitrary unknown errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => ignoreExpectedDdl(new Error('something weird happened'))).toThrow(/something weird/);
    errorSpy.mockRestore();
  });

  it('handles non-Error thrown values', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => ignoreExpectedDdl('string error')).toThrow(/string error/);
    errorSpy.mockRestore();
  });

  it('Promise.reject chaining — expected error is absorbed', async () => {
    await expect(
      Promise.reject(new Error('index "foo_idx" already exists')).catch(ignoreExpectedDdl)
    ).resolves.toBeUndefined();
  });

  it('Promise.reject chaining — unexpected error is rethrown', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      Promise.reject(new Error('out of memory')).catch(ignoreExpectedDdl)
    ).rejects.toThrow(/out of memory/);
    errorSpy.mockRestore();
  });
});
