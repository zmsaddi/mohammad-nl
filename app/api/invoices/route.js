import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getInvoices } from '@/lib/db';

export async function GET(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  try {
    // Admin/Manager see all, Seller sees own only
    if (['admin', 'manager'].includes(token.role)) {
      const rows = await getInvoices();
      return NextResponse.json(rows);
    }
    if (token.role === 'seller') {
      const rows = await getInvoices(token.username);
      return NextResponse.json(rows);
    }
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
