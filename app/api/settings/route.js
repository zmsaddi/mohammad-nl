import { NextResponse } from 'next/server';
import { getSettings, updateSettings } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const settings = await getSettings();
    return NextResponse.json(settings);
  } catch (err) {
    return apiError(err, 'خطأ في معالجة الإعدادات', 500, 'settings GET');
  }
}

export async function PUT(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const data = await request.json();
    await updateSettings(data);
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في معالجة الإعدادات', 500, 'settings PUT');
  }
}
