import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getDeliveries, addDelivery, updateDelivery, deleteDelivery } from '@/lib/db';

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    let rows = await getDeliveries(searchParams.get('status'));
    if (token.role === 'seller') rows = rows.filter(r => r.created_by === token.username);
    if (token.role === 'driver') rows = rows.filter(r => r.assigned_driver === token.username);
    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin','manager'].includes(token.role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const data = await request.json();
    const id = await addDelivery(data);
    return NextResponse.json({ success: true, id });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في إضافة البيانات' }, { status: 500 });
  }
}

export async function PUT(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin','manager','driver'].includes(token.role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    let data = await request.json();
    if (token.role === 'driver') {
      if (data.status !== 'تم التوصيل') return NextResponse.json({ error: 'السائق يمكنه فقط تحديث الحالة إلى تم التوصيل' }, { status: 403 });
      const existing = (await getDeliveries()).find(d => d.id === data.id);
      if (!existing || existing.assigned_driver !== token.username) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
      if (existing.status === 'تم التوصيل' || existing.status === 'ملغي') return NextResponse.json({ error: 'لا يمكن تحديث هذا التوصيل' }, { status: 403 });
      data = { ...existing, id: data.id, status: 'تم التوصيل', vin: data.vin || '', clientName: existing.client_name, clientPhone: existing.client_phone, driverName: existing.driver_name, assignedDriver: existing.assigned_driver };
    }
    await updateDelivery(data);
    return NextResponse.json({ success: true });
  } catch (error) {
    const safe = error?.message && /^[\u0600-\u06FF]/.test(error.message) ? error.message : 'خطأ في تحديث البيانات';
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}

export async function DELETE(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (token.role !== 'admin') return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    await deleteDelivery(searchParams.get('id'));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في حذف البيانات' }, { status: 500 });
  }
}
