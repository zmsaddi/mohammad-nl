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

---

## VERIFY-A/B/C — response to checkpoint after BUG-01c

### VERIFY-A — Is Bug D real, or did BUG-01c create it?

Both runs use `normalizeArabicText('بعت بخمسين يورو')`.

**Current branch (HEAD = `24d18e5`, post BUG-01c):**
```
"بعت بخمسين يورو"
```

**Parent commit (HEAD~1 = `a07e5d3`, pre BUG-01c):**
```
"بعت بخمCن Uرو"
```

**Verdict:** Bug D pre-existed and is **independent** of Bug C.

- Pre-fix: the substring corruption (Bug C) mangled `خمسين → خمCن` and
  `يورو → Uرو` inside `transliterateArabicToLatin`. By the time
  `normalizeArabicNumbers` ran on the corrupted string, the word `خمسين`
  was no longer present anywhere — even a *correct* boundary check
  couldn't have matched it. Bug D was **masked** by Bug C: the standalone
  number normalizer was always broken, but you couldn't observe it because
  the input never reached it intact.
- Post-fix: `خمسين` survives transliteration intact, then hits Phase 2 of
  `normalizeArabicNumbers` (line 87), which uses `\bخمسين\b`. JS `\b` is
  defined against `\w = [A-Za-z0-9_]`; Arabic letters are not `\w`, so the
  boundary never matches and the word is left untouched. Output:
  `"بعت بخمسين يورو"`.

BUG-01c did **not** introduce Bug D. It exposed it. If BUG-01c had never
been written, the financial value would still be wrong — just wrong in a
different way (corrupted Arabic text instead of un-normalized Arabic text).

### VERIFY-B — Bug D evidence

**Lines in `lib/voice-normalizer.js` using `\b`:**

```js
// line 87 — normalizeArabicNumbers, Phase 2 (standalone Arabic numbers)
for (const [word, value] of NUMBER_PATTERNS) {
  const regex = new RegExp(`\\b${word}\\b`, 'g');
  result = result.replace(regex, String(value));
}
```

```js
// line 317 — transliterateArabicToLatin, ENGLISH_NUMBERS pass
// (Arabic-spelled English numbers: ون→1, تو→2, ثري→3 …)
for (const [ar, num] of ENGLISH_NUMBERS) {
  result = result.replace(new RegExp(`\\b${ar}\\b`, 'g'), num);
}
```

Both have the same Arabic-boundary failure. Line 87 is the financial one
(standalone Arabic number words). Line 317 is functionally equivalent for
Arabic-spelled English digits.

**Trace proving Bug D on its own:**

Input: `'خمسين يورو'` (post BUG-01c, so Bug C is gone)

1. `transliterateArabicToLatin`: every letter mapping requires whitespace/
   punctuation lookbehind/lookahead. `سي` inside `خمسين` and `يو` inside
   `يورو` no longer match. Output: `'خمسين يورو'` (unchanged).
2. `normalizeArabicNumbers` Phase 1 (compound `X و Y`): no match.
3. `normalizeArabicNumbers` Phase 2: `new RegExp('\\bخمسين\\b', 'g')`
   tested against `'خمسين يورو'` — `\b` requires a `\w`/non-`\w`
   transition; the position before `خ` is start-of-string + non-word,
   which **does** count as `\b` … but the position *after* `ن` is
   non-word followed by space (also non-word), which is **not** `\b`.
   The match fails.
4. Output: `'خمسين يورو'`. The number `50` never appears.

Confirmed empirically:
```
> normalizeArabicText('خمسين يورو')
"خمسين يورو"
```

**Are Bug B and Bug D the same bug under different names?**

Partly. They overlap on the test 4 input (`"في عشرين برو"`) but diverge
in mechanism:

- **Bug D** (line 87): the standalone-number regex uses `\b` against
  Arabic, so `عشرين` is never converted to `20` in the first place. This
  alone is enough to fail test 4 — there is no digit produced anywhere
  in the pipeline.
- **Bug B** (cleanup ordering): even if Bug D were fixed and Phase 2
  produced the digit, the letter+digit merge step (`/([A-Z])\s+(\d)/g`,
  lines 321-323) lives **inside** `transliterateArabicToLatin` and runs
  *before* `normalizeArabicNumbers` is called by `normalizeArabicText`
  (line 334-335). So the merge pass has already finished by the time the
  digit appears, and the output would be `"V 20 Pro"` — not `"V20 Pro"`.

So for test 4, **Bug D is the first blocker and Bug B is the second
blocker**. They are sequentially distinct: fixing only D yields
`"V 20 Pro"`, fixing only B changes nothing (no digit ever exists), and
fixing both yields `"V20 Pro"`. The two-name framing is correct.

### VERIFY-C — The 5-bug count

| ID | Description | Severity | Independent? |
|---|---|---|---|
| **A** | Single-pass cleanup loop in `transliterateArabicToLatin` — three or more spelled letters in a row only collapse the first pair (`B M W → BM W`) | Functional | Independent |
| **B** | Cleanup-before-normalization: letter+digit merge runs *inside* `transliterateArabicToLatin`, before `normalizeArabicNumbers` produces the digit; final output is `"V 20 Pro"` not `"V20 Pro"` | Functional | Masked by D — only observable if D is fixed first |
| **D** | `normalizeArabicNumbers` Phase 2 (line 87) uses `\bword\b`; JS `\b` does not work against Arabic, so standalone Arabic numbers (`خمسين`, `بخمسين`, `مية`, …) are never normalized to digits | **Financial** | Independent — was masked by C in production until BUG-01c |
| **E** | Catalog mappings (`الفيشن → V20 Pro`, `دوبل باتري → Double Batterie`) sit inside the lexical normalizer instead of `entity-resolver.js` aliases | Architectural / cosmetic | Independent (smell, not exploitable) |
| **F** | `بي` is mapped to both `B` (line 114) and `P` (line 125); first match wins, so `"بي 20"` is always `B20`, never `P20` | Functional / mildly financial | Independent |

**Independently exploitable in production today (post BUG-01c):**

- **Bug D** — yes. Any seller saying a standalone Arabic number gets the
  word passed through unchanged into the LLM prompt. Financial.
- **Bug A** — yes. Any product code with three or more spelled letters
  fails to collapse. Functional, low frequency.
- **Bug F** — yes. Any product whose canonical name uses `P` is
  mismatched against `B`. Functional, depends on catalog.
- **Bug B** — no. Masked by D; only triggers if D is fixed.
- **Bug E** — no. Architectural smell, not user-visible.

Three out of five are live in production right now.

### Recommendation

**Reorder. Fix Bug D next, before BUG-01 (collision).** Honest reasoning:

1. **Bug D is in the same severity tier as Bug C** — both directly
   miscount financial values spoken by sellers. The whole point of
   COMMIT 1 was to make `"بعت بخمسين يورو" → 50` work end-to-end.
   COMMIT 1 only got us halfway there: the corruption is gone, but the
   normalization is still missing. The skipped test in
   `tests/voice-normalizer.test.js` is the canary.
2. **The fix is mechanically identical** to BUG-01c — replace `\b…\b`
   with the same `BEFORE`/`AFTER` Arabic-aware boundaries on lines 87
   and 317. Small, isolated, already has test infrastructure ready.
3. **BUG-01 (collision) is one tier lower in severity.** It produces
   the wrong product code, but the entity resolver downstream has
   fuzzy matching as a backup safety net. Bug D has no backup — the
   number is the number, and a wrong number lands directly on an
   invoice.
4. **Bugs A and B are functional, low impact**, and Bug B is masked by
   Bug D anyway, so fixing D first is also a prerequisite for being
   able to test B properly.

**Proposed revised plan:**

- **COMMIT 2 (was BUG-01) → BUG-01d (new):** Apply Arabic-safe
  boundaries to lines 87 and 317. Un-skip the
  `"بعت بخمسين يورو" → 50` test. Add tests for the other standalone
  Arabic numbers. Lands the financial fix end-to-end.
- **COMMIT 3:** Original BUG-01 — `بي → P/B` collision.
- **COMMIT 4:** BUG-01a + BUG-01b — multi-pass cleanup loop + post-
  number merge ordering.

We are **not** freezing `voice-normalizer.js` for the rest of the
sprint — that would be an over-correction. The file has 5 bugs but
only D is in the financial-severity tier; A, B, F can wait their
turn after D lands. E is out of sprint scope entirely (architectural).

This is my honest engineering call. If you disagree, the alternative
is "ship BUG-01 next as planned and live with the skipped test for
two more commits" — which I'd argue against, but it is defensible if
you weight commit-plan-stability over end-to-end-test-coverage.

---

## BUG-01d — Arabic-safe boundaries on standalone number passes

**Severity:** Critical (financial data integrity)
**Scope:** `lib/voice-normalizer.js` — line 87 (`normalizeArabicNumbers`
Phase 2) and line 317 (`transliterateArabicToLatin` ENGLISH_NUMBERS pass)
**Commit:** COMMIT 2 of the BUG-01 series. Reordered ahead of the original
BUG-01 (collision) per the post-BUG-01c checkpoint.

### Problem

Both standalone-number passes used `new RegExp('\\bword\\b')`. JS `\b` is
defined against `\w = [A-Za-z0-9_]`; Arabic letters are not `\w`, so the
boundary never matches inside Arabic text. Standalone Arabic numbers
(`خمسين`, `بخمسين`, `سبعين`, `مية`, …) and Arabic-spelled English numbers
(`ون`, `تو`, …) were silently never normalized to digits in production.
This was masked by Bug C until BUG-01c landed; the previously-skipped test
`"بعت بخمسين يورو" → 50` was the canary.

### Fix

Extracted a shared helper used by all three Arabic-boundary sites in the
file. The helper is parameterized so letter-spelling mappings (BUG-01c
site) and number mappings (BUG-01d sites) can share the boundary logic
without sharing the proclitic-prefix behavior:

```js
const ARABIC_BOUNDARY = '\\s،.؟!,;';
const ARABIC_PROCLITIC = '[بلوفك]';

function arabicSafeBoundary(word, { allowPrefix = false } = {}) {
  const lookbehind = `(?<=^|[${ARABIC_BOUNDARY}])`;
  const prefix = allowPrefix ? `(${ARABIC_PROCLITIC}?)` : '';
  const lookahead = `(?=$|[${ARABIC_BOUNDARY}])`;
  return new RegExp(`${lookbehind}${prefix}${word}${lookahead}`, 'g');
}
```

- **Number passes (lines 87, 317):** call with `allowPrefix: true`. Lets
  one of the Arabic prepositional clitics ب/ل/و/ف/ك sit between the
  boundary and the number word. The clitic is captured in group 1 and
  re-emitted in the replacement, so `بخمسين → ب50`, `وعشرين → و20`,
  `لمية → ل100`. The prepositional context is preserved for the LLM
  downstream.
- **BUG-01c letter site (line 308):** call with `allowPrefix` defaulting
  to `false`. Letter mappings must NOT eat a leading proclitic — that
  would over-match unrelated Arabic words starting with ب/ل/و/ف/ك. The
  boundary check stays strict.

### Why share a helper instead of two parallel constants

Per checkpoint instruction: refactor BUG-01c's site to use the helper
too. Reasoning:

- One canonical place to encode "what counts as an Arabic word boundary."
- The two sites cannot drift independently. A future fix to the boundary
  rule (say, adding ـ tatweel handling) lands once and is exercised by
  every Arabic-boundary regex in the file.
- Tests for either bug exercise the same code path, so a regression in
  the helper is caught by either test class.

The original `BEFORE` / `AFTER` constants from BUG-01c were deleted; the
comment block above `LETTER_MAPPING_SOURCES` was updated to reference
the helper.

### Tests — required cases (7)

| # | Input | Expected substring | Result |
|---|---|---|---|
| 1 | `بعت بخمسين يورو` | `50` | ✓ pass (un-skipped from BUG-01c) |
| 2 | `ألفين وخمسمية` | `2500` | ✓ pass |
| 3 | `ثلاثمية وعشرين` | `320` | ✓ pass |
| 4 | `ألف وستمية` | `1600` | ✓ pass |
| 5 | `سبعين` | `70` | ✓ pass |
| 6 | `تسعة آلاف وخمسمية` | `9500` | **skip — Bug G** |
| 7 | `ون تو ثري` | `1`, `2`, `3` (ENGLISH_NUMBERS) | ✓ pass |

Test 6 is the canary for Bug G (see below). Marked `.skip()` with
explicit Bug G reference; will become a one-line un-skip the day Bug G
is fixed.

### Tests — 28-value compound regression suite

Canonical Arabic spellings of 10–10000:

| Class | Values | Result |
|---|---|---|
| Tens | 10, 20, 30, 40, 50, 60, 70, 80, 90 (9) | **9 / 9 pass** |
| Hundreds | 100, 200, 300, 400, 500, 600, 700, 800, 900 (9) | **9 / 9 pass** |
| 1000–2000 | 1000 (ألف), 2000 (ألفين) (2) | **2 / 2 pass** |
| 3000–10000 | تلاتة آلاف … عشرة آلاف (8) | **0 / 8 — Bug G** |
| **Total** | **28** | **20 active pass, 8 skipped** |

**20 / 20 of the dictionary-resolvable values pass.** All failures are
in the single, fully-characterized Bug G class (`X آلاف` multiplication).
Per checkpoint instruction the 8 Bug G cases are `.skip`ed so the suite
stays green; un-skipping is the validation harness for whoever fixes Bug
G.

### Tests — BUG-01c regression check

All 47 BUG-01c tests still pass. Five of them needed their assertion
wording updated, *not* their intent: BUG-01c asserted "Arabic word
survives uncorrupted," but post-BUG-01d those same words now correctly
normalize all the way to digits. Updated assertions check both:

- the corruption pattern is absent (original BUG-01c invariant), AND
- the digit form is present (BUG-01d gives the stronger guarantee)

The tests for `يورو` (no `Uرو`) and the 30-test sweep (`hasMixedToken`
invariant) needed no change — they encode the corruption invariant
without referencing specific Arabic forms.

### Final test counts

```
 Test Files  1 passed (1)
      Tests  74 passed | 9 skipped (83)
```

- 47 BUG-01c tests (all passing — 5 had assertion wording updated)
- 6 active BUG-01d cases (1 skipped — Bug G test 6)
- 20 active 28-suite cases (8 skipped — Bug G class)
- 1 normalizeForMatching alif test
- 2 normalizeArabicNumbers compound tests

---

## Bug G — `X آلاف` multiplication is missing

**Status:** Characterized but NOT fixed. Tracked separately from the
BUG-01 series.

`آلاف` is the broken plural of `ألف` (thousand) and means "thousands."
Native usage requires multiplication by the preceding unit:
`تلاتة آلاف` = 3000, `تسعة آلاف` = 9000. The current dictionary has
only `ألف → 1000` and `ألفين → 2000`; `آلاف` is not in any of UNITS,
TEENS, TENS, HUNDREDS, or LARGE, and the compound regex on line 74 has
no semantics for "<unit-word> آلاف."

**Trace** for `تسعة آلاف وخمسمية`:
1. Phase 1 compound regex matches `آلاف وخمسمية`, looks up
   `ALL_NUMBERS["آلاف"]` → `undefined`, returns the match unchanged.
2. Phase 2 standalone: `تسعة → 9`, `آلاف` not in dict (skip),
   `خمسمية` matches with و proclitic → `و500`.
3. Phase 3 cleanup `(\d+)\s*و\s*(\d+)` does not match because
   ` آلاف و` is not pure whitespace + و.
4. Final: `"9 آلاف و500"` — does NOT contain `9500`.

**Fix shape (for whoever takes this):**

- Add `آلاف` and `الاف` as a sentinel multiplier in a new dictionary, OR
- Extend the compound regex to handle `(unit) آلاف (و hundred)` as a
  multiplication form, OR
- Add a Phase 1.5 that scans for `<digit> آلاف <…>` after Phase 2 and
  multiplies.

Whichever approach lands needs to round-trip the 8 skipped test cases
in the 28-suite (`tests/voice-normalizer.test.js` — search `BUG_G`).
Removing the entries from the `BUG_G` set is the validation step.

**Severity:** Financial. Same tier as Bugs C and D. Any sale of an
e-bike priced 3000+ EUR is currently un-normalizable when spoken with
`X آلاف`. **NOT in the current sprint scope** per the COMMIT 2 plan;
flagging for the post-BUG-01 audit findings.
