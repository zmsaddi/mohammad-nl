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

## TASK BUG-04a — VIN preservation on driver confirm (disclosed during BUG-04)
**File:** `app/api/deliveries/route.js`
**Problem:** Original driver PUT code used `vin: body.vin || ''`, which wiped any admin-prefilled VIN whenever the driver submitted a blank VIN on delivery confirmation. Behavior change was outside BUG-04's declared scope and is isolated here for bisect-ability.
**Fix:** `vin: body.vin || existing.vin || ''`. Driver-provided VIN still wins when non-blank; blank driver submission preserves the existing row's VIN.
**Tests:** new file `tests/bug04a-vin-preservation.test.js` — 4 cases (preserve admin VIN, driver override wins, null existing VIN no regression, empty-string existing VIN no regression).

## TASK BUG-04b — Edge-case test coverage for deliveries PUT (driver path)
**File:** `tests/bug04b-driver-put-edge-cases.test.js` (new)
**Problem:** BUG-04 coverage was happy-path only. Gaps identified during BUG-04 self-review: null date column, missing `id`, null `total_amount`, and wrong-driver rejection not re-asserted against the rebuilt body.
**Fix:** Add 4 unit tests exercising each gap against the existing route handler.

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
- [x] BUG-03 — remove `?reset=true` from production (commit: abeb430, moved reset/clean to POST body with `confirm` phrase + `ALLOW_DB_RESET` env gate)
- [x] BUG-04 — driver PUT schema collision (commit: 236308d)
- [x] BUG-04a — VIN preservation on driver confirm (commit: 20bba74)
- [x] BUG-04b — edge-case test coverage for driver PUT
- [x] BUG-05 — seller summary date filter
- [x] BUG-06 — voice-normalizer test coverage (audited, 3 gaps found, 13 tests added)
- [x] ARC-01 — JSDoc + regions in `lib/db.js` (409 net lines, overshoot explicitly approved)
- [x] ARC-02 — measured, deferred to ARC-04 in Sprint 2. Baseline: 1842.
- [x] TEST-01 — sale lifecycle E2E (real Neon via `.env.test`, 3 tests passing)

## Sprint 2 → Sprint 3 Transition (landed, not in Status above)

These items were added to the backlog in Sprint 2 and have since shipped. The Status section at the top of this file only tracks Sprint 1's original catalog — items below landed after it was frozen.

- [x] **BUG-13** — `z.coerce.number()` on user-input boundaries (commit: cc0b057). Discovered during Sprint 2 schema audit. Fixed by upgrading the relevant schemas in `lib/schemas.js` to coerce strings before number validation. The BUG-13 *lesson* ("always coerce at the boundary") is carried forward into BUG-14's schema sweep, which is deferred to pair with ARC-06 in Sprint 3b.
- [x] **FEAT-01** — Alias generator for cold-start entity recognition (commits: 9ac4d21 + 8d5d655 + 39770b3). Adds `generateProductAliases`, `generateSupplierAliases`, `generateClientAliases`; wires them into every entity creation path; introduces `addGeneratedAlias()` with first-writer-wins semantics (vs `addAlias()` which remains newest-writer-wins for confirmed corrections). The architectural review before implementation caught an entity-stealing bug in `addAlias()` that would have bitten the generator — the separate function was designed in from day one rather than patched later. A backfill script lives at `scripts/backfill-aliases.mjs` for existing installations.
- [x] **PERF-03** — Dead voice routes removal + LLM swap (commit: 02eb65f). Deleted `/api/voice/extract` and `/api/voice/transcribe` (zero callers). Switched `/api/voice/process` to Llama 3.1 8B Instant via Groq, dropping the Gemini dependency from the hot path.
- [x] **ARC-01** — JSDoc + region markers on `lib/db.js` (included in Sprint 1 Status but worth reiterating: the file grew to ~2530 lines during Sprint 2/3 work, and the region markers are what keep it navigable).

## Sprint 2 Backlog — Discovered During Sprint 1

### BUG-07 — AI-layer silent catches in lib/db.js
- Source: ARC-01 Discovered Issue #1
- Problem: findAlias, addAlias, getAllAliases, getTopEntities, autoLearnFromHistory,
  getAIPatterns, getRecentCorrections, saveAICorrection all catch-and-return-empty
  with no logging. Masks DB outages from observability.
- Scope: apply BUG-02-style console.error to these 8 functions without changing
  the catch-and-fallback semantics — log then return fallback.
- Severity: Observability (not financial, not functional — but blocks diagnosis
  of a larger outage if one occurs).
- Estimated: <100 lines, one commit.

### BUG-08 — calculateBonusInTx driver source-of-truth fallback
- Source: ARC-01 Discovered Issue #2
- Problem: lib/db.js:1475 `const confirmedDriver = delRow[0]?.assigned_driver || driverUsername`
  falls back to caller-passed driverUsername when delivery row is empty.
  A bonus could in principle be paid to the wrong user if delRow lookup
  returns nothing but the caller passed a stale username.
- Severity: Financial (narrow window, low probability, but direct money impact).
- Fix approach: if delRow is empty, throw — do not fall back. An empty delRow
  at this point is already a broken state and silently proceeding is worse than
  failing loudly.
- Tests: add a case covering the empty-delRow path and assert it throws.
- Estimated: ~40 lines, one commit.
- Flagged for Sprint 2 priority-1 slot. Financial-tier. Do not defer further.

### ARC-04 — Type debt reduction pass
- Source: ARC-02 measurement
- Baseline: 1842 tsc errors under `checkJs: true, noImplicitAny: false`
- Measured pattern distribution (only 3 patterns measured, not full taxonomy):
  - `searchParams.get()` narrowing (`string | null`): 14 errors (0.8%)
  - `@vercel/postgres` SQL params typed `unknown`: 39 errors (2.1%)
  - NextAuth `AuthOptions` / `SessionStrategy`: 1 error (0.05%)
  - Residual (unmeasured): 1788 errors (97.1%)
- **The three "dominant" patterns identified from the first 7 errors account
  for only 2.9% of the backlog.** A mechanical sweep on just those three
  would leave 1788 errors behind, still 9× the 200 threshold. ARC-04 needs
  its own measurement pass against the residual before a real plan can be drawn.
- Plan: (1) re-enable checkJs temporarily, (2) measure the residual to find
  the actual dominant patterns, (3) sweep them, (4) re-measure, (5) repeat
  until count is below 100, (6) re-enable checkJs permanently.
- Estimated: unknown until residual is measured. Do NOT assume 2–4 commits —
  the real cost is probably higher.
- Dependency: BUG-07 (AI-layer logging) should land first so that the type
  sweep doesn't collide with the catch-clause rewrites.

### ARC-03 — addSale transaction boundary (documentation or migration)
- Source: ARC-01 Discovered Issue #3
- Problem: addSale() calls addClient() outside its own withTx client, so sale
  creation is not truly atomic with client creation. The existing code comment
  at lib/db.js:690 acknowledges this and argues idempotency on (name, phone) /
  (name, email) makes the orphan case harmless.
- Decision needed: either (a) document this publicly as an accepted design
  trade-off in PROJECT_DOCUMENTATION.md under a "Transaction Boundaries" section,
  or (b) refactor addClient to accept an optional tx client parameter and pass
  it through from addSale. Option (a) is 0 lines of code. Option (b) is ~30
  lines and makes the guarantee real.
- Severity: Correctness-of-documentation. The code works; the claim of atomicity
  does not fully match the code.
- Estimated: (a) 15 minutes, (b) 2 hours + tests.

### ARC-05 — Canonical naming across Vercel, Neon, and seed data
- Source: TEST-01 pre-flight investigation, Sprint 1
- Problem: the Neon project is "accounting-db", the Vercel project is
  "mohammad_nl", the seeded company name in lib/db.js is "Vitesse Eco SAS",
  the repo is "zmsaddi/mohammad-nl". Four different names for one system.
  Cost measurable triage time during TEST-01 setup (multiple conversational
  turns spent disambiguating which Neon project was production).
- Decision needed from user first: pick the canonical name. Recommended:
  "vitesse-eco" as the business brand, since that is what appears on
  invoices and what end users see.
- Fix (after user decision):
  1. Rename Neon project via `neonctl projects update <id> --name vitesse-eco-prod`
  2. Rename Vercel project via Vercel UI (Settings → General → Project Name)
  3. Update SETUP.md and PROJECT_DOCUMENTATION.md section 10 with new names
  4. Optionally rename the GitHub repo (user decision — has URL impact)
- Severity: hygiene / future-risk-reduction
- Blocker: none, do anytime in Sprint 2
- Estimated: 30 minutes

### DOC-01 — SETUP.md update for .env.test requirement
- Source: TEST-01 honest engineering assessment, Sprint 1 closing summary
- Problem: tests/setup.test-env.js throws if .env.test is missing. Any
  developer running `npx vitest run` in a fresh clone sees every test fail.
- Fix: add a "Running tests" section to SETUP.md explaining:
  1. .env.test must exist at repo root
  2. It must contain POSTGRES_URL pointing at a DB the developer is
     willing to have TRUNCATEd
  3. The simplest setup is `vercel env pull .env.test` for a developer
     with Vercel access, or a personal Neon project for open-source
     contributors
  4. Warning: running the lifecycle test against any non-disposable
     database WILL delete its business data
- Severity: onboarding / documentation
- Estimated: 20 minutes

### BUG-14 — Add Zod schemas to currently-unvalidated POST/PUT routes
- Source: BUG-13 audit (Sprint 2 hot-fix #2)
- Problem: 6 write routes accept request bodies without any Zod validation:
  - POST /api/products
  - POST /api/clients (also PUT)
  - POST /api/suppliers (also PUT)
  - POST /api/users (also PUT)
  - POST /api/settlements
  - POST /api/deliveries
- Risk: malformed bodies hit lib/db.js directly. Currently masked by
  client-side discipline and Postgres bind coercion. A single misbehaving
  caller (or a future bug like BUG-13) can blow up these routes.
- Fix: define ProductSchema, ClientSchema, SupplierSchema, UserSchema,
  SettlementSchema, DeliverySchema in lib/schemas.js. Wire each route's
  POST/PUT handler to call schema.safeParse(body) before reaching db.js.
- Use z.coerce.number() everywhere from the start (BUG-13 lesson).
- After BUG-14 lands, remove the two defensive parseFloat lines from
  addDelivery and addSettlement that BUG-13 added.
- Severity: hardening / prevent-future-regressions
- Estimated: 2-3 hours (including writing per-route tests)

### FEATURE-01 — Manual entity entry forms (UI)
- Source: FEAT-01 architectural review
- Problem: there are no admin UI forms for manually adding products,
  suppliers, or clients. Today entities are only created as side effects
  of POST /api/purchases or VoiceConfirm.js auto-create.
- Impact on FEAT-01: the alias generator hooks fire for those existing
  paths, so FEAT-01 still delivers ~80% of its value without the form.
  But the explicit "manual entry workflow" the user described needs
  the form to be built.
- Fix: add three small forms — products, suppliers, clients — under the
  admin UI. Each POSTs to the existing /api/* route, which auto-fires
  the alias generator. Zero backend changes.
- Severity: feature gap / UX
- Estimated: 3-4 hours
- Priority: Sprint 3 candidate

### BUG-19 — addAlias() newest-writer-wins is unsafe for non-confirmed sources
- Source: FEAT-01 architectural review
- Problem: the existing addAlias() function rewrites entity_id to whichever
  caller arrived second. This is correct for confirmed_action (user just
  confirmed the new entity is right) but unsafe for any future caller that
  doesn't have user evidence behind its claim. FEAT-01 mitigates this by
  introducing addGeneratedAlias() with first-writer-wins for the generator
  path; addAlias() is left alone.
- Fix: formalize the policy in addAlias() with an explicit allowed-sources
  list (only `confirmed_action` and `user` get newest-writer-wins; everything
  else uses first-writer-wins). Or, alternatively, deprecate addAlias() in
  favor of two named functions: addConfirmedAlias() and addLearnedAlias().
- Severity: latent bug — fix when next non-confirmed caller is added
- Estimated: 1 hour

### BUG-20 — Resolver Fuse cache invalidation gap
- Source: FEAT-01 architectural review
- Problem: invalidateCache() is currently called only from saveAICorrection()
  and (after FEAT-01) from generateAndPersistAliases(). Other entity-mutation
  paths that should invalidate but don't:
  - addProduct() WITHOUT the generator (e.g., when name validation fails)
  - updateProduct() / PUT /api/products
  - deleteProduct() / DELETE /api/products
  - same for clients and suppliers
- Risk: a freshly-updated or deleted entity may still appear in the resolver
  cache for up to 5 minutes (Fuse cache TTL). Stale matches.
- Fix: add invalidateCache() calls to every entity mutation path. Or move
  the responsibility to a wrapper layer.
- Severity: UX — affects accuracy of voice resolution after admin edits
- Estimated: 1 hour

### BUG-21 — addSupplier() lacks ambiguity detection
- Source: FEAT-01 architectural review
- Problem: addClient() has identity disambiguation via (name+phone) OR
  (name+email) and returns { ambiguous: true } when only a name is given
  and matches exist. addSupplier() has no equivalent — two real suppliers
  named "Ali Trading" collide forever.
- Fix: mirror the addClient() ambiguity flow in addSupplier(). Add phone
  and email columns to suppliers table (currently has phone only, no email).
  Disambiguate by (name+phone) OR (name+email).
- Severity: data integrity
- Estimated: 2 hours
