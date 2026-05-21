// Treasury — setOpeningBalance (go-live "clean start from today").
// Records ONE kind='opening' movement per box and brings the balance to match;
// re-entry REPLACES the prior opening (adjusts by the delta only). withTx, so
// we mock the transaction client; TREASURY_ENABLED='true' short-circuits the flag.
//
// Run with:  npx vitest run tests/treasury-opening-balance.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ calls: [], boxRows: [{ id: 3 }], openingRows: [] }));

vi.mock('@vercel/postgres', () => {
  const respond = (text) => {
    if (/BEGIN|COMMIT|ROLLBACK/.test(text)) return { rows: [] };
    if (/SELECT id FROM cash_boxes WHERE id/.test(text)) return { rows: h.boxRows };
    if (/SELECT id, signed_amount FROM cash_movements/.test(text)) return { rows: h.openingRows };
    if (/SELECT balance FROM cash_boxes WHERE id/.test(text)) return { rows: [{ balance: 500 }] };
    return { rows: [] };
  };
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    h.calls.push({ text, values });
    return Promise.resolve(respond(text));
  };
  sql.query = async () => ({ rows: [] });
  return { sql, db: { connect: async () => ({ sql, release() {} }) } };
});

const find = (re) => h.calls.filter((c) => re.test(c.text));
beforeEach(() => { h.calls = []; h.boxRows = [{ id: 3 }]; h.openingRows = []; process.env.TREASURY_ENABLED = 'true'; });
afterEach(() => { delete process.env.TREASURY_ENABLED; });

describe('setOpeningBalance', () => {
  it('first entry: inserts an opening movement and sets the balance to the amount', async () => {
    const { setOpeningBalance } = await import('../lib/db.js');
    await setOpeningBalance(3, 500, 'admin');
    const ins = find(/INSERT INTO cash_movements/);
    expect(ins).toHaveLength(1);
    expect(ins[0].values).toContain(500);                 // opening amount
    const upd = find(/UPDATE cash_boxes SET balance = balance \+/);
    expect(upd).toHaveLength(1);
    expect(upd[0].values).toContain(500);                 // balance += full amount
  });

  it('re-entry: REPLACES the prior opening and adjusts the balance by the delta only', async () => {
    h.openingRows = [{ id: 99, signed_amount: 200 }];
    const { setOpeningBalance } = await import('../lib/db.js');
    await setOpeningBalance(3, 500, 'admin');
    expect(find(/INSERT INTO cash_movements/)).toHaveLength(0);       // no new movement
    const updMov = find(/UPDATE cash_movements SET signed_amount/);
    expect(updMov).toHaveLength(1);
    expect(updMov[0].values).toContain(500);              // movement set to new amount
    const updBox = find(/UPDATE cash_boxes SET balance = balance \+/);
    expect(updBox).toHaveLength(1);
    expect(updBox[0].values).toContain(300);              // 500 − 200 delta only
  });

  it('throws when the box does not exist', async () => {
    h.boxRows = [];
    const { setOpeningBalance } = await import('../lib/db.js');
    await expect(setOpeningBalance(999, 100, 'admin')).rejects.toThrow(/الصندوق غير موجود/);
    expect(find(/INSERT INTO cash_movements/)).toHaveLength(0);
  });

  it('rejects a negative opening balance', async () => {
    const { setOpeningBalance } = await import('../lib/db.js');
    await expect(setOpeningBalance(3, -50, 'admin')).rejects.toThrow(/سالب/);
  });
});
