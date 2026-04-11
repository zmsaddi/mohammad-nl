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
    const rows = await getRows(SHEETS.EXPENSES);
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
    const id = await getNextId(SHEETS.EXPENSES);

    await appendRow(SHEETS.EXPENSES, [
      id,
      data.date,
      data.category,
      data.description,
      data.amount,
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
    await deleteRowById(SHEETS.EXPENSES, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في حذف البيانات' }, { status: 500 });
  }
}
