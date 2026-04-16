import { NextResponse } from 'next/server';
import { getInvoices, voidInvoice } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const { token } = auth;

  try {
    if (['admin', 'manager'].includes(token.role)) {
      const rows = await getInvoices();
      return NextResponse.json(rows);
    }
    // BUG 4A — drivers can see invoices for deliveries they personally completed
    if (token.role === 'driver') {
      const rows = await getInvoices(token.username, 'driver');
      return NextResponse.json(rows);
    }
    if (token.role === 'seller') {
      const rows = await getInvoices(token.username);
      return NextResponse.json(rows);
    }
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  } catch (err) {
    return apiError(err, 'خطأ في جلب البيانات', 500, 'invoices GET');
  }
}

export async function PUT(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const data = await request.json();
    if (data.void) {
      const { token } = auth;
      await voidInvoice(data.id, { cancelledBy: token.username });
      return NextResponse.json({ success: true, message: 'تم إلغاء الفاتورة' });
    }
    return NextResponse.json({ error: 'عملية غير معروفة' }, { status: 400 });
  } catch (error) {
    return apiError(error, 'خطأ في تنفيذ العملية', 400, 'invoices PUT');
  }
}
