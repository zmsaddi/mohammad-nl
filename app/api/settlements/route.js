import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getSettlements, addSettlement } from '@/lib/db';

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
  } catch {
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = await checkAuth(request);
  if (!token || token.role !== 'admin') {
    return NextResponse.json({ error: 'غير مصرح - المدير فقط' }, { status: 403 });
  }
  try {
    const data = await request.json();
    const id = await addSettlement({ ...data, settledBy: token.username });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    // Arabic messages from db.js are safe user-facing validations; hide everything else
    const safe = /^[\u0600-\u06FF]/.test(error?.message || '') ? error.message : 'خطأ في تسجيل التسوية';
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}
