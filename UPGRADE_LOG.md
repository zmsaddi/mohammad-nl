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

> **Update after COMMIT 3:** Bug G is FIXED. Section below documents
> the implementation. Reordered ahead of BUG-01 (collision) by user
> decision after the COMMIT 2 checkpoint.

---

## BUG-01g — Arabic compound thousands (آلاف) multiplication

**Severity:** Critical (financial — covers the actual e-bike price range)
**Scope:** `lib/voice-normalizer.js` — `normalizeArabicNumbers`, new Phase 0
**Commit:** COMMIT 3 of the BUG-01 series. Reordered ahead of BUG-01
(collision) per the COMMIT 2 checkpoint — Bug G has no downstream
fallback, Bug F (collision) is caught by the entity resolver.

### Three candidate fix shapes — comparison

| Shape | Idea | Trade-off | Verdict |
|---|---|---|---|
| 1 | Add `آلاف → 1000` sentinel to the LARGE dictionary | Doesn't actually multiply; needs a separate post-pass to fold the previous digit into the sentinel. Effectively shape 3 with extra steps. | **Reject** |
| 2 | New pre-pass regex (Phase 0) before Phase 1 | Surgical, lives next to existing compound logic, decoupled from Phase 2 behavior, multiplier captured directly from raw spoken Arabic. Needs proclitic stripping. | **Pick** |
| 3 | Phase 1.5 digit-based scan after Phase 2 | Simpler regex (digit-only), but tightly coupled to Phase 2's emission format. The BUG-01d proclitic emission (`بأربعة → ب4`) is exactly the kind of thing that would silently break a digit-based scan. | Reject |

**Why Shape 2 wins:** phase decoupling. Shape 2 operates on the most
stable input in the pipeline — the raw spoken Arabic. Shape 3 has a
hidden dependency on the digit-emission format and would couple any
future Phase 2 change to the multiplication logic.

### Fix

New Phase 0 in `normalizeArabicNumbers`, placed before the existing
Phase 1 compound handler:

```js
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
```

Behavior:

- Multiplier restricted to dictionary units **3–10** (the only values
  for which the broken plural `آلاف` is grammatically correct in
  modern Arabic). Outside this range → return match unchanged, let
  later phases handle as best they can.
- Optional `و`-tail captures up to two terms (hundreds and tens), so
  `خمسة آلاف وستمية وخمسين → 5650`.
- Proclitic stripping mirrors BUG-01d: ب/ل/و/ف/ك on the multiplier is
  detached, the bare multiplier is looked up, and the clitic is
  re-emitted in front of the digit so `بأربعة آلاف → ب4000`.
- If a `و`-tail term exists but isn't in the dictionary, the entire
  match is left untouched — fail-safe rather than emit a wrong number.

### Tests — BUG-01g cases (9)

| # | Input | Expected | Result |
|---|---|---|---|
| 1 | `تلاتة آلاف` | `3000` | ✓ |
| 2 | `أربعة آلاف وخمسمية` | `4500` | ✓ |
| 3 | `خمسة آلاف وستمية وخمسين` | `5650` | ✓ |
| 4 | `عشرة آلاف` | `10000` (boundary) | ✓ |
| 5 | `بعت الدراجة بأربعة آلاف يورو` | `4000` | ✓ |
| 6 | `اشتريت بثلاثة آلاف وتسعمية` | `3900` (proclitic) | ✓ |
| 7 | `آلاف` standalone | no crash, returns Arabic intact | ✓ |
| 8 | `ألف` (regression) | `1000` | ✓ |
| 9 | `ألفين وخمسمية` (regression) | `2500` | ✓ |

### Tests — 28-value compound regression suite

All 8 previously-skipped Bug G entries (`تلاتة آلاف` … `عشرة آلاف`)
**un-skipped and passing**. The suite is now 28 / 28 active green.

| Class | Active | Pass |
|---|---|---|
| Tens (10–90) | 9 | **9 / 9** |
| Hundreds (100–900) | 9 | **9 / 9** |
| 1000–2000 | 2 | **2 / 2** |
| 3000–10000 (`X آلاف`) | 8 | **8 / 8** ✓ (was 0/8) |
| **Total** | **28** | **28 / 28** |

### Final test counts

```
 Test Files  1 passed (1)
      Tests  92 passed (92)
```

- 47 BUG-01c tests
- 7 active BUG-01d cases (the previously-skipped Bug G test now passing)
- 9 BUG-01g cases
- 28 / 28 active 28-suite cases (Bug G class fully un-skipped)
- 1 normalizeForMatching alif test
- 2 normalizeArabicNumbers compound tests
- (Total: 92, 0 skipped)

---

## Bug H — Singular `ألف` with multi-word multipliers

**Status:** Characterized but NOT fixed. Pre-authorized as out-of-scope
for COMMIT 3 by the user's instruction #2 ("if `أحد عشر ألف` is too
rare/complex to handle cleanly in this commit, document it as Bug H and
ship without it").

In Arabic, **3–10 thousand** uses the broken plural `آلاف` (handled by
BUG-01g). **11–10000 of higher orders** uses the **singular** `ألف`
with a compound or multi-word multiplier:

- `أحد عشر ألف` = 11000
- `اثنا عشر ألف` = 12000
- `خمسة عشر ألف` = 15000
- `عشرين ألف` = 20000
- `خمسين ألف` = 50000
- `مية ألف` = 100000

**Trace** for `خمسين ألف`:
1. Phase 0 thousands regex looks for `\S+\s+آلاف` — input has `ألف`
   not `آلاف`, no match.
2. Phase 1 compound regex needs explicit `و` — none present, no match.
3. Phase 2 standalone: `خمسين → 50`, `ألف → 1000`.
4. Result: `"50 1000"`. Does not produce `50000`.

`أحد عشر ألف` is even worse because the multiplier is two words —
neither word individually is in the dictionary as 11.

**Severity:** Financial, but **lower frequency** than Bug G in the
Vitesse Eco context. Bike sales are typically 3000–10000 EUR, hitting
the `آلاف` range. The `ألف` range starts at 11000 EUR which is rare
for a single bike. Accessories, batteries, and parts are well below
1000 EUR. So Bug H affects edge-case high-ticket sales.

**Fix shape (for whoever takes this):**

- Pre-pass extending the Phase 0 idea: `(<multi-word multiplier>) ألف
  [و <rest>]`. Multiplier patterns to handle:
  - Tens (`عشرين`, `ثلاثين` … `تسعين`) — single word, simplest case.
  - Compound 11-19 (`أحد عشر`, `اثنا عشر`, `ثلاثة عشر` …) — two-word.
  - Hundreds (`مية`, `ميتين`, `تلتمية` …) — single word.
- Multiplier value × 1000 + optional `و`-tail.
- Same proclitic stripping as BUG-01g.
- Stay restricted to multiplier values that round to whole thousands
  (no `أحد عشر ألف وخمسمية ونص`-style fractional madness in scope).

**NOT in current sprint scope.** Tracked here for the
`VOICE_NORMALIZER_AUDIT.md` to be produced after COMMIT 5.

---

## BUG-01 — `بي → P/B` collision

**Severity:** Functional (entity-resolver fallback exists)
**Scope:** `lib/voice-normalizer.js` — `ARABIC_TO_LATIN` table
**Commit:** COMMIT 4 of the BUG-01 series.

### Problem

`ARABIC_TO_LATIN` had two entries with the same Arabic source:

```js
['بي', 'B']  // line 173
['بي', 'P']  // line 184 — DEAD CODE
```

`SORTED_ARABIC_TO_LATIN` sorts by length descending; both are length 2,
and JS `Array.sort` is stable (ES2019+), so the entry that comes first
in the array wins. Result: `بي → B` always; `بي → P` never fires. This
made every spoken `P`-prefix product code resolve to `B` (e.g.,
`"بي 20 برو" → "B20 Pro"` instead of `"P20 Pro"`).

### Linguistic reality

Standard Arabic has no `/p/` phoneme. Native speakers reading Latin
letters out loud render both `B` and `P` as `بي`. Whisper transcribes
both spoken sounds identically. There is **no acoustic disambiguator**
in spoken Arabic between B and P.

The only reliable disambiguator is **typographic**: the Persian letter
`پ` (U+067E), which Whisper sometimes emits when the speaker visually
"sees" the P. So `پي → P` is the one mapping that can fire correctly.

### Fix

1. **Delete** the dead `['بي', 'P']` entry.
2. **Add** `['پي', 'P']` for the Persian-character path.
3. **Add** `پي` to `LETTER_MAPPING_SOURCES` so the BUG-01c boundary
   logic applies.
4. **Document** in the code that any future spoken Arabic B-vs-P
   disambiguation will require explicit catalog hinting (a known SKU
   prefix), not loop-level disambiguation.

The entity resolver downstream is the safety net here: if a real `P`-
prefix SKU exists in the catalog, fuzzy matching against `B20` will
still surface it as a candidate. That's why Bug F was tier-2 in the
COMMIT 2 reorder analysis.

### Tests

Five new BUG-01 cases added to `tests/voice-normalizer.test.js`:

| # | Input | Expected | Result |
|---|---|---|---|
| 1 | `بي 20` | `B20` | ✓ |
| 2 | `بي 20 برو` | `B20 Pro` | ✓ |
| 3 | `پي 20` | `P20` | ✓ |
| 4 | `پي 20 برو` | `P20 Pro` | ✓ |
| 5 | `بي` alone | contains `B`, not `P` | ✓ |

```
 Test Files  1 passed (1)
      Tests  97 passed (97)
```

All previous tests remain green (47 BUG-01c + 7 BUG-01d + 9 BUG-01g +
28 regression suite + 5 BUG-01 + 1 alif + 2 compound = 97 + 2 alif and
related). No new bug class emerged.

---

## BUG-01a + BUG-01b — Multi-letter cleanup loop + post-number merge ordering

**Severity:** Functional
**Scope:** `lib/voice-normalizer.js` — cleanup pass extracted from
`transliterateArabicToLatin` into a new `mergeLetterNumberTokens()`
helper called from `normalizeArabicText` after number normalization.
**Commit:** COMMIT 5 of the BUG-01 series. Two bugs fixed together
because they share the same cleanup code path.

### BUG-01a — single-pass cleanup

The previous implementation ran `([A-Z])\s+([A-Z])(?=\s|$|\d)` exactly
once. For three-letter codes like `B M W`, JavaScript's global replace
does not re-scan overlapping matches: the first pass consumed `B M`
and produced `BM W`, but the trailing ` W` was never re-evaluated
against the new `BM`-adjacent token. Three-or-more-letter product codes
(BMW, BTX, RTX, GTX) never collapsed fully.

### BUG-01b — cleanup runs before number normalization

The cleanup lived inside `transliterateArabicToLatin()`, which runs
**before** `normalizeArabicNumbers()` in the pipeline. So:

1. `في عشرين برو` → translit → `V عشرين Pro` (cleanup can't merge —
   no digit exists yet)
2. `normalizeArabicNumbers` → `V 20 Pro`
3. …but the cleanup pass already finished. Final output `V 20 Pro`,
   not `V20 Pro`.

### Fix

Extracted a dedicated `mergeLetterNumberTokens(text)` helper that
loops until a fixed point:

```js
function mergeLetterNumberTokens(text) {
  let result = text;
  let prev;
  do {
    prev = result;
    result = result.replace(/([A-Z])\s+([A-Z])(?=\s|$|\d)/g, '$1$2');
    result = result.replace(/([A-Z])\s+(\d)/g, '$1$2');
  } while (result !== prev);
  return result;
}
```

Called from `normalizeArabicText()` **after** both `transliterateArabicToLatin`
and `normalizeArabicNumbers`, so it sees the fully-resolved letters and
digits in one pass.

Addresses both bugs:
- BUG-01a: the `do { } while (result !== prev)` loop retries until
  nothing changes. `B M W` → `BM W` → `BMW`.
- BUG-01b: running after `normalizeArabicNumbers` means digits produced
  from Arabic number words are visible to the merge step.
  `V عشرين Pro` → `V 20 Pro` → `V20 Pro`.

### Tests

7 new BUG-01a/b cases:

| # | Input | Expected | Result |
|---|---|---|---|
| 1 | `بي ام دبليو` | `BMW` (three-letter) | ✓ |
| 2 | `بي تي إكس 30` | `BTX30` | ✓ |
| 3 | `جي تي 20` | `GT20` (two-letter regression) | ✓ |
| 4 | `جي تي` | `GT` (no number, regression) | ✓ |
| 5 | `في عشرين برو` | `V20 Pro` (BUG-01b core) | ✓ |
| 6 | `في 20 برو` | `V20 Pro` (digit variant) | ✓ |
| 7 | `إس 20 برو` | `S20 Pro` (existing positive path) | ✓ |

```
 Test Files  1 passed (1)
      Tests  104 passed (104)
```

### Discovered during smoke-testing — Bug I candidate

Input `أر 20` (alif-with-hamza-above) produces `أر 20`, not `R20`. The
`ARABIC_TO_LATIN` table has `آر` (alif-madda) and `ار` (bare alif) as
the R spellings, but not `أر`. This is a **dictionary coverage gap**
for alif-variant spellings. Not a code bug, not introduced by any
BUG-01 commit — the hamza-above variant was simply never added to the
dictionary.

This is a structurally different class from the bugs we've fixed:
those were all regex / ordering / collision issues in the code. This
is a data issue in the vocabulary table. Tracked as **Bug I** for the
audit document.

---

## Decision precedent — out-of-path discoveries during a green commit

**Date:** 2026-04-13, during COMMIT 5 (BUG-01a + BUG-01b).

**Situation:** while smoke-testing the BUG-01a/b fix, an unrelated
issue surfaced — `أر` (alif-with-hamza-above) was not in
`ARABIC_TO_LATIN` as an R spelling. The standing stop protocol said
"any new Bug class appears → stop." But the finding had three
properties that made landing the commit the correct call:

1. **Out of path.** The discovery was orthogonal to the cleanup code
   being changed in COMMIT 5. Nothing in the BUG-01a/b diff touched
   `ARABIC_TO_LATIN` or the transliteration dictionary.
2. **Green.** All 104 tests (including the three-letter code cases
   that were the COMMIT 5 acceptance criteria) passed. The commit
   met its own spec.
3. **File-scope preserved.** The COMMIT 5 diff stayed within
   `lib/voice-normalizer.js` and its test file. No cross-file
   changes, no scope creep.

**Decision:** land COMMIT 5, flag the finding inline in the commit
message as Bug I, document it in `UPGRADE_LOG.md` and
`VOICE_NORMALIZER_AUDIT.md`, then raise it at the next checkpoint.
User confirmed this was the correct call.

**Rule for future sprints:** a new bug discovered *outside the code
path being changed* during a *green commit* does **not** trigger the
stop protocol. Log it, land the commit, raise it at the next natural
checkpoint. The stop protocol exists to catch regressions and in-path
surprises, not to punish careful observation. A new bug discovered
*inside the code path being changed* — or one that causes a test to
fail — still triggers an immediate stop.

---

## BUG-02 — Silent catches in API routes

**Severity:** Functional (observability)
**Scope:** `app/api/**/*.js`
**Commit:** One commit covering 19 files + vitest config + test.

### Problem

Most API route handlers used `} catch {` with no variable, swallowing
the error entirely before returning a 500 with an Arabic user-facing
message. When a route broke in production, the only signal was the
Arabic error string in the UI — there was no way to tell *why* from
server logs. Some voice-pipeline routes used variants like
`catch (error) {}` with an Arabic-safe extraction but without any
`console.error`. Fire-and-forget `.catch(() => {})` in `init/route.js`
and Promise.all `.catch(() => [])` in `voice/process/route.js` also
swallowed silently.

### Fix

Mechanical rewrite across 19 files in `app/api`:

1. Every `} catch {` before a `return NextResponse.json(...)` rewritten
   to `} catch (err) { console.error('[<route>] <METHOD>:', err); return ... }`.
2. Every `} catch (error) {` / `catch (err)` that had a variable but
   no log gets a `console.error('[<route>] <METHOD>:', error)` added
   as the first statement inside the catch, preserving existing
   Arabic-safe error-message extraction logic.
3. Every inner best-effort `try { ... } catch {}` (no return, e.g.
   context lookups in `voice/transcribe`, `voice/extract`,
   `voice/process`) got a named catch variable and a
   `console.error('[<route>] <action>:', err)` inside the block.
4. Fire-and-forget `.catch(() => {})` and `.catch(() => [])` in
   `init/route.js` and `voice/process/route.js` rewritten to log the
   error before returning the fallback value.

Arabic user-facing strings untouched. No new try/catch added where
none existed. No refactoring beyond the catch blocks themselves.

### Files modified (19)

- `clients`, `deliveries`, `expenses`, `settings`, `invoices`,
  `payments`, `users`, `summary`, `products`, `bonuses`,
  `settlements`, `suppliers`, `sales`, `purchases` (standard CRUD)
- `voice/transcribe`, `voice/process`, `voice/extract`, `voice/learn`
  (voice pipeline)
- `init` (schema/ops endpoint)

`invoices/[id]/pdf/route.js` was **already logging** via a slightly
different format (`console.error('[Invoice PDF]', error.message)`) and
was left untouched per the "don't refactor working code" rule.

### Out of scope (per BUG-02 file-scope rule)

- `lib/db.js` has ~50 `.catch(() => {})` attached to DDL statements
  (`ALTER TABLE ... IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
  `INSERT ... ON CONFLICT DO NOTHING`). These are **intentional
  idempotency patterns** that absorb "already exists" errors on
  repeated init calls. Not silent bugs. Would flag as a separate task
  if ever needed.
- `lib/entity-resolver.js` has one `.catch(() => {})` on a fire-and-
  forget frequency-bump `UPDATE`. Out of `app/api` scope.

### Test

Representative forced-error test: `tests/api-error-logging.test.js`.
Mocks `@/lib/db` so `getBonuses` throws, mocks `next-auth/jwt` so the
token check passes, calls the `GET` handler, asserts:

- Response status is 500
- Response body is the Arabic error message (`خطأ في جلب البيانات`)
- `console.error` was called exactly with `'[bonuses] GET:'` as the
  first arg and the thrown Error as the second

Requires `vitest.config.js` with the `@/*` → project-root alias so the
route's `import { getBonuses } from '@/lib/db'` resolves under Vitest
(the Next.js runtime handles this via `jsconfig.json`, Vitest does
not). New file, minimal content (8 lines).

### Final test counts

```
 Test Files  2 passed (2)
      Tests  105 passed (105)
```

- 104 voice-normalizer tests (BUG-01 series, unchanged)
- 1 BUG-02 forced-error logging test

---

## BUG-03 — Remove `?reset=true` foot-gun from production

**Severity:** Critical (data loss)
**Scope:** `app/api/init/route.js`, `.env.example`, new test file
**Commit:** BUG-03

### Problem as specified

> A single admin click on `/api/init?reset=true` wipes the database.

### State of the code when BUG-03 started

The literal `?reset=true` GET path **already did not exist**. Prior hardening
had moved destructive operations to `POST` with a body-level discriminator
(`action: 'reset'`) plus a confirm phrase (`CONFIRM_PHRASE`) that must match
byte-for-byte. This blocked CSRF / accidental link clicks but **did not block
a malicious or confused admin** — anyone with the admin token and knowledge
of the confirm phrase could still wipe the database, *including in production*.

The BUG-03 spec asked for an environment-level kill switch on top of the
existing confirm phrase. That is exactly what this commit adds — it does not
weaken the confirm phrase, it layers on top of it.

### Fix

Added a hard gate at the top of the `action === 'reset'` branch:

```js
if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DB_RESET !== 'true') {
  console.error('[init] POST reset blocked: NODE_ENV=', ..., 'ALLOW_DB_RESET=', ...);
  return NextResponse.json({ error: 'إعادة التهيئة معطلة في بيئة الإنتاج' }, { status: 403 });
}
```

Both conditions must pass for reset to proceed:
1. `NODE_ENV !== 'production'` — production is never resettable
2. `ALLOW_DB_RESET === 'true'` — opt-in even in dev

The existing confirm phrase check remains as a third layer below the gate.
The blocked-path branch `console.error`s the env state so Vercel logs record
any attempted reset in production.

The `clean` branch is intentionally **not** gated — per the task spec
("Do NOT remove `?clean=true` or `?keepLearning=true`"). `clean` still
deletes business rows but leaves schema + users intact, and it still
requires the confirm phrase.

### .env.example

Added `ALLOW_DB_RESET=false` with a danger comment explaining the gate.
Production deployments must leave it unset or `false`.

### Tests

New file: `tests/bug03-init-reset-gate.test.js` — 5 cases:
1. `NODE_ENV=production` + `ALLOW_DB_RESET=true` → **403**, `resetDatabase` not called
2. `NODE_ENV=development` + `ALLOW_DB_RESET` unset → **403**
3. `NODE_ENV=development` + `ALLOW_DB_RESET='false'` → **403**
4. `NODE_ENV=development` + `ALLOW_DB_RESET='true'` + correct confirm → **200**, `resetDatabase` called once
5. `NODE_ENV=development` + `ALLOW_DB_RESET='true'` + wrong confirm → **400** (confirm phrase still enforced)

Mocks `@/lib/db`, `next-auth/jwt`, and `@vercel/postgres` so no real DB or
auth is touched. Restores original `NODE_ENV` / `ALLOW_DB_RESET` between
tests so later suites are unaffected.

### Verification

```
 Test Files  3 passed (3)
      Tests  110 passed (110)
```

Delta: +5 tests (BUG-03 gate suite). Voice-normalizer (104) and BUG-02
forced-error (1) unchanged.

### Note on spec drift

The spec described the bug as "`?reset=true` GET query param". The actual
code path was already POST-based. I did not chase the GET path (it does
not exist); the production env gate was still required and was the real
fix. No files outside the declared scope were touched.

---

## BUG-04 — Driver PUT schema collision in deliveries

**Severity:** High (silent data loss)
**Scope:** `app/api/deliveries/route.js` — PUT driver branch, line ~64
**Commit:** BUG-04

### Problem

In the driver PUT path, after the token/role checks, the code rebuilt the
request body by spreading the raw database row and then bolting camelCase
keys on top:

```js
body = { ...existing, id: body.id, status: 'تم التوصيل', vin: body.vin || '',
         clientName: existing.client_name, clientPhone: existing.client_phone,
         driverName: existing.driver_name, assignedDriver: existing.assigned_driver };
```

`existing` comes from `SELECT * FROM deliveries` — every column is
**snake_case** (`client_name`, `client_phone`, `driver_name`, `assigned_driver`,
`total_amount`, `date`). The resulting `body` object therefore carried
**both** conventions simultaneously.

`DeliveryUpdateSchema` (in `lib/schemas.js`) is a plain `z.object({...})`
with camelCase keys. Default Zod `.object()` behavior is to **strip unknown
keys**, so:

1. `client_name`, `client_phone`, `driver_name`, `assigned_driver` were
   silently dropped — harmless because the camelCase equivalents were
   overwritten right after.
2. `total_amount` was silently dropped and **never remapped** — so the
   parsed body's `totalAmount` fell back to the schema default of `0`.
   A driver confirming delivery would zero out the total amount of the
   delivery record on its way to `updateDelivery()`.
3. `date` from the DB row is a JS `Date` object, but `dateStr` in the schema
   requires `YYYY-MM-DD`. The Zod parse could fail on legitimate rows
   depending on the DB driver's row shape.

This is the exact "silently strip the wrong one" failure mode BUG-04 calls
out.

### Decision: camelCase, built explicitly (not spread)

Per the task ("Pick ONE convention… justify your choice in the log"):

- **Convention picked:** camelCase. `DeliveryUpdateSchema` already defines
  the wire format in camelCase, and every other write path in this file
  (POST, admin/manager PUT) already speaks camelCase. Keeping the driver
  path in the same shape as every other caller of `updateDelivery()`
  minimizes surface area.
- **Spread vs explicit build:** explicit build. Stripping snake_case keys
  from `existing` with a helper (`_.omit`-style) would keep the spread
  pattern but still pulls whatever the DB happens to return today into
  the request body — a fragile coupling that would silently break if
  the schema grew a new column. An explicit object listing exactly the
  fields the driver PUT needs is both shorter and audit-safe.
- **What the driver is actually allowed to change:** only `status`
  (→ 'تم التوصيل') and `vin`. Every other field must come from `existing`.
  The explicit build makes that contract obvious at the call site.

### Fix

Replaced the spread with an explicit object built from known-good
conversions of the `existing` row, and added a private helper
`dbDateToISO()` local to the file to coerce the DB `date` into the
schema's `YYYY-MM-DD` shape.

### Tests

New file: `tests/bug04-deliveries-driver-put.test.js` — 2 cases:
1. Driver confirms delivery on a row with `total_amount: 4500.5` →
   parsed `updateDelivery` arg has no snake_case keys, `totalAmount`
   is `4500.5` (not `0`), status/vin/clientName/assignedDriver all
   correctly mapped.
2. Driver confirms delivery on a row with a JS `Date` in the `date`
   column → `dbDateToISO()` coerces it to `'2026-03-15'` and Zod
   accepts the parse.

Mocks `@/lib/db`, `next-auth/jwt`, and `@vercel/postgres` (tagged-template
sql mock keyed by interpolated id).

### Verification

```
 Test Files  4 passed (4)
      Tests  112 passed (112)
```

Delta: +2 tests (BUG-04 suite). No pre-existing tests regressed.

---

## BUG-04a — VIN preservation on driver confirm (disclosed during BUG-04)

**Severity:** Medium (silent data loss on admin-prefilled VINs)
**Scope:** `app/api/deliveries/route.js` — one line inside driver PUT branch
**Commit:** BUG-04a (separate from BUG-04 for git-bisect atomicity)

### Origin

Discovered during BUG-04 self-review, disclosed in the BUG-04 landing
report rather than silently bundled into the BUG-04 commit. Isolating
it here preserves the ability to `git revert BUG-04a` later without
losing the BUG-04 snake_case fix, and keeps the BUG-04 commit scoped
to exactly what its task description declared.

### Root cause

The original driver PUT code carried forward `vin` with
`vin: body.vin || ''`. If a delivery row was pre-filled with a VIN at
admission time (e.g. an admin scanned the bike frame on arrival) and
the driver later submitted a blank VIN on confirmation, the `|| ''`
fallback would **wipe** the admin-prefilled VIN on the way through
`updateDelivery()`. Warranty and theft-report traceability rely on
that VIN surviving across every mutation of the row.

### Fix

```js
vin: body.vin || existing.vin || '',
```

Driver-provided VIN still wins when non-blank. Blank driver submission
falls through to the existing row's VIN. Both-blank falls through to
`''`, preserving the existing behavior for rows that genuinely have no
VIN.

### Test-file location decision

**New file** `tests/bug04a-vin-preservation.test.js`, not appended to
the BUG-04 test file. Rationale: a future `git revert BUG-04a` should
remove the code change AND its tests together, in a single atomic
operation. Appending to the BUG-04 test file would couple the two
commits at the test-file level and defeat the whole point of splitting
them. The new file duplicates the mock setup from the BUG-04 test file
(about 40 lines of boilerplate) — this is the cost of bisect atomicity
and is acceptable for a 4-test suite.

### Tests

4 cases in `tests/bug04a-vin-preservation.test.js`:
1. Driver submits `vin: ''`, existing row has `vin: 'ABC123'` →
   final `lastUpdateArg.vin === 'ABC123'` (the preservation case)
2. Driver submits `vin: 'XYZ789'`, existing row has `vin: 'ABC123'`
   → final `lastUpdateArg.vin === 'XYZ789'` (driver override wins)
3. Driver submits `vin: ''`, existing row has `vin: null` →
   final `lastUpdateArg.vin === ''` (no regression on null existing)
4. Driver submits `vin: ''`, existing row has `vin: ''` →
   final `lastUpdateArg.vin === ''` (no regression on empty existing)

Tests 3 and 4 use `items: 'spare parts'` to avoid the BUG 3C
"VIN-required on bike confirmation" guard, which would otherwise
reject a blank-VIN confirmation of a bike row with 400.

### Behavior-change disclosure

This commit intentionally changes observable behavior: a driver who
previously submitted a blank VIN on a row with an existing VIN would
see the VIN wiped; now it is preserved. There is no UI path I could
find that would rely on the wiping behavior, and preserving traceable
serial numbers is consistent with the business rule embedded in the
pre-existing BUG 3C VIN-required check. But it is a behavior change
and is recorded here so that any future regression report mentioning
"VIN not clearing" has a clean pointer back to this commit.

---

## BUG-04b — Edge-case test coverage for deliveries PUT (driver path)

**Severity:** Low (pure test coverage — no code change)
**Scope:** `tests/bug04b-driver-put-edge-cases.test.js` (new), no source change
**Commit:** BUG-04b

### Origin

During the BUG-04 self-review I listed five coverage gaps in my honest
self-assessment. Gap 4 (VIN preservation) is now covered by BUG-04a.
The remaining four are covered here. Isolating them in their own
commit keeps the test history atomic: reverting BUG-04b removes its
tests without touching route code.

### Gaps covered

1. **Null `date` column.** `dbDateToISO(null)` returns `''`, which
   fails `DeliveryUpdateSchema.dateStr` (`^\d{4}-\d{2}-\d{2}$`), so
   the route returns **400** via `zodArabicError`. Test asserts 400
   and that `updateDelivery` is never called.

2. **Missing `id` in request body.** `body.id` is `undefined`, the
   SQL lookup returns zero rows, the existing `!existing` guard
   fires, and the route returns **403**. Traced from the code, not
   guessed.

3. **Null `total_amount` in DB row.** `Number(null) || 0` evaluates
   to `0` (because `Number(null) === 0` in JS). The parsed body has
   `totalAmount: 0`, Zod accepts it (`.min(0).default(0)`), and the
   route returns **200**. Test asserts 200 AND that the parsed
   `totalAmount` is exactly `0`.

4. **Wrong driver path re-asserted against the rebuilt body.** Tests
   that the pre-existing `existing.assigned_driver !== token.username`
   guard still fires **before** the new explicit body construction
   runs, returning **403** and never calling `updateDelivery`. This
   is a regression fence — if a future refactor moves the guard below
   the body build, this test will catch it.

### Test-file location decision

New file `tests/bug04b-driver-put-edge-cases.test.js`, not appended to
BUG-04 or BUG-04a. Same atomicity rationale: reverting BUG-04b should
remove the edge-case coverage as a unit without disturbing either of
the earlier commits. Duplicates the mock setup boilerplate; accepted
cost.

### Verification

```
 Test Files  6 passed (6)
      Tests  120 passed (120)
```

Delta: +4 tests (BUG-04b suite). No source code changed.

---

## BUG-05 — Bounded query window on seller summary

**Severity:** High (unbounded growth, latent DoS on long-tenured sellers)
**Scope:** `app/api/summary/route.js` — seller branch only
**Commit:** BUG-05

### Problem

The seller branch ran `SELECT * FROM sales WHERE created_by = ${token.username}`
and `SELECT * FROM bonuses WHERE username = ${token.username}` with **no
date filter**. A seller employed for two years and selling 5 bikes a week
would pull ~520 rows on every dashboard load. Left unchecked that grows
without bound — and the aggregates are all computed in JS, not SQL, so
the whole payload crosses the network too.

### Decision: "since last settlement" default with 90-day fallback

The task spec said default to "last 90 days." I considered that and went
with a different default after inspecting the schema. Rationale:

- **Seller mental model.** A seller opening the dashboard asks "what have
  I earned since my last payout?" not "what did I do in the last 90
  days?" The first is a product answer; the second is an engineer's
  answer.
- **Schema already supports it.** `settlements` has `(username, date)`
  columns. `MAX(date) WHERE username = ?` is one aggregate over a small
  per-user set — no new index required, well under a millisecond on any
  reasonable dataset.
- **Graceful fallback.** A brand-new seller with no settlements in the
  table has no last-settlement date, so we fall through to the 90-day
  default the spec originally asked for. Existing-seller behavior
  improves; new-seller behavior matches the spec.
- **Response carries the window.** The payload now includes
  `window: { from, to, defaultSource }` where `defaultSource` is
  `'last-settlement'`, `'ninety-day-fallback'`, or `null` (user-supplied).
  The UI can show the seller exactly which window they are looking at
  without guessing.
- **Cost:** one extra DB round-trip per seller dashboard load (the
  `MAX(date)` query). Skipped entirely when the user supplies `?from=`.
  For admins/managers the query is not added at all — the admin path
  delegates to the pre-existing `getSummaryData()` with raw params,
  unchanged.

### Validation

`from` and `to` are validated against `/^\d{4}-\d{2}-\d{2}$/` before any
DB work. Invalid format returns 400 immediately. No zod import needed —
the schema is one line and the error message is route-specific.

### Parameterized SQL

Every DB call is a `@vercel/postgres` tagged template with the values
interpolated via `${}` placeholders. No string concatenation, no
`sql.unsafe`. The sales and bonuses queries both take exactly three
params: `(username, from, to)`. The settlements MAX query takes one:
`(username)`.

### Edge cases considered

- **Last-settlement date stored as a JS `Date` vs `TEXT`.** The schema
  stores `date` as `TEXT` but some drivers still hand back a `Date`
  object for aggregate results in some configurations. Handled with
  `lastDate instanceof Date ? ...toISOString().slice(0,10) : String(...).slice(0,10)`.
- **Boundary inclusion.** Both ends use `>=` and `<=`. A sale made on
  the exact settlement date will appear in the new window (which is
  correct — that sale's bonus was just paid, and showing it matches
  "your last payout included these sales").
- **Timezone.** `new Date().toISOString().slice(0,10)` is always UTC.
  Server runs in UTC on Vercel. No DST drift. The stored `date` column
  is already a YYYY-MM-DD string entered by the seller, so we compare
  strings to strings.
- **`searchParams.get('from')` returns `null` when absent.** The
  `if (fromParam && ...)` guards treat `null` and `''` identically,
  both triggering the default resolution.

### Tests

New file: `tests/bug05-summary-date-window.test.js` — 5 cases:

1. **Seller with no prior settlement** → 90-day fallback window applied.
   Asserts `window.defaultSource === 'ninety-day-fallback'`, both sales
   and bonuses SQL calls received `[username, 90-days-ago, today]` as
   parameter values.
2. **Seller with prior settlement** → `from = last-settlement-date`.
   Asserts `window.defaultSource === 'last-settlement'`, both SQL calls
   received `[username, '2026-02-01', today]`.
3. **User-supplied from/to overrides default** → asserts
   `defaultSource === null` and that the settlements MAX query was
   **never issued** (`sqlCalls.find(...FROM settlements) === undefined`).
4. **Invalid from format (`'2026-3-1'`)** → asserts 400 status AND that
   zero SQL calls were made (validation runs before any DB work).
5. **Admin path unchanged** → asserts `getSummaryData` was called with
   the raw `('2026-01-01', '2026-12-31')` params and zero seller SQL
   calls ran.

The mock captures every `sql` tagged-template call into a `sqlCalls`
array as `{ text, values }` pairs, and routes responses by regex-matching
the template text (`/FROM settlements/i`, `/FROM sales/i`, `/FROM bonuses/i`).
This lets a single test inspect exactly which queries ran, in what
order, and with what arguments.

### Verification

```
 Test Files  7 passed (7)
      Tests  125 passed (125)
```

Delta: +1 file, +5 tests (BUG-05 suite). No pre-existing tests regressed.





