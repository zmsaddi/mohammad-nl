# Voice Normalizer Audit — `lib/voice-normalizer.js`

**Audit period:** 2026-04-13, Week 1 Bugfix Sprint
**File under audit:** `lib/voice-normalizer.js`
**Scope:** BUG-01 series (BUG-01c → BUG-01d → BUG-01g → BUG-01 → BUG-01a/b)
**Test suite:** `tests/voice-normalizer.test.js` — **104 tests, all green**

This document exists so that a new engineer joining the project six
months from now can understand **why the file looks the way it does**
without having to archaeologically reconstruct the sprint. Read it
end-to-end before modifying any Arabic-boundary regex, any dictionary
entry, or `mergeLetterNumberTokens()`.

---

## 1. Bug catalog

Nine distinct bug classes were discovered or fixed during the sprint.
Each entry below includes severity, financial impact, root cause in
one sentence, fix commit hash (or "not fixed"), and test count.

### Fixed bugs

| ID | Name | Severity | Financial impact | Root cause (1 line) | Fix commit | Tests |
|---|---|---|---|---|---|---|
| **C** | Substring corruption | **Critical / financial** | Invoice amounts silently wrong for خمسين/ألفين/تلاتين/ستين/سبعين/يورو inputs | Letter mappings (سي→C, في→V, تي→T, يو→U) were applied with plain `replace(new RegExp(ar, 'g'), en)` and matched inside Arabic number/currency words | `24d18e5` | 6 corruption tests + 30-token mixing sweep |
| **D** | `\b` on Arabic in number passes | **Critical / financial** | Standalone Arabic numbers (خمسين, بخمسين, مية) never normalized in production | Two loops used `new RegExp('\\bword\\b')` but JS `\b` is defined against `\w = [A-Za-z0-9_]`, so it never fires inside Arabic text | `9c6e4db` | 7 BUG-01d + 28-value regression suite |
| **G** | `X آلاف` multiplication missing | **Critical / financial** | Every e-bike sale priced 3000–10000 EUR produced unparseable garbage | `آلاف` is the broken plural of `ألف` meaning "thousands" and needs multiplication by the preceding unit; no dictionary entry and no regex semantics for it existed | `8ecc6fe` | 9 BUG-01g cases + 8 unskipped in regression suite |
| **F** (BUG-01) | `بي → P/B` collision | Functional (resolver fallback) | Every spoken `P`-prefix product resolved to `B` | `ARABIC_TO_LATIN` had both `['بي','B']` and `['بي','P']` at equal length; stable sort gave `B` the win and `P` was dead code | `5cf2027` | 5 BUG-01 cases |
| **A** | Single-pass cleanup | Functional | Three-letter product codes (BMW, BTX, GTX) never collapsed fully — trailing letter dropped | `([A-Z])\s+([A-Z])` ran exactly once and JS global replace doesn't re-scan overlapping matches | `02d87d7` | 3 three-letter cases in BUG-01a/b suite |
| **B** | Cleanup-before-numbers ordering | Functional | `"في عشرين برو"` emitted `"V 20 Pro"` instead of `"V20 Pro"` | Cleanup pass lived inside `transliterateArabicToLatin` and ran before `normalizeArabicNumbers`, so it never saw the digits produced from Arabic number words | `02d87d7` (same commit as A) | 2 Arabic-number-word cases in BUG-01a/b |

**Total tests added/updated across the BUG-01 series:** 104.

### Not fixed (tracked for follow-up)

| ID | Name | Severity | Why not fixed | Recommended timing |
|---|---|---|---|---|
| **E** | Catalog mappings live in the normalizer | Architectural | Entries like `الفيشن → V20 Pro` and `دوبل باتري → Double Batterie` are product-catalog knowledge that belongs in `entity-resolver.js` aliases, not in the lexical normalizer. Pure smell, not user-visible. | ARC review, not a bugfix |
| **H** | Singular `ألف` with compound multipliers | Financial (edge) | `أحد عشر ألف` (11000), `خمسين ألف` (50000), `مية ألف` (100000) use **singular** `ألف` with a compound multiplier — structurally different from BUG-01g. Out of scope by user pre-authorization. Affects high-ticket edge cases above Vitesse Eco's normal bike price range (3000–10000 EUR). | Post-sprint, if a single high-ticket sale is ever mis-parsed |
| **I** | Alif-variant dictionary gap | Data coverage | `أر` (alif-with-hamza-above) is a valid spoken-R spelling not in `ARABIC_TO_LATIN` (only `آر` alif-madda and `ار` bare alif are). Dictionary issue, not a code bug. Spotted during COMMIT 5 smoke-testing. | Next dictionary-expansion pass — likely many more alif/ha/ya spelling variants are missing for other words too |

---

## 2. `arabicSafeBoundary()` — design rationale

This helper lives at the top of `lib/voice-normalizer.js` and is used
by **three** loops in the file. It is the single point of truth for
"what counts as an Arabic word boundary." If you are about to write a
new `new RegExp('\\b...\\b')` anywhere in this file, stop and use the
helper instead.

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

### Why explicit lookbehind/lookahead instead of `\b`

JavaScript's `\b` is defined against `\w = [A-Za-z0-9_]`. Arabic
letters are **not** in `\w`, so `\b` never matches at the edge of an
Arabic word — it fires only at Latin/Arabic transitions, which is
almost never where you want it to fire. Before the sprint, two loops
in this file used `\bword\b` and one used a substring replace; none
of them correctly handled Arabic word boundaries:

```js
// BEFORE (broken)
new RegExp(`\\b${word}\\b`, 'g')                   // line 87 — never matched
new RegExp(`\\b${ar}\\b`, 'g')                     // line 317 — never matched
result.replace(new RegExp(ar, 'g'), en)            // line 311 — corrupted

// AFTER (correct)
arabicSafeBoundary(word, { allowPrefix: true })    // Phase 2 numbers
arabicSafeBoundary(ar, { allowPrefix: true })      // ENGLISH_NUMBERS
arabicSafeBoundary(ar)                             // letter spellings
```

The explicit boundary is `[whitespace + Arabic punctuation + Latin
punctuation]` — everything that isn't an Arabic letter or a Latin
letter or a digit. Start-of-string and end-of-string are handled via
`^` and `$` in the assertion. This matches how native speakers hear
word boundaries.

### Why capture the proclitic instead of matching with zero-width assertion

Arabic prepositional clitics `ب / ل / و / ف / ك` are one-character
prepositions that attach directly to the following word with no
space: `بخمسين` (with fifty), `وخمسمية` (and five hundred), `لمية`
(for a hundred). These are not typos or noise — they are the normal
way to say "with/for/and N" in Arabic.

We **capture** the clitic in a group and **re-emit** it in the
replacement rather than using `(?<=[^\\w]|[بلوفك])` zero-width lookahead.
Two reasons:

1. **Preserved meaning in the LLM input.** The clitic carries
   grammatical meaning the downstream LLM uses to disambiguate
   "sold for 500" vs "sold 500 of them". Emitting `ب500` instead of
   just `500` keeps that signal.
2. **No ambiguity with unrelated words.** If we used a lookahead, we
   would have to reason about whether the clitic character "belongs"
   to the word before or after. Capturing it makes the decision
   explicit: this character is part of *this* number, not the
   previous one.

### Why `allowPrefix` is a parameter, not always-on

Number words (BUG-01d) want proclitic tolerance: `بخمسين → ب50`.

Letter-spelling mappings (BUG-01c) **must not** have it: if `بي → B`
with `allowPrefix: true`, then any Arabic word starting with ب followed
by `ي` would match, and the Arabic language has a lot of those. For
example `بيت` (house) would become `Bت` — a corruption exactly like
the one BUG-01c was introduced to fix.

One parameter, two completely different tolerance profiles. The
default is `false` so the stricter behavior is always the one you
get if you forget to set it.

### Why the proclitic set is exactly `[بلوفك]`

These are the five one-character proclitics in Modern Standard
Arabic and Levantine/Gulf dialects (which Vitesse Eco's sellers
speak). Any two-character clitic (`عل`, `بل`) is already a full
word and gets its own whitespace-delimited token in a normal
transcript. The set is deliberately small because every character
we add is a character we also have to prove can't cause a
false-positive match.

---

## 3. Future-proofing — three most likely unseen bug classes

Honest engineering prediction of what we'll discover next. Ordered by
probability × financial impact.

### Prediction 1 — Alif/ya/ha variant dictionary gaps (Bug I extended)

Bug I is a single sighting of a much larger class: **every word in
every dictionary has multiple legitimate Arabic spellings, and the
dictionaries cover only some of them.**

- **Alif variants:** `ا` (bare) vs `أ` (hamza above) vs `إ` (hamza
  below) vs `آ` (madda) vs `ٱ` (wasla). Initial alif is especially
  fluid. The dictionary has `اكس`/`إكس` for X and `ار`/`آر` for R,
  but `أر` was missed.
- **Taa marbuta vs haa:** `خمسة` vs `خمسه`, `مئة` vs `مئه`, `ة` vs
  `ه`. `normalizeForMatching` already handles this for entity
  matching, but `normalizeArabicNumbers` and `transliterateArabicToLatin`
  do not — so `خمسه` is silently never matched to 5.
- **Ya vs alif maqsura:** `ي` vs `ى` at word-final position.
- **Missing diacritics:** `خَمسين` vs `خمسين` (with/without fatha).
  Whisper usually strips diacritics, but when it doesn't, the
  diacritic character breaks the match.

**Fix shape:** run `normalizeForMatching`-style Arabic letter unification
on the input to `normalizeArabicNumbers` and `transliterateArabicToLatin`
before matching, OR expand every dictionary entry with all legitimate
variants. The first is cleaner; the second is more predictable.

**Why this is priority 1:** dictionary coverage gaps look like data
entry mistakes, they pass code review easily, and they silently
fail. We already found one (Bug I); there are almost certainly more.

### Prediction 2 — `مليون` / `مليار` multiplication (Bug G extended)

The same structural pattern as Bug G (`X آلاف` multiplication) exists
for higher orders:

- `تسعة ملايين` = 9,000,000 (nine million)
- `تلاتة ملايين وخمسمية ألف` = 3,500,000 (three million five hundred
  thousand)
- `مليار` = 1,000,000,000 (billion)

Currently `مليون` and `ملايين` are not in any dictionary, and no
Phase-0-style multiplication exists for them. Severity is lower than
Bug G in the Vitesse Eco context (no single item costs a million
euros), but it can appear in **annual revenue reports** or **stock
valuation** conversations the owner might dictate.

**Fix shape:** extend Phase 0 of `normalizeArabicNumbers` with
additional multiplier passes for `ملايين`, `ألف مليون`, `مليار` at
successively higher orders. Same proclitic handling as BUG-01g. The
regex structure is identical; only the multiplier word and the
resulting power of 10 change.

**Why this is priority 2:** structurally familiar (we've already
solved the equivalent problem once), lower immediate financial
impact than Bug G was, but a completely foreseeable expansion.

### Prediction 3 — Decimal and fractional numbers

Spoken Arabic for "fifty and a half" is `خمسين ونص`. For "a quarter
to a thousand" it's `ألف إلا ربع`. These are common in pricing
context because sellers often say "فاصلة" (point/comma) for decimal
prices in EUR. None of this is handled today.

- `نص` / `نصف` = 0.5
- `ربع` = 0.25
- `تلث` / `ثلث` = 0.333…
- `فاصلة` = decimal point
- `إلا` = minus (as in `ألف إلا ربع` = 999.75 or 750 depending on
  context)

**Fix shape:** this is thornier because it requires understanding
whether the seller means currency sub-units (50 cents) or actual
fractions (half of a thing). Probably best handled at the LLM prompt
layer, not in the lexical normalizer. But we should at least **not
crash** on inputs that contain these words — they currently pass
through as raw Arabic, which is mostly graceful but occasionally
mixes with other matches in surprising ways.

**Why this is priority 3:** rarer in the current use case, harder to
do correctly, and the graceful-pass-through behavior is acceptable
until it isn't. Worth watching the corrections log in `ai_corrections`
for occurrences of these words.

---

## 4. Invariants the file must preserve

If you modify `lib/voice-normalizer.js`, these invariants should
hold after your change. They are load-bearing for financial
correctness and are all encoded in `tests/voice-normalizer.test.js`:

1. **No Arabic+Latin mixed tokens.** No whitespace-delimited token
   in the output may contain both Arabic letters `[\u0600-\u06FF]`
   and uppercase Latin letters `[A-Z]`. This is the invariant that
   catches Bug C, its family, and any future substring-corruption
   regression. Encoded in the 30-word regression sweep's
   `hasMixedToken()` helper.

2. **Every dictionary-resolvable Arabic number normalizes to its
   digit.** The 28-value compound regression suite encodes this
   for 10–10000. If you change any boundary logic, this suite must
   stay 28/28 green.

3. **`بي` always becomes `B`, never `P`.** Standard Arabic has no
   `/p/` phoneme; the only `P` path is the Persian `پي`.

4. **The proclitic re-emission preserves the letter.** `بخمسين`
   becomes `ب50`, not `50`. The LLM downstream uses the preposition
   to disambiguate meaning.

5. **Letter+number merge is idempotent.** After
   `mergeLetterNumberTokens()` runs, there is no adjacent
   `[A-Z] \s+ \d` or `[A-Z] \s+ [A-Z]` token pair remaining. The
   `do/while` loop in the helper is what enforces this — do not
   replace it with a single-pass `replace`.

---

## 5. How to extend this file safely

- **Adding a new Arabic number word:** add it to the appropriate
  dictionary (`UNITS`, `TENS`, `HUNDREDS`, `LARGE`). Do nothing else.
  The boundary logic in `arabicSafeBoundary()` will pick it up
  automatically via `NUMBER_PATTERNS`.

- **Adding a new letter spelling:** add it to both `ARABIC_TO_LATIN`
  and `LETTER_MAPPING_SOURCES`. Forgetting the second will cause
  substring corruption (Bug C class).

- **Adding a new product/variant word:** add it to `ARABIC_TO_LATIN`
  but **NOT** to `LETTER_MAPPING_SOURCES`. Product words are
  substring-matched by design so they fire inside longer phrases.

- **Adding multiplication semantics for a new unit:** add a new
  Phase (Phase 0 pattern, see BUG-01g) to `normalizeArabicNumbers`.
  Run Phase 0 style first (most specific → least specific) so that
  compound patterns fire before standalone replacements eat their
  operands.

- **Adding catalog aliases (entity-level knowledge):** do NOT add
  them here. They belong in `lib/entity-resolver.js` as database
  aliases. Bug E is the standing warning about this. If you find
  yourself adding `['someCatalogName', 'actual SKU']` to
  `ARABIC_TO_LATIN`, stop and route it through the entity resolver
  instead.

---

## 6. Commit trail

| Commit | Task | Tests passing | Tests skipped |
|---|---|---|---|
| `24d18e5` | BUG-01c — substring corruption | 47 | 1 (Bug D canary) |
| `9c6e4db` | BUG-01d — `\b` in number passes | 74 | 9 (Bug G class) |
| `8ecc6fe` | BUG-01g — `X آلاف` multiplication | 92 | 0 |
| `5cf2027` | BUG-01 — `بي → P/B` collision | 97 | 0 |
| `02d87d7` | BUG-01a + BUG-01b — cleanup loop + ordering | 104 | 0 |

Full details for each commit: see `UPGRADE_LOG.md`.
