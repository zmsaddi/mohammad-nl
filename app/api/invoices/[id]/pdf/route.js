// DONE: Step 3
// PDF endpoint: returns the invoice as a self-contained HTML document.
// The browser opens it in a tab; the user prints to PDF with Ctrl+P.
// RBAC: admin/manager → any invoice; seller → own invoices only;
//        driver → invoices for deliveries they personally completed.

import { NextResponse } from 'next/server';
import { getToken }     from 'next-auth/jwt';
import { sql }          from '@vercel/postgres';
import { getSettings }  from '@/lib/db';
import { generateInvoiceBody } from '@/lib/invoice-modes';

export async function GET(request, { params }) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }

  const allowed = ['admin', 'manager', 'seller', 'driver'];
  if (!allowed.includes(token.role)) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }

  try {
    // Next.js 16: params is a Promise
    const { id } = await params;

    // Look up by ref_code first, then by numeric id.
    // FEAT-04: LEFT JOIN sales so the generator receives payment_status
    // and down_payment_expected for three-state rendering.
    const numericId = parseInt(id, 10) || 0;
    const { rows: invRows } = await sql`
      SELECT
        i.*,
        s.payment_status,
        s.down_payment_expected
      FROM invoices i
      LEFT JOIN sales s ON s.id = i.sale_id
      WHERE i.ref_code = ${id} OR i.id = ${numericId}
    `;
    if (!invRows.length) {
      return NextResponse.json({ error: 'الفاتورة غير موجودة' }, { status: 404 });
    }
    const invoice = invRows[0];

    // RBAC enforcement at the invoice level
    if (token.role === 'seller') {
      const { rows: u } = await sql`SELECT name FROM users WHERE username = ${token.username}`;
      const sellerName = u[0]?.name || '';
      if (invoice.seller_name !== sellerName) {
        return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
      }
    }
    if (token.role === 'driver') {
      const { rows: d } = await sql`SELECT assigned_driver FROM deliveries WHERE id = ${invoice.delivery_id}`;
      if (d[0]?.assigned_driver !== token.username) {
        return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
      }
    }

    // FEAT-04: fetch collection payment history for this sale.
    // Used by the generator to render the payments history block +
    // compute the correct state pill.
    const { rows: paymentRows } = await sql`
      SELECT date, amount, payment_method, tva_amount
      FROM payments
      WHERE sale_id = ${invoice.sale_id}
        AND type = 'collection'
      ORDER BY date ASC, id ASC
    `;

    const settings = await getSettings();
    const html = generateInvoiceBody(invoice, settings, paymentRows);

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type':        'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="facture-${invoice.ref_code}.html"`,
        'Cache-Control':       'no-store',
      },
    });
  } catch (error) {
    console.error('[Invoice PDF]', error.message);
    return NextResponse.json({ error: 'خطأ في توليد الفاتورة' }, { status: 500 });
  }
}
