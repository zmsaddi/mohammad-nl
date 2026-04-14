// BUG-14: contract test for POST /api/deliveries via the addDelivery DB
// helper. No UI caller exists today, but the route handler + schema are
// defensive against future callers. This test locks the contract so a
// schema drift would be caught before it ships.
//
// Direct DB test — does not spin up the Next.js server. We exercise
// addDelivery(parsed.data) the same way the route handler does, after
// pretending a DeliverySchema.safeParse has succeeded.
//
// Run with: npx vitest run tests/bug14-deliveries-post-contract.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import { initDatabase, addDelivery } from '../lib/db.js';
import { DeliverySchema } from '../lib/schemas.js';

const TRUNCATE_TABLES = [
  'cancellations',
  'sales', 'purchases', 'deliveries', 'invoices', 'bonuses',
  'settlements', 'payments', 'expenses', 'clients', 'products',
  'suppliers', 'voice_logs', 'ai_corrections', 'entity_aliases',
  'ai_patterns', 'price_history',
];

async function truncateBusinessTables() {
  const list = TRUNCATE_TABLES.map((t) => `"${t}"`).join(', ');
  await sql.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

describe('BUG-14: /api/deliveries POST contract (addDelivery direct)', () => {
  beforeAll(async () => {
    await initDatabase();
  }, 30000);

  beforeEach(async () => {
    await truncateBusinessTables();
  });

  afterAll(async () => {
    await truncateBusinessTables();
  });

  it('DeliverySchema happy path → addDelivery inserts a row', async () => {
    const body = {
      date: '2026-04-14',
      clientName: 'BUG14 Contract Client',
      items: 'V20 Pro (1)',
      totalAmount: '1500', // string → coerced
      driverName: 'BUG14 Driver',
      notes: 'contract test',
    };
    const parsed = DeliverySchema.safeParse(body);
    expect(parsed.success).toBe(true);
    // Reconstruct what the route handler does
    const data = { ...parsed.data, createdBy: 'bug14-test' };
    const id = await addDelivery(data);
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);

    // Verify the row landed with coerced totalAmount
    const { rows } = await sql`SELECT * FROM deliveries WHERE id = ${id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].client_name).toBe('BUG14 Contract Client');
    expect(parseFloat(rows[0].total_amount)).toBe(1500);
    expect(rows[0].status).toBe('قيد الانتظار'); // schema default
    expect(rows[0].created_by).toBe('bug14-test');
  });

  it('DeliverySchema rejects malformed body before hitting DB', () => {
    const badBody = {
      date: '14-04-2026', // wrong format
      clientName: '',
      items: '',
    };
    const parsed = DeliverySchema.safeParse(badBody);
    expect(parsed.success).toBe(false);
    // First error message is Arabic (client-side date check)
    expect(parsed.error.issues[0].message).toMatch(/^[\u0600-\u06FF]/);
  });

  it('BUG-13 follow-up: addDelivery no longer has defensive parseFloat — trusts Zod coercion', async () => {
    // The pre-BUG-14 defensive `data.totalAmount = parseFloat(...)` line
    // was removed. Verify that a raw number (not a string) still flows
    // through correctly, so we're sure the removal didn't introduce a
    // regression.
    const body = {
      date: '2026-04-14',
      clientName: 'BUG14 Raw Number',
      items: 'x',
      totalAmount: 999.99,
    };
    const parsed = DeliverySchema.safeParse(body);
    expect(parsed.success).toBe(true);
    const id = await addDelivery({ ...parsed.data, createdBy: 'bug14-test' });
    const { rows } = await sql`SELECT total_amount FROM deliveries WHERE id = ${id}`;
    expect(parseFloat(rows[0].total_amount)).toBeCloseTo(999.99, 2);
  });
});
