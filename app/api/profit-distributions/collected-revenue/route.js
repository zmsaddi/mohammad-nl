import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getDistributablePoolForPeriod } from '@/lib/db';

// v1.0.2 Feature 2 — period-scoped distributable pool for the
// /profit-distributions form's auto-fill widget.
//
// v1.1 F-015 — extended to return the full breakdown so the UI can
// show the user the EXACT number the F-001 cap will enforce at
// submit time. The old `total_collected` field is preserved in the
// response for backwards compatibility, but callers should prefer
// `remaining` as the auto-fill source going forward.
//
// Endpoint name kept as /collected-revenue for backwards compat;
// in a future refactor we should rename to /distributable-pool.

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
    const pool = await getDistributablePoolForPeriod(start, end);
    return NextResponse.json({
      total_collected: pool.total_collected,
      already_distributed: pool.already_distributed,
      remaining: pool.remaining,
    });
  } catch (err) {
    console.error('[profit-distributions/collected-revenue] GET:', err);
    return NextResponse.json({ error: 'خطأ في حساب المُحصَّل' }, { status: 500 });
  }
}
