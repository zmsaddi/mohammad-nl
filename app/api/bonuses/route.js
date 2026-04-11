import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getBonuses } from '@/lib/db';

export async function GET(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  try {
    // Admin sees all, others see only their own
    if (token.role === 'admin') {
      const rows = await getBonuses();
      return NextResponse.json(rows);
    }
    const rows = await getBonuses(token.username);
    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
