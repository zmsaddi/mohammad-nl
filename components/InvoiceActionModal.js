'use client';

// Mobile-friendly invoice actions: Download PDF or Share via WhatsApp.
// Renders 2 large buttons. PDF generation happens client-side via
// html2pdf.js (lazy-loaded only when this modal opens) so the route
// /api/invoices/[id]/pdf can keep returning HTML — no server change.
//
// Share flow:
//   - navigator.canShare({ files: [...] }) → native share sheet on
//     iOS 15+ / Android Chrome → user picks WhatsApp from the list.
//   - If unsupported (older browsers, desktop Chrome on some OSes):
//     fall back to download + open WhatsApp web with a prefilled
//     message; the user attaches the just-downloaded file manually.

import { useState } from 'react';

export default function InvoiceActionModal({ refCode, onClose, onError }) {
  const [busy, setBusy] = useState(null); // 'download' | 'share' | null

  const fetchInvoiceHtml = async () => {
    const res = await fetch(`/api/invoices/${refCode}/pdf`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch invoice');
    return res.text();
  };

  // Promote the document's own `@media print { ... }` block to unconditional
  // CSS rules. html2canvas always captures the SCREEN media, so without this
  // step the invoice gets sized for a 794px screen (padding 40px, font 13px,
  // max-width 794px) which then has to be squeezed into A4 — totals get
  // orphaned, the footer overlaps the stamp, page breaks land mid-cell.
  // The invoice generator already ships the right print rules; we just need
  // them to apply during the html2canvas pass.
  const flattenPrintMediaRules = (idoc) => {
    const styleEls = idoc.querySelectorAll('style');
    styleEls.forEach((styleEl) => {
      const text = styleEl.textContent;
      const idx = text.indexOf('@media print');
      if (idx === -1) return;
      // Walk balanced braces to find the matching close of the @media block
      let depth = 0;
      let innerStart = -1;
      for (let i = idx; i < text.length; i++) {
        const ch = text[i];
        if (ch === '{') {
          if (depth === 0) innerStart = i + 1;
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            const innerRules = text.substring(innerStart, i);
            // Append the inner rules as unconditional. They land later in the
            // cascade so they win over the screen rules — same precedence the
            // browser would give them when actually printing.
            styleEl.textContent = text + '\n/* promoted-from-@media-print */\n' + innerRules + '\n';
            break;
          }
        }
      }
    });
  };

  // Render the invoice HTML inside an off-screen <iframe> so the document's
  // own `body { padding:40px; max-width:794px; ... }` rules apply correctly.
  const generatePdfBlob = async () => {
    const html = await fetchInvoiceHtml();
    const html2pdf = (await import('html2pdf.js')).default;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = [
      'position:fixed',
      'left:-99999px',
      'top:0',
      'width:794px',
      'height:1px',
      'border:0',
      'opacity:0',
      'pointer-events:none',
    ].join(';');
    iframe.srcdoc = html;
    document.body.appendChild(iframe);

    try {
      // Wait for the iframe document to finish parsing.
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('iframe load timeout')), 15000);
        iframe.addEventListener(
          'load',
          () => { clearTimeout(t); resolve(); },
          { once: true }
        );
      });

      // Apply print-media rules unconditionally so the on-screen layout
      // matches what the user gets in a "Save as PDF" browser print.
      flattenPrintMediaRules(iframe.contentDocument);

      // One extra rAF tick so layout + font swaps settle before capture.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const idoc = iframe.contentDocument;
      const ibody = idoc?.body;
      if (!ibody || ibody.scrollHeight < 10) {
        throw new Error('invoice document failed to render');
      }

      // Resize iframe to actual content so html2canvas captures everything,
      // not just the initial 1px viewport.
      iframe.style.height = ibody.scrollHeight + 'px';

      const blob = await html2pdf()
        .from(ibody)
        .set({
          // 0 margins — the invoice's own padding/margin (now in mm thanks to
          // the promoted print rules) handles the page edges. A non-zero
          // outer margin would double-up.
          margin: 0,
          filename: `facture-${refCode}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
            windowWidth: 794,
            windowHeight: ibody.scrollHeight,
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          // Respect page-break-inside:avoid on .totals-wrap, .footer, etc.
          // (set in invoice-generator.js) and use the legacy single-canvas
          // splitter as a fallback for browsers that don't honor CSS rules.
          pagebreak: {
            mode: ['css', 'legacy'],
            avoid: [
              '.totals-wrap',
              '.footer',
              '.stamp-container',
              '.payments-history',
              '.state-footer',
              'thead',
              'tr',
            ],
          },
        })
        .outputPdf('blob');
      return blob;
    } finally {
      document.body.removeChild(iframe);
    }
  };

  const handleDownload = async () => {
    setBusy('download');
    try {
      const blob = await generatePdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `facture-${refCode}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      console.error('[InvoiceActionModal] download failed:', err);
      onError?.('فشل تحميل الفاتورة، حاول مرة أخرى');
    } finally {
      setBusy(null);
    }
  };

  const handleShare = async () => {
    setBusy('share');
    try {
      const blob = await generatePdfBlob();
      const file = new File([blob], `facture-${refCode}.pdf`, { type: 'application/pdf' });

      // Preferred path: native share sheet with file attachment.
      if (typeof navigator !== 'undefined'
          && navigator.canShare
          && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Facture ${refCode}`,
          text: `فاتورة ${refCode}`,
          files: [file],
        });
        onClose();
        return;
      }

      // Fallback: download the PDF, then open WhatsApp with a prefilled
      // message. The user attaches the just-downloaded file manually.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `facture-${refCode}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      window.open(
        `https://wa.me/?text=${encodeURIComponent('فاتورة ' + refCode)}`,
        '_blank'
      );
      onClose();
    } catch (err) {
      // AbortError fires when the user dismisses the share sheet — not an error.
      if (err?.name !== 'AbortError') {
        console.error('[InvoiceActionModal] share failed:', err);
        onError?.('فشل مشاركة الفاتورة، حاول مرة أخرى');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal invoice-action-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '380px' }}
      >
        <h3 style={{ marginBottom: '8px' }}>فاتورة {refCode}</h3>
        <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '20px' }}>
          اختر الإجراء المطلوب
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleDownload}
            disabled={busy !== null}
            style={{ padding: '14px', fontSize: '1rem', fontWeight: 600 }}
          >
            {busy === 'download' ? 'جاري التحميل...' : '📥 تحميل PDF'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleShare}
            disabled={busy !== null}
            style={{
              background: '#25D366',
              color: 'white',
              padding: '14px',
              fontSize: '1rem',
              fontWeight: 600,
              border: 'none',
            }}
          >
            {busy === 'share' ? 'جاري التحضير...' : '📤 مشاركة عبر واتساب'}
          </button>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy !== null}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
