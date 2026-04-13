import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getSettings, updateSettings } from '@/lib/db';

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  try {
    const settings = await getSettings();
    return NextResponse.json(settings);
  } catch (err) {
    console.error('[settings] GET:', err);
    return NextResponse.json({ error: 'خطأ في معالجة الإعدادات' }, { status: 500 });
  }
}

export async function PUT(request) {
  const token = await checkAuth(request);
  if (!token || token.role !== 'admin') return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const data = await request.json();
    await updateSettings(data);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[settings] PUT:', err);
    return NextResponse.json({ error: 'خطأ في معالجة الإعدادات' }, { status: 500 });
  }
}
