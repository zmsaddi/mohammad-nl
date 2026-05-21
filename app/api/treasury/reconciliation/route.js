import { NextResponse } from 'next/server';
import { getTreasuryReconciliation } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// Read-only reconciliation: Σ box balances vs Σ movements (integrity), and the
// net cash computed independently from the core ledgers since the cutoff
// (coverage — surfaces any money flow the box layer missed). Admin-only.
export async function GET(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await getTreasuryReconciliation());
  } catch (err) {
    return apiError(err, 'خطأ في حساب المطابقة', 500, 'treasury/reconciliation GET');
  }
}
