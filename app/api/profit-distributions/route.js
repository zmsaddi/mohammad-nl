import { NextResponse } from 'next/server';
import { addProfitDistribution, getProfitDistributions } from '@/lib/db';
import { ProfitDistributionSchema, zodArabicError } from '@/lib/schemas';
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

  // v1.2 audit BUG-004 — validate body with Zod before passing to addProfitDistribution
  const parsed = ProfitDistributionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });

  try {
    const result = await addProfitDistribution({
      baseAmount:      parsed.data.baseAmount,
      recipients:      parsed.data.recipients,
      basePeriodStart: parsed.data.basePeriodStart || null,
      basePeriodEnd:   parsed.data.basePeriodEnd   || null,
      notes:           parsed.data.notes           || null,
      createdBy:       token.username,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return apiError(err, 'خطأ في تسجيل توزيع الأرباح', 400, 'profit-distributions POST');
  }
}
