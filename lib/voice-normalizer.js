// Arabic dialect number normalization - converts spoken numbers to digits
// Supports: Levantine (Syrian, Lebanese, Jordanian, Palestinian) + Gulf (Saudi)

const UNITS = {
  'صفر': 0, 'واحد': 1, 'وحدة': 1, 'واحدة': 1,
  'اثنين': 2, 'ثنتين': 2, 'اثنتين': 2, 'ثنين': 2, 'زوج': 2,
  'ثلاث': 3, 'ثلاثة': 3, 'تلات': 3, 'تلاتة': 3,
  'أربع': 4, 'أربعة': 4, 'اربع': 4, 'اربعة': 4,
  'خمس': 5, 'خمسة': 5,
  'ست': 6, 'ستة': 6,
  'سبع': 7, 'سبعة': 7,
  'ثمان': 8, 'ثمانية': 8, 'تمن': 8, 'تمنية': 8, 'ثماني': 8,
  'تسع': 9, 'تسعة': 9,
  'عشر': 10, 'عشرة': 10,
};

const TEENS = {
  'أحدعش': 11, 'احدعش': 11, 'إحدعشر': 11,
  'اثنعش': 12, 'اطنعش': 12, 'اثناعشر': 12, 'طنعش': 12,
  'ثلاطعش': 13, 'تلطعش': 13, 'ثلاثةعشر': 13, 'تلتعش': 13,
  'أربعطعش': 14, 'اربعتعش': 14, 'أربعةعشر': 14,
  'خمسطعش': 15, 'خمستعش': 15, 'خمسةعشر': 15,
  'ستطعش': 16, 'سطعش': 16, 'ستةعشر': 16,
  'سبعطعش': 17, 'سبعتعش': 17, 'سبعةعشر': 17,
  'ثمنطعش': 18, 'تمنتعش': 18, 'ثمانيةعشر': 18,
  'تسعطعش': 19, 'تسعتعش': 19, 'تسعةعشر': 19,
};

const TENS = {
  'عشرين': 20, 'عشرون': 20,
  'ثلاثين': 30, 'تلاتين': 30, 'ثلاثون': 30,
  'أربعين': 40, 'اربعين': 40, 'أربعون': 40,
  'خمسين': 50, 'خمسون': 50,
  'ستين': 60, 'ستون': 60,
  'سبعين': 70, 'سبعون': 70,
  'ثمانين': 80, 'تمانين': 80, 'ثمانون': 80,
  'تسعين': 90, 'تسعون': 90,
};

const HUNDREDS = {
  'مية': 100, 'مئة': 100, 'ميه': 100,
  'ميتين': 200, 'مئتين': 200, 'ميتان': 200,
  'تلتمية': 300, 'ثلاثمية': 300, 'ثلاثمئة': 300, 'تلاتمية': 300,
  'أربعمية': 400, 'اربعمية': 400, 'أربعمئة': 400,
  'خمسمية': 500, 'خمسمئة': 500,
  'ستمية': 600, 'ستمئة': 600,
  'سبعمية': 700, 'سبعمئة': 700,
  'ثمنمية': 800, 'تمنمية': 800, 'ثمانمئة': 800, 'ثمانمية': 800,
  'تسعمية': 900, 'تسعمئة': 900,
};

const LARGE = {
  'ألف': 1000, 'الف': 1000,
  'ألفين': 2000, 'الفين': 2000,
};

// Build a combined map
const ALL_NUMBERS = { ...UNITS, ...TEENS, ...TENS, ...HUNDREDS, ...LARGE };

// Sort by length descending so longer matches are tried first
const NUMBER_PATTERNS = Object.entries(ALL_NUMBERS)
  .sort((a, b) => b[0].length - a[0].length);

// BUG-01d (and refactored from BUG-01c): shared Arabic-safe boundary helper.
//
// JS \b is defined against \w = [A-Za-z0-9_]. Arabic letters are NOT in \w,
// so \b never fires inside Arabic text and naive `\bword\b` regexes silently
// fail to match Arabic vocabulary. Use explicit lookbehind/lookahead with
// whitespace + Arabic and Latin punctuation as the boundary.
//
// `allowPrefix` enables an optional one-character Arabic prepositional clitic
// (ب ل و ف ك) between the leading boundary and the word. Needed for number
// words because "بخمسين" (with 50), "وخمسين" (and 50), "لمية" (for 100) are
// everyday speech. The clitic is captured in group 1 so the caller can
// re-emit it. Letter-spelling mappings (سي → C, في → V) MUST NOT enable this
// — it would over-match Arabic words that happen to start with one of these
// proclitics.
const ARABIC_BOUNDARY = '\\s،.؟!,;';
const ARABIC_PROCLITIC = '[بلوفك]';

function arabicSafeBoundary(word, { allowPrefix = false } = {}) {
  const lookbehind = `(?<=^|[${ARABIC_BOUNDARY}])`;
  const prefix = allowPrefix ? `(${ARABIC_PROCLITIC}?)` : '';
  const lookahead = `(?=$|[${ARABIC_BOUNDARY}])`;
  return new RegExp(`${lookbehind}${prefix}${word}${lookahead}`, 'g');
}

/**
 * Convert Arabic number words in text to digits
 * "سبعمية وخمسين" → "750"
 * "ألفين وخمسمية" → "2500"
 */
export function normalizeArabicNumbers(text) {
  let result = text;

  // Phase 0: BUG-01g — Arabic compound thousands "X آلاف [و Y [و Z]]".
  //
  // آلاف is the broken plural of ألف and means "thousands"; native usage
  // requires multiplication by the preceding unit (3-10): تلاتة آلاف = 3000,
  // تسعة آلاف = 9000, عشرة آلاف = 10000. Without this pre-pass, آلاف is not
  // in any dictionary and the rest of the pipeline produces unparseable
  // garbage on every e-bike sale priced 3000+ EUR — the exact range Vitesse
  // Eco actually sells in.
  //
  // The regex captures: (multiplier word) آلاف [و (hundreds-or-tens) [و (tens)]].
  // Multiplier may carry an Arabic prepositional clitic (ب/ل/و/ف/ك) which we
  // strip and re-emit, mirroring the BUG-01d allowPrefix mechanism. Multiplier
  // is restricted to dictionary units 3-10; "أحد عشر ألف" (Bug H) and other
  // singular-ألف multi-word multipliers are NOT handled here.
  const thousandsPattern = /(\S+)\s+آلاف(?:\s+و\s*(\S+)(?:\s+و\s*(\S+))?)?/g;
  result = result.replace(thousandsPattern, (match, mult, p2, p3) => {
    let prefix = '';
    let bareMult = mult;
    if (/^[بلوفك]/.test(mult) && ALL_NUMBERS[mult.slice(1)] !== undefined) {
      prefix = mult[0];
      bareMult = mult.slice(1);
    }
    const m = ALL_NUMBERS[bareMult];
    if (m === undefined || m < 3 || m > 10) return match;
    const v2 = p2 ? ALL_NUMBERS[p2] : 0;
    const v3 = p3 ? ALL_NUMBERS[p3] : 0;
    if (p2 && v2 === undefined) return match;
    if (p3 && v3 === undefined) return match;
    return `${prefix}${m * 1000 + (v2 || 0) + (v3 || 0)}`;
  });

  // Phase 1: Replace compound numbers with "و" connector
  // Handle "ألفين وخمسمية" → 2500, "سبعمية وخمسين" → 750
  const compoundPattern = /(\S+)\s+و\s*(\S+)(?:\s+و\s*(\S+))?/g;
  result = result.replace(compoundPattern, (match, p1, p2, p3) => {
    const v1 = ALL_NUMBERS[p1];
    const v2 = ALL_NUMBERS[p2];
    const v3 = p3 ? ALL_NUMBERS[p3] : 0;
    if (v1 !== undefined && v2 !== undefined) {
      return String(v1 + v2 + (v3 || 0));
    }
    return match;
  });

  // Phase 2: Replace standalone number words.
  // BUG-01d: was using `\bword\b` which never matches Arabic (JS \b is
  // defined against \w = [A-Za-z0-9_]). Standalone Arabic numbers like
  // خمسين, بخمسين, مية were silently never normalized. Use the shared
  // Arabic-safe boundary helper with proclitic support so "بخمسين" → "ب50".
  for (const [word, value] of NUMBER_PATTERNS) {
    const regex = arabicSafeBoundary(word, { allowPrefix: true });
    result = result.replace(regex, (_, prefix) => `${prefix}${value}`);
  }

  // Phase 3: Clean up - merge adjacent numbers with و
  result = result.replace(/(\d+)\s*و\s*(\d+)/g, (_, a, b) => {
    const na = parseInt(a);
    const nb = parseInt(b);
    if (na >= 100 && nb <= 99) return String(na + nb);
    if (na >= 1000 && nb < 1000) return String(na + nb);
    if (na >= 100 && nb >= 100 && nb <= 900 && nb % 100 === 0) return String(na + nb);
    return `${a} و ${b}`;
  });

  return result.trim();
}

/**
 * Convert Arabic-spoken English letters to Latin
 * "في 20 برو" → "V20 Pro"
 * "جي تي 20" → "GT-20"
 */
const ARABIC_TO_LATIN = [
  // Letters (longer patterns first to avoid partial matches)
  ['دبليو', 'W'], ['اكس', 'X'], ['إكس', 'X'],
  ['إتش', 'H'], ['اتش', 'H'], ['كيو', 'Q'],
  ['ايه', 'A'], ['أيه', 'A'],
  ['سي', 'C'], ['دي', 'D'],
  ['إي', 'E'], ['اي', 'E'],
  ['إف', 'F'], ['اف', 'F'],
  ['جي', 'G'],
  ['آي', 'I'],
  ['جاي', 'J'],
  ['كي', 'K'], ['كاي', 'K'],
  ['إل', 'L'], ['ال', 'L'],
  ['إم', 'M'], ['ام', 'M'],
  ['إن', 'N'], ['ان', 'N'],
  ['أو', 'O'], ['او', 'O'],
  // BUG-01 (collision fix): the duplicate ['بي', 'P'] that used to live here
  // was DEAD CODE — `['بي', 'B']` above wins on stable sort (both length 2,
  // line 173 comes first in the array). Standard Arabic has no /p/ phoneme,
  // so a seller saying "بي" phonetically always means B. The Persian letter
  // پ (U+067E) is the only reliable typographic disambiguator; we map پي → P
  // for the rare case Whisper produces the Persian character. Any future
  // need to disambiguate spoken Arabic B vs P will require explicit catalog
  // hinting (a known SKU prefix), not loop-level disambiguation.
  ['پي', 'P'],
  ['آر', 'R'], ['ار', 'R'],
  ['إس', 'S'], ['اس', 'S'],
  ['تي', 'T'],
  ['يو', 'U'],
  ['واي', 'Y'],
  ['زد', 'Z'], ['زي', 'Z'],
  // DONE: Fix 1 — expanded product/variant/accessory vocabulary
  // ── Product model words ──
  ['برو', 'Pro'],
  ['بروا', 'Pro'],
  ['ماكس', 'Max'],
  ['ماكسي', 'Max'],
  ['ميني', 'Mini'],
  ['ألترا', 'Ultra'],
  ['الترا', 'Ultra'],
  ['كروس', 'Cross'],
  ['كروز', 'Cross'],
  ['ليمتد', 'Limited'],
  ['ليمتيد', 'Limited'],
  ['المحدود', 'Limited'],
  ['لايت', 'Light'],
  ['ثاندر', 'Thunder'],
  ['كومفورت', 'Comfort'],

  // ── Variant: Colors ──
  ['نوار', 'Noir'],
  ['نور', 'Noir'],
  ['أسود', 'Noir'],
  ['سوداء', 'Noir'],
  ['أسودة', 'Noir'],
  ['غري', 'Gris'],
  ['غريه', 'Gris'],
  ['رمادي', 'Gris'],
  ['رمادية', 'Gris'],
  ['بلان', 'Blanc'],
  ['أبيض', 'Blanc'],
  ['بيضاء', 'Blanc'],
  ['بلو', 'Bleu'],
  ['أزرق', 'Bleu'],
  ['زرقاء', 'Bleu'],
  ['روج', 'Rouge'],
  ['أحمر', 'Rouge'],
  ['حمراء', 'Rouge'],
  ['فيرت', 'Vert'],
  ['أخضر', 'Vert'],
  ['خضراء', 'Vert'],
  ['مارون', 'Marron'],
  ['بني', 'Marron'],
  ['فيوليه', 'Violet'],
  ['بنفسجي', 'Violet'],
  ['موف', 'Violet'],
  ['كاكي', 'Kaki'],

  // ── Variant: Battery ──
  ['دوبل باتري', 'Double Batterie'],
  ['دبل باتري', 'Double Batterie'],
  ['باتريتين', 'Double Batterie'],
  ['بطاريتين', 'Double Batterie'],
  ['سينجل باتري', 'Simple Batterie'],
  ['باتري وحدة', 'Simple Batterie'],
  ['باتري واحدة', 'Simple Batterie'],

  // ── Accessory types ──
  ['هيلمت', 'Helmet'],
  ['كاسك', 'Casque'],
  ['تشارجر', 'Charger'],
  ['لوك', 'Lock'],
  ['باسكت', 'Basket'],
  ['سادل', 'Saddle'],
  ['تاير', 'Tire'],
  ['فرامل', 'Frein'],
  ['كيبل', 'Cable'],
  ['موتور', 'Motor'],
  ['كنترولر', 'Controller'],
  ['ديسبلاي', 'Display'],
  ['سبيدوميتر', 'Speedometer'],
];

// English-spoken numbers
const ENGLISH_NUMBERS = [
  ['زيرو', '0'],
  ['ون', '1'], ['وان', '1'],
  ['تو', '2'], ['طو', '2'],
  ['ثري', '3'], ['تري', '3'],
  ['فور', '4'],
  ['فايف', '5'],
  ['سكس', '6'], ['سيكس', '6'],
  ['سفن', '7'], ['سيفن', '7'],
  ['ايت', '8'], ['إيت', '8'],
  ['ناين', '9'],
  ['تن', '10'],
  ['توينتي', '20'], ['تونتي', '20'],
  ['ثيرتي', '30'],
  ['فورتي', '40'],
  ['فيفتي', '50'],
  ['هاندرد', '100'], ['هندرد', '100'],
  ['ثاوزند', '1000'], ['ثاوزاند', '1000'],
];

// DONE: Fix 1 (followup) — sort by source length descending so multi-word
// product names ("الفيشن", "الليمتد برو") are matched BEFORE the single-letter
// Arabic spellings ("ال" → "L", "في" → "V"). Without this, "الفيشن" used to
// become "LVشن" because the single-letter mappings fired first.
const SORTED_ARABIC_TO_LATIN = [...ARABIC_TO_LATIN].sort((a, b) => b[0].length - a[0].length);

// BUG-01c fix: Arabic-safe word boundaries on letter mappings.
//
// The transliteration loop used to apply every entry as a global substring
// replacement. The 2-char letter mappings (سي → C, في → V, تي → T, دي → D, جي → G,
// يو → U …) were matching inside unrelated Arabic words — most critically inside
// compound number words. Examples of the corruption:
//   خمسين  → خمCن    (سي matched)
//   ألفين  → ألVن    (في matched)
//   تلاتين → تلاTن   (تي matched)
//   يورو   → Uرو     (يو matched)
// This silently broke any sale phrase containing those numbers.
//
// Fix: letter mappings (the `LETTER_MAPPING_SOURCES` set below) are now applied
// with the shared `arabicSafeBoundary()` helper (BUG-01d refactor). They only
// match when surrounding characters are start/end of string, whitespace, or
// Arabic/Latin punctuation. Critically, `allowPrefix` stays OFF here — letter
// mappings must NOT eat a leading Arabic proclitic, otherwise unrelated words
// starting with ب/ل/و/ف/ك would be over-matched.
// Word/product/variant mappings (برو, ماكس, الفيشن …) stay as raw substring
// matches per the user instruction: those entries are full words and benefit
// from being able to match inside compound phrases the LLM might emit.

// The 33 letter-spelling Arabic strings from ARABIC_TO_LATIN (lines 110-132).
// Anything in this set is matched with word boundaries.
const LETTER_MAPPING_SOURCES = new Set([
  'دبليو',
  'اكس', 'إكس',
  'إتش', 'اتش',
  'كيو',
  'ايه', 'أيه',
  'بي',
  'سي',
  'دي',
  'إي', 'اي',
  'إف', 'اف',
  'جي',
  'آي',
  'جاي',
  'كي', 'كاي',
  'إل', 'ال',
  'إم', 'ام',
  'إن', 'ان',
  'أو', 'او',
  'آر', 'ار',
  'إس', 'اس',
  'تي',
  'يو',
  'في', 'ڤي',
  'پي',  // BUG-01: Persian پ is the only reliable spoken-Arabic P disambiguator
  'واي',
  'زد', 'زي',
]);

function transliterateArabicToLatin(text) {
  let result = text;

  // Replace Arabic-spoken English letters (longest patterns first).
  // BUG-01c → BUG-01d refactor: letter-spelling entries use the shared
  // arabicSafeBoundary() helper (no proclitic prefix). Product/word entries
  // (برو, الفيشن, دوبل باتري …) keep raw substring matching by design.
  for (const [ar, en] of SORTED_ARABIC_TO_LATIN) {
    if (LETTER_MAPPING_SOURCES.has(ar)) {
      result = result.replace(arabicSafeBoundary(ar), en);
    } else {
      result = result.replace(new RegExp(ar, 'g'), en);
    }
  }

  // Replace Arabic-spoken English numbers (ون → 1, تو → 2 …).
  // BUG-01d: was using `\bword\b` — same Arabic-boundary failure as Phase 2
  // of normalizeArabicNumbers. Use the shared helper with proclitic support.
  for (const [ar, num] of ENGLISH_NUMBERS) {
    const re = arabicSafeBoundary(ar, { allowPrefix: true });
    result = result.replace(re, (_, prefix) => `${prefix}${num}`);
  }

  return result;
}

// BUG-01a + BUG-01b: letter+number / letter+letter token merge.
//
// Two related bugs fixed together:
//
// BUG-01a — single-pass cleanup. The previous implementation ran the
// `([A-Z])\s+([A-Z])` and `([A-Z])\s+(\d)` regexes exactly once each.
// JavaScript's global replace does not re-scan overlapping matches, so
// "B M W" only collapsed to "BM W" on the first pass — the trailing W
// was never joined. Three-or-more-letter product codes (BMW, GTX, RTX)
// were broken. Loop the cleanup until a fixed point is reached.
//
// BUG-01b — cleanup-before-number-normalization ordering. The cleanup
// used to live inside transliterateArabicToLatin(), which runs BEFORE
// normalizeArabicNumbers() in the pipeline. So `في عشرين برو` became
// `V عشرين Pro` (cleanup can't merge: no digit yet), then
// normalizeArabicNumbers produced `V 20 Pro` — but by then the cleanup
// pass had finished and the V+20 merge was lost. Fix: extract cleanup
// into its own function and call it from normalizeArabicText() AFTER
// both translit and number normalization, so it sees the digits.
function mergeLetterNumberTokens(text) {
  let result = text;
  let prev;
  do {
    prev = result;
    // "G T" → "GT" (standalone letters with another letter next to them)
    result = result.replace(/([A-Z])\s+([A-Z])(?=\s|$|\d)/g, '$1$2');
    // "V 20" → "V20" (letter followed by a number)
    result = result.replace(/([A-Z])\s+(\d)/g, '$1$2');
  } while (result !== prev);
  return result;
}

/**
 * Normalize Arabic text for better LLM processing
 */
export function normalizeArabicText(text) {
  let result = text;
  result = result.replace(/ـ/g, '');
  result = transliterateArabicToLatin(result);
  result = normalizeArabicNumbers(result);
  result = result.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  // BUG-01a + BUG-01b: run letter+number merge AFTER number normalization
  // so it sees both the Latin letters and the digits.
  result = mergeLetterNumberTokens(result);
  return result.trim();
}

/**
 * Deep normalization for entity matching (not for display)
 * Makes two different spellings of the same word identical
 */
export function normalizeForMatching(text) {
  if (!text) return '';
  let r = text;
  r = r.replace(/[إأآٱ]/g, 'ا');       // Alif variants → ا
  r = r.replace(/ة/g, 'ه');             // Taa Marbuta → Ha
  r = r.replace(/ى/g, 'ي');             // Alif Maqsura → Yaa
  r = r.replace(/ؤ/g, 'و');             // Hamza on Waw → Waw
  r = r.replace(/ئ/g, 'ي');             // Hamza on Yaa → Yaa
  r = r.replace(/ء/g, '');              // Standalone Hamza → remove
  r = r.replace(/ـ/g, '');              // Tatweel
  r = r.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)); // Indic → Western
  r = r.replace(/[^\u0600-\u06FF\w\s]/g, ''); // Remove punctuation
  r = r.replace(/\s+/g, ' ').trim();    // Collapse whitespace
  r = r.toLowerCase();                   // Lowercase Latin
  return r;
}
