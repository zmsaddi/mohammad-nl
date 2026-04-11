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
    if (na >= 100 && nb < 100) return String(na + nb);
    if (na >= 1000 && nb < 1000) return String(na + nb);
    return `${a} و ${b}`;
  });

  return result.trim();
}

/**
 * Normalize Arabic text for better LLM processing
 */
export function normalizeArabicText(text) {
  let result = text;

  // Remove Tatweel only (don't normalize Alif - it breaks name matching)
  result = result.replace(/ـ/g, '');

  // Normalize numbers (dialect words to digits)
  result = normalizeArabicNumbers(result);

  // Convert Arabic-Indic numerals to Western
  result = result.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

  return result.trim();
}

/**
 * Fuzzy match a name against a list of known names
 * Returns the best match or null
 */
export function fuzzyMatchName(input, knownNames) {
  if (!input || !knownNames.length) return null;

  const normalized = input.replace(/[إأآ]/g, 'ا').trim().toLowerCase();

  // Exact match
  const exact = knownNames.find((n) => n.toLowerCase() === normalized);
  if (exact) return { name: exact, confidence: 'high' };

  // Contains match
  const contains = knownNames.find((n) =>
    n.toLowerCase().includes(normalized) || normalized.includes(n.toLowerCase())
  );
  if (contains) return { name: contains, confidence: 'medium' };

  // Partial word match
  const words = normalized.split(/\s+/);
  const partial = knownNames.find((n) =>
    words.some((w) => w.length > 2 && n.toLowerCase().includes(w))
  );
  if (partial) return { name: partial, confidence: 'low' };

  return null;
}
