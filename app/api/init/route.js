import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { initDatabase, resetDatabase } from '@/lib/db';
import { sql } from '@vercel/postgres';

export async function GET(request) {
  return handleInit(request);
}

export async function POST(request) {
  return handleInit(request);
}

async function handleInit(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token || token.role !== 'admin') {
    return NextResponse.json({ error: 'غير مصرح - سجل دخول كمدير أولاً' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get('reset') === 'true') {
      await resetDatabase();
      return NextResponse.json({ success: true, message: 'تم إعادة تهيئة قاعدة البيانات بالكامل' });
    }
    if (searchParams.get('clean') === 'true') {
      const keepLearning = searchParams.get('keepLearning') === 'true';
      const report = {};
      const tables = ['purchases','sales','expenses','deliveries','payments','products','suppliers','clients','bonuses','settlements','invoices','price_history','voice_logs'];
      if (!keepLearning) tables.push('ai_corrections','ai_patterns','entity_aliases');
      for (const t of tables) {
        try {
          const before = await sql.query(`SELECT COUNT(*)::int AS c FROM ${t}`);
          const del = await sql.query(`DELETE FROM ${t}`);
          const after = await sql.query(`SELECT COUNT(*)::int AS c FROM ${t}`);
          report[t] = { before: before.rows[0].c, deleted: del.rowCount, after: after.rows[0].c };
        } catch (e) {
          report[t] = { error: e.message };
        }
      }
      return NextResponse.json({ success: true, keepLearning, report });
    }
    await initDatabase();
    return NextResponse.json({ success: true, message: 'تم تهيئة قاعدة البيانات بنجاح' });
  } catch (error) {
    return NextResponse.json({ error: 'خطأ: ' + error.message }, { status: 500 });
  }
}
