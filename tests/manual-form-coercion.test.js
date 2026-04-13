// BUG-13: Zod schemas now coerce string-to-number on numeric fields so
// React <input type="number"> string values are accepted on the manual
// form path. Voice path was already immune because it pre-coerces in
// /api/voice/extract|process.
//
// One case per schema for each input mode:
//   - STRING mode   — simulates the manual form path (React raw e.target.value)
//   - NUMBER mode   — regression check that the voice/programmatic path still works
//
// Run with: npx vitest run tests/manual-form-coercion.test.js

import { describe, it, expect } from 'vitest';
import {
  PurchaseSchema,
  SaleSchema,
  ExpenseSchema,
  PaymentSchema,
  DeliveryUpdateSchema,
  SaleUpdateSchema,
} from '../lib/schemas.js';

describe('Manual form coercion — string-to-number on numeric fields', () => {
  describe('PurchaseSchema', () => {
    it('accepts string numerics from React form input', () => {
      const result = PurchaseSchema.safeParse({
        date: '2026-04-13',
        supplier: 'سامي',
        item: 'V20 Pro',
        category: 'دراجات كهربائية',
        quantity: '5',
        unitPrice: '600',
        sellPrice: '900',
        paymentType: 'كاش',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.quantity).toBe('number');
        expect(result.data.quantity).toBe(5);
        expect(typeof result.data.unitPrice).toBe('number');
        expect(result.data.unitPrice).toBe(600);
        expect(typeof result.data.sellPrice).toBe('number');
        expect(result.data.sellPrice).toBe(900);
      }
    });

    it('still accepts real numbers (voice path regression)', () => {
      const result = PurchaseSchema.safeParse({
        date: '2026-04-13',
        supplier: 'سامي',
        item: 'V20 Pro',
        category: 'دراجات كهربائية',
        quantity: 5,
        unitPrice: 600,
        sellPrice: 900,
        paymentType: 'كاش',
      });
      expect(result.success).toBe(true);
    });

    it('rejects garbage string with useful error', () => {
      const result = PurchaseSchema.safeParse({
        date: '2026-04-13',
        supplier: 'سامي',
        item: 'V20 Pro',
        category: 'دراجات كهربائية',
        quantity: 'abc',
        unitPrice: '600',
        paymentType: 'كاش',
      });
      expect(result.success).toBe(false);
    });

    it('handles optional sellPrice missing', () => {
      const result = PurchaseSchema.safeParse({
        date: '2026-04-13',
        supplier: 'سامي',
        item: 'V20 Pro',
        category: 'دراجات كهربائية',
        quantity: '5',
        unitPrice: '600',
        paymentType: 'كاش',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sellPrice).toBe(0);
      }
    });
  });

  describe('SaleSchema', () => {
    it('accepts string numerics', () => {
      const result = SaleSchema.safeParse({
        date: '2026-04-13',
        clientName: 'أحمد',
        item: 'V20 Pro',
        quantity: '2',
        unitPrice: '1500',
        paymentMethod: 'كاش',
        paymentType: 'كاش',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.quantity).toBe('number');
        expect(typeof result.data.unitPrice).toBe('number');
      }
    });

    it('still accepts real numbers', () => {
      const result = SaleSchema.safeParse({
        date: '2026-04-13',
        clientName: 'أحمد',
        item: 'V20 Pro',
        quantity: 2,
        unitPrice: 1500,
        paymentMethod: 'كاش',
        paymentType: 'كاش',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ExpenseSchema', () => {
    it('accepts string amount', () => {
      const result = ExpenseSchema.safeParse({
        date: '2026-04-13',
        category: 'إيجار',
        description: 'إيجار شهري',
        amount: '500',
        paymentType: 'كاش',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.amount).toBe('number');
        expect(result.data.amount).toBe(500);
      }
    });

    it('still accepts real number', () => {
      const result = ExpenseSchema.safeParse({
        date: '2026-04-13',
        category: 'إيجار',
        description: 'إيجار شهري',
        amount: 500,
        paymentType: 'كاش',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('PaymentSchema', () => {
    it('accepts string amount', () => {
      const result = PaymentSchema.safeParse({
        date: '2026-04-13',
        clientName: 'أحمد',
        amount: '300',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.amount).toBe('number');
      }
    });

    it('accepts string saleId when present', () => {
      const result = PaymentSchema.safeParse({
        date: '2026-04-13',
        clientName: 'أحمد',
        amount: '300',
        saleId: '42',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.saleId).toBe('number');
        expect(result.data.saleId).toBe(42);
      }
    });
  });

  describe('DeliveryUpdateSchema', () => {
    it('accepts string totalAmount and string id', () => {
      const result = DeliveryUpdateSchema.safeParse({
        id: '5',
        date: '2026-04-13',
        clientName: 'أحمد',
        items: 'V20 Pro (1)',
        status: 'تم التوصيل',
        totalAmount: '1500',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.totalAmount).toBe('number');
        expect(typeof result.data.id).toBe('number');
      }
    });
  });

  describe('SaleUpdateSchema', () => {
    it('accepts string id, quantity, unitPrice', () => {
      const result = SaleUpdateSchema.safeParse({
        id: '12',
        date: '2026-04-13',
        clientName: 'أحمد',
        item: 'V20 Pro',
        quantity: '3',
        unitPrice: '1500',
        paymentMethod: 'كاش',
        paymentType: 'كاش',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.id).toBe('number');
        expect(typeof result.data.quantity).toBe('number');
        expect(typeof result.data.unitPrice).toBe('number');
      }
    });
  });
});
