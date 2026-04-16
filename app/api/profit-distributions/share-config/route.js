import { NextResponse } from 'next/server';
import { getProfitShareConfig, setProfitSharePct } from '@/lib/db';
// SP-013: also used in PUT to return current total for validation hint
import { requireAuth } from '@/lib/api-auth';

// v1.2 — profit share configuration (per-user percentages)
// GET  → list all admin/manager users with their profit_share_pct
// PUT  → set a user's profit_share_pct (admin only)

export async function GET(request) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;
  try {
    const config = await getProfitShareConfig();
    return NextResponse.json(config);
  } catch (err) {
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function PUT(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const body = await request.json();
    if (!body.username) return NextResponse.json({ error: 'اسم المستخدم مطلوب' }, { status: 400 });
    await setProfitSharePct(body.username, body.percentage, body.startDate || null);
    // SP-013: return the current total so the UI can warn if != 100%
    const config = await getProfitShareConfig();
    const totalPct = config.reduce((s, u) => s + (parseFloat(u.profit_share_pct) || 0), 0);
    return NextResponse.json({ success: true, totalPct, warning: Math.abs(totalPct - 100) > 0.01 ? `مجموع النسب الحالي: ${totalPct}% (يجب أن يساوي 100%)` : null });
  } catch (err) {
    const safe = /^[\u0600-\u06FF]/.test(err?.message) ? err.message : 'خطأ في حفظ البيانات';
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}
