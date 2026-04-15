-- =============================================================
-- Vitesse Eco v1.0.2 — Profit Distribution Migration
-- =============================================================
--
-- PURPOSE
--   Creates the profit_distributions table (Feature 2 from v1.0.2).
--   One logical distribution is stored as N rows sharing a
--   single group_id (one row per recipient), each with their own
--   percentage and computed amount. base_amount is denormalized
--   onto every row so a single query can rebuild the full split
--   without self-joining.
--
-- IDEMPOTENCY
--   initDatabase() in lib/db.js already runs the same CREATE TABLE
--   IF NOT EXISTS + CREATE INDEX IF NOT EXISTS statements in its
--   catch-wrapped migration block, so on a fresh deploy the table
--   appears automatically. This file is the manual version for
--   users who prefer to run it via the Neon SQL Editor before
--   first use of the /profit-distributions page.
--
--   Running this file twice is safe — every statement uses
--   `IF NOT EXISTS`.
--
-- HOW TO RUN (recommended via Neon SQL Editor)
--   1. Take a snapshot in Neon first (Branches → Create snapshot).
--   2. Open SQL Editor.
--   3. Paste this file and click Run.
--   4. Inspect the verification block at the bottom.
--
-- =============================================================

BEGIN;

-- 1. Create the profit_distributions table
CREATE TABLE IF NOT EXISTS profit_distributions (
  id SERIAL PRIMARY KEY,
  group_id TEXT NOT NULL,
  username TEXT NOT NULL,
  base_amount NUMERIC(19,2) NOT NULL,
  percentage NUMERIC(5,2) NOT NULL,
  amount NUMERIC(19,2) NOT NULL,
  base_period_start TEXT,
  base_period_end TEXT,
  notes TEXT DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Indexes — group for drill-down, username for recipient history,
--    created_at for newest-first listing
CREATE INDEX IF NOT EXISTS profit_distributions_group_idx
  ON profit_distributions(group_id);
CREATE INDEX IF NOT EXISTS profit_distributions_username_idx
  ON profit_distributions(username);
CREATE INDEX IF NOT EXISTS profit_distributions_created_idx
  ON profit_distributions(created_at DESC);

-- =============================================================
-- VERIFICATION
-- =============================================================

SELECT table_name
FROM information_schema.tables
WHERE table_name = 'profit_distributions';

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'profit_distributions'
ORDER BY ordinal_position;

SELECT indexname
FROM pg_indexes
WHERE tablename = 'profit_distributions'
ORDER BY indexname;

COMMIT;

-- =============================================================
-- POST-MIGRATION NOTES
-- =============================================================
--
-- After this commits, the /profit-distributions admin page works
-- immediately. Admin + manager users can be selected as recipients
-- (filtered at the API layer). Percentages must sum to 100%
-- (enforced by addProfitDistribution). The user can enter the base
-- manually, or pick a date range and let the UI auto-fetch the
-- total collected revenue in that period via the
-- /api/profit-distributions/collected-revenue endpoint.
-- =============================================================
