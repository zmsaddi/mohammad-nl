// Pure unit tests for the shared filter engine (no DB, no React).
// Run with:  npx vitest run tests/filter-engine.test.js

import { describe, it, expect } from 'vitest';
import { normalizeArabic, matchesText, dateInRange, applyFilters } from '../lib/filter-engine.js';

describe('normalizeArabic', () => {
  it('strips tashkeel/diacritics and tatweel', () => {
    expect(normalizeArabic('مُحَمَّد')).toBe('محمد');
    expect(normalizeArabic('مـــحـــمـــد')).toBe('محمد'); // tatweel removed
  });
  it('folds alef/taa-marbuta/alef-maqsura/hamza variants', () => {
    expect(normalizeArabic('أحمد')).toBe(normalizeArabic('احمد'));
    expect(normalizeArabic('إسلام')).toBe(normalizeArabic('اسلام'));
    expect(normalizeArabic('فاطمة')).toBe(normalizeArabic('فاطمه'));
    expect(normalizeArabic('عيسى')).toBe(normalizeArabic('عيسي'));
  });
  it('folds Arabic-Indic and Persian digits to ASCII', () => {
    expect(normalizeArabic('٠٦١٢')).toBe('0612');
    expect(normalizeArabic('۰۶۱۲')).toBe('0612');
  });
  it('lowercases, trims, and collapses whitespace; null-safe', () => {
    expect(normalizeArabic('  V20   PRO  ')).toBe('v20 pro');
    expect(normalizeArabic(null)).toBe('');
    expect(normalizeArabic(undefined)).toBe('');
  });
});

describe('matchesText — Arabic-aware substring, token-AND', () => {
  const T = (target, query, expected) =>
    it(`"${query}" ${expected ? '⊂' : '⊄'} "${Array.isArray(target) ? target.join('|') : target}"`, () => {
      expect(matchesText(target, query)).toBe(expected);
    });

  T('محمد علي', 'مُحَمَّد', true);        // tashkeel
  T('احمد سمير', 'أحمد', true);            // alef fold
  T('فاطمة الزهراء', 'فاطمه', true);       // taa marbuta
  T('عيسى', 'عيسي', true);                 // alef maqsura
  T('Ali Ahmad', 'ahmad ali', true);       // token-AND, order independent
  T('Ahmad Ali', 'ali ahmad', true);       // reversed order
  T('Mohammad Ahmad', 'ahmad', true);      // single token substring
  T('Ahmad Ali', 'ahmadali', false);       // no space → one token, absent
  T('Ahmad', 'samir ahmad', false);        // missing token ⇒ AND fails (no wrong match!)
  T('V20 PRO - BLACK', 'v20 pro', true);   // case fold + tokens
  T('V20 PRO - BLACK', 'v20pro', false);   // spaceless ≠ "v20 pro"
  T('V20 PRO - BLACK', 'BLACK', true);     // suffix token
  T('0612345', '٠٦١٢', true);              // indic digits on a phone
  T(['SL-20260514-362234U07'], 'SL-2026', true);  // ref-code prefix
  T(['SL-20260514-362234U07'], '2026', true);     // numeric substring in ref

  it('empty query matches everything; null haystack does not match', () => {
    expect(matchesText('anything', '')).toBe(true);
    expect(matchesText('anything', '   ')).toBe(true);
    expect(matchesText(null, 'x')).toBe(false);
  });
  it('joins multiple fields so a query can span them', () => {
    expect(matchesText(['Ahmad Ali', '0612345', 'SL-99'], 'ahmad 0612')).toBe(true);
    expect(matchesText(['Ahmad Ali', '0612345'], 'ahmad 9999')).toBe(false);
  });
});

describe('dateInRange — inclusive, ISO-day normalized', () => {
  it('inclusive on both ends', () => {
    expect(dateInRange('2026-05-10', '2026-05-01', '2026-05-31')).toBe(true);
    expect(dateInRange('2026-05-01', '2026-05-01', '2026-05-31')).toBe(true);
    expect(dateInRange('2026-05-31', '2026-05-01', '2026-05-31')).toBe(true);
  });
  it('excludes outside the range', () => {
    expect(dateInRange('2026-04-30', '2026-05-01', '')).toBe(false);
    expect(dateInRange('2026-06-01', '', '2026-05-31')).toBe(false);
  });
  it('normalizes a TIMESTAMP to its day so same-day rows are included', () => {
    expect(dateInRange('2026-05-21T14:30:00Z', '2026-05-21', '2026-05-21')).toBe(true);
    expect(dateInRange('2026-05-21 09:00:00', '', '2026-05-21')).toBe(true);
  });
  it('no bounds → pass; empty value with a bound → excluded', () => {
    expect(dateInRange('whatever', '', '')).toBe(true);
    expect(dateInRange(null, '2026-01-01', '')).toBe(false);
  });
});

describe('applyFilters — AND composition', () => {
  const rows = [{ a: 1 }, { a: 2 }, { a: 3 }];
  it('no predicates → all rows', () => {
    expect(applyFilters(rows, [])).toHaveLength(3);
  });
  it('ANDs predicates and ignores falsy ones', () => {
    expect(applyFilters(rows, [(r) => r.a > 1, false, (r) => r.a < 3])).toEqual([{ a: 2 }]);
  });
  it('non-array rows → empty array', () => {
    expect(applyFilters(null, [(r) => r])).toEqual([]);
  });
});
