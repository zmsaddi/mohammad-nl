import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getRows, SHEETS } from '@/lib/google-sheets';

async function checkAuth(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  return token;
}

export async function GET(request) {
  const token = await checkAuth(request);
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    let [purchases, sales, expenses, payments] = await Promise.all([
      getRows(SHEETS.PURCHASES),
      getRows(SHEETS.SALES),
      getRows(SHEETS.EXPENSES),
      getRows(SHEETS.PAYMENTS),
    ]);

    // Apply date filters
    if (from) {
      purchases = purchases.filter((r) => r['التاريخ'] >= from);
      sales = sales.filter((r) => r['التاريخ'] >= from);
      expenses = expenses.filter((r) => r['التاريخ'] >= from);
    }
    if (to) {
      purchases = purchases.filter((r) => r['التاريخ'] <= to);
      sales = sales.filter((r) => r['التاريخ'] <= to);
      expenses = expenses.filter((r) => r['التاريخ'] <= to);
    }

    const totalPurchases = purchases.reduce(
      (sum, r) => sum + (parseFloat(r['الإجمالي']) || 0), 0
    );
    const totalSales = sales.reduce(
      (sum, r) => sum + (parseFloat(r['الإجمالي']) || 0), 0
    );
    const totalExpenses = expenses.reduce(
      (sum, r) => sum + (parseFloat(r['المبلغ']) || 0), 0
    );

    const grossProfit = totalSales - totalPurchases;
    const netProfit = grossProfit - totalExpenses;

    // Calculate total outstanding debt
    const totalCreditSales = sales
      .filter((s) => s['طريقة الدفع'] === 'آجل')
      .reduce((sum, s) => sum + (parseFloat(s['الإجمالي']) || 0), 0);
    const totalPaidAtSale = sales
      .filter((s) => s['طريقة الدفع'] === 'آجل')
      .reduce((sum, s) => sum + (parseFloat(s['المبلغ المدفوع']) || 0), 0);
    const totalLaterPayments = payments.reduce(
      (sum, p) => sum + (parseFloat(p['المبلغ']) || 0), 0
    );
    const totalDebt = Math.max(0, totalCreditSales - totalPaidAtSale - totalLaterPayments);

    // Monthly data for charts (last 6 months)
    const monthlyData = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthName = d.toLocaleDateString('ar-SA', { month: 'short', year: 'numeric' });

      const monthPurchases = purchases
        .filter((r) => r['التاريخ']?.startsWith(yearMonth))
        .reduce((sum, r) => sum + (parseFloat(r['الإجمالي']) || 0), 0);
      const monthSales = sales
        .filter((r) => r['التاريخ']?.startsWith(yearMonth))
        .reduce((sum, r) => sum + (parseFloat(r['الإجمالي']) || 0), 0);
      const monthExpenses = expenses
        .filter((r) => r['التاريخ']?.startsWith(yearMonth))
        .reduce((sum, r) => sum + (parseFloat(r['المبلغ']) || 0), 0);

      monthlyData.push({
        month: monthName,
        purchases: monthPurchases,
        sales: monthSales,
        expenses: monthExpenses,
        profit: monthSales - monthPurchases - monthExpenses,
      });
    }

    // Expense breakdown by category
    const expenseByCategory = {};
    expenses.forEach((e) => {
      const cat = e['الفئة'] || 'أخرى';
      expenseByCategory[cat] = (expenseByCategory[cat] || 0) + (parseFloat(e['المبلغ']) || 0);
    });

    // Top debtors
    const clientDebts = {};
    sales.filter((s) => s['طريقة الدفع'] === 'آجل').forEach((s) => {
      const name = s['اسم العميل'];
      if (!clientDebts[name]) clientDebts[name] = { credit: 0, paidAtSale: 0, laterPaid: 0 };
      clientDebts[name].credit += parseFloat(s['الإجمالي']) || 0;
      clientDebts[name].paidAtSale += parseFloat(s['المبلغ المدفوع']) || 0;
    });
    payments.forEach((p) => {
      const name = p['اسم العميل'];
      if (!clientDebts[name]) clientDebts[name] = { credit: 0, paidAtSale: 0, laterPaid: 0 };
      clientDebts[name].laterPaid += parseFloat(p['المبلغ']) || 0;
    });

    const topDebtors = Object.entries(clientDebts)
      .map(([name, d]) => ({
        name,
        debt: Math.max(0, d.credit - d.paidAtSale - d.laterPaid),
      }))
      .filter((d) => d.debt > 0)
      .sort((a, b) => b.debt - a.debt)
      .slice(0, 10);

    return NextResponse.json({
      totalPurchases,
      totalSales,
      totalExpenses,
      grossProfit,
      netProfit,
      totalDebt,
      monthlyData,
      expenseByCategory,
      topDebtors,
    });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}
