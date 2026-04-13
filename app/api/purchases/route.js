import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getPurchases, addPurchase, deletePurchase, updatePurchase } from '@/lib/db';
import { PurchaseSchema, zodArabicError } from '@/lib/schemas';
import { invalidateCache } from '@/lib/entity-resolver';

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin','manager'].includes(token.role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const rows = await getPurchases();
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[purchases] GET:', err);
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin','manager'].includes(token.role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const body = await request.json();
    const parsed = PurchaseSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });

    const data = { ...parsed.data, createdBy: token.username };
    const id = await addPurchase(data);
    invalidateCache(); // new product may have been created
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('[purchases] POST:', error);
    const safe = error?.message && /^[\u0600-\u06FF]/.test(error.message) ? error.message : 'خطأ في إضافة البيانات';
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}

export async function PUT(request) {
  const token = await checkAuth(request);
  if (!token || token.role !== 'admin') return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const data = await request.json();
    await updatePurchase(data);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[purchases] PUT:', err);
    return NextResponse.json({ error: 'خطأ في تحديث البيانات' }, { status: 500 });
  }
}

export async function DELETE(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (token.role !== 'admin') return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    await deletePurchase(searchParams.get('id'));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[purchases] DELETE:', err);
    return NextResponse.json({ error: 'خطأ في حذف البيانات' }, { status: 500 });
  }
}
