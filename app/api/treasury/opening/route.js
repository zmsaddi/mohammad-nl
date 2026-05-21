import { NextResponse } from 'next/server';
import { setOpeningBalance } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// Set/replace a box's OPENING balance (physical cash count at go-live).
// Admin-only — this is the deliberate initialization of the treasury baseline.
export async function POST(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const body = await request.json();
    const boxId = parseInt(body.boxId, 10);
    if (!boxId) return NextResponse.json({ error: 'الصندوق مطلوب' }, { status: 400 });
    const amount = parseFloat(body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: 'أدخل رصيداً افتتاحياً صحيحاً (≥ 0)' }, { status: 400 });
    }
    const res = await setOpeningBalance(boxId, amount, token.username);
    return NextResponse.json({ success: true, ...res });
  } catch (err) {
    return apiError(err, 'خطأ في إدخال الرصيد الافتتاحي', 400, 'treasury/opening POST');
  }
}
