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
  // Common product words
  ['برو', 'Pro'], ['بروا', 'Pro'],
  ['ماكس', 'Max'], ['ماك', 'Max'],
  ['ميني', 'Mini'],
  ['ألترا', 'Ultra'], ['الترا', 'Ultra'],
  ['كومفورت', 'Comfort'],
  ['كروس', 'Cross'], ['كروز', 'Cross'],
  ['ليمتد', 'LIMITED'], ['ليمتيد', 'LIMITED'],
  ['لايت', 'Light'],
  ['ثاندر', 'Thunder'],
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

function transliterateArabicToLatin(text) {
  let result = text;

  // Replace Arabic-spoken English letters
  for (const [ar, en] of ARABIC_TO_LATIN) {
    result = result.replace(new RegExp(ar, 'g'), en);
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
