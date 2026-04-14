import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { applyCollection } from '@/lib/db';

/**
 * FEAT-04: POST /api/sales/[id]/collect
 *
 * Records a client payment against a specific confirmed sale. Used by
 * the client detail page collection form and (indirectly) by the FIFO
 * walker at /api/clients/[id]/collect.
 *
 * Body: { amount: number (TTC, > 0), paymentMethod: 'كاش'|'بنك',
 *         notes?: string (ignored — stored by applyCollection as '') }
 *
 * Auth: admin, manager, seller. Drivers are rejected — they collect the
 * down-payment-at-delivery only, which is wired through updateDelivery.
 *
 * Error mapping:
 *   - Sale not found → 404
 *   - Overpayment, pre-confirm, already paid, cancelled → 400
 *   - Invalid method → 400
 *   - Unexpected → 500
 */
export async function POST(request, { params }) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }
  if (!['admin', 'manager', 'seller'].includes(token.role)) {
    return NextResponse.json({ error: 'صلاحياتك لا تسمح بتسجيل دفعات' }, { status: 403 });
  }

  const { id } = await params;
  const saleId = parseInt(id, 10);
  if (!Number.isFinite(saleId) || saleId <= 0) {
    return NextResponse.json({ error: 'معرّف الطلب غير صحيح' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'بيانات الطلب غير صحيحة' }, { status: 400 });
  }

  const amount = parseFloat(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'المبلغ مطلوب ويجب أن يكون أكبر من صفر' }, { status: 400 });
  }

  const paymentMethod = body?.paymentMethod;
  if (!['كاش', 'بنك'].includes(paymentMethod)) {
    return NextResponse.json({ error: 'طريقة الدفع غير صحيحة' }, { status: 400 });
  }

  try {
    const result = await applyCollection(saleId, amount, paymentMethod, token.username);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const msg = String(err?.message || '');
    const status = msg.includes('غير موجود') ? 404
                 : msg.includes('أكبر من المتبقي') ? 400
                 : msg.includes('مدفوع بالكامل') ? 400
                 : msg.includes('قبل تأكيد') ? 400
                 : msg.includes('ملغي') ? 400
                 : msg.includes('أكبر من صفر') ? 400
                 : 500;
    if (status === 500) console.error('[collect] error:', err);
    return NextResponse.json({ error: msg || 'خطأ في تسجيل الدفعة' }, { status });
  }
}
