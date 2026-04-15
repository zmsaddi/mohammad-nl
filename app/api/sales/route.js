import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getSales, addSale, deleteSale, updateSale } from '@/lib/db';
import { SaleSchema, SaleUpdateSchema, zodArabicError } from '@/lib/schemas';
import { invalidateCache } from '@/lib/entity-resolver';
import { canCancelSale, CANCEL_DENIED_ERROR } from '@/lib/cancel-rule';

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
  } catch (err) {
    console.error('[sales] GET:', err);
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin','manager','seller'].includes(token.role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
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
    console.error('[sales] POST:', error);
    const safe = isSafeError(error) ? error.message : 'خطأ في إضافة البيانات';
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}

// Validation errors thrown by lib/db.js are user-facing Arabic strings — safe to return.
function isSafeError(error) {
  if (!error || !error.message) return false;
  return /^[\u0600-\u06FF]/.test(error.message);
}

export async function PUT(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin', 'manager', 'seller'].includes(token.role)) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const parsed = SaleUpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });

    const { sql: sqlQ } = await import('@vercel/postgres');
    const { rows } = await sqlQ`SELECT status, created_by FROM sales WHERE id = ${parsed.data.id}`;
    if (!rows.length) return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
    if (rows[0].status !== 'محجوز') {
      return NextResponse.json({ error: 'لا يمكن تعديل طلب بعد التوصيل أو الإلغاء' }, { status: 403 });
    }
    if (token.role === 'seller' && rows[0].created_by !== token.username) {
      return NextResponse.json({ error: 'لا يمكنك تعديل طلب غيرك' }, { status: 403 });
    }
    await updateSale(parsed.data);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[sales] PUT:', err);
    return NextResponse.json({ error: 'خطأ في تحديث البيانات' }, { status: 500 });
  }
}

export async function DELETE(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  // Session 9 locked cancel rule — driver blocked at the outer gate.
  // admin + manager + seller may reach here, and the shared helper
  // below enforces the role × status matrix exactly.
  if (!['admin', 'manager', 'seller'].includes(token.role)) {
    return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 });
  }
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
    await deleteSale(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[sales] DELETE:', err);
    return NextResponse.json({ error: 'خطأ في حذف البيانات' }, { status: 500 });
  }
}
