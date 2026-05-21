import { NextResponse } from 'next/server';
import { getUserCategoryBonusRates, setUserCategoryBonusRate, deleteUserCategoryBonusRate } from '@/lib/db';
import { UserCategoryBonusRateUpdateSchema, zodArabicError } from '@/lib/schemas';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// Per-user × per-category bonus rate overrides (most specific layer).
// GET    → list all rows (optionally ?username=) — admin only (config screen)
// PUT    → upsert one (username, category) rate — admin only
// DELETE → remove one (username, category) — admin only

export async function GET(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username') || undefined;
    return NextResponse.json(await getUserCategoryBonusRates(username));
  } catch (err) {
    return apiError(err, 'خطأ في جلب البيانات', 500, 'users/category-bonus-rates GET');
  }
}

export async function PUT(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const body = await request.json();
    const parsed = UserCategoryBonusRateUpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });
    await setUserCategoryBonusRate({ ...parsed.data, updatedBy: token.username });
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في حفظ البيانات', 400, 'users/category-bonus-rates PUT');
  }
}

export async function DELETE(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');
    const category = searchParams.get('category');
    if (!username || !category) {
      return NextResponse.json({ error: 'المستخدم والفئة مطلوبان' }, { status: 400 });
    }
    await deleteUserCategoryBonusRate(username, category);
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في حذف البيانات', 500, 'users/category-bonus-rates DELETE');
  }
}
