import { NextResponse } from 'next/server';
import { rejectCapitalOp } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// Reject (veto) a pending capital operation. Admin-only — any admin can veto.
export async function POST(request, { params }) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const { id } = await params;
    const res = await rejectCapitalOp(parseInt(id, 10), token.username);
    return NextResponse.json({ success: true, ...res });
  } catch (err) {
    return apiError(err, 'خطأ في رفض العملية', 400, 'treasury/capital reject');
  }
}
