import { NextResponse } from 'next/server';
import { getSuppliers, addSupplier, deleteSupplier } from '@/lib/db';
import { SupplierSchema, zodArabicError } from '@/lib/schemas';
import { invalidateCache } from '@/lib/entity-resolver';
import { requireAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-errors';

export async function GET(request) {
  const auth = await requireAuth(request, ['admin', 'manager']);
  if (auth.error) return auth.error;
  try {
    const rows = await getSuppliers();
    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err, 'خطأ في جلب البيانات', 500, 'suppliers GET');
  }
}

export async function POST(request) {
  const auth = await requireAuth(request, ['admin', 'manager', 'seller']);
  if (auth.error) return auth.error;
  try {
    const body = await request.json();
    const parsed = SupplierSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodArabicError(parsed.error) }, { status: 400 });

    const result = await addSupplier(parsed.data);
    invalidateCache(); // supplier list changed — rebuild entity-resolver index
    // BUG-21: addSupplier may return { ambiguous, candidates, message }
    // when the name already exists with no phone disambiguator. Passed
    // through untouched for purchases/page.js to handle.
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return apiError(err, 'خطأ في إضافة البيانات', 500, 'suppliers POST');
  }
}

export async function DELETE(request) {
  const auth = await requireAuth(request, ['admin']);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    await deleteSupplier(searchParams.get('id'));
    invalidateCache();
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, 'خطأ في حذف البيانات', 500, 'suppliers DELETE');
  }
}
