import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import Groq from 'groq-sdk';
import { getProducts, getClients, getSuppliers } from '@/lib/db';
import { sql } from '@vercel/postgres';
import { fuzzyMatchName } from '@/lib/voice-normalizer';
import { EXPENSE_CATEGORIES } from '@/lib/utils';

const CATEGORY_MAP = {
  'rent': 'إيجار', 'salaries': 'رواتب', 'transport': 'نقل وشحن',
  'maintenance': 'صيانة وإصلاح', 'marketing': 'تسويق وإعلان',
  'utilities': 'كهرباء وماء', 'insurance': 'تأمين', 'tools': 'أدوات ومعدات',
  'other': 'أخرى', 'إيجار': 'إيجار', 'رواتب': 'رواتب',
};

const PAYMENT_MAP = {
  'cash': 'كاش', 'bank': 'بنك', 'credit': 'آجل',
  'كاش': 'كاش', 'بنك': 'بنك', 'آجل': 'آجل',
};

export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (!['admin', 'manager', 'seller'].includes(token.role)) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }

  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: 'GROQ_API_KEY غير مُعدّ' }, { status: 500 });
  }

  try {
    const { text } = await request.json();
    if (!text) return NextResponse.json({ error: 'لم يتم إرسال نص' }, { status: 400 });

    const [products, clients, suppliers] = await Promise.all([
      getProducts(), getClients(), getSuppliers(),
    ]);

    const productList = products.map((p) => p.name).join(', ');
    const clientList = clients.map((c) => c.name).join(', ');
    const supplierList = suppliers.map((s) => s.name).join(', ');

    const systemPrompt = `You extract business data from Arabic speech for an e-bike store. The user speaks Arabic (Levantine/Gulf dialects). You MUST understand dialect variations.

RULES:
- Detect action from Arabic keywords: بعت/بايع/selling = sale. اشتريت/شريت/جبت/buying = purchase. مصروف/صرفت/دفعت/expense = expense.
- ALWAYS respond with valid JSON only. No text, no markdown.
- Write ALL Arabic text exactly as spoken (names, descriptions).
- payment_type: use "cash" or "bank" or "credit"
- category (expenses): "rent","salaries","transport","maintenance","marketing","utilities","insurance","tools","other"
- If you can extract SOME data but not all, still return what you have with action type. Set missing fields to null.
- NEVER refuse. Always return JSON with your best understanding.
- Match product/client/supplier names loosely - "دراجة" could mean any bike product, "أحمد" matches "Ahmad" etc.

Available Products: ${productList || 'none yet - user may add new ones'}
Known Clients: ${clientList || 'none yet - user may add new ones'}
Known Suppliers: ${supplierList || 'none yet - user may add new ones'}

JSON format for sale:
{"action":"sale","client_name":"...","item":"...","quantity":N,"unit_price":N,"payment_type":"cash|bank|credit"}

JSON format for purchase:
{"action":"purchase","supplier":"...","item":"...","quantity":N,"unit_price":N,"payment_type":"cash|bank"}

JSON format for expense:
{"action":"expense","category":"rent|salaries|...","description":"...","amount":N,"payment_type":"cash|bank"}

JSON format when info is missing:
{"action":"clarification","question":"your question in Arabic","missing_fields":["field1"]}

EXAMPLES:
Input: "اشتريت من المصنع عشر بطاريات بمية وخمسين كاش"
Output: {"action":"purchase","supplier":"المصنع","item":"بطاريات","quantity":10,"unit_price":150,"payment_type":"cash"}

Input: "مصروف إيجار المحل ألفين كاش"
Output: {"action":"expense","category":"rent","description":"إيجار المحل","amount":2000,"payment_type":"cash"}

Input: "بعت لأحمد دراجة بسبعمية كاش"
Output: {"action":"sale","client_name":"أحمد","item":"دراجة","quantity":1,"unit_price":700,"payment_type":"cash"}

Input: "بعت دراجة"
Output: {"action":"clarification","question":"لمن بعت؟ وكم السعر؟ كاش أو بنك أو آجل؟","missing_fields":["client_name","unit_price","payment_type"]}`;

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });

    const rawResponse = completion.choices[0]?.message?.content || '{}';
    let parsed;
    try {
      parsed = JSON.parse(rawResponse);
    } catch {
      return NextResponse.json({ action: 'clarification', question: 'لم أفهم - حاول مرة أخرى', missing_fields: [] });
    }

    // Map English values to Arabic
    if (parsed.payment_type) parsed.payment_type = PAYMENT_MAP[parsed.payment_type] || parsed.payment_type;
    if (parsed.category) parsed.category = CATEGORY_MAP[parsed.category] || parsed.category;

    // Map action names - if clarification, try to guess from partial data
    const ACTION_MAP = { sale: 'register_sale', purchase: 'register_purchase', expense: 'register_expense' };
    let action;
    if (parsed.action === 'clarification') {
      // Guess action from partial data
      if (parsed.partial_data?.client_name || parsed.partial_data?.item) action = 'register_sale';
      else if (parsed.partial_data?.supplier) action = 'register_purchase';
      else if (parsed.partial_data?.category || parsed.partial_data?.description) action = 'register_expense';
      else {
        // Try to guess from the original text
        const t = text.toLowerCase();
        if (t.includes('بعت') || t.includes('بيع')) action = 'register_sale';
        else if (t.includes('اشتريت') || t.includes('شراء') || t.includes('شريت')) action = 'register_purchase';
        else action = 'register_expense';
      }
      // Merge partial data
      parsed = { ...parsed.partial_data, ...parsed, action };
      delete parsed.partial_data;
    } else {
      action = ACTION_MAP[parsed.action] || parsed.action;
    }
    const warnings = [];

    // Validate sale - fuzzy match but allow new clients
    if (action === 'register_sale') {
      const clientMatch = fuzzyMatchName(parsed.client_name, clients.map((c) => c.name));
      if (clientMatch) {
        parsed.client_name = clientMatch.name;
        if (clientMatch.confidence !== 'high') warnings.push(`العميل تم مطابقته مع "${clientMatch.name}" - تأكد`);
      } else {
        parsed.isNewClient = true;
        warnings.push(`العميل "${parsed.client_name}" جديد - سيتم إنشاؤه. عدّل البيانات إذا لزم.`);
      }

      const productMatch = fuzzyMatchName(parsed.item, products.map((p) => p.name));
      if (productMatch) { parsed.item = productMatch.name; }
      else {
        warnings.push(`المنتج "${parsed.item}" غير موجود بالمخزون. تأكد من الاسم.`);
      }
    }

    // Validate purchase - allow new suppliers
    if (action === 'register_purchase') {
      const supplierMatch = fuzzyMatchName(parsed.supplier, suppliers.map((s) => s.name));
      if (supplierMatch) { parsed.supplier = supplierMatch.name; }
      else {
        parsed.isNewSupplier = true;
        warnings.push(`المورد "${parsed.supplier}" جديد - سيتم إنشاؤه. عدّل البيانات إذا لزم.`);
      }
    }

    // Validate expense category
    if (action === 'register_expense' && parsed.category && !EXPENSE_CATEGORIES.includes(parsed.category)) {
      parsed.category = 'أخرى';
    }

    // Log
    const today = new Date().toISOString().split('T')[0];
    await sql`INSERT INTO voice_logs (date, username, transcript, normalized_text, action_type, status) VALUES (${today}, ${token.username}, ${text}, ${text}, ${action}, 'extracted')`.catch(() => {});

    return NextResponse.json({ action, data: parsed, warnings, transcript: text });
  } catch (error) {
    console.error('Voice extract error:', error);
    return NextResponse.json({ error: 'خطأ: ' + (error?.message || '') }, { status: 500 });
  }
}
