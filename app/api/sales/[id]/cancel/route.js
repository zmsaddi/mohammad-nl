import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { previewCancelSale, commitCancelSale } from '@/lib/db';

/**
 * FEAT-05: cancellation preview + commit endpoints.
 *
 *   GET  /api/sales/[id]/cancel  → returns the preview payload the
 *     admin-facing cancellation dialog uses (refund amount, bonus
 *     disposition questions, settled-bonus block state). Never writes.
 *
 *   POST /api/sales/[id]/cancel  → commits the cancellation. Body:
 *     {
 *       reason: string,                               // required
 *       invoiceMode?: 'soft'|'delete',                // default 'soft'
 *       bonusActions?: { seller?:'keep'|'remove',     // required whenever
 *                        driver?:'keep'|'remove' },   //   non-settled bonus exists
 *       notes?: string,
 *     }
 *     On settled-bonus block → 409 with Arabic message.
 *     On BONUS_CHOICE_REQUIRED → 428 with preview payload.
 *     On success → 200 with { cancellationId, refundAmount, preview }.
 *
 * Auth: admin + manager only. Sellers and drivers cannot cancel.
 */

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

function parseId(params) {
  const { id } = params;
  const saleId = parseInt(id, 10);
  if (!Number.isInteger(saleId) || saleId <= 0) return null;
  return saleId;
}

export async function GET(request, { params }) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin', 'manager'].includes(token.role)) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }

  const saleId = parseId(await params);
  if (!saleId) return NextResponse.json({ error: 'معرّف الطلب غير صحيح' }, { status: 400 });

  try {
    const { refundAmount, preview } = await previewCancelSale(saleId, token.username);
    return NextResponse.json({ refundAmount, preview });
  } catch (err) {
    console.error('[sales/cancel] GET:', err);
    // User-facing Arabic errors are safe to surface as-is
    const safe = err?.message && /^[\u0600-\u06FF]/.test(err.message) ? err.message : 'خطأ في جلب معاينة الإلغاء';
    const status = err?.message === 'الطلب غير موجود' ? 404 : 400;
    return NextResponse.json({ error: safe }, { status });
  }
}

export async function POST(request, { params }) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin', 'manager'].includes(token.role)) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }

  const saleId = parseId(await params);
  if (!saleId) return NextResponse.json({ error: 'معرّف الطلب غير صحيح' }, { status: 400 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'جسم الطلب غير صالح' }, { status: 400 });
  }

  const reason = (body?.reason || '').trim();
  if (!reason) {
    return NextResponse.json({ error: 'سبب الإلغاء مطلوب' }, { status: 400 });
  }
  const invoiceMode = body?.invoiceMode === 'delete' ? 'delete' : 'soft';
  const bonusActions = body?.bonusActions || null;
  const notes = body?.notes || null;

  try {
    const result = await commitCancelSale(saleId, {
      cancelledBy: token.username,
      reason,
      invoiceMode,
      bonusActions,
      notes,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[sales/cancel] POST:', err);

    // BONUS_CHOICE_REQUIRED is surfaced as 428 Precondition Required with
    // the preview payload attached so the UI can show the dialog.
    if (err?.code === 'BONUS_CHOICE_REQUIRED') {
      return NextResponse.json(
        {
          error: 'BONUS_CHOICE_REQUIRED',
          message: 'يجب اختيار مصير المكافآت قبل إلغاء الطلب',
          preview: err.preview,
        },
        { status: 428 }
      );
    }

    // Settled-bonus block → 409 Conflict with the role-specific Arabic error
    if (
      err?.code === 'SETTLED_BONUS_BOTH' ||
      err?.code === 'SETTLED_BONUS_SELLER' ||
      err?.code === 'SETTLED_BONUS_DRIVER'
    ) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 409 }
      );
    }

    const safe = err?.message && /^[\u0600-\u06FF]/.test(err.message) ? err.message : 'خطأ في تنفيذ الإلغاء';
    const status = err?.message === 'الطلب غير موجود' ? 404 : 400;
    return NextResponse.json({ error: safe }, { status });
  }
}
