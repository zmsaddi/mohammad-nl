// v1.1 S1.8 [F-005] — SettlementSchema enum collapse regression test.
//
// Pre-v1.1 the SettlementSchema accepted three types:
//   seller_payout | driver_payout | profit_distribution
//
// v1.1 collapses the two write paths into profit by removing
// `profit_distribution` from the enum. New inserts of that type must be
// rejected at the Zod schema layer (route boundary).
//
// Legacy rows with type='profit_distribution' remain valid reads (the
// UI display map still has the label, marked قديم) — only WRITES are
// blocked.

import { describe, it, expect } from 'vitest';
import { SettlementSchema } from '@/lib/schemas';

describe('F-005 regression — SettlementSchema no longer accepts profit_distribution', () => {
  it('accepts seller_payout', () => {
    const r = SettlementSchema.safeParse({
      date: '2026-04-15',
      type: 'seller_payout',
      username: 'yasin',
      description: 'test',
      amount: 100,
    });
    expect(r.success).toBe(true);
  });

  it('accepts driver_payout', () => {
    const r = SettlementSchema.safeParse({
      date: '2026-04-15',
      type: 'driver_payout',
      username: 'driver1',
      description: 'test',
      amount: 100,
    });
    expect(r.success).toBe(true);
  });

  it('REJECTS profit_distribution (Zod layer — the F-005 fix)', () => {
    const r = SettlementSchema.safeParse({
      date: '2026-04-15',
      type: 'profit_distribution',
      username: 'admin',
      description: 'test',
      amount: 100,
    });
    expect(r.success).toBe(false);
    // Zod invalid_enum produces an Arabic-prefixed message via our custom `message`
    const msg = r.error.issues[0].message;
    expect(msg).toMatch(/نوع التسوية/);
  });

  it('REJECTS an arbitrary new type', () => {
    const r = SettlementSchema.safeParse({
      date: '2026-04-15',
      type: 'something_new',
      username: 'admin',
      description: 'test',
      amount: 100,
    });
    expect(r.success).toBe(false);
  });
});
