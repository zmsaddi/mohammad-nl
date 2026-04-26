# Token Rotation Procedure (v1.2)

**Status:** PENDING — owner-executed only. Do NOT auto-rotate.

The 3 tokens listed in `.env.local` (NEON_API_KEY, GITHUB_TOKEN, VERCEL_TOKEN) were pasted into a chat transcript during v1.1 Sprint 2 setup and are therefore considered leaked from a zero-trust posture. They still work today, but should be rotated at the user's earliest convenience.

**Why this is owner-executed (not auto-executed):**
- Each rotation has a one-time-display value that must be captured immediately.
- A wrong move can lock the user out of their own account or break Vercel deploys.
- Some rotations require updating the value in multiple places.
- An automated rotation that fails halfway leaves the system in a broken state with no easy rollback.

This document is the runbook. Execute one secret at a time, verify, then move to the next.

---

## Pre-flight (do once, before any rotation)

```bash
# Confirm production is healthy NOW so any post-rotation regression is attributable
curl -s https://mohammadnl.vercel.app/api/health | jq
# → { "ok": true, "version": "v1.2.0", "db_latency_ms": <500 }

# Snapshot DB state
cd d:/mohammad_nl
node --env-file=.env.local scripts/_snapshot.mjs > snapshots/pre-rotation.json
```

---

## 1. NEON_API_KEY rotation

**Current value:** in `.env.local` line 17 (`napi_2z65w4az5ao4ak29nzimy29ek3r6qh1npzwwnj9kbdjwkel9lrc8qn9oyu3q9q0p`)

**Used by:** `scripts/_snapshot.mjs` (READ-ONLY queries via @vercel/postgres) and any future Neon-API admin scripts. The Neon API key is project-scoped (`odd-unit-28364132`).

**Blast radius if wrong:** local snapshot scripts stop working. Production unaffected (Neon connection uses POSTGRES_URL which has its own credentials).

### Steps

1. https://console.neon.tech → Account Settings → API Keys
2. Click **Create new API key**
   - Scope: project `accounting-db` (or whichever holds production)
   - Name: `mohammad-nl-prod-2026-04` (or current month)
3. **Copy the value immediately** — Neon shows it only once.
4. Open `d:/mohammad_nl/.env.local` and replace line 17:
   ```
   NEON_API_KEY=napi_<NEW_VALUE>
   ```
5. Verify the new key works:
   ```bash
   curl -s -H "Authorization: Bearer $(grep NEON_API_KEY .env.local | cut -d= -f2)" \
     "https://console.neon.tech/api/v2/projects/odd-unit-28364132/branches" | jq '.branches | length'
   # → expect: 2 (main + test-sandbox)
   ```
6. **Revoke the old key** in the Neon console (API Keys page → trash icon next to old key).

**Cadence:** quarterly, or immediately on suspected compromise.

---

## 2. GITHUB_TOKEN (PAT) rotation

**Current value:** in `.env.local` line 19 (`github_pat_11AIRVE...`)

**Used by:** v1.1 Sprint 2 setup scripts (now removed from repo). NOT used by GitHub Actions CI (those use `GITHUB_TOKEN` auto-injected, separate from the PAT). NOT used by gh CLI (which has its own auth).

**Blast radius if wrong:** none. The PAT is currently unreferenced in active code.

### Steps

1. https://github.com/settings/tokens → find the token by name or expiry.
2. Click **Regenerate token** (or **Delete** if you want to remove entirely).
3. If you regenerated:
   - Copy the new value immediately.
   - Update `.env.local` line 19.
4. If you deleted:
   - Remove the line from `.env.local`.
5. Verify nothing breaks:
   ```bash
   gh auth status   # gh CLI uses its own auth, should still work
   git push --dry-run origin master   # git uses gh CLI auth
   ```

**Cadence:** consider removing entirely since no active code uses it.

---

## 3. VERCEL_TOKEN rotation

**Current value:** in `.env.local` line 21 (`vcp_702ht3uc...`)

**Used by:** Vercel CLI (`vercel deploy`, `vercel env ls`) when run from local with this token. Vercel-side deployments (auto-deploy on git push) use the GitHub integration and do NOT need this token.

**Blast radius if wrong:** local `vercel` CLI commands fail. Auto-deploy on push is unaffected.

### Steps

1. https://vercel.com/account/tokens → Create new token
   - Scope: full account (or just `mohammad_nl` project)
   - Expiration: 90 days recommended
2. Copy the new token immediately.
3. Update `.env.local` line 21.
4. Test:
   ```bash
   VERCEL_TOKEN=$(grep VERCEL_TOKEN .env.local | cut -d= -f2) \
     npx vercel whoami
   # → expect: your account email
   ```
5. **Revoke the old token** in the Vercel dashboard.

**Cadence:** quarterly, or whenever you rotate Vercel access.

---

## Post-rotation verification (do after EACH rotation)

```bash
# 1. Confirm production still healthy
curl -s https://mohammadnl.vercel.app/api/health | jq

# 2. Confirm DB state unchanged
cd d:/mohammad_nl
node --env-file=.env.local scripts/_snapshot.mjs > snapshots/post-rotation.json
diff snapshots/pre-rotation.json snapshots/post-rotation.json | grep -v generated_at | wc -l
# → expect: 0

# 3. Confirm CI still has its repo secrets
gh secret list --repo zmsaddi/mohammad-nl
# → expect: NEON_TEST_BRANCH_URL, NEON_TEST_BRANCH_URL_NON_POOLING (and GROQ_API_KEY if added)
```

---

## Rollback

If a rotated token doesn't work:

1. **DO NOT delete the old token** until the new one is verified working.
2. If the new value is wrong, restore the old value to `.env.local` from your password manager / chat history.
3. The "leak" risk is theoretical — old tokens still function until you actively revoke them.

---

## Notes

- `.env.local` is in `.gitignore` (line 41) — these values never leave your machine.
- `.env.test` has its own credentials for the test-sandbox Neon branch and is unrelated to this rotation.
- Production Postgres credentials (`POSTGRES_URL` etc., lines 2-7 of `.env.local`) are managed by Vercel's Neon integration. Rotation of those is a separate procedure documented in `SETUP.md` §8.
