import { NextResponse } from 'next/server';
import { applyCollectionFIFO } from '@/lib/db';
import { sql } from '@vercel/postgres';
import { requireAuth } from '@/lib/api-auth';

/**
 * FEAT-04: POST /api/clients/[id]/collect
 *
 * FIFO collection walker. Accepts a single amount + method and walks the
 * client's open credit sales oldest-first, applying the amount across
 * sales inside one atomic transaction. Returns a per-sale breakdown.
 *
 * Body: { amount: number, paymentMethod: 'كاش'|'بنك' }
 *
 * Auth: admin, manager, seller.
 */
export async function POST(request, { params }) {
  const auth = await requireAuth(request, ['admin', 'manager', 'seller']);
  if (auth.error) return auth.error;
  const { token } = auth;

  const { id: clientId } = await params;
  // Resolve client id → name. Neon clients table uses TEXT id (UUID-ish).
  const { rows } = await sql`SELECT name FROM clients WHERE id = ${clientId}`;
  if (!rows.length) {
    return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 });
  }
  const clientName = rows[0].name;

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
    const result = await applyCollectionFIFO(clientName, amount, paymentMethod, token.username);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const msg = String(err?.message || '');
    const status = msg.includes('لا يوجد دين') ? 400
                 : msg.includes('أكبر من') ? 400
                 : msg.includes('أكبر من صفر') ? 400
                 : 500;
    if (status === 500) console.error('[clients/collect] error:', err);
    return NextResponse.json({ error: msg || 'خطأ في تسجيل الدفعة' }, { status });
  }
}
