import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { initDatabase } from '@/lib/db';

export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token || token.role !== 'admin') {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }

  try {
    await initDatabase();
    return NextResponse.json({ success: true, message: 'تم تهيئة قاعدة البيانات بنجاح' });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في تهيئة قاعدة البيانات: ' + error.message }, { status: 500 });
  }
}
