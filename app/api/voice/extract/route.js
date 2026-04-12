import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getProducts, getClients, getSuppliers, getAIPatterns, getRecentCorrections } from '@/lib/db';
import { sql } from '@vercel/postgres';
import { EXPENSE_CATEGORIES } from '@/lib/utils';
import { resolveEntity } from '@/lib/entity-resolver';

const CATEGORY_MAP = {
  rent: 'إيجار', salaries: 'رواتب', transport: 'نقل وشحن',
  maintenance: 'صيانة وإصلاح', marketing: 'تسويق وإعلان',
  utilities: 'كهرباء وماء', insurance: 'تأمين', tools: 'أدوات ومعدات',
  other: 'أخرى', 'إيجار': 'إيجار', 'رواتب': 'رواتب',
};

const PAYMENT_MAP = {
  cash: 'كاش', bank: 'بنك', credit: 'آجل',
  'كاش': 'كاش', 'بنك': 'بنك', 'آجل': 'آجل',
};

async function callGemini(systemPrompt, userText) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: systemPrompt,
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  });
  const result = await model.generateContent(userText);
  return JSON.parse(result.response.text());
}

async function callGroqFallback(systemPrompt, userText) {
  const Groq = (await import('groq-sdk')).default;
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }],
    temperature: 0.1, max_tokens: 300,
    response_format: { type: 'json_object' },
  });
  return JSON.parse(completion.choices[0]?.message?.content || '{}');
}

export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin', 'manager', 'seller'].includes(token.role)) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }

  try {
    const { text } = await request.json();
    if (!text) return NextResponse.json({ error: 'لم يتم إرسال نص' }, { status: 400 });

    const [products, clients, suppliers] = await Promise.all([
      getProducts(), getClients(), getSuppliers(),
    ]);
    let patterns = [], recentCorrections = [];
    try { patterns = await getAIPatterns(15); } catch {}
    try { recentCorrections = await getRecentCorrections(5); } catch {}

    // Build learned knowledge
    let learnedRules = '';
    if (patterns.length > 0) {
      learnedRules = '\nLEARNED (apply these):\n' + patterns.map((p) =>
        `"${p.spoken_text}" for ${p.field_name} → "${p.correct_value}" (${p.frequency}x)`
      ).join('\n');
    }

    let corrections = '';
    if (recentCorrections.length > 0) {
      corrections = '\nRECENT CORRECTIONS:\n' + recentCorrections.map((c) =>
        `"${c.transcript}" → ${c.field_name}: AI said "${c.ai_output}", correct is "${c.user_correction}"`
      ).join('\n');
    }

    let recentContext = '';
    try {
      const r = await sql`SELECT client_name, item, unit_price FROM sales ORDER BY id DESC LIMIT 3`;
      if (r.rows.length) recentContext = '\nRECENT SALES:\n' + r.rows.map((s) => `"${s.item}" to "${s.client_name}" at ${s.unit_price}`).join('\n');
    } catch {}

    const productNames = products.map((p) => p.name).join('، ') || 'لا يوجد';
    const clientNames = clients.map((c) => c.name).join('، ') || 'لا يوجد';
    const supplierNames = suppliers.map((s) => s.name).join('، ') || 'لا يوجد';

    const systemPrompt = `أنت مساعد ذكي لمتجر "Vitesse Eco" للدراجات الكهربائية. تفهم اللهجات العربية (شامي، خليجي، مصري).

مهمتك: المستخدم يتكلم عن عملية تجارية. استخرج البيانات وارجعها JSON.

## كيف تحدد نوع العملية:
- إذا قال "بعت" أو "بايع" أو "بيع" → action = "sale"
- إذا قال "اشتريت" أو "شريت" أو "جبت" أو "شراء" → action = "purchase"
- إذا قال "مصروف" أو "صرفت" أو "دفعت" أو "حساب" → action = "expense"

## طريقة الدفع:
- "كاش" أو "نقدي" أو "نقد" → payment_type = "cash"
- "بنك" أو "تحويل" أو "حوالة" → payment_type = "bank"
- "آجل" أو "دين" أو "بعدين" → payment_type = "credit"

## فئات المصاريف:
إيجار=rent، رواتب=salaries، نقل/شحن=transport، صيانة=maintenance، تسويق/إعلان=marketing، كهرباء/ماء=utilities، تأمين=insurance، أدوات/معدات=tools، أخرى=other

## الأرقام بالعامي:
مية=100، ميتين=200، تلتمية=300، أربعمية=400، خمسمية=500، ستمية=600، سبعمية=700، ثمنمية=800، تسعمية=900، ألف=1000، ألفين=2000

## البيانات المتاحة:
المنتجات: ${productNames}
العملاء: ${clientNames}
الموردين: ${supplierNames}
${learnedRules}${corrections}${recentContext}

## أمثلة:

المستخدم: "اشتريت من المصنع عشر بطاريات بمية وخمسين كاش"
الجواب: {"action":"purchase","supplier":"المصنع","item":"بطاريات","quantity":10,"unit_price":150,"payment_type":"cash"}

المستخدم: "مصروف إيجار ألفين كاش"
الجواب: {"action":"expense","category":"rent","description":"إيجار","amount":2000,"payment_type":"cash"}

المستخدم: "بعت لأحمد دراجة بسبعمية كاش"
الجواب: {"action":"sale","client_name":"أحمد","item":"دراجة","quantity":1,"unit_price":700,"payment_type":"cash"}

المستخدم: "بعت دراجتين"
الجواب: {"action":"sale","item":"دراجة","quantity":2,"client_name":null,"unit_price":null,"payment_type":null}

## قواعد مهمة:
- ارجع JSON فقط بدون أي نص إضافي
- اكتب الأسماء العربية كما قالها المستخدم
- إذا ما فهمت قيمة حقل، حطه null
- لا ترفض أبداً - دائماً ارجع أفضل فهمك
- إذا المستخدم ذكر اسم قريب من اسم موجود بالقائمة، استخدم الاسم الموجود`;

    // Try Gemini first, fallback to Groq
    let parsed;
    let usedModel = 'unknown';
    let geminiError = '';
    if (process.env.GEMINI_API_KEY) {
      try {
        parsed = await callGemini(systemPrompt, text);
        usedModel = 'gemini';
      } catch (e) {
        geminiError = e.message || 'unknown error';
        console.error('Gemini failed:', geminiError);
      }
    }
    if (!parsed && process.env.GROQ_API_KEY) {
      try {
        parsed = await callGroqFallback(systemPrompt, text);
        usedModel = 'groq';
      } catch (e) {
        console.error('Groq also failed:', e.message);
      }
    }
    if (!parsed) {
      return NextResponse.json({ action: 'register_expense', data: {}, warnings: ['لم يتم الاتصال بأي نموذج AI'], transcript: text });
    }

    // Map values
    if (parsed.payment_type) parsed.payment_type = PAYMENT_MAP[parsed.payment_type] || parsed.payment_type;
    if (parsed.category) parsed.category = CATEGORY_MAP[parsed.category] || parsed.category;

    // Determine action
    const ACTION_MAP = { sale: 'register_sale', purchase: 'register_purchase', expense: 'register_expense' };
    let action;
    if (parsed.action === 'clarification') {
      const t = text.toLowerCase();
      if (t.includes('بعت') || t.includes('بيع') || t.includes('بايع')) action = 'register_sale';
      else if (t.includes('اشتريت') || t.includes('شريت') || t.includes('جبت') || t.includes('شراء')) action = 'register_purchase';
      else action = 'register_expense';
      parsed = { ...parsed.partial_data, ...parsed };
    } else {
      action = ACTION_MAP[parsed.action] || parsed.action;
    }

    const warnings = [];

    // === ENTITY RESOLUTION ===
    if (action === 'register_sale' && parsed.client_name) {
      const match = await resolveEntity(parsed.client_name, 'client', clients);
      if (match.status === 'matched') {
        if (parsed.client_name !== match.entity.name) warnings.push(`العميل: "${parsed.client_name}" → "${match.entity.name}" (${match.method})`);
        parsed.client_name = match.entity.name;
      } else if (match.status === 'ambiguous') {
        warnings.push(`العميل "${parsed.client_name}" - عدة نتائج: ${match.candidates.map((c) => c.entity.name).join('، ')}`);
        parsed.client_name = match.candidates[0].entity.name;
      } else {
        parsed.isNewClient = true;
        warnings.push(`العميل "${parsed.client_name}" جديد`);
      }
    }

    if ((action === 'register_sale' || action === 'register_purchase') && parsed.item) {
      const match = await resolveEntity(parsed.item, 'product', products);
      if (match.status === 'matched') {
        if (parsed.item !== match.entity.name) warnings.push(`المنتج: "${parsed.item}" → "${match.entity.name}" (${match.method})`);
        parsed.item = match.entity.name;
      }
    }

    if (action === 'register_purchase' && parsed.supplier) {
      const match = await resolveEntity(parsed.supplier, 'supplier', suppliers);
      if (match.status === 'matched') {
        if (parsed.supplier !== match.entity.name) warnings.push(`المورد: "${parsed.supplier}" → "${match.entity.name}" (${match.method})`);
        parsed.supplier = match.entity.name;
      } else {
        parsed.isNewSupplier = true;
        warnings.push(`المورد "${parsed.supplier}" جديد`);
      }
    }

    if (action === 'register_expense' && parsed.category && !EXPENSE_CATEGORIES.includes(parsed.category)) {
      parsed.category = 'أخرى';
    }

    // Log
    try {
      const today = new Date().toISOString().split('T')[0];
      await sql`INSERT INTO voice_logs (date, username, transcript, normalized_text, action_type, status) VALUES (${today}, ${token.username}, ${text}, ${text}, ${action}, ${usedModel})`;
    } catch {}

    if (geminiError) warnings.push(`Gemini: ${geminiError} (used ${usedModel})`);
    return NextResponse.json({ action, data: parsed, warnings, transcript: text });
  } catch (error) {
    console.error('Voice extract error:', error);
    return NextResponse.json({ error: error.message || 'خطأ' }, { status: 500 });
  }
}
