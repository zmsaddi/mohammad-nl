import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getSummaryData } from '@/lib/db';
import { sql } from '@vercel/postgres';

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  // DONE: Fix 3 — sellers get a lightweight personal-stats payload only.
  // No P&L, no costs, no other sellers' data — strictly their own sales + bonuses.
  if (token.role === 'seller') {
    try {
      const { rows: mySales } = await sql`SELECT * FROM sales WHERE created_by = ${token.username}`;
      const { rows: myBonuses } = await sql`SELECT * FROM bonuses WHERE username = ${token.username}`;

      const confirmed = mySales.filter((s) => s.status === 'مؤكد');
      const reserved  = mySales.filter((s) => s.status === 'محجوز');

      return NextResponse.json({
        sellerView:       true,
        totalSales:       confirmed.length,
        totalRevenue:     confirmed.reduce((s, r) => s + (r.total || 0), 0),
        reservedCount:    reserved.length,
        reservedRevenue:  reserved.reduce((s, r) => s + (r.total || 0), 0),
        totalBonusEarned: myBonuses.reduce((s, b) => s + (b.total_bonus || 0), 0),
        totalBonusPaid:   myBonuses.filter((b) => b.settled).reduce((s, b) => s + (b.total_bonus || 0), 0),
        totalBonusOwed:   myBonuses.filter((b) => !b.settled).reduce((s, b) => s + (b.total_bonus || 0), 0),
      });
    } catch (err) {
      console.error('[summary] GET:', err);
      return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
    }
  }

  if (!['admin','manager'].includes(token.role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    const data = await getSummaryData(searchParams.get('from'), searchParams.get('to'));
    return NextResponse.json(data);
  } catch (err) {
    console.error('[summary] GET:', err);
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}
