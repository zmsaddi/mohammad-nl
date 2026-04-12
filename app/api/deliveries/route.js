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

    // BUG 3A — push every role filter down to SQL. No JS-side filtering.
    if (token.role === 'driver') {
      const rows = await getDeliveries(statusFilter, token.username);
      return NextResponse.json(rows);
    }
    if (token.role === 'seller') {
      const rows = await getDeliveries(statusFilter, null, token.username);
      return NextResponse.json(rows);
    }
    const rows = await getDeliveries(statusFilter);
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

    // BUG 3B — pre-check terminal status at the route layer (defense in depth).
    // updateDelivery() also blocks this, but a 404/403 here gives a cleaner UX
    // and avoids opening a transaction for a request that can't succeed.
    if (token.role !== 'driver') {
      const { rows: cur } = await sql`SELECT status FROM deliveries WHERE id = ${parsed.data.id}`;
      if (!cur.length) {
        return NextResponse.json({ error: 'التوصيل غير موجود' }, { status: 404 });
      }
      if (['تم التوصيل', 'ملغي'].includes(cur[0].status) && cur[0].status !== parsed.data.status) {
        return NextResponse.json({ error: 'لا يمكن تغيير حالة توصيل مؤكد أو ملغي' }, { status: 403 });
      }
    }

    // BUG 3C — VIN is required when confirming delivery of any e-bike / scooter.
    // Without it the invoice has no traceable serial number for warranty / theft reports.
    if (parsed.data.status === 'تم التوصيل') {
      const bikeKeywords = ['bike', 'دراجة', 'ebike', 'e-bike', 'scooter', 'sur-ron', 'aperyder'];
      const isBike = bikeKeywords.some((k) => (parsed.data.items || '').toLowerCase().includes(k));
      if (isBike && !parsed.data.vin?.trim()) {
        return NextResponse.json({ error: 'رقم VIN مطلوب لتأكيد توصيل الدراجة' }, { status: 400 });
      }
    }

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
