import { NextResponse } from 'next/server';
import { getProducts, addProduct, deleteProduct } from '@/lib/db';
import { ProductSchema, ProductUpdateSchema, zodArabicError } from '@/lib/schemas';
import { invalidateCache } from '@/lib/entity-resolver';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    let rows = await getProducts();
    // Strip buy_price at the server — sellers must never receive cost data
    if (token.role === 'seller') rows = rows.map(({ buy_price, ...rest }) => rest);
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err, 'خطأ في جلب البيانات', 500, 'products GET');
  }
}

export async function POST(request) {
  const auth = await requireAuth(request, ['admin', 'manager', 'seller']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const body = await request.json();
    const parsed = ProductSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });

    const data = { ...parsed.data, createdBy: token.username };
    // Sellers can only upsert a name shell — they cannot set prices or stock.
    // The coercion runs AFTER Zod so the schema still validates the shape
    // the seller sent (good signal for future debugging).
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
    return apiError(err, 'خطأ في إضافة البيانات', 500, 'products POST');
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
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const body = await request.json();
    const parsed = ProductUpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });
    const data = parsed.data;
    const { sql } = await import('@vercel/postgres');

    // BUG-30 mirror: if the update payload includes a new sell_price,
    // verify it is >= the current buy_price. Only fires when sell_price
    // is actually being changed — editing notes/category/unit on a
    // product with a legacy bad price state still succeeds (per user
    // decision). buy_price is not editable via this route (see comment
    // above), so we only need to validate sell_price against current
    // buy_price.
    if (data.sell_price !== undefined && data.sell_price !== null) {
      const newSell = parseFloat(data.sell_price);
      const { rows: current } = await sql`
        SELECT buy_price FROM products WHERE id = ${data.id}
      `;
      if (current.length > 0) {
        const curBuy = parseFloat(current[0].buy_price) || 0;
        if (curBuy > 0 && newSell > 0 && newSell < curBuy) {
          return NextResponse.json(
            {
              error: `سعر البيع الموصى (${newSell}€) لا يمكن أن يكون أقل من سعر الشراء (${curBuy}€).`,
            },
            { status: 400 }
          );
        }
      }
    }

    await sql`
      UPDATE products SET
        sell_price          = COALESCE(${data.sell_price ?? null},          sell_price),
        description_ar      = COALESCE(${data.description_ar ?? null},      description_ar),
        category            = COALESCE(${data.category ?? null},            category),
        unit                = COALESCE(${data.unit ?? null},                unit),
        notes               = COALESCE(${data.notes ?? null},               notes),
        low_stock_threshold = COALESCE(${data.low_stock_threshold ?? null}, low_stock_threshold)
      WHERE id = ${data.id}
    `;
    invalidateCache();
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في تحديث البيانات', 500, 'products PUT');
  }
}

export async function DELETE(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    await deleteProduct(searchParams.get('id'));
    invalidateCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError(error, 'خطأ في حذف البيانات', 400, 'products DELETE');
  }
}
