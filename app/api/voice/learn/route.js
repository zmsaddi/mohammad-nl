import { NextResponse } from 'next/server';
import { saveAICorrection } from '@/lib/db';
// DONE: Step 4B — needed for the zero-correction frequency-bump path
import { sql } from '@vercel/postgres';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

export async function POST(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const { token } = auth;

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

      // BUG-10: record corrections even when the AI never emitted the field.
      // Previously the filter required `aiValue !== undefined`, which silently
      // discarded every "user added a field the LLM missed" correction —
      // making fields the LLM consistently omits unlearnable. The new filter
      // records any case where the user provided a value. Missed-field
      // scenarios are tagged with ai_output='(missing)' so the prompt
      // builder can surface them as few-shot correction examples.
      const aiMissing = aiValue === undefined || aiValue === null || aiValue === '';
      const userProvided = userValue !== undefined && userValue !== null && userValue !== '';
      if (userProvided && (aiMissing || String(aiValue) !== String(userValue))) {
        corrections.push({
          username: token.username,
          transcript: transcript || '',
          aiValue: aiMissing ? '(missing)' : String(aiValue),
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
    //
    // BUG-11: only reinforce when the userData contains exactly the same
    // populated fields as aiData. If the user ADDED any field the AI missed,
    // we are in a missed-field scenario and the correction path owns the
    // learning signal — reinforcement must NOT fire, or the system would
    // learn the wrong lesson (reinforcing unrelated patterns from a request
    // that actually contained a correction).
    const aiKeys = Object.keys(aiData || {}).filter((k) => {
      const v = aiData[k];
      return v !== '' && v !== null && v !== undefined;
    });
    const userKeys = Object.keys(userData || {}).filter((k) => {
      const v = userData[k];
      return v !== '' && v !== null && v !== undefined;
    });
    const userAddedFields = userKeys.filter((k) => !aiKeys.includes(k));

    if (corrections.length === 0 && transcript && userAddedFields.length === 0) {
      try {
        await sql`
          UPDATE ai_patterns
          SET frequency = frequency + 1, last_used = CURRENT_TIMESTAMP
          WHERE spoken_text = ${transcript}
            AND (username = ${token.username} OR username = '')
        `;
      } catch (err) {
        console.error('[voice/learn] frequency bump:', err);
      }
    }

    return NextResponse.json({ success: true, corrections: corrections.length });
  } catch (err) {
    return apiError(err, 'خطأ في حفظ التعلم', 500, 'voice/learn POST');
  }
}

// DEFECT-002: link voice_logs.action_id to the created record
export async function PUT(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const { voiceLogId, actionId } = await request.json();
    if (voiceLogId && actionId) {
      await sql`UPDATE voice_logs SET action_id = ${actionId}, status = 'completed' WHERE id = ${voiceLogId}`;
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في تحديث السجل', 500, 'voice/learn PUT');
  }
}
