import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { saveAICorrection } from '@/lib/db';

export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  try {
    const { transcript, aiData, userData, actionType } = await request.json();

    // Only learn from fields that AI actually extracted (not user-added fields like phone/email)
    const learnableFields = ['client_name', 'item', 'supplier', 'quantity', 'unit_price', 'payment_type', 'category', 'description', 'amount'];
    const corrections = [];
    for (const key of learnableFields) {
      const aiValue = aiData[key];
      const userValue = userData[key];
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

    return NextResponse.json({ success: true, corrections: corrections.length });
  } catch {
    return NextResponse.json({ error: 'خطأ في حفظ التعلم' }, { status: 500 });
  }
}
