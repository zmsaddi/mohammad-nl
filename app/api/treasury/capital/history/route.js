import { NextResponse } from 'next/server';
import { getCapitalHistory } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// Full capital-operations log (injections + withdrawals, all statuses).
// Admin-only, like the rest of the capital flow. Read-only.
export async function GET(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await getCapitalHistory());
  } catch (err) {
    return apiError(err, 'خطأ في جلب سجلّ رأس المال', 500, 'treasury/capital/history GET');
  }
}
