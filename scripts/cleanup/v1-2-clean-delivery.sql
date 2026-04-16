-- =============================================================
-- Vitesse Eco v1.2.0 — Clean Delivery Reset
-- =============================================================
--
-- PURPOSE
--   Wipe ALL business data (sales, purchases, clients, products,
--   payments, bonuses, settlements, expenses, deliveries, invoices,
--   profit distributions, supplier payments, price history, etc.)
--   while PRESERVING:
--     - users (3 rows: admin, marandi, yasin)
--     - settings (17 rows: shop info, bonus rates, VAT, etc.)
--     - entity_aliases (product name mappings for voice input)
--     - ai_patterns + ai_corrections (learning data)
--
-- The result is a clean production-ready database with user accounts
-- and configuration intact, zero customer/financial data.
--
-- WHEN TO RUN
--   Once, before handing the system to the first real customer.
--   After this, running it again would delete real customer data.
--
-- HOW TO RUN
--   1. Take a Neon snapshot first (Branches → Create snapshot)
--   2. Open SQL Editor on the main branch
--   3. Paste this entire file → Run
--   4. Verify the AFTER counts are all zeros
--   5. The COMMIT at the end persists. If anything looks wrong,
--      restore from the Step 1 snapshot.
--
-- =============================================================

BEGIN;

-- ── BEFORE snapshot ──────────────────────────────────────────
SELECT 'BEFORE CLEANUP' AS phase;

SELECT 'profit_distributions' AS tbl, COUNT(*) AS n FROM profit_distributions
UNION ALL SELECT 'cancellations',  COUNT(*) FROM cancellations
UNION ALL SELECT 'supplier_payments', COUNT(*) FROM supplier_payments
UNION ALL SELECT 'bonuses',        COUNT(*) FROM bonuses
UNION ALL SELECT 'settlements',    COUNT(*) FROM settlements
UNION ALL SELECT 'payments',       COUNT(*) FROM payments
UNION ALL SELECT 'invoices',       COUNT(*) FROM invoices
UNION ALL SELECT 'deliveries',     COUNT(*) FROM deliveries
UNION ALL SELECT 'sales',          COUNT(*) FROM sales
UNION ALL SELECT 'purchases',      COUNT(*) FROM purchases
UNION ALL SELECT 'expenses',       COUNT(*) FROM expenses
UNION ALL SELECT 'clients',        COUNT(*) FROM clients
UNION ALL SELECT 'products',       COUNT(*) FROM products
UNION ALL SELECT 'suppliers',      COUNT(*) FROM suppliers
UNION ALL SELECT 'price_history',  COUNT(*) FROM price_history
UNION ALL SELECT 'voice_logs',     COUNT(*) FROM voice_logs
ORDER BY tbl;

-- ── DELETE in FK dependency order ────────────────────────────
-- profit_distributions first (FK → profit_distribution_groups if exists)
DELETE FROM profit_distributions;
-- Try to clean the parent table (may not exist on pre-v1.2 DBs)
DO $$ BEGIN DELETE FROM profit_distribution_groups; EXCEPTION WHEN undefined_table THEN NULL; END $$;

DELETE FROM cancellations;
DELETE FROM supplier_payments;
DELETE FROM bonuses;
DELETE FROM settlements;
DELETE FROM payments;
DELETE FROM invoices;
DELETE FROM deliveries;
DELETE FROM sales;
DELETE FROM purchases;
DELETE FROM expenses;
DELETE FROM price_history;
DELETE FROM voice_logs;

-- Clients, products, suppliers — business entities
DELETE FROM clients;
DELETE FROM products;
DELETE FROM suppliers;

-- Reset sequences so the first real sale is id=1, first invoice is INV-YYYYMM-0001
DO $$ BEGIN ALTER SEQUENCE sales_id_seq RESTART WITH 1; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER SEQUENCE purchases_id_seq RESTART WITH 1; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER SEQUENCE deliveries_id_seq RESTART WITH 1; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER SEQUENCE invoices_id_seq RESTART WITH 1; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER SEQUENCE payments_id_seq RESTART WITH 1; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER SEQUENCE bonuses_id_seq RESTART WITH 1; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER SEQUENCE settlements_id_seq RESTART WITH 1; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER SEQUENCE expenses_id_seq RESTART WITH 1; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER SEQUENCE clients_id_seq RESTART WITH 1; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER SEQUENCE products_id_seq RESTART WITH 1; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER SEQUENCE suppliers_id_seq RESTART WITH 1; EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Reset the invoice sequence counter so the first invoice is INV-YYYYMM-0001
DELETE FROM invoice_sequence;

-- ── AFTER verification ───────────────────────────────────────
SELECT 'AFTER CLEANUP' AS phase;

SELECT 'profit_distributions' AS tbl, COUNT(*) AS n FROM profit_distributions
UNION ALL SELECT 'cancellations',  COUNT(*) FROM cancellations
UNION ALL SELECT 'supplier_payments', COUNT(*) FROM supplier_payments
UNION ALL SELECT 'bonuses',        COUNT(*) FROM bonuses
UNION ALL SELECT 'settlements',    COUNT(*) FROM settlements
UNION ALL SELECT 'payments',       COUNT(*) FROM payments
UNION ALL SELECT 'invoices',       COUNT(*) FROM invoices
UNION ALL SELECT 'deliveries',     COUNT(*) FROM deliveries
UNION ALL SELECT 'sales',          COUNT(*) FROM sales
UNION ALL SELECT 'purchases',      COUNT(*) FROM purchases
UNION ALL SELECT 'expenses',       COUNT(*) FROM expenses
UNION ALL SELECT 'clients',        COUNT(*) FROM clients
UNION ALL SELECT 'products',       COUNT(*) FROM products
UNION ALL SELECT 'suppliers',      COUNT(*) FROM suppliers
UNION ALL SELECT 'price_history',  COUNT(*) FROM price_history
ORDER BY tbl;

-- Verify preserved data
SELECT 'PRESERVED: users' AS check_item, COUNT(*) AS n FROM users;
SELECT 'PRESERVED: settings' AS check_item, COUNT(*) AS n FROM settings;
SELECT 'PRESERVED: entity_aliases' AS check_item, COUNT(*) AS n FROM entity_aliases;

COMMIT;

-- =============================================================
-- POST-CLEANUP VERIFICATION
-- =============================================================
-- After COMMIT:
--   /clients → empty page
--   /sales → empty page
--   /purchases → empty page
--   /summary → "لا توجد بيانات" (no data)
--   /deliveries → empty page
--   /invoices → empty page
--   /settlements → empty page (no unsettled bonuses)
--   /profit-distributions → empty page
--   /users → 3 users (admin, marandi, yasin) still active
--   /settings → all 17 settings intact
--
-- The system is now ready for the first real customer data entry.
-- =============================================================
