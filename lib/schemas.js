/**
 * Zod schemas for all API write operations.
 * Import the relevant schema in each route handler and call
 * schema.safeParse(body) before touching the database.
 */
import { z } from 'zod';

const dateStr = z
  .string({ required_error: 'التاريخ مطلوب' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'صيغة التاريخ غير صحيحة (YYYY-MM-DD)');

const positiveNum = (label) =>
  z.number({ invalid_type_error: `${label} يجب أن يكون رقماً` }).positive(`${label} يجب أن يكون أكبر من 0`);

// ── Purchases ────────────────────────────────────────────────────────────────
export const PurchaseSchema = z.object({
  date:        dateStr,
  supplier:    z.string().min(1, 'المورد مطلوب'),
  item:        z.string().min(1, 'المنتج مطلوب'),
  quantity:    positiveNum('الكمية'),
  unitPrice:   positiveNum('السعر'),
  paymentType: z.enum(['كاش', 'بنك']).optional().default('كاش'),
  sellPrice:   z.number().min(0).optional().default(0),
  notes:       z.string().optional().default(''),
});

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
});

export const SaleUpdateSchema = z.object({
  id:          z.number().int().positive(),
  clientName:  z.string().min(1, 'اسم العميل مطلوب'),
  item:        z.string().min(1, 'المنتج مطلوب'),
  quantity:    positiveNum('الكمية'),
  unitPrice:   positiveNum('السعر'),
  notes:       z.string().optional().default(''),
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
  id:             z.number().int().positive('معرّف التوصيل غير صحيح'),
  date:           dateStr,
  clientName:     z.string().min(1, 'اسم العميل مطلوب'),
  clientPhone:    z.string().optional().default(''),
  address:        z.string().optional().default(''),
  items:          z.string().min(1, 'العناصر مطلوبة'),
  totalAmount:    z.number().min(0).optional().default(0),
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
  saleId:     z.number().int().positive().optional().nullable(),
  notes:      z.string().optional().default(''),
});

// Helper: extract first Arabic validation message from a ZodError
export function zodArabicError(zodError) {
  return zodError.issues[0]?.message || 'بيانات غير صحيحة';
}
