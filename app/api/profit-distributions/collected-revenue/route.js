import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getCollectedRevenueForPeriod } from '@/lib/db';

// v1.0.2 Feature 2 — sum of `collection` payment rows for an optional
// date range. Used by the profit-distribution form to auto-fill the
// base amount from real collected revenue. Both bounds are optional
// (omitting them returns the all-time total).

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin', 'manager'].includes(token.role)) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start') || null;
    const end = searchParams.get('end') || null;
    const total = await getCollectedRevenueForPeriod(start, end);
    return NextResponse.json({ total_collected: total });
  } catch (err) {
    console.error('[profit-distributions/collected-revenue] GET:', err);
    return NextResponse.json({ error: 'خطأ في حساب المُحصَّل' }, { status: 500 });
  }
}
