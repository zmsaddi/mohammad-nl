// Idempotency regression — double-cancel guard in cancelSale.
//
// Session 8 Phase 0.5 stress test surfaced that POST /api/sales/[id]/cancel
// was not defensive against double-execution: a second commit-mode call
// would re-run the refund-insert loop and insert another cancellations
// audit row, doubly-negating already-settled collections on confirmed
// sales and polluting the audit trail on reserved ones.
//
// The fix lives in lib/db.js cancelSale Step 1: an explicit
// `if (alreadyCancelled && !previewOnly) throw 'الطلب مُلغى مسبقاً'`
// guard. Preview mode is still allowed so the admin cancel dialog can
// render the "already cancelled" state.
//
// Run with: npx vitest run tests/idempotency-double-cancel.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import bcryptjs from 'bcryptjs';
import {
  initDatabase,
  addSale,
  updateDelivery,
  commitCancelSale,
  previewCancelSale,
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

async function getSetting(key) {
  const { rows } = await sql`SELECT value FROM settings WHERE key = ${key}`;
  return rows[0]?.value ?? null;
}

async function setSetting(key, value) {
  await sql`
    INSERT INTO settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = ${value}
  `;
}

// Seed a confirmed sale with a collection payment + seller/driver bonuses.
// Returns the fixture ids so each test can call cancel helpers.
async function seedConfirmedSale() {
  await sql`
    INSERT INTO products (name, category, unit, buy_price, sell_price, stock, created_by, notes)
    VALUES ('IDEMP Bike', 'e-bike', '', 1000, 1500, 10, 'test-seed', '')
  `;

  const hash = bcryptjs.hashSync('test-password', 12);
  await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES ('idemp-seller', ${hash}, 'Idempotency Seller', 'seller', true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = 'seller'
  `;
  await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES ('idemp-driver', ${hash}, 'Idempotency Driver', 'driver', true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = 'driver'
  `;

  const today = new Date().toISOString().slice(0, 10);
  const { saleId, deliveryId } = await addSale({
    date: today,
    clientName: 'IDEMP Client',
    clientPhone: '+31600009999',
    clientAddress: 'Idempotency Test Address',
    item: 'IDEMP Bike',
    quantity: 1,
    unitPrice: 1500,
    paymentType: 'كاش',
    createdBy: 'idemp-seller',
  });

  await sql`UPDATE deliveries SET assigned_driver = 'idemp-driver' WHERE id = ${deliveryId}`;

  await updateDelivery({
    id: deliveryId,
    date: today,
    clientName: 'IDEMP Client',
    clientPhone: '+31600009999',
    address: 'Idempotency Test Address',
    items: 'IDEMP Bike (1)',
    totalAmount: 1500,
    status: 'تم التوصيل',
    driverName: 'idemp-driver',
    assignedDriver: 'idemp-driver',
    notes: '',
    vin: 'VIN-IDEMP',
  });

  const { rows: inv } = await sql`SELECT id FROM invoices WHERE sale_id = ${saleId}`;
  return { saleId, deliveryId, invoiceId: inv[0].id };
}

describe('idempotency: cancelSale double-cancel guard', () => {
  const savedSettings = {};

  beforeAll(async () => {
    await initDatabase();
    savedSettings.seller_bonus_fixed = await getSetting('seller_bonus_fixed');
    savedSettings.seller_bonus_percentage = await getSetting('seller_bonus_percentage');
    savedSettings.driver_bonus_fixed = await getSetting('driver_bonus_fixed');
    await setSetting('seller_bonus_fixed', '10');
    await setSetting('seller_bonus_percentage', '50');
    await setSetting('driver_bonus_fixed', '5');
  }, 30000);

  beforeEach(async () => {
    await truncateBusinessTables();
  });

  afterAll(async () => {
    await truncateBusinessTables();
    for (const [key, value] of Object.entries(savedSettings)) {
      if (value !== null) await setSetting(key, value);
    }
    await sql`DELETE FROM users WHERE username IN ('idemp-seller', 'idemp-driver')`;
  });

  it('Test 1 — second commitCancelSale throws Arabic idempotency error', async () => {
    const { saleId } = await seedConfirmedSale();

    // First cancel — must succeed
    await commitCancelSale(saleId, {
      cancelledBy: 'test-admin',
      reason: 'First cancel',
      invoiceMode: 'soft',
      bonusActions: { seller: 'remove', driver: 'remove' },
    });

    // Second cancel on the same sale — must throw
    await expect(
      commitCancelSale(saleId, {
        cancelledBy: 'test-admin',
        reason: 'Second cancel',
        invoiceMode: 'soft',
        bonusActions: { seller: 'remove', driver: 'remove' },
      })
    ).rejects.toThrow('الطلب مُلغى مسبقاً');
  });

  it('Test 2 — second attempt leaves financial state unchanged (no duplicate refunds, no duplicate audit rows)', async () => {
    const { saleId } = await seedConfirmedSale();

    await commitCancelSale(saleId, {
      cancelledBy: 'test-admin',
      reason: 'First cancel',
      invoiceMode: 'soft',
      bonusActions: { seller: 'remove', driver: 'remove' },
    });

    // Capture state after the first cancel
    const { rows: paymentsAfterFirst } = await sql`
      SELECT type, amount FROM payments WHERE sale_id = ${saleId} ORDER BY id
    `;
    const { rows: auditsAfterFirst } = await sql`
      SELECT id FROM cancellations WHERE sale_id = ${saleId}
    `;
    const { rows: saleAfterFirst } = await sql`SELECT * FROM sales WHERE id = ${saleId}`;

    expect(auditsAfterFirst).toHaveLength(1);
    // The confirmed sale had a collection (1500 at delivery) + refund (-1500 on cancel)
    const collectionsFirst = paymentsAfterFirst.filter((p) => p.type === 'collection');
    const refundsFirst = paymentsAfterFirst.filter((p) => p.type === 'refund');
    expect(collectionsFirst).toHaveLength(1);
    expect(refundsFirst).toHaveLength(1);
    expect(parseFloat(refundsFirst[0].amount)).toBe(-1500);

    // Attempt the second cancel — expected to throw
    await expect(
      commitCancelSale(saleId, {
        cancelledBy: 'test-admin',
        reason: 'Second cancel',
        invoiceMode: 'soft',
        bonusActions: { seller: 'remove', driver: 'remove' },
      })
    ).rejects.toThrow('الطلب مُلغى مسبقاً');

    // State must be identical after the failed second attempt
    const { rows: paymentsAfterSecond } = await sql`
      SELECT type, amount FROM payments WHERE sale_id = ${saleId} ORDER BY id
    `;
    const { rows: auditsAfterSecond } = await sql`
      SELECT id FROM cancellations WHERE sale_id = ${saleId}
    `;
    const { rows: saleAfterSecond } = await sql`SELECT * FROM sales WHERE id = ${saleId}`;

    // No duplicate refund rows
    expect(paymentsAfterSecond).toHaveLength(paymentsAfterFirst.length);
    const refundsSecond = paymentsAfterSecond.filter((p) => p.type === 'refund');
    expect(refundsSecond).toHaveLength(1);
    expect(parseFloat(refundsSecond[0].amount)).toBe(-1500);

    // No duplicate audit row
    expect(auditsAfterSecond).toHaveLength(1);
    expect(auditsAfterSecond[0].id).toBe(auditsAfterFirst[0].id);

    // Sale state unchanged
    expect(saleAfterSecond[0].status).toBe(saleAfterFirst[0].status);
    expect(parseFloat(saleAfterSecond[0].paid_amount)).toBe(parseFloat(saleAfterFirst[0].paid_amount));
    expect(saleAfterSecond[0].payment_status).toBe(saleAfterFirst[0].payment_status);
  });

  it('Test 3 — previewCancelSale on an already-cancelled sale still returns a preview (no throw)', async () => {
    const { saleId } = await seedConfirmedSale();

    await commitCancelSale(saleId, {
      cancelledBy: 'test-admin',
      reason: 'First cancel',
      invoiceMode: 'soft',
      bonusActions: { seller: 'remove', driver: 'remove' },
    });

    // Preview mode must NOT be blocked by the idempotency guard — the
    // admin dialog should still render the "already cancelled" state.
    const preview = await previewCancelSale(saleId, 'test-admin');
    expect(preview).toBeDefined();
    expect(preview.preview).toBeDefined();
    expect(preview.preview.alreadyCancelled).toBe(true);
  });

  it('Test 4 — stock is not double-restored on the failed second cancel attempt', async () => {
    const { saleId } = await seedConfirmedSale();

    await commitCancelSale(saleId, {
      cancelledBy: 'test-admin',
      reason: 'First cancel',
      invoiceMode: 'soft',
      bonusActions: { seller: 'remove', driver: 'remove' },
    });

    // Product started at 10, sale consumed 1, first cancel restored 1 → back to 10
    const { rows: stockAfterFirst } = await sql`
      SELECT stock FROM products WHERE name = 'IDEMP Bike'
    `;
    expect(parseFloat(stockAfterFirst[0].stock)).toBe(10);

    // Second cancel throws
    await expect(
      commitCancelSale(saleId, {
        cancelledBy: 'test-admin',
        reason: 'Second cancel',
        invoiceMode: 'soft',
        bonusActions: { seller: 'remove', driver: 'remove' },
      })
    ).rejects.toThrow('الطلب مُلغى مسبقاً');

    // Stock is still 10 — not 11 (the removed redundant !alreadyCancelled
    // stock guard was defense-in-depth; the Step 1 throw replaces it).
    const { rows: stockAfterSecond } = await sql`
      SELECT stock FROM products WHERE name = 'IDEMP Bike'
    `;
    expect(parseFloat(stockAfterSecond[0].stock)).toBe(10);
  });
});
