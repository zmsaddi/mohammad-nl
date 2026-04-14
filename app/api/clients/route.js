import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getClients, addClient, updateClient, deleteClient } from '@/lib/db';
import { ClientSchema, ClientUpdateSchema, zodArabicError } from '@/lib/schemas';
import { invalidateCache } from '@/lib/entity-resolver';

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
    const { searchParams } = new URL(request.url);
    const withDebt = searchParams.get('withDebt') === 'true';
    const rows = await getClients(withDebt);
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[clients] GET:', err);
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin','manager','seller'].includes(token.role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
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
    console.error('[clients] POST:', err);
    return NextResponse.json({ error: 'خطأ في إضافة البيانات' }, { status: 500 });
  }
}

export async function PUT(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (token.role !== 'admin') return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const body = await request.json();
    const parsed = ClientUpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });
    await updateClient(parsed.data);
    invalidateCache();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[clients] PUT:', err);
    return NextResponse.json({ error: 'خطأ في تحديث البيانات' }, { status: 500 });
  }
}

export async function DELETE(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (token.role !== 'admin') return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    await deleteClient(searchParams.get('id'));
    invalidateCache();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[clients] DELETE:', err);
    return NextResponse.json({ error: 'خطأ في حذف البيانات' }, { status: 500 });
  }
}
