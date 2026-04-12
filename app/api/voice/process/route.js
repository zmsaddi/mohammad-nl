import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { sql } from '@vercel/postgres';
import { getProducts, getClients, getSuppliers, getAIPatterns, getRecentCorrections } from '@/lib/db';
import { normalizeArabicText } from '@/lib/voice-normalizer';
import { resolveEntity } from '@/lib/entity-resolver';
import { EXPENSE_CATEGORIES } from '@/lib/utils';

// Static SDK init (no dynamic import overhead)
const geminiClient = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const groqClient = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// Per-user sliding-window rate limiter (module-level — persists across warm invocations).
// For cross-instance limits in a scaled deployment, replace with @vercel/kv.
const voiceRateLimit = new Map();
const RATE_WINDOW_MS = 60_000; // 1 minute window
const RATE_MAX = 10;            // 10 voice calls per minute per user

function checkRateLimit(username) {
  const now = Date.now();
  const stamps = (voiceRateLimit.get(username) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (stamps.length >= RATE_MAX) return false;
  stamps.push(now);
  voiceRateLimit.set(username, stamps);
  return true;
}

const CATEGORY_MAP = { rent: 'إيجار', salaries: 'رواتب', transport: 'نقل وشحن', maintenance: 'صيانة وإصلاح', marketing: 'تسويق وإعلان', utilities: 'كهرباء وماء', insurance: 'تأمين', tools: 'أدوات ومعدات', other: 'أخرى', 'إيجار': 'إيجار', 'رواتب': 'رواتب' };
const PAYMENT_MAP = { cash: 'كاش', bank: 'بنك', credit: 'آجل', 'كاش': 'كاش', 'بنك': 'بنك', 'آجل': 'آجل' };

export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin', 'manager', 'seller'].includes(token.role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });

  if (!checkRateLimit(token.username)) {
    return NextResponse.json({ error: 'تجاوزت الحد المسموح (10 طلبات/دقيقة) — انتظر قليلاً ثم أعد المحاولة' }, { status: 429 });
  }

  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio');
    if (!audioFile) return NextResponse.json({ error: 'لم يتم إرسال ملف صوتي' }, { status: 400 });

    // Reject oversized uploads before reading into memory (prevents OOM / cost abuse)
    const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
    if (audioFile.size > MAX_BYTES) {
      return NextResponse.json({ error: 'حجم الملف كبير جداً (الحد الأقصى 10MB)' }, { status: 413 });
    }

    // === PARALLEL: Whisper transcription + ALL DB queries at same time ===
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const file = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });

    const [transcriptResult, dbResult] = await Promise.all([
      // 1. Whisper transcription
      (async () => {
        if (!groqClient) throw new Error('GROQ_API_KEY missing');
        const products = await getProducts();
        const clients = await getClients();
        const suppliers = await getSuppliers();
        // Smart vocabulary: frequent names first
        let topNames = [];
        try {
          const tc = await sql`SELECT client_name FROM sales GROUP BY client_name ORDER BY COUNT(*) DESC LIMIT 15`;
          const ti = await sql`SELECT item FROM sales GROUP BY item ORDER BY COUNT(*) DESC LIMIT 10`;
          topNames = [...tc.rows.map((r) => r.client_name), ...ti.rows.map((r) => r.item)];
        } catch {}
        let aliasNames = [];
        try {
          const a = await sql`SELECT alias FROM entity_aliases ORDER BY frequency DESC LIMIT 10`;
          aliasNames = a.rows.map((r) => r.alias);
        } catch {}

        const allNames = [...new Set([...topNames, ...products.map((p) => p.name), ...clients.map((c) => c.name), ...suppliers.map((s) => s.name), ...aliasNames])].filter(Boolean);
        // Mix Arabic action words + all entity names (may include English model numbers)
        const vocab = `بعت, اشتريت, مصروف, كاش, بنك, آجل, ${allNames.join(', ')}`;

        const transcription = await groqClient.audio.transcriptions.create({ file, model: 'whisper-large-v3', language: 'ar', prompt: vocab.slice(0, 1500) });
        return { raw: transcription.text || '', normalized: normalizeArabicText(transcription.text || '') };
      })(),

      // 2. All DB context (parallel with transcription)
      (async () => {
        const [products, clients, suppliers, patterns, corrections] = await Promise.all([
          getProducts(), getClients(), getSuppliers(),
          getAIPatterns(15).catch(() => []),
          getRecentCorrections(5).catch(() => []),
        ]);

        // Context queries - all parallel
        let recentSales = [], recentPurchases = [], topClients = [], recentClientNames = [], recentSupplierNames = [];
        try {
          const [rs, rp, tc, rcn, rsn] = await Promise.all([
            sql`SELECT client_name, item, unit_price, payment_type, date FROM sales ORDER BY id DESC LIMIT 5`,
            sql`SELECT supplier, item, unit_price, date FROM purchases ORDER BY id DESC LIMIT 3`,
            sql`SELECT client_name, COUNT(*) as cnt FROM sales GROUP BY client_name ORDER BY cnt DESC LIMIT 5`,
            sql`SELECT DISTINCT client_name FROM sales ORDER BY id DESC LIMIT 10`,
            sql`SELECT DISTINCT supplier FROM purchases ORDER BY id DESC LIMIT 5`,
          ]);
          recentSales = rs.rows;
          recentPurchases = rp.rows;
          topClients = tc.rows;
          recentClientNames = rcn.rows.map((r) => r.client_name);
          recentSupplierNames = rsn.rows.map((r) => r.supplier);
        } catch {}

        return { products, clients, suppliers, patterns, corrections, recentSales, recentPurchases, topClients, recentClientNames, recentSupplierNames };
      })(),
    ]);

    const { raw, normalized } = transcriptResult;
    if (!normalized || normalized.length < 3) {
      return NextResponse.json({ action: 'register_expense', data: {}, warnings: ['لم أسمع شيء واضح'], transcript: raw });
    }

    const { products, clients, suppliers, patterns, corrections, recentSales, recentPurchases, topClients, recentClientNames, recentSupplierNames } = dbResult;

    // === BUILD PROMPT (top-N entities only) ===
    const topProductNames = products.slice(0, 15).map((p) => p.name).join('، ') || 'لا يوجد';
    const topClientNames = (topClients.length ? topClients.map((c) => c.client_name) : clients.slice(0, 20).map((c) => c.name)).join('، ') || 'لا يوجد';
    const supplierNames = suppliers.slice(0, 10).map((s) => s.name).join('، ') || 'لا يوجد';

    let learnedRules = '';
    if (patterns.length) learnedRules = '\n\n## تعلمت سابقاً:\n' + patterns.map((p) => `"${p.spoken_text}" → ${p.field_name} = "${p.correct_value}" (${p.frequency}x)`).join('\n');

    let correctionExamples = '';
    if (corrections.length) correctionExamples = '\n\n## تصحيحات أخيرة:\n' + corrections.map((c) => `"${c.transcript}" → ${c.field_name}: "${c.ai_output}" صحح إلى "${c.user_correction}"`).join('\n');

    let context = '';
    if (recentSales.length) context += '\n\n## آخر المبيعات:\n' + recentSales.map((s) => `- "${s.item}" لـ "${s.client_name}" بسعر ${s.unit_price}`).join('\n');
    if (topClients.length) context += '\n\n## أكثر العملاء:\n' + topClients.map((c) => `- "${c.client_name}" (${c.cnt} عمليات)`).join('\n');

    const systemPrompt = `أنت مساعد ذكي لمتجر "Vitesse Eco" للدراجات الكهربائية. تفهم اللهجات العربية (شامي، خليجي، مصري).

مهمتك: استخرج البيانات من كلام المستخدم وارجعها JSON فقط.

## مهم جداً - أسماء المنتجات:
أسماء المنتجات بالإنجليزي (V20 Pro, S73 Mini, GT-2000, ApeRyder, Sur-Ron, etc). المستخدم يخلط عربي وإنجليزي. مثلاً: "بعت V20 Pro لأحمد" أو "اشتريت عشر GT-20". اكتب اسم المنتج بالإنجليزي كما هو.

## قاعدة حرجة - حروف الجر:
"من عند"، "من"، "عند"، "لـ"، "عند" هي حروف جر وليست جزء من الاسم!
- "اشتريت من عند المصنع" → supplier = "المصنع" (وليس "من عند المصنع")
- "اشتريت من أحمد" → supplier = "أحمد" (وليس "من أحمد")
- "بعت لمحمد" → client_name = "محمد" (وليس "لمحمد")
- "جبت من عند الشركة" → supplier = "الشركة"
لا تضف أبداً "من"/"من عند"/"عند"/"لـ" لبداية أي اسم!

## نوع العملية:
- "بعت"/"بايع"/"بيع" → action = "sale"
- "اشتريت"/"شريت"/"جبت"/"شراء" → action = "purchase"
- "مصروف"/"صرفت"/"دفعت" → action = "expense"

## الدفع (مهم جداً):
- "كاش"/"نقدي"/"نقد"/"عند التوصيل"/"عند الاستلام"/"على الدليفري"/"دفع عند التوصيل"/"COD" → payment_type = "cash" (الدفع عند التوصيل = كاش)
- "بنك"/"تحويل"/"حوالة"/"تحويل بنكي" → payment_type = "bank"
- "آجل"/"دين"/"بعدين"/"على الحساب"/"بالدين" → payment_type = "credit"
ملاحظة: "الدفع عند التوصيل" و "الدفع عند الاستلام" = cash وليس credit!

## فئات المصاريف:
إيجار=rent، رواتب=salaries، نقل=transport، صيانة=maintenance، تسويق=marketing، كهرباء=utilities، تأمين=insurance، أدوات=tools، أخرى=other

## الأرقام:
مية=100، ميتين=200، تلتمية=300، أربعمية=400، خمسمية=500، ستمية=600، سبعمية=700، ثمنمية=800، تسعمية=900، ألف=1000، ألفين=2000

## البيانات:
المنتجات: ${topProductNames}
العملاء: ${topClientNames}
الموردين: ${supplierNames}
${learnedRules}${correctionExamples}${context}

## أمثلة:
"اشتريت من المصنع عشر بطاريات بمية وخمسين كاش" → {"action":"purchase","supplier":"المصنع","item":"بطاريات","quantity":10,"unit_price":150,"payment_type":"cash"}
"مصروف إيجار ألفين كاش" → {"action":"expense","category":"rent","description":"إيجار","amount":2000,"payment_type":"cash"}
"بعت لأحمد دراجة بسبعمية كاش" → {"action":"sale","client_name":"أحمد","item":"دراجة","quantity":1,"unit_price":700,"payment_type":"cash"}
"بعت دراجتين" → {"action":"sale","item":"دراجة","quantity":2,"client_name":null,"unit_price":null,"payment_type":null}

## قواعد:
- ارجع JSON فقط
- اكتب الأسماء كما قالها المستخدم
- إذا ما فهمت حقل، حطه null
- لا ترفض أبداً`;

    // === CALL AI (Gemini primary, Groq fallback) ===
    let parsed, usedModel = 'unknown', geminiError = '';

    if (geminiClient) {
      try {
        const model = geminiClient.getGenerativeModel({ model: 'gemini-2.5-flash', systemInstruction: systemPrompt, generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } });
        const result = await model.generateContent(normalized);
        parsed = JSON.parse(result.response.text());
        usedModel = 'gemini';
      } catch (e) { geminiError = e.message; }
    }

    if (!parsed && groqClient) {
      try {
        const completion = await groqClient.chat.completions.create({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: normalized }], temperature: 0.1, max_tokens: 300, response_format: { type: 'json_object' } });
        parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
        usedModel = 'groq';
      } catch {}
    }

    if (!parsed) return NextResponse.json({ action: 'register_expense', data: {}, warnings: ['لم يتم الاتصال بأي AI'], transcript: raw });

    // === MAP VALUES ===
    if (parsed.payment_type) parsed.payment_type = PAYMENT_MAP[parsed.payment_type] || parsed.payment_type;
    if (parsed.category) parsed.category = CATEGORY_MAP[parsed.category] || parsed.category;

    // === DETERMINE ACTION ===
    const ACTION_MAP = { sale: 'register_sale', purchase: 'register_purchase', expense: 'register_expense' };
    let action;
    if (parsed.action === 'clarification') {
      const t = normalized.toLowerCase();
      action = t.includes('بعت') || t.includes('بيع') ? 'register_sale' : t.includes('اشتريت') || t.includes('شريت') || t.includes('شراء') ? 'register_purchase' : 'register_expense';
      parsed = { ...parsed.partial_data, ...parsed };
    } else {
      action = ACTION_MAP[parsed.action] || parsed.action;
    }

    const warnings = [];
    if (geminiError) warnings.push(`Gemini: ${geminiError} (used ${usedModel})`);

    // === ENTITY RESOLUTION (uses pre-fetched context) ===
    const entityContext = { recentClients: recentClientNames, recentSuppliers: recentSupplierNames };

    if (action === 'register_sale' && parsed.client_name) {
      const match = await resolveEntity(parsed.client_name, 'client', clients, entityContext);
      if (match.status === 'matched') {
        if (parsed.client_name !== match.entity.name) warnings.push(`العميل: "${parsed.client_name}" → "${match.entity.name}" (${match.method})`);
        parsed.client_name = match.entity.name;
      } else if (match.status === 'ambiguous') {
        warnings.push(`العميل "${parsed.client_name}" - عدة نتائج`);
        parsed.client_name = match.candidates[0].entity.name;
      } else {
        parsed.isNewClient = true;
        warnings.push(`العميل "${parsed.client_name}" جديد`);
      }
    }

    if ((action === 'register_sale' || action === 'register_purchase') && parsed.item) {
      const match = await resolveEntity(parsed.item, 'product', products, entityContext);
      if (match.status === 'matched') {
        if (parsed.item !== match.entity.name) warnings.push(`المنتج: "${parsed.item}" → "${match.entity.name}"`);
        parsed.item = match.entity.name;
      }
    }

    if (action === 'register_purchase' && parsed.supplier) {
      const match = await resolveEntity(parsed.supplier, 'supplier', suppliers, entityContext);
      if (match.status === 'matched') {
        if (parsed.supplier !== match.entity.name) warnings.push(`المورد: "${parsed.supplier}" → "${match.entity.name}"`);
        parsed.supplier = match.entity.name;
      } else {
        parsed.isNewSupplier = true;
        warnings.push(`المورد "${parsed.supplier}" جديد`);
      }
    }

    if (action === 'register_expense' && parsed.category && !EXPENSE_CATEGORIES.includes(parsed.category)) parsed.category = 'أخرى';

    // Log
    try { const today = new Date().toISOString().split('T')[0]; await sql`INSERT INTO voice_logs (date, username, transcript, normalized_text, action_type, status) VALUES (${today}, ${token.username}, ${raw}, ${normalized}, ${action}, ${usedModel})`; } catch {}

    // List fields the AI left as null so the UI can highlight them
    const missing_fields = Object.keys(parsed).filter((k) => parsed[k] === null || parsed[k] === undefined);

    return NextResponse.json({ action, data: parsed, warnings, transcript: raw, normalized, missing_fields });
  } catch (error) {
    console.error('Voice process error:', error);
    return NextResponse.json({ error: 'خطأ في معالجة الصوت' }, { status: 500 });
  }
}
