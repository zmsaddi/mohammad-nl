-- =============================================================
-- Vitesse Eco v1.0 — Pre-Delivery DB Cleanup
-- =============================================================
--
-- PURPOSE
--   Remove all TEST and STRESS test data introduced during
--   Phase 0 / Phase 0.5 / Phase B testing, before the customer
--   enters real production data.
--
-- WHEN TO RUN
--   After the v1.0.0 tag is cut, BEFORE entering any real
--   customer data. If you already have real data in the DB,
--   DO NOT RUN this script — it will delete test rows but any
--   real rows sharing the `TEST` / `STRESS` prefix would also
--   be affected.
--
-- HOW TO RUN (recommended via Neon SQL Editor)
--   1. Open https://console.neon.tech and select the Vitesse
--      Eco project.
--   2. Create a manual snapshot first (Branches → Create
--      snapshot). This is your safety net — Neon's PITR
--      covers the last 7 days but an explicit snapshot is
--      cleaner to restore.
--   3. Open the SQL Editor.
--   4. Paste this entire file into the editor.
--   5. Click Run.
--   6. Inspect the verification SELECT at the bottom.
--      Expected: every business table returns 0 except
--      `users` which returns 1 (admin only).
--   7. If the output looks correct, the COMMIT at the end has
--      already committed the delete.
--   8. If anything looks wrong, restore from the Step 2
--      snapshot via Neon PITR.
--
-- DRY RUN MODE
--   To preview without writing, change the final `COMMIT;` at
--   the bottom of this file to `ROLLBACK;`. Run the whole file,
--   inspect the verification output, and nothing will persist.
--
-- SAFETY
--   - Wrapped in a single BEGIN/COMMIT transaction.
--   - Deletes are scoped by `client_name LIKE 'TEST%'`,
--     `client_name LIKE 'STRESS%'`, `item LIKE 'STRESS%'`,
--     `supplier LIKE 'STRESS%'`, or a literal test-user
--     allowlist. No bulk TRUNCATE on any table.
--   - Does NOT touch: `settings`, `admin` user row, AI learning
--     tables (`ai_corrections`, `ai_patterns`, `entity_aliases`,
--     `voice_logs`, `price_history`). Those may contain orphan
--     rows that point to deleted products/clients — that's
--     harmless because the aliasing system never references
--     deleted entities in practice.
--
-- SCHEMA REFERENCE
--   - `sales.client_name` (TEXT) — no FK to clients.id
--   - `payments.client_name` (TEXT) + `payments.sale_id` (INT, nullable)
--   - `deliveries.client_name` (TEXT) + `deliveries.sale_id` (FK to sales, ON DELETE SET NULL)
--   - `invoices.sale_id` (FK to sales, ON DELETE CASCADE)
--     → deleting sales cascades to invoices automatically
--   - `bonuses.sale_id` (FK to sales, ON DELETE CASCADE)
--     → deleting sales cascades to bonuses automatically
--   - `bonuses.delivery_id` (FK to deliveries, ON DELETE CASCADE)
--   - `cancellations.sale_id` (INT, no FK)
--   - `purchases.supplier` (TEXT) — no FK to suppliers.id
--
-- =============================================================

BEGIN;

-- =============================================================
-- Step 1 — payments (child of sales, no FK but logical parent)
-- =============================================================
DELETE FROM payments
WHERE client_name LIKE 'TEST%'
   OR client_name LIKE 'STRESS%'
   OR client_name IN ('Ahmad Test', 'Ali Test');

-- =============================================================
-- Step 2 — cancellations audit (child of sales, no FK)
-- =============================================================
DELETE FROM cancellations
WHERE sale_id IN (
  SELECT id FROM sales
  WHERE client_name LIKE 'TEST%'
     OR client_name LIKE 'STRESS%'
     OR client_name IN ('Ahmad Test', 'Ali Test')
     OR item LIKE 'TEST%'
     OR item LIKE 'STRESS%'
);

-- =============================================================
-- Step 3 — bonuses (CASCADE on sales delete, but delete
-- explicitly so any orphaned bonus rows from test users are
-- also cleaned — e.g. bonuses linked to deleted deliveries).
-- =============================================================
DELETE FROM bonuses
WHERE username IN (
  'testseller', 'testdriver', 'testseller2',
  'stressseller', 'stressseller2', 'stressdriver', 'stressmanager'
)
   OR sale_id IN (
     SELECT id FROM sales
     WHERE client_name LIKE 'TEST%'
        OR client_name LIKE 'STRESS%'
        OR client_name IN ('Ahmad Test', 'Ali Test')
        OR item LIKE 'TEST%'
        OR item LIKE 'STRESS%'
   );

-- =============================================================
-- Step 4 — invoices (CASCADE on sales delete, but delete
-- explicitly to preserve cancellation-audit parity)
-- =============================================================
DELETE FROM invoices
WHERE client_name LIKE 'TEST%'
   OR client_name LIKE 'STRESS%'
   OR client_name IN ('Ahmad Test', 'Ali Test')
   OR item LIKE 'TEST%'
   OR item LIKE 'STRESS%';

-- =============================================================
-- Step 5 — sales (parent row; cascades to bonuses/invoices
-- via FK, but we already deleted those explicitly above)
-- =============================================================
DELETE FROM sales
WHERE client_name LIKE 'TEST%'
   OR client_name LIKE 'STRESS%'
   OR client_name IN ('Ahmad Test', 'Ali Test')
   OR item LIKE 'TEST%'
   OR item LIKE 'STRESS%';

-- =============================================================
-- Step 6 — deliveries. The FK to sales uses ON DELETE SET NULL,
-- so after Step 5 deliveries linked to a test sale have sale_id
-- = NULL but the row still exists. Match by client_name or by
-- the now-null sale_id + test client name.
-- =============================================================
DELETE FROM deliveries
WHERE client_name LIKE 'TEST%'
   OR client_name LIKE 'STRESS%'
   OR client_name IN ('Ahmad Test', 'Ali Test')
   OR items LIKE '%TEST%'
   OR items LIKE '%STRESS%';

-- =============================================================
-- Step 7 — settlements (all rows created by test runs)
-- =============================================================
DELETE FROM settlements
WHERE username IN (
  'testseller', 'testdriver', 'testseller2',
  'stressseller', 'stressseller2', 'stressdriver', 'stressmanager'
);

-- =============================================================
-- Step 8 — purchases from test suppliers
-- =============================================================
DELETE FROM purchases
WHERE supplier LIKE 'TEST%'
   OR supplier LIKE 'STRESS%'
   OR supplier = 'Wahid Test'
   OR item LIKE 'TEST%'
   OR item LIKE 'STRESS%';

-- =============================================================
-- Step 9 — expenses (only if any test expenses exist)
-- =============================================================
DELETE FROM expenses
WHERE description LIKE 'TEST%'
   OR description LIKE 'STRESS%'
   OR notes LIKE '%STRESS%';

-- =============================================================
-- Step 10 — clients
-- =============================================================
DELETE FROM clients
WHERE name LIKE 'TEST%'
   OR name LIKE 'STRESS%'
   OR name IN ('Ahmad Test', 'Ali Test');

-- =============================================================
-- Step 11 — suppliers
-- =============================================================
DELETE FROM suppliers
WHERE name LIKE 'TEST%'
   OR name LIKE 'STRESS%'
   OR name = 'Wahid Test';

-- =============================================================
-- Step 12 — products
-- =============================================================
DELETE FROM products
WHERE name LIKE 'TEST%'
   OR name LIKE 'STRESS%'
   OR name LIKE 'STRESS-%';

-- =============================================================
-- Step 13 — test users (explicit allowlist; preserve admin)
-- =============================================================
DELETE FROM users
WHERE username IN (
  'testseller', 'testdriver', 'testseller2',
  'stressseller', 'stressseller2', 'stressdriver', 'stressmanager'
);

-- =============================================================
-- Step 14 (OPTIONAL) — AI learning tables
-- -------------------------------------------------------------
-- These are commented out by default. The AI learning layer
-- (entity_aliases, ai_corrections, ai_patterns) is designed to
-- tolerate orphan rows gracefully — a learned alias pointing to
-- a deleted product just never matches and takes up negligible
-- space. If you want a truly clean slate for the AI layer,
-- uncomment these TRUNCATE statements.
-- =============================================================
-- TRUNCATE entity_aliases RESTART IDENTITY;
-- TRUNCATE ai_corrections RESTART IDENTITY;
-- TRUNCATE ai_patterns    RESTART IDENTITY;
-- TRUNCATE voice_logs     RESTART IDENTITY;
-- TRUNCATE price_history  RESTART IDENTITY;

-- =============================================================
-- VERIFICATION — runs inside the transaction so you can review
-- the counts before the COMMIT below fires.
-- =============================================================

SELECT 'bonuses'       AS table_name, COUNT(*) AS remaining FROM bonuses
UNION ALL SELECT 'cancellations',  COUNT(*) FROM cancellations
UNION ALL SELECT 'clients',        COUNT(*) FROM clients
UNION ALL SELECT 'deliveries',     COUNT(*) FROM deliveries
UNION ALL SELECT 'expenses',       COUNT(*) FROM expenses
UNION ALL SELECT 'invoices',       COUNT(*) FROM invoices
UNION ALL SELECT 'payments',       COUNT(*) FROM payments
UNION ALL SELECT 'products',       COUNT(*) FROM products
UNION ALL SELECT 'purchases',      COUNT(*) FROM purchases
UNION ALL SELECT 'sales',          COUNT(*) FROM sales
UNION ALL SELECT 'settlements',    COUNT(*) FROM settlements
UNION ALL SELECT 'suppliers',      COUNT(*) FROM suppliers
UNION ALL SELECT 'users',          COUNT(*) FROM users
ORDER BY table_name;

-- Expected output:
--   bonuses:       0
--   cancellations: 0
--   clients:       0
--   deliveries:    0
--   expenses:      0
--   invoices:      0
--   payments:      0
--   products:      0
--   purchases:     0
--   sales:         0
--   settlements:   0
--   suppliers:     0
--   users:         1    (admin only)

-- =============================================================
-- If the counts above match the expected output, this COMMIT
-- persists the delete. To dry-run, change COMMIT to ROLLBACK.
-- =============================================================

COMMIT;

-- =============================================================
-- POST-CLEANUP VERIFICATION (run these in the UI after the SQL)
-- -------------------------------------------------------------
-- After the transaction commits, log in to
-- https://mohammadnl.vercel.app as admin and confirm:
--
--   - /summary        → all KPIs read 0 (or show empty ranges)
--   - /clients        → empty list
--   - /sales          → empty list
--   - /stock          → empty list (unless you've already
--                       entered the real product catalog)
--   - /invoices       → empty list
--   - /settlements    → empty list
--   - /users          → only the admin user
--
-- You're now ready for real data entry. Follow the 8-step
-- handoff sequence in docs/delivery-handoff.md.
-- =============================================================
