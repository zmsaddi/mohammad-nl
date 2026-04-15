import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getAvailableCredit } from '@/lib/db';

// v1.0.1 Feature 1 — live available-credit probe used by the settlement
// form UI to render a green/red indicator under the amount field and to
// disable the submit button when requested > available.

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
    console.error('[settlements/available-credit] GET:', err);
    return NextResponse.json({ error: 'خطأ في حساب الرصيد' }, { status: 500 });
  }
}
