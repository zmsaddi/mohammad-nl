import { NextResponse } from 'next/server';
import { getBonuses } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const { token } = auth;

  try {
    // BUG 6B — managers also need full bonus visibility for payroll oversight.
    // Sellers and drivers continue to see only their own rows.
    if (['admin', 'manager'].includes(token.role)) {
      const rows = await getBonuses();
      return NextResponse.json(rows);
    }
    const rows = await getBonuses(token.username);
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err, 'خطأ في جلب البيانات', 500, 'bonuses GET');
  }
}
