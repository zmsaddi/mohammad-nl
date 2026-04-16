import { NextResponse } from 'next/server';
import { addProfitDistribution, getProfitDistributions } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// v1.0.2 Feature 2 — profit distribution (توزيع أرباح)
//
//   GET  /api/profit-distributions  → list (admin + manager)
//   POST /api/profit-distributions  → create (admin ONLY per locked rule)

export async function GET(request) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;
  try {
    const rows = await getProfitDistributions();
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err, 'خطأ في جلب البيانات', 500, 'profit-distributions GET');
  }
}

export async function POST(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  const { token } = auth;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'جسم الطلب غير صالح' }, { status: 400 });
  }

  try {
    const result = await addProfitDistribution({
      baseAmount:      body.baseAmount,
      recipients:      body.recipients,
      basePeriodStart: body.basePeriodStart || null,
      basePeriodEnd:   body.basePeriodEnd   || null,
      notes:           body.notes           || null,
      createdBy:       token.username,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return apiError(err, 'خطأ في تسجيل توزيع الأرباح', 400, 'profit-distributions POST');
  }
}
