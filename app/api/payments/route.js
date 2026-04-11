import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getRows, appendRow, getNextId, SHEETS } from '@/lib/google-sheets';

async function checkAuth(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  return token;
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const clientName = searchParams.get('client');

    let rows = await getRows(SHEETS.PAYMENTS);
    if (clientName) {
      rows = rows.filter((r) => r['اسم العميل'] === clientName);
    }
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
    const id = await getNextId(SHEETS.PAYMENTS);

    await appendRow(SHEETS.PAYMENTS, [
      id,
      data.date,
      data.clientName,
      data.amount,
      data.saleId || '',
      data.notes || '',
    ]);

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في إضافة البيانات' }, { status: 500 });
  }
}
