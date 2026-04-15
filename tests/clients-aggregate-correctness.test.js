// v1 pre-delivery — Bug 3 regression: getClients aggregate correctness
//
// FEAT-04 introduced a collection payment row on every delivery confirm,
// which broke the legacy getClients aggregate formula. Cash sales were
// counted in BOTH `sum(sales.total WHERE cash/bank confirmed)` and
// `sum(payments.amount)`, so totalPaid reported double. Ali Test in
// production had one 900€ cash sale → totalPaid=1800, a 2× inflation.
//
// The fix (lib/db.js getClients) reads everything from the sales ledger:
//   - totalSales  = sum(sales.total WHERE status != 'ملغي')
//   - totalPaid   = sum(sales.paid_amount WHERE status = 'مؤكد')
//   - remainingDebt = sum(sales.remaining WHERE confirmed + not paid)
//
// This test seeds a known client + sales fixture and asserts the
// aggregate matches hand-computed values.
//
// Run with: npx vitest run tests/clients-aggregate-correctness.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import bcryptjs from 'bcryptjs';
import {
  initDatabase,
  getClients,
  addSale,
  updateDelivery,
  applyCollection,
  commitCancelSale,
} from '../lib/db.js';

const TRUNCATE_TABLES = [
  'cancellations',
  'sales', 'purchases', 'deliveries', 'invoices', 'bonuses',
  'settlements', 'payments', 'expenses', 'clients', 'products',
  'suppliers', 'voice_logs', 'ai_corrections', 'entity_aliases',
  'ai_patterns', 'price_history',
];

async function truncateBusinessTables() {
  const list = TRUNCATE_TABLES.map((t) => `"${t}"`).join(', ');
  await sql.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function seedProductAndUsers() {
  await sql`
    INSERT INTO products (name, category, unit, buy_price, sell_price, stock, created_by, notes)
    VALUES ('AGG Bike', 'e-bike', '', 1000, 1500, 50, 'test-seed', '')
  `;
  const hash = bcryptjs.hashSync('test-password', 12);
  await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES ('agg-seller', ${hash}, 'Aggregate Seller', 'seller', true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = 'seller'
  `;
  await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES ('agg-driver', ${hash}, 'Aggregate Driver', 'driver', true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = 'driver'
  `;
}

async function getAggregateForClient(clientName) {
  const rows = await getClients(true);
  return rows.find((c) => c.name === clientName);
}

const TODAY = new Date().toISOString().slice(0, 10);

async function seedConfirmedCashSale({ clientName, amount = 1500, quantity = 1 }) {
  const { saleId, deliveryId } = await addSale({
    date: TODAY,
    clientName,
    clientPhone: '+31600000001',
    clientAddress: 'Agg Test Addr',
    item: 'AGG Bike',
    quantity,
    unitPrice: amount,
    paymentType: 'كاش',
    createdBy: 'agg-seller',
  });
  await sql`UPDATE deliveries SET assigned_driver = 'agg-driver' WHERE id = ${deliveryId}`;
  await updateDelivery({
    id: deliveryId,
    date: TODAY,
    clientName,
    clientPhone: '+31600000001',
    address: 'Agg Test Addr',
    items: `AGG Bike (${quantity})`,
    totalAmount: amount * quantity,
    status: 'تم التوصيل',
    driverName: 'agg-driver',
    assignedDriver: 'agg-driver',
    notes: '',
    vin: `VIN-AGG-${saleId}`,
  });
  return saleId;
}

describe('getClients aggregate — Bug 3 regression fix', () => {
  beforeAll(async () => {
    await initDatabase();
  }, 30000);

  beforeEach(async () => {
    await truncateBusinessTables();
    await seedProductAndUsers();
  });

  afterAll(async () => {
    await truncateBusinessTables();
    await sql`DELETE FROM users WHERE username IN ('agg-seller', 'agg-driver')`;
  });

  // ───────────────────────────────────────────────────────────────
  // Test 1 — one confirmed cash sale of 900 → totalPaid = 900, not 1800
  // This is the exact production bug: Ali Test with one 900€ cash sale
  // was reporting totalPaid=1800 due to double-counting the sale.total
  // AND the FEAT-04 collection payment row.
  // ───────────────────────────────────────────────────────────────
  it('Test 1 — single confirmed cash sale: totalPaid = sale total (not double)', async () => {
    await sql`
      INSERT INTO clients (name, phone, address)
      VALUES ('Agg Ali', '+31600000001', 'Agg Test Addr')
    `;
    await seedConfirmedCashSale({ clientName: 'Agg Ali', amount: 900 });

    const agg = await getAggregateForClient('Agg Ali');
    expect(agg).toBeDefined();
    expect(parseFloat(agg.totalSales)).toBe(900);
    // Regression guard: must be 900, not 1800. Pre-fix this returned 1800.
    expect(parseFloat(agg.totalPaid)).toBe(900);
    expect(parseFloat(agg.remainingDebt)).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────
  // Test 2 — mixed history: cash + credit + partial collection + cancel
  // Invariant: totalPaid ≤ totalSales, and debt math is self-consistent.
  // ───────────────────────────────────────────────────────────────
  it('Test 2 — mixed history invariants hold (paid ≤ sales, debt non-negative)', async () => {
    // v1.0.3 — drop the manual INSERT seeded earlier. The previous version
    // inserted Agg Mixed with phone='+31600000002' and then called
    // seedConfirmedCashSale (which uses phone='+31600000001'), creating
    // two distinct client rows. Pre-v1.0.3 getClients fan-outed the
    // aggregate to both rows so the test passed by accident; v1.0.3's Bug C
    // stopgap zeros the non-canonical row, breaking the test. Letting
    // addSale create the client on the first call ensures a single row
    // matches both calls' phone.
    // (No manual INSERT here — addSale → addClient handles the upsert.)

    // Confirmed cash sale: 1500
    await seedConfirmedCashSale({ clientName: 'Agg Mixed', amount: 1500 });

    // Confirmed credit sale with dpe=0, later partial collection.
    // Phone matches the helper's hardcoded value so addClient Step 1
    // exact-match returns the existing row (no second client created).
    const { saleId: creditSaleId, deliveryId: creditDeliveryId } = await addSale({
      date: TODAY,
      clientName: 'Agg Mixed',
      clientPhone: '+31600000001',
      clientAddress: 'Agg Test Addr',
      item: 'AGG Bike',
      quantity: 1,
      unitPrice: 1500,
      paymentType: 'آجل',
      downPaymentExpected: 0,
      createdBy: 'agg-seller',
    });
    await sql`UPDATE deliveries SET assigned_driver = 'agg-driver' WHERE id = ${creditDeliveryId}`;
    await updateDelivery({
      id: creditDeliveryId,
      date: TODAY,
      clientName: 'Agg Mixed',
      clientPhone: '+31600000001',
      address: 'Agg Test Addr',
      items: 'AGG Bike (1)',
      totalAmount: 1500,
      status: 'تم التوصيل',
      driverName: 'agg-driver',
      assignedDriver: 'agg-driver',
      notes: '',
      vin: 'VIN-AGG-CREDIT',
    });
    // Partial collection: 500 out of 1500 — leaves 1000 remaining.
    await applyCollection(creditSaleId, 500, 'كاش', 'agg-seller');

    const agg = await getAggregateForClient('Agg Mixed');
    expect(agg).toBeDefined();

    // totalSales = 1500 (cash) + 1500 (credit) = 3000
    expect(parseFloat(agg.totalSales)).toBe(3000);

    // totalPaid = 1500 (cash fully paid) + 500 (credit partial) = 2000
    expect(parseFloat(agg.totalPaid)).toBe(2000);

    // remainingDebt = 1000 (the credit sale's unpaid portion)
    expect(parseFloat(agg.remainingDebt)).toBe(1000);

    // Invariants
    expect(parseFloat(agg.totalPaid)).toBeLessThanOrEqual(parseFloat(agg.totalSales));
    expect(parseFloat(agg.remainingDebt)).toBeGreaterThanOrEqual(0);
    // paid + remaining = sum of non-cancelled sales totals
    expect(
      parseFloat(agg.totalPaid) + parseFloat(agg.remainingDebt)
    ).toBe(parseFloat(agg.totalSales));
  });

  // ───────────────────────────────────────────────────────────────
  // Test 3 — empty client (no sales at all): all three fields are 0
  // ───────────────────────────────────────────────────────────────
  it('Test 3 — client with no sales: totals = 0', async () => {
    await sql`
      INSERT INTO clients (name, phone, address)
      VALUES ('Agg Empty', '+31600000003', 'Empty Addr')
    `;

    const agg = await getAggregateForClient('Agg Empty');
    expect(agg).toBeDefined();
    expect(parseFloat(agg.totalSales)).toBe(0);
    expect(parseFloat(agg.totalPaid)).toBe(0);
    expect(parseFloat(agg.remainingDebt)).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────
  // Test 4 — client whose only sale is cancelled: totalSales = 0
  // Verifies the status filter excludes cancelled sales from both
  // totalSales and totalPaid. (Before the fix, totalSales included
  // cancelled sales because there was no status filter.)
  // ───────────────────────────────────────────────────────────────
  it('Test 4 — client with only a cancelled sale: all fields = 0', async () => {
    await sql`
      INSERT INTO clients (name, phone, address)
      VALUES ('Agg Cancelled', '+31600000004', 'Cxl Addr')
    `;
    const saleId = await seedConfirmedCashSale({ clientName: 'Agg Cancelled', amount: 1500 });

    // Cancel the confirmed sale (admin cancels with bonus remove)
    await commitCancelSale(saleId, {
      cancelledBy: 'test-admin',
      reason: 'Agg Test 4 cancel',
      invoiceMode: 'soft',
      bonusActions: { seller: 'remove', driver: 'remove' },
    });

    const agg = await getAggregateForClient('Agg Cancelled');
    expect(agg).toBeDefined();
    // Cancelled sale excluded from all aggregates:
    expect(parseFloat(agg.totalSales)).toBe(0);
    expect(parseFloat(agg.totalPaid)).toBe(0);
    expect(parseFloat(agg.remainingDebt)).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────
  // Test 5 — Bug C stopgap: two client rows sharing a name. The
  // single sale must be attributed only to the lowest-id row, NOT
  // fan out to both. The duplicate row carries _duplicateOfId = the
  // canonical row's id so the UI can show the مكرر badge.
  //
  // Live evidence reproducing this: 2 ZAKARIYA rows in production
  // (id=1 phone='', id=2 phone='+34xxx') were both showing
  // totalSales=950 / paid=500 / debt=450 from a single sale, and
  // the /clients summary card displayed إجمالي الديون = 900.
  // ───────────────────────────────────────────────────────────────
  it('Test 5 — Bug C: two clients sharing a name → aggregate attributes to lowest-id only', async () => {
    // Seed two clients with the literal same name. The unique partial
    // index `(name, phone) WHERE phone <> ''` allows this because we
    // give them different phones (one empty, one populated — the exact
    // shape of the production state that surfaced the bug).
    const { rows: c1 } = await sql`
      INSERT INTO clients (name, phone, address)
      VALUES ('Agg Shared', '', '')
      RETURNING id
    `;
    const { rows: c2 } = await sql`
      INSERT INTO clients (name, phone, address)
      VALUES ('Agg Shared', '+31600005005', 'Real Addr')
      RETURNING id
    `;
    const lowestId = Math.min(c1[0].id, c2[0].id);
    const higherId = Math.max(c1[0].id, c2[0].id);

    // Seed one confirmed cash sale of 500 for 'Agg Shared'
    await seedConfirmedCashSale({ clientName: 'Agg Shared', amount: 500 });

    const all = await getClients(true);
    const sharedRows = all.filter((r) => r.name === 'Agg Shared');
    expect(sharedRows).toHaveLength(2);

    const canonical = sharedRows.find((r) => r.id === lowestId);
    const duplicate = sharedRows.find((r) => r.id === higherId);

    // Canonical (lowest id) sees the full sale
    expect(canonical).toBeDefined();
    expect(parseFloat(canonical.totalSales)).toBe(500);
    expect(parseFloat(canonical.totalPaid)).toBe(500); // confirmed cash sale
    expect(parseFloat(canonical.remainingDebt)).toBe(0);
    expect(canonical._duplicateOfId).toBeNull();

    // Duplicate is zeroed out and tagged
    expect(duplicate).toBeDefined();
    expect(parseFloat(duplicate.totalSales)).toBe(0);
    expect(parseFloat(duplicate.totalPaid)).toBe(0);
    expect(parseFloat(duplicate.remainingDebt)).toBe(0);
    expect(duplicate._duplicateOfId).toBe(lowestId);

    // The summary card adds across all rows. Pre-fix the user saw
    // إجمالي الديون = 2 × debt. Post-fix it should equal the canonical
    // row's debt only (because duplicate rows contribute zero).
    const totalDebtSum = all.reduce((s, c) => s + (parseFloat(c.remainingDebt) || 0), 0);
    expect(totalDebtSum).toBe(0); // both rows: 0 (sale fully paid on confirmation)
  });
});
