import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getInvoices, voidInvoice } from '@/lib/db';

export async function GET(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  try {
    if (['admin', 'manager'].includes(token.role)) {
      const rows = await getInvoices();
      return NextResponse.json(rows);
    }
    if (token.role === 'seller') {
      const rows = await getInvoices(token.username);
      return NextResponse.json(rows);
    }
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function PUT(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token || token.role !== 'admin') return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const data = await request.json();
    if (data.void) {
      await voidInvoice(data.id);
      return NextResponse.json({ success: true, message: 'تم إلغاء الفاتورة' });
    }
    return NextResponse.json({ error: 'عملية غير معروفة' }, { status: 400 });
  } catch (error) {
    const safe = error?.message && /^[\u0600-\u06FF]/.test(error.message) ? error.message : 'خطأ في تنفيذ العملية';
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}
