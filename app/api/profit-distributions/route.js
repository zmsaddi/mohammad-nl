import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { addProfitDistribution, getProfitDistributions } from '@/lib/db';

// v1.0.2 Feature 2 — profit distribution (توزيع أرباح)
//
//   GET  /api/profit-distributions  → list (admin + manager)
//   POST /api/profit-distributions  → create (admin ONLY per locked rule)

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin', 'manager'].includes(token.role)) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }
  try {
    const rows = await getProfitDistributions();
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[profit-distributions] GET:', err);
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  // Locked rule: only admin creates profit distributions. Managers can
  // view (GET above) but cannot create — keeps the authorization trail
  // explicit and prevents a manager from accidentally distributing
  // revenue that includes their own cut.
  if (token.role !== 'admin') {
    return NextResponse.json(
      { error: 'فقط المدير يمكنه إنشاء توزيع أرباح' },
      { status: 403 }
    );
  }

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
    console.error('[profit-distributions] POST:', err);
    // User-facing Arabic validation messages are safe to propagate;
    // anything else goes behind a generic message.
    const safe = /^[\u0600-\u06FF]/.test(err?.message || '')
      ? err.message
      : 'خطأ في تسجيل توزيع الأرباح';
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}
