// v1 pre-delivery — cancel rule RBAC matrix
//
// Verifies the locked cancel rule (see lib/cancel-rule.js) via the pure
// helper function. The helper is imported by both route handlers and UI
// buttons, so testing it directly gives full matrix coverage without
// needing HTTP/DB fixtures.
//
//   ┌──────────┬──────────────────┬──────────────────┐
//   │  role    │  محجوز (reserved)│  مؤكد (confirmed)│
//   ├──────────┼──────────────────┼──────────────────┤
//   │  admin   │  ✅ allowed      │  ✅ allowed      │
//   │  manager │  ✅ allowed      │  ❌ BLOCKED      │
//   │  seller  │  ✅ own only     │  ❌ BLOCKED      │
//   │  driver  │  ❌ blocked      │  ❌ blocked      │
//   └──────────┴──────────────────┴──────────────────┘
//
// Run with: npx vitest run tests/cancel-rule-rbac.test.js

import { describe, test, expect } from 'vitest';
import { canCancelSale, CANCEL_DENIED_ERROR } from '../lib/cancel-rule.js';

const adminUser = { role: 'admin', username: 'admin' };
const managerUser = { role: 'manager', username: 'manager1' };
const sellerOwner = { role: 'seller', username: 'seller1' };
const sellerOther = { role: 'seller', username: 'seller2' };
const driverUser = { role: 'driver', username: 'driver1' };

const reservedOwn = { status: 'محجوز', created_by: 'seller1' };
const reservedOther = { status: 'محجوز', created_by: 'seller2' };
const confirmed = { status: 'مؤكد', created_by: 'seller1' };
const cancelled = { status: 'ملغي', created_by: 'seller1' };

describe('canCancelSale — locked rule matrix (v1 pre-delivery)', () => {
  // ── admin — always allowed on non-cancelled sales ────────────────
  test('admin can cancel reserved sale', () => {
    expect(canCancelSale(reservedOwn, adminUser)).toBe(true);
    expect(canCancelSale(reservedOther, adminUser)).toBe(true);
  });
  test('admin can cancel confirmed sale', () => {
    expect(canCancelSale(confirmed, adminUser)).toBe(true);
  });

  // ── manager — reserved allowed, confirmed blocked ────────────────
  test('manager can cancel reserved sale', () => {
    expect(canCancelSale(reservedOwn, managerUser)).toBe(true);
    expect(canCancelSale(reservedOther, managerUser)).toBe(true);
  });
  test('manager BLOCKED from cancelling confirmed sale', () => {
    expect(canCancelSale(confirmed, managerUser)).toBe(false);
  });

  // ── seller — own reserved only ───────────────────────────────────
  test('seller can cancel own reserved sale', () => {
    expect(canCancelSale(reservedOwn, sellerOwner)).toBe(true);
  });
  test('seller BLOCKED from cancelling other seller reserved sale', () => {
    expect(canCancelSale(reservedOther, sellerOwner)).toBe(false);
  });
  test('seller BLOCKED from cancelling confirmed sale (own or others)', () => {
    expect(canCancelSale(confirmed, sellerOwner)).toBe(false);
    expect(canCancelSale({ status: 'مؤكد', created_by: 'seller1' }, sellerOther)).toBe(false);
  });

  // ── driver — never ───────────────────────────────────────────────
  test('driver BLOCKED from any cancellation', () => {
    expect(canCancelSale(reservedOwn, driverUser)).toBe(false);
    expect(canCancelSale(confirmed, driverUser)).toBe(false);
  });

  // ── already-cancelled sales — never re-cancellable ───────────────
  test('already-cancelled sale cannot be cancelled again (by any role)', () => {
    expect(canCancelSale(cancelled, adminUser)).toBe(false);
    expect(canCancelSale(cancelled, managerUser)).toBe(false);
    expect(canCancelSale(cancelled, sellerOwner)).toBe(false);
    expect(canCancelSale(cancelled, driverUser)).toBe(false);
  });

  // ── defensive — null inputs never authorize ──────────────────────
  test('null or missing inputs return false', () => {
    expect(canCancelSale(null, adminUser)).toBe(false);
    expect(canCancelSale(reservedOwn, null)).toBe(false);
    expect(canCancelSale(undefined, undefined)).toBe(false);
  });

  // ── Arabic error constant is exported for the route layer ────────
  test('CANCEL_DENIED_ERROR is an Arabic message string', () => {
    expect(typeof CANCEL_DENIED_ERROR).toBe('string');
    expect(CANCEL_DENIED_ERROR.length).toBeGreaterThan(0);
    expect(/[\u0600-\u06FF]/.test(CANCEL_DENIED_ERROR)).toBe(true);
  });
});
