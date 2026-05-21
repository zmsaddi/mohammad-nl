import { NextResponse } from 'next/server';
import { getCashBoxesForViewer } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// Read-only treasury view. Box visibility is RBAC-scoped in
// getCashBoxesForViewer (admin = all, manager = own + drivers', driver = own).
// `enabled` reflects the TREASURY_ENABLED flag so the UI can show a
// "not-live-yet" notice while balances are still zero.
export async function GET(request) {
  const auth = await requireAuth(request, ['admin', 'manager', 'driver']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const boxes = await getCashBoxesForViewer(token.role, token.username);
    return NextResponse.json({ enabled: process.env.TREASURY_ENABLED === 'true', boxes });
  } catch (err) {
    return apiError(err, 'خطأ في جلب الصناديق', 500, 'treasury/boxes GET');
  }
}
