import { NextResponse } from 'next/server';
import { getClients, addClient, updateClient, deleteClient } from '@/lib/db';
import { ClientSchema, ClientUpdateSchema, zodArabicError } from '@/lib/schemas';
import { invalidateCache } from '@/lib/entity-resolver';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

export async function GET(request) {
  // v1.2 fix — any authenticated user can read clients. Sellers need
  // client names for the sales form, drivers see them on deliveries.
  // Pre-S4.7 this was open to all auth; the migration over-restricted it.
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const { searchParams } = new URL(request.url);
    const withDebt = searchParams.get('withDebt') === 'true';
    const rows = await getClients(withDebt);
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err, 'خطأ في جلب البيانات', 500, 'clients GET');
  }
}

export async function POST(request) {
  const auth = await requireAuth(request, ['admin', 'manager', 'seller']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const body = await request.json();
    const parsed = ClientSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });

    const data = { ...parsed.data, createdBy: token.username };
    const result = await addClient(data);
    invalidateCache(); // client list changed — rebuild entity-resolver index
    // addClient() may return { ambiguous, candidates, message } — passed through
    // untouched so clients/page.js can show its disambiguation dialog.
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return apiError(err, 'خطأ في إضافة البيانات', 500, 'clients POST');
  }
}

export async function PUT(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const body = await request.json();
    const parsed = ClientUpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });
    const { token } = auth;
    await updateClient({ ...parsed.data, updatedBy: token.username });
    invalidateCache();
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في تحديث البيانات', 500, 'clients PUT');
  }
}

export async function DELETE(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    await deleteClient(searchParams.get('id'));
    invalidateCache();
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في حذف البيانات', 500, 'clients DELETE');
  }
}
