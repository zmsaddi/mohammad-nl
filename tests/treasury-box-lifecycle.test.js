// Treasury — custody-box lifecycle on user role change.
//
// Rules under test:
//  1. MONEY PROTECTION: with the treasury live, a role change is BLOCKED while
//     the user's custody box still holds money (must settle to ~0 first).
//  2. Changing to a NON-cash role (seller) DEACTIVATES the (empty) box so it
//     drops out of the money views — never deletes it (history preserved).
//  3. Returning to a cash role REACTIVATES the box.
//  4. getCashBoxesForViewer HIDES deactivated boxes (COALESCE(active,true)).
//
// updateUser/ensureCashBox/getCashBoxesForViewer use the module-level `sql`,
// so we mock it as a tagged-template recorder with canned, query-shaped rows.
//
// Run with:  npx vitest run tests/treasury-box-lifecycle.test.js

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ calls: [], balance: 0, curRole: 'driver' }));

vi.mock('@vercel/postgres', () => {
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    h.calls.push({ text, values });
    if (/to_regclass\('cash_boxes'\)/.test(text)) return Promise.resolve({ rows: [{ t: 'cash_boxes' }] });
    if (/SELECT username, role FROM users/.test(text)) return Promise.resolve({ rows: [{ username: 'u1', role: h.curRole }] });
    if (/SELECT balance FROM cash_boxes/.test(text)) return Promise.resolve({ rows: [{ balance: h.balance }] });
    if (/SELECT username FROM users WHERE id/.test(text)) return Promise.resolve({ rows: [{ username: 'u1' }] });
    return Promise.resolve({ rows: [] });
  };
  sql.query = async () => ({ rows: [] });
  return { sql, db: { connect: async () => ({ sql, release() {} }) } };
});

const find = (re) => h.calls.filter((c) => re.test(c.text));

beforeEach(() => { h.calls = []; h.balance = 0; h.curRole = 'driver'; });

describe('updateUser — money protection on role change', () => {
  it('BLOCKS driver → seller when the box still holds money (treasury live)', async () => {
    process.env.TREASURY_ENABLED = 'true';
    h.balance = 100; h.curRole = 'driver';
    const { updateUser } = await import('../lib/db.js');
    await expect(updateUser({ id: 1, name: 'U', role: 'seller' })).rejects.toThrow(/لا يمكن تغيير الدور/);
    // The UPDATE users must NOT have run (change blocked before any write).
    expect(find(/UPDATE users SET/)).toHaveLength(0);
    delete process.env.TREASURY_ENABLED;
  });

  it('ALLOWS driver → seller when the box is empty, and DEACTIVATES the box', async () => {
    process.env.TREASURY_ENABLED = 'true';
    h.balance = 0; h.curRole = 'driver';
    const { updateUser } = await import('../lib/db.js');
    await updateUser({ id: 1, name: 'U', role: 'seller' });
    expect(find(/UPDATE users SET/)).toHaveLength(1);
    const deact = find(/UPDATE cash_boxes SET active = false/);
    expect(deact).toHaveLength(1);
    // It only deactivates an empty box (belt-and-suspenders balance check).
    expect(/ABS\(COALESCE\(balance, 0\)\) <= 0\.005/.test(deact[0].text)).toBe(true);
    delete process.env.TREASURY_ENABLED;
  });
});

describe('updateUser — box reactivation when returning to a cash role', () => {
  it('seller → driver ensures + reactivates the custody box', async () => {
    process.env.TREASURY_ENABLED = 'true';
    h.balance = 0; h.curRole = 'seller';
    const { updateUser } = await import('../lib/db.js');
    await updateUser({ id: 1, name: 'U', role: 'driver' });
    expect(find(/INSERT INTO cash_boxes/)).toHaveLength(1);              // ensure exists
    expect(find(/UPDATE cash_boxes SET active = true/)).toHaveLength(1); // reactivate
    expect(find(/UPDATE cash_boxes SET active = false/)).toHaveLength(0);
    delete process.env.TREASURY_ENABLED;
  });
});

describe('getCashBoxesForViewer — hides deactivated / non-cash boxes', () => {
  it('all three role queries filter on COALESCE(active,true)', async () => {
    const { getCashBoxesForViewer } = await import('../lib/db.js');
    for (const [role, user] of [['admin', 'a1'], ['manager', 'm1'], ['driver', 'd1']]) {
      h.calls = [];
      await getCashBoxesForViewer(role, user);
      const sel = find(/FROM cash_boxes b LEFT JOIN users/);
      expect(sel.length).toBeGreaterThan(0);
      expect(sel.some((c) => /COALESCE\(b\.active, true\)/.test(c.text))).toBe(true);
    }
  });

  it('admin query hides empty non-cash-role boxes but NEVER hides money', async () => {
    const { getCashBoxesForViewer } = await import('../lib/db.js');
    h.calls = [];
    await getCashBoxesForViewer('admin', 'a1');
    const q = find(/FROM cash_boxes b LEFT JOIN users/)[0].text;
    expect(/u\.role IN \('admin','manager','driver'\)/.test(q)).toBe(true);   // only cash roles shown
    expect(/ABS\(COALESCE\(b\.balance, 0\)\) > 0\.005/.test(q)).toBe(true);   // …unless the box holds money
    expect(/b\.type = 'main'/.test(q)).toBe(true);                            // general box always shown
  });
});
