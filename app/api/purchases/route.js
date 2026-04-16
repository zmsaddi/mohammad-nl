import { NextResponse } from 'next/server';
import { getPurchases, addPurchase, deletePurchase, updatePurchase } from '@/lib/db';
import { PurchaseSchema, zodArabicError } from '@/lib/schemas';
import { invalidateCache } from '@/lib/entity-resolver';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

export async function GET(request) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;
  try {
    const rows = await getPurchases();
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err, 'خطأ في جلب البيانات', 500, 'purchases GET');
  }
}

export async function POST(request) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const body = await request.json();
    const parsed = PurchaseSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });

    const data = { ...parsed.data, createdBy: token.username };
    const id = await addPurchase(data);
    invalidateCache(); // new product may have been created
    return NextResponse.json({ success: true, id });
  } catch (error) {
    return apiError(error, 'خطأ في إضافة البيانات', 400, 'purchases POST');
  }
}

export async function PUT(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const data = await request.json();
    await updatePurchase(data);
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في تحديث البيانات', 500, 'purchases PUT');
  }
}

export async function DELETE(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    await deletePurchase(searchParams.get('id'));
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في حذف البيانات', 500, 'purchases DELETE');
  }
}
