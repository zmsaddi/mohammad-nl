import { NextResponse } from 'next/server';
import { getHandoverById, managesBox, confirmHandover } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// Confirm a pending transfer → money moves (both balances) atomically.
// Authority (dual-confirm): the confirmer must MANAGE one side, and must NOT
// be the initiator — unless they manage BOTH boxes (a self-transfer, e.g. an
// admin moving his own custody to the general box).
export async function POST(request, { params }) {
  const auth = await requireAuth(request, ['admin', 'manager', 'driver']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const { id } = await params;
    const h = await getHandoverById(parseInt(id, 10));
    if (!h) return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
    if (h.status !== 'pending') return NextResponse.json({ error: 'الطلب غير معلّق' }, { status: 400 });

    const fromBox = { id: h.from_box_id, type: h.from_type, owner_username: h.from_owner, owner_role: h.from_role };
    const toBox = { id: h.to_box_id, type: h.to_type, owner_username: h.to_owner, owner_role: h.to_role };
    const mFrom = managesBox(token.role, token.username, fromBox);
    const mTo = managesBox(token.role, token.username, toBox);
    if (!mFrom && !mTo) {
      return NextResponse.json({ error: 'غير مصرح بتأكيد هذا الطلب' }, { status: 403 });
    }
    if (token.username === h.initiated_by && !(mFrom && mTo)) {
      return NextResponse.json({ error: 'يجب أن يؤكّد الطرف الآخر — لا يمكنك تأكيد طلبك بنفسك' }, { status: 403 });
    }
    await confirmHandover(h.id, token.username);
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في تأكيد الطلب', 400, 'treasury/handovers confirm');
  }
}
