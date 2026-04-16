import { NextResponse } from 'next/server';
import { paySupplier, getSupplierPayments } from '@/lib/db';
import { SupplierPaymentSchema, zodArabicError } from '@/lib/schemas';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// v1.0.1 Feature 6 — supplier partial payment endpoint.
//
//   POST /api/purchases/[id]/pay   → record a new supplier payment
//   GET  /api/purchases/[id]/pay   → list existing supplier payments
//
// Atomically updates purchases.paid_amount + payment_status and
// inserts a supplier_payments audit row. Rejects overpayment with
// an Arabic error.

function parsePurchaseId(idStr) {
  const id = parseInt(idStr, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export async function POST(request, { params }) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;
  const { token } = auth;

  const { id: idStr } = await params;
  const purchaseId = parsePurchaseId(idStr);
  if (!purchaseId) {
    return NextResponse.json({ error: 'معرّف الشراء غير صحيح' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'جسم الطلب غير صالح' }, { status: 400 });
  }

  const parsed = SupplierPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });
  }

  try {
    const result = await paySupplier({
      purchaseId,
      amount: parsed.data.amount,
      paymentMethod: parsed.data.paymentMethod,
      notes: parsed.data.notes,
      createdBy: token.username,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return apiError(err, 'خطأ في تسجيل الدفعة', 400, 'purchases/[id]/pay POST');
  }
}

export async function GET(request, { params }) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;

  const { id: idStr } = await params;
  const purchaseId = parsePurchaseId(idStr);
  if (!purchaseId) {
    return NextResponse.json({ error: 'معرّف الشراء غير صحيح' }, { status: 400 });
  }

  try {
    const payments = await getSupplierPayments(purchaseId);
    return NextResponse.json(payments);
  } catch (err) {
    return apiError(err, 'خطأ في جلب الدفعات', 500, 'purchases/[id]/pay GET');
  }
}
