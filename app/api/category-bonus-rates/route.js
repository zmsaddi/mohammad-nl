import { NextResponse } from 'next/server';
import { getCategoryBonusRates, setCategoryBonusRate, deleteCategoryBonusRate } from '@/lib/db';
import { CategoryBonusRateUpdateSchema, zodArabicError } from '@/lib/schemas';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// Per-category bonus rate overrides. Admin-only. Mirrors
// /api/users/bonus-rates but keyed on the product category.
// GET    → list all category rate rows (categories with no row use globals)
// PUT    → upsert one category's rate
// DELETE → remove a category's rate (revert it to the global defaults)

export async function GET(request) {
  // Any authenticated user may READ the rates (the sale-form commission
  // preview needs them for sellers). Writes below stay admin-only.
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const rates = await getCategoryBonusRates();
    return NextResponse.json(rates);
  } catch (err) {
    return apiError(err, 'خطأ في جلب البيانات', 500, 'category-bonus-rates GET');
  }
}

export async function PUT(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const body = await request.json();
    const parsed = CategoryBonusRateUpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });
    await setCategoryBonusRate({ ...parsed.data, updatedBy: token.username });
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في حفظ البيانات', 400, 'category-bonus-rates PUT');
  }
}

export async function DELETE(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    if (!category) {
      return NextResponse.json({ error: 'الفئة مطلوبة' }, { status: 400 });
    }
    await deleteCategoryBonusRate(category);
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في حذف البيانات', 500, 'category-bonus-rates DELETE');
  }
}
