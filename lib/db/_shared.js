// v1.1 S4.1 — shared infrastructure for all lib/db/* domain modules.
//
// Re-exports @vercel/postgres's `sql` and `db`, plus the transaction
// wrapper, ref-code generator, and DDL-catch helper that every domain
// module needs. Domain modules import from here; the barrel at
// lib/db.js re-exports the union so existing callers don't change.

import { sql, db } from '@vercel/postgres';

// v1.1 S1.9 [F-053] — DDL-catch helper.
// Absorbs expected idempotent DDL outcomes; rethrows everything else.
export function ignoreExpectedDdl(err) {
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

// Generate unique reference code: SL-20260411-001XY, PU-20260411-001XY
export function generateRefCode(prefix) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const ts = String(Date.now()).slice(-6);
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefix}-${date}-${ts}${rand}`;
}

// Transaction wrapper. Every money-moving operation uses this.
export async function withTx(fn) {
  const client = await db.connect();
  try {
    await client.sql`BEGIN`;
    const result = await fn(client);
    await client.sql`COMMIT`;
    return result;
  } catch (err) {
    try { await client.sql`ROLLBACK`; } catch { /* session dead */ }
    throw err;
  } finally {
    client.release();
  }
}

// Re-export @vercel/postgres so domain modules don't each import it.
export { sql, db };
