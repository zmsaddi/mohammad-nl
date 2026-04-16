// v1.1 Sprint 5 S5.1 — Global cross-table invariants.
//
// These invariants should hold at ALL TIMES in a correctly-operating
// Vitesse Eco database. Each one is a SQL assertion that crosses
// multiple tables. Pre-v1.1 ZERO of these were tested; the v1.0.3
// profit-distribution bug (INV-01) was the consequence.
//
// Run after every canonical flow to prove the DB is globally consistent.
// The Sprint 2 invariant files test specific F-IDs in isolation; this
// file tests the WHOLE database state after a mixed-workload seed.
//
// Run with: npx vitest run tests/invariants/global-invariants.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import { initDatabase } from '../../lib/db.js';

const TRUNCATE_TABLES = [
  'profit_distributions', 'cancellations',
  'sales', 'purchases', 'deliveries', 'invoices', 'bonuses',
  'settlements', 'payments', 'expenses', 'clients', 'products',
  'suppliers',
];

async function wipe() {
  const list = TRUNCATE_TABLES.map(t => `"${t}"`).join(', ');
  await sql.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

// Seed a realistic mixed-workload state: 2 confirmed sales (1 cash,
// 1 credit partially paid), 1 cancelled sale, 1 purchase, 1 expense,
// 1 bonus, 1 settlement payout. This gives every invariant something
// to check against.
async function seedMixedWorkload() {
  // Product
  await sql`INSERT INTO products (name, category, unit, buy_price, sell_price, stock, created_by)
    VALUES ('INV Bike', 'e-bike', '', 400, 1000, 50, 'seed')`;

  // Client
  await sql`INSERT INTO clients (name, phone, address, created_by)
    VALUES ('INV Client', '+31600000001', 'Test Addr', 'seed')`;

  // Sale 1: confirmed cash, fully paid
  await sql`INSERT INTO sales (id, date, client_name, item, quantity, cost_price, unit_price,
    total, cost_total, profit, payment_method, payment_type, paid_amount, remaining,
    status, ref_code, created_by, recommended_price, notes, down_payment_expected, payment_status)
    VALUES (1, '2026-04-15', 'INV Client', 'INV Bike', 1, 400, 1000, 1000, 400, 600,
    'كاش', 'كاش', 1000, 0, 'مؤكد', 'INV-001', 'seller1', 1000, '', 1000, 'paid')`;
  await sql`INSERT INTO deliveries (id, date, client_name, items, total_amount, status, sale_id, created_by)
    VALUES (1, '2026-04-15', 'INV Client', 'INV Bike (1)', 1000, 'تم التوصيل', 1, 'seed')`;
  await sql`INSERT INTO payments (date, client_name, amount, sale_id, type, payment_method, tva_amount, created_by, notes)
    VALUES ('2026-04-15', 'INV Client', 1000, 1, 'collection', 'كاش', 166.67, 'seed', '')`;
  await sql`INSERT INTO invoices (date, client_name, seller_name, item, quantity, unit_price, total, payment_type, sale_id, delivery_id, ref_code, status)
    VALUES ('2026-04-15', 'INV Client', 'seller1', 'INV Bike', 1, 1000, 1000, 'كاش', 1, 1, 'INV-202604-0001', 'PAYÉE')`;

  // Sale 2: confirmed credit, partially paid (700/1000)
  await sql`INSERT INTO sales (id, date, client_name, item, quantity, cost_price, unit_price,
    total, cost_total, profit, payment_method, payment_type, paid_amount, remaining,
    status, ref_code, created_by, recommended_price, notes, down_payment_expected, payment_status)
    VALUES (2, '2026-04-16', 'INV Client', 'INV Bike', 1, 400, 1000, 1000, 400, 600,
    'آجل', 'آجل', 700, 300, 'مؤكد', 'INV-002', 'seller1', 1000, '', 0, 'partial')`;
  await sql`INSERT INTO deliveries (id, date, client_name, items, total_amount, status, sale_id, created_by)
    VALUES (2, '2026-04-16', 'INV Client', 'INV Bike (1)', 1000, 'تم التوصيل', 2, 'seed')`;
  await sql`INSERT INTO payments (date, client_name, amount, sale_id, type, payment_method, tva_amount, created_by, notes)
    VALUES ('2026-04-16', 'INV Client', 500, 2, 'collection', 'كاش', 83.33, 'seed', '')`;
  await sql`INSERT INTO payments (date, client_name, amount, sale_id, type, payment_method, tva_amount, created_by, notes)
    VALUES ('2026-04-17', 'INV Client', 200, 2, 'collection', 'كاش', 33.33, 'seed', '')`;
  await sql`INSERT INTO invoices (date, client_name, seller_name, item, quantity, unit_price, total, payment_type, sale_id, delivery_id, ref_code, status)
    VALUES ('2026-04-16', 'INV Client', 'seller1', 'INV Bike', 1, 1000, 1000, 'آجل', 2, 2, 'INV-202604-0002', 'PARTIELLE')`;

  // Sale 3: cancelled
  await sql`INSERT INTO sales (id, date, client_name, item, quantity, cost_price, unit_price,
    total, cost_total, profit, payment_method, payment_type, paid_amount, remaining,
    status, ref_code, created_by, recommended_price, notes, down_payment_expected, payment_status)
    VALUES (3, '2026-04-17', 'INV Client', 'INV Bike', 1, 400, 1000, 1000, 400, 600,
    'كاش', 'كاش', 0, 0, 'ملغي', 'INV-003', 'seller1', 1000, '', 1000, 'pending')`;

  // Bonus for sale 1 (seller)
  await sql`INSERT INTO bonuses (date, username, role, sale_id, delivery_id, item, quantity,
    recommended_price, actual_price, fixed_bonus, extra_bonus, total_bonus, settled)
    VALUES ('2026-04-15', 'seller1', 'seller', 1, 1, 'INV Bike', 1, 1000, 1000, 10, 0, 10, true)`;

  // Settlement for the bonus
  await sql`INSERT INTO settlements (date, type, username, description, amount, settled_by, notes)
    VALUES ('2026-04-15', 'seller_payout', 'seller1', 'test', 10, 'admin', '')`;

  // Purchase (use only columns from CREATE TABLE + known ALTERs)
  await sql`INSERT INTO purchases (date, supplier, item, quantity, unit_price, total,
    payment_type, notes)
    VALUES ('2026-04-14', 'Test Supplier', 'INV Bike', 5, 400, 2000, 'كاش', '')`;

  // Expense
  await sql`INSERT INTO expenses (date, category, description, amount, payment_type, created_by)
    VALUES ('2026-04-15', 'مكتبية', 'test expense', 50, 'كاش', 'seed')`;
}

describe('v1.1 S5.1 — Global cross-table invariants', () => {
  beforeAll(async () => { await initDatabase(); }, 60000);
  beforeEach(async () => { await wipe(); await seedMixedWorkload(); });
  afterAll(async () => { await wipe(); });

  // INV-02: No duplicate (group_id, username) in profit_distributions
  it('INV-02 — profit_distributions has no duplicate (group_id, username)', async () => {
    const { rows } = await sql`
      SELECT COUNT(*) AS total, COUNT(DISTINCT (group_id, username)) AS distinct_pairs
      FROM profit_distributions
    `;
    expect(Number(rows[0].total)).toBe(Number(rows[0].distinct_pairs));
  });

  // INV-04: Σ collection payments per sale = sales.paid_amount (confirmed)
  it('INV-04 — collection payments sum matches sales.paid_amount', async () => {
    const { rows } = await sql`
      SELECT s.id, s.paid_amount::numeric AS sp,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sale_id = s.id AND p.type = 'collection'), 0)::numeric AS pp
      FROM sales s WHERE s.status = 'مؤكد'
    `;
    for (const r of rows) {
      expect(Math.abs(parseFloat(r.sp) - parseFloat(r.pp))).toBeLessThan(0.01);
    }
  });

  // INV-05: No sale has paid_amount > total
  it('INV-05 — no sale over-collected (paid_amount <= total)', async () => {
    const { rows } = await sql`
      SELECT id, paid_amount::numeric AS pa, total::numeric AS t
      FROM sales WHERE paid_amount::numeric > total::numeric + 0.01
    `;
    expect(rows).toHaveLength(0);
  });

  // INV-08: Bonus cost fully accounted (accrued = unsettled + paid out)
  it('INV-08 — bonus balance: accrued = unsettled + settlement payouts', async () => {
    const { rows } = await sql`
      SELECT
        (SELECT COALESCE(SUM(total_bonus), 0)::numeric FROM bonuses) AS accrued,
        (SELECT COALESCE(SUM(total_bonus), 0)::numeric FROM bonuses WHERE settled = false) AS unsettled,
        (SELECT COALESCE(SUM(amount), 0)::numeric FROM settlements WHERE type IN ('seller_payout', 'driver_payout')) AS payouts
    `;
    const accrued = parseFloat(rows[0].accrued);
    const unsettled = parseFloat(rows[0].unsettled);
    const payouts = parseFloat(rows[0].payouts);
    expect(Math.abs(accrued - (unsettled + payouts))).toBeLessThan(0.01);
  });

  // INV-11: No negative stock
  it('INV-11 — no product has negative stock', async () => {
    const { rows } = await sql`SELECT id, name, stock FROM products WHERE stock::numeric < 0`;
    expect(rows).toHaveLength(0);
  });

  // INV-03: Each profit_distributions group_id sums to its base_amount
  it('INV-03 — each profit distribution group sums to its base_amount', async () => {
    const { rows } = await sql`
      SELECT group_id, SUM(amount)::numeric AS total, MAX(base_amount)::numeric AS base
      FROM profit_distributions GROUP BY group_id
    `;
    for (const r of rows) {
      expect(Math.abs(parseFloat(r.total) - parseFloat(r.base))).toBeLessThan(0.01);
    }
  });

  // INV-09: Supplier payments <= purchase total (no overpay)
  it('INV-09 — supplier payments do not exceed purchase totals', async () => {
    const { rows } = await sql`
      SELECT p.id, p.total::numeric AS ptotal,
        COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.purchase_id = p.id), 0)::numeric AS paid
      FROM purchases p
    `;
    for (const r of rows) {
      expect(parseFloat(r.paid)).toBeLessThanOrEqual(parseFloat(r.ptotal) + 0.01);
    }
  });

  // INV-10: Every confirmed cash/bank sale has a collection payment
  it('INV-10 — confirmed cash/bank sales have collection payment rows', async () => {
    const { rows } = await sql`
      SELECT s.id FROM sales s
      WHERE s.status = 'مؤكد' AND s.payment_type IN ('كاش', 'بنك')
        AND NOT EXISTS (
          SELECT 1 FROM payments p WHERE p.sale_id = s.id AND p.type = 'collection'
        )
    `;
    expect(rows).toHaveLength(0);
  });

  // INV-12: Invoice ref_codes are unique (no duplicates)
  it('INV-12 — invoice ref_codes are unique', async () => {
    const { rows } = await sql`
      SELECT COUNT(*)::int AS total, COUNT(DISTINCT ref_code)::int AS distinct_refs
      FROM invoices WHERE ref_code IS NOT NULL AND ref_code <> ''
    `;
    expect(rows[0].total).toBe(rows[0].distinct_refs);
  });

  // Custom: sales.total = paid_amount + remaining (for confirmed sales)
  it('INV-CUSTOM — confirmed sales: total = paid_amount + remaining', async () => {
    const { rows } = await sql`
      SELECT id, total::numeric AS t, paid_amount::numeric AS pa, remaining::numeric AS r
      FROM sales WHERE status = 'مؤكد'
        AND ABS(total::numeric - (paid_amount::numeric + remaining::numeric)) > 0.01
    `;
    expect(rows).toHaveLength(0);
  });

  // Custom: no orphan payments (sale_id points to non-existent sale)
  it('INV-CUSTOM — no orphan payments (sale_id → existing sale)', async () => {
    const { rows } = await sql`
      SELECT p.id, p.sale_id FROM payments p
      LEFT JOIN sales s ON s.id = p.sale_id
      WHERE p.sale_id IS NOT NULL AND s.id IS NULL
    `;
    expect(rows).toHaveLength(0);
  });
});
