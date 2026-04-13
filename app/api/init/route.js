import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { initDatabase, resetDatabase } from '@/lib/db';
import { sql } from '@vercel/postgres';

// GET → idempotent init only (safe). POST → mutating operations (clean / reset).
export async function GET(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token || token.role !== 'admin') {
    return NextResponse.json({ error: 'غير مصرح - سجل دخول كمدير أولاً' }, { status: 401 });
  }
  try {
    await initDatabase();
    return NextResponse.json({ success: true, message: 'تم تهيئة قاعدة البيانات بنجاح' });
  } catch (error) {
    console.error('[init] GET:', error);
    return NextResponse.json({ error: 'خطأ في التهيئة' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token || token.role !== 'admin') {
    return NextResponse.json({ error: 'غير مصرح - سجل دخول كمدير أولاً' }, { status: 401 });
  }

  let body = {};
  try { body = await request.json(); } catch (err) { console.error('[init] POST body parse:', err); }

  // Destructive operations require an explicit confirmation phrase in the body.
  // This blocks CSRF / accidental link clicks because no GET / form submission can set it.
  const CONFIRM_PHRASE = 'احذف كل البيانات نهائيا';

  try {
    if (body.action === 'reset') {
      // BUG-03: reset is a defense-in-depth kill switch. Requires BOTH
      // a non-production runtime AND an explicit opt-in env flag. The
      // confirm phrase below still gates accidental clicks in dev.
      if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DB_RESET !== 'true') {
        console.error('[init] POST reset blocked: NODE_ENV=', process.env.NODE_ENV, 'ALLOW_DB_RESET=', process.env.ALLOW_DB_RESET);
        return NextResponse.json({ error: 'إعادة التهيئة معطلة في بيئة الإنتاج' }, { status: 403 });
      }
      if (body.confirm !== CONFIRM_PHRASE) {
        return NextResponse.json({ error: 'تأكيد مفقود - مطلوب confirm بالعبارة الصحيحة' }, { status: 400 });
      }
      await resetDatabase();
      return NextResponse.json({ success: true, message: 'تم إعادة تهيئة قاعدة البيانات بالكامل' });
    }

    if (body.action === 'clean') {
      if (body.confirm !== CONFIRM_PHRASE) {
        return NextResponse.json({ error: 'تأكيد مفقود - مطلوب confirm بالعبارة الصحيحة' }, { status: 400 });
      }
      const keepLearning = body.keepLearning === true;
      await sql`DELETE FROM purchases`;
      await sql`DELETE FROM sales`;
      await sql`DELETE FROM expenses`;
      await sql`DELETE FROM deliveries`;
      await sql`DELETE FROM payments`;
      await sql`DELETE FROM products`;
      await sql`DELETE FROM suppliers`;
      await sql`DELETE FROM clients`;
      await sql`DELETE FROM bonuses`;
      await sql`DELETE FROM settlements`;
      await sql`DELETE FROM invoices`.catch((err) => console.error('[init] clean invoices:', err));
      await sql`DELETE FROM price_history`.catch((err) => console.error('[init] clean price_history:', err));
      await sql`DELETE FROM voice_logs`.catch((err) => console.error('[init] clean voice_logs:', err));
      if (!keepLearning) {
        await sql`DELETE FROM ai_corrections`.catch((err) => console.error('[init] clean ai_corrections:', err));
        await sql`DELETE FROM ai_patterns`.catch((err) => console.error('[init] clean ai_patterns:', err));
        await sql`DELETE FROM entity_aliases`.catch((err) => console.error('[init] clean entity_aliases:', err));
      }
      return NextResponse.json({
        success: true,
        message: keepLearning
          ? 'تم مسح البيانات مع الحفاظ على المستخدمين والتعلم'
          : 'تم مسح البيانات مع الحفاظ على المستخدمين والإعدادات',
      });
    }

    // Default POST: idempotent init.
    await initDatabase();
    return NextResponse.json({ success: true, message: 'تم تهيئة قاعدة البيانات بنجاح' });
  } catch (error) {
    console.error('[init] POST:', error);
    return NextResponse.json({ error: 'خطأ في تنفيذ العملية' }, { status: 500 });
  }
}
