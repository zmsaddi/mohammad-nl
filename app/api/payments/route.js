import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getPayments, addPayment } from '@/lib/db';
import { sql } from '@vercel/postgres';
import { PaymentSchema, zodArabicError } from '@/lib/schemas';

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin','manager'].includes(token.role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    const rows = await getPayments(searchParams.get('client'));
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[payments] GET:', err);
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin','manager'].includes(token.role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const body = await request.json();
    const parsed = PaymentSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });

    // BUG 5A — block payments against cancelled or non-credit sales.
    // Without this guard, an admin could record a debt payment on a refunded
    // sale and silently corrupt the client's balance.
    if (parsed.data.saleId) {
      const { rows } = await sql`
        SELECT status, payment_type FROM sales WHERE id = ${parsed.data.saleId}
      `;
      if (!rows.length) {
        return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
      }
      if (rows[0].status === 'ملغي') {
        return NextResponse.json({ error: 'لا يمكن تسجيل دفعة على طلب ملغي' }, { status: 400 });
      }
      if (rows[0].payment_type !== 'آجل') {
        return NextResponse.json({ error: 'هذا الطلب ليس آجلاً — لا يوجد دين لتسديده' }, { status: 400 });
      }
    }

    const id = await addPayment({ ...parsed.data, createdBy: token.username });
    return NextResponse.json({ success: true, id });
  } catch (err) {
    console.error('[payments] POST:', err);
    return NextResponse.json({ error: 'خطأ في إضافة البيانات' }, { status: 500 });
  }
}

export async function DELETE(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (token.role !== 'admin') return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    await sql`DELETE FROM payments WHERE id = ${searchParams.get('id')}`;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[payments] DELETE:', err);
    return NextResponse.json({ error: 'خطأ في حذف البيانات' }, { status: 500 });
  }
}
