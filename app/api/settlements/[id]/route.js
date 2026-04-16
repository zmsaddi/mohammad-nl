import { NextResponse } from 'next/server';
import { getSettlementDetails } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// v1.0.1 Feature 2 — settlement drill-down endpoint. Returns the
// settlement row plus every bonus row that was marked settled by
// this settlement_id, each joined to its sale + invoice.

export async function GET(request, { params }) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const settlementId = parseInt(id, 10);
    if (!Number.isInteger(settlementId) || settlementId <= 0) {
      return NextResponse.json({ error: 'معرّف التسوية غير صحيح' }, { status: 400 });
    }
    const details = await getSettlementDetails(settlementId);
    if (!details) {
      return NextResponse.json({ error: 'التسوية غير موجودة' }, { status: 404 });
    }
    return NextResponse.json(details);
  } catch (err) {
    return apiError(err, 'خطأ في جلب التسوية', 500, 'settlements/[id] GET');
  }
}
