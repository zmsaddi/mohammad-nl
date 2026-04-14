import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getUsers, addUser, updateUser, toggleUserActive, deleteUser } from '@/lib/db';
import { UserSchema, UserUpdateSchema, zodArabicError } from '@/lib/schemas';

async function checkAdmin(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token || token.role !== 'admin') return null;
  return token;
}

export async function GET(request) {
  if (!await checkAdmin(request)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const rows = await getUsers();
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[users] GET:', err);
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function POST(request) {
  if (!await checkAdmin(request)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
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
  if (!await checkAdmin(request)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
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
    console.error('[users] PUT:', err);
    return NextResponse.json({ error: 'خطأ في تحديث المستخدم' }, { status: 500 });
  }
}

export async function DELETE(request) {
  if (!await checkAdmin(request)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    await deleteUser(searchParams.get('id'));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[users] DELETE:', err);
    return NextResponse.json({ error: 'خطأ في حذف المستخدم' }, { status: 500 });
  }
}
