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
  //
  // BUG-05: bounded query window. Accept ?from=YYYY-MM-DD&to=YYYY-MM-DD;
  // if both missing, default to "since the user's most recent settlement"
  // with a 90-day fallback for sellers who have never been settled. See
  // UPGRADE_LOG.md (BUG-05) for the rationale over a fixed rolling window.
  if (token.role === 'seller') {
    try {
      const { searchParams } = new URL(request.url);
      const fromParam = searchParams.get('from');
      const toParam   = searchParams.get('to');
      const isoDate   = /^\d{4}-\d{2}-\d{2}$/;

      if (fromParam && !isoDate.test(fromParam)) {
        return NextResponse.json({ error: 'صيغة from غير صحيحة (YYYY-MM-DD)' }, { status: 400 });
      }
      if (toParam && !isoDate.test(toParam)) {
        return NextResponse.json({ error: 'صيغة to غير صحيحة (YYYY-MM-DD)' }, { status: 400 });
      }

      let from = fromParam;
      let to   = toParam;
      let defaultSource = null;

      if (!from) {
        const { rows: lastSettled } = await sql`
          SELECT MAX(date) AS last_date FROM settlements WHERE username = ${token.username}
        `;
        const lastDate = lastSettled[0]?.last_date || null;
        if (lastDate) {
          from = lastDate instanceof Date
            ? lastDate.toISOString().slice(0, 10)
            : String(lastDate).slice(0, 10);
          defaultSource = 'last-settlement';
        } else {
          const d = new Date();
          d.setUTCDate(d.getUTCDate() - 90);
          from = d.toISOString().slice(0, 10);
          defaultSource = 'ninety-day-fallback';
        }
      }
      if (!to) {
        to = new Date().toISOString().slice(0, 10);
      }

      const { rows: mySales } = await sql`
        SELECT * FROM sales
        WHERE created_by = ${token.username} AND date >= ${from} AND date <= ${to}
      `;
      const { rows: myBonuses } = await sql`
        SELECT * FROM bonuses
        WHERE username = ${token.username} AND date >= ${from} AND date <= ${to}
      `;

      const confirmed = mySales.filter((s) => s.status === 'مؤكد');
      const reserved  = mySales.filter((s) => s.status === 'محجوز');

      // ARC-06: parseFloat wrapping on every NUMERIC money reducer.
      return NextResponse.json({
        sellerView:       true,
        window:           { from, to, defaultSource },
        totalSales:       confirmed.length,
        totalRevenue:     confirmed.reduce((s, r) => s + (parseFloat(r.total) || 0), 0),
        reservedCount:    reserved.length,
        reservedRevenue:  reserved.reduce((s, r) => s + (parseFloat(r.total) || 0), 0),
        totalBonusEarned: myBonuses.reduce((s, b) => s + (parseFloat(b.total_bonus) || 0), 0),
        totalBonusPaid:   myBonuses.filter((b) => b.settled).reduce((s, b) => s + (parseFloat(b.total_bonus) || 0), 0),
        totalBonusOwed:   myBonuses.filter((b) => !b.settled).reduce((s, b) => s + (parseFloat(b.total_bonus) || 0), 0),
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
