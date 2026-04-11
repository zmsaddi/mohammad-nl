import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getRows, appendRow, getNextId, deleteRowById, SHEETS } from '@/lib/google-sheets';

async function checkAuth(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  return token;
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  try {
    const rows = await getRows(SHEETS.PRODUCTS);
    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  try {
    const data = await request.json();

    // Check if product already exists
    const existing = await getRows(SHEETS.PRODUCTS);
    const found = existing.find((p) => p['اسم المنتج'] === data.name);
    if (found) {
      return NextResponse.json({ success: true, id: found['معرف'], exists: true });
    }

    const id = await getNextId(SHEETS.PRODUCTS);
    await appendRow(SHEETS.PRODUCTS, [
      id,
      data.name,
      data.category || '',
      data.unit || '',
      data.defaultPrice || '',
      data.notes || '',
    ]);

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في إضافة البيانات' }, { status: 500 });
  }
}

export async function DELETE(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (token.role !== 'admin') return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 });

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    await deleteRowById(SHEETS.PRODUCTS, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في حذف البيانات' }, { status: 500 });
  }
}
