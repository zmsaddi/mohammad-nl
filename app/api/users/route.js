import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getUsers, addUser, updateUser, toggleUserActive, deleteUser } from '@/lib/db';

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
  } catch {
    return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 });
  }
}

export async function POST(request) {
  if (!await checkAdmin(request)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const data = await request.json();
    if (!data.username || !data.password || !data.name || !data.role) {
      return NextResponse.json({ error: 'جميع الحقول مطلوبة' }, { status: 400 });
    }
    const id = await addUser(data);
    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
      return NextResponse.json({ error: 'اسم المستخدم موجود مسبقاً' }, { status: 400 });
    }
    return NextResponse.json({ error: 'خطأ في إضافة المستخدم' }, { status: 500 });
  }
}

export async function PUT(request) {
  if (!await checkAdmin(request)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const data = await request.json();
    if (data.toggleActive) {
      await toggleUserActive(data.id);
    } else {
      await updateUser(data);
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'خطأ في تحديث المستخدم' }, { status: 500 });
  }
}

export async function DELETE(request) {
  if (!await checkAdmin(request)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    await deleteUser(searchParams.get('id'));
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'خطأ في حذف المستخدم' }, { status: 500 });
  }
}
