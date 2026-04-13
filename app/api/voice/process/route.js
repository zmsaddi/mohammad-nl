import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
// DONE: Step 3A — Gemini import + client removed; Groq is the only LLM provider now
import Groq from 'groq-sdk';
import { sql } from '@vercel/postgres';
import { getProducts, getClients, getSuppliers, getAIPatterns, getRecentCorrections, getTopEntities } from '@/lib/db';
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

        // DONE: Step 3B — smart vocabulary, priority-ordered for Whisper.
        // Whisper truncates long prompts, so the order matters: action verbs and
        // payment terms first (these are critical), then variants/colors, then
        // model names, then learned aliases, then frequent entities, then full lists.
        const topEntities = await getTopEntities(token.username).catch((err) => {
          console.error('[voice/process] getTopEntities:', err);
          return { products: [], clients: [], suppliers: [], aliases: [] };
        });

        const PRIORITY_TERMS = [
          // 1. Action verbs — critical
          'بعت', 'شريت', 'اشتريت', 'جبت', 'سلّمت', 'مصروف', 'صرفت', 'دفعت',
          // 2. Payment terms
          'كاش', 'بنك', 'آجل', 'نقدي', 'تحويل', 'دين',
          // 3. Color / variant keywords
          'أسود', 'سوداء', 'رمادي', 'أبيض', 'أزرق', 'أحمر', 'أخضر',
          'دوبل باتري', 'سينجل', 'NFC', 'بلوتوث',
          // 4. Product model words
          'برو', 'ليمتد', 'كروس', 'ماكس', 'ميني', 'الفيشن', 'الليمتد', 'الكروس', 'الطوي',
        ];

        const seen = new Set();
        const terms = [];
        const addTerm = (t) => {
          if (!t || seen.has(t)) return;
          seen.add(t);
          terms.push(t);
        };

        PRIORITY_TERMS.forEach(addTerm);
        topEntities.aliases.forEach(addTerm);   // learned spoken aliases
        topEntities.products.forEach(addTerm);  // most-sold products
        topEntities.clients.forEach(addTerm);   // user's frequent clients
        topEntities.suppliers.forEach(addTerm); // frequent suppliers
        products.forEach((p) => addTerm(p.name));   // full product catalog
        clients.forEach((c) => addTerm(c.name));    // full client list
        suppliers.forEach((s) => addTerm(s.name));  // full supplier list

        // Truncate to ~1450 chars (Whisper prompt limit ≈ 224 tokens)
        let vocab = '';
        for (const term of terms) {
          const candidate = vocab ? vocab + ',' + term : term;
          if (candidate.length > 1450) break;
          vocab = candidate;
        }

        const transcription = await groqClient.audio.transcriptions.create({
          file, model: 'whisper-large-v3', language: 'ar', prompt: vocab,
        });
        return { raw: transcription.text || '', normalized: normalizeArabicText(transcription.text || '') };
      })(),

      // 2. All DB context (parallel with transcription)
      (async () => {
        const [products, clients, suppliers, patterns, corrections] = await Promise.all([
          getProducts(), getClients(), getSuppliers(),
          // DONE: Step 3 — pass username so per-user patterns are returned first
          getAIPatterns(20, token.username).catch((err) => { console.error('[voice/process] getAIPatterns:', err); return []; }),
          getRecentCorrections(5).catch((err) => { console.error('[voice/process] getRecentCorrections:', err); return []; }),
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
        } catch (err) {
          console.error('[voice/process] context lookup:', err);
        }

        return { products, clients, suppliers, patterns, corrections, recentSales, recentPurchases, topClients, recentClientNames, recentSupplierNames };
      })(),
    ]);

    const { raw, normalized } = transcriptResult;
    if (!normalized || normalized.length < 3) {
      return NextResponse.json({ action: 'register_expense', data: {}, warnings: ['لم أسمع شيء واضح'], transcript: raw });
    }

    const { products, clients, suppliers, patterns, corrections, recentSales, recentPurchases, topClients, recentClientNames, recentSupplierNames } = dbResult;

    // DONE: Step 3C — system prompt built from the shared lib/voice-prompt-builder.js
    // username is passed so the prompt builder can split user-specific vs global patterns
    const systemPrompt = buildVoiceSystemPrompt({
      products, clients, suppliers, patterns, corrections, recentSales, topClients,
      username: token.username,
    });

    // DONE: Step 2 — Gemini fully removed; Groq Llama is the only extraction model
    // PERF-03: switched production route to llama-3.1-8b-instant.
    // The 8b model is ~5x faster than 70b on extraction tasks and runs
    // on a 5x larger daily quota (500K tokens/day vs 100K). The extract
    // task here is structured JSON output from a compressed prompt — well
    // within 8b capability. PERF-02 made this same change to /api/voice/extract
    // before realizing extract was dead code; this commit applies it to
    // the actually-used route AND deletes the dead routes.
    let parsed;
    let usedModel = 'groq-llama-8b-instant';
    try {
      if (!groqClient) throw new Error('GROQ_API_KEY missing');
      const completion = await groqClient.chat.completions.create({
        model: 'llama-3.1-8b-instant',
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

    // DONE: Fix 3 — coerce all numeric fields to Number (or null) so the form
    // always receives the right types regardless of what the LLM emitted (string,
    // number, or "0" which we want to treat as missing).
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

    // DONE: Step 3D — background reinforcement learning from successfully resolved entities.
    // Runs as a fire-and-forget IIFE so it never blocks the response. The aliases
    // created here strengthen the matches the resolver just made; if the user later
    // corrects them in VoiceConfirm, saveAICorrection will overwrite with the right
    // values and the wrong ones will rank lower over time.
    (async () => {
      try {
        if (action === 'register_sale' && parsed.client_name && !parsed.isNewClient) {
          const { rows: cl } = await sql`SELECT id FROM clients WHERE name = ${parsed.client_name} LIMIT 1`;
          if (cl.length) {
            const { addAlias } = await import('@/lib/db');
            const { normalizeForMatching } = await import('@/lib/voice-normalizer');
            await addAlias('client', cl[0].id, parsed.client_name, normalizeForMatching(parsed.client_name), 'confirmed_action');
          }
        }
        if ((action === 'register_sale' || action === 'register_purchase') && parsed.item && !parsed.isNewProduct) {
          const baseName = parsed.item.split(' - ')[0];
          const { rows: prod } = await sql`
            SELECT id FROM products
            WHERE name = ${parsed.item} OR name LIKE ${baseName + '%'}
            LIMIT 1
          `;
          if (prod.length) {
            const { addAlias } = await import('@/lib/db');
            const { normalizeForMatching } = await import('@/lib/voice-normalizer');
            await addAlias('product', prod[0].id, parsed.item, normalizeForMatching(parsed.item), 'confirmed_action');
          }
        }
        if (action === 'register_purchase' && parsed.supplier && !parsed.isNewSupplier) {
          const { rows: sup } = await sql`SELECT id FROM suppliers WHERE name = ${parsed.supplier} LIMIT 1`;
          if (sup.length) {
            const { addAlias } = await import('@/lib/db');
            const { normalizeForMatching } = await import('@/lib/voice-normalizer');
            await addAlias('supplier', sup[0].id, parsed.supplier, normalizeForMatching(parsed.supplier), 'confirmed_action');
          }
        }
      } catch (err) {
        console.error('[voice/process] alias learning:', err);
      }
    })();

    // Log
    try {
      const today = new Date().toISOString().split('T')[0];
      await sql`INSERT INTO voice_logs (date, username, transcript, normalized_text, action_type, status) VALUES (${today}, ${token.username}, ${raw}, ${normalized}, ${action}, ${usedModel})`;
    } catch (err) {
      console.error('[voice/process] voice_logs insert:', err);
    }

    // DONE: Fix 2 — REQUIRED-FIELDS list per action type. The previous
    // Object.keys(parsed) approach only caught keys that existed but were null;
    // it missed keys the AI never returned at all (e.g. sell_price for purchases).
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
    // run it through the transliterator (which knows colors/variants/models),
    // and if it still contains Arabic letters mark item as missing so the UI
    // shows the orange warning border.
    if (parsed.item && /[\u0600-\u06FF]/.test(parsed.item)) {
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
    const responseBody = { action, data: parsed, warnings, transcript: raw, normalized, missing_fields };
    if (parsed.isNewProduct === true) {
      warnings.push('المنتج غير موجود في القاعدة — هل تريد إضافته؟');
      responseBody.suggestAddProduct = true;
      responseBody.suggestedProductName = parsed.item;
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error('[voice/process] POST:', error);
    return NextResponse.json({ error: 'خطأ في معالجة الصوت' }, { status: 500 });
  }
}
