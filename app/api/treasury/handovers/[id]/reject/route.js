import { NextResponse } from 'next/server';
import { getHandoverById, managesBox, rejectHandover } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// Reject/void a pending transfer (no money moves). Allowed for either party
// (manages one side) or the initiator (to cancel their own request).
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
    const allowed = managesBox(token.role, token.username, fromBox)
      || managesBox(token.role, token.username, toBox)
      || token.username === h.initiated_by;
    if (!allowed) return NextResponse.json({ error: 'غير مصرح برفض هذا الطلب' }, { status: 403 });

    await rejectHandover(h.id, token.username);
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في رفض الطلب', 400, 'treasury/handovers reject');
  }
}
