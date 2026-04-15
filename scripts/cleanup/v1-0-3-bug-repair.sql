-- =============================================================
-- Vitesse Eco v1.0.3 — Bug A/B/C Test Data Cleanup
-- =============================================================
--
-- PURPOSE
--   Wipe the test ZAKARIYA records that surfaced bugs A/B/C
--   during pre-delivery testing on 2026-04-15:
--
--     - 2 clients named 'ZAKARIYA' (id=1 with empty phone,
--       id=2 with +34xxx phone) — the Bug B duplicate
--     - 1 sale (id=1, V20V PRO, 950, payment='كاش',
--       down_payment_expected=500) — the Bug A evidence
--     - 1 collection payment of 500 (auto-inserted by
--       updateDelivery on confirmation)
--     - 1 delivery row in 'تم التوصيل' state
--     - 1 invoice (INV-202604-2748)
--     - 1 seller bonus (35€ to yasin, unsettled)
--
-- USER DECISION (Q3 2026-04-15)
--   Delete rather than repair in place. Safe because no real
--   customer data exists yet — all records relate to ZAKARIYA
--   (the user's own admin display name, used as a test client).
--
-- WHEN TO RUN
--   After v1.0.3 deploys, before any real customer data entry.
--
-- HOW TO RUN
--   1. Open https://console.neon.tech and select the project
--   2. Take a snapshot first (Branches → Create snapshot)
--   3. Open SQL Editor
--   4. Paste this entire file → Run
--   5. Inspect the BEFORE / AFTER rows printed by the script
--   6. If AFTER shows all zeros, the COMMIT at the end has
--      already persisted. If anything looks wrong, restore
--      from the Step 2 snapshot.
--
-- DRY-RUN MODE
--   Change the final `COMMIT;` to `ROLLBACK;` to preview
--   without persisting.
--
-- =============================================================

BEGIN;

-- ── BEFORE snapshot ──────────────────────────────────────────
SELECT 'BEFORE CLEANUP' AS phase;

SELECT 'clients' AS tbl, COUNT(*) AS n FROM clients WHERE name = 'ZAKARIYA'
UNION ALL SELECT 'sales',         COUNT(*) FROM sales         WHERE client_name = 'ZAKARIYA'
UNION ALL SELECT 'payments',      COUNT(*) FROM payments      WHERE client_name = 'ZAKARIYA'
UNION ALL SELECT 'deliveries',    COUNT(*) FROM deliveries    WHERE client_name = 'ZAKARIYA'
UNION ALL SELECT 'invoices',      COUNT(*) FROM invoices      WHERE client_name = 'ZAKARIYA'
UNION ALL SELECT 'bonuses',       COUNT(*) FROM bonuses       WHERE sale_id IN (SELECT id FROM sales WHERE client_name = 'ZAKARIYA')
UNION ALL SELECT 'cancellations', COUNT(*) FROM cancellations WHERE sale_id IN (SELECT id FROM sales WHERE client_name = 'ZAKARIYA')
ORDER BY tbl;

-- ── DELETE in dependency order ───────────────────────────────
-- Deletions follow FK direction so cascade rules don't surprise us.
-- (bonuses.sale_id and invoices.sale_id are ON DELETE CASCADE per
-- lib/db.js:289-291, but explicit deletes above the parent are
-- clearer and easier to audit.)

DELETE FROM payments      WHERE client_name = 'ZAKARIYA';
DELETE FROM bonuses       WHERE sale_id IN (SELECT id FROM sales WHERE client_name = 'ZAKARIYA');
DELETE FROM cancellations WHERE sale_id IN (SELECT id FROM sales WHERE client_name = 'ZAKARIYA');
DELETE FROM invoices      WHERE client_name = 'ZAKARIYA';
DELETE FROM deliveries    WHERE client_name = 'ZAKARIYA';
DELETE FROM sales         WHERE client_name = 'ZAKARIYA';
DELETE FROM clients       WHERE name        = 'ZAKARIYA';

-- ── AFTER verification ───────────────────────────────────────
SELECT 'AFTER CLEANUP' AS phase;

SELECT 'clients' AS tbl, COUNT(*) AS n FROM clients WHERE name = 'ZAKARIYA'
UNION ALL SELECT 'sales',         COUNT(*) FROM sales         WHERE client_name = 'ZAKARIYA'
UNION ALL SELECT 'payments',      COUNT(*) FROM payments      WHERE client_name = 'ZAKARIYA'
UNION ALL SELECT 'deliveries',    COUNT(*) FROM deliveries    WHERE client_name = 'ZAKARIYA'
UNION ALL SELECT 'invoices',      COUNT(*) FROM invoices      WHERE client_name = 'ZAKARIYA'
UNION ALL SELECT 'bonuses',       COUNT(*) FROM bonuses       WHERE sale_id IN (SELECT id FROM sales WHERE client_name = 'ZAKARIYA')
UNION ALL SELECT 'cancellations', COUNT(*) FROM cancellations WHERE sale_id IN (SELECT id FROM sales WHERE client_name = 'ZAKARIYA')
ORDER BY tbl;

-- All counts above should read 0. If any are non-zero, change
-- the COMMIT below to ROLLBACK and investigate before re-running.

COMMIT;

-- =============================================================
-- POST-CLEANUP NOTES
-- =============================================================
--
-- After this commits:
--   - /clients page should be empty (or show only real clients
--     entered after this point)
--   - /sales should not show V20V PRO / 950
--   - /invoices should not show INV-202604-2748
--   - /summary KPIs should drop accordingly
--
-- The user 'yasin' (seller) and the 'admin' user (display name
-- 'ZAKARIYA') remain — only their CLIENT records were deleted.
-- Login credentials and bonus settings are untouched.
--
-- Next steps from delivery-handoff.md: continue with Step 5.5
-- below (env.test isolation, CRITICAL) before any real customer
-- data entry.
-- =============================================================
