import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import Groq from 'groq-sdk';
import { getProducts, getClients, getSuppliers } from '@/lib/db';
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

    // Build vocabulary prompt from DB
    const [products, clients, suppliers] = await Promise.all([
      getProducts(), getClients(), getSuppliers(),
    ]);
    // Build context prompt - full sentences help Whisper understand word boundaries
    const names = [
      ...products.map((p) => p.name),
      ...clients.map((c) => c.name),
      ...suppliers.map((s) => s.name),
    ].filter(Boolean).join('، ');
    const vocab = `بعت، اشتريت، مصروف، كاش، بنك، آجل، دراجة كهربائية، بطارية، شاحن، إيجار، رواتب، ${names}`;

    // Convert to proper File for Groq
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const file = new File([buffer], 'audio.webm', { type: 'audio/webm' });

    // Transcribe with Whisper
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const transcription = await groq.audio.transcriptions.create({
      file: file,
      model: 'whisper-large-v3-turbo',
      language: 'ar',
      prompt: vocab.slice(0, 500),
    });

    const rawText = transcription.text || '';
    const normalizedText = normalizeArabicText(rawText);

    return NextResponse.json({
      raw: rawText,
      normalized: normalizedText,
    });
  } catch (error) {
    console.error('Voice transcribe error:', error);
    return NextResponse.json({ error: 'خطأ في التحويل: ' + (error?.message || error?.error?.message || 'غير معروف') }, { status: 500 });
  }
}
