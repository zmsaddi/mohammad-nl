// BUG-21: addSupplier phone-only ambiguity detection.
//
// Mirrors the addClient ambiguity pattern (lib/db.js:1448) but without
// the email step — suppliers table has no email column today. Deferred
// to v1.1 per Session 4 scope decision.
//
// Real-DB integration tests against the Neon test branch.
//
// Run with: npx vitest run tests/bug21-supplier-ambiguity.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import { initDatabase, addSupplier } from '../lib/db.js';

async function truncateSuppliers() {
  await sql`TRUNCATE TABLE suppliers, entity_aliases RESTART IDENTITY CASCADE`;
}

describe('BUG-21: addSupplier phone-only ambiguity', () => {
  beforeAll(async () => {
    await initDatabase();
  }, 30000);

  beforeEach(async () => {
    await truncateSuppliers();
  });

  afterAll(async () => {
    await truncateSuppliers();
  });

  it('genuinely new supplier → returns { id }', async () => {
    const result = await addSupplier({ name: 'Ali Trading', phone: '+31612345678' });
    expect(result.id).toBeTypeOf('number');
    expect(result.ambiguous).toBeUndefined();
    expect(result.exists).toBeUndefined();
  });

  it('name + phone match existing → returns { id, exists: true }', async () => {
    const first = await addSupplier({ name: 'Ahmad Co', phone: '+31600000001' });
    const second = await addSupplier({ name: 'Ahmad Co', phone: '+31600000001', address: 'New Addr' });
    expect(second.id).toBe(first.id);
    expect(second.exists).toBe(true);

    // Verify the address was upserted
    const { rows } = await sql`SELECT address FROM suppliers WHERE id = ${first.id}`;
    expect(rows[0].address).toBe('New Addr');
  });

  it('name collision with no phone → returns ambiguous flag', async () => {
    // Seed two real suppliers with the same name but different phones
    await addSupplier({ name: 'Collision Inc', phone: '+31600000001' });
    await addSupplier({ name: 'Collision Inc', phone: '+31600000002' });

    // Third caller arrives with just a name — must be disambiguated
    const result = await addSupplier({ name: 'Collision Inc' });
    expect(result.ambiguous).toBe(true);
    expect(Array.isArray(result.candidates)).toBe(true);
    expect(result.candidates.length).toBe(2);
    expect(result.message).toContain('Collision Inc');
    expect(result.message).toContain('مورد');
    expect(result.id).toBeUndefined();
  });

  it('name collision + new phone → creates a second distinct supplier (no silent merge)', async () => {
    // This is the core BUG-21 fix: before this pass, the second insert
    // would silently return the first supplier's id. Now we get a real
    // new row because the (name, phone) pair is genuinely new.
    const first = await addSupplier({ name: 'Distinct Test', phone: '+31600000001' });
    const second = await addSupplier({ name: 'Distinct Test', phone: '+31600000002' });
    expect(second.id).not.toBe(first.id);
    expect(second.exists).toBeUndefined();

    const { rows } = await sql`SELECT COUNT(*)::int AS c FROM suppliers WHERE name = 'Distinct Test'`;
    expect(rows[0].c).toBe(2);
  });
});
