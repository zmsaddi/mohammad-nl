// v1.2 — Real PDF endpoint via headless Chromium (server-side).
//
// Sister of /api/invoices/[id]/pdf which serves HTML for desktop Ctrl+P.
// This endpoint produces an actual application/pdf file so the mobile UI
// can offer Download + WhatsApp share with a real attachable file.
//
// Architecture choices:
//   - @sparticuz/chromium-min (~50MB) over @sparticuz/chromium (~170MB)
//     so the function fits comfortably under Vercel Hobby's 250MB limit.
//     The min variant downloads the actual binary from a pinned CDN URL
//     on first cold start; subsequent invocations reuse the cached file.
//   - puppeteer-core (no bundled Chromium) because chromium-min provides
//     the executable.
//   - generateInvoiceBody() is reused as-is. Zero duplication; whatever
//     ships in the HTML endpoint ships here too.
//   - The stamp image (/stamp.png) is inlined as a base64 data URI before
//     handing HTML to Chromium, because page.setContent() loads HTML with
//     an about:blank base URL — relative paths would 404 otherwise.

import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { getSettings } from '@/lib/db';
import { generateInvoiceBody } from '@/lib/invoice-modes';
import { requireAuth } from '@/lib/api-auth';
import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';

// Pin the Chromium binary version used in production. Bumping this string
// is the only safe way to upgrade Chromium — any version mismatch with the
// puppeteer-core API surface will surface as a launch error.
const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar';

export const maxDuration = 30;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// In-memory cache of the stamp data URI. Lives for the lifetime of the
// warm Lambda container so we don't re-read the file on every request.
let stampDataUriCache = null;
async function getStampDataUri() {
  if (stampDataUriCache !== null) return stampDataUriCache;
  try {
    const stampPath = path.join(process.cwd(), 'public', 'stamp.png');
    const buf = await fs.readFile(stampPath);
    stampDataUriCache = `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    // Missing stamp is non-fatal — invoice still renders without it.
    stampDataUriCache = '';
  }
  return stampDataUriCache;
}

export async function GET(request, { params }) {
  const auth = await requireAuth(request, ['admin', 'manager', 'seller', 'driver']);
  if (auth.error) return auth.error;
  const { token } = auth;

  let browser = null;
  try {
    const { id } = await params;
    const numericId = parseInt(id, 10) || 0;

    // Same query shape as /api/invoices/[id]/pdf so RBAC + data parity stays.
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

    // RBAC — same checks as the HTML endpoint
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

    const { rows: paymentRows } = await sql`
      SELECT date, amount, payment_method, tva_amount
      FROM payments
      WHERE sale_id = ${invoice.sale_id}
        AND type = 'collection'
      ORDER BY date ASC, id ASC
    `;

    const settings = await getSettings();
    let html = generateInvoiceBody(invoice, settings, paymentRows);

    // Replace /stamp.png reference with inlined data URI
    const stampDataUri = await getStampDataUri();
    if (stampDataUri) {
      html = html.replace('src="/stamp.png"', `src="${stampDataUri}"`);
    }

    // Launch Chromium and render. We always close the browser in finally
    // — leaking a browser instance ties up the Lambda's memory across
    // invocations and eventually OOMs the function.
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
      headless: true,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true, // for the green header bar + colored status pill
      margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
    });

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="facture-${invoice.ref_code}.pdf"`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.error('[Invoice PDF v2]', error?.message || error);
    return NextResponse.json({ error: 'خطأ في توليد الفاتورة' }, { status: 500 });
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}
