import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
// DONE: Step 3A — Gemini import + client removed; Groq is the only LLM provider now
import Groq from 'groq-sdk';
import { sql } from '@vercel/postgres';
import { getProducts, getClients, getSuppliers, getAIPatterns, getRecentCorrections } from '@/lib/db';
import { normalizeArabicText } from '@/lib/voice-normalizer';
import { resolveEntity } from '@/lib/entity-resolver';
import { EXPENSE_CATEGORIES, PAYMENT_MAP, CATEGORY_MAP } from '@/lib/utils';
// DONE: Step 3B — single source of truth for the voice extraction prompt
import { buildVoiceSystemPrompt } from '@/lib/voice-prompt-builder';

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

// FIXED: 4 — CATEGORY_MAP / PAYMENT_MAP moved to lib/utils.js (now imported above)

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

    // DONE: Step 3C — system prompt built from the shared lib/voice-prompt-builder.js
    const systemPrompt = buildVoiceSystemPrompt({
      products, clients, suppliers, patterns, corrections, recentSales, topClients,
    });

    // DONE: Step 2 — Gemini fully removed; Groq Llama is the only extraction model
    let parsed;
    let usedModel = 'groq-llama';
    try {
      if (!groqClient) throw new Error('GROQ_API_KEY missing');
      const completion = await groqClient.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: normalized },
        ],
        temperature: 0.1,
        max_tokens: 400,
        response_format: { type: 'json_object' },
      });
      parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
    } catch (e) {
      console.error('Groq LLM error:', e.message);
      return NextResponse.json({
        error: 'فشل الاتصال بالذكاء الاصطناعي',
        transcript: raw,
      }, { status: 500 });
    }

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

    // DONE: Step 3E — geminiError removed; Groq is the only model so no fallback warning
    const warnings = [];

    // === ENTITY RESOLUTION (uses pre-fetched context) ===
    const entityContext = { recentClients: recentClientNames, recentSuppliers: recentSupplierNames };

    // DONE: Step 5 — defensive guard for clientCandidates from a previous round
    // (e.g. user re-submitting an already-disambiguated voice intent without picking yet).
    if (parsed.clientCandidates && !parsed.client_name) {
      warnings.push('يجب اختيار العميل الصحيح من القائمة');
    }

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
        if (parsed.item !== match.entity.name) warnings.push(`المنتج: "${parsed.item}" → "${match.entity.name}"`);
        parsed.item = match.entity.name;
      } else if (match.isNewProduct) {
        // FIXED: 2 — flag new product so we surface a "do you want to add it?" prompt
        parsed.isNewProduct = true;
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

    // FIXED: 2 — surface "add new product?" suggestion to the UI
    const responseBody = { action, data: parsed, warnings, transcript: raw, normalized, missing_fields };
    if (parsed.isNewProduct === true) {
      warnings.push('المنتج غير موجود في القاعدة — هل تريد إضافته؟');
      responseBody.suggestAddProduct = true;
      responseBody.suggestedProductName = parsed.item;
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error('Voice process error:', error);
    return NextResponse.json({ error: 'خطأ في معالجة الصوت' }, { status: 500 });
  }
}
