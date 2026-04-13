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

/**
 * Convert Arabic number words in text to digits
 * "سبعمية وخمسين" → "750"
 * "ألفين وخمسمية" → "2500"
 */
export function normalizeArabicNumbers(text) {
  let result = text;

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

  // Phase 2: Replace standalone number words
  for (const [word, value] of NUMBER_PATTERNS) {
    const regex = new RegExp(`\\b${word}\\b`, 'g');
    result = result.replace(regex, String(value));
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
  ['بي', 'B'], ['سي', 'C'], ['دي', 'D'],
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
  ['بي', 'P'],
  ['آر', 'R'], ['ار', 'R'],
  ['إس', 'S'], ['اس', 'S'],
  ['تي', 'T'],
  ['يو', 'U'],
  ['في', 'V'], ['ڤي', 'V'],
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

  // ── Vitesse Eco specific models (full canonical name in one shot) ──
  ['الفيشن', 'V20 Pro'],
  ['الليمتد برو', 'V20 Limited Pro'],
  ['الليمتد', 'V20 Limited'],
  ['الكروس', 'V20 Cross'],
  ['الماكس', 'V20 Max'],
  ['الميني', 'V20 Mini'],
  ['الدوبل', 'EB30'],
  ['الطوي', 'Q30 Pliable'],
  ['بليبل', 'Pliable'],
  ['بليبول', 'Pliable'],

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
// with explicit Arabic-safe boundaries. They only match when the surrounding
// characters are start/end of string, whitespace, or Arabic/Latin punctuation.
// Word/product/variant mappings (برو, ماكس, الفيشن …) stay as raw substring
// matches per the user instruction: those entries are full words and benefit
// from being able to match inside compound phrases the LLM might emit.
//
// Boundary regex notes:
//   JS \b is defined against \w = [A-Za-z0-9_]. Arabic letters are NOT in \w,
//   so \b never matches inside pure Arabic text. We use explicit lookbehind /
//   lookahead with whitespace + Arabic/Latin punctuation instead.
const BEFORE = '(?<=^|[\\s،.؟!,;])';
const AFTER  = '(?=$|[\\s،.؟!,;])';

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
  'واي',
  'زد', 'زي',
]);

function transliterateArabicToLatin(text) {
  let result = text;

  // Replace Arabic-spoken English letters (longest patterns first).
  // BUG-01c: letter-spelling entries get word boundaries; product/word entries
  // (برو, الفيشن, دوبل باتري …) keep raw substring matching by design.
  for (const [ar, en] of SORTED_ARABIC_TO_LATIN) {
    if (LETTER_MAPPING_SOURCES.has(ar)) {
      const re = new RegExp(`${BEFORE}${ar}${AFTER}`, 'g');
      result = result.replace(re, en);
    } else {
      result = result.replace(new RegExp(ar, 'g'), en);
    }
  }

  // Replace English-spoken numbers
  for (const [ar, num] of ENGLISH_NUMBERS) {
    result = result.replace(new RegExp(`\\b${ar}\\b`, 'g'), num);
  }

  // Clean up: merge letter+number patterns like "V 20" → "V20"
  result = result.replace(/([A-Z])\s+(\d)/g, '$1$2');
  // Clean up: "G T" → "GT"
  result = result.replace(/([A-Z])\s+([A-Z])(?=\s|$|\d)/g, '$1$2');

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
