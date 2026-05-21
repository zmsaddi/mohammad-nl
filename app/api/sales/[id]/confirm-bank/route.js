import { NextResponse } from 'next/server';
import { confirmBankReceipt } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// Bank-receipt confirmation for a بنك sale. Admin/manager only.
// The funds must be confirmed received in the bank account BEFORE the
// delivery can be confirmed (the gate lives in updateDelivery). Whoever
// confirms is recorded as the receiver (created_by on the payment row).
export async function POST(request, { params }) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const { id } = await params; // Next.js 16: params is a Promise
    const saleId = parseInt(id, 10);
    if (!saleId) {
      return NextResponse.json({ error: 'معرّف الطلب غير صالح' }, { status: 400 });
    }
    const result = await confirmBankReceipt(saleId, token.username);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return apiError(err, 'خطأ في تأكيد الاستلام البنكي', 400, 'sales/[id]/confirm-bank POST');
  }
}
