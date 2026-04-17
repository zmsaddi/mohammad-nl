import { NextResponse } from 'next/server';
import { getSales, addSale, deleteSale, updateSale } from '@/lib/db';
import { SaleSchema, SaleUpdateSchema, zodArabicError } from '@/lib/schemas';
import { invalidateCache } from '@/lib/entity-resolver';
import { canCancelSale, CANCEL_DENIED_ERROR } from '@/lib/cancel-rule';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const { searchParams } = new URL(request.url);
    let rows = await getSales(searchParams.get('client'));
    if (token.role === 'seller') rows = rows.filter(r => r.created_by === token.username);
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err, 'خطأ في جلب البيانات', 500, 'sales GET');
  }
}

export async function POST(request) {
  const auth = await requireAuth(request, ['admin', 'manager', 'seller']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const body = await request.json();
    const parsed = SaleSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });

    const data = { ...parsed.data, createdBy: token.username };

    // BUG-30 + existing seller rule. Merged into one DB round-trip: fetch
    // BOTH sell_price (existing seller-only floor) AND buy_price (new
    // all-roles no-loss floor) in a single query, then apply the checks
    // in order of specificity (the recommended-price error is more
    // actionable for sellers than the vague cost floor).
    if (data.item) {
      const { sql: sqlQ } = await import('@vercel/postgres');
      const { rows: prod } = await sqlQ`
        SELECT sell_price, buy_price FROM products WHERE name = ${data.item}
      `;
      if (prod.length > 0) {
        const { sell_price, buy_price } = prod[0];

        // Existing rule: sellers only, recommended price floor
        if (
          token.role === 'seller' &&
          sell_price > 0 &&
          data.unitPrice < sell_price
        ) {
          return NextResponse.json(
            { error: `لا يمكن البيع بأقل من السعر الموصى (${sell_price})` },
            { status: 400 }
          );
        }

        // BUG-30: all-roles buy_price floor. Never sell below cost.
        // Role-dependent message: admin/manager see the cost, seller
        // sees vague language (buy_price is sensitive per sales/page.js:
        // 229-232). Skips when buy_price is 0 (unset / not purchased yet).
        if (buy_price > 0 && data.unitPrice < buy_price) {
          const canSeeCosts =
            token.role === 'admin' || token.role === 'manager';
          const errorMsg = canSeeCosts
            ? `سعر البيع (${data.unitPrice}€) أقل من سعر التكلفة (${buy_price}€). لا يمكن البيع بخسارة.`
            : 'سعر البيع المُدخَل غير مقبول. يرجى الالتزام بالسعر الموصى أو أعلى.';
          return NextResponse.json({ error: errorMsg }, { status: 400 });
        }
      }
    }

    const { saleId, deliveryId, refCode } = await addSale(data);
    invalidateCache(); // client may have been auto-created
    return NextResponse.json({ success: true, id: saleId, deliveryId, refCode });
  } catch (error) {
    return apiError(error, 'خطأ في إضافة البيانات', 400, 'sales POST');
  }
}

export async function PUT(request) {
  const auth = await requireAuth(request, ['admin', 'manager', 'seller']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const body = await request.json();
    const parsed = SaleUpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });

    const { sql: sqlQ } = await import('@vercel/postgres');
    const { rows } = await sqlQ`SELECT status, created_by FROM sales WHERE id = ${parsed.data.id}`;
    if (!rows.length) return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
    if (rows[0].status === 'ملغي') {
      return NextResponse.json({ error: 'لا يمكن تعديل طلب ملغي' }, { status: 403 });
    }
    // v1.2 — admin can edit confirmed sales (discount, price correction)
    if (rows[0].status === 'مؤكد' && token.role !== 'admin') {
      return NextResponse.json({ error: 'تعديل الطلب المؤكد يتطلب صلاحية المدير' }, { status: 403 });
    }
    if (rows[0].status === 'محجوز' && token.role === 'seller' && rows[0].created_by !== token.username) {
      return NextResponse.json({ error: 'لا يمكنك تعديل طلب غيرك' }, { status: 403 });
    }
    await updateSale({ ...parsed.data, adminOverride: token.role === 'admin', updatedBy: token.username });
    invalidateCache();
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في تحديث البيانات', 500, 'sales PUT');
  }
}

export async function DELETE(request) {
  const auth = await requireAuth(request, ['admin', 'manager', 'seller']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const { sql: sqlQ } = await import('@vercel/postgres');
    const { rows } = await sqlQ`SELECT status, created_by FROM sales WHERE id = ${id}`;
    if (!rows.length) return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
    // canCancelSale implements the full matrix — admin anything, manager
    // reserved only, seller own-reserved only, driver never. It replaces
    // the previous bespoke checks (status === 'محجوز' + seller ownership)
    // which would have let a manager cancel a confirmed sale via this
    // route if they went around the /api/sales/[id]/cancel entry point.
    if (!canCancelSale(rows[0], { role: token.role, username: token.username })) {
      return NextResponse.json({ error: CANCEL_DENIED_ERROR }, { status: 403 });
    }
    await deleteSale(id, { cancelledBy: token.username });
    invalidateCache();
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في حذف البيانات', 500, 'sales DELETE');
  }
}
