import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getRows, appendRow, getNextId, deleteRowById, updateRowById, SHEETS } from '@/lib/google-sheets';

async function checkAuth(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  return token;
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const withDebt = searchParams.get('withDebt') === 'true';

    const clients = await getRows(SHEETS.CLIENTS);

    if (withDebt) {
      const sales = await getRows(SHEETS.SALES);
      const payments = await getRows(SHEETS.PAYMENTS);

      const enriched = clients.map((client) => {
        const clientName = client['اسم العميل'];

        const clientSales = sales.filter((s) => s['اسم العميل'] === clientName);
        const clientPayments = payments.filter((p) => p['اسم العميل'] === clientName);

        const totalSales = clientSales.reduce((sum, s) => sum + (parseFloat(s['الإجمالي']) || 0), 0);

        const totalCreditSales = clientSales
          .filter((s) => s['طريقة الدفع'] === 'آجل')
          .reduce((sum, s) => sum + (parseFloat(s['الإجمالي']) || 0), 0);

        const totalPaidAtSale = clientSales
          .filter((s) => s['طريقة الدفع'] === 'آجل')
          .reduce((sum, s) => sum + (parseFloat(s['المبلغ المدفوع']) || 0), 0);

        const totalLaterPayments = clientPayments.reduce(
          (sum, p) => sum + (parseFloat(p['المبلغ']) || 0), 0
        );

        const totalPaid = clientSales
          .filter((s) => s['طريقة الدفع'] === 'نقدي')
          .reduce((sum, s) => sum + (parseFloat(s['الإجمالي']) || 0), 0)
          + totalPaidAtSale + totalLaterPayments;

        const remainingDebt = totalCreditSales - totalPaidAtSale - totalLaterPayments;

        return {
          ...client,
          totalSales,
          totalPaid,
          remainingDebt: Math.max(0, remainingDebt),
        };
      });

      return NextResponse.json(enriched);
    }

    return NextResponse.json(clients);
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  try {
    const data = await request.json();
    const id = await getNextId(SHEETS.CLIENTS);

    await appendRow(SHEETS.CLIENTS, [
      id,
      data.name,
      data.phone || '',
      data.address || '',
      data.notes || '',
    ]);

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في إضافة البيانات' }, { status: 500 });
  }
}

export async function PUT(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  try {
    const data = await request.json();
    await updateRowById(SHEETS.CLIENTS, data.id, [
      data.id,
      data.name,
      data.phone || '',
      data.address || '',
      data.notes || '',
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في تحديث البيانات' }, { status: 500 });
  }
}

export async function DELETE(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (token.role !== 'admin') return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 });

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    await deleteRowById(SHEETS.CLIENTS, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في حذف البيانات' }, { status: 500 });
  }
}
