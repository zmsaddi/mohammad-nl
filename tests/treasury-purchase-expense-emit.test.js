// Treasury — cash-movement coverage for purchases / expenses / manual payments.
//
// Regression for the gap that started this audit: addPurchase recorded a
// supplier down-payment but NEVER debited the buyer's custody box. Plus the
// reversal paths (deletePurchase, deleteExpense) and the manual-payment cash
// event. All run inside withTx, so we mock BOTH the module `sql` and the
// transaction client (db.connect().sql) with one query/value recorder.
//
// TREASURY_ENABLED='true' short-circuits isTreasuryEnabled before any DB read.
//
// Run with:  npx vitest run tests/treasury-purchase-expense-emit.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [],
  productRows: [],                                   // [] = new product (simplest path)
  payRows: [{ id: 500 }],                            // supplier_payments under a purchase
  expenseRows: [{ id: 1 }],
  purchaseRows: [{ id: 1, item: 'X', quantity: 0, unit_price: 0, total: 0, paid_amount: 0 }],
  movRows: [],                                       // movements found for a deleted source
  boxId: 3,
}));

vi.mock('@vercel/postgres', () => {
  const respond = (text) => {
    if (/BEGIN|COMMIT|ROLLBACK/.test(text)) return { rows: [] };
    if (/to_regclass\('cash_boxes'\)/.test(text)) return { rows: [{ t: 'cash_boxes' }] };
    if (/to_regclass\('cash_movements'\)/.test(text)) return { rows: [{ t: 'cash_movements' }] };
    if (/SELECT box_id, signed_amount FROM cash_movements/.test(text)) return { rows: h.movRows };
    if (/SELECT 1\s+FROM cash_movements/.test(text)) return { rows: [] };       // dup check → none
    if (/SELECT id FROM cash_boxes WHERE owner_username/.test(text)) return { rows: [{ id: h.boxId }] };
    if (/FROM cash_boxes WHERE type = 'main'/.test(text)) return { rows: [{ id: 1 }] };
    if (/buy_price, sell_price, stock FROM products WHERE name/.test(text)) return { rows: h.productRows };
    if (/SELECT buy_price, sell_price FROM products WHERE name/.test(text)) return { rows: [{ buy_price: 10, sell_price: 0 }] };
    if (/INSERT INTO purchases/.test(text)) return { rows: [{ id: 100, ref_code: 'PU-1' }] };
    if (/INSERT INTO supplier_payments/.test(text)) return { rows: [{ id: 500 }] };
    if (/INSERT INTO payments/.test(text)) return { rows: [{ id: 900 }] };
    if (/SELECT id FROM supplier_payments WHERE purchase_id/.test(text)) return { rows: h.payRows };
    if (/SELECT id FROM expenses WHERE id/.test(text)) return { rows: h.expenseRows };
    if (/SELECT \* FROM purchases WHERE id/.test(text)) return { rows: h.purchaseRows };
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

beforeEach(() => {
  h.calls = [];
  h.productRows = [];
  h.payRows = [{ id: 500 }];
  h.expenseRows = [{ id: 1 }];
  h.purchaseRows = [{ id: 1, item: 'X', quantity: 0, unit_price: 0, total: 0, paid_amount: 0 }];
  h.movRows = [];
  process.env.TREASURY_ENABLED = 'true';
});
afterEach(() => { delete process.env.TREASURY_ENABLED; });

describe('addPurchase — down payment debits the buyer box (the reported gap)', () => {
  it('emits a supplier_payment movement of −paidAmount to the creator box', async () => {
    const { addPurchase } = await import('../lib/db.js');
    await addPurchase({ item: 'EB30', quantity: 1, unitPrice: 300, paymentType: 'كاش', createdBy: 'AHMAD', date: '2026-05-21', category: '' });
    const ins = find(/INSERT INTO cash_movements/);
    expect(ins).toHaveLength(1);
    expect(ins[0].values).toContain(-300);   // debit of the full down payment…
    expect(ins[0].values).toContain(3);      // …to the buyer's box
    const upd = find(/UPDATE cash_boxes SET balance = balance \+/);
    expect(upd).toHaveLength(1);
    expect(upd[0].values).toContain(-300);
  });

  it('does NOT emit when nothing is paid up front (pure credit purchase)', async () => {
    const { addPurchase } = await import('../lib/db.js');
    await addPurchase({ item: 'EB30', quantity: 1, unitPrice: 300, paidAmount: 0, paymentType: 'كاش', createdBy: 'AHMAD', date: '2026-05-21', category: '' });
    expect(find(/INSERT INTO cash_movements/)).toHaveLength(0);
  });
});

describe('deletePurchase — reverses the box debits of its supplier payments', () => {
  it('credits the box back by −signed_amount and removes the movements', async () => {
    h.payRows = [{ id: 500 }];
    h.movRows = [{ box_id: 3, signed_amount: -300 }];
    const { deletePurchase } = await import('../lib/db.js');
    await deletePurchase(1);
    const rev = find(/UPDATE cash_boxes SET balance = balance - /);
    expect(rev).toHaveLength(1);
    expect(rev[0].values).toContain(-300);   // balance = balance − (−300) = +300 back
    expect(find(/DELETE FROM cash_movements/)).toHaveLength(1);
  });
});

describe('deleteExpense — reverses the expense debit (now atomic in withTx)', () => {
  it('credits the box back and removes the expense + its movement', async () => {
    h.expenseRows = [{ id: 1 }];
    h.movRows = [{ box_id: 3, signed_amount: -75 }];
    const { deleteExpense } = await import('../lib/db.js');
    await deleteExpense(1);
    const rev = find(/UPDATE cash_boxes SET balance = balance - /);
    expect(rev).toHaveLength(1);
    expect(rev[0].values).toContain(-75);
    expect(find(/DELETE FROM cash_movements/)).toHaveLength(1);
    expect(find(/DELETE FROM expenses/)).toHaveLength(1);
  });
});

describe('addPayment (no sale) — records the manual payment as a cash event', () => {
  it('emits a +amount collection to the creator box', async () => {
    const { addPayment } = await import('../lib/db.js');
    await addPayment({ amount: 200, clientName: 'C', createdBy: 'AHMAD', date: '2026-05-21', paymentMethod: 'كاش' });
    const ins = find(/INSERT INTO cash_movements/);
    expect(ins).toHaveLength(1);
    expect(ins[0].values).toContain(200);
    expect(ins[0].values).toContain(3);
  });
});
