import { NextResponse } from 'next/server';
import { getPendingCapitalOps, initiateCapitalOp } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// Capital operations (money IN/OUT of the project). Admin-only.
// GET  → pending operations + approval progress.
// POST → initiate an injection/withdrawal (applies immediately if a single
//        admin; otherwise waits for ALL admins to approve).
export async function GET(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await getPendingCapitalOps());
  } catch (err) {
    return apiError(err, 'خطأ في جلب العمليات', 500, 'treasury/capital GET');
  }
}

export async function POST(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const body = await request.json();
    const amount = parseFloat(body.amount) || 0;
    if (amount <= 0) return NextResponse.json({ error: 'المبلغ يجب أن يكون أكبر من صفر' }, { status: 400 });
    const res = await initiateCapitalOp({
      kind: body.kind === 'withdrawal' ? 'withdrawal' : 'injection',
      amount,
      method: body.method === 'بنك' ? 'بنك' : 'كاش',
      initiatedBy: token.username,
      notes: body.notes || '',
    });
    return NextResponse.json({ success: true, ...res });
  } catch (err) {
    return apiError(err, 'خطأ في إنشاء العملية', 400, 'treasury/capital POST');
  }
}
