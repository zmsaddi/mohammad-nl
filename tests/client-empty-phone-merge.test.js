// v1.0.3 Bug B — addClient empty-phone shadow merge
//
// Pre-v1.0.3 production state had two ZAKARIYA client rows: id=1 with
// phone='', id=2 with phone='+34632759513'. Both created by the same
// seller. Mechanism:
//
//   - Sale 1 (earlier): seller typed ZAKARIYA without a phone →
//     addClient Step 4 inserted clients.id=1 with phone=''.
//   - Sale 2 (later): seller typed ZAKARIYA with phone +34xxx →
//     addClient Step 1 lookup `WHERE name=X AND phone=Y` did not match
//     (id=1 has phone=''), Step 4 inserted a new row.
//
// The unique partial index `(name, phone) WHERE phone <> ''` excludes
// empty-phone rows from uniqueness enforcement, so the DB doesn't catch
// the duplicate either.
//
// Fix: in addClient Step 1, when the new caller has a phone AND no
// exact-phone match was found, also look for a same-name row with an
// empty phone. If exactly one exists, UPDATE it (silent merge). If
// zero or 2+ exist, fall through to insert.
//
// Run with: npx vitest run tests/client-empty-phone-merge.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import { initDatabase, addClient } from '../lib/db.js';

async function clearTestClients() {
  await sql`DELETE FROM clients WHERE name = 'TESTBUG_emptyphone'`;
}

describe('Bug B — empty-phone merge on addClient', () => {
  beforeAll(async () => { await initDatabase(); }, 30000);
  beforeEach(async () => { await clearTestClients(); });
  afterAll(async () => { await clearTestClients(); });

  it('Test 1 — existing empty-phone row + new call with phone → merges (no duplicate)', async () => {
    // Step A: seed an empty-phone row (the "shadow")
    const first = await addClient({
      name: 'TESTBUG_emptyphone',
      phone: '',
      email: '',
      address: 'Original Addr',
      createdBy: 'test-admin',
    });
    expect(first.id).toBeGreaterThan(0);

    // Verify only one row exists
    const before = await sql`SELECT id, phone, address FROM clients WHERE name = 'TESTBUG_emptyphone'`;
    expect(before.rows).toHaveLength(1);
    expect(before.rows[0].phone).toBe('');

    // Step B: same name, this time WITH a phone
    const second = await addClient({
      name: 'TESTBUG_emptyphone',
      phone: '+34999888777',
      email: '',
      address: 'New Real Addr',
      createdBy: 'test-admin',
    });

    // Should reuse the existing id, not create a new row
    expect(second.id).toBe(first.id);
    expect(second.exists).toBe(true);
    expect(second.mergedShadow).toBe(true);

    const after = await sql`SELECT id, phone, address FROM clients WHERE name = 'TESTBUG_emptyphone'`;
    expect(after.rows).toHaveLength(1); // ← the critical assertion: still just 1 row
    expect(after.rows[0].id).toBe(first.id);
    expect(after.rows[0].phone).toBe('+34999888777');
    expect(after.rows[0].address).toBe('New Real Addr');
  });

  it('Test 2 — existing exact-match row + new call with same phone → returns existing', async () => {
    const first = await addClient({
      name: 'TESTBUG_emptyphone',
      phone: '+34999888777',
      address: 'Addr 1',
      createdBy: 'test-admin',
    });
    expect(first.id).toBeGreaterThan(0);

    const second = await addClient({
      name: 'TESTBUG_emptyphone',
      phone: '+34999888777',
      address: 'Addr 2 (would be ignored)',
      createdBy: 'test-admin',
    });
    expect(second.id).toBe(first.id);
    expect(second.exists).toBe(true);
    // Step 1 returns BEFORE the empty-shadow check, so mergedShadow is undefined
    expect(second.mergedShadow).toBeUndefined();

    const all = await sql`SELECT id FROM clients WHERE name = 'TESTBUG_emptyphone'`;
    expect(all.rows).toHaveLength(1);
  });

  it('Test 3 — no existing row + new call with phone → inserts normally', async () => {
    const r = await addClient({
      name: 'TESTBUG_emptyphone',
      phone: '+34999888777',
      address: 'Fresh Addr',
      createdBy: 'test-admin',
    });
    expect(r.id).toBeGreaterThan(0);
    expect(r.exists).toBeUndefined();

    const all = await sql`SELECT id FROM clients WHERE name = 'TESTBUG_emptyphone'`;
    expect(all.rows).toHaveLength(1);
  });

  it('Test 4 — multiple empty-phone same-name rows → falls through to insert (does not guess)', async () => {
    // Manually seed TWO empty-phone shadows. addClient itself wouldn't
    // create the second because of Step 3's ambiguous check, but legacy
    // data or direct DB inserts can produce this state.
    await sql`INSERT INTO clients (name, phone, address, latin_name, created_by) VALUES ('TESTBUG_emptyphone', '', 'Addr A', 'TESTBUG_emptyphone', 'seed')`;
    await sql`INSERT INTO clients (name, phone, address, latin_name, created_by) VALUES ('TESTBUG_emptyphone', '', 'Addr B', 'TESTBUG_emptyphone', 'seed')`;

    const before = await sql`SELECT id FROM clients WHERE name = 'TESTBUG_emptyphone'`;
    expect(before.rows).toHaveLength(2);

    const r = await addClient({
      name: 'TESTBUG_emptyphone',
      phone: '+34999888777',
      address: 'New',
      createdBy: 'test-admin',
    });
    expect(r.id).toBeGreaterThan(0);
    // Should NOT have set mergedShadow because the merge target was ambiguous
    expect(r.mergedShadow).toBeUndefined();

    // Should now have 3 rows: the 2 shadows untouched + the new one
    const after = await sql`SELECT id, phone FROM clients WHERE name = 'TESTBUG_emptyphone' ORDER BY id`;
    expect(after.rows).toHaveLength(3);
    // The new row is the third one and has the phone
    const phones = after.rows.map((r) => r.phone);
    expect(phones.filter((p) => p === '')).toHaveLength(2);
    expect(phones.filter((p) => p === '+34999888777')).toHaveLength(1);
  });
});
