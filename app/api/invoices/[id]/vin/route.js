import { NextResponse } from 'next/server';
import { updateInvoiceVin } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// Correct ONLY the VIN on an invoice (and its linked sale). Admin/manager only,
// matching the delivery-edit permission. This is the single allowed post-delivery
// field edit — nothing else on the invoice changes.
export async function PATCH(request, { params }) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const { id } = await params;
    const body = await request.json();
    const vin = (body.vin == null ? '' : String(body.vin)).trim();
    if (vin.length > 64) {
      return NextResponse.json({ error: 'رقم الهيكل طويل جداً (الحد 64 حرفاً)' }, { status: 400 });
    }
    const res = await updateInvoiceVin(parseInt(id, 10), vin, token.username);
    return NextResponse.json({ success: true, ...res });
  } catch (err) {
    return apiError(err, 'خطأ في تعديل رقم الهيكل', 400, 'invoices vin PATCH');
  }
}
