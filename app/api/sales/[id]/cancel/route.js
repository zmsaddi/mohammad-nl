import { NextResponse } from 'next/server';
import { previewCancelSale, commitCancelSale } from '@/lib/db';
import { canCancelSale, CANCEL_DENIED_ERROR } from '@/lib/cancel-rule';
import { sql } from '@vercel/postgres';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

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

function parseId(params) {
  const { id } = params;
  const saleId = parseInt(id, 10);
  if (!Number.isInteger(saleId) || saleId <= 0) return null;
  return saleId;
}

export async function GET(request, { params }) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;
  const { token } = auth;

  const saleId = parseId(await params);
  if (!saleId) return NextResponse.json({ error: 'معرّف الطلب غير صحيح' }, { status: 400 });

  try {
    const { refundAmount, preview } = await previewCancelSale(saleId, token.username);
    return NextResponse.json({ refundAmount, preview });
  } catch (err) {
    return apiError(err, 'خطأ في جلب معاينة الإلغاء', 400, 'sales/cancel GET');
  }
}

export async function POST(request, { params }) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;
  const { token } = auth;

  const saleId = parseId(await params);
  if (!saleId) return NextResponse.json({ error: 'معرّف الطلب غير صحيح' }, { status: 400 });

  // Locked rule enforcement — managers may NOT cancel confirmed sales,
  // even though the outer admin+manager gate lets them reach here. Look
  // up the row first and let the shared canCancelSale() helper decide.
  // Same helper powers UI button visibility, so the two layers can never
  // drift apart.
  const { rows: saleRows } = await sql`
    SELECT status, created_by FROM sales WHERE id = ${saleId}
  `;
  if (!saleRows.length) {
    return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
  }
  const sale = saleRows[0];
  if (!canCancelSale(sale, { role: token.role, username: token.username })) {
    return NextResponse.json({ error: CANCEL_DENIED_ERROR }, { status: 403 });
  }

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

    return apiError(err, 'خطأ في تنفيذ الإلغاء', 400, 'sales/cancel POST');
  }
}
