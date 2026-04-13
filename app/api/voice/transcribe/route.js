import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import Groq from 'groq-sdk';
import { getProducts, getClients, getSuppliers } from '@/lib/db';
import { sql } from '@vercel/postgres';
import { normalizeArabicText } from '@/lib/voice-normalizer';

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
    const formData = await request.formData();
    const audioFile = formData.get('audio');
    if (!audioFile) {
      return NextResponse.json({ error: 'لم يتم إرسال ملف صوتي' }, { status: 400 });
    }

    // Build smart vocabulary: frequency-sorted + sentence format for better Whisper accuracy
    const [products, clients, suppliers] = await Promise.all([
      getProducts(), getClients(), getSuppliers(),
    ]);

    // Get frequently used names from recent sales (most frequent first)
    let topNames = [];
    try {
      const { rows: topClients } = await sql`SELECT client_name, COUNT(*) as cnt FROM sales GROUP BY client_name ORDER BY cnt DESC LIMIT 20`;
      const { rows: topItems } = await sql`SELECT item, COUNT(*) as cnt FROM sales GROUP BY item ORDER BY cnt DESC LIMIT 10`;
      topNames = [...topClients.map((c) => c.client_name), ...topItems.map((i) => i.item)];
    } catch (err) {
      console.error('[voice/transcribe] topNames lookup:', err);
    }

    // Get learned aliases (user-corrected names)
    let aliasNames = [];
    try {
      const { rows: aliases } = await sql`SELECT alias FROM entity_aliases ORDER BY frequency DESC LIMIT 15`;
      aliasNames = aliases.map((a) => a.alias);
    } catch (err) {
      console.error('[voice/transcribe] aliasNames lookup:', err);
    }

    // Build vocab: action words + frequent names first + all names + aliases
    const allNames = [
      ...new Set([
        ...topNames,
        ...products.map((p) => p.name),
        ...clients.map((c) => c.name),
        ...suppliers.map((s) => s.name),
        ...aliasNames,
      ])
    ].filter(Boolean);

    const vocab = `بعت لعميل دراجة كهربائية كاش بنك آجل، اشتريت من مورد بطارية شاحن، مصروف إيجار رواتب، ${allNames.join('، ')}`;

    // Convert to proper File for Groq
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const file = new File([buffer], 'audio.webm', { type: 'audio/webm' });

    // Transcribe with Whisper
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const transcription = await groq.audio.transcriptions.create({
      file: file,
      model: 'whisper-large-v3',
      language: 'ar',
      prompt: vocab.slice(0, 1500),
    });

    const rawText = transcription.text || '';
    const normalizedText = normalizeArabicText(rawText);

    return NextResponse.json({
      raw: rawText,
      normalized: normalizedText,
    });
  } catch (error) {
    console.error('Voice transcribe error:', error);
    return NextResponse.json({ error: 'خطأ في التحويل الصوتي' }, { status: 500 });
  }
}
