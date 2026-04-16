import { NextResponse } from 'next/server';
import { getExpenses, addExpense, deleteExpense, updateExpense } from '@/lib/db';
import { ExpenseSchema, ExpenseUpdateSchema, zodArabicError } from '@/lib/schemas';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

export async function GET(request) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;
  try {
    const rows = await getExpenses();
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err, 'خطأ في جلب البيانات', 500, 'expenses GET');
  }
}

export async function POST(request) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;
  const { token } = auth;
  try {
    const body = await request.json();
    const parsed = ExpenseSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });

    const id = await addExpense({ ...parsed.data, createdBy: token.username });
    return NextResponse.json({ success: true, id });
  } catch (err) {
    return apiError(err, 'خطأ في إضافة البيانات', 500, 'expenses POST');
  }
}

export async function PUT(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const body = await request.json();
    const parsed = ExpenseUpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });
    const { token } = auth;
    await updateExpense({ ...parsed.data, updatedBy: token.username });
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في تحديث البيانات', 500, 'expenses PUT');
  }
}

export async function DELETE(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    await deleteExpense(searchParams.get('id'));
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في حذف البيانات', 500, 'expenses DELETE');
  }
}
