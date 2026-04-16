import { NextResponse } from 'next/server';
import { getAdminManagerUsers } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// v1.0.2 Feature 2 — list users eligible to be profit-distribution
// recipients. Admin + manager only (business rule locked by user).

export async function GET(request) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;
  try {
    const rows = await getAdminManagerUsers();
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err, 'خطأ في جلب المستخدمين', 500, 'profit-distributions/eligible-users GET');
  }
}
