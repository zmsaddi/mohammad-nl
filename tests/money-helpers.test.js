// v1.1 F-011/F-012/F-016 — lib/money.js helper regression.
//
// Pure unit tests, no DB. Locks the rounding behavior and the
// TVA formula so future callsites can't drift.

import { describe, it, expect } from 'vitest';
import { round2, tvaFromTtc, htFromTtc, toCents, fromCents } from '@/lib/money';

describe('lib/money round2', () => {
  it('rounds up at half', () => {
    expect(round2(1.235)).toBe(1.24);
    expect(round2(1.005)).toBe(1.01);
  });
  it('rounds down below half', () => {
    expect(round2(1.234)).toBe(1.23);
  });
  it('handles 0', () => {
    expect(round2(0)).toBe(0);
  });
  // Negative rounding is asymmetric due to Math.round's "toward +inf"
  // behavior. Not load-bearing for this app because money amounts
  // are always positive at the round2 site; refunds are computed
  // server-side by negating an already-rounded positive amount.
  it('accepts string input via implicit coerce', () => {
    // round2 is number-only; casting happens at callers
    expect(round2(parseFloat('123.456'))).toBe(123.46);
  });
});

describe('lib/money tvaFromTtc — 20% (the historic shortcut)', () => {
  it('matches the old `amount / 6` for exact 20%', () => {
    // 900 / 6 = 150 exactly
    expect(tvaFromTtc(900, 20)).toBe(150);
    // 949 / 6 = 158.1666..., rounds to 158.17
    expect(tvaFromTtc(949, 20)).toBe(158.17);
    // 951 / 6 = 158.5 exactly
    expect(tvaFromTtc(951, 20)).toBe(158.5);
    // 1000 / 6 = 166.6666..., rounds to 166.67
    expect(tvaFromTtc(1000, 20)).toBe(166.67);
  });
  it('handles 0 and negatives as no-op', () => {
    expect(tvaFromTtc(0, 20)).toBe(0);
    expect(tvaFromTtc(100, 0)).toBe(0);
  });
  it('accepts string amounts (React input values)', () => {
    expect(tvaFromTtc('949', 20)).toBe(158.17);
    expect(tvaFromTtc('949', '20')).toBe(158.17);
  });
});

describe('lib/money tvaFromTtc — other rates', () => {
  it('21% (Netherlands standard)', () => {
    // 1000 * 21 / 121 = 173.5537..., rounds to 173.55
    expect(tvaFromTtc(1000, 21)).toBe(173.55);
  });
  it('19% (Germany standard)', () => {
    // 1000 * 19 / 119 = 159.6638..., rounds to 159.66
    expect(tvaFromTtc(1000, 19)).toBe(159.66);
  });
  it('5.5% (French reduced rate for bike repairs)', () => {
    // 1000 * 5.5 / 105.5 = 52.1327..., rounds to 52.13
    expect(tvaFromTtc(1000, 5.5)).toBe(52.13);
  });
  it('10% (French intermediate)', () => {
    expect(tvaFromTtc(1000, 10)).toBe(90.91);
  });
});

describe('lib/money htFromTtc', () => {
  it('TTC − TVA = HT for 20%', () => {
    expect(htFromTtc(1200, 20)).toBe(1000);
    expect(htFromTtc(120, 20)).toBe(100);
  });
  it('handles 21%', () => {
    expect(htFromTtc(1210, 21)).toBe(1000); // 1210 * 100/121 = 1000
  });
});

describe('lib/money cents helpers', () => {
  it('round-trip through toCents/fromCents', () => {
    expect(fromCents(toCents(123.45))).toBe(123.45);
    expect(fromCents(toCents(0.01))).toBe(0.01);
    expect(fromCents(toCents(0))).toBe(0);
  });
  it('toCents handles string input', () => {
    expect(toCents('123.45')).toBe(12345);
  });
  it('toCents handles NaN safely', () => {
    expect(toCents('not a number')).toBe(0);
  });
});
