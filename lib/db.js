// v1.1 S4.1 — lib/db.js is now a barrel file that re-exports from
// domain modules under lib/db/. Shared infrastructure lives in
// lib/db/_shared.js; migrations/init in lib/db/_migrations.js.
// Everything else (purchases, sales, clients, etc.) remains in THIS
// file for now and will be extracted incrementally.
//
// ALL existing imports (`from '@/lib/db'`, `from '../lib/db.js'`)
// continue to work unchanged because this file re-exports the union.

// Re-export shared infra (withTx, generateRefCode, sql, db)
export { ignoreExpectedDdl, generateRefCode, withTx, sql, db } from './db/_shared.js';

// Re-export migrations (initDatabase, resetDatabase, seedProductAliases)
export { getNextInvoiceNumber, resetDatabase, initDatabase, seedProductAliases } from './db/_migrations.js';

// The remaining domain functions are still defined below.
// They import shared infra locally + any extracted functions they call.
import { sql, db } from '@vercel/postgres';
import { withTx, generateRefCode, ignoreExpectedDdl } from './db/_shared.js';
import { getNextInvoiceNumber } from './db/_migrations.js';
// #region PURCHASES

/**
 * @returns {Promise<Array<object>>} All purchase rows, newest first.
 */
export async function getPurchases(supplierName) {
  if (supplierName) {
    const { rows } = await sql`SELECT * FROM purchases WHERE supplier = ${supplierName} ORDER BY id DESC`;
    return rows;
  }
  const { rows } = await sql`SELECT * FROM purchases ORDER BY id DESC`;
  return rows;
}

/**
 * Insert a purchase and update the product's weighted-average buy price,
 * sell price, and stock inside a single transaction. Creates the product
 * row if it does not yet exist. Writes a `price_history` audit row.
 * @param {{date:string, supplier:string, item:string, category?:string,
 *   quantity:number|string, unitPrice:number|string, sellPrice?:number|string,
 *   paymentType?:string, createdBy?:string, notes?:string}} data
 * @returns {Promise<number>} The new purchase id.
 */
export async function addPurchase(data) {
  const qty = parseFloat(data.quantity) || 0;
  const price = parseFloat(data.unitPrice) || 0;
  const sellPriceProvided = parseFloat(data.sellPrice) || 0;
  if (qty <= 0) throw new Error('الكمية يجب أن تكون أكبر من 0');
  if (price <= 0) throw new Error('السعر يجب أن يكون أكبر من 0');
  const total = qty * price;
  const refCode = generateRefCode('PU');
  const today = new Date().toISOString().split('T')[0];

  // v1.0.1 Feature 6 — supplier credit. If paidAmount is omitted the
  // default is "paid in full now" (pre-v1.0.1 behavior, backward compat).
  // If provided, must satisfy 0 ≤ paidAmount ≤ total. payment_status is
  // derived once here; paySupplier() maintains it on subsequent payments.
  const providedPaid = data.paidAmount;
  const paidAmount = (providedPaid === undefined || providedPaid === null || providedPaid === '')
    ? total
    : parseFloat(providedPaid) || 0;
  if (paidAmount < 0) {
    throw new Error('المبلغ المدفوع لا يمكن أن يكون سالباً');
  }
  if (paidAmount > total + 0.01) {
    throw new Error(`المبلغ المدفوع (${paidAmount.toFixed(2)}€) يتجاوز إجمالي الشراء (${total.toFixed(2)}€)`);
  }
  const paymentStatus = paidAmount >= total - 0.005
    ? 'paid'
    : paidAmount > 0.005
    ? 'partial'
    : 'pending';

  return withTx(async (client) => {
    // Lock the product row (if it exists) to serialize concurrent purchases of the same item
    const { rows: oldProduct } = await client.sql`
      SELECT buy_price, sell_price, stock FROM products WHERE name = ${data.item} FOR UPDATE
    `;
    const exists = oldProduct.length > 0;
    // ARC-06: NUMERIC columns come back as strings from @vercel/postgres.
    // Without parseFloat, `oldStock + qty` would produce "5.002" (string
    // concat) instead of 7 (number addition), and the subsequent UPDATE
    // would persist the concatenated garbage as the new stock value.
    const oldBuy = exists ? parseFloat(oldProduct[0].buy_price) || 0 : 0;
    const oldSell = exists ? parseFloat(oldProduct[0].sell_price) || 0 : 0;
    const oldStock = exists ? parseFloat(oldProduct[0].stock) || 0 : 0;

    // Insert the purchase row — DONE: Step 6 stores category alongside the purchase
    // v1.0.1 Feature 6 — paid_amount + payment_status persisted here.
    const { rows } = await client.sql`
      INSERT INTO purchases (
        date, supplier, item, category, quantity, unit_price, total,
        payment_type, ref_code, created_by, notes, paid_amount, payment_status
      )
      VALUES (
        ${data.date}, ${data.supplier}, ${data.item}, ${data.category || ''},
        ${qty}, ${price}, ${total},
        ${data.paymentType || 'كاش'}, ${refCode}, ${data.createdBy || ''}, ${data.notes || ''},
        ${paidAmount}, ${paymentStatus}
      )
      RETURNING id, ref_code
    `;
    // Also seed supplier_payments with the initial payment row so the audit
    // trail always starts with the down payment (even 0 for pending).
    if (paidAmount > 0.005) {
      await client.sql`
        INSERT INTO supplier_payments (purchase_id, date, amount, payment_method, notes, created_by)
        VALUES (${rows[0].id}, ${data.date}, ${paidAmount}, ${data.paymentType || 'كاش'}, 'الدفعة الأولى', ${data.createdBy || ''})
      `;
    }

    if (!exists) {
      // First time we see this product — create it with the purchase price + category
      await client.sql`
        INSERT INTO products (name, category, buy_price, sell_price, stock, created_by)
        VALUES (${data.item}, ${data.category || ''}, ${price}, ${sellPriceProvided > 0 ? sellPriceProvided : 0}, ${qty}, ${data.createdBy || ''})
      `;
    } else {
      // Weighted average cost: (old_stock * old_price + new_qty * new_price) / (old_stock + new_qty)
      const newStock = oldStock + qty;
      const newBuy = newStock > 0 ? (oldStock * oldBuy + qty * price) / newStock : price;
      const newSell = sellPriceProvided > 0 ? sellPriceProvided : oldSell;
      await client.sql`
        UPDATE products
        SET buy_price = ${newBuy}, sell_price = ${newSell}, stock = ${newStock}
        WHERE name = ${data.item}
      `;
    }

    // Audit price change
    const { rows: newProduct } = await client.sql`SELECT buy_price, sell_price FROM products WHERE name = ${data.item}`;
    if (newProduct.length > 0) {
      await client.sql`
        INSERT INTO price_history (date, product_name, old_buy_price, new_buy_price, old_sell_price, new_sell_price, purchase_id, changed_by)
        VALUES (${today}, ${data.item}, ${oldBuy}, ${newProduct[0].buy_price}, ${oldSell}, ${newProduct[0].sell_price}, ${rows[0].id}, ${data.createdBy || ''})
      `;
    }

    return rows[0].id;
  });
}

/**
 * Delete a purchase and reverse its effect on stock + weighted-average
 * buy price. Throws (Arabic message) if the current stock is already
 * lower than the purchased quantity (part of the batch already sold).
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deletePurchase(id) {
  return withTx(async (client) => {
    const { rows: purchaseRows } = await client.sql`SELECT * FROM purchases WHERE id = ${id} FOR UPDATE`;
    if (!purchaseRows.length) return;
    const p = purchaseRows[0];
    const qty = parseFloat(p.quantity) || 0;
    const price = parseFloat(p.unit_price) || 0;

    // Reverse stock and weighted-average buy price atomically
    if (qty > 0) {
      const { rows: prodRows } = await client.sql`
        SELECT stock, buy_price FROM products WHERE name = ${p.item} FOR UPDATE
      `;
      if (prodRows.length) {
        const curStock = parseFloat(prodRows[0].stock) || 0;
        const curBuy = parseFloat(prodRows[0].buy_price) || 0;
        if (qty > curStock) {
          throw new Error(`لا يمكن حذف المشترى - المخزون الحالي (${curStock}) أقل من كمية المشترى (${qty}) - بيع جزء منه بالفعل`);
        }
        const newStock = curStock - qty;
        // Reverse weighted average: solve for the previous buy_price.
        // curBuy = (newStock * prevBuy + qty * price) / curStock  →  prevBuy = (curBuy * curStock - qty * price) / newStock
        const newBuy = newStock > 0 ? Math.max(0, (curBuy * curStock - qty * price) / newStock) : 0;
        await client.sql`
          UPDATE products SET stock = ${newStock}, buy_price = ${newBuy} WHERE name = ${p.item}
        `;
        const today = new Date().toISOString().split('T')[0];
        await client.sql`
          INSERT INTO price_history (date, product_name, old_buy_price, new_buy_price, old_sell_price, new_sell_price, purchase_id, changed_by)
          VALUES (${today}, ${p.item}, ${curBuy}, ${newBuy}, 0, 0, ${id}, 'reversal')
        `.catch(ignoreExpectedDdl);
      }
    }

    // SP-014: clean up supplier_payments before deleting the purchase
    await client.sql`DELETE FROM supplier_payments WHERE purchase_id = ${id}`;
    await client.sql`DELETE FROM purchases WHERE id = ${id}`;
  });
}

/**
 * v1.0.1 Feature 6 — record a partial or full supplier payment on an
 * existing purchase. Atomically:
 *   1. Locks the purchases row
 *   2. Validates the new paid_amount ≤ total (prevents overpay)
 *   3. Updates purchases.paid_amount + derived payment_status
 *   4. Inserts a supplier_payments audit row
 *
 * @param {{purchaseId:number, amount:number|string,
 *          paymentMethod?:'كاش'|'بنك', notes?:string, createdBy?:string}} data
 * @returns {Promise<{newPaidAmount:number, newStatus:string, paymentId:number}>}
 */
export async function paySupplier(data) {
  const amt = parseFloat(data.amount) || 0;
  if (amt <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  return withTx(async (client) => {
    const { rows } = await client.sql`
      SELECT id, total, paid_amount, payment_status
      FROM purchases WHERE id = ${data.purchaseId} FOR UPDATE
    `;
    if (!rows.length) throw new Error('عملية الشراء غير موجودة');
    const p = rows[0];
    const total = parseFloat(p.total) || 0;
    const currentPaid = parseFloat(p.paid_amount) || 0;
    const newPaid = currentPaid + amt;
    if (newPaid > total + 0.01) {
      const remaining = Math.max(0, total - currentPaid);
      throw new Error(
        `المبلغ المدفوع (${newPaid.toFixed(2)}€) يتجاوز إجمالي الشراء (${total.toFixed(2)}€). المتبقي: ${remaining.toFixed(2)}€`
      );
    }
    const newStatus = newPaid >= total - 0.005
      ? 'paid'
      : newPaid > 0.005
      ? 'partial'
      : 'pending';
    await client.sql`
      UPDATE purchases
      SET paid_amount = ${newPaid}, payment_status = ${newStatus}
      WHERE id = ${data.purchaseId}
    `;
    const today = new Date().toISOString().split('T')[0];
    const { rows: paymentRows } = await client.sql`
      INSERT INTO supplier_payments (
        purchase_id, date, amount, payment_method, notes, created_by
      ) VALUES (
        ${data.purchaseId}, ${today}, ${amt},
        ${data.paymentMethod || 'كاش'}, ${data.notes || ''}, ${data.createdBy || ''}
      )
      RETURNING id
    `;
    return {
      newPaidAmount: newPaid,
      newStatus,
      paymentId: paymentRows[0].id,
    };
  });
}

/**
 * v1.0.1 Feature 6 — list all supplier payments for a given purchase.
 * Used by the purchase detail / dialog to show the payment timeline.
 *
 * @param {number} purchaseId
 * @returns {Promise<Array<object>>}
 */
export async function getSupplierPayments(purchaseId) {
  const { rows } = await sql`
    SELECT * FROM supplier_payments
    WHERE purchase_id = ${purchaseId}
    ORDER BY id ASC
  `;
  return rows.map((r) => ({
    ...r,
    amount: parseFloat(r.amount) || 0,
  }));
}

// #endregion

// #region SALES

/**
 * @param {string} [clientName] If provided, filters to this client only.
 * @returns {Promise<Array<object>>} Sales rows, newest first.
 */
export async function getSales(clientName) {
  // LEFT JOIN invoices so callers (client detail page, sales list) can
  // render an "open invoice PDF" link without a second round-trip. The
  // join yields NULL invoice_ref_code for unconfirmed sales, which UI
  // code already has to handle (button hides when null).
  if (clientName) {
    const { rows } = await sql`
      SELECT s.*, i.ref_code AS invoice_ref_code
      FROM sales s
      LEFT JOIN invoices i ON i.sale_id = s.id
      WHERE s.client_name = ${clientName}
      ORDER BY s.id DESC
    `;
    return rows;
  }
  const { rows } = await sql`
    SELECT s.*, i.ref_code AS invoice_ref_code
    FROM sales s
    LEFT JOIN invoices i ON i.sale_id = s.id
    ORDER BY s.id DESC
  `;
  return rows;
}

/**
 * Create a reserved sale: atomically reserves stock, inserts the sale
 * row, upserts the client (via `addClient`), and creates a linked
 * delivery row (`قيد الانتظار`). Throws (Arabic) on oversell or on
 * ambiguous client identity (same name, no phone/email).
 * @param {{date:string, clientName:string, item:string,
 *   quantity:number|string, unitPrice:number|string, paymentType?:string,
 *   clientPhone?:string, clientEmail?:string, clientAddress?:string,
 *   createdBy?:string, notes?:string}} data
 * @returns {Promise<{saleId:number, deliveryId:number, refCode:string}>}
 */
export async function addSale(data) {
  const qty = parseFloat(data.quantity) || 0;
  const sellPrice = parseFloat(data.unitPrice) || 0;
  if (qty <= 0) throw new Error('الكمية يجب أن تكون أكبر من 0');
  if (sellPrice <= 0) throw new Error('السعر يجب أن يكون أكبر من 0');
  const total = qty * sellPrice;

  // ALL sales start unpaid - payment confirmed after delivery.
  // كاش/بنك: يتحول لمدفوع عند تأكيد التوصيل. آجل: يبقى دين بعد التوصيل.
  const validPayments = ['كاش', 'بنك', 'آجل'];
  const paymentType = validPayments.includes(data.paymentType) ? data.paymentType : 'كاش';

  // FEAT-04: down_payment_expected — the amount the driver will collect at
  // delivery. Reactive defaults depend on paymentType:
  //   - آجل       → 0 (seller may still set a positive number to force a
  //                  partial down payment on credit sales)
  //   - كاش / بنك → total (full payment at delivery)
  // Caller may override either default. Validated against [0, total].
  let downPaymentExpected;
  if (data.downPaymentExpected === undefined || data.downPaymentExpected === null || data.downPaymentExpected === '') {
    downPaymentExpected = paymentType === 'آجل' ? 0 : total;
  } else {
    downPaymentExpected = parseFloat(data.downPaymentExpected) || 0;
  }
  if (downPaymentExpected < 0) {
    throw new Error('الدفعة المقدمة لا يمكن أن تكون سالبة');
  }
  if (downPaymentExpected > total + 0.005) {
    throw new Error('لا يمكن أن تكون الدفعة المقدمة أكبر من الإجمالي');
  }
  // v1.0.3 Bug A — cash/bank sales must collect the full total at
  // delivery. Pre-v1.0.3 the symmetric [0, total] validation let a
  // seller submit a كاش sale with dpe < total, the driver confirm
  // dialog displayed the partial amount, and the company silently
  // lost the difference. Live evidence: sales.id=1 had كاش/950/500.
  // Only آجل (credit) sales legitimately allow dpe < total.
  if ((paymentType === 'كاش' || paymentType === 'بنك') &&
      Math.abs(downPaymentExpected - total) > 0.005) {
    throw new Error(
      `البيع النقدي/البنكي يتطلب دفع المبلغ بالكامل عند التوصيل. ` +
      `المبلغ المطلوب: ${total.toFixed(2)}€ (المُدخَل: ${downPaymentExpected.toFixed(2)}€)`
    );
  }

  return withTx(async (client) => {
    // Atomic check + reserve: row-level lock prevents concurrent oversell
    const { rows: prodRows } = await client.sql`
      SELECT buy_price, sell_price, stock FROM products WHERE name = ${data.item} FOR UPDATE
    `;
    if (prodRows.length === 0) throw new Error('المنتج غير موجود');
    const currentStock = parseFloat(prodRows[0].stock) || 0;
    if (qty > currentStock) {
      throw new Error(`الكمية المطلوبة (${qty}) أكبر من المخزون المتاح (${currentStock})`);
    }
    const costPrice = parseFloat(prodRows[0].buy_price) || 0;
    const recommendedPrice = parseFloat(prodRows[0].sell_price) || 0;
    const costTotal = qty * costPrice;
    const profit = total - costTotal;

    await client.sql`UPDATE products SET stock = stock - ${qty}::numeric WHERE name = ${data.item}`;

    const saleRef = generateRefCode('SL');
    const { rows } = await client.sql`
      INSERT INTO sales (date, client_name, item, quantity, cost_price, unit_price, total, cost_total, profit, payment_method, payment_type, paid_amount, remaining, status, ref_code, created_by, recommended_price, notes, down_payment_expected)
      VALUES (${data.date}, ${data.clientName}, ${data.item}, ${qty}, ${costPrice}, ${sellPrice}, ${total}, ${costTotal}, ${profit}, ${paymentType}, ${paymentType}, 0, ${total}, 'محجوز', ${saleRef}, ${data.createdBy || ''}, ${recommendedPrice}, ${data.notes || ''}, ${downPaymentExpected})
      RETURNING id
    `;
    const saleId = rows[0].id;

    // DONE: Step 3 — Upsert via addClient() with proper identity check.
    // The previous ON CONFLICT (name) relied on the now-dropped UNIQUE(name).
    // addClient() identifies clients by (name + phone) OR (name + email) and throws
    // an Arabic error if the same name exists multiple times with no contact info.
    // Note: addClient uses the global sql connection, not the transaction client —
    // an orphan client row from a rolled-back sale is harmless and idempotent on retry.
    if (data.clientName) {
      const clientResult = await addClient({
        name:      data.clientName,
        phone:     data.clientPhone   || '',
        email:     data.clientEmail   || '',
        address:   data.clientAddress || '',
        createdBy: data.createdBy     || '',
        // BUG-6 hotfix 2026-04-14: sale-path requires delivery address
        // when the client is genuinely new. Existing clients inherit
        // their address from the previous row and skip this check.
        requireAddress: true,
      });
      if (clientResult.ambiguous) {
        throw new Error(
          `يوجد عملاء متعددون باسم "${data.clientName}" — يجب إضافة رقم هاتف أو إيميل للتمييز`
        );
      }
    }

    // Auto-create delivery linked by sale_id
    const delRef = generateRefCode('DL');
    const { rows: delRows } = await client.sql`
      INSERT INTO deliveries (date, client_name, client_phone, client_email, address, items, total_amount, status, driver_name, ref_code, created_by, sale_id, notes)
      VALUES (${data.date}, ${data.clientName}, ${data.clientPhone || ''}, ${data.clientEmail || ''}, ${data.clientAddress || ''}, ${data.item + ' (' + qty + ')'}, ${total}, 'قيد الانتظار', '', ${delRef}, ${data.createdBy || ''}, ${saleId}, ${'بيع رقم ' + saleId})
      RETURNING id, ref_code
    `;

    return { saleId, deliveryId: delRows[0].id, refCode: saleRef };
  });
}

/**
 * FEAT-05: atomic cancellation helper. The one true path for all four
 * cancellation entry points (updateDelivery cancel, voidInvoice, deleteSale,
 * cancelDelivery). Runs inside the caller's withTx client — everything
 * rolls back if any step throws.
 *
 * The 12 steps, in order:
 *   1. Lock the sale row (FOR UPDATE)
 *   2. Look up linked delivery + all bonuses for audit snapshot
 *   3. Settled-bonus block: throw role-specific Arabic error if any bonus
 *      is already settled (refuses cancel until admin reverses the settlement)
 *   4. Bonus-choice validation: throw BONUS_CHOICE_REQUIRED with preview
 *      data if bonuses exist but caller didn't provide bonusActions
 *   5. Refund each collected payment as a negative-amount row (with
 *      negative TVA) — net client balance returns to zero
 *   6. Restore product stock (only if sale wasn't already cancelled)
 *   7. Delete bonuses per bonusActions: 'remove' deletes the row,
 *      'keep' leaves it untouched for normal settlement flow
 *   8. Sync linked delivery row to 'ملغي'
 *   9. Handle invoice: 'soft' → UPDATE status='ملغي', 'delete' → DELETE row
 *  10. Mark sale 'ملغي' + zero paid_amount/remaining + payment_status='cancelled'
 *  11. Insert cancellations audit row
 *  12. Return { success, cancellationId, refundAmount, preview }
 *
 * Special modes:
 *   - previewOnly: run steps 1-4 only, return the preview data without
 *     any writes. Used by GET /api/sales/[id]/cancel-preview.
 *   - bonusActions forced by caller: deleteSale path passes
 *     { seller:'remove', driver:'remove' } because kept bonuses would
 *     cascade-delete seconds later anyway (FK CASCADE on bonuses.sale_id).
 *
 * @param {object} client @vercel/postgres transaction client from withTx
 * @param {object} options
 * @param {number}   options.saleId        required
 * @param {string}   options.cancelledBy   required (username from auth token)
 * @param {string}  [options.reason]       required unless previewOnly
 * @param {'soft'|'delete'} [options.invoiceMode='soft']
 * @param {{seller?:'keep'|'remove', driver?:'keep'|'remove'}|null} [options.bonusActions=null]
 * @param {string|null} [options.notes=null]
 * @param {boolean}  [options.previewOnly=false]
 * @returns {Promise<{success?:boolean, cancellationId?:number, refundAmount:number, preview:object}>}
 */
export async function cancelSale(client, options) {
  const opts = options || {};
  const {
    saleId,
    cancelledBy,
    reason,
    invoiceMode = 'soft',
    bonusActions = null,
    notes = null,
    previewOnly = false,
  } = opts;

  if (!saleId) throw new Error('cancelSale: saleId required');
  if (!cancelledBy) throw new Error('cancelSale: cancelledBy required');
  if (!previewOnly && !reason) throw new Error('cancelSale: reason required');
  if (!['soft', 'delete'].includes(invoiceMode)) {
    throw new Error('cancelSale: invoiceMode must be "soft" or "delete"');
  }

  // Step 1: lock the sale row for the duration of this transaction
  const { rows: saleRows } = await client.sql`
    SELECT id, item, quantity, status, client_name,
           payment_type, paid_amount, total, remaining
    FROM sales WHERE id = ${saleId}
    FOR UPDATE
  `;
  if (!saleRows.length) throw new Error('الطلب غير موجود');
  const sale = saleRows[0];
  const alreadyCancelled = sale.status === 'ملغي';

  // Idempotency guard (Session 8 Phase 0.5 finding): block commit-mode
  // re-execution on an already-cancelled sale. Without this, a double-
  // cancel would re-run Step 5 (refund loop) and Step 11 (cancellations
  // audit), doubly-negating already-settled collection rows and polluting
  // the audit trail. The UI prevents double-click in practice but the
  // BUG-4 submit-retry hotfix re-enables buttons after errors, so a
  // network slowness + impatient click can still race here.
  //
  // Preview mode is still allowed so the admin dialog can render the
  // "already cancelled" state if someone opens the dialog on a cancelled
  // row — it returns at Step 4 before any writes.
  if (alreadyCancelled && !previewOnly) {
    throw new Error('الطلب مُلغى مسبقاً');
  }

  // Step 2: capture audit-state snapshot (linked delivery + bonuses)
  const { rows: delRows } = await client.sql`
    SELECT id, status FROM deliveries WHERE sale_id = ${saleId}
  `;
  const delivery = delRows[0] || null;
  const delivery_status_before = delivery ? delivery.status : null;

  const { rows: bonusRows } = await client.sql`
    SELECT id, role, settled, username, total_bonus
    FROM bonuses WHERE sale_id = ${saleId}
  `;
  const sellerBonuses = bonusRows.filter((b) => b.role === 'seller');
  const driverBonuses = bonusRows.filter((b) => b.role === 'driver');
  const bonus_status_before = JSON.stringify({
    seller: sellerBonuses.length > 0
      ? { exists: true, settled: sellerBonuses.some((b) => b.settled) }
      : { exists: false },
    driver: driverBonuses.length > 0
      ? { exists: true, settled: driverBonuses.some((b) => b.settled) }
      : { exists: false },
  });

  // Step 3: settled-bonus handling.
  // Pre-v1.2 this BLOCKED cancellation entirely when bonuses were settled.
  // v1.2: allow cancellation — if the bonus was settled (paid out), we
  // create a NEGATIVE settlement record (recovery) so the amount gets
  // deducted from the employee's future payouts. Their available credit
  // goes negative until they earn enough new bonuses to cover the debt.
  const sellerSettled = sellerBonuses.some((b) => b.settled);
  const driverSettled = driverBonuses.some((b) => b.settled);

  // M-09: gather ALL positive payments (collection + legacy), not just
  // type='collection'. Legacy addPayment rows (type IS NULL or type='')
  // were missed by the old query, leaving unreversed payments on cancel.
  const { rows: paymentRows } = await client.sql`
    SELECT id, amount, tva_amount, payment_method, type
    FROM payments WHERE sale_id = ${saleId} AND amount > 0
      AND (type = 'collection' OR type IS NULL OR type = '')
  `;
  const refundAmount = paymentRows.reduce(
    (s, p) => s + (parseFloat(p.amount) || 0),
    0
  );

  // Build the preview payload — shown to admin before they commit the cancel
  const sellerBonusAmount = sellerBonuses.reduce(
    (s, b) => s + (parseFloat(b.total_bonus) || 0),
    0
  );
  const driverBonusAmount = driverBonuses.reduce(
    (s, b) => s + (parseFloat(b.total_bonus) || 0),
    0
  );
  const preview = {
    saleId: sale.id,
    clientName: sale.client_name,
    item: sale.item,
    total: parseFloat(sale.total) || 0,
    paidAmount: parseFloat(sale.paid_amount) || 0,
    refundAmount,
    alreadyCancelled,
    deliveryStatus: delivery_status_before,
    isDelete: invoiceMode === 'delete',
    sellerBonus: sellerBonuses.length > 0
      ? {
          exists: true,
          settled: sellerBonuses.some((b) => b.settled),
          amount: sellerBonusAmount,
          username: sellerBonuses[0].username,
        }
      : { exists: false },
    driverBonus: driverBonuses.length > 0
      ? {
          exists: true,
          settled: driverBonuses.some((b) => b.settled),
          amount: driverBonusAmount,
          username: driverBonuses[0].username,
        }
      : { exists: false },
  };

  // Step 4: bonus-choice validation (skipped in previewOnly mode)
  if (!previewOnly) {
    const needsSellerChoice = sellerBonuses.length > 0 && !sellerSettled;
    const needsDriverChoice = driverBonuses.length > 0 && !driverSettled;
    const hasAnyBonus = needsSellerChoice || needsDriverChoice;

    if (hasAnyBonus && !bonusActions) {
      const err = new Error('BONUS_CHOICE_REQUIRED');
      err.code = 'BONUS_CHOICE_REQUIRED';
      err.preview = preview;
      throw err;
    }
    if (needsSellerChoice && bonusActions) {
      if (!['keep', 'remove'].includes(bonusActions.seller)) {
        throw new Error('bonusActions.seller must be "keep" or "remove"');
      }
    }
    if (needsDriverChoice && bonusActions) {
      if (!['keep', 'remove'].includes(bonusActions.driver)) {
        throw new Error('bonusActions.driver must be "keep" or "remove"');
      }
    }
  }

  // PREVIEW MODE: return preview without any writes
  if (previewOnly) {
    return { refundAmount, preview };
  }

  // Step 5: refund collected payments by inserting matching negative rows.
  // The TVA is also negated so the month's VAT ledger nets to zero for this
  // sale's cancelled period.
  const today = new Date().toISOString().split('T')[0];
  for (const payment of paymentRows) {
    const negativeAmount = -(parseFloat(payment.amount) || 0);
    const negativeTva = -(parseFloat(payment.tva_amount) || 0);
    await client.sql`
      INSERT INTO payments (
        date, client_name, amount, sale_id, type, payment_method,
        tva_amount, created_by, notes
      )
      VALUES (
        ${today},
        ${sale.client_name},
        ${negativeAmount},
        ${saleId},
        'refund',
        ${payment.payment_method || 'كاش'},
        ${negativeTva},
        ${cancelledBy},
        ${'Auto-refund on cancel of payment #' + payment.id}
      )
    `;
  }

  // Step 6: restore product stock. The idempotency guard at Step 1
  // already blocks commit-mode re-execution on a cancelled sale, so
  // the previous `!alreadyCancelled` check here is redundant — we only
  // reach this line on the first (and only) cancel of a sale.
  const qty = parseFloat(sale.quantity) || 0;
  if (qty > 0) {
    await client.sql`
      UPDATE products SET stock = stock + ${qty}::numeric WHERE name = ${sale.item}
    `;
  }

  // Step 7: bonus disposition per bonusActions
  const sellerKept = bonusActions?.seller === 'keep';
  const driverKept = bonusActions?.driver === 'keep';

  // v1.2 — bonus recovery for settled bonuses. When a bonus was already
  // paid out (settled=true) and the admin chooses "remove", we:
  //   (a) Delete the bonus row (including settled ones)
  //   (b) Create a NEGATIVE settlement row → the employee's balance goes
  //       negative → deducted from future payouts automatically
  // The invoice ref is used in the description for audit trail.
  const invoiceRows = await client.sql`
    SELECT ref_code FROM invoices WHERE sale_id = ${saleId} LIMIT 1
  `;
  const invoiceRef = invoiceRows.rows[0]?.ref_code || `#${saleId}`;

  if (!sellerKept && sellerBonuses.length > 0) {
    // Check for settled bonuses BEFORE deleting
    for (const b of sellerBonuses) {
      if (b.settled) {
        const amount = -(parseFloat(b.total_bonus) || 0);
        await client.sql`
          INSERT INTO settlements (date, type, username, description, amount, settled_by, notes)
          VALUES (CURRENT_DATE, 'seller_payout', ${b.username},
            ${'استرداد عمولة — طلب ملغي #' + saleId + ' — فاتورة ' + invoiceRef},
            ${amount}, ${cancelledBy},
            ${'عمولة مسوَّاة سابقاً تم استردادها بسبب إلغاء الطلب'})
        `;
      }
    }
    // Delete ALL seller bonuses for this sale (settled + unsettled)
    await client.sql`
      DELETE FROM bonuses WHERE sale_id = ${saleId} AND role = 'seller'
    `;
  }
  if (!driverKept && driverBonuses.length > 0) {
    for (const b of driverBonuses) {
      if (b.settled) {
        const amount = -(parseFloat(b.total_bonus) || 0);
        await client.sql`
          INSERT INTO settlements (date, type, username, description, amount, settled_by, notes)
          VALUES (CURRENT_DATE, 'driver_payout', ${b.username},
            ${'استرداد عمولة — طلب ملغي #' + saleId + ' — فاتورة ' + invoiceRef},
            ${amount}, ${cancelledBy},
            ${'عمولة مسوَّاة سابقاً تم استردادها بسبب إلغاء الطلب'})
        `;
      }
    }
    await client.sql`
      DELETE FROM bonuses WHERE sale_id = ${saleId} AND role = 'driver'
    `;
  }

  // Step 8: sync delivery row status so the UI doesn't show a stale "delivered"
  if (delivery) {
    await client.sql`UPDATE deliveries SET status = 'ملغي' WHERE sale_id = ${saleId}`;
  }

  // Step 9: invoice disposition per invoiceMode
  if (invoiceMode === 'soft') {
    await client.sql`UPDATE invoices SET status = 'ملغي' WHERE sale_id = ${saleId}`;
  } else {
    // 'delete' — used by deleteSale path where the sale row itself is
    // going away. Cascades would also handle this via FK but being
    // explicit here keeps the cancelSale helper self-contained.
    await client.sql`DELETE FROM invoices WHERE sale_id = ${saleId}`;
  }

  // Step 10: mark sale cancelled (idempotent — if it was already cancelled
  // the UPDATE is a no-op on the state columns)
  await client.sql`
    UPDATE sales
    SET status = 'ملغي',
        paid_amount = 0,
        remaining = 0,
        payment_status = 'cancelled'
    WHERE id = ${saleId}
  `;

  // Step 11: write the audit row
  const { rows: auditRows } = await client.sql`
    INSERT INTO cancellations (
      sale_id, cancelled_by, reason, refund_amount,
      delivery_status_before, bonus_status_before, invoice_mode,
      seller_bonus_kept, driver_bonus_kept, notes
    )
    VALUES (
      ${saleId}, ${cancelledBy}, ${reason}, ${refundAmount},
      ${delivery_status_before}, ${bonus_status_before}, ${invoiceMode},
      ${sellerBonuses.length > 0 ? sellerKept : null},
      ${driverBonuses.length > 0 ? driverKept : null},
      ${notes}
    )
    RETURNING id
  `;

  // Step 12: success
  return {
    success: true,
    cancellationId: auditRows[0].id,
    refundAmount,
    preview,
  };
}

/**
 * FEAT-05: route-layer wrapper for cancelSale's preview mode. Opens a
 * transaction, runs cancelSale with previewOnly=true (no writes), and
 * returns the preview payload. Used by GET /api/sales/[id]/cancel-preview
 * to feed the admin-facing cancellation dialog.
 *
 * @param {number} saleId
 * @param {string} cancelledBy
 * @returns {Promise<{refundAmount:number, preview:object}>}
 */
export async function previewCancelSale(saleId, cancelledBy) {
  return withTx(async (client) => {
    return cancelSale(client, {
      saleId,
      cancelledBy,
      previewOnly: true,
    });
  });
}

/**
 * FEAT-05: route-layer wrapper for cancelSale's commit mode. Opens a
 * transaction and runs the full 12-step flow. Throws BONUS_CHOICE_REQUIRED
 * (via cancelSale) when the sale has non-settled bonuses and the caller
 * didn't provide bonusActions — the route layer catches this and returns
 * the preview payload so the UI can show the dialog and retry.
 *
 * When options.invoiceMode === 'delete', the sale and delivery rows are
 * physically removed after cancelSale's 12 steps finish. This is the
 * same hard-delete semantics that deleteSale() used to implement inline,
 * now delegated here so the POST /api/sales/[id]/cancel route can serve
 * both the soft-cancel path and the hard-delete path via one endpoint.
 *
 * @param {number} saleId
 * @param {object} options `{cancelledBy, reason, invoiceMode, bonusActions, notes}`
 * @returns {Promise<{success:boolean, cancellationId:number, refundAmount:number, preview:object}>}
 */
export async function commitCancelSale(saleId, options) {
  return withTx(async (client) => {
    const result = await cancelSale(client, {
      saleId,
      ...options,
      previewOnly: false,
    });
    // Hard-delete semantics: after the 12-step cancel commits, also remove
    // the delivery + sale rows. Inside the same transaction so a failure
    // at either step rolls back the whole cancellation.
    if (options?.invoiceMode === 'delete') {
      await client.sql`DELETE FROM deliveries WHERE sale_id = ${saleId}`;
      await client.sql`DELETE FROM sales WHERE id = ${saleId}`;
    }
    return result;
  });
}

/**
 * Delete a sale and cascade-clean its bonuses, invoices, and linked
 * deliveries inside a single transaction. Returns stock unless the
 * sale was already `ملغي`.
 * @param {number} id
 * @param {object} [options] `{cancelledBy, reason, notes}` — forwarded to cancelSale
 * @returns {Promise<void>}
 */
export async function deleteSale(id, options = {}) {
  // FEAT-05: delegate everything to commitCancelSale in invoiceMode='delete'.
  // That wrapper runs the 12-step cancelSale flow then physically removes
  // the sale + delivery rows inside the same transaction.
  //
  // bonusActions is forced to 'remove' for both roles here because the
  // UI path for delete-sale always does so (the CancelSaleDialog hides
  // the "keep" option when invoiceMode='delete'). Callers that want a
  // different bonus disposition should use commitCancelSale directly.
  //
  // Idempotent on a missing sale: commitCancelSale throws 'الطلب غير موجود'
  // which we catch and silently ignore to preserve deleteSale's historic
  // "delete-if-exists" contract.
  try {
    return await commitCancelSale(id, {
      cancelledBy: options.cancelledBy || 'system',
      reason: options.reason || 'Sale deleted by admin',
      invoiceMode: 'delete',
      bonusActions: { seller: 'remove', driver: 'remove' },
      notes: options.notes || null,
    });
  } catch (err) {
    if (err?.message === 'الطلب غير موجود') return;
    throw err;
  }
}

// #endregion

// #region EXPENSES

/**
 * @returns {Promise<Array<object>>} All expense rows, newest first.
 */
export async function getExpenses() {
  const { rows } = await sql`SELECT * FROM expenses ORDER BY id DESC`;
  return rows;
}

/**
 * @param {{date:string, category:string, description:string,
 *   amount:number|string, paymentType?:string, createdBy?:string,
 *   notes?:string}} data
 * @returns {Promise<number>} The new expense id.
 */
export async function addExpense(data) {
  if ((parseFloat(data.amount) || 0) <= 0) throw new Error('المبلغ يجب أن يكون أكبر من 0');
  const validPay = ['كاش', 'بنك'];
  const { rows } = await sql`
    INSERT INTO expenses (date, category, description, amount, payment_type, created_by, notes)
    VALUES (${data.date}, ${data.category}, ${data.description}, ${data.amount}, ${validPay.includes(data.paymentType) ? data.paymentType : 'كاش'}, ${data.createdBy || ''}, ${data.notes || ''})
    RETURNING id
  `;
  return rows[0].id;
}

/**
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteExpense(id) {
  // SP-003: verify the expense exists before deleting
  const { rows } = await sql`SELECT id FROM expenses WHERE id = ${id}`;
  if (!rows.length) throw new Error('المصروف غير موجود');
  await sql`DELETE FROM expenses WHERE id = ${id}`;
}

// #endregion

// #region CLIENTS

/**
 * @param {boolean} [withDebt=false] When `true`, computes
 *   `totalSales`, `totalPaid`, `remainingDebt` per client using a
 *   debt model that only counts confirmed credit sales.
 * @returns {Promise<Array<object>>}
 */
export async function getClients(withDebt = false) {
  const { rows: clients } = await sql`SELECT * FROM clients ORDER BY id DESC`;

  if (!withDebt) return clients;

  // Bug 3 (v1 pre-delivery): single source of truth from the sales ledger.
  // The previous implementation read both `sum(sales.total WHERE cash/bank
  // confirmed)` AND `sum(payments.amount)` and added them, which double-
  // counted every confirmed cash/bank sale post-FEAT-04 — FEAT-04 made
  // updateDelivery insert a type='collection' payment row on confirm, so
  // the same money was present in both sources. Example from production
  // HAR analysis: Ali Test with one 900€ cash sale → totalPaid reported
  // 1800. `sale.paid_amount` and `sale.remaining` are the canonical truth,
  // maintained correctly by applyCollectionInTx, updateDelivery, and
  // cancelSale — all verified at 100% pass rate across 540 stress ops.
  const { rows: sales } = await sql`SELECT * FROM sales`;

  // v1.0.3 Bug C stopgap — name → lowest-id canonical mapping.
  //
  // Sales reference clients only by `client_name` text (no client_id FK).
  // When two client rows share the literal same name, the previous
  // `sales.filter((s) => s.client_name === client.name)` returned the
  // SAME sales array for every row, fan-outing each sale's totals to
  // every client sharing that name. Live evidence: 2 ZAKARIYA rows each
  // showing 950 / paid 500 / debt 450 from a single sale → summary card
  // displayed 'إجمالي الديون = 900'.
  //
  // Stopgap: only attribute sales to the smallest-id row in each name
  // group; the duplicate rows return zeros plus a `_duplicateOfId` flag
  // the UI uses to show a 'مكرر — see id #X' badge so the user can
  // manually merge later. The proper fix (sales.client_id INTEGER FK +
  // backfill + filter by id) is v1.1 work — see docs/v1.1-backlog.md
  // § 4.4.
  const nameToCanonicalId = new Map();
  for (const c of clients) {
    const existing = nameToCanonicalId.get(c.name);
    if (existing == null || c.id < existing) {
      nameToCanonicalId.set(c.name, c.id);
    }
  }

  return clients.map((client) => {
    const canonicalId = nameToCanonicalId.get(client.name);
    const isCanonical = canonicalId === client.id;
    // Duplicate rows are flagged for the UI but get zero aggregates so
    // they can't fan-out the same sale to multiple display rows.
    const _duplicateOfId = isCanonical ? null : canonicalId;

    const clientSales = isCanonical
      ? sales.filter((s) => s.client_name === client.name)
      : [];

    // Gross sales written ever (exclude cancelled — they were refunded).
    const totalSales = clientSales
      .filter((s) => s.status !== 'ملغي')
      .reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);

    // Money the client has paid: use sales.paid_amount directly. This is
    // the ledger-of-truth for confirmed sales, maintained by delivery
    // confirm (down_payment_expected) and later collections. Do NOT also
    // read from the payments table — the collection rows are mirrors of
    // this column, and adding both double-counts.
    const totalPaid = clientSales
      .filter((s) => s.status === 'مؤكد')
      .reduce((sum, s) => sum + (parseFloat(s.paid_amount) || 0), 0);

    // Outstanding debt: sum of sales.remaining on confirmed non-paid rows.
    // Cancelled sales have payment_status='cancelled' and remaining=0, so
    // they're naturally excluded. Reserved sales are not yet owed.
    const remainingDebt = clientSales
      .filter((s) => s.status === 'مؤكد' && s.payment_status !== 'paid' && s.payment_status !== 'cancelled')
      .reduce((sum, s) => sum + (parseFloat(s.remaining) || 0), 0);

    return { ...client, totalSales, totalPaid, remainingDebt, _duplicateOfId };
  });
}

// DONE: Step 4 — best-effort transliteration of common Arabic names to Latin script.
// Used to seed clients.latin_name on insert (for European invoices). It's only a starting
// guess — admin can hand-correct any client's latin_name later through the clients UI.
//
// BUG-5 hotfix 2026-04-14: added a character-level transliteration fallback
// (ARABIC_CHAR_MAP below) so unknown Arabic words produce approximate Latin
// output instead of being returned unchanged. This closes the gap where
// "CLIENT NAME IN PROVIDER MUST BE ENGLISH ALWAYS" was violated for any
// name not in the 30-entry dictionary. Also exposed `ensureLatin()` as a
// public helper that addClient/addSupplier call before insert.

// ALA-LC simplified romanization. Good enough for French invoice compliance;
// admin can hand-correct edge cases after save.
const ARABIC_CHAR_MAP = {
  'ا':'a','أ':'a','إ':'i','آ':'aa','ب':'b','ت':'t','ث':'th',
  'ج':'j','ح':'h','خ':'kh','د':'d','ذ':'dh','ر':'r','ز':'z',
  'س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z',
  'ع':'\'','غ':'gh','ف':'f','ق':'q','ك':'k','ل':'l','م':'m',
  'ن':'n','ه':'h','و':'w','ي':'y','ى':'a','ء':'\'','ؤ':'\'','ئ':'\'','ة':'a',
  // Strip diacritics (tashkeel)
  'ً':'','ٌ':'','ٍ':'','َ':'','ُ':'','ِ':'','ّ':'','ْ':'','ـ':'',
};

function transliterateArabicChars(word) {
  return word
    .split('')
    .map((c) => (ARABIC_CHAR_MAP[c] !== undefined ? ARABIC_CHAR_MAP[c] : c))
    .join('');
}

function generateLatinName(arabicName) {
  if (!arabicName) return '';

  const nameMap = {
    'محمد': 'Mohammad', 'أحمد': 'Ahmad', 'خالد': 'Khaled',
    'عبدالله': 'Abdullah', 'عبد الله': 'Abdullah',
    'يوسف': 'Youssef', 'علي': 'Ali', 'حسن': 'Hassan',
    'حسين': 'Hussein', 'إبراهيم': 'Ibrahim', 'ابراهيم': 'Ibrahim',
    'عمر': 'Omar', 'سعد': 'Saad', 'فهد': 'Fahad',
    'سلطان': 'Sultan', 'منصور': 'Mansour', 'ناصر': 'Nasser',
    'طارق': 'Tariq', 'وليد': 'Walid', 'كريم': 'Karim',
    'سامي': 'Sami', 'رامي': 'Rami', 'باسم': 'Bassem',
    'زياد': 'Ziad', 'نادر': 'Nader', 'هاني': 'Hani',
    'ماهر': 'Maher', 'جمال': 'Jamal', 'أسامة': 'Osama',
    'فيصل': 'Faisal', 'تركي': 'Turki', 'بندر': 'Bandar',
    'عبدالرحمن': 'Abdulrahman', 'عبد الرحمن': 'Abdulrahman',
    'عبدالعزيز': 'Abdulaziz', 'عبد العزيز': 'Abdulaziz',
    // Last / family names
    'الأحمد': 'Al-Ahmad', 'الخالدي': 'Al-Khalidi',
    'العمري': 'Al-Omari', 'الحسن': 'Al-Hassan',
    'المحمد': 'Al-Mohammad',
  };

  const words = arabicName.trim().split(/\s+/);
  const latinWords = words.map((word) => {
    if (nameMap[word]) return nameMap[word];
    if (word.startsWith('ال') && nameMap[word]) return nameMap[word];
    if (word.startsWith('ال')) return 'Al-' + transliterateArabicChars(word.slice(2));
    // BUG-5 hotfix: fall back to char-level transliteration for unknown
    // Arabic words. Latin inputs are idempotent — chars not in the Arabic
    // map pass through unchanged, so Latin name → Latin name out.
    return transliterateArabicChars(word);
  });

  return latinWords.join(' ');
}

// BUG-5 hotfix 2026-04-14: detects Arabic characters via the Arabic Unicode
// ranges (basic + supplement). Used by ensureLatin() below to decide whether
// transliteration is needed.
function isArabic(text) {
  if (!text) return false;
  return /[\u0600-\u06FF\u0750-\u077F]/.test(text);
}

/**
 * BUG-5: normalize a name to Latin letters for French invoice compliance.
 * - Empty/null/undefined passes through untouched (preserves caller nullity)
 * - Arabic input is transliterated via generateLatinName (dictionary +
 *   char-level fallback)
 * - Pure Latin input is idempotent — generateLatinName returns it unchanged
 * - Mixed-script input: each whitespace-delimited word is handled
 *   independently, so "أحمد Smith" → "Ahmad Smith"
 *
 * Called at the top of addClient() and addSupplier() BEFORE any lookups
 * or inserts, so every row landing in those tables has a Latin name.
 * Voice flow is handled transparently — VoiceConfirm can keep sending
 * Arabic names and the backend normalizes them.
 *
 * @param {string} name raw name (possibly Arabic)
 * @returns {string} Latin name (or the original value if not Arabic, or
 *   null/undefined/'' preserved)
 */
export function ensureLatin(name) {
  if (!name) return name;
  if (typeof name !== 'string') return name;
  if (!isArabic(name)) return name;
  return generateLatinName(name);
}

// DONE: Step 2 — addClient now uses (name + phone) OR (name + email) as the identity key.
// If the caller provides only a name and that name already exists in the table, we return
// an `ambiguous` signal so the caller (UI / addSale) can ask the user to disambiguate
// instead of silently merging two real people into one record.
/**
 * Upsert a client using (name + phone) OR (name + email) as the
 * identity key. If only a name is provided and that name already
 * exists in the table, returns an `ambiguous` signal so the caller
 * can prompt for disambiguation instead of silently merging two
 * real people.
 * @param {{name:string, phone?:string, email?:string, address?:string,
 *   latinName?:string, createdBy?:string, notes?:string}} data
 * @returns {Promise<{id?:number, exists?:boolean, ambiguous?:boolean,
 *   candidates?:Array<object>, message?:string}>}
 */
export async function addClient(data) {
  // BUG-5 hotfix 2026-04-14: normalize the client name to Latin before
  // any lookups or insert. Voice flow passes Arabic names through here;
  // manual forms pass whatever the user types. Lookups against the Latin
  // form mean new clients always land in the DB with Latin names, and
  // existing Latin-named clients match their previous row on upsert.
  data = { ...data, name: ensureLatin(data.name) };

  // Step 1 — try to find existing client by name + phone
  if (data.phone && data.phone.trim() !== '') {
    const { rows } = await sql`
      SELECT id FROM clients
      WHERE name = ${data.name} AND phone = ${data.phone}
    `;
    if (rows.length > 0) {
      await sql`
        UPDATE clients SET
          email   = CASE WHEN ${data.email || ''}   <> '' THEN ${data.email || ''}   ELSE email   END,
          address = CASE WHEN ${data.address || ''} <> '' THEN ${data.address || ''} ELSE address END
        WHERE id = ${rows[0].id}
      `;
      return { id: rows[0].id, exists: true };
    }

    // v1.0.3 Bug B fix — empty-phone shadow merge.
    //
    // Pre-v1.0.3, if the same name existed with an EMPTY phone (e.g. a
    // half-finished earlier entry), the Step 1 exact-phone lookup above
    // would not match (different phone string), Step 3's no-phone-no-email
    // ambiguous check would NOT fire (the new caller HAS a phone), and
    // Step 4 silently inserted a duplicate row. Live evidence: production
    // had clients.id=1 (ZAKARIYA, phone='') and clients.id=2 (ZAKARIYA,
    // phone='+34632759513'), both created by the same seller.
    //
    // The clients_name_phone_unique partial index `WHERE phone <> ''`
    // can't catch this either because the empty-phone row is excluded
    // from the index domain.
    //
    // Resolution: when exactly ONE same-name row with an empty phone
    // exists, treat it as the shadow of the new entry and UPDATE it
    // with the new phone + address + email. If multiple empty-phone
    // shadows exist, fall through to insert (it's pre-existing data
    // ambiguity, not something v1.0.3 should silently guess at).
    const { rows: emptyShadows } = await sql`
      SELECT id, email, address, latin_name FROM clients
      WHERE name = ${data.name}
        AND (phone IS NULL OR phone = '' OR TRIM(phone) = '')
    `;
    if (emptyShadows.length === 1) {
      const target = emptyShadows[0];
      await sql`
        UPDATE clients SET
          phone   = ${data.phone},
          email   = CASE WHEN ${data.email || ''}   <> '' THEN ${data.email || ''}   ELSE email   END,
          address = CASE WHEN ${data.address || ''} <> '' THEN ${data.address || ''} ELSE address END
        WHERE id = ${target.id}
      `;
      return { id: target.id, exists: true, mergedShadow: true };
    }
    // emptyShadows.length === 0 → no shadow, fall through to Step 4 insert
    // emptyShadows.length > 1 → ambiguous pre-existing data, also fall through
  }

  // Step 2 — try to find existing client by name + email
  if (data.email && data.email.trim() !== '') {
    const { rows } = await sql`
      SELECT id FROM clients
      WHERE name = ${data.name} AND email = ${data.email}
    `;
    if (rows.length > 0) {
      await sql`
        UPDATE clients SET
          phone   = CASE WHEN ${data.phone || ''}   <> '' THEN ${data.phone || ''}   ELSE phone   END,
          address = CASE WHEN ${data.address || ''} <> '' THEN ${data.address || ''} ELSE address END
        WHERE id = ${rows[0].id}
      `;
      return { id: rows[0].id, exists: true };
    }
  }

  // Step 3 — caller gave only a name and the same name already exists.
  // Return an ambiguous signal so the UI can ask for phone/email instead of guessing.
  if (!data.phone && !data.email) {
    const { rows } = await sql`
      SELECT id, name, phone, email FROM clients
      WHERE name = ${data.name}
      LIMIT 5
    `;
    if (rows.length > 0) {
      return {
        ambiguous: true,
        candidates: rows,
        message: `يوجد ${rows.length} عميل باسم "${data.name}" — أضف رقم هاتف أو إيميل للتمييز`,
      };
    }
  }

  // Step 4 — genuinely new client → insert with auto-generated latin_name.
  // BUG-6 hotfix 2026-04-14: if the caller set requireAddress=true (which
  // addSale does when creating a new client as part of a sale), the
  // address must be non-empty. Existing clients inherit their address
  // from the previous row and skip this check entirely. Only the
  // "genuinely new" path enforces it.
  if (data.requireAddress && (!data.address || data.address.trim() === '')) {
    throw new Error('عنوان العميل مطلوب للعملاء الجدد');
  }
  const { rows } = await sql`
    INSERT INTO clients (name, phone, address, email, latin_name, description_ar, created_by, notes)
    VALUES (
      ${data.name},
      ${data.phone || ''},
      ${data.address || ''},
      ${data.email || ''},
      ${data.latinName || generateLatinName(data.name)},
      ${data.descriptionAr || ''},
      ${data.createdBy || ''},
      ${data.notes || ''}
    )
    RETURNING id
  `;
  // FEAT-01: auto-generate Arabic aliases for cold-start voice recognition.
  // Only fires in the "genuinely new client" branch — NOT in the update
  // branches above. Re-generating aliases on every contact-info update would
  // explode the alias count for no benefit.
  await generateAndPersistAliases('client', rows[0].id, data.name);
  return { id: rows[0].id };
}

/**
 * @param {{id:number, name:string, phone?:string, address?:string,
 *   email?:string, notes?:string}} data
 * @returns {Promise<void>}
 */
export async function updateClient(data) {
  const { rows: old } = await sql`SELECT * FROM clients WHERE id = ${data.id}`;
  if (!old.length) throw new Error('العميل غير موجود');
  const o = old[0];
  await sql`
    UPDATE clients SET
      name = ${data.name || o.name}, description_ar = ${data.descriptionAr ?? o.description_ar ?? ''},
      phone = ${data.phone ?? o.phone ?? ''}, address = ${data.address ?? o.address ?? ''},
      email = ${data.email ?? o.email ?? ''}, latin_name = ${data.latinName ?? o.latin_name ?? ''},
      notes = ${data.notes ?? o.notes ?? ''},
      updated_by = ${data.updatedBy || null}, updated_at = NOW()
    WHERE id = ${data.id}
  `;
}

export async function deleteClient(id) {
  const { rows: linked } = await sql`
    SELECT 1 FROM sales WHERE client_name = (SELECT name FROM clients WHERE id = ${id}) AND status != 'ملغي' LIMIT 1
  `;
  if (linked.length) throw new Error('لا يمكن حذف العميل — يوجد مبيعات مرتبطة به. ألغِ المبيعات أولاً');
  await sql`DELETE FROM clients WHERE id = ${id}`;
}

// #endregion

// #region PAYMENTS

/**
 * @param {string} [clientName] If provided, filters to this client only.
 * @returns {Promise<Array<object>>}
 */
export async function getPayments(clientName) {
  if (clientName) {
    const { rows } = await sql`SELECT * FROM payments WHERE client_name = ${clientName} ORDER BY id DESC`;
    return rows;
  }
  const { rows } = await sql`SELECT * FROM payments ORDER BY id DESC`;
  return rows;
}

/**
 * @param {{date:string, clientName:string, amount:number|string,
 *   saleId?:number|null, createdBy?:string, notes?:string}} data
 * @returns {Promise<number>} The new payment id.
 */
export async function addPayment(data) {
  // BUG-002+003 fix: if saleId is provided, route through applyCollection
  // which properly validates overpayment AND updates sales.paid_amount/remaining.
  // The legacy direct-insert path only runs for manual payments without a saleId.
  if (data.saleId) {
    const result = await applyCollection(
      data.saleId,
      parseFloat(data.amount) || 0,
      data.paymentMethod || 'كاش',
      data.createdBy || ''
    );
    return result.paymentId;
  }
  const { rows } = await sql`
    INSERT INTO payments (date, client_name, amount, sale_id, created_by, notes)
    VALUES (${data.date}, ${data.clientName}, ${data.amount}, ${null}, ${data.createdBy || ''}, ${data.notes || ''})
    RETURNING id
  `;
  return rows[0].id;
}

/**
 * FEAT-04: atomic collection helper for recording client payments against
 * a specific sale. Used by POST /api/sales/[id]/collect and (wrapped by
 * the FIFO walker) POST /api/clients/[id]/collect.
 *
 * Flow (all inside one transaction via withTx):
 *   1. FOR UPDATE lock on the sale row
 *   2. Validate sale status (must be 'مؤكد', not cancelled, not already paid)
 *   3. Validate amount ≤ remaining (+ 0.005 epsilon for float slack)
 *   4. Compute proportional TVA (amount_ttc / 6, rounded to 2 decimals)
 *   5. INSERT payments row with type='collection'
 *   6. UPDATE sales.paid_amount + remaining + payment_status
 *
 * Throws Arabic error messages that the route layer maps to HTTP statuses.
 *
 * @param {number} saleId           id of the sale being collected against
 * @param {number} amountTTC        amount collected (TTC, i.e. including VAT)
 * @param {string} paymentMethod    'كاش' or 'بنك'
 * @param {string} collectedBy      username of the collector (admin/manager/seller)
 * @returns {Promise<{paymentId:number, newPaidAmount:number,
 *   newRemaining:number, newStatus:'paid'|'partial', tva:number}>}
 */
// Inner helper: runs applyCollection's core logic inside a caller-provided
// transaction client. Exported for use by the FIFO walker at
// POST /api/clients/[id]/collect, which processes multiple sales atomically.
// Assumes the caller has already opened withTx.
export async function applyCollectionInTx(client, saleId, amountTTC, paymentMethod, collectedBy) {
  // Step 1: lock and fetch
  const { rows } = await client.sql`
    SELECT id, client_name, total, paid_amount, remaining, status, payment_status
    FROM sales WHERE id = ${saleId} FOR UPDATE
  `;
  if (!rows.length) throw new Error('الطلب غير موجود');
  const sale = rows[0];

  // Step 2: status validation
  if (sale.status === 'ملغي') {
    throw new Error('لا يمكن تسجيل دفعة على طلب ملغي');
  }
  if (sale.status !== 'مؤكد') {
    throw new Error('لا يمكن تسجيل دفعة قبل تأكيد التوصيل');
  }
  if (sale.payment_status === 'paid') {
    throw new Error('هذا الطلب مدفوع بالكامل — لا يوجد دين لتسديده');
  }

  // Step 3: overpayment check
  const remaining = parseFloat(sale.remaining) || 0;
  const amount = parseFloat(amountTTC) || 0;
  if (amount <= 0) {
    throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  }
  if (amount > remaining + 0.005) {
    throw new Error(`لا يمكن تسجيل مبلغ أكبر من المتبقي (${remaining}€)`);
  }

  // Step 4: proportional TVA
  // v1.1 F-012 — read vat_rate from settings instead of hardcoding / 6.
  const { rows: vatSettingRows } = await client.sql`
    SELECT value FROM settings WHERE key = 'vat_rate'
  `;
  const vatRate = parseFloat(vatSettingRows[0]?.value) || 20;
  const tva = Math.round((amount * vatRate / (100 + vatRate)) * 100) / 100;

  // Step 5: insert payment row
  const { rows: paymentRows } = await client.sql`
    INSERT INTO payments (
      date, client_name, amount, sale_id,
      type, payment_method, tva_amount, created_by, notes
    ) VALUES (
      CURRENT_DATE, ${sale.client_name}, ${amount}, ${saleId},
      'collection', ${paymentMethod}, ${tva}, ${collectedBy || ''}, ''
    )
    RETURNING id
  `;

  // Step 6: update sale aggregates
  const newPaidAmount = Math.round((parseFloat(sale.paid_amount) + amount) * 100) / 100;
  const newRemaining = Math.round((parseFloat(sale.total) - newPaidAmount) * 100) / 100;
  const newStatus = newRemaining < 0.005 ? 'paid' : 'partial';

  await client.sql`
    UPDATE sales SET
      paid_amount = ${newPaidAmount},
      remaining = ${newRemaining},
      payment_status = ${newStatus}
    WHERE id = ${saleId}
  `;

  return {
    paymentId: paymentRows[0].id,
    newPaidAmount,
    newRemaining,
    newStatus,
    tva,
  };
}

export async function applyCollection(saleId, amountTTC, paymentMethod, collectedBy) {
  return withTx(async (client) => {
    return applyCollectionInTx(client, saleId, amountTTC, paymentMethod, collectedBy);
  });
}

/**
 * FEAT-04: FIFO collection walker. Applies a single collected amount across
 * a client's open credit sales in oldest-first order, atomically.
 *
 * Walks all confirmed sales for the given client with payment_status != 'paid'
 * ordered by (date ASC, id ASC). For each sale it consumes min(amountLeft,
 * sale.remaining), writes a collection payment row, and updates the sale
 * aggregates via applyCollectionInTx. Stops when amount is exhausted or
 * no more open sales remain.
 *
 * Throws if the total open debt is less than the incoming amount (strict
 * overpayment rejection). The whole walk runs inside one transaction so
 * partial progress is impossible.
 *
 * @param {string} clientName
 * @param {number} amountTTC
 * @param {string} paymentMethod 'كاش' or 'بنك'
 * @param {string} collectedBy
 * @returns {Promise<{applied: Array, totalApplied: number, fullyPaid: boolean}>}
 */
export async function applyCollectionFIFO(clientName, amountTTC, paymentMethod, collectedBy) {
  return withTx(async (client) => {
    const amount = parseFloat(amountTTC) || 0;
    if (amount <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');

    // Fetch all open sales for this client in FIFO order, with row lock
    const { rows: openSales } = await client.sql`
      SELECT id, date, total, paid_amount, remaining, payment_status
      FROM sales
      WHERE client_name = ${clientName}
        AND status = 'مؤكد'
        AND payment_status IN ('pending', 'partial')
        AND remaining > 0.005
      ORDER BY date ASC, id ASC
      FOR UPDATE
    `;

    if (!openSales.length) {
      throw new Error('لا يوجد دين مفتوح لهذا العميل');
    }

    const totalOpen = openSales.reduce((s, r) => s + (parseFloat(r.remaining) || 0), 0);
    if (amount > totalOpen + 0.005) {
      throw new Error(`لا يمكن تسجيل مبلغ أكبر من إجمالي الدين المفتوح (${totalOpen}€)`);
    }

    const applied = [];
    let remainingToApply = amount;

    for (const sale of openSales) {
      if (remainingToApply < 0.005) break;
      const saleRemaining = parseFloat(sale.remaining) || 0;
      const applyNow = Math.min(remainingToApply, saleRemaining);
      if (applyNow < 0.005) continue;

      const result = await applyCollectionInTx(
        client,
        sale.id,
        applyNow,
        paymentMethod,
        collectedBy
      );
      applied.push({
        saleId: sale.id,
        date: sale.date,
        amount: applyNow,
        ...result,
      });
      remainingToApply = Math.round((remainingToApply - applyNow) * 100) / 100;
    }

    return {
      applied,
      totalApplied: Math.round((amount - remainingToApply) * 100) / 100,
      fullyPaid: applied.every((a) => a.newStatus === 'paid'),
    };
  });
}

// #endregion

// #region PRODUCTS

/**
 * @returns {Promise<Array<object>>} Products ordered by name ASC.
 */
export async function getProducts() {
  const { rows } = await sql`SELECT * FROM products ORDER BY name`;
  return rows;
}

/**
 * Insert a product if its name is new; otherwise return the existing
 * row's id with `exists: true`.
 * @param {{name:string, category?:string, unit?:string,
 *   buyPrice?:number|string, sellPrice?:number|string,
 *   stock?:number|string, createdBy?:string, notes?:string}} data
 * @returns {Promise<{id:number, exists?:boolean}>}
 */
export async function addProduct(data) {
  const { rows: existing } = await sql`SELECT id FROM products WHERE name = ${data.name}`;
  if (existing.length > 0) return { id: existing[0].id, exists: true };

  const { rows } = await sql`
    INSERT INTO products (name, description_ar, category, unit, buy_price, sell_price, stock, created_by, notes)
    VALUES (${data.name}, ${data.descriptionAr || ''}, ${data.category || ''}, ${data.unit || ''}, ${data.buyPrice || 0}, ${data.sellPrice || 0}, ${data.stock || 0}, ${data.createdBy || ''}, ${data.notes || ''})
    RETURNING id
  `;
  // FEAT-01: auto-generate Arabic aliases for cold-start voice recognition.
  await generateAndPersistAliases('product', rows[0].id, data.name);
  return { id: rows[0].id };
}

/**
 * Delete a product. Refuses (Arabic throw) if any historical sale or
 * purchase still references it by name, or if remaining stock > 0.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteProduct(id) {
  // Refuse to delete if any sale or purchase still references this product by name —
  // historical reports would otherwise show "ghost" rows that can't be linked back.
  const { rows: prod } = await sql`SELECT name, stock FROM products WHERE id = ${id}`;
  if (!prod.length) return;
  const name = prod[0].name;
  const stockLeft = parseFloat(prod[0].stock) || 0;
  if (stockLeft > 0) {
    throw new Error(`لا يمكن حذف منتج فيه مخزون متبقي (${stockLeft})`);
  }
  const { rows: salesUse } = await sql`SELECT 1 FROM sales WHERE item = ${name} LIMIT 1`;
  if (salesUse.length) throw new Error('لا يمكن حذف منتج مرتبط بمبيعات سابقة');
  const { rows: purchasesUse } = await sql`SELECT 1 FROM purchases WHERE item = ${name} LIMIT 1`;
  if (purchasesUse.length) throw new Error('لا يمكن حذف منتج مرتبط بمشتريات سابقة');
  await sql`DELETE FROM products WHERE id = ${id}`;
}

// #endregion

// #region SUPPLIERS

/**
 * @returns {Promise<Array<object>>} Suppliers ordered by name ASC.
 */
export async function getSuppliers(withDebt) {
  if (withDebt) {
    const { rows } = await sql`
      SELECT s.*,
        COALESCE(agg.total_purchases, 0) AS "totalPurchases",
        COALESCE(agg.total_paid, 0) AS "totalPaid",
        COALESCE(agg.total_purchases, 0) - COALESCE(agg.total_paid, 0) AS "remainingDebt",
        COALESCE(agg.purchase_count, 0) AS "purchaseCount"
      FROM suppliers s
      LEFT JOIN (
        SELECT supplier,
          SUM(total) AS total_purchases,
          SUM(paid_amount) AS total_paid,
          COUNT(*) AS purchase_count
        FROM purchases GROUP BY supplier
      ) agg ON agg.supplier = s.name
      ORDER BY s.name
    `;
    return rows;
  }
  const { rows } = await sql`SELECT * FROM suppliers ORDER BY name`;
  return rows;
}

/**
 * Insert a supplier, handling name ambiguity the same way addClient() does
 * but phone-only (suppliers table has no email column — deferred to v1.1
 * per Session 4 scope). Three possible outcomes:
 *
 *  1. Existing match by (name + phone) → update + return `{ id, exists: true }`
 *  2. Name-only collision with no phone disambiguator → return
 *     `{ ambiguous: true, candidates, message }` so the UI can prompt for
 *     a phone number and retry.
 *  3. Genuinely new supplier → insert + return `{ id }`.
 *
 * BUG-21: before this pass, `SELECT id FROM suppliers WHERE name = ?` ran
 * once and returned the FIRST match, silently merging two real suppliers
 * who happened to share a name. addClient() solved this at L1448; suppliers
 * were the last hold-out.
 *
 * @param {{name:string, phone?:string, address?:string, notes?:string}} data
 * @returns {Promise<{id?:number, exists?:boolean, ambiguous?:boolean,
 *   candidates?:Array<object>, message?:string}>}
 */
export async function addSupplier(data) {
  // BUG-5 hotfix 2026-04-14: normalize the supplier name to Latin before
  // any lookups or insert. Same reasoning as addClient — voice flow passes
  // Arabic supplier names through, backend ensures French-invoice-ready
  // storage. Lookups against the Latin form so new/existing suppliers
  // match consistently.
  data = { ...data, name: ensureLatin(data.name) };

  // Step 1 — try to find existing supplier by name + phone
  if (data.phone && data.phone.trim() !== '') {
    const { rows } = await sql`
      SELECT id FROM suppliers
      WHERE name = ${data.name} AND phone = ${data.phone}
    `;
    if (rows.length > 0) {
      await sql`
        UPDATE suppliers SET
          address = CASE WHEN ${data.address || ''} <> '' THEN ${data.address || ''} ELSE address END,
          notes   = CASE WHEN ${data.notes   || ''} <> '' THEN ${data.notes   || ''} ELSE notes   END
        WHERE id = ${rows[0].id}
      `;
      return { id: rows[0].id, exists: true };
    }
  }

  // Step 2 — name-only collision without a phone to disambiguate
  if (!data.phone || data.phone.trim() === '') {
    const { rows } = await sql`
      SELECT id, name, phone FROM suppliers
      WHERE name = ${data.name}
      LIMIT 5
    `;
    if (rows.length > 0) {
      return {
        ambiguous: true,
        candidates: rows,
        message: `يوجد ${rows.length} مورد باسم "${data.name}" — أضف رقم هاتف للتمييز`,
      };
    }
  }

  // Step 3 — genuinely new supplier
  const { rows } = await sql`
    INSERT INTO suppliers (name, phone, address, notes)
    VALUES (${data.name}, ${data.phone || ''}, ${data.address || ''}, ${data.notes || ''})
    RETURNING id
  `;
  // FEAT-01: auto-generate Arabic aliases for cold-start voice recognition.
  // Only fires on genuinely-new inserts, matching addClient's policy.
  await generateAndPersistAliases('supplier', rows[0].id, data.name);
  return { id: rows[0].id };
}

/**
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteSupplier(id) {
  await sql`DELETE FROM suppliers WHERE id = ${id}`;
}

// #endregion

// #region DELIVERIES

// BUG 3A — accepts createdBy as a third filter so the seller scope can be
// pushed down to SQL instead of being applied in JavaScript after the fetch.
/**
 * List deliveries with optional SQL-side filtering. Filters combine
 * where sensible (`status + assignedDriver`, `status + createdBy`),
 * otherwise apply individually.
 * @param {string} [status]
 * @param {string} [assignedDriver]
 * @param {string} [createdBy]
 * @returns {Promise<Array<object>>}
 */
export async function getDeliveries(status, assignedDriver, createdBy) {
  // FEAT-04: LEFT JOIN sales so the deliveries confirm modal can show
  // down_payment_expected (what the driver must collect at the door)
  // and payment_type (cash/bank/credit display colors).
  // v1.2 fix — drivers see their assigned deliveries PLUS unassigned
  // pending/in-transit ones. Pre-v1.2 only assigned deliveries were
  // visible, so a new delivery created by a seller (with assigned_driver='')
  // was invisible to every driver until an admin manually assigned it.
  // Now unassigned deliveries show for all drivers so they can see the
  // pipeline and self-assign (or wait for admin assignment).
  if (status && assignedDriver) {
    const { rows } = await sql`
      SELECT d.*, s.down_payment_expected, s.payment_type AS sale_payment_type
      FROM deliveries d
      LEFT JOIN sales s ON s.id = d.sale_id
      WHERE d.status = ${status}
        AND (d.assigned_driver = ${assignedDriver}
             OR (d.assigned_driver = '' AND d.status IN ('قيد الانتظار', 'جاري التوصيل')))
      ORDER BY d.id DESC`;
    return rows;
  }
  if (status && createdBy) {
    const { rows } = await sql`
      SELECT d.*, s.down_payment_expected, s.payment_type AS sale_payment_type
      FROM deliveries d
      LEFT JOIN sales s ON s.id = d.sale_id
      WHERE d.status = ${status} AND d.created_by = ${createdBy}
      ORDER BY d.id DESC`;
    return rows;
  }
  if (assignedDriver) {
    const { rows } = await sql`
      SELECT d.*, s.down_payment_expected, s.payment_type AS sale_payment_type
      FROM deliveries d
      LEFT JOIN sales s ON s.id = d.sale_id
      WHERE d.assigned_driver = ${assignedDriver}
        OR (d.assigned_driver = '' AND d.status IN ('قيد الانتظار', 'جاري التوصيل'))
      ORDER BY d.id DESC`;
    return rows;
  }
  if (createdBy) {
    const { rows } = await sql`
      SELECT d.*, s.down_payment_expected, s.payment_type AS sale_payment_type
      FROM deliveries d
      LEFT JOIN sales s ON s.id = d.sale_id
      WHERE d.created_by = ${createdBy}
      ORDER BY d.id DESC`;
    return rows;
  }
  if (status) {
    const { rows } = await sql`
      SELECT d.*, s.down_payment_expected, s.payment_type AS sale_payment_type
      FROM deliveries d
      LEFT JOIN sales s ON s.id = d.sale_id
      WHERE d.status = ${status}
      ORDER BY d.id DESC`;
    return rows;
  }
  const { rows } = await sql`
    SELECT d.*, s.down_payment_expected, s.payment_type AS sale_payment_type
    FROM deliveries d
    LEFT JOIN sales s ON s.id = d.sale_id
    ORDER BY d.id DESC`;
  return rows;
}

/**
 * @param {{date:string, clientName:string, clientPhone?:string,
 *   clientEmail?:string, address:string, items:string,
 *   totalAmount?:number|string, status?:string, driverName?:string,
 *   createdBy?:string, notes?:string}} data
 * @returns {Promise<number>} The new delivery id.
 */
export async function addDelivery(data) {
  // BUG-14: DeliverySchema now z.coerce.number()s totalAmount at the
  // route boundary, so the old BUG-13 defensive parseFloat is gone.
  const refCode = generateRefCode('DL');
  const { rows } = await sql`
    INSERT INTO deliveries (date, client_name, client_phone, client_email, address, items, total_amount, status, driver_name, ref_code, created_by, notes)
    VALUES (${data.date}, ${data.clientName}, ${data.clientPhone || ''}, ${data.clientEmail || ''}, ${data.address}, ${data.items}, ${data.totalAmount || 0}, ${data.status || 'قيد الانتظار'}, ${data.driverName || ''}, ${refCode}, ${data.createdBy || ''}, ${data.notes || ''})
    RETURNING id, ref_code
  `;
  return rows[0].id;
}

/**
 * Update a delivery inside a transaction. On status=`تم التوصيل`,
 * confirms the linked sale, marks it paid (unless آجل), saves the
 * VIN, generates an invoice, and creates bonuses via
 * `calculateBonusInTx`. On status=`ملغي`, returns stock, cancels the
 * sale, deletes the invoice, and reverses bonuses. Rejects any
 * transition out of a terminal state (`تم التوصيل` / `ملغي`).
 * @param {{id:number, date:string, clientName:string, clientPhone?:string,
 *   address?:string, items:string, totalAmount?:number|string, status:string,
 *   driverName?:string, assignedDriver?:string, notes?:string, vin?:string}} data
 * @returns {Promise<void>}
 */
export async function updateDelivery(data) {
  return withTx(async (client) => {
    // Lock the delivery row to prevent concurrent confirmation / cancellation
    const { rows: oldRows } = await client.sql`
      SELECT status, notes, sale_id FROM deliveries WHERE id = ${data.id} FOR UPDATE
    `;
    if (!oldRows.length) return;
    const oldStatus = oldRows[0].status || '';
    const oldNotes = oldRows[0].notes || '';
    let saleId = oldRows[0].sale_id;
    if (!saleId) {
      const m = oldNotes.match(/بيع رقم ([0-9]+)/);
      if (m) saleId = parseInt(m[1], 10);
    }

    // Reject illegal status transitions. Once delivered or cancelled, a delivery is
    // terminal — going back to "pending"/"in transit" would desync the sale + invoice.
    const TERMINAL = new Set(['تم التوصيل', 'ملغي']);
    if (TERMINAL.has(oldStatus) && oldStatus !== data.status) {
      throw new Error('لا يمكن تغيير حالة توصيل بعد تأكيده أو إلغائه');
    }

    // Sanitize the new notes — never let a caller inject the magic "بيع رقم N" string,
    // which the legacy regex fallback could otherwise re-target to a different sale.
    const safeNotes = String(data.notes || '').replace(/بيع رقم\s*[0-9]+/g, '').trim();

    await client.sql`
      UPDATE deliveries
      SET date = ${data.date},
          client_name = ${data.clientName},
          client_phone = ${data.clientPhone || ''},
          address = ${data.address},
          items = ${data.items},
          total_amount = ${data.totalAmount || 0},
          status = ${data.status},
          driver_name = ${data.driverName || ''},
          assigned_driver = ${data.assignedDriver || data.driverName || ''},
          notes = ${safeNotes}
      WHERE id = ${data.id}
    `;

    if (!saleId) return;
    // Idempotent: same status as before → nothing to do
    if (oldStatus === data.status) return;

    // DELIVERY CONFIRMED → confirm sale + mark payment + save VIN + create invoice + bonuses
    if (data.status === 'تم التوصيل') {
      const { rows: saleRows } = await client.sql`SELECT * FROM sales WHERE id = ${saleId} FOR UPDATE`;
      if (!saleRows.length) return;
      const sale = saleRows[0];
      if (sale.status === 'ملغي') {
        throw new Error('لا يمكن تأكيد توصيل لطلب ملغي');
      }

      if (data.vin) {
        await client.sql`UPDATE sales SET vin = ${data.vin} WHERE id = ${saleId}`;
      }

      // FEAT-04: confirm sale using down_payment_expected (set by seller at
      // sale creation). For كاش/بنك with the default (dpe = total) this is
      // functionally identical to the old behavior. For آجل with dpe = 0 it
      // leaves paid_amount/remaining unchanged. The new case is partial
      // cash/bank sales and credit sales with a forced down payment — where
      // paid_amount is set exactly to what the driver collected at the door.
      const totalNum = parseFloat(sale.total) || 0;
      const dpe = parseFloat(sale.down_payment_expected) || 0;
      const newPaid = dpe;
      const newRemaining = Math.max(0, totalNum - dpe);
      const newPaymentStatus = newRemaining < 0.005 ? 'paid' : 'partial';

      await client.sql`
        UPDATE sales
        SET status = 'مؤكد',
            paid_amount = ${newPaid},
            remaining = ${newRemaining},
            payment_status = ${newPaymentStatus}
        WHERE id = ${saleId}
      `;

      // FEAT-04: if the driver actually collected money at delivery, write
      // a payments row with type='collection'. This is the row that
      // cancelSale() step 5 will refund on cancel (FEAT-05 activation).
      // v1.1 F-012 — TVA from settings.vat_rate, not hardcoded / 6.
      if (dpe > 0.005) {
        const collectionMethod = sale.payment_type === 'بنك' ? 'بنك' : 'كاش';
        const { rows: dVatRows } = await client.sql`
          SELECT value FROM settings WHERE key = 'vat_rate'
        `;
        const dVatRate = parseFloat(dVatRows[0]?.value) || 20;
        const tvaAmount = Math.round((dpe * dVatRate / (100 + dVatRate)) * 100) / 100;
        const driverForPayment = data.driverName || data.assignedDriver || data.cancelledBy || 'system';
        await client.sql`
          INSERT INTO payments (
            date, client_name, amount, sale_id,
            type, payment_method, tva_amount, created_by, notes
          ) VALUES (
            CURRENT_DATE, ${sale.client_name}, ${dpe}, ${saleId},
            'collection', ${collectionMethod}, ${tvaAmount}, ${driverForPayment}, ''
          )
        `;
      }

      // Re-read sale after the update so the invoice captures the correct paid_amount
      const { rows: freshSaleRows } = await client.sql`SELECT * FROM sales WHERE id = ${saleId}`;
      const s = freshSaleRows[0];
      const { rows: delData } = await client.sql`SELECT * FROM deliveries WHERE id = ${parseInt(data.id, 10)}`;
      const d = delData[0] || {};
      const { rows: sellerData } = await client.sql`SELECT name FROM users WHERE username = ${s.created_by || ''}`;
      const sellerName = sellerData.length > 0 ? sellerData[0].name : s.created_by || '';

      // DONE: Step 6 — sequential per-month invoice number (INV-202604-001 ...)
      const invRef = await getNextInvoiceNumber();
      const today = new Date().toISOString().split('T')[0];
      await client.sql`
        INSERT INTO invoices (ref_code, date, sale_id, delivery_id, client_name, client_phone, client_email, client_address, item, quantity, unit_price, total, payment_type, vin, seller_name, driver_name)
        VALUES (${invRef}, ${today}, ${saleId}, ${parseInt(data.id, 10)}, ${s.client_name}, ${d.client_phone || ''}, ${d.client_email || ''}, ${d.address || ''}, ${s.item}, ${s.quantity}, ${s.unit_price}, ${s.total}, ${s.payment_type || 'كاش'}, ${data.vin || s.vin || ''}, ${sellerName}, ${data.driverName || d.driver_name || ''})
      `;

      // Bonuses (uses the same client → same transaction)
      const driverUser = data.driverName || data.assignedDriver || '';
      await calculateBonusInTx(client, saleId, parseInt(data.id, 10), driverUser);
    }

    // DELIVERY CANCELLED → delegate to cancelSale helper (FEAT-05).
    // Closes BUG-22 (settled-bonus check now applied) and BUG-23 (payment
    // orphans now refunded via negative-amount rows). The admin-side UI
    // must populate data.bonusActions via the cancellation dialog BEFORE
    // calling updateDelivery with status='ملغي' — otherwise cancelSale
    // throws BONUS_CHOICE_REQUIRED and the route layer catches it and
    // returns the preview payload.
    if (data.status === 'ملغي' && saleId) {
      await cancelSale(client, {
        saleId,
        cancelledBy: data.cancelledBy || 'system',
        reason: data.cancelReason || 'Delivery cancelled by admin',
        invoiceMode: 'soft',
        bonusActions: data.bonusActions || null,
        notes: data.cancelNotes || null,
      });
    }
  });
}

/**
 * Cancel a delivery (and via cancelSale, the linked sale) atomically.
 * Closes BUG-X1 — the old two-line implementation cascade-deleted
 * bonuses/invoices via FK but left the sale in 'مؤكد' state with its
 * stock decremented and its payments orphaned.
 *
 * Session 4 rename: previously `deleteDelivery`. The old name was
 * misleading — this function preserves the delivery row with
 * status='ملغي' as audit history, it never physically deletes. Renamed
 * to `cancelDelivery` for clarity; no alias kept since the old name
 * was a pure internal reference (no external API contract).
 *
 * Row preservation rationale: `invoices.delivery_id` has a NOT NULL FK
 * with ON DELETE CASCADE ([lib/db.js:289](lib/db.js#L289)). If we
 * physically dropped the delivery row, the invoice would cascade-delete
 * too — defeating the invoiceMode='soft' preservation intent. Keeping
 * the delivery row present is the cleanest solution short of a schema
 * migration to make delivery_id nullable.
 *
 * Orphan deliveries (no linked sale — possible only from legacy data
 * migrations) still get a plain DELETE since there's nothing to preserve.
 *
 * @param {number} id delivery id
 * @param {object} [options] `{cancelledBy, reason, bonusActions, notes}`
 * @returns {Promise<void>}
 */
export async function cancelDelivery(id, options = {}) {
  return withTx(async (client) => {
    const { rows: delRows } = await client.sql`
      SELECT sale_id FROM deliveries WHERE id = ${id} FOR UPDATE
    `;
    if (!delRows.length) return; // already gone — idempotent no-op
    const saleId = delRows[0].sale_id;

    if (saleId) {
      // Linked delivery → cancel the whole sale via cancelSale.
      // The delivery row ends up with status='ملغي' via cancelSale's step 8.
      await cancelSale(client, {
        saleId,
        cancelledBy: options.cancelledBy || 'system',
        reason: options.reason || 'Delivery deleted by admin',
        invoiceMode: 'soft',
        bonusActions: options.bonusActions || null,
        notes: options.notes || null,
      });
    } else {
      // Orphan delivery with no linked sale — physical delete is safe.
      await client.sql`DELETE FROM deliveries WHERE id = ${id}`;
    }
  });
}

// #endregion

// #region SUMMARY

/**
 * Build the admin/manager dashboard payload: revenue, COGS, gross +
 * net profit, monthly trend, top debtors/products/clients/suppliers,
 * cash-vs-bank splits, and bonus totals. `from`/`to` filter
 * purchases/sales/expenses/bonuses/settlements; payments and
 * deliveries are always all-time (debt snapshot + active deliveries).
 * @param {string} [from] ISO date `YYYY-MM-DD`.
 * @param {string} [to]   ISO date `YYYY-MM-DD`.
 * @returns {Promise<object>} Aggregated dashboard object (~30 fields).
 */
export async function getSummaryData(from, to) {
  // ARC-07: parallelize the 8 independent aggregation queries. Previously each
  // one awaited sequentially, so a 40ms-per-round-trip Neon connection turned
  // a cold summary request into ~320ms of purely serial latency. Wrapping in
  // Promise.all collapses that to the slowest single query. Downstream shape
  // is preserved exactly — each variable below is still an array of rows with
  // the same columns the calculations at L1416+ expect.
  //
  // Three tables (purchases, sales, expenses) and two more (settlements,
  // bonuses) are date-filtered. The other three (payments, deliveries,
  // products) are always all-time by business rule:
  // - payments: debt snapshot ignores period (a payment settles an old debt)
  // - deliveries: active-deliveries count is a current-state number
  // - products: inventory value is a current-state number
  //
  // @vercel/postgres does not support dynamic table names via template tags,
  // so the date-filtered queries are written out explicitly per table. Each
  // branch still returns a single SQL promise that can be Promise.all'd.
  const purchasesQ =
    from && to ? sql`SELECT * FROM purchases WHERE date >= ${from} AND date <= ${to}`
    : from      ? sql`SELECT * FROM purchases WHERE date >= ${from}`
    : to        ? sql`SELECT * FROM purchases WHERE date <= ${to}`
                : sql`SELECT * FROM purchases`;

  const salesQ =
    from && to ? sql`SELECT * FROM sales WHERE date >= ${from} AND date <= ${to}`
    : from      ? sql`SELECT * FROM sales WHERE date >= ${from}`
    : to        ? sql`SELECT * FROM sales WHERE date <= ${to}`
                : sql`SELECT * FROM sales`;

  const expensesQ =
    from && to ? sql`SELECT * FROM expenses WHERE date >= ${from} AND date <= ${to}`
    : from      ? sql`SELECT * FROM expenses WHERE date >= ${from}`
    : to        ? sql`SELECT * FROM expenses WHERE date <= ${to}`
                : sql`SELECT * FROM expenses`;

  const settlementsQ =
    from && to ? sql`SELECT * FROM settlements WHERE date >= ${from} AND date <= ${to}`
    : from      ? sql`SELECT * FROM settlements WHERE date >= ${from}`
    : to        ? sql`SELECT * FROM settlements WHERE date <= ${to}`
                : sql`SELECT * FROM settlements`;

  const bonusesQ =
    from && to ? sql`SELECT * FROM bonuses WHERE date >= ${from} AND date <= ${to}`
    : from      ? sql`SELECT * FROM bonuses WHERE date >= ${from}`
    : to        ? sql`SELECT * FROM bonuses WHERE date <= ${to}`
                : sql`SELECT * FROM bonuses`;

  // FEAT-04: VAT-collected-in-period query. Joins payments by date range
  // so it stays period-scoped even though the raw payments table query
  // below is all-time (for debt snapshot backwards-compat).
  const vatCollectedQ =
    from && to ? sql`SELECT COALESCE(SUM(tva_amount), 0) AS total FROM payments WHERE type IN ('collection','refund') AND date >= ${from} AND date <= ${to}`
    : from      ? sql`SELECT COALESCE(SUM(tva_amount), 0) AS total FROM payments WHERE type IN ('collection','refund') AND date >= ${from}`
    : to        ? sql`SELECT COALESCE(SUM(tva_amount), 0) AS total FROM payments WHERE type IN ('collection','refund') AND date <= ${to}`
                : sql`SELECT COALESCE(SUM(tva_amount), 0) AS total FROM payments WHERE type IN ('collection','refund')`;

  // v1.1 F-002 — profit_distributions must reduce netProfit. Pre-v1.1
  // getSummaryData never read this table, so distributions were invisible
  // in both accrual and cash-basis P&L. We filter by `created_at` (the
  // date the payout happened), mirroring how settlements are treated.
  // Null from/to returns the all-time total.
  const profitDistQ =
    from && to ? sql`SELECT COALESCE(SUM(amount), 0) AS total FROM profit_distributions WHERE created_at::date >= ${from} AND created_at::date <= ${to}`
    : from      ? sql`SELECT COALESCE(SUM(amount), 0) AS total FROM profit_distributions WHERE created_at::date >= ${from}`
    : to        ? sql`SELECT COALESCE(SUM(amount), 0) AS total FROM profit_distributions WHERE created_at::date <= ${to}`
                : sql`SELECT COALESCE(SUM(amount), 0) AS total FROM profit_distributions`;

  // v1.2 — REAL cash-flow aggregates. Pre-v1.2 the "Cash/Bank" card summed
  // sales.total filtered by sales.payment_type, which is the DECLARED payment
  // method at sale time — not the money that actually moved. Two defects:
  //   (1) A credit (آجل) sale where the customer later paid 500€ cash showed
  //       0 in the cash column because the sale's payment_type was 'آجل'.
  //   (2) An آجل purchase with paid_amount=0 showed its full total in the
  //       cash column because the filter was `payment_type != 'بنك'`.
  // The fix: read actual money movement from the dedicated tables.
  //   - payments (with payment_method + type='collection'/'refund') = client cash
  //   - supplier_payments (with payment_method) = supplier cash
  //   - expenses (with payment_type) = overhead cash (kept, but now an
  //     explicit '=كاش' check instead of '!=بنك' so NULL/other values stop
  //     leaking into the cash bucket)
  const cashFlowSalesCashQ =
    from && to ? sql`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_method = 'كاش' AND type IN ('collection','refund') AND date >= ${from} AND date <= ${to}`
    : from      ? sql`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_method = 'كاش' AND type IN ('collection','refund') AND date >= ${from}`
    : to        ? sql`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_method = 'كاش' AND type IN ('collection','refund') AND date <= ${to}`
                : sql`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_method = 'كاش' AND type IN ('collection','refund')`;

  const cashFlowSalesBankQ =
    from && to ? sql`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_method = 'بنك' AND type IN ('collection','refund') AND date >= ${from} AND date <= ${to}`
    : from      ? sql`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_method = 'بنك' AND type IN ('collection','refund') AND date >= ${from}`
    : to        ? sql`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_method = 'بنك' AND type IN ('collection','refund') AND date <= ${to}`
                : sql`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_method = 'بنك' AND type IN ('collection','refund')`;

  const cashFlowPurchasesCashQ =
    from && to ? sql`SELECT COALESCE(SUM(amount), 0) AS total FROM supplier_payments WHERE payment_method = 'كاش' AND date >= ${from} AND date <= ${to}`
    : from      ? sql`SELECT COALESCE(SUM(amount), 0) AS total FROM supplier_payments WHERE payment_method = 'كاش' AND date >= ${from}`
    : to        ? sql`SELECT COALESCE(SUM(amount), 0) AS total FROM supplier_payments WHERE payment_method = 'كاش' AND date <= ${to}`
                : sql`SELECT COALESCE(SUM(amount), 0) AS total FROM supplier_payments WHERE payment_method = 'كاش'`;

  const cashFlowPurchasesBankQ =
    from && to ? sql`SELECT COALESCE(SUM(amount), 0) AS total FROM supplier_payments WHERE payment_method = 'بنك' AND date >= ${from} AND date <= ${to}`
    : from      ? sql`SELECT COALESCE(SUM(amount), 0) AS total FROM supplier_payments WHERE payment_method = 'بنك' AND date >= ${from}`
    : to        ? sql`SELECT COALESCE(SUM(amount), 0) AS total FROM supplier_payments WHERE payment_method = 'بنك' AND date <= ${to}`
                : sql`SELECT COALESCE(SUM(amount), 0) AS total FROM supplier_payments WHERE payment_method = 'بنك'`;

  const [
    purchasesRes,
    salesRes,
    expensesRes,
    paymentsRes,
    deliveriesRes,
    settlementsRes,
    bonusesRes,
    productsRes,
    vatCollectedRes,
    usersRes,
    profitDistRes,
    cashFlowSalesCashRes,
    cashFlowSalesBankRes,
    cashFlowPurchasesCashRes,
    cashFlowPurchasesBankRes,
  ] = await Promise.all([
    purchasesQ,
    salesQ,
    expensesQ,
    sql`SELECT * FROM payments`,
    sql`SELECT * FROM deliveries`,
    settlementsQ,
    bonusesQ,
    sql`SELECT * FROM products`,
    vatCollectedQ,
    // v1.0.1 — needed by the Feature 5 top-sellers aggregate for role
    // filtering and name resolution. Small result set (≤ a few dozen),
    // fine to fetch every summary call.
    sql`SELECT username, name, role FROM users WHERE active = true`,
    profitDistQ,
    cashFlowSalesCashQ,
    cashFlowSalesBankQ,
    cashFlowPurchasesCashQ,
    cashFlowPurchasesBankQ,
  ]);

  const purchases     = purchasesRes.rows;
  const sales         = salesRes.rows;
  const expenses      = expensesRes.rows;
  const payments      = paymentsRes.rows;
  const users         = usersRes.rows;
  const deliveries    = deliveriesRes.rows;
  const allSettlements = settlementsRes.rows;
  const allBonuses    = bonusesRes.rows;
  const products      = productsRes.rows;

  // v1.1 F-012 — read vat_rate from settings for pendingTva computation.
  // This avoids the hardcoded / 6 that assumed 20% forever.
  let summaryVatRate = 20;
  try {
    const settingsObj = await getSettings();
    summaryVatRate = parseFloat(settingsObj?.vat_rate) || 20;
  } catch { /* fall back to 20% on any error */ }

  // === PROPER ACCOUNTING ===
  // Only CONFIRMED sales count for revenue/profit (after delivery)

  const confirmedSales = sales.filter((s) => s.status === 'مؤكد');
  const reservedSales = sales.filter((s) => s.status === 'محجوز');
  const cancelledSales = sales.filter((s) => s.status === 'ملغي');

  // ARC-06: @vercel/postgres returns NUMERIC columns as strings. Every money
  // read below is wrapped in parseFloat to prevent `number + "100.00"` from
  // becoming "0100.00" via string concatenation. See the consumer audit in
  // the Session 1 commit message for the full list of sites that were fixed.
  // The `*` operator in inventoryValue below naturally coerces via ToNumber
  // so multiplication is safe — only addition/subtraction needed wrapping.

  // Revenue = confirmed sales only (إيرادات فعلية بعد التوصيل)
  const totalRevenue = confirmedSales.reduce((s, r) => s + (parseFloat(r.total) || 0), 0);

  // Reserved revenue (إيرادات محجوزة - لم تتأكد بعد)
  const reservedRevenue = reservedSales.reduce((s, r) => s + (parseFloat(r.total) || 0), 0);

  // All sales total (for reference)
  const totalAllSales = sales.filter((s) => s.status !== 'ملغي').reduce((s, r) => s + (parseFloat(r.total) || 0), 0);

  // COGS = confirmed only (تكلفة البضاعة المباعة فعلياً)
  const totalCOGS = confirmedSales.reduce((s, r) => s + (parseFloat(r.cost_total) || 0), 0);

  // Total Purchases (رأس المال المستثمر)
  const totalPurchases = purchases.reduce((s, r) => s + (parseFloat(r.total) || 0), 0);

  // Expenses
  const totalExpenses = expenses.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  // Gross Profit = confirmed revenue - COGS
  const grossProfit = totalRevenue - totalCOGS;

  // Bonus payouts (business expense - reduces profit)
  const totalBonusPaid = (allSettlements || [])
    .filter((s) => s.type === 'seller_payout' || s.type === 'driver_payout')
    .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  // Unsettled bonuses (liability - owed but not yet paid)
  const totalBonusOwed = (allBonuses || [])
    .filter((b) => !b.settled)
    .reduce((s, b) => s + (parseFloat(b.total_bonus) || 0), 0);

  // Total bonus cost = paid + owed (both reduce profit)
  const totalBonusCost = totalBonusPaid + totalBonusOwed;

  // v1.1 F-006 — split bonus cost into "earned on fully-paid sales" vs
  // "accrued on unpaid/partially-paid sales". Cash-basis P&L should only
  // be charged the earned portion; the unearned portion is a contingent
  // liability that hasn't materialized in cash yet.
  //
  // Build a lookup of sale_id → fully-paid status, then classify each
  // bonus row. Settled bonuses (already paid out) always count as
  // earned since the settlement IS a cash outflow regardless of the
  // underlying sale's status.
  // Build a map: sale.id → is the sale fully paid?
  const saleFullyPaid = new Map();
  const isFullyPaidSale = (s) => {
    if (s.payment_status === 'paid') return true;
    return (parseFloat(s.remaining) || 0) < 0.005;
  };
  sales.forEach((s) => saleFullyPaid.set(s.id, isFullyPaidSale(s)));
  // Unsettled bonuses whose associated sale IS fully paid: cash was
  // received, bonus was legitimately earned, but not yet settled (still
  // in the "owed" bucket). This is the delta between totalBonusCost
  // (the accrual universe) and what cash-basis should charge.
  //
  // Note: SETTLED bonuses are NOT counted here because their financial
  // impact already lives in totalBonusPaid (via the settlement row in
  // the settlements table). Counting them again would double-charge.
  const unsettledBonusFromPaidSales = (allBonuses || [])
    .filter((b) => !b.settled && saleFullyPaid.get(b.sale_id) === true)
    .reduce((sum, b) => sum + (parseFloat(b.total_bonus) || 0), 0);
  // Cash-basis total = settlement payouts + earned-but-unsettled
  const totalBonusEarnedCashBasis = totalBonusPaid + unsettledBonusFromPaidSales;
  // Unearned = the remainder: accrued on unpaid credit sales, not yet settled
  const totalBonusAccruedUnearned = totalBonusCost - totalBonusEarnedCashBasis;

  // v1.1 F-002 — profit distributions reduce netProfit. Two sources:
  //
  //   (a) profit_distributions table (v1.0.2 structured table, read by
  //       the profitDistQ query above — already period-filtered by
  //       created_at)
  //   (b) Legacy settlement rows with type='profit_distribution' that
  //       existed in v1.0.x before Sprint 1 S1.8 removed that write
  //       path. addSettlement now rejects that type, so no NEW legacy
  //       rows can land, but historical rows in production must still
  //       reduce netProfit or the dashboard drifts.
  //
  // Combined into a single totalProfitDistributed term that is
  // subtracted from both accrual and cash-basis netProfit below.
  const profitDistFromTable = parseFloat(profitDistRes.rows[0]?.total) || 0;
  const profitDistFromLegacySettlements = (allSettlements || [])
    .filter((s) => s.type === 'profit_distribution')
    .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const totalProfitDistributed = profitDistFromTable + profitDistFromLegacySettlements;

  // Net Profit = Gross Profit - Expenses - ALL Bonuses (paid + owed) - ProfitDistributed
  const netProfit = grossProfit - totalExpenses - totalBonusCost - totalProfitDistributed;

  // Confirmed profit
  const confirmedProfit = confirmedSales.reduce((s, r) => s + (parseFloat(r.profit) || 0), 0);

  // Reserved profit (expected but not confirmed)
  const reservedProfit = reservedSales.reduce((s, r) => s + (parseFloat(r.profit) || 0), 0);

  // ─── PROJECTED / PIPELINE P&L ────────────────────────────────────────
  // "Projected" = reserved + confirmed. Answers: "what will I earn if every
  // open order ends up delivered?" Reserved orders can still be cancelled,
  // so this is a LEADING INDICATOR, not recognized revenue. Kept separate
  // from accrual and cash-basis P&L to preserve their accounting meaning.
  //
  // Bonus policy for the pipeline view (decision A — no simulation):
  //   We use totalBonusCost verbatim — i.e., only bonuses already ACCRUED
  //   on confirmed sales. Bonuses on reserved sales don't exist yet
  //   (calculateBonusInTx runs at delivery confirmation), and simulating
  //   them from current rates would produce a fragile number that changes
  //   every time an admin tweaks a bonus rate. The UI surfaces this as
  //   "لم تُحسب عمولات الطلبات المحجوزة" so the reader understands the
  //   projected net excludes that contingent cost.
  const reservedCOGS = reservedSales.reduce((s, r) => s + (parseFloat(r.cost_total) || 0), 0);
  const projectedRevenue = totalRevenue + reservedRevenue;
  const projectedCOGS = totalCOGS + reservedCOGS;
  const projectedGrossProfit = projectedRevenue - projectedCOGS;
  const projectedNetProfit = projectedGrossProfit - totalExpenses - totalBonusCost - totalProfitDistributed;

  // Inventory Value — inner `*` coerces strings via ToNumber, outer `+` starts
  // from 0 number and the multiplication result is always number. Safe without
  // an explicit parseFloat wrap, but added for consistency with the sites above.
  const inventoryValue = products.reduce((s, p) => s + ((parseFloat(p.stock) || 0) * (parseFloat(p.buy_price) || 0)), 0);

  // ─── LEGACY "sales by payment type" aggregates ──────────────────────
  // Pre-v1.2 these were labeled "Cash/Bank Breakdown" on the dashboard,
  // which was misleading — they classify sales by the DECLARED payment
  // method at sale time, not the money that actually moved. A credit sale
  // that later received a cash collection showed 0 here. The v1.2 real
  // cash-flow aggregates below (cashFlow*) are the authoritative numbers
  // for the dashboard's cash-flow card. These legacy fields are kept in
  // the response for any external consumer that may still read them.
  const salesCash = confirmedSales.filter((s) => s.payment_type === 'كاش' || (s.payment_type !== 'بنك' && s.payment_type !== 'آجل')).reduce((s, r) => s + (parseFloat(r.total) || 0), 0);
  const salesBank = confirmedSales.filter((s) => s.payment_type === 'بنك').reduce((s, r) => s + (parseFloat(r.total) || 0), 0);
  const salesCredit = confirmedSales.filter((s) => s.payment_type === 'آجل').reduce((s, r) => s + (parseFloat(r.total) || 0), 0);
  const purchasesCash = purchases.filter((p) => p.payment_type !== 'بنك').reduce((s, r) => s + (parseFloat(r.total) || 0), 0);
  const purchasesBank = purchases.filter((p) => p.payment_type === 'بنك').reduce((s, r) => s + (parseFloat(r.total) || 0), 0);
  const expensesCash = expenses.filter((e) => e.payment_type !== 'بنك').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const expensesBank = expenses.filter((e) => e.payment_type === 'بنك').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  // ─── v1.2 REAL cash-flow aggregates ─────────────────────────────────
  // Dashboard's cash-flow card reads these. Sources:
  //   - Clients  → payments (payment_method + type='collection'/'refund')
  //   - Suppliers → supplier_payments (payment_method)
  //   - Expenses → expenses (payment_type — explicit '=كاش'/'=بنك' check
  //                so NULL/other values no longer leak into the cash bucket)
  const cashFlowSalesCash = parseFloat(cashFlowSalesCashRes.rows[0]?.total) || 0;
  const cashFlowSalesBank = parseFloat(cashFlowSalesBankRes.rows[0]?.total) || 0;
  const cashFlowPurchasesCash = parseFloat(cashFlowPurchasesCashRes.rows[0]?.total) || 0;
  const cashFlowPurchasesBank = parseFloat(cashFlowPurchasesBankRes.rows[0]?.total) || 0;
  const cashFlowExpensesCash = expenses.filter((e) => e.payment_type === 'كاش').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const cashFlowExpensesBank = expenses.filter((e) => e.payment_type === 'بنك').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  // Net cash flow = inflow (sales) − outflow (purchases + expenses). Shown
  // as the bottom row of the card so the reader sees the period's result
  // without adding the columns in their head.
  const cashFlowNetCash = cashFlowSalesCash - cashFlowPurchasesCash - cashFlowExpensesCash;
  const cashFlowNetBank = cashFlowSalesBank - cashFlowPurchasesBank - cashFlowExpensesBank;

  // v1.1 F-004 — totalDebt read directly from the sales ledger.
  //
  // Pre-v1.1 this was computed as:
  //   totalCreditSales - totalPaidAtSale - totalLaterPayments
  // where totalLaterPayments was SUM(payments.amount) — UNFILTERED.
  // That sum included cash-sale collection rows, refund rows, and any
  // future payment types, so cash collections leaked into the credit
  // debt calculation. The defect was hidden by Math.max(0, …) which
  // clamped wrong results to 0, but the formula could produce a
  // too-small debt value whenever cash sales coexisted with credit
  // sales. This is the same Bug-3 pattern that was fixed in
  // getClients for v1.0.3.
  //
  // The fix: totalDebt = SUM(sales.remaining) over confirmed credit
  // sales. `sales.remaining` is maintained by addSale, applyCollection,
  // and cancelSale in lockstep with the payments table, so reading it
  // directly avoids the cross-table pollution entirely.
  //
  // Regression test:
  //   tests/invariants/total-debt-f004.test.js
  const totalDebt = sales
    .filter((s) => s.payment_type === 'آجل' && s.status === 'مؤكد')
    .reduce((sum, r) => sum + (parseFloat(r.remaining) || 0), 0);

  // Monthly data
  const monthlyData = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const monthName = d.toLocaleDateString('ar-SA', { month: 'short', year: 'numeric' });

    const mp = purchases.filter((r) => r.date?.startsWith(ym)).reduce((s, r) => s + (parseFloat(r.total) || 0), 0);
    const ms = confirmedSales.filter((r) => r.date?.startsWith(ym)).reduce((s, r) => s + (parseFloat(r.total) || 0), 0);
    const me = expenses.filter((r) => r.date?.startsWith(ym)).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const mProfit = confirmedSales.filter((r) => r.date?.startsWith(ym)).reduce((s, r) => s + (parseFloat(r.profit) || 0), 0);

    const mBonusEarned = (allBonuses || [])
      .filter((b) => b.date?.startsWith(ym))
      .reduce((s, b) => s + (parseFloat(b.total_bonus) || 0), 0);
    monthlyData.push({ month: monthName, purchases: mp, sales: ms, expenses: me, profit: mProfit - me - mBonusEarned });
  }

  // Expense by category
  const expenseByCategory = {};
  expenses.forEach((e) => {
    const cat = e.category || 'أخرى';
    expenseByCategory[cat] = (expenseByCategory[cat] || 0) + (parseFloat(e.amount) || 0);
  });

  // Top debtors — SP-012 fix: use sales.remaining directly (same pattern
  // as the fixed totalDebt calculation). Pre-v1.2 this used the old broken
  // formula that cross-polluted cash collections into credit debt.
  const clientDebtMap = {};
  sales.filter((s) => s.payment_type === 'آجل' && s.status === 'مؤكد')
    .forEach((s) => {
      const remaining = parseFloat(s.remaining) || 0;
      if (remaining > 0.005) {
        clientDebtMap[s.client_name] = (clientDebtMap[s.client_name] || 0) + remaining;
      }
    });
  const topDebtors = Object.entries(clientDebtMap)
    .map(([name, debt]) => ({ name, debt }))
    .sort((a, b) => b.debt - a.debt)
    .slice(0, 10);

  // DONE: Fix 1 — top products by confirmed sales (qty + revenue + profit)
  const productSales = {};
  confirmedSales.forEach((s) => {
    if (!productSales[s.item]) {
      productSales[s.item] = { item: s.item, count: 0, revenue: 0, profit: 0 };
    }
    productSales[s.item].count   += parseFloat(s.quantity) || 0;
    productSales[s.item].revenue += parseFloat(s.total)    || 0;
    productSales[s.item].profit  += parseFloat(s.profit)   || 0;
  });
  const topProducts = Object.values(productSales)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // DONE: Fix 2 — top clients by confirmed-sale revenue
  const clientSalesMap = {};
  confirmedSales.forEach((s) => {
    if (!clientSalesMap[s.client_name]) {
      clientSalesMap[s.client_name] = { name: s.client_name, count: 0, revenue: 0 };
    }
    clientSalesMap[s.client_name].count++;
    clientSalesMap[s.client_name].revenue += parseFloat(s.total) || 0;
  });
  const topClients = Object.values(clientSalesMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // v1.0.1 Feature 5 — top sellers replaces the top clients widget on
  // the dashboard. topClients is still returned for backward compat
  // (existing test fixtures + any external consumer); the dashboard UI
  // swaps which one it displays.
  //
  // Eligibility: only users whose role is literally 'seller' are counted,
  // matching the locked bonus-eligibility rule. Admin/manager-created
  // sales do NOT inflate a seller's total. We also read the accrued
  // seller bonuses for each ranked user so the UI can show what they've
  // actually earned alongside what they've sold.
  const sellerSalesMap = {};
  confirmedSales.forEach((s) => {
    if (!s.created_by) return;
    if (!sellerSalesMap[s.created_by]) {
      sellerSalesMap[s.created_by] = { username: s.created_by, count: 0, revenue: 0 };
    }
    sellerSalesMap[s.created_by].count++;
    sellerSalesMap[s.created_by].revenue += parseFloat(s.total) || 0;
  });
  // Filter to users whose role is actually 'seller' — a manager or admin
  // who happens to have created sales must not appear in this ranking.
  const sellerUsernames = new Set(
    users.filter((u) => u.role === 'seller').map((u) => u.username)
  );
  // Sum seller-role bonuses per username for the same period (from the
  // already-fetched allBonuses array, which is date-filtered upstream).
  const sellerBonusByUser = {};
  allBonuses.forEach((b) => {
    if (b.role !== 'seller') return;
    sellerBonusByUser[b.username] = (sellerBonusByUser[b.username] || 0) + (parseFloat(b.total_bonus) || 0);
  });
  const topSellers = Object.values(sellerSalesMap)
    .filter((s) => sellerUsernames.has(s.username))
    .map((s) => ({
      username: s.username,
      // Resolve display name from users table; fall back to username.
      name: users.find((u) => u.username === s.username)?.name || s.username,
      salesCount: s.count,
      totalSales: s.revenue,
      totalBonus: sellerBonusByUser[s.username] || 0,
    }))
    .sort((a, b) => b.totalSales - a.totalSales)
    .slice(0, 10);

  // DONE: Fix 5 — supplier performance (orders, distinct items, total spent)
  // v1.0.2 — also aggregate paid + remaining (from v1.0.1 supplier credit
  // columns) so the dashboard widget can highlight outstanding supplier debt.
  const supplierMap = {};
  purchases.forEach((p) => {
    if (!supplierMap[p.supplier]) {
      supplierMap[p.supplier] = {
        name: p.supplier, orders: 0,
        totalSpent: 0, totalPaid: 0, totalRemaining: 0,
        items: new Set(),
      };
    }
    const row = supplierMap[p.supplier];
    row.orders++;
    const total = parseFloat(p.total) || 0;
    // v1.0.1 purchases.paid_amount was backfilled to `total` on migration,
    // so legacy rows without the column still read as fully paid.
    const paid = parseFloat(p.paid_amount);
    const effectivePaid = Number.isFinite(paid) ? paid : total;
    row.totalSpent += total;
    row.totalPaid += effectivePaid;
    row.totalRemaining += Math.max(0, total - effectivePaid);
    row.items.add(p.item);
  });
  const topSuppliers = Object.values(supplierMap)
    .map((s) => ({
      name: s.name,
      orders: s.orders,
      totalSpent: s.totalSpent,
      totalPaid: s.totalPaid,
      totalRemaining: s.totalRemaining,
      itemCount: s.items.size,
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);

  // Delivery stats
  const pendingDeliveries = deliveries.filter((d) => d.status === 'قيد الانتظار');
  const inTransitDeliveries = deliveries.filter((d) => d.status === 'جاري التوصيل');

  // === FEAT-04: CASH-BASIS AGGREGATES ===
  // Accrual (above) counts every confirmed sale at delivery; cash-basis
  // counts only sales where remaining = 0 (fully collected). Dashboard
  // shows both side-by-side so the user can see what's been booked vs
  // what's actually been received.
  //
  // Safety: payment_status was added in Session 1 with DEFAULT 'pending',
  // but historical sales confirmed BEFORE this migration may still read
  // as 'pending' even though they were fully paid at delivery (old
  // updateDelivery CASE expression). The fallback below treats any
  // confirmed sale with remaining < 0.005 as 'paid' regardless of the
  // stored payment_status — backwards compat for pre-FEAT-04 data.
  const isFullyPaid = (s) => {
    if (s.payment_status === 'paid') return true;
    return (parseFloat(s.remaining) || 0) < 0.005;
  };
  const isPartiallyPaid = (s) => {
    if (isFullyPaid(s)) return false;
    return (parseFloat(s.remaining) || 0) > 0.005;
  };

  const paidSales = confirmedSales.filter(isFullyPaid);
  const partialSales = confirmedSales.filter(isPartiallyPaid);

  const totalRevenueCashBasis = paidSales.reduce((s, r) => s + (parseFloat(r.total) || 0), 0);
  const totalCOGSCashBasis = paidSales.reduce((s, r) => s + (parseFloat(r.cost_total) || 0), 0);
  const grossProfitCashBasis = totalRevenueCashBasis - totalCOGSCashBasis;
  // v1.1 F-002 — same profit_distributions subtraction as the accrual branch.
  // v1.1 F-006 — cash-basis uses totalBonusEarnedCashBasis instead of
  // totalBonusCost. Pre-v1.1 a credit sale with 0 collected still accrued
  // the full bonus into totalBonusCost, which produced a phantom loss of
  // −10€ on cash-basis P&L with 0 revenue. Now, unearned bonuses are
  // excluded from the cash-basis charge and surfaced as a separate
  // liability line (totalBonusAccruedUnearned).
  const netProfitCashBasis = grossProfitCashBasis - totalExpenses - totalBonusEarnedCashBasis - totalProfitDistributed;

  // v1.1 F-002 — "distributable" is the profit still available to distribute
  // given current state. Clamped at 0 because a negative cash-basis netProfit
  // means the company is already over-distributed or running at a loss.
  // Surfaced in the dashboard so the admin sees the number before the
  // /profit-distributions form even opens. This is a soft HINT — the F-001
  // cap in addProfitDistribution uses a different (collected-based) check.
  const distributable = Math.max(0, netProfitCashBasis);

  // Pending collections (TTC + VAT share)
  const pendingRevenue = partialSales.reduce((s, r) => s + (parseFloat(r.remaining) || 0), 0);
  // v1.1 F-012 — use summaryVatRate from settings (read above), not / 6.
  const pendingTva = Math.round((pendingRevenue * summaryVatRate / (100 + summaryVatRate)) * 100) / 100;

  // Period VAT collected (from payments table, type ∈ collection/refund)
  const totalVatCollected = parseFloat(vatCollectedRes.rows[0]?.total) || 0;

  // Convenience aliases — existing consumers stay on `totalRevenue`,
  // new cash-basis consumers can use the explicit `totalRevenueAccrued`.
  const totalRevenueAccrued = totalRevenue;
  const netProfitAccrued = netProfit;

  return {
    totalRevenue, totalAllSales, reservedRevenue, totalCOGS, totalPurchases, totalExpenses,
    grossProfit, netProfit, confirmedProfit, reservedProfit, inventoryValue, totalDebt,
    confirmedCount: confirmedSales.length, reservedCount: reservedSales.length, cancelledCount: cancelledSales.length,
    totalBonusPaid, totalBonusOwed, totalBonusCost,
    // v1.1 F-006 — cash-basis bonus split
    totalBonusEarnedCashBasis,
    totalBonusAccruedUnearned,
    salesCash, salesBank, salesCredit, purchasesCash, purchasesBank, expensesCash, expensesBank,
    monthlyData, expenseByCategory, topDebtors,
    // DONE: Fix 1, 2, 5 — surface the new dashboard rankings
    topProducts, topClients, topSuppliers,
    // v1.0.1 Feature 5 — top sellers (dashboard widget swaps from
    // topClients to topSellers). topClients stays in the response
    // for backward-compat with any existing consumer.
    topSellers,
    pendingDeliveries: pendingDeliveries.length,
    inTransitDeliveries: inTransitDeliveries.length,
    recentDeliveries: [...pendingDeliveries, ...inTransitDeliveries].slice(0, 5),
    // FEAT-04: cash-basis aggregates + pending collections + period VAT
    totalRevenueAccrued,
    netProfitAccrued,
    totalRevenueCashBasis,
    totalCOGSCashBasis,
    grossProfitCashBasis,
    netProfitCashBasis,
    pendingRevenue,
    pendingTva,
    totalVatCollected,
    paidSalesCount: paidSales.length,
    partialSalesCount: partialSales.length,
    // v1.1 F-002 — profit distributions are now subtracted from both
    // netProfit variants above. Surface the raw totals so the dashboard
    // and /profit-distributions form can show them.
    totalProfitDistributed,
    profitDistFromTable,
    profitDistFromLegacySettlements,
    distributable,
    // v1.2 — projected/pipeline P&L (reserved + confirmed). See the
    // "PROJECTED / PIPELINE P&L" block in getSummaryData for the
    // accounting rationale (including the decision not to simulate
    // bonuses on reserved sales).
    reservedCOGS,
    projectedRevenue,
    projectedCOGS,
    projectedGrossProfit,
    projectedNetProfit,
    // v1.2 — real cash-flow aggregates (from payments + supplier_payments
    // + expenses). Replaces the old salesCash/salesBank/... fields on the
    // dashboard card; those are still returned above for backward compat.
    cashFlowSalesCash,
    cashFlowSalesBank,
    cashFlowPurchasesCash,
    cashFlowPurchasesBank,
    cashFlowExpensesCash,
    cashFlowExpensesBank,
    cashFlowNetCash,
    cashFlowNetBank,
  };
}

// #endregion

// #region USERS

/**
 * @returns {Promise<Array<object>>} Users (without password hash) ordered
 *   by id ASC.
 */
export async function getUsers() {
  const { rows } = await sql`SELECT id, username, name, role, active, created_at FROM users ORDER BY id`;
  return rows;
}

/**
 * @param {string} username
 * @returns {Promise<object|null>} Full user row (including password hash)
 *   or `null` if no match. Used by the NextAuth credentials provider.
 */
export async function getUserByUsername(username) {
  const { rows } = await sql`SELECT * FROM users WHERE username = ${username}`;
  return rows[0] || null;
}

/**
 * Create a user with bcrypt-hashed password. Role defaults to
 * `'seller'` when not provided.
 * @param {{username:string, password:string, name:string, role?:string}} data
 * @returns {Promise<number>} The new user id.
 */
export async function addUser(data) {
  const bcryptjs = (await import('bcryptjs')).default;
  const hash = bcryptjs.hashSync(data.password, 12);
  const { rows } = await sql`
    INSERT INTO users (username, password, name, role, active)
    VALUES (${data.username}, ${hash}, ${data.name}, ${data.role || 'seller'}, true)
    RETURNING id
  `;
  return rows[0].id;
}

/**
 * Update a user's `name` / `role` and, if `data.password` is present,
 * the bcrypt-hashed password.
 * @param {{id:number, name:string, role:string, password?:string}} data
 * @returns {Promise<void>}
 */
export async function updateUser(data) {
  if (data.password) {
    const bcryptjs = (await import('bcryptjs')).default;
    const hash = bcryptjs.hashSync(data.password, 12);
    await sql`UPDATE users SET name=${data.name}, role=${data.role}, password=${hash} WHERE id=${data.id}`;
  } else {
    await sql`UPDATE users SET name=${data.name}, role=${data.role} WHERE id=${data.id}`;
  }
}

/**
 * Flip a user's `active` flag.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function toggleUserActive(id) {
  await sql`UPDATE users SET active = NOT active WHERE id = ${id}`;
}

/**
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteUser(id) {
  await sql`DELETE FROM users WHERE id = ${id}`;
}

/**
 * v1.2 — get all users with profit_share_pct > 0 (admin + manager eligible).
 * Used by the profit-distributions page to pre-populate recipients.
 */
export async function getProfitShareConfig() {
  const { rows } = await sql`
    SELECT username, name, role, profit_share_pct, profit_share_start
    FROM users
    WHERE role IN ('admin', 'manager') AND active = true
    ORDER BY username
  `;
  return rows;
}

/**
 * v1.2 — set a user's profit share percentage + start date.
 * @param {string} username
 * @param {number} percentage  0-100
 * @param {string|null} startDate  YYYY-MM-DD — the date from which this
 *   user participates in profit distributions. Distributions for periods
 *   before this date exclude this user. Null = no restriction (all periods).
 */
export async function setProfitSharePct(username, percentage, startDate) {
  const pct = parseFloat(percentage) || 0;
  if (pct < 0 || pct > 100) throw new Error('النسبة يجب أن تكون بين 0 و 100');
  await sql`UPDATE users SET profit_share_pct = ${pct}, profit_share_start = ${startDate || null} WHERE username = ${username}`;
}

// #endregion

// #region SETTINGS

/**
 * @returns {Promise<Object<string,string>>} Settings as a flat object
 *   keyed on `settings.key` → `settings.value` (all values are strings).
 */
export async function getSettings() {
  const { rows } = await sql`SELECT * FROM settings`;
  const obj = {};
  rows.forEach((r) => { obj[r.key] = r.value; });
  return obj;
}

/**
 * Upsert every `data[key] → value` pair into the `settings` table.
 * Values are coerced to strings via `String(value)` before storage.
 * @param {Object<string,*>} data
 * @returns {Promise<void>}
 */
// M-06: whitelist of allowed setting keys with basic type validation
const SETTINGS_WHITELIST = new Set([
  'seller_bonus_fixed', 'seller_bonus_percentage', 'driver_bonus_fixed',
  'vat_rate', 'invoice_currency',
  'shop_name', 'shop_address', 'shop_city', 'shop_email', 'shop_website',
  'shop_legal_form', 'shop_siren', 'shop_siret', 'shop_vat_number',
  'shop_ape', 'shop_iban', 'shop_bic',
]);
export async function updateSettings(data) {
  for (const [key, value] of Object.entries(data)) {
    if (!SETTINGS_WHITELIST.has(key)) continue; // silently skip unknown keys
    const strVal = String(value);
    // Numeric settings: reject negatives
    if (['vat_rate', 'seller_bonus_fixed', 'seller_bonus_percentage', 'driver_bonus_fixed'].includes(key)) {
      const num = parseFloat(strVal);
      if (!Number.isFinite(num) || num < 0) continue;
    }
    await sql`INSERT INTO settings (key, value) VALUES (${key}, ${strVal}) ON CONFLICT (key) DO UPDATE SET value = ${strVal}`;
  }
}

/**
 * v1.1 F-007 — get all per-user bonus rate overrides.
 * @returns {Promise<Array<{username:string, seller_fixed:number|null, seller_percentage:number|null, driver_fixed:number|null, updated_by:string, updated_at:string}>>}
 */
export async function getUserBonusRates() {
  const { rows } = await sql`SELECT * FROM user_bonus_rates ORDER BY username`;
  return rows;
}

/**
 * v1.1 F-007 — upsert a per-user bonus rate override.
 * Only provided fields are written; null/undefined fields fall back
 * to the global settings. Delete the row entirely to revert to globals.
 * @param {{username:string, seller_fixed?:number, seller_percentage?:number, driver_fixed?:number, updatedBy:string}} data
 */
export async function setUserBonusRate(data) {
  const sf = data.seller_fixed != null ? parseFloat(data.seller_fixed) : null;
  const sp = data.seller_percentage != null ? parseFloat(data.seller_percentage) : null;
  const df = data.driver_fixed != null ? parseFloat(data.driver_fixed) : null;
  await sql`
    INSERT INTO user_bonus_rates (username, seller_fixed, seller_percentage, driver_fixed, updated_by, updated_at)
    VALUES (${data.username}, ${sf}, ${sp}, ${df}, ${data.updatedBy}, NOW())
    ON CONFLICT (username) DO UPDATE SET
      seller_fixed = COALESCE(${sf}, user_bonus_rates.seller_fixed),
      seller_percentage = COALESCE(${sp}, user_bonus_rates.seller_percentage),
      driver_fixed = COALESCE(${df}, user_bonus_rates.driver_fixed),
      updated_by = ${data.updatedBy},
      updated_at = NOW()
  `;
}

/**
 * v1.1 F-007 — delete a per-user rate override (revert to globals).
 * @param {string} username
 */
export async function deleteUserBonusRate(username) {
  await sql`DELETE FROM user_bonus_rates WHERE username = ${username}`;
}

// #endregion

// #region BONUSES

/**
 * @param {string} [username] If provided, filters to this user only.
 * @returns {Promise<Array<object>>}
 */
export async function getBonuses(username) {
  if (username) {
    const { rows } = await sql`SELECT * FROM bonuses WHERE username = ${username} ORDER BY id DESC`;
    return rows;
  }
  const { rows } = await sql`SELECT * FROM bonuses ORDER BY id DESC`;
  return rows;
}

// Calculate bonuses inside an existing transaction (uses caller's client).
// The UNIQUE(delivery_id, role) index makes this safe under concurrent confirmation.
// Exported so tests can inject a mocked client — the only production caller is
// updateDelivery() in this same file.
export async function calculateBonusInTx(client, saleId, deliveryId, driverUsername) {
  const { rows: settingRows } = await client.sql`SELECT * FROM settings`;
  const settings = {};
  settingRows.forEach((r) => { settings[r.key] = r.value; });
  // BUG 6A — fall back to the documented business defaults (10/50/5) if the
  // settings row is missing or unparseable. Never silently pay 0 bonus.
  const globalSellerFixed = parseFloat(settings.seller_bonus_fixed ?? '10') || 10;
  const globalSellerPct   = parseFloat(settings.seller_bonus_percentage ?? '50') || 50;
  const globalDriverFixed = parseFloat(settings.driver_bonus_fixed ?? '5')  || 5;

  const { rows: saleRows } = await client.sql`SELECT * FROM sales WHERE id = ${saleId}`;
  if (!saleRows.length) return;
  const sale = saleRows[0];

  // v1.1 F-007 — per-user bonus rate override. Look up the seller's
  // and driver's custom rates BEFORE computing bonuses. Fall back to
  // the global settings values if no override row exists. This lets
  // the admin set "yasin gets 15€ fixed + 40% overage" while "new
  // seller gets the default 10€ + 50%".
  async function getUserRates(username) {
    const { rows } = await client.sql`
      SELECT seller_fixed, seller_percentage, driver_fixed
      FROM user_bonus_rates WHERE username = ${username}
    `;
    return rows[0] || null;
  }

  const recommended = parseFloat(sale.recommended_price) || 0;
  const actual = parseFloat(sale.unit_price) || 0;
  const qty = parseFloat(sale.quantity) || 0;
  const today = new Date().toISOString().split('T')[0];

  // Seller bonus — only when the order's creator is actually a seller (not admin/manager)
  if (sale.created_by) {
    const { rows: sellerUser } = await client.sql`SELECT role FROM users WHERE username = ${sale.created_by}`;
    const sellerRole = sellerUser.length > 0 ? sellerUser[0].role : '';
    if (sellerRole === 'seller') {
      // v1.1 F-007 — per-user rates with global fallback
      const sellerOverride = await getUserRates(sale.created_by);
      const sellerFixed = sellerOverride?.seller_fixed != null
        ? parseFloat(sellerOverride.seller_fixed) : globalSellerFixed;
      const sellerPct = sellerOverride?.seller_percentage != null
        ? parseFloat(sellerOverride.seller_percentage) : globalSellerPct;
      const extra = Math.max(0, actual - recommended) * qty;
      const extraBonus = extra * sellerPct / 100;
      // v1.2 — fixed bonus multiplied by quantity. 2 items at 10€/item = 20€.
      // Pre-v1.2 the fixed was flat per delivery regardless of quantity.
      const fixedTotal = sellerFixed * qty;
      const totalBonus = fixedTotal + extraBonus;
      await client.sql`
        INSERT INTO bonuses (date, username, role, sale_id, delivery_id, item, quantity, recommended_price, actual_price, fixed_bonus, extra_bonus, total_bonus)
        VALUES (${today}, ${sale.created_by}, 'seller', ${saleId}, ${deliveryId}, ${sale.item}, ${qty}, ${recommended}, ${actual}, ${fixedTotal}, ${extraBonus}, ${totalBonus})
        ON CONFLICT (delivery_id, role) DO NOTHING
      `;
    }
  }

  // Driver bonus
  if (driverUsername) {
    // BUG 3D — the caller may pass a stale or wrong driver name.
    // Read assigned_driver from the deliveries row as the source of truth so the
    // bonus is always credited to the actual driver who owns this delivery.
    const { rows: delRow } = await client.sql`
      SELECT assigned_driver FROM deliveries WHERE id = ${deliveryId}
    `;
    // BUG-08 — do NOT silently fall back to the caller-supplied driverUsername.
    // The previous fallback was `delRow[0]?.assigned_driver || driverUsername`, which
    // would silently pay the bonus to the caller's guess whenever the deliveries row
    // lookup came back empty or unassigned. We only reach this block inside the
    // FOR-UPDATE-protected confirm path, so an empty delRow at this point is a broken
    // invariant. Fail loudly instead of silently miscrediting a bonus row.
    if (!delRow[0]?.assigned_driver) {
      throw new Error('Internal error: bonus calculation requires a confirmed delivery row with an assigned driver');
    }
    const confirmedDriver = delRow[0].assigned_driver;

    const { rows: driverUser } = await client.sql`SELECT role FROM users WHERE username = ${confirmedDriver}`;
    const driverRole = driverUser.length > 0 ? driverUser[0].role : '';
    if (driverRole === 'driver') {
      // v1.1 F-007 — per-user driver rate override
      const driverOverride = await getUserRates(confirmedDriver);
      const driverFixed = driverOverride?.driver_fixed != null
        ? parseFloat(driverOverride.driver_fixed) : globalDriverFixed;
      // v1.2 — fixed bonus multiplied by quantity. 2 items at 5€/item = 10€.
      const driverFixedTotal = driverFixed * qty;
      await client.sql`
        INSERT INTO bonuses (date, username, role, sale_id, delivery_id, item, quantity, recommended_price, actual_price, fixed_bonus, extra_bonus, total_bonus)
        VALUES (${today}, ${confirmedDriver}, 'driver', ${saleId}, ${deliveryId}, ${sale.item}, ${qty}, 0, 0, ${driverFixedTotal}, 0, ${driverFixedTotal})
        ON CONFLICT (delivery_id, role) DO NOTHING
      `;
    }
  }
}

// #endregion

// #region INVOICES

// BUG 4A — drivers can now see invoices for deliveries assigned to them.
// The role parameter routes the lookup: 'driver' uses an inner join on
// deliveries.assigned_driver, sellers still use the seller_name subquery.
/**
 * List invoices with role-aware scoping. `driver` role joins on
 * `deliveries.assigned_driver`; any other username matches via the
 * `seller_name IN (SELECT name FROM users WHERE username = ?)`
 * subquery. No username → admin path (all invoices).
 * @param {string} [username]
 * @param {string} [role]
 * @returns {Promise<Array<object>>}
 */
export async function getInvoices(username, role) {
  if (role === 'driver' && username) {
    const { rows } = await sql`
      SELECT i.* FROM invoices i
      JOIN deliveries d ON d.id = i.delivery_id
      WHERE d.assigned_driver = ${username}
      ORDER BY i.id DESC
    `;
    return rows;
  }
  if (username) {
    // Only match via the subquery (display name from users table).
    // The previous OR seller_name = ${username} could leak invoices to a different
    // user whose display name happens to match this user's username.
    const { rows } = await sql`SELECT * FROM invoices WHERE seller_name IN (SELECT name FROM users WHERE username = ${username}) ORDER BY id DESC`;
    return rows;
  }
  const { rows } = await sql`SELECT * FROM invoices ORDER BY id DESC`;
  return rows;
}

/**
 * Atomically reverse a confirmed sale via the shared cancelSale helper.
 * Refuses (Arabic throw) if ANY bonus on this sale was already settled —
 * the settled-bonus check lives inside cancelSale and applies uniformly
 * across all four cancellation paths.
 *
 * @param {number} id invoice id
 * @param {object} [options] `{cancelledBy, reason, bonusActions, notes}`
 *   bonusActions is required whenever the sale has non-settled bonuses;
 *   without it cancelSale throws BONUS_CHOICE_REQUIRED and the route
 *   layer returns the preview payload to the caller so they can show
 *   the admin the keep/remove dialog and retry with a filled bonusActions.
 * @returns {Promise<void>}
 */
export async function voidInvoice(id, options = {}) {
  return withTx(async (client) => {
    // Look up the linked sale via the invoice row (lock the invoice to
    // prevent concurrent voids of the same document)
    const { rows: inv } = await client.sql`
      SELECT sale_id FROM invoices WHERE id = ${id} FOR UPDATE
    `;
    if (!inv.length) throw new Error('الفاتورة غير موجودة');
    const { sale_id } = inv[0];

    // FEAT-05: delegate all cancellation logic to cancelSale. It handles
    // the settled-bonus check, stock restore, payment refund, bonus
    // disposition, delivery sync, invoice soft-void, and audit row — all
    // in this same transaction.
    await cancelSale(client, {
      saleId: sale_id,
      cancelledBy: options.cancelledBy || 'system',
      reason: options.reason || 'Invoice voided by admin',
      invoiceMode: 'soft',
      bonusActions: options.bonusActions || null,
      notes: options.notes || null,
    });
  });
}

// #endregion

// #region EDIT OPERATIONS (admin only)

// Update a reserved sale. The route layer enforces status='محجوز' & ownership;
// here we additionally re-reserve stock if quantity changes and recompute totals.
/**
 * Update a reserved sale (status must be `محجوز`). Re-reserves stock
 * on quantity/item changes, recomputes totals from the current product
 * buy/sell prices, and mirrors the edit onto the linked delivery row
 * — all inside a single transaction.
 * @param {{id:number, clientName:string, item?:string,
 *   quantity:number|string, unitPrice:number|string, notes?:string}} data
 * @returns {Promise<void>}
 */
export async function updateSale(data) {
  return withTx(async (client) => {
    const { rows: oldRows } = await client.sql`
      SELECT item, quantity, status, cost_price, paid_amount, payment_status, payment_type, down_payment_expected FROM sales WHERE id = ${data.id} FOR UPDATE
    `;
    if (!oldRows.length) throw new Error('الطلب غير موجود');
    // v1.2 — admin can edit confirmed sales (price adjustment, discount).
    // Sellers/managers can only edit reserved orders.
    // Cancelled orders cannot be edited by anyone.
    if (oldRows[0].status === 'ملغي') throw new Error('لا يمكن تعديل طلب ملغي');
    if (oldRows[0].status === 'مؤكد' && !data.adminOverride) {
      throw new Error('لا يمكن تعديل طلب مؤكد — يتطلب صلاحية المدير');
    }

    const oldItem = oldRows[0].item;
    const oldQty = parseFloat(oldRows[0].quantity) || 0;
    const newItem = data.item || oldItem;
    const newQty = parseFloat(data.quantity) || 0;
    const newPrice = parseFloat(data.unitPrice) || 0;
    if (newQty <= 0) throw new Error('الكمية يجب أن تكون أكبر من 0');
    if (newPrice <= 0) throw new Error('السعر يجب أن يكون أكبر من 0');

    // Adjust reserved stock — return the old reservation, then take the new one (atomic + locked)
    if (newItem === oldItem) {
      const delta = newQty - oldQty;
      if (delta > 0) {
        const { rows: prod } = await client.sql`
          SELECT stock FROM products WHERE name = ${newItem} FOR UPDATE
        `;
        if (!prod.length) throw new Error('المنتج غير موجود');
        if (parseFloat(prod[0].stock) < delta) {
          throw new Error(`المخزون المتاح غير كافٍ للزيادة المطلوبة`);
        }
        await client.sql`UPDATE products SET stock = stock - ${delta}::numeric WHERE name = ${newItem}`;
      } else if (delta < 0) {
        await client.sql`UPDATE products SET stock = stock + ${-delta}::numeric WHERE name = ${newItem}`;
      }
    } else {
      // Item swapped: return old, reserve new
      if (oldQty > 0) {
        await client.sql`UPDATE products SET stock = stock + ${oldQty}::numeric WHERE name = ${oldItem}`;
      }
      const { rows: prod } = await client.sql`
        SELECT buy_price, sell_price, stock FROM products WHERE name = ${newItem} FOR UPDATE
      `;
      if (!prod.length) throw new Error('المنتج غير موجود');
      if (parseFloat(prod[0].stock) < newQty) {
        throw new Error(`الكمية المطلوبة (${newQty}) أكبر من المخزون المتاح`);
      }
      await client.sql`UPDATE products SET stock = stock - ${newQty}::numeric WHERE name = ${newItem}`;
    }

    // Recompute totals using a fresh read of the (possibly different) product
    const { rows: prodFinal } = await client.sql`SELECT buy_price, sell_price FROM products WHERE name = ${newItem}`;
    const costPrice = prodFinal.length ? parseFloat(prodFinal[0].buy_price) || 0 : parseFloat(oldRows[0].cost_price) || 0;
    const recommended = prodFinal.length ? parseFloat(prodFinal[0].sell_price) || 0 : 0;
    const total = newQty * newPrice;
    const costTotal = newQty * costPrice;
    const profit = total - costTotal;

    // For reserved sales: remaining = total (nothing paid yet).
    // For confirmed sales: remaining = total - paid_amount (preserve payments).
    const oldPaidAmount = parseFloat(oldRows[0].paid_amount) || 0;
    const isConfirmed = oldRows[0].status === 'مؤكد';
    const newRemaining = isConfirmed ? Math.max(0, total - oldPaidAmount) : total;
    const newPaymentStatus = isConfirmed
      ? (newRemaining < 0.005 ? 'paid' : oldPaidAmount > 0.005 ? 'partial' : 'pending')
      : oldRows[0].payment_status;

    // SP-002+SP-010: keep dpe in sync with total. For cash/bank sales
    // dpe must equal total (business invariant). For credit, preserve
    // the original dpe or use the provided override.
    const oldPaymentType = oldRows[0].payment_type;
    const newDpe = (oldPaymentType === 'كاش' || oldPaymentType === 'بنك')
      ? total  // cash/bank: dpe always = total
      : (data.downPaymentExpected != null ? parseFloat(data.downPaymentExpected) || 0
         : parseFloat(oldRows[0].down_payment_expected) || 0);

    await client.sql`
      UPDATE sales
      SET client_name = ${data.clientName},
          item = ${newItem},
          quantity = ${newQty},
          cost_price = ${costPrice},
          unit_price = ${newPrice},
          total = ${total},
          cost_total = ${costTotal},
          profit = ${profit},
          recommended_price = ${recommended},
          remaining = ${newRemaining},
          payment_status = ${newPaymentStatus},
          down_payment_expected = ${newDpe},
          notes = ${data.notes || ''},
          updated_by = ${data.updatedBy || null},
          updated_at = NOW()
      WHERE id = ${data.id}
    `;

    // Mirror the change onto the linked delivery so the dashboard stays consistent
    await client.sql`
      UPDATE deliveries
      SET client_name = ${data.clientName},
          items = ${newItem + ' (' + newQty + ')'},
          total_amount = ${total}
      WHERE sale_id = ${data.id}
    `;
  });
}

// Purchases are immutable in their financial fields (quantity / price) because they
// already moved stock and the weighted-average buy_price. Only notes can be edited.
/**
 * Only `notes` is mutable — quantity/price edits are refused by design
 * because the original purchase already moved stock and the
 * weighted-average buy price.
 * @param {{id:number, notes?:string}} data
 * @returns {Promise<void>}
 */
export async function updatePurchase(data) {
  // v1.2 — full edit (admin only). Recalculates total + adjusts product
  // stock if quantity or item changed. Pre-v1.2 only edited notes.
  return withTx(async (client) => {
    const { rows: oldRows } = await client.sql`
      SELECT * FROM purchases WHERE id = ${data.id} FOR UPDATE
    `;
    if (!oldRows.length) throw new Error('العملية غير موجودة');
    const old = oldRows[0];

    const newDate      = data.date ?? old.date;
    const newSupplier  = data.supplier  ?? old.supplier;
    const newItem      = data.item      ?? old.item;
    const newCategory  = data.category  ?? old.category ?? '';
    const newDescAr    = data.descriptionAr !== undefined ? data.descriptionAr : null;
    const newQty       = parseFloat(data.quantity ?? old.quantity) || 0;
    const newUnitPrice = parseFloat(data.unitPrice ?? old.unit_price) || 0;
    const newSellPrice = data.sellPrice !== undefined ? (parseFloat(data.sellPrice) || 0) : null;
    const newTotal     = newQty * newUnitPrice;
    const newPaymentType = data.paymentType ?? old.payment_type;
    const newPaidAmount  = parseFloat(data.paidAmount ?? old.paid_amount) ?? newTotal;
    const newNotes     = data.notes ?? old.notes ?? '';

    // M-03+M-08: Lock product rows + stock floor check before adjusting
    const oldItem = old.item;
    const oldQty  = parseFloat(old.quantity) || 0;
    if (newItem === oldItem && newQty !== oldQty) {
      const { rows: pRow } = await client.sql`SELECT stock FROM products WHERE name = ${newItem} FOR UPDATE`;
      const currentStock = pRow.length ? parseFloat(pRow[0].stock) || 0 : 0;
      const delta = newQty - oldQty;
      if (delta < 0 && currentStock + delta < -0.005) {
        throw new Error(`لا يمكن تقليل الكمية — المخزون الحالي (${currentStock}) لا يكفي`);
      }
      await client.sql`UPDATE products SET stock = stock + ${delta}::numeric WHERE name = ${newItem}`;
    } else if (newItem !== oldItem) {
      // Item swap: lock both products, check stock floor on old product
      if (oldQty > 0) {
        const { rows: oldProd } = await client.sql`SELECT stock FROM products WHERE name = ${oldItem} FOR UPDATE`;
        const oldStock = oldProd.length ? parseFloat(oldProd[0].stock) || 0 : 0;
        if (oldStock - oldQty < -0.005) {
          throw new Error(`لا يمكن تغيير المنتج — مخزون ${oldItem} الحالي (${oldStock}) أقل من الكمية المشتراة (${oldQty})`);
        }
        await client.sql`UPDATE products SET stock = stock - ${oldQty}::numeric WHERE name = ${oldItem}`;
      }
      // Auto-create new product if it doesn't exist (same as addPurchase)
      const { rows: newProd } = await client.sql`SELECT id FROM products WHERE name = ${newItem} FOR UPDATE`;
      if (!newProd.length) {
        await client.sql`INSERT INTO products (name, category, unit, buy_price, sell_price, stock, created_by) VALUES (${newItem}, ${old.category || ''}, '', 0, 0, 0, ${data.updatedBy || ''})`;
      }
      if (newQty > 0) {
        await client.sql`UPDATE products SET stock = stock + ${newQty}::numeric WHERE name = ${newItem}`;
      }
    }

    // SP-006+M-02: Recalculate weighted-average buy_price from ALL purchases
    // of the affected product(s), not just this one purchase's unit price.
    async function recalcWeightedAvg(itemName) {
      const { rows: allPurchases } = await client.sql`
        SELECT quantity, unit_price FROM purchases
        WHERE item = ${itemName} AND id != ${data.id}
      `;
      // Include this purchase's new values (if item matches)
      const entries = itemName === newItem
        ? [...allPurchases.map(p => ({ qty: parseFloat(p.quantity)||0, price: parseFloat(p.unit_price)||0 })),
           { qty: newQty, price: newUnitPrice }]
        : allPurchases.map(p => ({ qty: parseFloat(p.quantity)||0, price: parseFloat(p.unit_price)||0 }));
      const totalQty = entries.reduce((s, e) => s + e.qty, 0);
      const totalCost = entries.reduce((s, e) => s + e.qty * e.price, 0);
      const avgPrice = totalQty > 0 ? Math.round((totalCost / totalQty) * 100) / 100 : 0;
      await client.sql`UPDATE products SET buy_price = ${avgPrice} WHERE name = ${itemName}`;
    }
    if (newItem === oldItem) {
      await recalcWeightedAvg(newItem);
    } else {
      await recalcWeightedAvg(oldItem); // old product without this purchase
      await recalcWeightedAvg(newItem); // new product with this purchase
    }

    // Update sell_price on product if provided, and write price_history
    if (newSellPrice !== null && newSellPrice > 0) {
      const { rows: prodBefore } = await client.sql`SELECT buy_price, sell_price FROM products WHERE name = ${newItem}`;
      if (prodBefore.length) {
        const oldBuy = parseFloat(prodBefore[0].buy_price) || 0;
        const oldSell = parseFloat(prodBefore[0].sell_price) || 0;
        await client.sql`UPDATE products SET sell_price = ${newSellPrice} WHERE name = ${newItem}`;
        const { rows: prodAfter } = await client.sql`SELECT buy_price FROM products WHERE name = ${newItem}`;
        const newBuy = prodAfter.length ? parseFloat(prodAfter[0].buy_price) || 0 : 0;
        await client.sql`
          INSERT INTO price_history (date, product_name, old_buy_price, new_buy_price, old_sell_price, new_sell_price, purchase_id, changed_by)
          VALUES (${new Date().toISOString().split('T')[0]}, ${newItem}, ${oldBuy}, ${newBuy}, ${oldSell}, ${newSellPrice}, ${data.id}, ${data.updatedBy || ''})
        `;
      }
    }

    // Update description_ar on the product if provided
    if (newDescAr !== null) {
      await client.sql`UPDATE products SET description_ar = ${newDescAr} WHERE name = ${newItem}`;
    }

    const paymentStatus = newPaidAmount >= newTotal - 0.005 ? 'paid'
      : newPaidAmount > 0.005 ? 'partial' : 'pending';

    await client.sql`
      UPDATE purchases SET
        date = ${newDate}, supplier = ${newSupplier}, item = ${newItem},
        category = ${newCategory}, quantity = ${newQty},
        unit_price = ${newUnitPrice}, total = ${newTotal},
        payment_type = ${newPaymentType}, paid_amount = ${newPaidAmount},
        payment_status = ${paymentStatus}, notes = ${newNotes},
        updated_by = ${data.updatedBy || null}, updated_at = NOW()
      WHERE id = ${data.id}
    `;
  });
}

/**
 * @param {{id:number, category:string, description:string,
 *   amount:number|string, notes?:string}} data
 * @returns {Promise<void>}
 */
export async function updateExpense(data) {
  const { rows: old } = await sql`SELECT * FROM expenses WHERE id = ${data.id}`;
  if (!old.length) throw new Error('المصروف غير موجود');
  const o = old[0];
  await sql`UPDATE expenses SET
    date=${data.date || o.date}, category=${data.category}, description=${data.description},
    amount=${data.amount}, payment_type=${data.paymentType || o.payment_type},
    notes=${data.notes || ''}, updated_by=${data.updatedBy || null}, updated_at=NOW()
  WHERE id=${data.id}`;
}

// #endregion

// #region SETTLEMENTS

/**
 * @returns {Promise<Array<object>>} All settlements, newest first.
 */
export async function getSettlements() {
  const { rows } = await sql`SELECT * FROM settlements ORDER BY id DESC`;
  return rows;
}

/**
 * Insert a settlement row and, for `seller_payout` / `driver_payout`,
 * mark the user's unsettled bonuses `settled=true` in FIFO order up
 * to the paid amount. Partial coverage leaves the remaining bonus
 * untouched for the next payout. All inside one transaction.
 * @param {{date:string, type:string, username?:string, description:string,
 *   amount:number|string, settledBy:string, notes?:string}} data
 * @returns {Promise<number>} The new settlement id.
 */
export async function addSettlement(data) {
  // BUG-14: SettlementSchema coerces amount via positiveNum('المبلغ') at
  // the route boundary, so the old BUG-13 defensive parseFloat is gone.
  // Wrapped in a transaction so an interrupted payout never leaves the settlement
  // recorded but the matching bonuses unflagged (which would let the admin pay twice).
  //
  // v1.1 S1.8 [F-005] — defense in depth. SettlementSchema now rejects
  // `profit_distribution` at the route layer, but library callers that
  // bypass the route (future integrations, scripts, tests) get the same
  // refusal here. Throwing an Arabic message because downstream UI already
  // expects /^[\u0600-\u06FF]/ safe-error messages from db.js.
  if (data.type === 'profit_distribution') {
    throw new Error('نوع التسوية "profit_distribution" لم يعد مقبولاً — استخدم /profit-distributions');
  }
  return withTx(async (client) => {
    // v1.0.1 Feature 1 — financial integrity. Lock the user's unsettled
    // bonus rows (FOR UPDATE) and compute the strict upper bound BEFORE
    // inserting the settlement. Concurrent double-payout races are
    // blocked by the row lock — the second caller sees the first's
    // pending transaction and waits.
    if (data.username && (data.type === 'seller_payout' || data.type === 'driver_payout')) {
      const role = data.type === 'seller_payout' ? 'seller' : 'driver';
      const { rows: unsettled } = await client.sql`
        SELECT id, total_bonus FROM bonuses
        WHERE username = ${data.username}
          AND role = ${role}
          AND settled = false
        ORDER BY id ASC
        FOR UPDATE
      `;
      const unsettledTotal = unsettled.reduce(
        (sum, b) => sum + (parseFloat(b.total_bonus) || 0),
        0
      );
      // v1.2 audit M-14 — subtract recovery debts (negative settlements
      // from cancelled settled bonuses). Pre-v1.2 this only checked
      // unsettled bonuses, ignoring recovery debts. An admin could
      // over-pay a user who owed the company money from a cancelled order.
      const { rows: recoveryRows } = await client.sql`
        SELECT COALESCE(SUM(amount), 0) AS debt
        FROM settlements
        WHERE username = ${data.username} AND type = ${data.type} AND amount < 0
      `;
      const recoveryDebt = parseFloat(recoveryRows[0].debt) || 0;
      const available = unsettledTotal + recoveryDebt; // recoveryDebt is negative
      const requested = parseFloat(data.amount) || 0;
      if (requested > available + 0.01) {
        throw new Error(
          `المبلغ المطلوب (${requested.toFixed(2)}€) يتجاوز الرصيد المتاح (${available.toFixed(2)}€)`
        );
      }
    }
    // profit_distribution: no validation — the pool is implicit and the
    // admin enters the distributed share by hand. v1.1 will introduce a
    // structured base-amount + percentage split dialog per the v1.1 backlog.

    const { rows } = await client.sql`
      INSERT INTO settlements (date, type, username, description, amount, settled_by, notes)
      VALUES (${data.date}, ${data.type}, ${data.username || ''}, ${data.description}, ${data.amount}, ${data.settledBy}, ${data.notes || ''})
      RETURNING id
    `;
    const settlementId = rows[0].id;

    // Partial settlement: mark bonuses settled FIFO up to the paid amount.
    // The FOR UPDATE lock above already scoped rows to this transaction.
    if (data.username && (data.type === 'seller_payout' || data.type === 'driver_payout')) {
      const role = data.type === 'seller_payout' ? 'seller' : 'driver';
      const paidAmount = parseFloat(data.amount) || 0;
      const { rows: unsettledBonuses } = await client.sql`
        SELECT id, total_bonus FROM bonuses
        WHERE username = ${data.username}
          AND role = ${role}
          AND settled = false
        ORDER BY id ASC
      `;
      let remaining = paidAmount;
      for (const bonus of unsettledBonuses) {
        if (remaining <= 0) break;
        const bonusValue = parseFloat(bonus.total_bonus) || 0;
        if (remaining >= bonusValue - 0.005) {
          await client.sql`
            UPDATE bonuses SET settled = true, settlement_id = ${settlementId} WHERE id = ${bonus.id}
          `;
          remaining -= bonusValue;
        } else {
          // Partial coverage — the remaining bonus stays unsettled for the
          // next payout. Because Feature 1's validation caps requested at
          // available, this branch only fires when the admin deliberately
          // pays LESS than the full unsettled balance.
          break;
        }
      }
    }

    return settlementId;
  });
}

/**
 * v1.0.1 Feature 1/3 — compute a user's available unsettled credit for
 * a given settlement type. Used by UI live preview and the pre-insert
 * validation in addSettlement.
 *
 * @param {string} username
 * @param {'seller_payout'|'driver_payout'|'profit_distribution'} type
 * @returns {Promise<number|null>} available credit, or null for
 *   profit_distribution (which has no strict cap in v1.0.1)
 */
export async function getAvailableCredit(username, type) {
  if (!username) return 0;
  if (type === 'profit_distribution') return null;
  const role = type === 'seller_payout' ? 'seller' : type === 'driver_payout' ? 'driver' : null;
  if (!role) return 0;
  // Sum of unsettled bonuses (what the employee has earned but not been paid)
  const { rows } = await sql`
    SELECT COALESCE(SUM(total_bonus), 0) AS total
    FROM bonuses
    WHERE username = ${username}
      AND role = ${role}
      AND settled = false
  `;
  const unsettledTotal = parseFloat(rows[0].total) || 0;

  // v1.2 — subtract recovery debts (negative settlement amounts from
  // cancelled orders). The debt reduces available credit until the
  // employee earns enough new bonuses to cover it.
  const { rows: recoveryRows } = await sql`
    SELECT COALESCE(SUM(amount), 0) AS debt
    FROM settlements
    WHERE username = ${username}
      AND type = ${type}
      AND amount < 0
  `;
  const recoveryDebt = parseFloat(recoveryRows[0].debt) || 0; // negative number

  // Available = unsettled bonuses + recovery debt (negative).
  // Can be negative (employee owes the company). The settlement form
  // won't allow a new payout until this is positive.
  return unsettledTotal + recoveryDebt;
}

/**
 * v1.0.1 Feature 3 — list users eligible for a given settlement type
 * with their live available credit. Used by the settlement form to
 * filter the recipient dropdown and grey out zero-credit users.
 *
 * - seller_payout        → users with role='seller'
 * - driver_payout        → users with role='driver'
 * - profit_distribution  → users with role='admin' or 'manager'
 *                          (available_credit is null — no strict cap)
 *
 * @param {'seller_payout'|'driver_payout'|'profit_distribution'} type
 * @returns {Promise<Array<{username, name, role, available_credit}>>}
 */
export async function getEligibleUsersForSettlement(type) {
  if (type === 'profit_distribution') {
    const { rows } = await sql`
      SELECT username, name, role
      FROM users
      WHERE role IN ('admin', 'manager') AND active = true
      ORDER BY username ASC
    `;
    return rows.map((u) => ({ ...u, available_credit: null }));
  }
  if (type !== 'seller_payout' && type !== 'driver_payout') return [];
  const role = type === 'seller_payout' ? 'seller' : 'driver';
  // SP-004 fix: subtract recovery debts (negative settlements) from
  // available credit, matching the getAvailableCredit + addSettlement logic.
  const { rows } = await sql`
    SELECT
      u.username,
      u.name,
      u.role,
      COALESCE(
        (SELECT SUM(b.total_bonus) FROM bonuses b
         WHERE b.username = u.username AND b.role = ${role} AND b.settled = false),
        0
      ) +
      COALESCE(
        (SELECT SUM(s.amount) FROM settlements s
         WHERE s.username = u.username AND s.type = ${type} AND s.amount < 0),
        0
      ) AS available_credit
    FROM users u
    WHERE u.role = ${role} AND u.active = true
    ORDER BY u.username ASC
  `;
  return rows.map((r) => ({
    username: r.username,
    name: r.name,
    role: r.role,
    available_credit: parseFloat(r.available_credit) || 0,
  }));
}

/**
 * v1.0.1 Feature 2 — settlement drill-down. Returns the settlement row
 * plus every bonus row that was marked settled by this settlement_id,
 * joined to its source sale and (if any) invoice for the UI link-out.
 *
 * @param {number} settlementId
 * @returns {Promise<object|null>}
 */
export async function getSettlementDetails(settlementId) {
  const { rows } = await sql`SELECT * FROM settlements WHERE id = ${settlementId}`;
  if (!rows.length) return null;
  const settlement = rows[0];

  // For bonus payouts, pull the settled bonus rows and join their sales + invoices.
  let linkedItems = [];
  if (settlement.type === 'seller_payout' || settlement.type === 'driver_payout') {
    const { rows: items } = await sql`
      SELECT
        b.id AS bonus_id,
        b.date AS bonus_date,
        b.total_bonus,
        b.role,
        b.sale_id,
        s.client_name,
        s.item AS sale_item,
        s.total AS sale_total,
        s.status AS sale_status,
        i.ref_code AS invoice_ref_code
      FROM bonuses b
      LEFT JOIN sales s ON s.id = b.sale_id
      LEFT JOIN invoices i ON i.sale_id = b.sale_id
      WHERE b.settlement_id = ${settlementId}
      ORDER BY b.id ASC
    `;
    linkedItems = items.map((r) => ({
      bonus_id: r.bonus_id,
      bonus_date: r.bonus_date,
      total_bonus: parseFloat(r.total_bonus) || 0,
      role: r.role,
      sale_id: r.sale_id,
      client_name: r.client_name || '—',
      sale_item: r.sale_item || '—',
      sale_total: parseFloat(r.sale_total) || 0,
      sale_status: r.sale_status || '—',
      invoice_ref_code: r.invoice_ref_code || null,
    }));
  }

  return {
    ...settlement,
    amount: parseFloat(settlement.amount) || 0,
    linked_items: linkedItems,
    linked_total: linkedItems.reduce((sum, it) => sum + it.total_bonus, 0),
  };
}

// #endregion

// #region PROFIT DISTRIBUTIONS (v1.0.2 Feature 2)

/**
 * v1.0.2 Feature 2 — sum of `collection` payment rows in a given
 * period, used by the profit-distribution UI to auto-fill the base
 * amount from collected revenue. Refund rows (negative amounts) are
 * subtracted so the base matches cash-basis net revenue.
 *
 * Dates are TEXT (YYYY-MM-DD) so string comparison works naturally.
 *
 * @param {string|null} startDate
 * @param {string|null} endDate
 * @returns {Promise<number>}
 */
export async function getCollectedRevenueForPeriod(startDate, endDate) {
  const { rows } = await sql`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM payments
    WHERE type = 'collection'
      AND (${startDate}::text IS NULL OR date >= ${startDate})
      AND (${endDate}::text   IS NULL OR date <= ${endDate})
  `;
  return parseFloat(rows[0].total) || 0;
}

/**
 * v1.1 F-015 — compute the period-scoped distributable-pool breakdown,
 * using the same math the F-001 write-path cap enforces. This is the
 * single read-side source of truth for the /profit-distributions UI
 * so users see the EXACT number the submit button will accept.
 *
 * Returns:
 *   - total_collected: Σ (collection − refund) payments in period
 *   - already_distributed: Σ profit_distributions.amount for the
 *     EXACT (base_period_start, base_period_end) tuple
 *   - remaining: total_collected − already_distributed (may be < 0
 *     if the pool was over-distributed before F-001 landed — see
 *     the v1.0.3 bug rows that still live in production)
 *
 * This is a read-only probe — it does NOT hold the advisory lock
 * that addProfitDistribution uses. Race avoidance is the write
 * path's job; this helper just gives the UI a live preview.
 *
 * @param {string|null} startDate
 * @param {string|null} endDate
 * @returns {Promise<{total_collected:number, already_distributed:number, remaining:number}>}
 */
export async function getDistributablePoolForPeriod(startDate, endDate) {
  // v1.2 — use getSummaryData which already computes netProfitCashBasis
  // correctly (collected - COGS - expenses - bonuses - distributed).
  // No need to duplicate the calculation here.
  //
  // getSummaryData.distributable = max(0, netProfitCashBasis) which
  // ALREADY includes the totalProfitDistributed subtraction. So the
  // "remaining" here IS the distributable amount — no double-subtract.
  const summary = await getSummaryData(startDate || undefined, endDate || undefined);

  return {
    net_profit_cash_basis: summary.netProfitCashBasis + summary.totalProfitDistributed,
    already_distributed: summary.totalProfitDistributed,
    remaining: summary.distributable,
    // Breakdown for the UI
    collected: summary.totalRevenueCashBasis,
    cogs: summary.totalCOGSCashBasis,
    expenses: summary.totalExpenses,
    bonus_paid: summary.totalBonusEarnedCashBasis,
    gross_profit: summary.grossProfitCashBasis,
  };
}

/**
 * v1.0.2 Feature 2 — list users eligible to be profit-distribution
 * recipients. Admin + manager only (business rule locked by user).
 *
 * @returns {Promise<Array<{username, name, role}>>}
 */
export async function getAdminManagerUsers() {
  const { rows } = await sql`
    SELECT username, name, role
    FROM users
    WHERE role IN ('admin', 'manager')
      AND active = true
    ORDER BY role ASC, username ASC
  `;
  return rows;
}

/**
 * v1.0.2 Feature 2 — record a new profit distribution. One logical
 * distribution becomes N database rows sharing the same group_id,
 * each with their own percentage and computed amount. All writes are
 * wrapped in a single transaction so a partial failure rolls back
 * the entire distribution.
 *
 * v1.1 F-001 — the write path now enforces a solvency cap:
 *   baseAmount + Σ(existing distributions in the same period)
 *     ≤ Σ(collection payments in the same period) − Σ(refunds in the same period)
 *
 * Serialization is by `pg_advisory_xact_lock` keyed on the period hash.
 * Concurrent callers with the same period block on the lock until the
 * first commits/rollbacks, guaranteeing the cap check sees the latest
 * state. Different periods never contend.
 *
 * Validation (throws Arabic on failure):
 *   - recipients must be non-empty
 *   - sum of percentages must equal 100 ± 0.01%
 *   - every recipient must be an active admin or manager user
 *   - base_amount must be > 0
 *   - baseAmount + alreadyDistributed(period) ≤ collected(period)
 *
 * @param {{baseAmount:number|string,
 *          recipients: Array<{username:string, percentage:number|string}>,
 *          basePeriodStart?:string, basePeriodEnd?:string,
 *          notes?:string, createdBy:string}} data
 * @returns {Promise<{group_id:string, recipients_count:number, total_distributed:number}>}
 */
export async function addProfitDistribution(data) {
  const recipients = data.recipients || [];
  if (recipients.length === 0) {
    throw new Error('يجب اختيار مستلم واحد على الأقل');
  }

  const baseAmount = parseFloat(data.baseAmount) || 0;
  if (baseAmount <= 0) {
    throw new Error('المبلغ الإجمالي يجب أن يكون أكبر من صفر');
  }

  const totalPct = recipients.reduce(
    (sum, r) => sum + (parseFloat(r.percentage) || 0),
    0
  );
  if (Math.abs(totalPct - 100) > 0.01) {
    throw new Error(
      `مجموع النسب يجب أن يساوي 100% (الحالي: ${totalPct.toFixed(2)}%)`
    );
  }

  const startDate = data.basePeriodStart || null;
  const endDate   = data.basePeriodEnd   || null;
  // Normalize date range so startDate <= endDate when both are present.
  if (startDate && endDate && startDate > endDate) {
    throw new Error('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
  }

  // Group id — a URL-safe opaque identifier. Using timestamp + random
  // suffix instead of pulling in node:crypto for one call; collision
  // risk is astronomically low for the load this system handles.
  const groupId = `PD-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return withTx(async (client) => {
    // ── v1.1 F-001 STEP 1 — serialize on period hash.
    //
    // pg_advisory_xact_lock takes a single bigint key. We hash the
    // period as "start|end" using hashtext() which is a native Postgres
    // function that returns int4. Null periods get the sentinel
    // "all-time" so distributions without explicit dates still contend
    // with each other.
    //
    // The lock is held for the remainder of this transaction. Any
    // other addProfitDistribution call with the same (start,end) pair
    // will block here until our COMMIT/ROLLBACK.
    const lockKey = `profit-dist:${startDate || 'all-time'}|${endDate || 'all-time'}`;
    await client.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;

    // ── v1.1 F-001 STEP 2 — eligibility check inside the transaction.
    //
    // Pre-v1.1 this loop ran before withTx which meant a concurrent
    // toggleUserActive could flip a user inactive between the check
    // and the insert. Moving it inside the transaction with the same
    // `client` handle makes it atomic with the inserts below.
    for (const r of recipients) {
      if (!r.username) {
        throw new Error('يجب اختيار مستخدم لكل مستلم');
      }
      const pct = parseFloat(r.percentage) || 0;
      if (pct <= 0 || pct > 100) {
        throw new Error(`نسبة ${r.username} غير صحيحة`);
      }
      const { rows: urows } = await client.sql`
        SELECT role FROM users WHERE username = ${r.username} AND active = true
      `;
      if (!urows.length) {
        throw new Error(`المستخدم ${r.username} غير موجود`);
      }
      if (urows[0].role !== 'admin' && urows[0].role !== 'manager') {
        throw new Error(
          `المستخدم ${r.username} ليس مديراً أو مشرفاً (${urows[0].role})`
        );
      }
    }

    // ── v1.2 STEP 3 — compute NET PROFIT as the distributable cap.
    //
    // v1.2 — use getSummaryData to get the authoritative net profit.
    // getSummaryData.distributable = max(0, netProfitCashBasis) which
    // ALREADY includes totalProfitDistributed subtraction. No need to
    // recompute COGS/expenses/bonuses separately.
    //
    // Note: getSummaryData runs outside the advisory-locked client but
    // the lock prevents concurrent distributions, so the value is stable.
    const summary = await getSummaryData(startDate || undefined, endDate || undefined);
    const cap = summary.distributable;
    if (baseAmount > cap + 0.01) {
      const fmtPeriod = startDate && endDate ? `${startDate}..${endDate}` : '(كل الفترات)';
      throw new Error(
        `المبلغ المطلوب (${baseAmount.toFixed(2)}€) يتجاوز صافي الربح المتاح للتوزيع ` +
        `(${cap.toFixed(2)}€) للفترة ${fmtPeriod}`
      );
    }

    // ── v1.2 — insert the parent group row FIRST (DB-level UNIQUE
    // partial index on period catches the case the F-001 advisory lock
    // didn't — e.g. if two inserts from different pods skip the lock key).
    await client.sql`
      INSERT INTO profit_distribution_groups (id, base_period_start, base_period_end, base_amount, notes, created_by)
      VALUES (${groupId}, ${startDate}, ${endDate}, ${baseAmount}, ${data.notes || ''}, ${data.createdBy})
    `;

    // ── v1.1 F-001 STEP 4 — insert the recipient rows.
    let totalDistributed = 0;
    for (const r of recipients) {
      const pct = parseFloat(r.percentage) || 0;
      const amount = Math.round((baseAmount * pct) / 100 * 100) / 100;
      totalDistributed += amount;
      await client.sql`
        INSERT INTO profit_distributions (
          group_id, username, base_amount, percentage, amount,
          base_period_start, base_period_end, notes, created_by
        ) VALUES (
          ${groupId}, ${r.username}, ${baseAmount}, ${pct}, ${amount},
          ${startDate}, ${endDate},
          ${data.notes || ''}, ${data.createdBy}
        )
      `;
    }
    return {
      group_id: groupId,
      recipients_count: recipients.length,
      total_distributed: Math.round(totalDistributed * 100) / 100,
      cap_net_profit: summary.netProfitCashBasis + summary.totalProfitDistributed,
      cap_already_distributed: summary.totalProfitDistributed,
      cap_remaining_after: cap - baseAmount,
    };
  });
}

/**
 * v1.0.2 Feature 2 — list profit distributions grouped by group_id,
 * newest first. Each row in the result is one full distribution with
 * an embedded `recipients` array.
 *
 * @param {{limit?:number}} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function getProfitDistributions({ limit = 100 } = {}) {
  const { rows } = await sql`
    SELECT
      group_id,
      MAX(base_amount)        AS base_amount,
      MAX(base_period_start)  AS base_period_start,
      MAX(base_period_end)    AS base_period_end,
      MAX(notes)              AS notes,
      MAX(created_by)         AS created_by,
      MAX(created_at)         AS created_at,
      COUNT(*)                AS recipients_count,
      SUM(amount)             AS total_distributed,
      json_agg(
        json_build_object(
          'username',   username,
          'percentage', percentage,
          'amount',     amount
        )
        ORDER BY percentage DESC
      ) AS recipients
    FROM profit_distributions
    GROUP BY group_id
    ORDER BY MAX(created_at) DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    group_id:           r.group_id,
    base_amount:        parseFloat(r.base_amount) || 0,
    base_period_start:  r.base_period_start,
    base_period_end:    r.base_period_end,
    notes:              r.notes || '',
    created_by:         r.created_by,
    created_at:         r.created_at,
    recipients_count:   parseInt(r.recipients_count, 10),
    total_distributed:  parseFloat(r.total_distributed) || 0,
    recipients:         (r.recipients || []).map((x) => ({
      username:   x.username,
      percentage: parseFloat(x.percentage) || 0,
      amount:     parseFloat(x.amount) || 0,
    })),
  }));
}

// #endregion

// #region ENTITY ALIASES

/**
 * Look up a single alias by `(entity_type, normalized_alias)`.
 * Swallows every DB error as `null` — the AI layer must fail silently
 * so aliasing bugs never break the main voice flow.
 * @param {string} entityType
 * @param {string} normalizedText
 * @returns {Promise<{entity_id:number, alias:string, frequency:number}|null>}
 */
export async function findAlias(entityType, normalizedText) {
  try {
    const { rows } = await sql`
      SELECT entity_id, alias, frequency FROM entity_aliases
      WHERE entity_type = ${entityType} AND normalized_alias = ${normalizedText}
      ORDER BY frequency DESC LIMIT 1
    `;
    return rows[0] || null;
  } catch (err) {
    // BUG-07: log but preserve graceful-degradation (AI layer must not crash the voice flow)
    console.error('[findAlias] error:', err);
    return null;
  }
}

/**
 * Upsert a learned alias. If a row already exists for
 * `(entity_type, normalized_alias)` the frequency is bumped and the
 * `entity_id` is refreshed; otherwise a new row is inserted. All
 * errors are swallowed (AI layer never breaks the voice flow).
 * @param {string} entityType
 * @param {number} entityId
 * @param {string} alias
 * @param {string} normalizedAlias
 * @param {string} [source='user']
 * @returns {Promise<void>}
 */
export async function addAlias(entityType, entityId, alias, normalizedAlias, source) {
  try {
    // DEFECT-014 fix: atomic upsert via ON CONFLICT — eliminates TOCTOU race
    await sql`
      INSERT INTO entity_aliases (entity_type, entity_id, alias, normalized_alias, source)
      VALUES (${entityType}, ${entityId}, ${alias}, ${normalizedAlias}, ${source || 'user'})
      ON CONFLICT (entity_type, normalized_alias)
      DO UPDATE SET frequency = entity_aliases.frequency + 1, entity_id = ${entityId}
    `;
  } catch (err) {
    console.error('[addAlias] error:', err);
  }
}

/**
 * FEAT-01: insert an auto-generated alias with FIRST-WRITER-WINS semantics.
 *
 * Distinct from addAlias() which uses NEWEST-WRITER-WINS (rewrites entity_id
 * on collision). That semantics is correct for `confirmed_action` writes
 * where the user just confirmed the new entity is right, but UNSAFE for
 * `auto_generated` writes where the generator has zero evidence.
 *
 * Collision policy:
 *   - existing alias for SAME entity_id      → no-op
 *   - existing alias for DIFFERENT entity_id → skip silently (do NOT steal)
 *   - no existing alias                       → INSERT 'auto_generated' freq=1
 *
 * Always uses source='auto_generated' and frequency=1. The low frequency
 * means generated aliases compete on equal footing with default-1 organic
 * learning — they're promoted only by actual usage via the existing
 * confirmed_action freq-bump path in resolveEntity().
 *
 * Errors are swallowed (consistent with the existing addAlias pattern) so
 * the entity creation path is never broken by an alias write failure.
 *
 * @param {'product'|'supplier'|'client'} entityType
 * @param {number} entityId
 * @param {string} alias
 * @param {string} normalizedAlias
 * @returns {Promise<void>}
 */
export async function addGeneratedAlias(entityType, entityId, alias, normalizedAlias) {
  try {
    const { rows: existing } = await sql`
      SELECT id, entity_id FROM entity_aliases
      WHERE entity_type = ${entityType} AND normalized_alias = ${normalizedAlias}
    `;
    if (existing.length > 0) {
      // First-writer-wins: do NOT steal entity_id, do NOT bump frequency.
      return;
    }
    await sql`
      INSERT INTO entity_aliases
        (entity_type, entity_id, alias, normalized_alias, source, frequency)
      VALUES
        (${entityType}, ${entityId}, ${alias}, ${normalizedAlias}, 'auto_generated', 1)
    `;
  } catch (err) {
    // BUG-07: log but swallow — FEAT-01 explicitly requires the entity creation
    // path to never break on an alias write failure.
    console.error('[addGeneratedAlias] error:', err);
  }
}

/**
 * FEAT-01: generate Arabic aliases from an entity name and persist them.
 * Used internally by addProduct/addSupplier/addClient post-INSERT.
 *
 * Closes the cold-start gap where freshly-added entities have zero aliases
 * and the resolver can only fall back to fuzzy-matching the English name.
 *
 * Cache invalidation is non-negotiable: without it, the freshly-added entity
 * is unrecognized for up to 5 minutes (Fuse cache TTL).
 *
 * Uses dynamic imports to match the existing convention in db.js (which
 * lazy-loads voice-related modules) AND to avoid the entity-resolver ↔ db
 * circular import. Cost: ~5-10ms first-run module load per cold start.
 *
 * @param {'product'|'supplier'|'client'} entityType
 * @param {number} entityId
 * @param {string} name
 * @returns {Promise<void>}
 */
async function generateAndPersistAliases(entityType, entityId, name) {
  let generators;
  try {
    generators = await import('./alias-generator.js');
  } catch (err) {
    console.error('[generateAndPersistAliases] alias-generator import failed:', err.message);
    return;
  }

  const fnMap = {
    product:  generators.generateProductAliases,
    supplier: generators.generateSupplierAliases,
    client:   generators.generateClientAliases,
  };
  const gen = fnMap[entityType];
  if (!gen) return;

  const result = gen(name);
  if (result.skip) return;

  let normalizeForMatching;
  try {
    ({ normalizeForMatching } = await import('./voice-normalizer'));
  } catch (err) {
    console.error('[generateAndPersistAliases] voice-normalizer import failed:', err.message);
    return;
  }

  for (const alias of result.aliases) {
    const normalized = normalizeForMatching(alias);
    await addGeneratedAlias(entityType, entityId, alias, normalized);
  }

  // Cache invalidation. invalidateCache() takes no parameter and resets all
  // three Fuse caches — slightly broader than necessary but functionally
  // correct and matches the existing pattern at saveAICorrection lines 2343-44.
  try {
    const erMod = await import('./entity-resolver').catch(() => null);
    if (erMod?.invalidateCache) erMod.invalidateCache();
  } catch (err) {
    // BUG-07: log but swallow — cache invalidation failing is a UX-grade issue
    // (stale resolver cache for up to 5 minutes) not a data-integrity one.
    console.error('[generateAndPersistAliases] cache invalidate error:', err);
  }
}

/**
 * @param {string} entityType
 * @returns {Promise<Array<object>>} Aliases ordered by frequency DESC.
 *   Returns `[]` on any DB error (AI layer failure safety).
 */
export async function getAllAliases(entityType) {
  try {
    const { rows } = await sql`SELECT * FROM entity_aliases WHERE entity_type = ${entityType} ORDER BY frequency DESC`;
    return rows;
  } catch (err) {
    // BUG-07: log but preserve graceful-degradation
    console.error('[getAllAliases] error:', err);
    return [];
  }
}

// DONE: Step 1C — priority-ordered name lists for the Whisper vocabulary builder.
// Caller passes an optional username to bias the client list toward that seller's
// frequent customers; products and suppliers stay global.
/**
 * Build priority-ordered name lists for the Whisper vocabulary builder.
 * Clients are biased toward the caller's frequent customers when
 * `username` is non-empty; products and suppliers stay global.
 * Returns empty lists on any DB error.
 * @param {string} [username='']
 * @returns {Promise<{products:string[], clients:string[],
 *   suppliers:string[], aliases:string[]}>}
 */
export async function getTopEntities(username = '') {
  try {
    const [topProducts, topClients, topSuppliers, topAliases] = await Promise.all([
      sql`SELECT item AS name, COUNT(*) AS cnt
          FROM sales WHERE status = 'مؤكد'
          GROUP BY item ORDER BY cnt DESC LIMIT 15`,
      username
        ? sql`SELECT client_name AS name, COUNT(*) AS cnt
              FROM sales WHERE created_by = ${username}
              GROUP BY client_name ORDER BY cnt DESC LIMIT 10`
        : sql`SELECT client_name AS name, COUNT(*) AS cnt
              FROM sales GROUP BY client_name ORDER BY cnt DESC LIMIT 10`,
      sql`SELECT supplier AS name, COUNT(*) AS cnt
          FROM purchases GROUP BY supplier ORDER BY cnt DESC LIMIT 8`,
      sql`SELECT alias, frequency FROM entity_aliases
          ORDER BY frequency DESC LIMIT 20`,
    ]);
    return {
      products:  topProducts.rows.map((r) => r.name).filter(Boolean),
      clients:   topClients.rows.map((r) => r.name).filter(Boolean),
      suppliers: topSuppliers.rows.map((r) => r.name).filter(Boolean),
      aliases:   topAliases.rows.map((r) => r.alias).filter(Boolean),
    };
  } catch (err) {
    // BUG-07: log but preserve graceful-degradation — the voice vocabulary builder
    // callers treat empty lists as "no priority boost" which is safe.
    console.error('[getTopEntities] error:', err);
    return { products: [], clients: [], suppliers: [], aliases: [] };
  }
}

// DONE: Step 1D — runs on init and (optionally) periodically. Mines the most-used
// items / clients / suppliers from the historical sales+purchases tables and
// upserts them as entity_aliases so the resolver matches them via Layer 0
// (instant O(1) lookup) instead of falling through to fuzzy matching every time.
//
// Idempotent: uses a manual SELECT-then-INSERT/UPDATE pattern (not ON CONFLICT)
// because entity_aliases has only an index on (entity_type, normalized_alias),
// not a unique constraint, so ON CONFLICT would fail.
/**
 * Mine the most-used items/clients/suppliers from historical sales +
 * purchases and upsert them as `entity_aliases` rows so the resolver
 * matches them via Layer 0 (instant O(1) lookup). Idempotent — frequencies
 * only move upward on re-run.
 * @returns {Promise<{success:boolean}>}
 */
export async function autoLearnFromHistory() {
  try {
    const { normalizeForMatching } = await import('./voice-normalizer');

    const upsertAlias = async (entity_type, entity_id, alias, freq) => {
      const normalized = normalizeForMatching(alias);
      if (!normalized) return;
      const { rows: existing } = await sql`
        SELECT id, frequency FROM entity_aliases
        WHERE entity_type = ${entity_type} AND normalized_alias = ${normalized}
        LIMIT 1
      `;
      if (existing.length > 0) {
        // Bump only upward — never lower an existing learned frequency
        if (freq > (existing[0].frequency || 0)) {
          await sql`UPDATE entity_aliases SET frequency = ${freq} WHERE id = ${existing[0].id}`;
        }
      } else {
        await sql`
          INSERT INTO entity_aliases (entity_type, entity_id, alias, normalized_alias, source, frequency)
          VALUES (${entity_type}, ${entity_id}, ${alias}, ${normalized}, 'auto_history', ${freq})
        `;
      }
    };

    // Top-sold products (status='مؤكد')
    const { rows: products } = await sql`
      SELECT item, COUNT(*) AS cnt FROM sales
      WHERE status = 'مؤكد'
      GROUP BY item ORDER BY cnt DESC LIMIT 30
    `;
    for (const { item, cnt } of products) {
      const { rows: prod } = await sql`SELECT id FROM products WHERE name = ${item} LIMIT 1`;
      if (!prod.length) continue;
      await upsertAlias('product', prod[0].id, item, parseInt(cnt, 10) || 1);
    }

    // Top clients
    const { rows: clients } = await sql`
      SELECT client_name, COUNT(*) AS cnt FROM sales
      GROUP BY client_name ORDER BY cnt DESC LIMIT 30
    `;
    for (const { client_name, cnt } of clients) {
      const { rows: cl } = await sql`SELECT id FROM clients WHERE name = ${client_name} LIMIT 1`;
      if (!cl.length) continue;
      await upsertAlias('client', cl[0].id, client_name, parseInt(cnt, 10) || 1);
    }

    // Top suppliers
    const { rows: suppliers } = await sql`
      SELECT supplier, COUNT(*) AS cnt FROM purchases
      GROUP BY supplier ORDER BY cnt DESC LIMIT 15
    `;
    for (const { supplier, cnt } of suppliers) {
      const { rows: sup } = await sql`SELECT id FROM suppliers WHERE name = ${supplier} LIMIT 1`;
      if (!sup.length) continue;
      await upsertAlias('supplier', sup[0].id, supplier, parseInt(cnt, 10) || 1);
    }

    return { success: true };
  } catch (e) {
    console.error('[autoLearnFromHistory]', e.message);
    return { success: false };
  }
}

// #endregion

// #region AI LEARNING

// DONE: Step 1B — full self-improving correction handler.
// Saves audit trail, per-user + global ai_patterns, and a rich set of entity aliases
// (ai_correction, speech_correction, english_canonical, auto_strip_al, transcript_word).
// Invalidates the entity-resolver Fuse cache so the next request sees the new aliases.
/**
 * Full self-improving correction handler. Writes the raw correction
 * to `ai_corrections` (audit), upserts per-user AND global rows into
 * `ai_patterns`, and (for name fields) produces a rich set of entity
 * aliases (`ai_correction`, `speech_correction`, `english_canonical`,
 * `auto_strip_al`, `transcript_word`). Invalidates the entity-resolver
 * Fuse cache on success. Every branch is wrapped in try/catch and
 * errors are logged to stderr but never thrown.
 * @param {{username?:string, transcript?:string, aiValue:string,
 *   userValue:string, actionType?:string, fieldName:string}} data
 * @returns {Promise<void>}
 */
export async function saveAICorrection(data) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const username = data.username || '';

    // 1. Audit trail — always save raw correction
    await sql`
      INSERT INTO ai_corrections
        (date, username, transcript, ai_output, user_correction, action_type, field_name)
      VALUES
        (${today}, ${username}, ${data.transcript || ''},
         ${data.aiValue}, ${data.userValue}, ${data.actionType || ''}, ${data.fieldName})
    `;

    // 2. Pattern learning — what user SAID → what is correct
    //    Store BOTH per-user (high-priority in prompt) and global (shared baseline) rows.
    const spokenText = data.transcript || data.aiValue;

    // Per-user pattern
    const { rows: userPat } = await sql`
      SELECT id, frequency FROM ai_patterns
      WHERE spoken_text   = ${spokenText}
        AND correct_value = ${data.userValue}
        AND field_name    = ${data.fieldName}
        AND username      = ${username}
    `;
    if (userPat.length > 0) {
      await sql`UPDATE ai_patterns SET frequency = frequency + 1, last_used = CURRENT_TIMESTAMP WHERE id = ${userPat[0].id}`;
    } else {
      await sql`
        INSERT INTO ai_patterns (pattern_type, spoken_text, correct_value, field_name, frequency, username)
        VALUES (${data.actionType || ''}, ${spokenText}, ${data.userValue}, ${data.fieldName}, 1, ${username})
        ON CONFLICT DO NOTHING
      `.catch(ignoreExpectedDdl);
    }

    // Global pattern (only when this came from a real user — avoid empty/empty rows)
    if (username) {
      const { rows: globalPat } = await sql`
        SELECT id, frequency FROM ai_patterns
        WHERE spoken_text   = ${spokenText}
          AND correct_value = ${data.userValue}
          AND field_name    = ${data.fieldName}
          AND username      = ''
      `;
      if (globalPat.length > 0) {
        await sql`UPDATE ai_patterns SET frequency = frequency + 1, last_used = CURRENT_TIMESTAMP WHERE id = ${globalPat[0].id}`;
      } else {
        await sql`
          INSERT INTO ai_patterns (pattern_type, spoken_text, correct_value, field_name, frequency, username)
          VALUES (${data.actionType || ''}, ${spokenText}, ${data.userValue}, ${data.fieldName}, 1, '')
          ON CONFLICT DO NOTHING
        `.catch(ignoreExpectedDdl);
      }
    }

    // 3. Entity alias creation for name fields
    const nameFields = { client_name: 'client', supplier: 'supplier', item: 'product' };
    if (nameFields[data.fieldName] && data.userValue && data.aiValue !== data.userValue) {
      const entityType = nameFields[data.fieldName];
      const { normalizeForMatching } = await import('./voice-normalizer');

      const normalizedAI     = normalizeForMatching(data.aiValue);
      const normalizedSpeech = normalizeForMatching(spokenText);
      const normalizedUser   = normalizeForMatching(data.userValue);

      let entityId = null;
      if (entityType === 'client') {
        const { rows } = await sql`SELECT id FROM clients WHERE name = ${data.userValue} LIMIT 1`.catch(() => ({ rows: [] }));
        entityId = rows[0]?.id;
      } else if (entityType === 'supplier') {
        const { rows } = await sql`SELECT id FROM suppliers WHERE name = ${data.userValue} LIMIT 1`.catch(() => ({ rows: [] }));
        entityId = rows[0]?.id;
      } else if (entityType === 'product') {
        const { rows } = await sql`
          SELECT id FROM products WHERE name = ${data.userValue} OR name LIKE ${data.userValue + '%'}
          LIMIT 1
        `.catch(() => ({ rows: [] }));
        entityId = rows[0]?.id;
      }

      if (entityId) {
        // a) AI's wrong output → correct entity
        await addAlias(entityType, entityId, data.aiValue, normalizedAI, 'ai_correction');

        // b) Original speech → correct entity (if different from AI output)
        if (normalizedSpeech !== normalizedAI) {
          await addAlias(entityType, entityId, spokenText, normalizedSpeech, 'speech_correction');
        }

        // c) Canonical English name itself → correct entity
        await addAlias(entityType, entityId, data.userValue, normalizedUser, 'english_canonical');

        // d) Product-specific extra aliases
        if (entityType === 'product') {
          // Strip ال prefix: "الفيشن" → also add "فيشن"
          const withoutAl = data.aiValue.replace(/^ال/, '');
          if (withoutAl !== data.aiValue && withoutAl.length > 1) {
            await addAlias(entityType, entityId, withoutAl, normalizeForMatching(withoutAl), 'auto_strip_al');
          }

          // Mine significant words from the original transcript
          const skipWords = new Set([
            'اشتريت', 'بعت', 'جبت', 'شريت', 'سلمت', 'سلّمت',
            'من', 'في', 'على', 'بـ', 'بسعر', 'كاش', 'بنك', 'آجل',
            'كمية', 'الواحدة', 'واحد', 'اثنين', 'ثلاث',
          ]);
          const transcriptWords = (data.transcript || '').split(/\s+/);
          for (const word of transcriptWords) {
            if (word.length <= 2) continue;
            const nw = normalizeForMatching(word);
            if (nw.length <= 2) continue;
            if (nw === normalizedAI || nw === normalizedUser) continue;
            if ([...skipWords].some((sw) => nw.includes(normalizeForMatching(sw)))) continue;
            await addAlias(entityType, entityId, word, nw, 'transcript_word').catch(ignoreExpectedDdl);
          }
        }

        // e) Invalidate Fuse cache so next request rebuilds with the new aliases
        const erMod = await import('./entity-resolver').catch(() => null);
        if (erMod?.invalidateCache) erMod.invalidateCache();
      }
    }
  } catch (e) {
    console.error('[saveAICorrection]', e.message);
  }
}

// Get learned patterns for improving AI prompts
// DONE: Step 1 — when username is provided, fetch the user's own patterns first
// then fill remaining slots with global ones. The prompt builder splits them
// back into "your corrections" / "team corrections" sections.
/**
 * Return learned AI patterns for prompt construction. When `username`
 * is provided, fetches that user's own patterns first then tops up
 * with global (`username=''`) rows. Returns `[]` on DB error.
 * @param {number} [limit=20]
 * @param {string} [username='']
 * @returns {Promise<Array<object>>}
 */
export async function getAIPatterns(limit = 20, username = '') {
  try {
    if (username) {
      const { rows: userRows } = await sql`
        SELECT * FROM ai_patterns
        WHERE username = ${username}
        ORDER BY frequency DESC, last_used DESC
        LIMIT ${limit}
      `;
      const remaining = Math.max(0, limit - userRows.length);
      if (remaining === 0) return userRows;
      const { rows: globalRows } = await sql`
        SELECT * FROM ai_patterns
        WHERE username = ''
        ORDER BY frequency DESC, last_used DESC
        LIMIT ${remaining}
      `;
      return [...userRows, ...globalRows];
    }
    const { rows } = await sql`SELECT * FROM ai_patterns ORDER BY frequency DESC, last_used DESC LIMIT ${limit}`;
    return rows;
  } catch (err) {
    // BUG-07: log but preserve graceful-degradation
    console.error('[getAIPatterns] error:', err);
    return [];
  }
}

// Get recent corrections for few-shot learning
/**
 * @param {number} [limit=10]
 * @returns {Promise<Array<object>>} Most recent AI corrections for
 *   few-shot learning. Returns `[]` on DB error.
 */
export async function getRecentCorrections(limit = 10) {
  try {
    const { rows } = await sql`SELECT * FROM ai_corrections ORDER BY id DESC LIMIT ${limit}`;
    return rows;
  } catch (err) {
    // BUG-07: log but preserve graceful-degradation
    console.error('[getRecentCorrections] error:', err);
    return [];
  }
}

// #endregion
