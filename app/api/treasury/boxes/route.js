import { NextResponse } from 'next/server';
import { getCashBoxesForViewer, getBoxRef } from '@/lib/db';
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
    // The general box + the caller's own box ids are needed as transfer
    // endpoints even for a driver who doesn't otherwise "see" the general box.
    const general = await getBoxRef({ general: true });
    const mine = token.username ? await getBoxRef({ owner: token.username }) : null;
    return NextResponse.json({
      enabled: process.env.TREASURY_ENABLED === 'true',
      boxes,
      generalBoxId: general?.id ?? null,
      myBoxId: mine?.id ?? null,
    });
  } catch (err) {
    return apiError(err, 'خطأ في جلب الصناديق', 500, 'treasury/boxes GET');
  }
}
