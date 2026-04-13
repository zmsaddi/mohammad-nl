import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getDeliveries, addDelivery, updateDelivery, deleteDelivery } from '@/lib/db';
import { DeliveryUpdateSchema, zodArabicError } from '@/lib/schemas';
import { sql } from '@vercel/postgres';

async function checkAuth(request) {
  return await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
}

// BUG-04: coerce a DB `date` column (Date | string) to the YYYY-MM-DD shape
// that DeliveryUpdateSchema expects. The DB driver may hand back either a
// JS Date object, a full ISO string, or an already-trimmed YYYY-MM-DD —
// accept all three.
function dbDateToISO(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
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
  } catch (err) {
    console.error('[deliveries] GET:', err);
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
  } catch (err) {
    console.error('[deliveries] POST:', err);
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
      // BUG-04: build the update body explicitly in camelCase. Never spread
      // `existing` — it is a raw DB row with snake_case keys that Zod would
      // silently strip, dropping fields like total_amount → defaulting to 0.
      // The driver is only permitted to change `status` and `vin`; every
      // other field must be carried forward unchanged from the existing row.
      body = {
        id: body.id,
        date: dbDateToISO(existing.date),
        clientName: existing.client_name || '',
        clientPhone: existing.client_phone || '',
        address: existing.address || '',
        items: existing.items || '',
        totalAmount: Number(existing.total_amount) || 0,
        status: 'تم التوصيل',
        driverName: existing.driver_name || '',
        assignedDriver: existing.assigned_driver || '',
        notes: existing.notes || '',
        vin: body.vin || '',
      };
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
    console.error('[deliveries] PUT:', error);
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
  } catch (err) {
    console.error('[deliveries] DELETE:', err);
    return NextResponse.json({ error: 'خطأ في حذف البيانات' }, { status: 500 });
  }
}
