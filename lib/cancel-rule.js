// v1 pre-delivery: locked cancel rule — single source of truth used by
// /api/sales/[id]/cancel POST, /api/sales DELETE, and UI button visibility
// on /sales + /clients/[id]. Any new cancel entry point MUST import this
// helper so the matrix stays consistent across layers.
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
// An already-cancelled sale (status='ملغي') is never re-cancellable.
// The caller supplies `{ user: { role, username }, sale: { status, created_by } }`.
// Pure function — safe to import from both server routes and client
// components.

/**
 * @param {object} sale `{ status, created_by }`
 * @param {object} user `{ role, username }`
 * @returns {boolean} true when the user is authorized to cancel this sale
 */
export function canCancelSale(sale, user) {
  if (!sale || !user) return false;
  if (sale.status === 'ملغي') return false;

  if (sale.status === 'محجوز') {
    if (user.role === 'admin' || user.role === 'manager') return true;
    if (user.role === 'seller' && sale.created_by === user.username) return true;
    return false;
  }

  if (sale.status === 'مؤكد') {
    return user.role === 'admin';
  }

  return false;
}

/**
 * Arabic error message for the 403 when canCancelSale returns false.
 * Kept here so the route layer and UI stay on the same phrasing.
 */
export const CANCEL_DENIED_ERROR = 'ليس لديك صلاحية إلغاء هذا الطلب';
