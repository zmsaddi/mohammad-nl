// updateInvoiceVin — corrects ONLY the VIN, on both the invoice snapshot and
// the linked sale, atomically. Mock the withTx client (db.connect().sql).
//
// Run with:  npx vitest run tests/invoice-vin-edit.test.js

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ calls: [], invRows: [{ sale_id: 5 }] }));

vi.mock('@vercel/postgres', () => {
  const respond = (text) => {
    if (/BEGIN|COMMIT|ROLLBACK/.test(text)) return { rows: [] };
    if (/SELECT sale_id FROM invoices WHERE id/.test(text)) return { rows: h.invRows };
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
beforeEach(() => { h.calls = []; h.invRows = [{ sale_id: 5 }]; });

describe('updateInvoiceVin', () => {
  it('trims and writes the VIN to BOTH the invoice and the linked sale', async () => {
    const { updateInvoiceVin } = await import('../lib/db.js');
    const res = await updateInvoiceVin(10, '  ABC123  ', 'admin');
    expect(res).toEqual({ success: true, vin: 'ABC123' });
    const inv = find(/UPDATE invoices SET vin/);
    expect(inv).toHaveLength(1);
    expect(inv[0].values).toContain('ABC123');
    const sale = find(/UPDATE sales SET vin/);
    expect(sale).toHaveLength(1);
    expect(sale[0].values).toContain('ABC123');
  });

  it('throws when the invoice does not exist (and writes nothing)', async () => {
    h.invRows = [];
    const { updateInvoiceVin } = await import('../lib/db.js');
    await expect(updateInvoiceVin(99, 'X', 'admin')).rejects.toThrow(/الفاتورة غير موجودة/);
    expect(find(/UPDATE invoices SET vin/)).toHaveLength(0);
    expect(find(/UPDATE sales SET vin/)).toHaveLength(0);
  });

  it('updates only the invoice when no sale is linked', async () => {
    h.invRows = [{ sale_id: null }];
    const { updateInvoiceVin } = await import('../lib/db.js');
    await updateInvoiceVin(10, 'X', 'admin');
    expect(find(/UPDATE invoices SET vin/)).toHaveLength(1);
    expect(find(/UPDATE sales SET vin/)).toHaveLength(0);
  });
});
