// BUG-01c: substring corruption fix.
// BUG-01d: Arabic-safe boundaries on standalone number passes.
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
  // After BUG-01d the Arabic number words also normalize to digits, so the
  // post-fix expectation is "no corruption pattern present" — either the
  // word survives intact, or it cleanly becomes a digit. Either is correct.
  it('"بعت بخمسين يورو" must NOT contain خمCن corruption', () => {
    const out = normalizeArabicText('بعت بخمسين يورو');
    expect(out).not.toContain('خمCن');
    expect(out).toContain('50'); // BUG-01d normalizes "بخمسين" → "ب50"
  });

  it('"ألفين وخمسمية" must NOT contain ألVن corruption', () => {
    const out = normalizeArabicText('ألفين وخمسمية');
    expect(out).not.toContain('ألVن');
    expect(out).toContain('2500'); // compound path
  });

  it('"تلاتين دراجة" must NOT contain تلاTن corruption', () => {
    const out = normalizeArabicText('تلاتين دراجة');
    expect(out).not.toContain('تلاTن');
    expect(out).toContain('30'); // BUG-01d normalizes "تلاتين" → "30"
  });

  it('"ستين يورو" must NOT contain ست corruption (no سي matched as C)', () => {
    const out = normalizeArabicText('ستين يورو');
    expect(out).not.toMatch(/[a-zA-Z]ت/); // mixed-token form
    expect(out).toContain('60'); // BUG-01d normalizes "ستين" → "60"
  });

  it('"سبعين" alone must NOT contain سي → C corruption', () => {
    const out = normalizeArabicText('سبعين');
    expect(out).not.toContain('C');
    expect(out).toContain('70'); // BUG-01d normalizes "سبعين" → "70"
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

  // BUG-01d: previously skipped, now passing. The standalone-number pass uses
  // arabicSafeBoundary() with proclitic support, so "بخمسين" → "ب50".
  it('"بعت بخمسين يورو" → contains "50" (FIXED in BUG-01d)', () => {
    expect(normalizeArabicText('بعت بخمسين يورو')).toContain('50');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BUG-01d: Arabic-safe boundaries on the standalone number passes.
// Lines 87 (normalizeArabicNumbers Phase 2) and 317 (ENGLISH_NUMBERS) used
// `\bword\b` which never fires against Arabic. Both now use the shared
// arabicSafeBoundary() helper with proclitic support so prepositional
// clitics ب/ل/و/ف/ك do not block the match.
// ────────────────────────────────────────────────────────────────────────────
describe('BUG-01d: standalone Arabic number normalization', () => {
  it('"بعت بخمسين يورو" → contains "50"', () => {
    expect(normalizeArabicText('بعت بخمسين يورو')).toContain('50');
  });

  it('"ألفين وخمسمية" → contains "2500"', () => {
    expect(normalizeArabicText('ألفين وخمسمية')).toContain('2500');
  });

  it('"ثلاثمية وعشرين" → contains "320"', () => {
    expect(normalizeArabicText('ثلاثمية وعشرين')).toContain('320');
  });

  it('"ألف وستمية" → contains "1600"', () => {
    expect(normalizeArabicText('ألف وستمية')).toContain('1600');
  });

  it('"سبعين" → contains "70"', () => {
    expect(normalizeArabicText('سبعين')).toContain('70');
  });

  // ENGLISH_NUMBERS (line 317) — Arabic spellings of English digits.
  // Same Bug D root cause, same fix.
  it('"ون تو ثري" → contains "1", "2", "3"', () => {
    const out = normalizeArabicText('ون تو ثري');
    expect(out).toContain('1');
    expect(out).toContain('2');
    expect(out).toContain('3');
  });

  // Bug G — FIXED in BUG-01g (COMMIT 3). Phase 0 of normalizeArabicNumbers
  // now handles "<unit> آلاف [و <hundreds> [و <tens>]]" multiplication.
  it('"تسعة آلاف وخمسمية" → contains "9500" (FIXED in BUG-01g)', () => {
    expect(normalizeArabicText('تسعة آلاف وخمسمية')).toContain('9500');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BUG-01g: Arabic compound thousands "X آلاف" multiplication semantics.
// Adds Phase 0 to normalizeArabicNumbers covering 3000-10000 (the
// e-bike sale price range).
// ────────────────────────────────────────────────────────────────────────────
describe('BUG-01g: Arabic compound thousands (آلاف) multiplication', () => {
  it('"تلاتة آلاف" → contains "3000"', () => {
    expect(normalizeArabicText('تلاتة آلاف')).toContain('3000');
  });

  it('"أربعة آلاف وخمسمية" → contains "4500"', () => {
    expect(normalizeArabicText('أربعة آلاف وخمسمية')).toContain('4500');
  });

  it('"خمسة آلاف وستمية وخمسين" → contains "5650"', () => {
    expect(normalizeArabicText('خمسة آلاف وستمية وخمسين')).toContain('5650');
  });

  it('"عشرة آلاف" → contains "10000" (the ten-thousand boundary)', () => {
    expect(normalizeArabicText('عشرة آلاف')).toContain('10000');
  });

  it('"بعت الدراجة بأربعة آلاف يورو" → contains "4000" (real-world phrasing)', () => {
    expect(normalizeArabicText('بعت الدراجة بأربعة آلاف يورو')).toContain('4000');
  });

  it('"اشتريت بثلاثة آلاف وتسعمية" → contains "3900" (proclitic ب prefix)', () => {
    expect(normalizeArabicText('اشتريت بثلاثة آلاف وتسعمية')).toContain('3900');
  });

  // Negative test: bare "آلاف" with no multiplier must NOT crash and must
  // return something graceful. We choose to leave the literal Arabic word
  // intact (no multiplication is possible without a multiplier).
  it('"آلاف" alone → does not crash, returns "آلاف" intact', () => {
    expect(() => normalizeArabicText('آلاف')).not.toThrow();
    expect(normalizeArabicText('آلاف')).toContain('آلاف');
  });

  // Regression: existing 1000/2000 still work after Phase 0 was added
  it('"ألف" still → "1000"', () => {
    expect(normalizeArabicText('ألف')).toContain('1000');
  });

  it('"ألفين وخمسمية" still → "2500"', () => {
    expect(normalizeArabicText('ألفين وخمسمية')).toContain('2500');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BUG-01d compound-number regression suite.
// 28 canonical Arabic spellings spanning 10–10000. After BUG-01d, every
// dictionary-resolvable value should normalize to its digit. Failures here
// surface a NEW bug class — currently the only known one is Bug G ("X آلاف"
// multiplication) which blocks 3000–10000.
// ────────────────────────────────────────────────────────────────────────────
describe('BUG-01d compound-number regression suite (28 values)', () => {
  const CASES = [
    // Tens (UNITS + TENS dictionaries)
    ['عشرة', '10'],
    ['عشرين', '20'],
    ['ثلاثين', '30'],
    ['أربعين', '40'],
    ['خمسين', '50'],
    ['ستين', '60'],
    ['سبعين', '70'],
    ['ثمانين', '80'],
    ['تسعين', '90'],
    // Hundreds (HUNDREDS dictionary)
    ['مية', '100'],
    ['ميتين', '200'],
    ['تلتمية', '300'],
    ['أربعمية', '400'],
    ['خمسمية', '500'],
    ['ستمية', '600'],
    ['سبعمية', '700'],
    ['ثمانمية', '800'],
    ['تسعمية', '900'],
    // Thousands (LARGE dictionary + Bug G territory)
    ['ألف', '1000'],
    ['ألفين', '2000'],
    ['تلاتة آلاف', '3000'],   // Bug G
    ['أربعة آلاف', '4000'],  // Bug G
    ['خمسة آلاف', '5000'],   // Bug G
    ['ستة آلاف', '6000'],    // Bug G
    ['سبعة آلاف', '7000'],   // Bug G
    ['ثمانية آلاف', '8000'], // Bug G
    ['تسعة آلاف', '9000'],   // Bug G
    ['عشرة آلاف', '10000'],  // Bug G
  ];

  // Bug G — FIXED in BUG-01g (COMMIT 3). All 28 values are active.
  for (const [arabic, expected] of CASES) {
    it(`"${arabic}" → contains "${expected}"`, () => {
      expect(normalizeArabicText(arabic)).toContain(expected);
    });
  }
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

  it('"دي خمسين" → contains "D" and "50" (post BUG-01d, "خمسين" normalizes)', () => {
    const out = normalizeArabicText('دي خمسين');
    // BUG-01c: D captured at word boundary, خمسين not corrupted.
    // BUG-01d: خمسين additionally normalizes to "50".
    expect(out).toContain('D');
    expect(out).toContain('50');
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
// ────────────────────────────────────────────────────────────────────────────
// BUG-01: بي → P/B collision. The duplicate ['بي', 'P'] was dead code (B
// won the stable sort). Removed; Persian پي → P added as the only reliable
// spoken-Arabic P disambiguator.
// ────────────────────────────────────────────────────────────────────────────
describe('BUG-01: بي → B, پي → P (collision resolved)', () => {
  it('"بي 20" → "B20" (Arabic ب is always B, never P)', () => {
    expect(normalizeArabicText('بي 20')).toContain('B20');
  });

  it('"بي 20 برو" → "B20 Pro"', () => {
    expect(normalizeArabicText('بي 20 برو')).toContain('B20 Pro');
  });

  it('"پي 20" → "P20" (Persian پ is the only spoken-Arabic P disambiguator)', () => {
    expect(normalizeArabicText('پي 20')).toContain('P20');
  });

  it('"پي 20 برو" → "P20 Pro"', () => {
    expect(normalizeArabicText('پي 20 برو')).toContain('P20 Pro');
  });

  it('"بي" alone → "B", never contains "P"', () => {
    const out = normalizeArabicText('بي');
    expect(out).toContain('B');
    expect(out).not.toContain('P');
  });
});

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
