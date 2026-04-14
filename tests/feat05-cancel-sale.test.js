// FEAT-05: cancelSale helper + 4 entry-point parity tests.
//
// Runs against the real Neon test branch via .env.test, same pattern as
// tests/sale-lifecycle.test.js. Each test isolates itself by truncating
// business tables at setup and seeding its own fixture data.
//
// Tests:
//   1. cancelSale happy path (voidInvoice entry) — stock restored, bonuses
//      removed, invoice soft-voided, audit row written
//   2. cancelSale keeps bonuses when bonusActions: {seller:'keep', driver:'keep'}
//   3. cancelSale throws BONUS_CHOICE_REQUIRED when bonuses exist and
//      bonusActions is null
//   4. cancelSale throws SETTLED_BONUS_SELLER when seller bonus is settled
//   5. Preview mode returns the expected shape without writes
//   6. deleteSale entry point removes sale + delivery rows + writes audit
//   7. cancelDelivery entry point (BUG-X1 fix) cancels delivery + cancels sale
//   8. updateDelivery(cancel) entry point calls cancelSale properly
//
// Run with: npx vitest run tests/feat05-cancel-sale.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@vercel/postgres';
import bcryptjs from 'bcryptjs';
import {
  initDatabase,
  addSale,
  updateDelivery,
  voidInvoice,
  deleteSale,
  cancelDelivery,
  cancelSale,
  previewCancelSale,
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

// Each test seeds its own product + users + one confirmed sale with bonuses.
// Returns the fixture's { saleId, deliveryId, invoiceId }.
async function seedConfirmedSale() {
  // Seed product
  await sql`
    INSERT INTO products (name, category, unit, buy_price, sell_price, stock, created_by, notes)
    VALUES ('FEAT05 Bike', 'e-bike', '', 1000, 1500, 10, 'test-seed', '')
  `;

  // Seed test users
  const hash = bcryptjs.hashSync('test-password', 12);
  await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES ('feat05-seller', ${hash}, 'FEAT05 Seller', 'seller', true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = 'seller'
  `;
  await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES ('feat05-driver', ${hash}, 'FEAT05 Driver', 'driver', true)
    ON CONFLICT (username) DO UPDATE SET active = true, role = 'driver'
  `;

  // Create sale
  const today = new Date().toISOString().slice(0, 10);
  const { saleId, deliveryId } = await addSale({
    date: today,
    clientName: 'FEAT05 Client',
    clientPhone: '+31601234567',
    item: 'FEAT05 Bike',
    quantity: 1,
    unitPrice: 1500,
    paymentType: 'كاش',
    createdBy: 'feat05-seller',
  });

  // Assign driver to the auto-created delivery
  await sql`UPDATE deliveries SET assigned_driver = 'feat05-driver' WHERE id = ${deliveryId}`;

  // Confirm delivery → creates invoice + bonuses
  await updateDelivery({
    id: deliveryId,
    date: today,
    clientName: 'FEAT05 Client',
    clientPhone: '+31601234567',
    address: '',
    items: 'FEAT05 Bike (1)',
    totalAmount: 1500,
    status: 'تم التوصيل',
    driverName: 'feat05-driver',
    assignedDriver: 'feat05-driver',
    notes: '',
    vin: 'VIN-FEAT05-TEST',
  });

  // Fetch the invoice id
  const { rows: inv } = await sql`SELECT id FROM invoices WHERE sale_id = ${saleId}`;
  return { saleId, deliveryId, invoiceId: inv[0].id };
}

describe('FEAT-05: cancelSale helper + entry-point parity', () => {
  const savedSettings = {};

  beforeAll(async () => {
    await initDatabase();

    // Save + force bonus settings
    savedSettings.seller_bonus_fixed = await getSetting('seller_bonus_fixed');
    savedSettings.seller_bonus_percentage = await getSetting('seller_bonus_percentage');
    savedSettings.driver_bonus_fixed = await getSetting('driver_bonus_fixed');
    await setSetting('seller_bonus_fixed', '10');
    await setSetting('seller_bonus_percentage', '50');
    await setSetting('driver_bonus_fixed', '5');
  }, 30000);

  beforeEach(async () => {
    // Every test starts from a clean slate — no shared state between tests.
    await truncateBusinessTables();
  });

  afterAll(async () => {
    await truncateBusinessTables();
    for (const [key, value] of Object.entries(savedSettings)) {
      if (value !== null) await setSetting(key, value);
    }
    await sql`DELETE FROM users WHERE username IN ('feat05-seller', 'feat05-driver')`;
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 1: happy path via voidInvoice → cancelSale with both bonuses removed
  // ──────────────────────────────────────────────────────────────────────
  it('voidInvoice with bonusActions: remove both → full cancel + audit', async () => {
    const { saleId, invoiceId } = await seedConfirmedSale();

    await voidInvoice(invoiceId, {
      cancelledBy: 'test-admin',
      reason: 'Test void',
      bonusActions: { seller: 'remove', driver: 'remove' },
    });

    // Sale is cancelled and zeroed
    const { rows: sale } = await sql`SELECT * FROM sales WHERE id = ${saleId}`;
    expect(sale[0].status).toBe('ملغي');
    expect(parseFloat(sale[0].paid_amount)).toBe(0);
    expect(parseFloat(sale[0].remaining)).toBe(0);
    expect(sale[0].payment_status).toBe('cancelled');

    // Invoice soft-voided (status updated, row preserved)
    const { rows: inv } = await sql`SELECT * FROM invoices WHERE id = ${invoiceId}`;
    expect(inv).toHaveLength(1);
    expect(inv[0].status).toBe('ملغي');

    // Stock restored
    const { rows: prods } = await sql`SELECT stock FROM products WHERE name = 'FEAT05 Bike'`;
    expect(parseFloat(prods[0].stock)).toBe(10);

    // Bonuses gone
    const { rows: bonuses } = await sql`SELECT * FROM bonuses WHERE sale_id = ${saleId}`;
    expect(bonuses).toHaveLength(0);

    // Delivery synced to cancelled
    const { rows: deliveries } = await sql`SELECT * FROM deliveries WHERE sale_id = ${saleId}`;
    expect(deliveries[0].status).toBe('ملغي');

    // Audit row
    const { rows: audit } = await sql`SELECT * FROM cancellations WHERE sale_id = ${saleId}`;
    expect(audit).toHaveLength(1);
    expect(audit[0].cancelled_by).toBe('test-admin');
    expect(audit[0].reason).toBe('Test void');
    expect(audit[0].invoice_mode).toBe('soft');
    expect(audit[0].seller_bonus_kept).toBe(false);
    expect(audit[0].driver_bonus_kept).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 2: keep both bonuses — the rows stay, audit reflects the choice
  // ──────────────────────────────────────────────────────────────────────
  it('voidInvoice with bonusActions: keep both → bonuses survive cancel', async () => {
    const { saleId, invoiceId } = await seedConfirmedSale();

    await voidInvoice(invoiceId, {
      cancelledBy: 'test-admin',
      reason: 'Keep test',
      bonusActions: { seller: 'keep', driver: 'keep' },
    });

    // Sale still cancelled
    const { rows: sale } = await sql`SELECT * FROM sales WHERE id = ${saleId}`;
    expect(sale[0].status).toBe('ملغي');

    // But the bonuses stayed
    const { rows: bonuses } = await sql`SELECT role FROM bonuses WHERE sale_id = ${saleId} ORDER BY role`;
    expect(bonuses).toHaveLength(2);
    expect(bonuses[0].role).toBe('driver');
    expect(bonuses[1].role).toBe('seller');

    // Audit reflects the keep choice
    const { rows: audit } = await sql`SELECT * FROM cancellations WHERE sale_id = ${saleId}`;
    expect(audit[0].seller_bonus_kept).toBe(true);
    expect(audit[0].driver_bonus_kept).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 3: BONUS_CHOICE_REQUIRED sentinel
  // ──────────────────────────────────────────────────────────────────────
  it('voidInvoice without bonusActions throws BONUS_CHOICE_REQUIRED when bonuses exist', async () => {
    const { invoiceId } = await seedConfirmedSale();

    await expect(
      voidInvoice(invoiceId, { cancelledBy: 'test-admin', reason: 'Test' })
    ).rejects.toMatchObject({
      message: 'BONUS_CHOICE_REQUIRED',
      code: 'BONUS_CHOICE_REQUIRED',
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 4: SETTLED_BONUS block
  // ──────────────────────────────────────────────────────────────────────
  it('cancelSale throws SETTLED_BONUS_SELLER when seller bonus is settled', async () => {
    const { saleId, invoiceId } = await seedConfirmedSale();

    // Mark seller bonus as settled
    await sql`
      UPDATE bonuses SET settled = true
      WHERE sale_id = ${saleId} AND role = 'seller'
    `;

    await expect(
      voidInvoice(invoiceId, {
        cancelledBy: 'test-admin',
        reason: 'Blocked test',
        bonusActions: { seller: 'remove', driver: 'remove' },
      })
    ).rejects.toMatchObject({ code: 'SETTLED_BONUS_SELLER' });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 5: preview mode — no writes, correct shape.
  // FEAT-04 ACTIVATION: this test was flipped from refundAmount === 0 to
  // refundAmount === 1500. Before FEAT-04 updateDelivery(confirm) set
  // sales.paid_amount directly without inserting a payments row, so the
  // cancelSale step-5 refund walker had nothing to return. Now that
  // updateDelivery(confirm) writes a `type='collection'` payment row
  // matching down_payment_expected, the refund walker picks up the
  // seeded 1500€ payment and reports it to the preview caller.
  // ──────────────────────────────────────────────────────────────────────
  it('previewCancelSale returns preview shape without any writes (FEAT-04 activated)', async () => {
    const { saleId } = await seedConfirmedSale();

    const result = await previewCancelSale(saleId, 'test-admin');

    // FEAT-04: seeded sale is كاش with default dpe = total = 1500, so
    // updateDelivery(confirm) wrote a 1500€ collection payment row.
    expect(result.refundAmount).toBe(1500);
    expect(result.preview.saleId).toBe(saleId);
    expect(result.preview.clientName).toBe('FEAT05 Client');
    expect(result.preview.item).toBe('FEAT05 Bike');
    expect(parseFloat(result.preview.total)).toBe(1500);
    expect(parseFloat(result.preview.paidAmount)).toBe(1500); // set by updateDelivery(confirm)
    expect(result.preview.sellerBonus.exists).toBe(true);
    expect(result.preview.sellerBonus.settled).toBe(false);
    expect(result.preview.sellerBonus.username).toBe('feat05-seller');
    expect(result.preview.driverBonus.exists).toBe(true);
    expect(result.preview.driverBonus.username).toBe('feat05-driver');

    // Nothing was written — sale still مؤكد
    const { rows: sale } = await sql`SELECT status FROM sales WHERE id = ${saleId}`;
    expect(sale[0].status).toBe('مؤكد');

    // No audit row
    const { rows: audit } = await sql`SELECT * FROM cancellations WHERE sale_id = ${saleId}`;
    expect(audit).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 6: deleteSale — hard delete via commitCancelSale+invoiceMode='delete'
  // ──────────────────────────────────────────────────────────────────────
  it('deleteSale removes sale + delivery rows + writes audit', async () => {
    const { saleId, deliveryId } = await seedConfirmedSale();

    await deleteSale(saleId, {
      cancelledBy: 'test-admin',
      reason: 'Delete test',
    });

    // Sale row is gone
    const { rows: sale } = await sql`SELECT * FROM sales WHERE id = ${saleId}`;
    expect(sale).toHaveLength(0);

    // Delivery row is gone
    const { rows: deliveries } = await sql`SELECT * FROM deliveries WHERE id = ${deliveryId}`;
    expect(deliveries).toHaveLength(0);

    // Invoice row is gone (invoiceMode='delete' + FK CASCADE)
    const { rows: inv } = await sql`SELECT * FROM invoices WHERE sale_id = ${saleId}`;
    expect(inv).toHaveLength(0);

    // Audit row WAS written before the delete (cancelSale writes it,
    // then the DELETE cascades — but cancellations.sale_id is just an
    // integer, not a FK, so the audit row survives the sale-row delete)
    const { rows: audit } = await sql`SELECT * FROM cancellations WHERE sale_id = ${saleId}`;
    expect(audit).toHaveLength(1);
    expect(audit[0].invoice_mode).toBe('delete');
    expect(audit[0].reason).toBe('Delete test');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 7: cancelDelivery — BUG-X1 fix.
  //
  // Old two-line implementation dropped the delivery row outside any
  // transaction and cascade-deleted bonuses/invoices via FK while
  // leaving the sale in مؤكد with its stock decremented.
  //
  // New behavior: cancelDelivery runs cancelSale against the linked
  // sale. The delivery row is preserved with status='ملغي' (NOT
  // physically deleted) because invoices.delivery_id is NOT NULL +
  // ON DELETE CASCADE — physically dropping the delivery would
  // cascade-delete the invoice and defeat invoiceMode='soft'. See
  // the cancelDelivery JSDoc for the full rationale.
  // ──────────────────────────────────────────────────────────────────────
  it('cancelDelivery cancels the linked sale atomically (BUG-X1 fix)', async () => {
    const { saleId, deliveryId } = await seedConfirmedSale();

    await cancelDelivery(deliveryId, {
      cancelledBy: 'test-admin',
      reason: 'Cancel-delivery test',
      bonusActions: { seller: 'remove', driver: 'remove' },
    });

    // Delivery row preserved with status='ملغي' (not physically deleted
    // in the new behavior — see comment above).
    const { rows: deliveries } = await sql`SELECT * FROM deliveries WHERE id = ${deliveryId}`;
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe('ملغي');

    // Sale is now cancelled (this is the BUG-X1 fix — the old behavior
    // left the sale in مؤكد)
    const { rows: sale } = await sql`SELECT * FROM sales WHERE id = ${saleId}`;
    expect(sale[0].status).toBe('ملغي');
    expect(sale[0].payment_status).toBe('cancelled');

    // Stock restored
    const { rows: prods } = await sql`SELECT stock FROM products WHERE name = 'FEAT05 Bike'`;
    expect(parseFloat(prods[0].stock)).toBe(10);

    // Invoice soft-voided (preserved with status='ملغي')
    const { rows: inv } = await sql`SELECT * FROM invoices WHERE sale_id = ${saleId}`;
    expect(inv).toHaveLength(1);
    expect(inv[0].status).toBe('ملغي');

    // Audit row exists
    const { rows: audit } = await sql`SELECT * FROM cancellations WHERE sale_id = ${saleId}`;
    expect(audit).toHaveLength(1);
    expect(audit[0].reason).toBe('Cancel-delivery test');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 8: updateDelivery(cancel) — admin cancels a RESERVED sale
  // BEFORE delivery confirmation. Post-confirm cancellation goes through
  // the /api/sales/[id]/cancel endpoint (and commitCancelSale) because
  // the terminal-state guard at lib/db.js:1741 blocks
  // 'تم التوصيل → ملغي' transitions on updateDelivery.
  // ──────────────────────────────────────────────────────────────────────
  it('updateDelivery(cancel) on a reserved sale routes through cancelSale and writes audit', async () => {
    // Seed product + a reserved sale (no delivery confirmation, no bonuses)
    await sql`
      INSERT INTO products (name, category, unit, buy_price, sell_price, stock, created_by, notes)
      VALUES ('FEAT05 Bike', 'e-bike', '', 1000, 1500, 10, 'test-seed', '')
    `;
    const today = new Date().toISOString().slice(0, 10);
    const { saleId, deliveryId } = await addSale({
      date: today,
      clientName: 'FEAT05 Client',
      item: 'FEAT05 Bike',
      quantity: 1,
      unitPrice: 1500,
      paymentType: 'كاش',
      createdBy: 'feat05-seller',
    });

    // Delivery is at 'قيد الانتظار' (non-terminal), so updateDelivery
    // will allow the transition to 'ملغي'.
    await updateDelivery({
      id: deliveryId,
      date: today,
      clientName: 'FEAT05 Client',
      clientPhone: '',
      address: '',
      items: 'FEAT05 Bike (1)',
      totalAmount: 1500,
      status: 'ملغي',
      driverName: '',
      assignedDriver: '',
      notes: '',
      vin: '',
      // FEAT-05 extra fields for the cancel path
      cancelledBy: 'test-admin',
      cancelReason: 'Reserved cancel test',
      // No bonusActions needed — reserved sale has no bonuses yet
    });

    // Sale cancelled
    const { rows: sale } = await sql`SELECT * FROM sales WHERE id = ${saleId}`;
    expect(sale[0].status).toBe('ملغي');
    expect(sale[0].payment_status).toBe('cancelled');

    // Delivery row cancelled
    const { rows: deliveries } = await sql`SELECT * FROM deliveries WHERE id = ${deliveryId}`;
    expect(deliveries[0].status).toBe('ملغي');

    // Stock restored — the reserved quantity was returned (sale had reserved 1)
    const { rows: prods } = await sql`SELECT stock FROM products WHERE name = 'FEAT05 Bike'`;
    expect(parseFloat(prods[0].stock)).toBe(10);

    // Audit row
    const { rows: audit } = await sql`SELECT * FROM cancellations WHERE sale_id = ${saleId}`;
    expect(audit).toHaveLength(1);
    expect(audit[0].reason).toBe('Reserved cancel test');
    // No bonuses → both _kept fields should be NULL
    expect(audit[0].seller_bonus_kept).toBeNull();
    expect(audit[0].driver_bonus_kept).toBeNull();
  });
});
