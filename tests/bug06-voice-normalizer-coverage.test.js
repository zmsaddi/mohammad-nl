// BUG-06: voice-normalizer coverage backfill.
//
// The BUG-01 series produced 104 voice-normalizer tests, but an audit of
// those tests against the original BUG-06 spec ("at least 3 tests per
// exported function; categories: numerals, alif, tatweel, compound,
// edge cases") found gaps:
//
//   - normalizeArabicNumbers had 2 direct tests, needs 3
//   - normalizeForMatching had 1 direct test, needs 3
//   - Arabic-Indic numerals (٠-٩ → 0-9) had no tests
//   - Tatweel stripping (ـ) had no tests
//   - Edge cases (empty, whitespace-only, punctuation-only) had no tests
//
// This file closes every gap. Kept as a separate file (not appended to
// voice-normalizer.test.js) so that a future `git revert BUG-06` removes
// the coverage backfill atomically without touching the BUG-01 suite.
//
// Run with:  npx vitest run tests/bug06-voice-normalizer-coverage.test.js

import { describe, it, expect } from 'vitest';
import {
  normalizeArabicText,
  normalizeArabicNumbers,
  normalizeForMatching,
} from '../lib/voice-normalizer.js';

describe('BUG-06: normalizeArabicNumbers — third direct test (compound path)', () => {
  it('"عشرين" → "20" (standalone twenty)', () => {
    expect(normalizeArabicNumbers('عشرين')).toContain('20');
  });
});

describe('BUG-06: normalizeForMatching — per-function coverage backfill', () => {
  it('strips tatweel (kashida) from matched text', () => {
    // مرحـــبا (with 3 tatweel chars) → مرحبا
    expect(normalizeForMatching('مرحـــبا')).toBe('مرحبا');
  });

  it('converts Arabic-Indic digits ٠-٩ to Western 0-9', () => {
    expect(normalizeForMatching('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('normalizes hamzat-wasl ٱ to plain alif ا (alif category, fourth variant)', () => {
    // The existing BUG-01 suite covers أ/ا/إ/آ but not ٱ (U+0671).
    expect(normalizeForMatching('ٱلرحمن')).toBe('الرحمن');
  });
});

describe('BUG-06: Arabic-Indic numeral category coverage', () => {
  it('normalizeArabicText converts ٥٠ to 50 inside a real phrase', () => {
    expect(normalizeArabicText('بعت ب٥٠ يورو')).toContain('50');
  });

  it('normalizeArabicText converts a full ٠-٩ run to 0-9', () => {
    expect(normalizeArabicText('٠١٢٣٤٥٦٧٨٩')).toContain('0123456789');
  });
});

describe('BUG-06: tatweel stripping category coverage on main entry point', () => {
  it('normalizeArabicText output never contains a tatweel char', () => {
    // Tatweel is stripped in the first pass of normalizeArabicText (line 427
    // of voice-normalizer.js). The output must never carry one through.
    const out = normalizeArabicText('مرحـــبا يا صـــديقي');
    expect(out).not.toContain('ـ');
  });
});

describe('BUG-06: edge-case category coverage', () => {
  it('normalizeArabicText on empty string → empty string, no throw', () => {
    expect(() => normalizeArabicText('')).not.toThrow();
    expect(normalizeArabicText('')).toBe('');
  });

  it('normalizeArabicText on whitespace-only input → empty string after trim', () => {
    expect(normalizeArabicText('   ')).toBe('');
  });

  it('normalizeArabicText on punctuation-only input → string, no throw', () => {
    expect(() => normalizeArabicText('!!!؟؟')).not.toThrow();
    expect(typeof normalizeArabicText('!!!؟؟')).toBe('string');
  });

  it('normalizeForMatching on empty string → empty string', () => {
    expect(normalizeForMatching('')).toBe('');
  });

  it('normalizeForMatching on whitespace-only input → empty string', () => {
    expect(normalizeForMatching('   ')).toBe('');
  });

  it('normalizeArabicNumbers on empty string → empty string, no throw', () => {
    expect(() => normalizeArabicNumbers('')).not.toThrow();
    expect(normalizeArabicNumbers('')).toBe('');
  });
});
