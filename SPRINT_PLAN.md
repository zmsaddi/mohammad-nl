# Vitesse Eco — Week 1 Bugfix Sprint Plan

Out of scope this sprint: Privacy Policy, GDPR endpoints, VAT snapshot, UNIQUE constraints on ref_code, TEXT → DATE migration, UI redesign, React Native prep, TanStack Query, new pages, AI metrics dashboard.

## TASK BUG-01 — Fix `voice-normalizer.js` letter collision
**File:** `lib/voice-normalizer.js`
**Problem:** `ARABIC_TO_LATIN` has `['بي', 'B']` AND `['بي', 'P']`. First match wins, so `P` is unreachable.
**Fix:** Contextual preprocessing. Do not remove entries. Add tests with at least 10 cases including `"في 20 بي رو" → "V20 Pro"`, `"بي ام دبليو" → "BMW"`, `"جي تي 20" → "GT" + "20"`.

## TASK BUG-02 — Add error logging to all silent catches
**Files:** every file under `app/api/**/*.js`
**Problem:** Many routes have `} catch { return NextResponse.json({ error: 'خطأ ...' }, { status: 500 }); }`. No Vercel log trace.
**Fix:** Add `console.error('[<route-name>] <action>:', err);` before each return. Do not change Arabic user-facing messages. Do not add try/catch where none exists.

## TASK BUG-03 — Remove `?reset=true` from production code path
**File:** `app/api/init/route.js` (and any file handling the `reset` query param)
**Problem:** A single admin click on `/api/init?reset=true` wipes the database.
**Fix:** Wrap the reset branch in `if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_DB_RESET === 'true') { ... } else { return 403 }`. Do NOT remove `?clean=true` or `?keepLearning=true`. Add a Vitest test that mocks `NODE_ENV='production'` and asserts 403. Update `.env.example` with `ALLOW_DB_RESET=false` and a warning comment.

## TASK BUG-04 — Fix driver PUT schema collision in deliveries
**File:** `app/api/deliveries/route.js`
**Problem:** In the driver branch, `body = { ...existing, clientName: existing.client_name, ... }`. The resulting object has BOTH `client_name` (snake_case from spread) AND `clientName` (camelCase added). Zod parsing is ambiguous and may silently strip the wrong one.
**Fix:** Pick ONE convention (camelCase matches existing `DeliveryUpdateSchema`). Either strip snake_case keys from `existing` before spreading, OR build the object explicitly without spreading. Justify your choice in the log. Add a Vitest test that asserts the parsed driver-PUT object has no snake_case keys.

## TASK BUG-05 — Add date filter to seller summary
**File:** `app/api/summary/route.js`
**Problem:** The seller branch runs `SELECT * FROM sales WHERE created_by = ${token.username}` with NO date filter. Unbounded growth.
**Fix:** Accept `from` and `to` query params (ISO dates). If both missing, default to last 90 days. Apply to BOTH sales and bonuses queries. Parameterized SQL only. Admin path unchanged. Add a Vitest test asserting the 90-day default is applied.

## TASK BUG-06 — Voice normalizer test coverage expansion
**File:** `tests/voice-normalizer.test.js`
**Status:** LIKELY ALREADY DONE as part of BUG-01 series (we landed 104 tests). Before coding: audit the current test file against this spec and skip this task if coverage is already adequate. If skipped, document why in UPGRADE_LOG.md.
**Original spec was:** For every exported function in `lib/voice-normalizer.js`, at least 3 test cases covering Arabic numerals, alif normalization, tatweel stripping, compound numbers, edge cases (empty / whitespace / punctuation only). Target: 25+ tests.

## TASK ARC-01 — Add JSDoc + region markers to `lib/db.js`
**File:** `lib/db.js`
**Problem:** ~1166 lines, well-organized but hard to navigate.
**Fix:** Add `// #region <name>` and `// #endregion` around existing logical sections (use existing comments as guide — do NOT invent groupings). Add JSDoc `@param` and `@returns` to every `export function` by reading the body, never guessing. DO NOT split the file, move functions, rename, or change any logic. Pure documentation pass. After: `npm run build` and `npx vitest run` must pass.

## TASK ARC-02 — Enable `checkJs` in jsconfig
**File:** `jsconfig.json`
**Fix:** Add `"checkJs": true` and `"noImplicitAny": false`. Run `npx tsc --noEmit`. REPORT total errors found and categorize top 5 categories. DO NOT fix them in this task. Create a follow-up list in `UPGRADE_LOG.md` under `## Type Errors Backlog`.

## TASK TEST-01 — End-to-end test for sale lifecycle
**File:** `tests/sale-lifecycle.test.js` (new)
**Fix:** Integration test covering: `addSale` → `updateDelivery` (confirm) → verify invoice created → verify bonuses created → verify stock decremented → `voidInvoice` → verify stock restored → verify bonuses deleted. Use real `withTx` transactions, no DB mocks. Requires `.env.test` with a separate `POSTGRES_URL`. **KNOWN STOP POINT**: if `.env.test` does not exist, STOP and ask — do NOT use production DB and do NOT improvise.

## Standing Stop Conditions (any ONE triggers a checkpoint)
1. A financial-tier bug appears that was not in the original catalog
2. A task requires a decision not pre-specified
3. A fix requires touching a file outside the task's declared scope
4. A previously passing test starts failing
5. Hitting TEST-01 with no `.env.test`
6. Any commit would exceed 400 lines changed
7. Writing a workaround instead of a fix

## Status
- [x] BUG-01 — voice-normalizer bug catalog (6 bugs fixed, audit document produced, commits: 24d18e5, 9c6e4db, 8ecc6fe, 5cf2027, 02d87d7, 58320f1)
- [x] BUG-02 — silent catch logging (commit: 04f027e, 19 files, 105 tests)
- [ ] BUG-03 — remove `?reset=true` from production
- [ ] BUG-04 — driver PUT schema collision
- [ ] BUG-05 — seller summary date filter
- [ ] BUG-06 — voice-normalizer test coverage (likely already done — audit first)
- [ ] ARC-01 — JSDoc + regions in `lib/db.js`
- [ ] ARC-02 — enable `checkJs` + categorize errors
- [ ] TEST-01 — sale lifecycle E2E (needs `.env.test`)
