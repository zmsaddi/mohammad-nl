import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { initDatabase, resetDatabase } from '@/lib/db';

export async function GET(request) {
  return handleInit(request);
}

export async function POST(request) {
  return handleInit(request);
}

async function handleInit(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token || token.role !== 'admin') {
    return NextResponse.json({ error: 'غير مصرح - سجل دخول كمدير أولاً' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get('reset') === 'true') {
      await resetDatabase();
      return NextResponse.json({ success: true, message: 'تم إعادة تهيئة قاعدة البيانات بالكامل' });
    }
    await initDatabase();
    return NextResponse.json({ success: true, message: 'تم تهيئة قاعدة البيانات بنجاح' });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ: ' + error.message }, { status: 500 });
  }
}
