// BUG-01c: substring corruption fix.
// Tests for lib/voice-normalizer.js — strictly normalizer-scope.
// Run with:  npx vitest run tests/voice-normalizer.test.js
import { describe, it, expect } from 'vitest';
import { normalizeArabicText, normalizeArabicNumbers, normalizeForMatching } from '../lib/voice-normalizer.js';

// ────────────────────────────────────────────────────────────────────────────
// BUG-01c: corruption-prevention. Each Arabic compound number used to be
// silently corrupted by single-letter mappings (سي → C inside خمسين, في → V
// inside ألفين, etc.). After the word-boundary fix, the Arabic substrings
// must survive the transliteration pass intact.
// ────────────────────────────────────────────────────────────────────────────
describe('BUG-01c: substring corruption prevention', () => {
  it('"بعت بخمسين يورو" must contain خمسين uncorrupted (no خمCن)', () => {
    const out = normalizeArabicText('بعت بخمسين يورو');
    expect(out).toContain('خمسين');
    expect(out).not.toContain('خمCن');
  });

  it('"ألفين وخمسمية" must contain ألفين uncorrupted (no ألVن)', () => {
    const out = normalizeArabicText('ألفين وخمسمية');
    // The compound regex DOES normalize this to "2500" (which is correct),
    // so we assert the corruption pattern is absent rather than the raw word
    expect(out).not.toContain('ألVن');
  });

  it('"تلاتين دراجة" must contain تلاتين uncorrupted (no تلاTن)', () => {
    const out = normalizeArabicText('تلاتين دراجة');
    expect(out).toContain('تلاتين');
    expect(out).not.toContain('تلاTن');
  });

  it('"ستين يورو" must contain ستين uncorrupted', () => {
    const out = normalizeArabicText('ستين يورو');
    expect(out).toContain('ستين');
  });

  it('"سبعين" alone must remain سبعين (the سي substring must NOT corrupt it)', () => {
    const out = normalizeArabicText('سبعين');
    expect(out).toContain('سبعين');
    expect(out).not.toContain('C');
  });

  it('"يورو" must NOT become Uرو (the يو substring must NOT corrupt it)', () => {
    const out = normalizeArabicText('يورو');
    expect(out).toContain('يورو');
    expect(out).not.toMatch(/U/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BUG-01c full pipeline verification.
// "ألفين وخمسمية" works because the compound regex handles X و Y patterns.
// "بعت بخمسين يورو" → "50" CANNOT work yet — it depends on standalone-number
// normalization, which has its own \b-vs-Arabic bug (Discovered Issue: Bug D
// in UPGRADE_LOG.md). That test is skipped here and will be picked up by a
// follow-up task.
// ────────────────────────────────────────────────────────────────────────────
describe('BUG-01c: full-pipeline normalization', () => {
  it('"ألفين وخمسمية" → contains "2500" (compound path)', () => {
    expect(normalizeArabicText('ألفين وخمسمية')).toContain('2500');
  });

  it.skip('"بعت بخمسين يورو" → contains "50" (BLOCKED by Bug D — standalone \\b)', () => {
    // Bug D: normalizeArabicNumbers uses /\bword\b/ which never matches inside
    // Arabic text because JS \b is defined against [A-Za-z0-9_]. Standalone
    // Arabic numbers ("خمسين", "بخمسين") are NOT normalized today; only the
    // compound "X و Y" form works (because that regex uses \S+, not \b).
    // Tracked under "## Discovered Issues" in UPGRADE_LOG.md.
    expect(normalizeArabicText('بعت بخمسين يورو')).toContain('50');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BUG-01c regression sweep. Mass-tests every common Arabic compound-number
// word to assert NONE of them get corrupted into mixed Arabic+Latin tokens
// by the transliteration pass. Strong invariant: no whitespace-separated
// token may contain BOTH Arabic letters AND uppercase Latin letters.
// ────────────────────────────────────────────────────────────────────────────
describe('BUG-01c regression sweep — Arabic number words must not be corrupted', () => {
  // Common business amounts the seller might say. Curated from the actual
  // vocabulary in lib/voice-normalizer.js (UNITS, TENS, HUNDREDS, LARGE).
  const NUMBER_WORDS = [
    // Tens
    'عشرين', 'ثلاثين', 'تلاتين', 'أربعين', 'اربعين', 'خمسين', 'ستين', 'سبعين', 'ثمانين', 'تمانين', 'تسعين',
    // Hundreds
    'مية', 'مئة', 'ميتين', 'مئتين', 'تلتمية', 'ثلاثمية', 'أربعمية', 'اربعمية',
    'خمسمية', 'ستمية', 'سبعمية', 'ثمنمية', 'تمنمية', 'تسعمية',
    // Thousands
    'ألف', 'الف', 'ألفين', 'الفين',
    // Currency / common context words that contain dangerous substrings
    'يورو',  // contains يو (would have become U)
    'دينار', // safe but worth checking
    'درهم',
  ];

  // Strong invariant helper
  function hasMixedToken(text) {
    for (const tok of text.split(/\s+/)) {
      if (!tok) continue;
      const hasArabic = /[\u0600-\u06FF]/.test(tok);
      const hasLatinUpper = /[A-Z]/.test(tok);
      if (hasArabic && hasLatinUpper) return tok;
    }
    return null;
  }

  for (const word of NUMBER_WORDS) {
    it(`"${word}" survives transliteration with no Arabic+Latin mixing`, () => {
      const out = normalizeArabicText(word);
      // Either preserved as Arabic, or fully converted to digits, but never mixed.
      // (Some words like "خمسمية" become "500" via the standalone number map at
      // the time the compound regex doesn't catch them.)
      const mixed = hasMixedToken(out);
      expect(mixed).toBe(null);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// BUG-01c: existing positive paths must still work after the fix.
// We need to confirm that adding word boundaries to letter mappings doesn't
// break the cases where the user actually says spelled-out letters.
// ────────────────────────────────────────────────────────────────────────────
describe('BUG-01c: positive paths still work (letters in standalone position)', () => {
  it('"جي تي 20" → "GT20" (letters with proper word boundaries)', () => {
    const out = normalizeArabicText('جي تي 20');
    expect(out).toContain('G');
    expect(out).toContain('T');
    expect(out).toContain('20');
  });

  it('"إس 20 برو" → "S20 Pro" (letter prefix, then product word)', () => {
    expect(normalizeArabicText('إس 20 برو')).toContain('S20 Pro');
  });

  it('"دي خمسين" → contains "D" and "خمسين" both preserved', () => {
    const out = normalizeArabicText('دي خمسين');
    // After the fix: D is captured (دي is at word boundary), خمسين is left alone
    expect(out).toContain('D');
    expect(out).toContain('خمسين');
    // And critically: NOT corrupted into "D خمCن"
    expect(out).not.toContain('خمCن');
  });

  it('"الفيشن" → "V20 Pro" (joined product word still matches; loop is unchanged for non-letter entries)', () => {
    expect(normalizeArabicText('الفيشن')).toContain('V20 Pro');
  });

  it('"دوبل باتري" → "Double Batterie" (multi-word product word still matches)', () => {
    expect(normalizeArabicText('دوبل باتري')).toContain('Double Batterie');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Sanity tests for the existing exported helpers (kept minimal — full coverage
// expansion is BUG-06 in the same sprint).
// ────────────────────────────────────────────────────────────────────────────
describe('normalizeForMatching — Arabic letter unification', () => {
  it('"أ ا إ آ" → all four become "ا"', () => {
    expect(normalizeForMatching('أ ا إ آ')).toBe('ا ا ا ا');
  });
});

describe('normalizeArabicNumbers — compound path (Bug D unaffected)', () => {
  it('"سبعمية وخمسين" → "750"', () => {
    expect(normalizeArabicNumbers('سبعمية وخمسين')).toContain('750');
  });

  it('"ألفين وخمسمية" → "2500"', () => {
    expect(normalizeArabicNumbers('ألفين وخمسمية')).toContain('2500');
  });
});
