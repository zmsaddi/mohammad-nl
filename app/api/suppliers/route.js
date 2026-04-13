import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getSuppliers, addSupplier, deleteSupplier } from '@/lib/db';
import { invalidateCache } from '@/lib/entity-resolver';

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin','manager'].includes(token.role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const rows = await getSuppliers();
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[suppliers] GET:', err);
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  // Sellers may upsert a supplier shell so the voice flow works
  if (!['admin','manager','seller'].includes(token.role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const data = await request.json();
    const result = await addSupplier(data);
    invalidateCache(); // supplier list changed — rebuild entity-resolver index
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[suppliers] POST:', err);
    return NextResponse.json({ error: 'خطأ في إضافة البيانات' }, { status: 500 });
  }
}

export async function DELETE(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (token.role !== 'admin') return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    await deleteSupplier(searchParams.get('id'));
    invalidateCache();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[suppliers] DELETE:', err);
    return NextResponse.json({ error: 'خطأ في حذف البيانات' }, { status: 500 });
  }
}
