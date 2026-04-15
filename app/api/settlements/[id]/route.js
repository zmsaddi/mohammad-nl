import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getSettlementDetails } from '@/lib/db';

// v1.0.1 Feature 2 — settlement drill-down endpoint. Returns the
// settlement row plus every bonus row that was marked settled by
// this settlement_id, each joined to its sale + invoice.

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request, { params }) {
  const token = await checkAuth(request);
  if (!token || token.role !== 'admin') {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }
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
    console.error('[settlements/[id]] GET:', err);
    return NextResponse.json({ error: 'خطأ في جلب التسوية' }, { status: 500 });
  }
}
