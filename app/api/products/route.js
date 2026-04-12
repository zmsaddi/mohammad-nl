import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getProducts, addProduct, deleteProduct } from '@/lib/db';

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  try {
    let rows = await getProducts();
    if (token.role === 'seller') rows = rows.map(({buy_price, ...rest}) => rest);
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
    // Sellers can only upsert a name shell — they cannot set prices or stock
    if (token.role === 'seller') {
      data.buyPrice = 0;
      data.sellPrice = 0;
      data.stock = 0;
      data.category = '';
      data.unit = '';
    }
    const result = await addProduct(data);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في إضافة البيانات' }, { status: 500 });
  }
}

export async function PUT(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (token.role !== 'admin') return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const data = await request.json();
    const { sql } = await import('@vercel/postgres');
    await sql`UPDATE products SET sell_price = ${data.sell_price || 0} WHERE id = ${data.id}`;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في تحديث البيانات' }, { status: 500 });
  }
}

export async function DELETE(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (token.role !== 'admin') return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    await deleteProduct(searchParams.get('id'));
    return NextResponse.json({ success: true });
  } catch (error) {
    const safe = error?.message && /^[\u0600-\u06FF]/.test(error.message) ? error.message : 'خطأ في حذف البيانات';
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}
