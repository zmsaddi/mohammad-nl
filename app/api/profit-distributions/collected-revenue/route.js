import { NextResponse } from 'next/server';
import { getDistributablePoolForPeriod } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

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

export async function GET(request) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;
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
    return apiError(err, 'خطأ في حساب المُحصَّل', 500, 'profit-distributions/collected-revenue GET');
  }
}
