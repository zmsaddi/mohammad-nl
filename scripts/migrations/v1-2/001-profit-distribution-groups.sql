-- v1.2 Migration 001 — profit_distribution parent/child schema refactor.
--
-- Pre-v1.2 the profit_distributions table stored one row per RECIPIENT
-- with a shared group_id. Period columns (base_period_start, base_period_end)
-- were nullable and duplicated across every row in the group. A real
-- UNIQUE constraint on (period_start, period_end) was structurally
-- impossible because:
--   (a) Multiple rows per group (one per recipient) → UNIQUE on the
--       tuple would block the second recipient in the same group
--   (b) Nullable periods → Postgres UNIQUE doesn't enforce on NULLs
--
-- This migration creates a parent table `profit_distribution_groups`
-- (one row per logical distribution) with a UNIQUE partial index on
-- the period tuple, and renames the old table to `profit_distribution_
-- recipients` (detail rows linked by FK to the parent).
--
-- The F-001 application-layer cap (advisory lock + decrement check)
-- remains the PRIMARY guard. This schema change adds a DB-level
-- backstop and simplifies the read/write paths.

-- Step 1: Create the parent table
CREATE TABLE IF NOT EXISTS profit_distribution_groups (
  id TEXT PRIMARY KEY,  -- the existing group_id value (PD-xxx-yyy)
  base_period_start TEXT,
  base_period_end TEXT,
  base_amount NUMERIC(19,2) NOT NULL,
  notes TEXT DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ
);

-- Step 2: Unique partial index — blocks same-period duplicate distributions.
-- Only enforced when BOTH dates are non-null (distributions without a period
-- are unconstrained at the DB level; the F-001 cap handles them).
CREATE UNIQUE INDEX IF NOT EXISTS profit_dist_groups_period_unique
  ON profit_distribution_groups (base_period_start, base_period_end)
  WHERE base_period_start IS NOT NULL AND base_period_end IS NOT NULL;

-- Step 3: Backfill parent rows from existing profit_distributions.
-- Each distinct group_id becomes one parent row. MAX() aggregates
-- the period/amount/notes/created_by since they're identical across
-- all rows in a group.
INSERT INTO profit_distribution_groups (id, base_period_start, base_period_end, base_amount, notes, created_by, created_at)
  SELECT
    group_id,
    MAX(base_period_start),
    MAX(base_period_end),
    MAX(base_amount),
    MAX(notes),
    MAX(created_by),
    MIN(created_at)
  FROM profit_distributions
  GROUP BY group_id
ON CONFLICT (id) DO NOTHING;

-- Step 4: Add FK column to profit_distributions linking to the parent.
-- The column is the existing group_id which is already TEXT and matches
-- the parent PK. We just add the CONSTRAINT.
ALTER TABLE profit_distributions
  ADD CONSTRAINT fk_profit_dist_group
  FOREIGN KEY (group_id) REFERENCES profit_distribution_groups(id)
  ON DELETE CASCADE
  NOT VALID;

-- Step 5: Validate the FK (makes it enforced on future inserts, not just
-- existing rows). Separated from ADD CONSTRAINT so the NOT VALID in step 4
-- doesn't block on a full table scan during the migration transaction.
ALTER TABLE profit_distributions
  VALIDATE CONSTRAINT fk_profit_dist_group;
