import { NextResponse } from 'next/server';
import { getPendingHandoversForUser, getBoxRef, managesBox, validTransferPair, initiateHandover } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// Funding / handover requests.
// GET  → pending requests the caller may act on (admin = all).
// POST → initiate a transfer (pending; no money moves until confirmed).
//        Authority: caller must MANAGE one side of the transfer; the pair
//        must be valid (no same-role custody↔custody). Gated by TREASURY_ENABLED
//        inside initiateHandover.

export async function GET(request) {
  const auth = await requireAuth(request, ['admin', 'manager', 'driver']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const rows = await getPendingHandoversForUser(token.role, token.username);
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err, 'خطأ في جلب الطلبات', 500, 'treasury/handovers GET');
  }
}

export async function POST(request) {
  const auth = await requireAuth(request, ['admin', 'manager', 'driver']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const body = await request.json();
    const kind = body.kind === 'funding' ? 'funding' : 'handover';
    const amount = parseFloat(body.amount) || 0;
    if (amount <= 0) {
      return NextResponse.json({ error: 'المبلغ يجب أن يكون أكبر من صفر' }, { status: 400 });
    }
    const fromBox = await getBoxRef({ boxId: body.fromBoxId });
    const toBox = await getBoxRef({ boxId: body.toBoxId });
    if (!fromBox || !toBox) {
      return NextResponse.json({ error: 'الصندوق غير موجود' }, { status: 400 });
    }
    if (!validTransferPair(fromBox, toBox)) {
      return NextResponse.json({ error: 'تحويل غير مسموح بين هذين الصندوقين' }, { status: 400 });
    }
    const mFrom = managesBox(token.role, token.username, fromBox);
    const mTo = managesBox(token.role, token.username, toBox);
    if (!mFrom && !mTo) {
      return NextResponse.json({ error: 'غير مصرح — لست طرفاً في هذا التحويل' }, { status: 403 });
    }
    const res = await initiateHandover({
      kind,
      fromBoxId: fromBox.id,
      toBoxId: toBox.id,
      amount,
      method: body.method === 'بنك' ? 'بنك' : 'كاش',
      initiatedBy: token.username,
      notes: body.notes || '',
    });
    return NextResponse.json({ success: true, ...res });
  } catch (err) {
    return apiError(err, 'خطأ في إنشاء الطلب', 400, 'treasury/handovers POST');
  }
}
