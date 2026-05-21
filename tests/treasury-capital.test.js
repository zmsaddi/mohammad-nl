// Treasury — capital operations (injection/withdrawal) with multi-admin
// approval. Verifies: single admin applies immediately; multiple admins wait
// until ALL approved then apply once; non-admins can't approve; non-pending
// rejected. Mocked client (no real DB), like the other treasury unit tests.
//
// Run with:  npx vitest run tests/treasury-capital.test.js

import { describe, it, expect, vi } from 'vitest';

vi.mock('@vercel/postgres', () => ({
  sql: Object.assign(async () => ({ rows: [] }), { query: async () => ({ rows: [] }) }),
}));

function buildMockClient({ status = 'pending', isAdmin = true, kind = 'injection', amount = 1000, adminCount = 1, approved = 1 } = {}) {
  const calls = [];
  const opRow = { id: 5, kind, amount, method: 'كاش', status, notes: '' };
  const client = {
    sql: async (strings, ...values) => {
      const text = strings.join('?');
      calls.push({ text, values });
      if (/INSERT INTO capital_operations/.test(text)) return { rows: [{ id: 5 }] };
      if (/SELECT \* FROM capital_operations/.test(text)) return { rows: [opRow] };
      if (/SELECT status FROM capital_operations/.test(text)) return { rows: [{ status }] };
      if (/FROM users WHERE username/.test(text)) return { rows: isAdmin ? [{ ok: 1 }] : [] };
      if (/COUNT\(\*\)::int AS n FROM users WHERE role = 'admin'/.test(text)) return { rows: [{ n: adminCount }] };
      if (/COUNT\(DISTINCT a\.username\)/.test(text)) return { rows: [{ n: approved }] };
      if (/FROM cash_boxes WHERE type = 'main'/.test(text)) return { rows: [{ id: 1 }] };
      return { rows: [] };
    },
  };
  return { client, calls };
}
const applied = (calls) => {
  const mv = calls.find((c) => /INSERT INTO cash_movements/.test(c.text));
  const bal = calls.find((c) => /UPDATE cash_boxes SET balance/.test(c.text));
  return mv && bal ? { mv, bal } : null;
};

describe('initiateCapitalOpInTx', () => {
  it('throws when treasury is disabled', async () => {
    delete process.env.TREASURY_ENABLED;
    const { initiateCapitalOpInTx } = await import('../lib/db.js');
    const { client } = buildMockClient();
    await expect(initiateCapitalOpInTx(client, { kind: 'injection', amount: 1000, initiatedBy: 'a1' }))
      .rejects.toThrow(/غير مفعّل/);
  });

  it('single admin → applies immediately (general box credited)', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { initiateCapitalOpInTx } = await import('../lib/db.js');
    const { client, calls } = buildMockClient({ adminCount: 1, approved: 1, kind: 'injection', amount: 1000 });
    await initiateCapitalOpInTx(client, { kind: 'injection', amount: 1000, initiatedBy: 'a1' });
    const a = applied(calls);
    expect(a).toBeTruthy();
    expect(a.bal.values).toContain(1000); // +1000 to the general box
    delete process.env.TREASURY_ENABLED;
  });
});

describe('approveCapitalOpInTx', () => {
  it('rejects a non-admin approver', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { approveCapitalOpInTx } = await import('../lib/db.js');
    const { client } = buildMockClient({ isAdmin: false });
    await expect(approveCapitalOpInTx(client, 5, 'm1')).rejects.toThrow(/المدراء العامون/);
    delete process.env.TREASURY_ENABLED;
  });

  it('rejects a non-pending operation', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { approveCapitalOpInTx } = await import('../lib/db.js');
    const { client } = buildMockClient({ status: 'approved' });
    await expect(approveCapitalOpInTx(client, 5, 'a1')).rejects.toThrow(/غير معلّقة/);
    delete process.env.TREASURY_ENABLED;
  });

  it('with 2 admins and only 1 approval so far → does NOT apply', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { approveCapitalOpInTx } = await import('../lib/db.js');
    const { client, calls } = buildMockClient({ adminCount: 2, approved: 1 });
    await approveCapitalOpInTx(client, 5, 'a1');
    expect(applied(calls)).toBeNull();
    delete process.env.TREASURY_ENABLED;
  });

  it('with 2 admins and the 2nd approval completing → applies once', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { approveCapitalOpInTx } = await import('../lib/db.js');
    const { client, calls } = buildMockClient({ adminCount: 2, approved: 2, kind: 'injection', amount: 750 });
    await approveCapitalOpInTx(client, 5, 'a2');
    const a = applied(calls);
    expect(a).toBeTruthy();
    expect(a.bal.values).toContain(750);
    delete process.env.TREASURY_ENABLED;
  });

  it('withdrawal debits the general box (negative delta)', async () => {
    process.env.TREASURY_ENABLED = 'true';
    const { approveCapitalOpInTx } = await import('../lib/db.js');
    const { client, calls } = buildMockClient({ adminCount: 1, approved: 1, kind: 'withdrawal', amount: 300 });
    await approveCapitalOpInTx(client, 5, 'a1');
    const a = applied(calls);
    expect(a).toBeTruthy();
    expect(a.bal.values).toContain(-300);
    delete process.env.TREASURY_ENABLED;
  });
});
