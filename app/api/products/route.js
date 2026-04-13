import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getProducts, addProduct, deleteProduct } from '@/lib/db';
import { invalidateCache } from '@/lib/entity-resolver';

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  try {
    let rows = await getProducts();
    // Strip buy_price at the server — sellers must never receive cost data
    if (token.role === 'seller') rows = rows.map(({ buy_price, ...rest }) => rest);
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[products] GET:', err);
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
    invalidateCache(); // product list changed — rebuild entity-resolver index
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[products] POST:', err);
    return NextResponse.json({ error: 'خطأ في إضافة البيانات' }, { status: 500 });
  }
}

// DONE: Step 4 — admin can edit category, unit, sell_price, notes, low_stock_threshold.
// buy_price and stock are deliberately NOT editable here — they are computed from purchases
// (weighted average) and adjusted only via purchase movements.
//
// COALESCE pattern: each field is updated only when the caller explicitly provides it.
// When the caller omits a field it stays unchanged, so legacy callers that send only
// { id, sell_price } don't accidentally wipe the other columns.
export async function PUT(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (token.role !== 'admin') return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const data = await request.json();
    if (!data.id) return NextResponse.json({ error: 'معرف المنتج مطلوب' }, { status: 400 });
    const { sql } = await import('@vercel/postgres');
    await sql`
      UPDATE products SET
        sell_price          = COALESCE(${data.sell_price ?? null},          sell_price),
        category            = COALESCE(${data.category ?? null},            category),
        unit                = COALESCE(${data.unit ?? null},                unit),
        notes               = COALESCE(${data.notes ?? null},               notes),
        low_stock_threshold = COALESCE(${data.low_stock_threshold ?? null}, low_stock_threshold)
      WHERE id = ${data.id}
    `;
    invalidateCache();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[products] PUT:', err);
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
    invalidateCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[products] DELETE:', error);
    const safe = error?.message && /^[\u0600-\u06FF]/.test(error.message) ? error.message : 'خطأ في حذف البيانات';
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}
