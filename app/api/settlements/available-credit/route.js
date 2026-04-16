import { NextResponse } from 'next/server';
import { getAvailableCredit } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// v1.0.1 Feature 1 — live available-credit probe used by the settlement
// form UI to render a green/red indicator under the amount field and to
// disable the submit button when requested > available.

export async function GET(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username') || '';
    const type = searchParams.get('type') || '';
    if (!username) {
      return NextResponse.json({ error: 'اسم المستخدم مطلوب' }, { status: 400 });
    }
    const allowedTypes = ['seller_payout', 'driver_payout', 'profit_distribution'];
    if (!allowedTypes.includes(type)) {
      return NextResponse.json({ error: 'نوع التسوية غير صحيح' }, { status: 400 });
    }
    const available = await getAvailableCredit(username, type);
    return NextResponse.json({ available });
  } catch (err) {
    return apiError(err, 'خطأ في حساب الرصيد', 500, 'settlements/available-credit GET');
  }
}
