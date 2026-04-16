import { NextResponse } from 'next/server';
import { initDatabase, resetDatabase } from '@/lib/db';
import { sql } from '@vercel/postgres';
import { requireAuth } from '@/lib/api-auth';

// GET → idempotent init only (safe). POST → mutating operations (clean / reset).
export async function GET(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    await initDatabase();
    return NextResponse.json({ success: true, message: 'تم تهيئة قاعدة البيانات بنجاح' });
  } catch (error) {
    console.error('[init] GET:', error);
    return NextResponse.json({ error: 'خطأ في التهيئة' }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;

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
      // SP-009: wrap in a single TRUNCATE for atomicity (all or nothing)
      const tables = [
        'profit_distribution_groups', 'profit_distributions', 'cancellations',
        'supplier_payments', 'bonuses', 'settlements', 'payments',
        'invoices', 'deliveries', 'sales', 'purchases', 'expenses',
        'price_history', 'voice_logs', 'clients', 'products', 'suppliers',
      ];
      if (!keepLearning) {
        tables.push('ai_corrections', 'ai_patterns', 'entity_aliases');
      }
      const list = tables.map(t => `"${t}"`).join(', ');
      await sql.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
      // Also clear invoice sequence
      await sql`DELETE FROM invoice_sequence`.catch(() => {});
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
