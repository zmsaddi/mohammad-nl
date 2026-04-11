import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import Groq from 'groq-sdk';
import { getProducts, getClients, getSuppliers } from '@/lib/db';
import { sql } from '@vercel/postgres';
import { getSystemPrompt, FEW_SHOT_EXAMPLES, TOOL_SCHEMAS } from '@/lib/voice-prompts';
import { fuzzyMatchName } from '@/lib/voice-normalizer';

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
    const { text, conversationHistory } = await request.json();
    if (!text) return NextResponse.json({ error: 'لم يتم إرسال نص' }, { status: 400 });

    // Fetch context from DB
    const [products, clients, suppliers] = await Promise.all([
      getProducts(), getClients(), getSuppliers(),
    ]);

    const systemPrompt = getSystemPrompt(products, clients, suppliers);

    // Build messages
    const messages = [
      { role: 'system', content: systemPrompt },
      ...FEW_SHOT_EXAMPLES,
      ...(conversationHistory || []),
      { role: 'user', content: text },
    ];

    // Call LLM with function calling
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      tools: TOOL_SCHEMAS,
      tool_choice: 'required',
      temperature: 0.1,
      max_tokens: 500,
    });

    const choice = completion.choices[0];
    const toolCall = choice?.message?.tool_calls?.[0];

    if (!toolCall) {
      return NextResponse.json({
        action: 'clarification',
        question: 'لم أفهم - حاول مرة أخرى بوضوح أكثر',
        missing_fields: [],
      });
    }

    const funcName = toolCall.function.name;
    let args;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      return NextResponse.json({
        action: 'clarification',
        question: 'حدث خطأ في فهم البيانات - حاول مرة أخرى',
        missing_fields: [],
      });
    }

    // Map English keywords back to Arabic
    const PAYMENT_MAP = { cash: 'كاش', bank: 'بنك', credit: 'آجل', 'كاش': 'كاش', 'بنك': 'بنك', 'آجل': 'آجل' };
    const CATEGORY_MAP = { rent: 'إيجار', salaries: 'رواتب', transport: 'نقل وشحن', maintenance: 'صيانة وإصلاح', marketing: 'تسويق وإعلان', utilities: 'كهرباء وماء', insurance: 'تأمين', tools: 'أدوات ومعدات', other: 'أخرى' };
    if (args.payment_type) args.payment_type = PAYMENT_MAP[args.payment_type.toLowerCase()] || args.payment_type;
    if (args.category) args.category = CATEGORY_MAP[args.category.toLowerCase()] || args.category;

    // Handle clarification
    if (funcName === 'request_clarification') {
      return NextResponse.json({
        action: 'clarification',
        question: args.question,
        missing_fields: args.missing_fields || [],
        partial_data: args.partial_data || {},
      });
    }

    // Validate and enhance extracted data
    const result = { action: funcName, data: args, warnings: [] };

    if (funcName === 'register_sale') {
      // Fuzzy match client
      const clientMatch = fuzzyMatchName(args.client_name, clients.map((c) => c.name));
      if (clientMatch) {
        result.data.client_name = clientMatch.name;
        if (clientMatch.confidence !== 'high') result.warnings.push(`العميل "${args.client_name}" تم مطابقته مع "${clientMatch.name}" - تأكد`);
      } else {
        return NextResponse.json({ action: 'clarification', question: `العميل "${args.client_name}" غير موجود. أضفه يدوياً أولاً.`, missing_fields: ['client_name'] });
      }

      // Fuzzy match product
      const productMatch = fuzzyMatchName(args.item, products.map((p) => p.name));
      if (productMatch) {
        result.data.item = productMatch.name;
        const prod = products.find((p) => p.name === productMatch.name);
        if (prod && args.quantity > prod.stock) {
          result.warnings.push(`الكمية ${args.quantity} أكبر من المخزون ${prod.stock}`);
        }
      } else {
        return NextResponse.json({ action: 'clarification', question: `المنتج "${args.item}" غير موجود بالمخزون.`, missing_fields: ['item'] });
      }
    }

    if (funcName === 'register_purchase') {
      const supplierMatch = fuzzyMatchName(args.supplier, suppliers.map((s) => s.name));
      if (supplierMatch) {
        result.data.supplier = supplierMatch.name;
      } else {
        return NextResponse.json({ action: 'clarification', question: `المورد "${args.supplier}" غير موجود. أضفه يدوياً أولاً.`, missing_fields: ['supplier'] });
      }
    }

    // Log voice interaction
    const today = new Date().toISOString().split('T')[0];
    await sql`INSERT INTO voice_logs (date, username, transcript, normalized_text, action_type, status)
      VALUES (${today}, ${token.username}, ${text}, ${text}, ${funcName}, 'extracted')`.catch(() => {});

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'خطأ: ' + error.message }, { status: 500 });
  }
}
