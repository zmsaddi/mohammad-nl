/**
 * Zod schemas for all API write operations.
 * Import the relevant schema in each route handler and call
 * schema.safeParse(body) before touching the database.
 */
import { z } from 'zod';

const dateStr = z
  .string({ required_error: 'التاريخ مطلوب' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'صيغة التاريخ غير صحيحة (YYYY-MM-DD)');

// BUG-13: use `z.coerce.number()` so React <input type="number"> string
// values (`"5"`) are accepted on the manual form path. Voice path was
// already immune because it pre-coerces in /api/voice/process.
const positiveNum = (label) =>
  z.coerce.number({ invalid_type_error: `${label} يجب أن يكون رقماً` })
    .positive(`${label} يجب أن يكون أكبر من 0`);

// ── Purchases ────────────────────────────────────────────────────────────────
export const PurchaseSchema = z.object({
  date:        dateStr,
  supplier:    z.string().min(1, 'المورد مطلوب'),
  item:        z.string().min(1, 'المنتج مطلوب'),
  // DONE: Step 3 — category required for new purchases (per business rule)
  category:    z.string().min(1, 'فئة المنتج مطلوبة'),
  quantity:    positiveNum('الكمية'),
  unitPrice:   positiveNum('السعر'),
  paymentType: z.enum(['كاش', 'بنك']).optional().default('كاش'),
  sellPrice:   z.coerce.number().min(0).optional().default(0),
  notes:       z.string().optional().default(''),
});

// Optional-number helper: accepts number, numeric string, or empty/undefined
// and transforms to `undefined` when blank so route handlers can distinguish
// "user didn't send this field" from "user sent 0". Used throughout FEAT-04
// and BUG-14 for fields with reactive defaults (downPaymentExpected) and
// partial-update patterns (product PUT, user PUT).
const optionalNum = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)));

// ── Sales ─────────────────────────────────────────────────────────────────────
export const SaleSchema = z.object({
  date:          dateStr,
  clientName:    z.string().min(1, 'اسم العميل مطلوب'),
  item:          z.string().min(1, 'المنتج مطلوب'),
  quantity:      positiveNum('الكمية'),
  unitPrice:     positiveNum('السعر'),
  paymentType:   z.enum(['كاش', 'بنك', 'آجل']).optional().default('كاش'),
  clientPhone:   z.string().optional().default(''),
  clientAddress: z.string().optional().default(''),
  clientEmail:   z.string().optional().default(''),
  notes:         z.string().optional().default(''),
  // FEAT-04: down_payment_expected. Validated strictly in addSale against
  // [0, total]; the schema only checks shape and coerces to number.
  downPaymentExpected: optionalNum,
});

export const SaleUpdateSchema = z.object({
  id:          z.coerce.number().int().positive(),
  clientName:  z.string().min(1, 'اسم العميل مطلوب'),
  item:        z.string().min(1, 'المنتج مطلوب'),
  quantity:    positiveNum('الكمية'),
  unitPrice:   positiveNum('السعر'),
  notes:       z.string().optional().default(''),
  // Session 4 drive-by: update path gains dpe too, so reserved-order edits
  // can change the down payment before delivery. Still validated against
  // [0, total] in updateSale / addSale.
  downPaymentExpected: optionalNum,
});

// ── Expenses ──────────────────────────────────────────────────────────────────
export const ExpenseSchema = z.object({
  date:        dateStr,
  category:    z.string().min(1, 'الفئة مطلوبة'),
  description: z.string().min(1, 'الوصف مطلوب'),
  amount:      positiveNum('المبلغ'),
  paymentType: z.enum(['كاش', 'بنك']).optional().default('كاش'),
  notes:       z.string().optional().default(''),
});

// ── Deliveries ────────────────────────────────────────────────────────────────
export const DeliveryUpdateSchema = z.object({
  id:             z.coerce.number().int().positive('معرّف التوصيل غير صحيح'),
  date:           dateStr,
  clientName:     z.string().min(1, 'اسم العميل مطلوب'),
  clientPhone:    z.string().optional().default(''),
  address:        z.string().optional().default(''),
  items:          z.string().min(1, 'العناصر مطلوبة'),
  totalAmount:    z.coerce.number().min(0).optional().default(0),
  status:         z.enum(['قيد الانتظار', 'جاري التوصيل', 'تم التوصيل', 'ملغي']),
  driverName:     z.string().optional().default(''),
  assignedDriver: z.string().optional().default(''),
  notes:          z.string().optional().default(''),
  vin:            z.string().optional().default(''),
});

// ── Payments ──────────────────────────────────────────────────────────────────
export const PaymentSchema = z.object({
  date:       dateStr,
  clientName: z.string().min(1, 'اسم العميل مطلوب'),
  amount:     positiveNum('المبلغ'),
  saleId:     z.coerce.number().int().positive().optional().nullable(),
  notes:      z.string().optional().default(''),
});

// ── Products ─────────────────────────────────────────────────────────────────
// BUG-14: POST body uses camelCase (buyPrice/sellPrice/...), PUT body uses
// snake_case (sell_price/low_stock_threshold/...) — the schemas mirror
// whichever convention the route handler is already written against so
// existing frontend callers don't need to change.
export const ProductSchema = z.object({
  name:      z.string().min(1, 'اسم المنتج مطلوب'),
  category:  z.string().optional().default(''),
  unit:      z.string().optional().default(''),
  buyPrice:  z.coerce.number().min(0).optional().default(0),
  sellPrice: z.coerce.number().min(0).optional().default(0),
  stock:     z.coerce.number().min(0).optional().default(0),
  notes:     z.string().optional().default(''),
});

// PUT uses snake_case and supports partial updates via COALESCE. Every
// field is optional so a caller updating just sell_price doesn't have to
// send the full row.
export const ProductUpdateSchema = z.object({
  id:                  z.coerce.number({ message: 'معرف المنتج مطلوب' }).int().positive('معرف المنتج مطلوب'),
  sell_price:          optionalNum,
  category:            z.string().optional(),
  unit:                z.string().optional(),
  notes:               z.string().optional(),
  low_stock_threshold: optionalNum,
});

// ── Clients ──────────────────────────────────────────────────────────────────
export const ClientSchema = z.object({
  name:      z.string().min(1, 'اسم العميل مطلوب'),
  phone:     z.string().optional().default(''),
  email:     z.string().optional().default(''),
  address:   z.string().optional().default(''),
  latinName: z.string().optional(),
  notes:     z.string().optional().default(''),
});

// Defensive: PUT /api/clients has no UI caller today, but the route handler
// exists so we lock the contract with a schema in case a future caller arrives.
export const ClientUpdateSchema = z.object({
  id:        z.coerce.number({ message: 'معرف العميل مطلوب' }).int().positive('معرف العميل مطلوب'),
  name:      z.string().min(1, 'اسم العميل مطلوب').optional(),
  phone:     z.string().optional(),
  email:     z.string().optional(),
  address:   z.string().optional(),
  latinName: z.string().optional(),
  notes:     z.string().optional(),
});

// ── Suppliers ────────────────────────────────────────────────────────────────
// BUG-14: POST-only (no PUT handler exists). BUG-21 adds phone-only
// ambiguity detection in addSupplier; the schema itself only validates
// shape.
export const SupplierSchema = z.object({
  name:    z.string().min(1, 'اسم المورد مطلوب'),
  phone:   z.string().optional().default(''),
  address: z.string().optional().default(''),
  notes:   z.string().optional().default(''),
});

// ── Users ────────────────────────────────────────────────────────────────────
const USER_ROLES = ['admin', 'manager', 'seller', 'driver'];

export const UserSchema = z.object({
  username: z.string().min(1, 'اسم المستخدم مطلوب'),
  password: z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
  name:     z.string().min(1, 'الاسم مطلوب'),
  role:     z.enum(USER_ROLES, { message: 'دور غير صحيح' }),
});

// PUT covers two mutually exclusive shapes: the toggleActive branch (just
// { id, toggleActive: true }) and the regular update (id + any of name /
// role / password). Using a discriminated union keeps the route handler's
// `if (data.toggleActive) ... else ...` split explicit.
export const UserUpdateSchema = z.object({
  id:           z.coerce.number({ message: 'معرف المستخدم مطلوب' }).int().positive('معرف المستخدم مطلوب'),
  name:         z.string().min(1, 'الاسم مطلوب').optional(),
  role:         z.enum(USER_ROLES).optional(),
  password:     z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل').optional(),
  toggleActive: z.boolean().optional(),
});

// ── Settlements ──────────────────────────────────────────────────────────────
// `type` covers the two payout kinds plus the historic free-form strings
// that pre-BUG-14 data may carry. settledBy is derived from the auth token
// at the route layer, not the body.
const SETTLEMENT_TYPES = ['seller_payout', 'driver_payout'];

export const SettlementSchema = z.object({
  date:        dateStr,
  type:        z.enum(SETTLEMENT_TYPES, { message: 'نوع التسوية غير صحيح' }),
  username:    z.string().optional().default(''),
  description: z.string().min(1, 'الوصف مطلوب'),
  amount:      positiveNum('المبلغ'),
  notes:       z.string().optional().default(''),
});

// ── Deliveries (POST — PUT already has DeliveryUpdateSchema) ────────────────
// Defensive: no UI caller today — deliveries are auto-created by addSale.
// The contract test at tests/bug14-schemas.test.js locks the shape so a
// future direct caller can't accidentally diverge.
export const DeliverySchema = z.object({
  date:        dateStr,
  clientName:  z.string().min(1, 'اسم العميل مطلوب'),
  clientPhone: z.string().optional().default(''),
  clientEmail: z.string().optional().default(''),
  address:     z.string().optional().default(''),
  items:       z.string().min(1, 'العناصر مطلوبة'),
  totalAmount: z.coerce.number().min(0).optional().default(0),
  status:      z.enum(['قيد الانتظار', 'جاري التوصيل', 'تم التوصيل', 'ملغي']).optional().default('قيد الانتظار'),
  driverName:  z.string().optional().default(''),
  notes:       z.string().optional().default(''),
});

// Helper: extract first Arabic validation message from a ZodError
export function zodArabicError(zodError) {
  return zodError.issues[0]?.message || 'بيانات غير صحيحة';
}
