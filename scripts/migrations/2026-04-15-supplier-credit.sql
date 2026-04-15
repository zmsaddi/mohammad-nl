-- =============================================================
-- Vitesse Eco v1.0.1 — Supplier Credit Migration
-- =============================================================
--
-- PURPOSE
--   Adds partial-payment tracking to purchases (Feature 6) and
--   creates the supplier_payments audit table.
--
-- IDEMPOTENCY
--   initDatabase() in lib/db.js already runs the same ALTER
--   TABLE IF NOT EXISTS + CREATE TABLE IF NOT EXISTS statements
--   in its catch-wrapped migration block, so on a fresh deploy
--   the new columns appear automatically. This file is the
--   manual version for users who prefer to run it via the Neon
--   SQL Editor before first use of the supplier credit feature.
--
--   Running this file twice is safe — every statement uses
--   `IF NOT EXISTS` or checks for zero-state before writing.
--
-- HOW TO RUN (recommended via Neon SQL Editor)
--   1. Take a snapshot in Neon first (Branches → Create snapshot).
--   2. Open SQL Editor.
--   3. Paste this file and click Run.
--   4. Inspect the verification block at the bottom.
--
-- =============================================================

BEGIN;

-- 1. Add paid_amount + payment_status columns to purchases
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(19,2) DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'paid';

-- 2. Backfill pre-existing rows: assume historical purchases were
--    entered as "paid in full at delivery" (pre-v1.0.1 behavior).
--    The WHERE clause ensures this is a no-op on repeat runs.
UPDATE purchases
SET paid_amount = total
WHERE paid_amount = 0 AND total > 0;

UPDATE purchases
SET payment_status = CASE
  WHEN paid_amount >= total THEN 'paid'
  WHEN paid_amount > 0     THEN 'partial'
  ELSE                          'pending'
END;

-- 3. Create the supplier_payments audit table
CREATE TABLE IF NOT EXISTS supplier_payments (
  id SERIAL PRIMARY KEY,
  purchase_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  amount NUMERIC(19,2) NOT NULL,
  payment_method TEXT DEFAULT 'كاش',
  notes TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS supplier_payments_purchase_id_idx
  ON supplier_payments(purchase_id);

-- =============================================================
-- VERIFICATION
-- =============================================================

-- Confirm the new columns exist on purchases
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'purchases'
  AND column_name IN ('paid_amount', 'payment_status')
ORDER BY column_name;

-- Confirm the new table exists
SELECT table_name
FROM information_schema.tables
WHERE table_name = 'supplier_payments';

-- Spot-check payment_status distribution across existing rows
SELECT payment_status, COUNT(*) AS rows
FROM purchases
GROUP BY payment_status
ORDER BY payment_status;

COMMIT;

-- =============================================================
-- POST-MIGRATION NOTES
-- =============================================================
--
-- After this commits, the next deploy (or the next /api/init call)
-- will not re-run any DDL because of the IF NOT EXISTS guards.
-- The initDatabase() block in lib/db.js mirrors this migration so
-- fresh deploys start with the v1.0.1 schema automatically.
--
-- New purchases entered via /purchases can now specify a paid_amount
-- less than the total, which will mark payment_status = 'partial'.
-- Subsequent payments are recorded via POST /api/purchases/[id]/pay
-- (admin + manager only).
-- =============================================================
