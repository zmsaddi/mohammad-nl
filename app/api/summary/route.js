import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getSummaryData } from '@/lib/db';

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin','manager'].includes(token.role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    const data = await getSummaryData(searchParams.get('from'), searchParams.get('to'));
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}
