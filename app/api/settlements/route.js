import { NextResponse } from 'next/server';
import { getSettlements, addSettlement } from '@/lib/db';
import { SettlementSchema, zodArabicError } from '@/lib/schemas';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

export async function GET(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const rows = await getSettlements();
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err, 'خطأ في جلب البيانات', 500, 'settlements GET');
  }
}

export async function POST(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const body = await request.json();
    const parsed = SettlementSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });

    const id = await addSettlement({ ...parsed.data, settledBy: token.username });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    return apiError(error, 'خطأ في تسجيل التسوية', 400, 'settlements POST');
  }
}
