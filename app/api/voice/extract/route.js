import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
// DONE: Step 4A — callGemini and callGroqFallback removed; Groq is imported directly
import Groq from 'groq-sdk';
import { getProducts, getClients, getSuppliers, getAIPatterns, getRecentCorrections } from '@/lib/db';
import { sql } from '@vercel/postgres';
import { EXPENSE_CATEGORIES, PAYMENT_MAP, CATEGORY_MAP } from '@/lib/utils';
import { resolveEntity } from '@/lib/entity-resolver';
// DONE: Step 4B — single source of truth for the voice extraction prompt
import { buildVoiceSystemPrompt } from '@/lib/voice-prompt-builder';

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

    // Pre-fetch context arrays the prompt builder needs (recent sales + top clients).
    let recentSales = [], topClients = [];
    try {
      const rs = await sql`SELECT client_name, item, unit_price, payment_type, date FROM sales ORDER BY id DESC LIMIT 5`;
      const tc = await sql`SELECT client_name, COUNT(*) as cnt FROM sales GROUP BY client_name ORDER BY cnt DESC LIMIT 5`;
      recentSales = rs.rows;
      topClients = tc.rows;
    } catch {}

    // DONE: Step 4C — system prompt now built from the shared lib/voice-prompt-builder.js
    const systemPrompt = buildVoiceSystemPrompt({
      products,
      clients,
      suppliers,
      patterns,
      corrections: recentCorrections,
      recentSales,
      topClients,
    });

    // DONE: Step 3 — Groq Llama is the only extraction model (no Gemini fallback)
    let parsed;
    let usedModel = 'groq-llama';
    try {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: text },
        ],
        temperature: 0.1,
        max_tokens: 400,
        response_format: { type: 'json_object' },
      });
      parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
    } catch (e) {
      console.error('Groq extract error:', e.message);
      return NextResponse.json({
        action: 'register_expense',
        data: {},
        warnings: ['فشل الاتصال بالذكاء الاصطناعي'],
        transcript: text,
      });
    }

    // Map values
    if (parsed.payment_type) parsed.payment_type = PAYMENT_MAP[parsed.payment_type] || parsed.payment_type;
    if (parsed.category) parsed.category = CATEGORY_MAP[parsed.category] || parsed.category;

    // DONE: Fix 3 — coerce all numeric fields to Number (or null) — see process/route.js for why
    if (parsed.sell_price !== undefined) {
      parsed.sell_price = parsed.sell_price ? parseFloat(parsed.sell_price) || null : null;
    }
    if (parsed.unit_price !== undefined) {
      parsed.unit_price = parsed.unit_price ? parseFloat(parsed.unit_price) || null : null;
    }
    if (parsed.quantity !== undefined) {
      parsed.quantity = parsed.quantity ? parseFloat(parsed.quantity) || null : null;
    }
    if (parsed.amount !== undefined) {
      parsed.amount = parsed.amount ? parseFloat(parsed.amount) || null : null;
    }

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

    // Build context for entity resolution (recent names for disambiguation)
    const entityContext = { recentClients: [], recentSuppliers: [] };
    try {
      const rc = await sql`SELECT DISTINCT client_name FROM sales ORDER BY id DESC LIMIT 10`;
      entityContext.recentClients = rc.rows.map((r) => r.client_name);
      const rs = await sql`SELECT DISTINCT supplier FROM purchases ORDER BY id DESC LIMIT 5`;
      entityContext.recentSuppliers = rs.rows.map((r) => r.supplier);
    } catch {}

    // === ENTITY RESOLUTION ===
    if (action === 'register_sale' && parsed.client_name) {
      const match = await resolveEntity(parsed.client_name, 'client', clients, entityContext);
      if (match.status === 'matched') {
        if (parsed.client_name !== match.entity.name) warnings.push(`العميل: "${parsed.client_name}" → "${match.entity.name}" (${match.method})`);
        parsed.client_name = match.entity.name;
      } else if (match.status === 'ambiguous') {
        // DONE: Step 4 — never auto-pick on ambiguous matches; surface top 3 candidates with count
        parsed.client_name = null;
        parsed.clientCandidates = match.candidates.slice(0, 3).map((c) => c.entity.name);
        warnings.push(`يوجد ${match.candidates.length} عملاء بهذا الاسم — يجب اختيار العميل الصحيح`);
      } else {
        parsed.isNewClient = true;
        warnings.push(`العميل "${parsed.client_name}" جديد`);
      }
    }

    if ((action === 'register_sale' || action === 'register_purchase') && parsed.item) {
      const match = await resolveEntity(parsed.item, 'product', products, entityContext);
      if (match.status === 'matched') {
        if (parsed.item !== match.entity.name) warnings.push(`المنتج: "${parsed.item}" → "${match.entity.name}" (${match.method})`);
        parsed.item = match.entity.name;
      } else if (match.isNewProduct) {
        // FIXED: 2 — flag new product so we surface a "do you want to add it?" prompt
        parsed.isNewProduct = true;
      }
    }

    if (action === 'register_purchase' && parsed.supplier) {
      const match = await resolveEntity(parsed.supplier, 'supplier', suppliers, entityContext);
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

    // DONE: Step 4 — geminiError removed; Groq is the only model

    // DONE: Fix 2 — REQUIRED-FIELDS list per action type (parity with /api/voice/process)
    const REQUIRED_FIELDS = {
      register_purchase: ['supplier', 'item', 'quantity', 'unit_price', 'sell_price', 'payment_type'],
      register_sale:     ['client_name', 'item', 'quantity', 'unit_price', 'payment_type'],
      register_expense:  ['category', 'description', 'amount', 'payment_type'],
    };
    const requiredForAction = REQUIRED_FIELDS[action] || [];
    const missing_fields = requiredForAction.filter(
      (k) => parsed[k] === null || parsed[k] === undefined || parsed[k] === ''
    );

    // DONE: Fix 5 — product names must be English. If the AI returned Arabic,
    // run it through the transliterator and flag as missing if still Arabic.
    if (parsed.item && /[\u0600-\u06FF]/.test(parsed.item)) {
      const { normalizeArabicText } = await import('@/lib/voice-normalizer');
      const transliterated = normalizeArabicText(parsed.item);
      if (transliterated !== parsed.item) {
        warnings.push(`تم تحويل اسم المنتج: "${parsed.item}" → "${transliterated}"`);
        parsed.item = transliterated;
      }
      if (/[\u0600-\u06FF]/.test(parsed.item)) {
        warnings.push(`⚠ اسم المنتج "${parsed.item}" يجب أن يكون بالإنجليزي — يرجى التصحيح`);
        if (!missing_fields.includes('item')) missing_fields.push('item');
      }
    }

    // FIXED: 2 — surface "add new product?" suggestion to the UI
    const responseBody = { action, data: parsed, warnings, transcript: text, missing_fields };
    if (parsed.isNewProduct === true) {
      warnings.push('المنتج غير موجود في القاعدة — هل تريد إضافته؟');
      responseBody.suggestAddProduct = true;
      responseBody.suggestedProductName = parsed.item;
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error('Voice extract error:', error);
    return NextResponse.json({ error: 'خطأ في استخراج البيانات' }, { status: 500 });
  }
}
