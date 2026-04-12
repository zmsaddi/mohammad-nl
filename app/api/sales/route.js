import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getSales, addSale, deleteSale, updateSale } from '@/lib/db';

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
    return NextResponse.json({ error: error.message || 'خطأ في إضافة البيانات' }, { status: 500 });
  }
}

export async function PUT(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  try {
    const data = await request.json();
    // Seller can only edit their own محجوز orders
    if (token.role === 'seller') {
      const { sql: sqlQ } = await import('@vercel/postgres');
      const { rows } = await sqlQ`SELECT status, created_by FROM sales WHERE id = ${data.id}`;
      if (!rows.length) return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
      if (rows[0].created_by !== token.username) return NextResponse.json({ error: 'لا يمكنك تعديل طلب غيرك' }, { status: 403 });
      if (rows[0].status !== 'محجوز') return NextResponse.json({ error: 'لا يمكن تعديل طلب بعد التوصيل' }, { status: 403 });
    } else if (token.role !== 'admin') {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }
    await updateSale(data);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  // Seller can cancel their own محجوز orders
  if (token.role === 'seller') {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const { sql: sqlQ } = await import('@vercel/postgres');
    const { rows } = await sqlQ`SELECT status, created_by FROM sales WHERE id = ${id}`;
    if (!rows.length) return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
    if (rows[0].created_by !== token.username) return NextResponse.json({ error: 'لا يمكنك إلغاء طلب غيرك' }, { status: 403 });
    if (rows[0].status !== 'محجوز') return NextResponse.json({ error: 'لا يمكن إلغاء طلب بعد التوصيل' }, { status: 403 });
  } else if (token.role !== 'admin') {
    return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(request.url);
    await deleteSale(searchParams.get('id'));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في حذف البيانات' }, { status: 500 });
  }
}
