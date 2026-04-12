import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getBonuses } from '@/lib/db';

export async function GET(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  try {
    // BUG 6B — managers also need full bonus visibility for payroll oversight.
    // Sellers and drivers continue to see only their own rows.
    if (['admin', 'manager'].includes(token.role)) {
      const rows = await getBonuses();
      return NextResponse.json(rows);
    }
    const rows = await getBonuses(token.username);
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}
