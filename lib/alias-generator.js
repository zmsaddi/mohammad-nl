// FEAT-01 — Alias generator for cold-start entity recognition.
//
// Three named exports, one per entity type. Each takes the canonical English
// name and returns { aliases: string[], skip: boolean, reason?: string }.
//
//   generateProductAliases(name)   — model-number patterns (V20 Pro, GT-2000)
//   generateSupplierAliases(name)  — company name patterns
//   generateClientAliases(name)    — person name patterns
//
// Design constraints (locked in via the architectural review):
//   - Mechanical transliteration ONLY. Cultural nicknames like "الفيشن" for
//     V20 Pro cannot be derived algorithmically and live in the trimmed
//     seedProductAliases() in lib/db.js.
//   - Levantine + Gulf dialect variants are produced when they meaningfully
//     diverge (8 → "ثمانية"+"تمنية", 400 → "أربعمائة"+"أربعمية", etc.).
//   - For "V20 Pro - Noir - NFC", only the BASE name "V20 Pro" is used to
//     generate aliases. Variant suffixes are dropped here but preserved in
//     the canonical entity name. Variant-specific aliases are deferred to a
//     follow-up commit if live testing shows demand.
//   - Numeric specs are transliterated literally (48V → "في تمنية وأربعين"
//     instead of "أربعين فولت"). Context awareness is deferred.
//   - Cap 5 aliases per product, 4 per supplier/client. Quality > quantity.
//     The confirmed_action learning loop handles the long tail.
//   - Each alias capped at 50 chars. Internal dedup by normalized form
//     (via normalizeForMatching) before returning.
//
// Persistence and cache invalidation are NOT this file's responsibility.
// The integration commit (Commit 2 of FEAT-01) adds a wrapper in lib/db.js
// that calls these generators, persists via a new addGeneratedAlias() with
// first-writer-wins semantics, and invalidates the resolver Fuse cache.

import { normalizeForMatching } from './voice-normalizer.js';

// =============================================================================
// DICTIONARIES — frozen at the bottom so iteration order is fixed
// =============================================================================

// Numbers 0-30 individually, plus tens 40-100, plus 200-1000 in hundreds and
// 2000-3000 in thousands. Multi-element arrays mean Levantine + Gulf variants;
// the first element is the more common form in casual speech.
const NUMBER_WORDS = {
  0:    ['صفر'],
  1:    ['واحد'],
  2:    ['اثنين', 'تنين'],
  3:    ['ثلاثة', 'تلاتة'],
  4:    ['أربعة'],
  5:    ['خمسة'],
  6:    ['ستة'],
  7:    ['سبعة'],
  8:    ['ثمانية', 'تمنية'],
  9:    ['تسعة'],
  10:   ['عشرة'],
  11:   ['أحد عشر', 'حداشر'],
  12:   ['اثني عشر', 'تناشر'],
  13:   ['ثلاثة عشر', 'تلتاشر'],
  14:   ['أربعة عشر', 'أربعتاشر'],
  15:   ['خمسة عشر', 'خمستاشر'],
  16:   ['ستة عشر', 'ستاشر'],
  17:   ['سبعة عشر', 'سبعتاشر'],
  18:   ['ثمانية عشر', 'تمنتاشر'],
  19:   ['تسعة عشر', 'تسعتاشر'],
  20:   ['عشرين'],
  // FEAT-01.1: 21-29 deliberately NOT in this table. They are derived by the
  // compositional path in numberToWords() so dialect variants of the ones
  // digit (8 → "ثمانية"+"تمنية") cross-product correctly:
  //   28 → "ثمانية وعشرين" + "تمنية وعشرين"
  // Keeping explicit entries here would short-circuit the cross-product and
  // emit only one form. Teens 11-19 stay explicit because Arabic teens are
  // irregular and the compositional "X و Y" template would produce wrong
  // forms (13 is "ثلاثة عشر", not "ثلاثة وعشرة").
  30:   ['ثلاثين', 'تلاتين'],
  40:   ['أربعين'],
  50:   ['خمسين'],
  60:   ['ستين'],
  70:   ['سبعين'],
  80:   ['ثمانين', 'تمانين'],
  90:   ['تسعين'],
  100:  ['مية', 'مائة'],
  200:  ['ميتين', 'مئتين'],
  300:  ['تلتمية', 'ثلاثمائة'],
  400:  ['أربعمية', 'أربعمائة'],
  500:  ['خمسمية', 'خمسمائة'],
  600:  ['ستمية', 'ستمائة'],
  700:  ['سبعمية', 'سبعمائة'],
  800:  ['تمنمية', 'ثمانمائة'],
  900:  ['تسعمية', 'تسعمائة'],
  1000: ['ألف'],
  2000: ['ألفين'],
  3000: ['ثلاثة آلاف', 'تلاتة آلاف'],
};

// English letter prefixes used in product naming. Multi-letter pairs (GT, EB)
// are matched first; single letters are the fallback.
const LETTER_PAIRS = {
  GT: 'جي تي',
  EB: 'إي بي',
  KW: 'كي دبليو',
  V:  'في',
  S:  'إس',
  H:  'إتش',
  Q:  'كيو',
  C:  'سي',
  E:  'إي',
  D:  'دي',
  B:  'بي',
  P:  'پي',
  X:  'إكس',
  Z:  'زد',
  R:  'آر',
  T:  'تي',
  M:  'إم',
  N:  'إن',
  L:  'إل',
  K:  'كي',
  G:  'جي',
  F:  'إف',
  J:  'جاي',
  Y:  'واي',
  W:  'دبليو',
  A:  'إيه',
  O:  'أوه',
  U:  'يو',
  I:  'آي',
};

// Common product / model descriptor words (English → single Arabic form).
const PRODUCT_WORDS = {
  'pro':       'برو',
  'mini':      'ميني',
  'max':       'ماكس',
  'ultra':     'ألترا',
  'limited':   'ليمتد',
  'cross':     'كروس',
  'comfort':   'كومفورت',
  'special':   'سبيشال',
  'edition':   'إديشن',
  'light':     'لايت',
  'inch':      'إنش',
  'city':      'سيتي',
  'plus':      'بلس',
  'premium':   'بريميوم',
  'standard':  'ستاندرد',
  'pliable':   'قابلة للطي',
  'foldable':  'قابلة للطي',
};

// Color words. Multi-element arrays mean multiple acceptable Arabic forms
// (typically Arabic word + transliterated English/French).
const COLOR_WORDS = {
  'black':  ['أسود', 'بلاك'],
  'white':  ['أبيض', 'وايت'],
  'grey':   ['رمادي'],
  'gray':   ['رمادي'],
  'silver': ['سيلفر', 'فضي'],
  'blue':   ['أزرق', 'بلو'],
  'green':  ['أخضر', 'قرين'],
  'pink':   ['وردي', 'بينك'],
  'purple': ['بنفسجي', 'بربل'],
  'red':    ['أحمر', 'ريد'],
  'yellow': ['أصفر'],
  'orange': ['برتقالي'],
  'brown':  ['بني', 'براون'],
  // French (Vitesse Eco's catalog uses French color suffixes like "- Noir")
  'noir':   ['نوار', 'أسود'],
  'blanc':  ['بلون', 'أبيض'],
  'bleu':   ['بلو', 'أزرق'],
  'rouge':  ['روج', 'أحمر'],
  'vert':   ['فير', 'أخضر'],
  'gris':   ['قري', 'رمادي'],
  'jaune':  ['جون', 'أصفر'],
  'rose':   ['روز', 'وردي'],
};

// Common Arabic first names (Latin → Arabic). Used for clients and supplier
// names that look like personal names. Top ~40 most common variants.
const ARABIC_NAMES = {
  'mohammed':   'محمد',
  'mohammad':   'محمد',
  'muhammad':   'محمد',
  'mohamed':    'محمد',
  'ahmed':      'أحمد',
  'ahmad':      'أحمد',
  'ali':        'علي',
  'omar':       'عمر',
  'umar':       'عمر',
  'khalid':     'خالد',
  'khaled':     'خالد',
  'youssef':    'يوسف',
  'yusuf':      'يوسف',
  'yousef':     'يوسف',
  'hassan':     'حسن',
  'hussein':    'حسين',
  'hussain':    'حسين',
  'ibrahim':    'إبراهيم',
  'sami':       'سامي',
  'samir':      'سمير',
  'hani':       'هاني',
  'walid':      'وليد',
  'tarek':      'طارق',
  'tariq':      'طارق',
  'fadi':       'فادي',
  'rami':       'رامي',
  'karim':      'كريم',
  'kareem':     'كريم',
  'amir':       'أمير',
  'fahad':      'فهد',
  'fahed':      'فهد',
  'saad':       'سعد',
  'mansour':    'منصور',
  'nasser':     'ناصر',
  'sultan':     'سلطان',
  'fares':      'فارس',
  'jamal':      'جمال',
  'mahmoud':    'محمود',
  'mostafa':    'مصطفى',
  'mustafa':    'مصطفى',
  'osama':      'أسامة',
  'usama':      'أسامة',
  'abdullah':   'عبدالله',
  'abdulaziz':  'عبدالعزيز',
  'abdulrahman':'عبدالرحمن',
  'bassam':     'بسام',
  'majid':      'ماجد',
  'nizar':      'نزار',
  'ziad':       'زياد',
  'ramy':       'رامي',
  'maher':      'ماهر',
  // Also handle the "Al-X" / "El-X" prefix as a noise word
  'al':         'ال',
  'el':         'ال',
};

// Common company suffixes (English → Arabic transliteration).
const COMPANY_SUFFIXES = {
  'trading':    'ترايدنغ',
  'co':         'كو',
  'company':    'كومباني',
  'llc':        'ذ.م.م',
  'group':      'قروب',
  'sons':       'سونز',
  'store':      'ستور',
  'shop':       'شوب',
  'center':     'سنتر',
  'centre':     'سنتر',
  'corp':       'كورب',
  'inc':        'إنك',
  'ltd':        'ليمتد',
  'agency':     'إيجنسي',
  'services':   'سيرفسز',
  'enterprise': 'إنتربرايز',
};

// Variant marker phrases (multi-word keys, looked up case-insensitively).
const VARIANT_MARKERS = {
  'double batterie': 'دوبل باتري',
  'double battery':  'دوبل باتري',
  'simple batterie': 'سينجل باتري',
  'single battery':  'سينجل باتري',
  'nfc':             'إن إف سي',
};

// FEAT-01.1: User-typed acronym transliteration. Used by transliterateAcronym()
// as a fallback for unknown all-caps tokens 2-5 chars long (BMW → بي إم دبليو,
// KTM → كي تي إم, HP → إتش بي).
//
// Differs from LETTER_PAIRS in three places (J, O, P) because LETTER_PAIRS is
// for INPUT recognition where Persian پ disambiguates from Arabic ب per BUG-01,
// while SINGLE_LETTERS is for OUTPUT what users actually type when spelling
// a brand acronym in Arabic.
const SINGLE_LETTERS = {
  A: 'إيه', B: 'بي',  C: 'سي', D: 'دي', E: 'إي',
  F: 'إف',  G: 'جي',  H: 'إتش', I: 'آي', J: 'جي',
  K: 'كي',  L: 'إل',  M: 'إم', N: 'إن', O: 'أو',
  P: 'بي',  Q: 'كيو', R: 'آر', S: 'إس', T: 'تي',
  U: 'يو',  V: 'في',  W: 'دبليو', X: 'إكس', Y: 'واي', Z: 'زد',
};

// Freeze everything to prevent accidental mutation
Object.freeze(NUMBER_WORDS);
Object.freeze(LETTER_PAIRS);
Object.freeze(PRODUCT_WORDS);
Object.freeze(COLOR_WORDS);
Object.freeze(ARABIC_NAMES);
Object.freeze(COMPANY_SUFFIXES);
Object.freeze(VARIANT_MARKERS);
Object.freeze(SINGLE_LETTERS);

// =============================================================================
// HELPERS
// =============================================================================

const ARABIC_RANGE  = /[\u0600-\u06FF]/;
const LATIN_RANGE   = /[a-zA-Z]/;
const MAX_NAME_LEN  = 100;
const MAX_ALIAS_LEN = 50;
const MAX_PRODUCT_ALIASES = 5;
const MAX_PERSON_ALIASES  = 4;

function isEmpty(s) {
  return !s || !String(s).trim();
}

function isArabicOnly(s) {
  return ARABIC_RANGE.test(s) && !LATIN_RANGE.test(s);
}

function tooLong(s) {
  return String(s).length > MAX_NAME_LEN;
}

// Strip the variant suffix at the first " - " separator (space-hyphen-space).
//   "V20 Pro - Noir - NFC" → "V20 Pro"
//   "V20 Pro"              → "V20 Pro" (unchanged)
//   "Sur-Ron Light Bee X"  → "Sur-Ron Light Bee X" (no " - ", hyphen-only stays)
function stripVariant(name) {
  const idx = name.indexOf(' - ');
  return idx === -1 ? name : name.slice(0, idx).trim();
}

// Convert a Western-arabic numeral string ("20") to Eastern-arabic ("٢٠").
function toEasternNumerals(numStr) {
  return String(numStr).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[parseInt(d, 10)]);
}

// Translate an integer to Arabic word forms. Returns an array (possibly empty).
// Handles 0-30, tens 40-100, hundreds 200-900, thousands 1000-3000.
// Compositional forms 21-99 are precomputed; 33/47/etc are derived on demand.
function numberToWords(n) {
  if (NUMBER_WORDS[n]) return [...NUMBER_WORDS[n]];
  // Compose tens + ones for 21-99 (e.g., 33, 47, 78)
  if (n > 20 && n < 100) {
    const tens = Math.floor(n / 10) * 10;
    const ones = n % 10;
    if (NUMBER_WORDS[tens] && NUMBER_WORDS[ones]) {
      const out = [];
      for (const t of NUMBER_WORDS[tens]) {
        for (const o of NUMBER_WORDS[ones]) {
          out.push(`${o} و${t}`);
        }
      }
      return out;
    }
  }
  return [];
}

// Translate a letter sequence (1-2 chars) to Arabic. Tries multi-letter
// pairs first (GT, EB, KW), then single letters. Returns null on miss.
function lettersToArabic(letters) {
  if (LETTER_PAIRS[letters]) return LETTER_PAIRS[letters];
  // Char-by-char fallback
  const parts = [];
  for (const ch of letters) {
    if (LETTER_PAIRS[ch]) parts.push(LETTER_PAIRS[ch]);
    else return null;
  }
  return parts.join(' ');
}

// FEAT-01.1: try to transliterate an unknown all-caps token character by
// character using SINGLE_LETTERS. Returns null if the token doesn't qualify.
//
// Qualifies when:
//   - 2-5 characters long
//   - All uppercase Latin letters (no digits, no punctuation, no mixed case)
// Caller is responsible for checking LETTER_PAIRS first — this is the
// fallback for unknown brand acronyms (BMW, KTM, HP) that aren't in the
// curated multi-letter dictionary.
function transliterateAcronym(token) {
  if (!token || token.length < 2 || token.length > 5) return null;
  if (!/^[A-Z]+$/.test(token)) return null;
  const letters = [];
  for (const ch of token) {
    const arabic = SINGLE_LETTERS[ch];
    if (!arabic) return null;
    letters.push(arabic);
  }
  return letters.join(' ');
}

// Look up a single English word in one or more dictionaries, case-insensitively.
// Returns array of Arabic forms (empty if no match in any dict).
function wordToArabic(word, dicts) {
  const lower = String(word).toLowerCase();
  for (const dict of dicts) {
    if (dict[lower]) {
      const v = dict[lower];
      return Array.isArray(v) ? [...v] : [v];
    }
  }
  return [];
}

// Detect a "letters+digits" model token like "V20", "GT-2000", "EB30", "C28".
// Allows an optional whitespace or hyphen between the letter and digit groups.
// Returns { letters, digits } or null.
function parseModelToken(token) {
  const m = /^([A-Za-z]+)[-\s]?(\d+)$/.exec(token);
  if (m) return { letters: m[1].toUpperCase(), digits: m[2] };
  return null;
}

// Tokenize a name on whitespace only. Hyphenated tokens like "GT-2000" or
// "Sur-Ron" are kept intact so parseModelToken can match the former and the
// latter passes through as an unknown brand token.
function tokenize(name) {
  return String(name).split(/\s+/).filter(Boolean);
}

// Cross-product compose: given an array of word arrays, produce all combinations
// joined by spaces. Truncates the cross-product to maxOut to prevent blow-up.
function compose(slots, maxOut = 6) {
  if (slots.length === 0) return [];
  let out = slots[0].map(s => s);
  for (let i = 1; i < slots.length; i++) {
    const next = [];
    for (const acc of out) {
      for (const p of slots[i]) {
        next.push(`${acc} ${p}`);
        if (next.length >= maxOut) break;
      }
      if (next.length >= maxOut) break;
    }
    out = next;
  }
  return out;
}

// Dedupe an array of aliases by their normalized form, preserving first-occurrence
// order. This is critical because two visually-different aliases ("في٢٠ برو" and
// "في 20 برو") may collapse to the same normalized key, in which case we only
// want to persist one.
function dedupeByNormalized(aliases) {
  const seen = new Set();
  const out = [];
  for (const a of aliases) {
    if (!a) continue;
    const n = normalizeForMatching(a);
    if (!n) continue;
    if (!seen.has(n)) {
      seen.add(n);
      out.push(a);
    }
  }
  return out;
}

// Drop aliases that exceed MAX_ALIAS_LEN. Truncating mid-word produces garbage.
function capLengths(aliases) {
  return aliases.filter(a => a.length <= MAX_ALIAS_LEN);
}

// =============================================================================
// PRODUCT GENERATOR
// =============================================================================

/**
 * Generate Arabic aliases for a product name.
 * @param {string} name - the canonical product name (English-by-policy)
 * @returns {{aliases: string[], skip: boolean, reason?: string}}
 */
export function generateProductAliases(name) {
  if (isEmpty(name))      return { aliases: [], skip: true, reason: 'empty' };
  if (tooLong(name))      return { aliases: [], skip: true, reason: 'too_long' };
  if (isArabicOnly(name)) return { aliases: [], skip: true, reason: 'already_arabic' };

  const baseName = stripVariant(String(name)).trim();
  if (isEmpty(baseName))  return { aliases: [], skip: true, reason: 'empty_after_strip' };

  const tokens = tokenize(baseName);
  if (tokens.length === 0) return { aliases: [], skip: true, reason: 'no_tokens' };

  // For each token, compute its Arabic form options and remember the model
  // metadata for the eastern-numeral mixed pass below.
  const tokenInfos = tokens.map(tok => {
    // 1. Letter+digit model token: V20, GT-2000, EB30, C28
    const model = parseModelToken(tok);
    if (model) {
      const arLetters = lettersToArabic(model.letters);
      const arNumbers = numberToWords(parseInt(model.digits, 10));
      if (arLetters && arNumbers.length > 0) {
        return {
          arabicForms: arNumbers.map(n => `${arLetters} ${n}`),
          latin: tok,
          model,
        };
      }
    }

    // 2. Pure-number token (e.g., "450" in "KTM 450")
    if (/^\d+$/.test(tok)) {
      const arNumbers = numberToWords(parseInt(tok, 10));
      if (arNumbers.length > 0) {
        return { arabicForms: arNumbers, latin: tok };
      }
      // Fall through to keep as Latin if the number isn't in the table
    }

    // 3. Product / color / variant marker dictionary
    const productForms = wordToArabic(tok, [PRODUCT_WORDS, COLOR_WORDS, VARIANT_MARKERS]);
    if (productForms.length > 0) {
      return { arabicForms: productForms, latin: tok };
    }

    // 4. Single-letter fallback (so "X" in "Sur-Ron Light Bee X" resolves)
    if (/^[A-Za-z]$/.test(tok)) {
      const ar = LETTER_PAIRS[tok.toUpperCase()];
      if (ar) return { arabicForms: [ar], latin: tok };
    }

    // 5. FEAT-01.1: all-caps acronym fallback for unknown brand acronyms
    //    like BMW, KTM, HP. Only fires when the token is 2-5 chars, all
    //    uppercase Latin, and not already covered by LETTER_PAIRS above.
    if (!LETTER_PAIRS[tok]) {
      const acronym = transliterateAcronym(tok);
      if (acronym) return { arabicForms: [acronym], latin: tok };
    }

    // 6. Unknown — keep as-is in both positions
    return { arabicForms: [tok], latin: tok };
  });

  const candidates = [];

  // 1. Full Arabic compositions (one per dialect variant, capped at 3)
  const arabicSlots = tokenInfos.map(t => t.arabicForms);
  const arabicCompositions = compose(arabicSlots, 6);
  for (const c of arabicCompositions.slice(0, 3)) {
    candidates.push(c);
  }

  // 2. Canonical original Latin (preserved per spec). The lowercase variant
  //    is intentionally NOT a separate candidate — `normalizeForMatching`
  //    lowercases at insert time, so "V20 Pro" and "v20 pro" collapse to the
  //    same row anyway. The resolver matches typed "v20 pro" against the
  //    canonical alias just fine.
  candidates.push(baseName);

  // 3. Mixed: Latin letters with Eastern numerals + Arabic word translations
  //    (e.g., "V٢٠ برو" — common typing pattern in Arabic locales)
  if (tokenInfos.some(t => t.model)) {
    const mixedSlots = tokenInfos.map(t => {
      if (t.model) {
        return [`${t.model.letters}${toEasternNumerals(t.model.digits)}`];
      }
      return t.arabicForms;
    });
    const mixed = compose(mixedSlots, 2)[0];
    if (mixed) candidates.push(mixed);
  }

  // 4. Spaceless lowercase (catches "v20pro" typing without spaces — this is
  //    a genuinely-different normalized form because normalizeForMatching does
  //    NOT remove single spaces, so "v20 pro" and "v20pro" stay distinct)
  candidates.push(baseName.toLowerCase().replace(/\s+/g, ''));

  // Cap each, dedupe by normalized form, limit to MAX_PRODUCT_ALIASES
  const capped = capLengths(candidates);
  const unique = dedupeByNormalized(capped);

  return { aliases: unique.slice(0, MAX_PRODUCT_ALIASES), skip: false };
}

// =============================================================================
// SUPPLIER GENERATOR
// =============================================================================

/**
 * Generate Arabic aliases for a supplier name.
 * @param {string} name
 * @returns {{aliases: string[], skip: boolean, reason?: string}}
 */
export function generateSupplierAliases(name) {
  if (isEmpty(name))      return { aliases: [], skip: true, reason: 'empty' };
  if (tooLong(name))      return { aliases: [], skip: true, reason: 'too_long' };
  if (isArabicOnly(name)) return { aliases: [], skip: true, reason: 'already_arabic' };

  const trimmed = String(name).trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { aliases: [], skip: true, reason: 'no_tokens' };

  // Translate each token: ARABIC_NAMES first (for personal-name suppliers
  // like "Sami Trading"), then COMPANY_SUFFIXES, then keep as-is.
  const arabicTokens = tokens.map(tok => {
    const lower = tok.toLowerCase();
    if (ARABIC_NAMES[lower])     return ARABIC_NAMES[lower];
    if (COMPANY_SUFFIXES[lower]) return COMPANY_SUFFIXES[lower];
    return tok;
  });

  const candidates = [];

  // 1. Full Arabic transliteration (with company suffix translated)
  candidates.push(arabicTokens.join(' '));

  // 2. First token only (catches "Sami" when supplier is "Sami Trading")
  if (tokens.length > 1) {
    candidates.push(arabicTokens[0]);
  }

  // 3. Canonical original Latin. (The lowercase variant is dropped — same
  //    normalized form as the canonical, would be deduped anyway.)
  candidates.push(trimmed);

  const capped = capLengths(candidates);
  const unique = dedupeByNormalized(capped);

  return { aliases: unique.slice(0, MAX_PERSON_ALIASES), skip: false };
}

// =============================================================================
// CLIENT GENERATOR
// =============================================================================

/**
 * Generate Arabic aliases for a client name.
 * @param {string} name
 * @returns {{aliases: string[], skip: boolean, reason?: string}}
 */
export function generateClientAliases(name) {
  if (isEmpty(name))      return { aliases: [], skip: true, reason: 'empty' };
  if (tooLong(name))      return { aliases: [], skip: true, reason: 'too_long' };
  if (isArabicOnly(name)) return { aliases: [], skip: true, reason: 'already_arabic' };

  const trimmed = String(name).trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { aliases: [], skip: true, reason: 'no_tokens' };

  // Translate each token via ARABIC_NAMES (or pass through).
  const arabicTokens = tokens.map(tok => {
    const lower = tok.toLowerCase();
    if (ARABIC_NAMES[lower]) return ARABIC_NAMES[lower];
    return tok;
  });

  const candidates = [];

  // 1. Full Arabic transliteration
  candidates.push(arabicTokens.join(' '));

  // 2. First name only
  candidates.push(arabicTokens[0]);

  // 3. Last name only (when multi-token — catches "أحمد" lookup for "Mohammed Ahmed")
  if (arabicTokens.length > 1) {
    candidates.push(arabicTokens[arabicTokens.length - 1]);
  }

  // 4. Canonical original Latin. (Lowercase variant dropped — collapses to
  //    the same normalized form as the canonical.)
  candidates.push(trimmed);

  const capped = capLengths(candidates);
  const unique = dedupeByNormalized(capped);

  return { aliases: unique.slice(0, MAX_PERSON_ALIASES), skip: false };
}
