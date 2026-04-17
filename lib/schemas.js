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

// Hotfix 2026-04-14: Zod v4's `.optional()` accepts undefined but rejects
// null. VoiceConfirm.js sends empty optional fields as null (not undefined),
// so every optional field that might receive a null from the voice flow
// needs to be wrapped. This helper preprocesses null → undefined BEFORE
// the inner schema runs, which lets any combination of .optional() /
// .default() / .transform() behave naturally: null becomes the default
// (if set) or undefined (if not).
//
// Usage:
//   notes: nullable(z.string().optional().default(''))
//   sellPrice: nullable(z.coerce.number().min(0).optional().default(0))
//   paymentType: nullable(z.enum(['كاش','بنك']).optional().default('كاش'))
//
// Required fields (name, quantity, unitPrice, etc.) are NOT wrapped — they
// must still reject null, because a missing required field is a real error.
const nullable = (schema) =>
  z.preprocess((v) => (v === null ? undefined : v), schema);

// Optional-number helper: accepts number, numeric string, null, undefined,
// or empty string and transforms to `undefined` when blank so route
// handlers can distinguish "user didn't send this field" from "user sent 0".
// Used throughout FEAT-04 and BUG-14 for fields with reactive defaults
// (downPaymentExpected) and partial-update patterns (product PUT, user PUT).
// Hotfix 2026-04-14: wrapped with nullable() so the upstream null check
// inside the transform is no longer dead code.
const optionalNum = nullable(
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)))
);

// ── Purchases ────────────────────────────────────────────────────────────────
export const PurchaseSchema = z.object({
  date:          dateStr,
  supplier:      z.string().min(1, 'المورد مطلوب'),
  item:          z.string().min(1, 'المنتج مطلوب'),
  descriptionAr: nullable(z.string().optional().default('')),
  // DONE: Step 3 — category required for new purchases (per business rule)
  category:    z.string().min(1, 'فئة المنتج مطلوبة'),
  quantity:    positiveNum('الكمية'),
  unitPrice:   positiveNum('السعر'),
  paymentType: nullable(z.enum(['كاش', 'بنك']).optional().default('كاش')),
  sellPrice:   nullable(z.coerce.number().min(0).optional().default(0)),
  notes:       nullable(z.string().optional().default('')),
  // v1.0.1 Feature 6 — supplier credit. If omitted, addPurchase defaults
  // to "paid in full now" (total). If provided, must be ≥ 0 and ≤ total
  // (validated in addPurchase against the computed total).
  paidAmount:  optionalNum,
});

// SP-005+M-05: purchase update schema (admin edit path)
export const PurchaseUpdateSchema = z.object({
  id:            z.coerce.number().int().positive('معرّف المشتريات مطلوب'),
  date:          nullable(z.string().optional()),
  supplier:      nullable(z.string().optional()),
  item:          nullable(z.string().optional()),
  descriptionAr: nullable(z.string().optional()),
  category:      nullable(z.string().optional()),
  quantity:      nullable(z.coerce.number().positive('الكمية يجب أن تكون أكبر من 0').optional()),
  unitPrice:     nullable(z.coerce.number().min(0, 'السعر لا يمكن أن يكون سالباً').optional()),
  sellPrice:     nullable(z.coerce.number().min(0, 'سعر البيع لا يمكن أن يكون سالباً').optional()),
  paymentType:   nullable(z.enum(['كاش', 'بنك']).optional()),
  paidAmount:    nullable(z.coerce.number().min(0, 'المدفوع لا يمكن أن يكون سالباً').optional()),
  notes:         nullable(z.string().optional().default('')),
});

// M-04: expense update schema (admin edit path)
export const ExpenseUpdateSchema = z.object({
  id:          z.coerce.number().int().positive('معرّف المصروف مطلوب'),
  category:    z.string().min(1, 'الفئة مطلوبة'),
  description: z.string().min(1, 'الوصف مطلوب'),
  amount:      positiveNum('المبلغ'),
  notes:       nullable(z.string().optional().default('')),
});

// SP-008: bonus rates update schema
export const BonusRateUpdateSchema = z.object({
  username:          z.string().min(1, 'اسم المستخدم مطلوب'),
  seller_fixed:      nullable(z.coerce.number().min(0, 'العمولة لا يمكن أن تكون سالبة').optional()),
  seller_percentage: nullable(z.coerce.number().min(0).max(100, 'النسبة بين 0 و 100').optional()),
  driver_fixed:      nullable(z.coerce.number().min(0, 'العمولة لا يمكن أن تكون سالبة').optional()),
});

// v1.0.1 — Feature 6: supplier payment (partial payment on an existing purchase)
export const SupplierPaymentSchema = z.object({
  amount:        positiveNum('المبلغ'),
  paymentMethod: nullable(z.enum(['كاش', 'بنك']).optional().default('كاش')),
  notes:         nullable(z.string().optional().default('')),
});

// ── Sales ─────────────────────────────────────────────────────────────────────
export const SaleSchema = z.object({
  date:          dateStr,
  clientName:    z.string().min(1, 'اسم العميل مطلوب'),
  item:          z.string().min(1, 'المنتج مطلوب'),
  quantity:      positiveNum('الكمية'),
  unitPrice:     positiveNum('السعر'),
  paymentType:   nullable(z.enum(['كاش', 'بنك', 'آجل']).optional().default('كاش')),
  clientPhone:   nullable(z.string().optional().default('')),
  clientAddress: nullable(z.string().optional().default('')),
  clientEmail:   nullable(z.string().optional().default('')),
  notes:         nullable(z.string().optional().default('')),
  // FEAT-04: down_payment_expected. Validated strictly in addSale against
  // [0, total]; the schema only checks shape and coerces to number.
  downPaymentExpected: optionalNum,
}).refine(
  // v1.0.3 Bug A — cash/bank sales must collect the full total at delivery.
  // We mirror addSale's hard guard at the schema layer so any future direct
  // API caller (mobile app, voice flow, integration) gets the same rejection
  // before reaching the DB. آجل sales are exempt — partial down payments on
  // credit are the legitimate use case for the dpe field.
  (data) => {
    if (data.paymentType === 'آجل') return true;
    // Schema only sees quantity + unitPrice (total is computed in addSale).
    // Re-derive total here so the rule fires regardless of whether the caller
    // sent dpe explicitly or omitted it (omitted → addSale fills with total
    // and passes; explicit < total → rejected).
    if (data.downPaymentExpected === undefined || data.downPaymentExpected === null) {
      return true; // omitted → addSale will fill with total
    }
    const total = (parseFloat(data.quantity) || 0) * (parseFloat(data.unitPrice) || 0);
    const dpe = parseFloat(data.downPaymentExpected) || 0;
    return Math.abs(dpe - total) <= 0.005;
  },
  {
    message: 'البيع النقدي/البنكي يتطلب دفع المبلغ بالكامل عند التوصيل',
    path: ['downPaymentExpected'],
  }
);

export const SaleUpdateSchema = z.object({
  id:          z.coerce.number().int().positive(),
  clientName:  z.string().min(1, 'اسم العميل مطلوب'),
  item:        z.string().min(1, 'المنتج مطلوب'),
  quantity:    positiveNum('الكمية'),
  unitPrice:   positiveNum('السعر'),
  notes:       nullable(z.string().optional().default('')),
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
  paymentType: nullable(z.enum(['كاش', 'بنك']).optional().default('كاش')),
  notes:       nullable(z.string().optional().default('')),
});

// ── Deliveries ────────────────────────────────────────────────────────────────
export const DeliveryUpdateSchema = z.object({
  id:             z.coerce.number().int().positive('معرّف التوصيل غير صحيح'),
  date:           dateStr,
  clientName:     z.string().min(1, 'اسم العميل مطلوب'),
  clientPhone:    nullable(z.string().optional().default('')),
  address:        nullable(z.string().optional().default('')),
  items:          z.string().min(1, 'العناصر مطلوبة'),
  totalAmount:    nullable(z.coerce.number().min(0).optional().default(0)),
  status:         z.enum(['قيد الانتظار', 'جاري التوصيل', 'تم التوصيل', 'ملغي']),
  driverName:     nullable(z.string().optional().default('')),
  assignedDriver: nullable(z.string().optional().default('')),
  notes:          nullable(z.string().optional().default('')),
  vin:            nullable(z.string().optional().default('')),
});

// ── Payments ──────────────────────────────────────────────────────────────────
export const PaymentSchema = z.object({
  date:       dateStr,
  clientName: z.string().min(1, 'اسم العميل مطلوب'),
  amount:     positiveNum('المبلغ'),
  saleId:     z.coerce.number().int().positive().optional().nullable(),
  notes:      nullable(z.string().optional().default('')),
});

// ── Products ─────────────────────────────────────────────────────────────────
// BUG-14: POST body uses camelCase (buyPrice/sellPrice/...), PUT body uses
// snake_case (sell_price/low_stock_threshold/...) — the schemas mirror
// whichever convention the route handler is already written against so
// existing frontend callers don't need to change.
export const ProductSchema = z.object({
  name:          z.string().min(1, 'اسم المنتج مطلوب'),
  descriptionAr: nullable(z.string().optional().default('')),
  category:      nullable(z.string().optional().default('')),
  unit:          nullable(z.string().optional().default('')),
  buyPrice:      nullable(z.coerce.number().min(0).optional().default(0)),
  sellPrice:     nullable(z.coerce.number().min(0).optional().default(0)),
  stock:         nullable(z.coerce.number().min(0).optional().default(0)),
  notes:         nullable(z.string().optional().default('')),
});

// PUT uses snake_case and supports partial updates via COALESCE. Every
// field is optional so a caller updating just sell_price doesn't have to
// send the full row.
export const ProductUpdateSchema = z.object({
  id:                  z.coerce.number({ message: 'معرّف المنتج مطلوب' }).int().positive('معرّف المنتج مطلوب'),
  sell_price:          optionalNum,
  description_ar:      nullable(z.string().optional()),
  category:            nullable(z.string().optional()),
  unit:                nullable(z.string().optional()),
  notes:               nullable(z.string().optional()),
  low_stock_threshold: optionalNum,
});

// ── Clients ──────────────────────────────────────────────────────────────────
export const ClientSchema = z.object({
  name:          z.string().min(1, 'اسم العميل مطلوب'),
  descriptionAr: nullable(z.string().optional().default('')),
  phone:         nullable(z.string().optional().default('')),
  email:         nullable(z.string().optional().default('')),
  address:       nullable(z.string().optional().default('')),
  latinName:     nullable(z.string().optional()),
  notes:         nullable(z.string().optional().default('')),
});

// Defensive: PUT /api/clients has no UI caller today, but the route handler
// exists so we lock the contract with a schema in case a future caller arrives.
export const ClientUpdateSchema = z.object({
  id:        z.coerce.number({ message: 'معرّف العميل مطلوب' }).int().positive('معرّف العميل مطلوب'),
  name:      nullable(z.string().min(1, 'اسم العميل مطلوب').optional()),
  phone:     nullable(z.string().optional()),
  email:     nullable(z.string().optional()),
  address:   nullable(z.string().optional()),
  latinName: nullable(z.string().optional()),
  notes:     nullable(z.string().optional()),
});

// ── Suppliers ────────────────────────────────────────────────────────────────
// BUG-14: POST-only (no PUT handler exists). BUG-21 adds phone-only
// ambiguity detection in addSupplier; the schema itself only validates
// shape.
export const SupplierSchema = z.object({
  name:    z.string().min(1, 'اسم المورد مطلوب'),
  phone:   nullable(z.string().optional().default('')),
  address: nullable(z.string().optional().default('')),
  notes:   nullable(z.string().optional().default('')),
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
  id:           z.coerce.number({ message: 'معرّف المستخدم مطلوب' }).int().positive('معرّف المستخدم مطلوب'),
  name:         nullable(z.string().min(1, 'الاسم مطلوب').optional()),
  role:         nullable(z.enum(USER_ROLES).optional()),
  password:     nullable(z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل').optional()),
  toggleActive: nullable(z.boolean().optional()),
});

// ── Settlements ──────────────────────────────────────────────────────────────
// `type` covers the two payout kinds plus the historic free-form strings
// that pre-BUG-14 data may carry. settledBy is derived from the auth token
// at the route layer, not the body.
// v1.0.1 — profit_distribution added alongside the bonus payout types so
// the settlements form's existing "توزيع أرباح" option actually reaches
// addSettlement. Pre-v1.0.1 the UI showed it but the schema rejected it
// before the DB got a chance to record the row.
//
// v1.1 S1.8 [F-005] — profit_distribution REMOVED from the accepted enum.
// Two independent write paths into the profit pool (this endpoint and
// addProfitDistribution) made F-001's over-distribution undetectable.
// New profit splits must go through /profit-distributions which has the
// F-001 cap. Legacy rows of type 'profit_distribution' remain in the DB
// for history (the read helpers still return them); only NEW inserts are
// blocked.
const SETTLEMENT_TYPES = ['seller_payout', 'driver_payout'];

export const SettlementSchema = z.object({
  date:        dateStr,
  type:        z.enum(SETTLEMENT_TYPES, { message: 'نوع التسوية غير صحيح' }),
  username:    nullable(z.string().optional().default('')),
  description: z.string().min(1, 'الوصف مطلوب'),
  amount:      positiveNum('المبلغ'),
  notes:       nullable(z.string().optional().default('')),
});

// ── Profit Distributions ─────────────────────────────────────────────────────
// v1.2 audit BUG-004 — was missing entirely, causing unvalidated POST bodies.
export const ProfitDistributionSchema = z.object({
  baseAmount:      positiveNum('المبلغ الأساسي'),
  recipients:      z.array(z.object({
    username:   z.string().min(1, 'اسم المستخدم مطلوب'),
    percentage: z.coerce.number().positive('النسبة يجب أن تكون أكبر من 0').max(100, 'النسبة لا تتجاوز 100'),
  })).min(1, 'يجب اختيار مستلم واحد على الأقل'),
  basePeriodStart: nullable(z.string().optional()),
  basePeriodEnd:   nullable(z.string().optional()),
  notes:           nullable(z.string().optional().default('')),
});

// ── Deliveries (POST — PUT already has DeliveryUpdateSchema) ────────────────
// Defensive: no UI caller today — deliveries are auto-created by addSale.
// The contract test at tests/bug14-schemas.test.js locks the shape so a
// future direct caller can't accidentally diverge.
export const DeliverySchema = z.object({
  date:        dateStr,
  clientName:  z.string().min(1, 'اسم العميل مطلوب'),
  clientPhone: nullable(z.string().optional().default('')),
  clientEmail: nullable(z.string().optional().default('')),
  address:     nullable(z.string().optional().default('')),
  items:       z.string().min(1, 'العناصر مطلوبة'),
  totalAmount: nullable(z.coerce.number().min(0).optional().default(0)),
  status:      nullable(z.enum(['قيد الانتظار', 'جاري التوصيل', 'تم التوصيل', 'ملغي']).optional().default('قيد الانتظار')),
  driverName:  nullable(z.string().optional().default('')),
  notes:       nullable(z.string().optional().default('')),
});

// Helper: extract first Arabic validation message from a ZodError
export function zodArabicError(zodError) {
  return zodError.issues[0]?.message || 'بيانات غير صحيحة';
}
