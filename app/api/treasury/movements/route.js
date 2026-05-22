import { NextResponse } from 'next/server';
import { getCashBoxesForViewer, getBoxMovements } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// Read-only per-box money-movement ledger for the "حركات الأموال" tabs.
// The requested box MUST be one the caller is allowed to see — the SAME RBAC
// scope as the boxes list (admin = any box, manager = own + drivers', driver =
// own). This server-side guard is the real boundary: the UI only renders the
// tabs a viewer may see, but money privacy must never depend on the UI alone.
export async function GET(request) {
  const auth = await requireAuth(request, ['admin', 'manager', 'driver']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const boxId = Number(new URL(request.url).searchParams.get('boxId'));
    if (!Number.isInteger(boxId) || boxId <= 0) {
      return NextResponse.json({ error: 'معرّف صندوق غير صالح' }, { status: 400 });
    }
    const allowed = await getCashBoxesForViewer(token.role, token.username);
    if (!allowed.some((b) => b.id === boxId)) {
      return NextResponse.json({ error: 'غير مصرح بعرض حركات هذا الصندوق' }, { status: 403 });
    }
    const movements = await getBoxMovements(boxId);
    return NextResponse.json(movements);
  } catch (err) {
    return apiError(err, 'خطأ في جلب حركات الصندوق', 500, 'treasury/movements GET');
  }
}
