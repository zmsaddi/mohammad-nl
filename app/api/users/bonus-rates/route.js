import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getUserBonusRates, setUserBonusRate, deleteUserBonusRate } from '@/lib/db';

// v1.1 F-007 — per-user bonus rate overrides. Admin-only.
// GET  → list all overrides (users without an override use globals)
// PUT  → upsert one user's override
// DELETE → remove override (revert user to globals)

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token || token.role !== 'admin') {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }
  try {
    const rates = await getUserBonusRates();
    return NextResponse.json(rates);
  } catch (err) {
    console.error('[users/bonus-rates] GET:', err);
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function PUT(request) {
  const token = await checkAuth(request);
  if (!token || token.role !== 'admin') {
    return NextResponse.json({ error: 'غير مصرح — المدير فقط' }, { status: 403 });
  }
  try {
    const body = await request.json();
    if (!body.username) {
      return NextResponse.json({ error: 'اسم المستخدم مطلوب' }, { status: 400 });
    }
    await setUserBonusRate({ ...body, updatedBy: token.username });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[users/bonus-rates] PUT:', err);
    const safe = /^[\u0600-\u06FF]/.test(err?.message || '') ? err.message : 'خطأ في حفظ البيانات';
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}

export async function DELETE(request) {
  const token = await checkAuth(request);
  if (!token || token.role !== 'admin') {
    return NextResponse.json({ error: 'غير مصرح — المدير فقط' }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');
    if (!username) {
      return NextResponse.json({ error: 'اسم المستخدم مطلوب' }, { status: 400 });
    }
    await deleteUserBonusRate(username);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[users/bonus-rates] DELETE:', err);
    return NextResponse.json({ error: 'خطأ في حذف البيانات' }, { status: 500 });
  }
}
