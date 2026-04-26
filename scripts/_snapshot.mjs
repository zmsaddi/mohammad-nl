#!/usr/bin/env node
// Read-only DB snapshot — produces a baseline JSON for before/after diffs
// during deployments. Used to prove zero data loss across schema changes.
//
// SAFETY: SELECT statements only. NEVER add INSERT/UPDATE/DELETE/DDL here.
// Any future edit to this file MUST preserve the read-only invariant.
//
// Usage:
//   node --env-file=.env.local scripts/_snapshot.mjs > snapshots/before-phase-X.json
//   node --env-file=.env.local scripts/_snapshot.mjs > snapshots/after-phase-X.json
//   diff before-phase-X.json after-phase-X.json
//
// Output sections:
//   - row_counts:   per-table row counts
//   - sums:         aggregate sums for money/quantity columns
//   - latest:       latest activity dates per table
//   - schema:       table + column + FK + index inventory

import { sql } from '@vercel/postgres';

async function safeQuery(label, queryFn) {
  try {
    const { rows } = await queryFn();
    return { label, ok: true, rows };
  } catch (err) {
    return { label, ok: false, error: err.message };
  }
}

async function snapshot() {
  const ts = new Date().toISOString();
  const out = { generated_at: ts, sections: {} };

  // 1. Row counts per business table
  const counts = await safeQuery('row_counts', () => sql`
    SELECT 'users' AS tbl, COUNT(*)::int AS n FROM users UNION ALL
    SELECT 'clients', COUNT(*)::int FROM clients UNION ALL
    SELECT 'suppliers', COUNT(*)::int FROM suppliers UNION ALL
    SELECT 'products', COUNT(*)::int FROM products UNION ALL
    SELECT 'sales', COUNT(*)::int FROM sales UNION ALL
    SELECT 'purchases', COUNT(*)::int FROM purchases UNION ALL
    SELECT 'expenses', COUNT(*)::int FROM expenses UNION ALL
    SELECT 'deliveries', COUNT(*)::int FROM deliveries UNION ALL
    SELECT 'payments', COUNT(*)::int FROM payments UNION ALL
    SELECT 'invoices', COUNT(*)::int FROM invoices UNION ALL
    SELECT 'bonuses', COUNT(*)::int FROM bonuses UNION ALL
    SELECT 'settlements', COUNT(*)::int FROM settlements UNION ALL
    SELECT 'profit_distributions', COUNT(*)::int FROM profit_distributions UNION ALL
    SELECT 'cancellations', COUNT(*)::int FROM cancellations UNION ALL
    SELECT 'supplier_payments', COUNT(*)::int FROM supplier_payments UNION ALL
    SELECT 'price_history', COUNT(*)::int FROM price_history UNION ALL
    SELECT 'voice_logs', COUNT(*)::int FROM voice_logs UNION ALL
    SELECT 'entity_aliases', COUNT(*)::int FROM entity_aliases UNION ALL
    SELECT 'ai_corrections', COUNT(*)::int FROM ai_corrections UNION ALL
    SELECT 'ai_patterns', COUNT(*)::int FROM ai_patterns
    ORDER BY tbl
  `);
  out.sections.row_counts = counts;

  // 2. Aggregate sums on money columns — any drift here = data loss/corruption
  const sums = await safeQuery('sums', () => sql`
    SELECT
      (SELECT ROUND(SUM(total)::numeric, 2)::float FROM sales) AS sales_total,
      (SELECT ROUND(SUM(paid_amount)::numeric, 2)::float FROM sales) AS sales_paid,
      (SELECT ROUND(SUM(remaining)::numeric, 2)::float FROM sales) AS sales_remaining,
      (SELECT ROUND(SUM(profit)::numeric, 2)::float FROM sales) AS sales_profit,
      (SELECT ROUND(SUM(total)::numeric, 2)::float FROM purchases) AS purchases_total,
      (SELECT ROUND(SUM(paid_amount)::numeric, 2)::float FROM purchases) AS purchases_paid,
      (SELECT ROUND(SUM(amount)::numeric, 2)::float FROM expenses) AS expenses_total,
      (SELECT ROUND(SUM(amount)::numeric, 2)::float FROM payments) AS payments_total,
      (SELECT ROUND(SUM(stock * buy_price)::numeric, 2)::float FROM products) AS inventory_cost,
      (SELECT ROUND(SUM(stock)::numeric, 2)::float FROM products) AS total_stock_units,
      (SELECT ROUND(SUM(amount)::numeric, 2)::float FROM settlements) AS settlements_total
  `);
  out.sections.sums = sums;

  // 3. Latest activity dates
  const latest = await safeQuery('latest_activity', () => sql`
    SELECT 'sales' AS tbl, MAX(date) AS latest FROM sales UNION ALL
    SELECT 'purchases', MAX(date) FROM purchases UNION ALL
    SELECT 'deliveries', MAX(date) FROM deliveries UNION ALL
    SELECT 'payments', MAX(date) FROM payments UNION ALL
    SELECT 'expenses', MAX(date) FROM expenses
    ORDER BY tbl
  `);
  out.sections.latest = latest;

  // 4. Schema inventory: tables, indexes, FK constraints
  const tables = await safeQuery('tables', () => sql`
    SELECT tablename FROM pg_catalog.pg_tables
    WHERE schemaname='public' ORDER BY tablename
  `);
  out.sections.tables = tables;

  const indexes = await safeQuery('indexes', () => sql`
    SELECT tablename, indexname
    FROM pg_indexes WHERE schemaname='public'
    ORDER BY tablename, indexname
  `);
  out.sections.indexes = indexes;

  const fks = await safeQuery('fk_constraints', () => sql`
    SELECT conname, conrelid::regclass::text AS table_name, convalidated
    FROM pg_constraint
    WHERE contype='f' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')
    ORDER BY table_name, conname
  `);
  out.sections.fk_constraints = fks;

  // 5. User accounts summary (no passwords, only role/active)
  const users = await safeQuery('users_summary', () => sql`
    SELECT role, COUNT(*)::int AS n,
           SUM(CASE WHEN active THEN 1 ELSE 0 END)::int AS active_n
    FROM users GROUP BY role ORDER BY role
  `);
  out.sections.users_summary = users;

  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

snapshot().catch((err) => {
  console.error('Snapshot failed:', err.message);
  process.exit(1);
});
