import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { saveAICorrection } from '@/lib/db';

export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  try {
    const { transcript, aiData, userData, actionType } = await request.json();

    // Compare AI output vs user edits - save each difference as a correction
    const corrections = [];
    for (const [key, userValue] of Object.entries(userData)) {
      const aiValue = aiData[key];
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
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
