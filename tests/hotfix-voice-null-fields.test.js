// Hotfix 2026-04-14: Zod v4 schemas must accept null on optional fields.
//
// Production voice flow broke after Session 4 wired Zod validation.
// VoiceConfirm.js sends empty optional fields as null (not undefined),
// and Zod v4's .optional() rejects null. The fix adds a `nullable()`
// preprocess wrapper in lib/schemas.js that converts null → undefined
// BEFORE the inner schema runs, so .optional() / .default() / .transform()
// all behave naturally.
//
// These tests exercise the exact production HAR body shape captured when
// the voice purchase flow returned 400 "Invalid input: expected string,
// received null". They're the regression guard against this coming back.
//
// Run with: npx vitest run tests/hotfix-voice-null-fields.test.js

import { describe, test, expect } from 'vitest';
import {
  PurchaseSchema,
  SaleSchema,
  ClientSchema,
  SupplierSchema,
  ExpenseSchema,
  ProductSchema,
} from '@/lib/schemas';

describe('hotfix: Zod schemas accept null on optional fields', () => {
  // ── PurchaseSchema — the route that actually broke in production ─────
  test('PurchaseSchema accepts null notes', () => {
    const result = PurchaseSchema.safeParse({
      date: '2026-04-14',
      supplier: 'TEST',
      item: 'V20 PRO',
      category: 'دراجات كهربائية',
      quantity: 2,
      unitPrice: 600,
      sellPrice: 950,
      paymentType: 'كاش',
      notes: null,
    });
    expect(result.success).toBe(true);
  });

  test('PurchaseSchema accepts null paymentType (falls back to default كاش)', () => {
    const result = PurchaseSchema.safeParse({
      date: '2026-04-14',
      supplier: 'TEST',
      item: 'V20 PRO',
      category: 'دراجات كهربائية',
      quantity: 2,
      unitPrice: 600,
      sellPrice: 950,
      paymentType: null,
    });
    expect(result.success).toBe(true);
    // nullable() → preprocess null → undefined → .default('كاش') fires
    expect(result.data.paymentType).toBe('كاش');
  });

  test('PurchaseSchema accepts null sellPrice (falls back to default 0)', () => {
    const result = PurchaseSchema.safeParse({
      date: '2026-04-14',
      supplier: 'TEST',
      item: 'V20 PRO',
      category: 'دراجات كهربائية',
      quantity: 2,
      unitPrice: 600,
      sellPrice: null,
      paymentType: 'كاش',
    });
    expect(result.success).toBe(true);
    expect(result.data.sellPrice).toBe(0);
  });

  test('PurchaseSchema still rejects missing required category', () => {
    const result = PurchaseSchema.safeParse({
      date: '2026-04-14',
      supplier: 'TEST',
      item: 'V20 PRO',
      quantity: 2,
      unitPrice: 600,
      sellPrice: 950,
      paymentType: 'كاش',
    });
    // Category is required — the nullable() fix must NOT relax it.
    // (Zod v4 may report either the .min() message or a default
    // "expected string, received undefined" depending on whether the
    // field was present as empty string or missing entirely. We care
    // that the overall validation failed, not which message fired.)
    expect(result.success).toBe(false);
  });

  test('PurchaseSchema still rejects invalid paymentType enum (non-null non-default)', () => {
    const result = PurchaseSchema.safeParse({
      date: '2026-04-14',
      supplier: 'TEST',
      item: 'V20 PRO',
      category: 'دراجات كهربائية',
      quantity: 2,
      unitPrice: 600,
      sellPrice: 950,
      paymentType: 'bitcoin',
    });
    expect(result.success).toBe(false);
  });

  test('PurchaseSchema tolerates real production HAR body shape (duplicate snake_case + camelCase keys, null fields)', () => {
    // Exact body captured from the 2026-04-14 production voice failure:
    // VoiceConfirm.js sent both the snake_case and camelCase versions of
    // the same fields, with several nulls mixed in. Zod default behavior
    // strips unknown keys (no .strict()), and the nullable() wrapper
    // tolerates null on the camelCase fields that ARE in the schema.
    const result = PurchaseSchema.safeParse({
      supplier: 'WAHID',
      item: 'V20 PRO',
      quantity: 2,
      unit_price: 600,       // stripped (not in schema — camelCase wins)
      sell_price: 950,       // stripped
      category: 'دراجات كهربائية',
      payment_type: null,    // stripped
      notes: null,           // passes via nullable() → default ''
      sellPrice: 950,        // kept
      date: '2026-04-14',
      unitPrice: 600,        // kept
      paymentType: 'كاش',   // kept
    });
    expect(result.success).toBe(true);
    // Verify it picked up the camelCase values, not the null snake_case ones
    expect(result.data.paymentType).toBe('كاش');
    expect(result.data.unitPrice).toBe(600);
    expect(result.data.sellPrice).toBe(950);
    expect(result.data.notes).toBe(''); // null → default ''
  });

  // ── SaleSchema — same nullable treatment ──────────────────────────────
  test('SaleSchema accepts null clientPhone + clientEmail + clientAddress + notes', () => {
    const result = SaleSchema.safeParse({
      date: '2026-04-14',
      clientName: 'TEST',
      item: 'V20 PRO',
      quantity: 1,
      unitPrice: 950,
      paymentType: 'كاش',
      clientPhone: null,
      clientEmail: null,
      clientAddress: null,
      notes: null,
    });
    expect(result.success).toBe(true);
    expect(result.data.clientPhone).toBe('');
    expect(result.data.clientEmail).toBe('');
  });

  test('SaleSchema accepts null downPaymentExpected via optionalNum', () => {
    const result = SaleSchema.safeParse({
      date: '2026-04-14',
      clientName: 'TEST',
      item: 'V20 PRO',
      quantity: 1,
      unitPrice: 950,
      paymentType: 'كاش',
      downPaymentExpected: null,
    });
    expect(result.success).toBe(true);
    expect(result.data.downPaymentExpected).toBeUndefined();
  });

  // ── ClientSchema + SupplierSchema ────────────────────────────────────
  test('ClientSchema accepts null phone + email + address + notes', () => {
    const result = ClientSchema.safeParse({
      name: 'TEST',
      phone: null,
      email: null,
      address: null,
      notes: null,
    });
    expect(result.success).toBe(true);
  });

  test('SupplierSchema accepts null phone + address + notes', () => {
    const result = SupplierSchema.safeParse({
      name: 'TEST',
      phone: null,
      address: null,
      notes: null,
    });
    expect(result.success).toBe(true);
  });

  // ── ExpenseSchema + ProductSchema ────────────────────────────────────
  test('ExpenseSchema accepts null notes', () => {
    const result = ExpenseSchema.safeParse({
      date: '2026-04-14',
      category: 'إيجار',
      description: 'إيجار المحل',
      amount: 500,
      paymentType: 'كاش',
      notes: null,
    });
    expect(result.success).toBe(true);
  });

  test('ProductSchema accepts null category + notes (voice-created product)', () => {
    const result = ProductSchema.safeParse({
      name: 'V20 PRO',
      category: null,
      notes: null,
    });
    expect(result.success).toBe(true);
    expect(result.data.category).toBe('');
  });
});
