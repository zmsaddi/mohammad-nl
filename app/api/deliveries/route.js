import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getDeliveries, addDelivery, updateDelivery, deleteDelivery } from '@/lib/db';
import { DeliveryUpdateSchema, zodArabicError } from '@/lib/schemas';
import { sql } from '@vercel/postgres';

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status');

    // Push role filters into SQL — no full-table scan in JS
    if (token.role === 'driver') {
      const rows = await getDeliveries(statusFilter, token.username);
      return NextResponse.json(rows);
    }

    let rows = await getDeliveries(statusFilter);
    if (token.role === 'seller') rows = rows.filter(r => r.created_by === token.username);
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin','manager'].includes(token.role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const data = await request.json();
    data.createdBy = token.username; // audit trail
    const id = await addDelivery(data);
    return NextResponse.json({ success: true, id });
  } catch {
    return NextResponse.json({ error: 'خطأ في إضافة البيانات' }, { status: 500 });
  }
}

export async function PUT(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin','manager','driver'].includes(token.role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    let body = await request.json();

    if (token.role === 'driver') {
      if (body.status !== 'تم التوصيل') return NextResponse.json({ error: 'السائق يمكنه فقط تحديث الحالة إلى تم التوصيل' }, { status: 403 });
      // Single-row lookup — no full-table scan
      const { rows } = await sql`SELECT * FROM deliveries WHERE id = ${body.id}`;
      const existing = rows[0];
      if (!existing || existing.assigned_driver !== token.username) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
      if (existing.status === 'تم التوصيل' || existing.status === 'ملغي') return NextResponse.json({ error: 'لا يمكن تحديث هذا التوصيل' }, { status: 403 });
      body = { ...existing, id: body.id, status: 'تم التوصيل', vin: body.vin || '', clientName: existing.client_name, clientPhone: existing.client_phone, driverName: existing.driver_name, assignedDriver: existing.assigned_driver };
    }

    const parsed = DeliveryUpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });

    await updateDelivery(parsed.data);
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
  } catch {
    return NextResponse.json({ error: 'خطأ في حذف البيانات' }, { status: 500 });
  }
}
