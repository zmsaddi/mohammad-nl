// Transaction dates must be today or earlier, never the future (user request:
// "block user to register in future date — he can register days before or same
// day, not future"). Enforced centrally on the shared `dateStr` schema, so it
// covers sales/purchases/expenses/deliveries/payments/settlements. This test
// uses ExpenseSchema as the representative carrier of dateStr.
import { describe, it, expect } from 'vitest';
import { ExpenseSchema } from '../lib/schemas.js';
import { getTodayDate } from '../lib/utils.js';

const base = { category: 'إيجار', description: 'اختبار', amount: 100, paymentType: 'كاش' };
const shift = (days) => {
  const d = new Date(`${getTodayDate()}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

describe('future-date guard (shared dateStr)', () => {
  it('accepts today', () => {
    expect(ExpenseSchema.safeParse({ ...base, date: getTodayDate() }).success).toBe(true);
  });

  it('accepts a past date', () => {
    expect(ExpenseSchema.safeParse({ ...base, date: shift(-3) }).success).toBe(true);
  });

  it('rejects tomorrow (future)', () => {
    const res = ExpenseSchema.safeParse({ ...base, date: shift(1) });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error.issues)).toContain('المستقبل');
  });

  it('rejects a far-future date', () => {
    expect(ExpenseSchema.safeParse({ ...base, date: shift(400) }).success).toBe(false);
  });
});
