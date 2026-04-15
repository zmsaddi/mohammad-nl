import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getEligibleUsersForSettlement } from '@/lib/db';

// v1.0.1 Feature 3 — returns the users relevant to a given settlement
// type with their live unsettled credit balance, so the settlement form
// can filter the recipient dropdown by role and grey out users whose
// available_credit is 0.

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token || token.role !== 'admin') {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }
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
    console.error('[users/eligible-for-settlement] GET:', err);
    return NextResponse.json({ error: 'خطأ في جلب المستخدمين' }, { status: 500 });
  }
}
