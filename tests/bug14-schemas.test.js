// BUG-14: Zod schema unit tests for the 6 previously-unvalidated write
// routes. Pure shape tests — no DB, no network. Exercises the happy path,
// required-field enforcement, type coercion, and enum rejection for each
// of the new schemas added to lib/schemas.js.
//
// Also covers the SaleUpdateSchema downPaymentExpected patch (Session 3
// drive-by) and the defensive ClientUpdateSchema (no UI caller today).
//
// Run with: npx vitest run tests/bug14-schemas.test.js

import { describe, test, expect } from 'vitest';
import {
  ProductSchema,
  ProductUpdateSchema,
  ClientSchema,
  ClientUpdateSchema,
  SupplierSchema,
  UserSchema,
  UserUpdateSchema,
  SettlementSchema,
  DeliverySchema,
  SaleUpdateSchema,
} from '@/lib/schemas';

describe('BUG-14: ProductSchema (POST body)', () => {
  test('accepts minimal valid shape (name only)', () => {
    const r = ProductSchema.safeParse({ name: 'V20 Pro' });
    expect(r.success).toBe(true);
    expect(r.data.name).toBe('V20 Pro');
    expect(r.data.buyPrice).toBe(0);
    expect(r.data.stock).toBe(0);
  });

  test('coerces numeric strings for prices and stock', () => {
    const r = ProductSchema.safeParse({
      name: 'Bike',
      buyPrice: '1500',
      sellPrice: '2000',
      stock: '10',
    });
    expect(r.success).toBe(true);
    expect(r.data.buyPrice).toBe(1500);
    expect(r.data.sellPrice).toBe(2000);
    expect(r.data.stock).toBe(10);
  });

  test('rejects empty name', () => {
    const r = ProductSchema.safeParse({ name: '' });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).toBe('اسم المنتج مطلوب');
  });

  test('rejects negative prices', () => {
    const r = ProductSchema.safeParse({ name: 'Bike', buyPrice: -1 });
    expect(r.success).toBe(false);
  });
});

describe('BUG-14: ProductUpdateSchema (PUT body, snake_case, partial)', () => {
  test('accepts id + sell_price only (COALESCE partial update)', () => {
    const r = ProductUpdateSchema.safeParse({ id: 1, sell_price: '1500' });
    expect(r.success).toBe(true);
    expect(r.data.sell_price).toBe(1500);
  });

  test('accepts id + low_stock_threshold only', () => {
    const r = ProductUpdateSchema.safeParse({ id: 1, low_stock_threshold: 5 });
    expect(r.success).toBe(true);
    expect(r.data.low_stock_threshold).toBe(5);
  });

  test('rejects missing id', () => {
    const r = ProductUpdateSchema.safeParse({ sell_price: 100 });
    expect(r.success).toBe(false);
  });

  test('blank sell_price becomes undefined (not 0)', () => {
    const r = ProductUpdateSchema.safeParse({ id: 1, sell_price: '' });
    expect(r.success).toBe(true);
    expect(r.data.sell_price).toBeUndefined();
  });
});

describe('BUG-14: ClientSchema (POST)', () => {
  test('accepts minimal valid shape', () => {
    const r = ClientSchema.safeParse({ name: 'أحمد' });
    expect(r.success).toBe(true);
    expect(r.data.phone).toBe('');
    expect(r.data.email).toBe('');
  });

  test('rejects empty name', () => {
    const r = ClientSchema.safeParse({ name: '' });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).toBe('اسم العميل مطلوب');
  });
});

describe('BUG-14: ClientUpdateSchema (defensive PUT)', () => {
  test('accepts id + partial fields', () => {
    const r = ClientUpdateSchema.safeParse({ id: 1, phone: '+31612345678' });
    expect(r.success).toBe(true);
  });

  test('rejects missing id', () => {
    const r = ClientUpdateSchema.safeParse({ phone: '+31612345678' });
    expect(r.success).toBe(false);
  });
});

describe('BUG-14: SupplierSchema (POST)', () => {
  test('accepts name + phone', () => {
    const r = SupplierSchema.safeParse({ name: 'Ali Trading', phone: '+31612345678' });
    expect(r.success).toBe(true);
  });

  test('rejects empty name', () => {
    const r = SupplierSchema.safeParse({ name: '' });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).toBe('اسم المورد مطلوب');
  });
});

describe('BUG-14: UserSchema (POST)', () => {
  test('accepts valid admin shape', () => {
    const r = UserSchema.safeParse({
      username: 'admin2',
      password: 'secret12',
      name: 'Admin Two',
      role: 'admin',
    });
    expect(r.success).toBe(true);
  });

  test('rejects short password', () => {
    const r = UserSchema.safeParse({
      username: 'u',
      password: '123',
      name: 'U',
      role: 'seller',
    });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).toMatch(/كلمة المرور/);
  });

  test('rejects invalid role', () => {
    const r = UserSchema.safeParse({
      username: 'u',
      password: 'secret12',
      name: 'U',
      role: 'superuser',
    });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).toBe('دور غير صحيح');
  });

  test('rejects missing required fields', () => {
    const r = UserSchema.safeParse({ username: 'u' });
    expect(r.success).toBe(false);
  });
});

describe('BUG-14: UserUpdateSchema (PUT with toggleActive branch)', () => {
  test('accepts toggleActive-only body', () => {
    const r = UserUpdateSchema.safeParse({ id: 1, toggleActive: true });
    expect(r.success).toBe(true);
    expect(r.data.toggleActive).toBe(true);
  });

  test('accepts regular update body', () => {
    const r = UserUpdateSchema.safeParse({ id: 1, name: 'New Name', role: 'manager' });
    expect(r.success).toBe(true);
  });

  test('rejects short password on update', () => {
    const r = UserUpdateSchema.safeParse({ id: 1, password: '12' });
    expect(r.success).toBe(false);
  });

  test('rejects missing id', () => {
    const r = UserUpdateSchema.safeParse({ name: 'X' });
    expect(r.success).toBe(false);
  });
});

describe('BUG-14: SettlementSchema (POST)', () => {
  test('accepts valid seller_payout', () => {
    const r = SettlementSchema.safeParse({
      date: '2026-04-14',
      type: 'seller_payout',
      username: 'ahmad',
      description: 'Weekly bonus',
      amount: '250',
    });
    expect(r.success).toBe(true);
    expect(r.data.amount).toBe(250);
  });

  test('rejects invalid type', () => {
    const r = SettlementSchema.safeParse({
      date: '2026-04-14',
      type: 'random_type',
      description: 'x',
      amount: 100,
    });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).toBe('نوع التسوية غير صحيح');
  });

  test('rejects missing description', () => {
    const r = SettlementSchema.safeParse({
      date: '2026-04-14',
      type: 'driver_payout',
      amount: 100,
    });
    expect(r.success).toBe(false);
  });

  test('rejects non-positive amount', () => {
    const r = SettlementSchema.safeParse({
      date: '2026-04-14',
      type: 'seller_payout',
      description: 'x',
      amount: 0,
    });
    expect(r.success).toBe(false);
  });

  test('rejects invalid date format', () => {
    const r = SettlementSchema.safeParse({
      date: '14-04-2026',
      type: 'seller_payout',
      description: 'x',
      amount: 100,
    });
    expect(r.success).toBe(false);
  });
});

describe('BUG-14: DeliverySchema (POST — defensive)', () => {
  test('accepts minimal valid shape', () => {
    const r = DeliverySchema.safeParse({
      date: '2026-04-14',
      clientName: 'Test',
      items: 'V20 Pro (1)',
    });
    expect(r.success).toBe(true);
    expect(r.data.status).toBe('قيد الانتظار'); // default
  });

  test('coerces totalAmount string', () => {
    const r = DeliverySchema.safeParse({
      date: '2026-04-14',
      clientName: 'Test',
      items: 'V20 Pro (1)',
      totalAmount: '1500',
    });
    expect(r.success).toBe(true);
    expect(r.data.totalAmount).toBe(1500);
  });

  test('rejects invalid status', () => {
    const r = DeliverySchema.safeParse({
      date: '2026-04-14',
      clientName: 'Test',
      items: 'x',
      status: 'random_status',
    });
    expect(r.success).toBe(false);
  });
});

describe('Session 3 drive-by: SaleUpdateSchema.downPaymentExpected patch', () => {
  test('accepts dpe in update body', () => {
    const r = SaleUpdateSchema.safeParse({
      id: 1,
      clientName: 'C',
      item: 'P',
      quantity: 1,
      unitPrice: 100,
      downPaymentExpected: 50,
    });
    expect(r.success).toBe(true);
    expect(r.data.downPaymentExpected).toBe(50);
  });

  test('dpe optional — omitting it still validates', () => {
    const r = SaleUpdateSchema.safeParse({
      id: 1,
      clientName: 'C',
      item: 'P',
      quantity: 1,
      unitPrice: 100,
    });
    expect(r.success).toBe(true);
    expect(r.data.downPaymentExpected).toBeUndefined();
  });

  test('blank string dpe becomes undefined', () => {
    const r = SaleUpdateSchema.safeParse({
      id: 1,
      clientName: 'C',
      item: 'P',
      quantity: 1,
      unitPrice: 100,
      downPaymentExpected: '',
    });
    expect(r.success).toBe(true);
    expect(r.data.downPaymentExpected).toBeUndefined();
  });
});
