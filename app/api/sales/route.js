import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getSales, addSale, deleteSale } from '@/lib/db';

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    let rows = await getSales(searchParams.get('client'));
    if (token.role === 'seller') rows = rows.filter(r => r.created_by === token.username);
    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin','manager','seller'].includes(token.role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const data = await request.json();
    data.createdBy = token.username;

    // Seller cannot sell below recommended price (backend validation)
    if (token.role === 'seller' && data.item) {
      const { sql: sqlQ } = await import('@vercel/postgres');
      const { rows: prod } = await sqlQ`SELECT sell_price FROM products WHERE name = ${data.item}`;
      if (prod.length > 0 && prod[0].sell_price > 0 && parseFloat(data.unitPrice) < prod[0].sell_price) {
        return NextResponse.json({ error: `لا يمكن البيع بأقل من السعر الموصى (${prod[0].sell_price})` }, { status: 400 });
      }
    }

    const { saleId, deliveryId, refCode } = await addSale(data);
    return NextResponse.json({ success: true, id: saleId, deliveryId, refCode });
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
    await deleteSale(searchParams.get('id'));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في حذف البيانات' }, { status: 500 });
  }
}
