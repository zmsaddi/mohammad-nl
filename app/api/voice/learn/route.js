import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { saveAICorrection } from '@/lib/db';
// DONE: Step 4B — needed for the zero-correction frequency-bump path
import { sql } from '@vercel/postgres';

export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  try {
    const { transcript, aiData, userData, actionType } = await request.json();

    // DONE: Fix 4 — track every extractable field across all 3 action types so
    // sell_price corrections, client_phone/address corrections, etc. all feed
    // back into ai_corrections + ai_patterns for next-run improvement.
    const learnableFields = [
      // Common
      'payment_type',
      // Purchase
      'supplier', 'item', 'quantity', 'unit_price', 'sell_price', 'category',
      // Sale
      'client_name', 'client_phone', 'client_address',
      // Expense
      'description', 'amount',
    ];
    const corrections = [];
    for (const key of learnableFields) {
      const aiValue = aiData[key];
      const userValue = userData[key];

      // DONE: Fix 6 — warn (but still save) when a user submits an Arabic
      // product name. The entity resolver will create an Arabic→English alias
      // via saveAICorrection so the next request matches correctly.
      if (key === 'item' && userValue && /[\u0600-\u06FF]/.test(String(userValue))) {
        console.warn(`[voice/learn] Arabic product name submitted: "${userValue}" — should be English`);
      }

      if (aiValue !== undefined && aiValue !== null && String(aiValue) !== String(userValue) && userValue) {
        corrections.push({
          username: token.username,
          transcript: transcript || '',
          aiValue: String(aiValue),
          userValue: String(userValue),
          actionType: actionType || '',
          fieldName: key,
        });
      }
    }

    for (const correction of corrections) {
      await saveAICorrection(correction);
    }

    // DONE: Step 4B — zero-correction reinforcement.
    // If the user accepted everything the AI extracted, every matched pattern
    // gets a frequency bump. Over time the most-trusted patterns float to the
    // top of the prompt and the resolver promotes the most-used aliases.
    if (corrections.length === 0 && transcript) {
      try {
        await sql`
          UPDATE ai_patterns
          SET frequency = frequency + 1, last_used = CURRENT_TIMESTAMP
          WHERE spoken_text = ${transcript}
            AND (username = ${token.username} OR username = '')
        `;
      } catch {}
    }

    return NextResponse.json({ success: true, corrections: corrections.length });
  } catch {
    return NextResponse.json({ error: 'خطأ في حفظ التعلم' }, { status: 500 });
  }
}
