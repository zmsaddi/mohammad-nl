import { NextResponse } from 'next/server';
import { approveCapitalOp } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

// Approve a pending capital operation. Admin-only. Applies the money move once
// ALL active admins have approved (the function enforces this + idempotency).
export async function POST(request, { params }) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const { id } = await params;
    const res = await approveCapitalOp(parseInt(id, 10), token.username);
    return NextResponse.json({ success: true, ...res });
  } catch (err) {
    return apiError(err, 'خطأ في الموافقة', 400, 'treasury/capital approve');
  }
}
