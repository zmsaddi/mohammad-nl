# Upgrade Log — Week 1 Bugfix Sprint

## BUG-01c — Substring corruption in Arabic→Latin transliteration loop

**Severity:** Critical (financial data integrity)
**Scope:** `lib/voice-normalizer.js` — `transliterateArabicToLatin()`
**Commit:** COMMIT 1 of the BUG-01 trio (BUG-01c → BUG-01 → BUG-01a/b)

### Problem

`transliterateArabicToLatin()` walked the `ARABIC_TO_LATIN` table and applied each
mapping with a plain `replace(new RegExp(ar, 'g'), en)`. The table contains
single-letter spellings like `سي → C`, `في → V`, `تي → T`, `يو → U` that are
**substrings of common Arabic number words**. The regex matched inside those
number words and silently corrupted the financial value spoken by the seller.

| Spoken Arabic | Naive transliteration | Should be |
|---|---|---|
| خمسين (50)   | خمCن            | خمسين / 50 |
| ألفين (2000) | ألVن            | ألفين / 2000 |
| تلاتين (30)  | تلاTن           | تلاتين / 30 |
| ستين (60)    | corrupted       | ستين / 60 |
| سبعين (70)   | سبCن (سي match) | سبعين / 70 |
| يورو (euro)  | Uرو             | يورو |

A seller saying *"بعت الدراجة بألفين وخمسمية"* could land with the wrong
amount on the invoice. This is not a normalizer cosmetic bug — it is a direct
threat to invoice correctness.

### Fix

Apply word boundaries **only to letter-spelling entries** (the entries that
exist to capture spelled-out Latin letters like `سي → C`, `في → V`). Joined
product/variant words like `الفيشن → V20 Pro` and `دوبل باتري → Double
Batterie` keep substring matching, since users do say them mid-sentence.

JavaScript's native `\b` is defined against `\w = [A-Za-z0-9_]`, so it never
fires inside Arabic text. Used explicit Arabic-aware lookbehind / lookahead
instead:

```js
const BEFORE = '(?<=^|[\\s،.؟!,;])';
const AFTER  = '(?=$|[\\s،.؟!,;])';

const LETTER_MAPPING_SOURCES = new Set([
  'دبليو', 'اكس', 'إكس', 'إتش', 'اتش', 'كيو',
  'ايه', 'أيه', 'بي', 'سي', 'دي', 'إي', 'اي',
  'إف', 'اف', 'جي', 'آي', 'جاي', 'كي', 'كاي',
  'إل', 'ال', 'إم', 'ام', 'إن', 'ان', 'أو', 'او',
  'آر', 'ار', 'إس', 'اس', 'تي', 'يو', 'في', 'ڤي',
  'واي', 'زد', 'زي',
]);

for (const [ar, en] of SORTED_ARABIC_TO_LATIN) {
  if (LETTER_MAPPING_SOURCES.has(ar)) {
    const re = new RegExp(`${BEFORE}${ar}${AFTER}`, 'g');
    result = result.replace(re, en);
  } else {
    result = result.replace(new RegExp(ar, 'g'), en);
  }
}
```

### Tests

`tests/voice-normalizer.test.js` — 48 tests, 47 passing, 1 skipped:

- 6 corruption-prevention tests (خمسين, ألفين, تلاتين, ستين, سبعين, يورو)
- 1 full-pipeline test passing (`"ألفين وخمسمية" → contains "2500"`)
- 1 full-pipeline test **skipped** (`"بعت بخمسين يورو" → 50`) — blocked by
  Bug D (see Discovered Issues below)
- 30-test regression sweep over every Arabic compound-number word in the
  vocabulary, asserting the strong invariant *"no whitespace token may
  contain BOTH Arabic letters AND uppercase Latin letters"*
- 5 positive-path tests confirming letter spellings still work
  (`جي تي 20 → GT20`, `إس 20 برو → S20 Pro`, `دي خمسين → D + خمسين`, etc.)
- `normalizeForMatching` alif unification
- 2 `normalizeArabicNumbers` compound-path tests

```
RUN  v4.1.4 D:/mohammad_nl
 ✓ tests/voice-normalizer.test.js (48 tests | 1 skipped) 15ms
 Test Files  1 passed (1)
      Tests  47 passed | 1 skipped (48)
```

### How long this has been in production

The corruption pattern has been present since the Arabic letter mappings were
first added to `ARABIC_TO_LATIN`. Every sale recorded by voice that included
an Arabic compound number with one of the listed substrings was at risk of
silent miscount. We have no way to retroactively flag historical incidents
because the corrupted form was written straight into the AI prompt and no
intermediate value was logged.

### Surprises found while fixing this

1. JS `\b` does not work for Arabic — burned the first attempt. Required
   explicit Arabic + Latin punctuation boundaries.
2. Three additional pre-existing bugs were uncovered while writing tests
   (see "Discovered Issues" below).

---

## Discovered Issues

These were uncovered while implementing BUG-01c. They are **not fixed in this
commit** — tracking them here so they don't get lost.

- **Bug A — Single-pass cleanup loop.** `transliterateArabicToLatin` runs
  multi-letter joining (e.g. `B M W → BMW`) only once. Inputs with three or
  more spelled letters in a row only collapse the first pair. Will be
  addressed in **COMMIT 3 (BUG-01a)**.
- **Bug B — Cleanup runs before number normalization.** When a letter mapping
  is followed by a spoken number (`في عشرين برو`), the digit produced by the
  number normalizer arrives *after* the cleanup pass and the letter+digit
  never get merged into `V20 Pro`. Will be addressed in **COMMIT 3 (BUG-01b)**.
- **Bug D — `normalizeArabicNumbers` uses `\b`.** The standalone-number
  normalizer uses `/\bword\b/` which never matches inside Arabic text for the
  same reason as BUG-01c. Standalone Arabic numbers (`خمسين`, `بخمسين`) are
  NOT normalized today; only the compound `X و Y` form works (because that
  regex uses `\S+`). Test for `"بعت بخمسين يورو" → 50` is currently `.skip`ed
  pending a follow-up. **Not in current sprint scope** — flagging for the
  audit findings section after the BUG-01 trio lands.
- **Bug E — Catalog mappings live in the normalizer.** Entries like
  `الفيشن → V20 Pro` and `دوبل باتري → Double Batterie` are product-catalog
  knowledge sitting inside `voice-normalizer.js`. They should live in
  `entity-resolver.js` aliases, not in the lexical normalizer. Out of scope
  for the bugfix sprint, noted for ARC review.
- **Bug F — Collision: `بي → P`/`B`.** The very next commit (BUG-01) tackles
  the documented `بي` collision where the same Arabic spelling is used for
  both Latin "B" and Latin "P". Tracked separately as COMMIT 2.
