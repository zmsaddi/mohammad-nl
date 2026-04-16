import { NextResponse } from 'next/server';
import { getUserBonusRates, setUserBonusRate, deleteUserBonusRate } from '@/lib/db';
import { BonusRateUpdateSchema, zodArabicError } from '@/lib/schemas';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// v1.1 F-007 — per-user bonus rate overrides. Admin-only.
// GET  → list all overrides (users without an override use globals)
// PUT  → upsert one user's override
// DELETE → remove override (revert user to globals)

export async function GET(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const rates = await getUserBonusRates();
    return NextResponse.json(rates);
  } catch (err) {
    return apiError(err, 'خطأ في جلب البيانات', 500, 'users/bonus-rates GET');
  }
}

export async function PUT(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const body = await request.json();
    const parsed = BonusRateUpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });
    await setUserBonusRate({ ...parsed.data, updatedBy: token.username });
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في حفظ البيانات', 400, 'users/bonus-rates PUT');
  }
}

export async function DELETE(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');
    if (!username) {
      return NextResponse.json({ error: 'اسم المستخدم مطلوب' }, { status: 400 });
    }
    await deleteUserBonusRate(username);
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في حذف البيانات', 500, 'users/bonus-rates DELETE');
  }
}
