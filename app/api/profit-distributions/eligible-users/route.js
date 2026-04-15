import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getAdminManagerUsers } from '@/lib/db';

// v1.0.2 Feature 2 — list users eligible to be profit-distribution
// recipients. Admin + manager only (business rule locked by user).

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin', 'manager'].includes(token.role)) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }
  try {
    const rows = await getAdminManagerUsers();
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[profit-distributions/eligible-users] GET:', err);
    return NextResponse.json({ error: 'خطأ في جلب المستخدمين' }, { status: 500 });
  }
}
