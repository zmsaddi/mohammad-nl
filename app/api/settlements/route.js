import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getSettlements, addSettlement } from '@/lib/db';
import { SettlementSchema, zodArabicError } from '@/lib/schemas';

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token || token.role !== 'admin') {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }
  try {
    const rows = await getSettlements();
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[settlements] GET:', err);
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = await checkAuth(request);
  if (!token || token.role !== 'admin') {
    return NextResponse.json({ error: 'غير مصرح - المدير فقط' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const parsed = SettlementSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });

    const id = await addSettlement({ ...parsed.data, settledBy: token.username });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('[settlements] POST:', error);
    // Arabic messages from db.js are safe user-facing validations; hide everything else
    const safe = /^[\u0600-\u06FF]/.test(error?.message || '') ? error.message : 'خطأ في تسجيل التسوية';
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}
