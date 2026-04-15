import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { paySupplier, getSupplierPayments } from '@/lib/db';
import { SupplierPaymentSchema, zodArabicError } from '@/lib/schemas';

// v1.0.1 Feature 6 — supplier partial payment endpoint.
//
//   POST /api/purchases/[id]/pay   → record a new supplier payment
//   GET  /api/purchases/[id]/pay   → list existing supplier payments
//
// Atomically updates purchases.paid_amount + payment_status and
// inserts a supplier_payments audit row. Rejects overpayment with
// an Arabic error.

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

function parsePurchaseId(idStr) {
  const id = parseInt(idStr, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export async function POST(request, { params }) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin', 'manager'].includes(token.role)) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }

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
    console.error('[purchases/[id]/pay] POST:', err);
    const safe = /^[\u0600-\u06FF]/.test(err?.message || '')
      ? err.message
      : 'خطأ في تسجيل الدفعة';
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}

export async function GET(request, { params }) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin', 'manager'].includes(token.role)) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }

  const { id: idStr } = await params;
  const purchaseId = parsePurchaseId(idStr);
  if (!purchaseId) {
    return NextResponse.json({ error: 'معرّف الشراء غير صحيح' }, { status: 400 });
  }

  try {
    const payments = await getSupplierPayments(purchaseId);
    return NextResponse.json(payments);
  } catch (err) {
    console.error('[purchases/[id]/pay] GET:', err);
    return NextResponse.json({ error: 'خطأ في جلب الدفعات' }, { status: 500 });
  }
}
