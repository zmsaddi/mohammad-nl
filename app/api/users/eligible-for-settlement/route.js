import { NextResponse } from 'next/server';
import { getEligibleUsersForSettlement } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// v1.0.1 Feature 3 — returns the users relevant to a given settlement
// type with their live unsettled credit balance, so the settlement form
// can filter the recipient dropdown by role and grey out users whose
// available_credit is 0.

export async function GET(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || '';
    const allowedTypes = ['seller_payout', 'driver_payout', 'profit_distribution'];
    if (!allowedTypes.includes(type)) {
      return NextResponse.json({ error: 'نوع التسوية غير صحيح' }, { status: 400 });
    }
    const rows = await getEligibleUsersForSettlement(type);
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err, 'خطأ في جلب المستخدمين', 500, 'users/eligible-for-settlement GET');
  }
}
