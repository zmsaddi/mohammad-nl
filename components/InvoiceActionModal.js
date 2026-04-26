'use client';

// Mobile-friendly invoice actions: Download PDF or Share via WhatsApp.
//
// PDF generation runs server-side via /api/invoices/[id]/pdf-file
// (headless Chromium). The HTML endpoint /api/invoices/[id]/pdf is
// retained as a graceful fallback — if the PDF service ever fails or
// times out, the user is automatically redirected to the HTML invoice
// they can still print or share manually.
//
// Share flow:
//   - navigator.canShare({files}) on iOS 15+ / Android Chrome → OS share
//     sheet appears with WhatsApp as one option.
//   - If unsupported (older browsers, desktop Chrome on some OSes):
//     download the file then open WhatsApp web with a prefilled text;
//     user attaches the just-downloaded PDF manually.

import { useState } from 'react';

export default function InvoiceActionModal({ refCode, onClose, onError }) {
  const [busy, setBusy] = useState(null); // 'download' | 'share' | null

  const PDF_URL = `/api/invoices/${refCode}/pdf-file`;
  const HTML_FALLBACK_URL = `/api/invoices/${refCode}/pdf`;

  const fetchPdfBlob = async () => {
    const res = await fetch(PDF_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`PDF service returned ${res.status}`);
    const blob = await res.blob();
    if (!blob.type.includes('pdf') || blob.size < 1024) {
      throw new Error('PDF service returned unexpected payload');
    }
    return blob;
  };

  const triggerDownload = (blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `facture-${refCode}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownload = async () => {
    setBusy('download');
    try {
      const blob = await fetchPdfBlob();
      triggerDownload(blob);
      onClose();
    } catch (err) {
      console.error('[InvoiceActionModal] download failed:', err);
      // Graceful fallback: open the HTML invoice in a new tab so the
      // user still has something to print/save manually. They lose the
      // one-tap PDF UX but they don't lose access to the invoice.
      window.open(HTML_FALLBACK_URL, '_blank');
      onError?.('تعذّر تحميل PDF — تم فتح النسخة HTML للطباعة');
      onClose();
    } finally {
      setBusy(null);
    }
  };

  const handleShare = async () => {
    setBusy('share');
    try {
      const blob = await fetchPdfBlob();
      const file = new File([blob], `facture-${refCode}.pdf`, {
        type: 'application/pdf',
      });

      // Preferred path: native share sheet with file attachment.
      if (
        typeof navigator !== 'undefined' &&
        navigator.canShare &&
        navigator.canShare({ files: [file] })
      ) {
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
      triggerDownload(blob);
      window.open(
        `https://wa.me/?text=${encodeURIComponent('فاتورة ' + refCode)}`,
        '_blank'
      );
      onClose();
    } catch (err) {
      // AbortError fires when the user dismisses the share sheet — not an error.
      if (err?.name !== 'AbortError') {
        console.error('[InvoiceActionModal] share failed:', err);
        // Same graceful fallback as the download path
        window.open(HTML_FALLBACK_URL, '_blank');
        onError?.('تعذّرت المشاركة — تم فتح النسخة HTML');
        onClose();
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

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            marginBottom: '20px',
          }}
        >
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
