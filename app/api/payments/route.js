import { NextResponse } from 'next/server';
import { getPayments, addPayment } from '@/lib/db';
import { sql } from '@vercel/postgres';
import { PaymentSchema, zodArabicError } from '@/lib/schemas';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

export async function GET(request) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    const rows = await getPayments(searchParams.get('client'));
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err, 'خطأ في جلب البيانات', 500, 'payments GET');
  }
}

export async function POST(request) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const body = await request.json();
    const parsed = PaymentSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });

    // BUG 5A — block payments against cancelled or already-settled sales.
    // FEAT-04: the old guard checked payment_type !== 'آجل' which would
    // reject a partial cash/bank sale collecting its remainder later. The
    // new guard checks payment_status, which is set by updateDelivery(confirm)
    // to 'paid' when fully collected and 'partial' otherwise. Only sales
    // marked 'paid' reject further payments.
    if (parsed.data.saleId) {
      const { rows } = await sql`
        SELECT status, payment_status FROM sales WHERE id = ${parsed.data.saleId}
      `;
      if (!rows.length) {
        return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
      }
      if (rows[0].status === 'ملغي') {
        return NextResponse.json({ error: 'لا يمكن تسجيل دفعة على طلب ملغي' }, { status: 400 });
      }
      if (rows[0].payment_status === 'paid') {
        return NextResponse.json({ error: 'هذا الطلب مدفوع بالكامل — لا يوجد دين لتسديده' }, { status: 400 });
      }
    }

    const id = await addPayment({ ...parsed.data, createdBy: token.username });
    return NextResponse.json({ success: true, id });
  } catch (err) {
    return apiError(err, 'خطأ في إضافة البيانات', 500, 'payments POST');
  }
}

export async function DELETE(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    await sql`DELETE FROM payments WHERE id = ${searchParams.get('id')}`;
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في حذف البيانات', 500, 'payments DELETE');
  }
}
