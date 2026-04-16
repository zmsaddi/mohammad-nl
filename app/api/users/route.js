import { NextResponse } from 'next/server';
import { getUsers, addUser, updateUser, toggleUserActive, deleteUser } from '@/lib/db';
import { UserSchema, UserUpdateSchema, zodArabicError } from '@/lib/schemas';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

export async function GET(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const rows = await getUsers();
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err, 'خطأ في جلب البيانات', 500, 'users GET');
  }
}

export async function POST(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const body = await request.json();
    const parsed = UserSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });

    const id = await addUser(parsed.data);
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('[users] POST:', error);
    // Kept after BUG-14: Zod validates shape (6-char password, role enum,
    // required fields) but uniqueness is enforced at the DB layer. The
    // bcryptjs hash + UNIQUE(username) catch stays in place.
    if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
      return NextResponse.json({ error: 'اسم المستخدم موجود مسبقاً' }, { status: 400 });
    }
    return NextResponse.json({ error: 'خطأ في إضافة المستخدم' }, { status: 500 });
  }
}

export async function PUT(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const body = await request.json();
    const parsed = UserUpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });
    const data = parsed.data;
    if (data.toggleActive) {
      await toggleUserActive(data.id);
    } else {
      await updateUser(data);
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في تحديث المستخدم', 500, 'users PUT');
  }
}

export async function DELETE(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    await deleteUser(searchParams.get('id'));
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في حذف المستخدم', 500, 'users DELETE');
  }
}
