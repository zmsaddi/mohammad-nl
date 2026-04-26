'use client';

// Mobile-friendly invoice actions: Download PDF or Share via WhatsApp.
//
// PDF generation runs server-side via /api/invoices/[id]/pdf-file
// (headless Chromium). The HTML endpoint /api/invoices/[id]/pdf is
// retained as a graceful fallback — if the PDF service ever fails the
// user is automatically redirected to the HTML invoice they can still
// print or share manually.
//
// IMPORTANT — user activation timing on mobile:
//   navigator.share({files}) requires "transient activation" with a
//   ~5-second window from the user's gesture (Chrome Android +
//   iOS Safari both enforce this). Cold-start Chromium on Vercel can
//   take 5-10s on first invocation, which would consume the activation
//   window and make the share call silently fail.
//
//   Fix: kick off the PDF fetch immediately when the modal mounts
//   (useEffect). By the time the user taps a button, the blob is
//   already cached in state — share/download fire instantly with a
//   fresh user gesture.

import { useState, useEffect, useRef } from 'react';

export default function InvoiceActionModal({ refCode, onClose, onError }) {
  const [busy, setBusy] = useState(null);   // 'download' | 'share' | null
  const [pdfBlob, setPdfBlob] = useState(null); // populated by background fetch
  const [fetchError, setFetchError] = useState(null);
  const abortRef = useRef(null);

  const PDF_URL = `/api/invoices/${refCode}/pdf-file`;
  const HTML_FALLBACK_URL = `/api/invoices/${refCode}/pdf`;

  // Background pre-fetch: starts the PDF generation as soon as the modal
  // opens. The user's eventual click on a button uses the cached blob and
  // the share API gets called within the user-activation window.
  useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    (async () => {
      try {
        const res = await fetch(PDF_URL, {
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`PDF service returned ${res.status}`);
        const blob = await res.blob();
        if (!blob.type.includes('pdf') || blob.size < 1024) {
          throw new Error('PDF service returned unexpected payload');
        }
        setPdfBlob(blob);
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('[InvoiceActionModal] prefetch failed:', err);
          setFetchError(err.message || 'fetch failed');
        }
      }
    })();
    return () => ctrl.abort();
    // PDF_URL is derived from refCode which doesn't change for one modal instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refCode]);

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
    if (!pdfBlob) {
      // Fetch hasn't completed yet — show waiting state until it does.
      // useEffect already started the request; we just await the state to update.
      setBusy('download');
      return;
    }
    setBusy('download');
    try {
      triggerDownload(pdfBlob);
      onClose();
    } catch (err) {
      console.error('[InvoiceActionModal] download failed:', err);
      window.open(HTML_FALLBACK_URL, '_blank');
      onError?.('تعذّر تحميل PDF — تم فتح النسخة HTML للطباعة');
      onClose();
    } finally {
      setBusy(null);
    }
  };

  const handleShare = async () => {
    if (!pdfBlob) {
      setBusy('share');
      return;
    }
    setBusy('share');
    try {
      const file = new File([pdfBlob], `facture-${refCode}.pdf`, {
        type: 'application/pdf',
      });

      // Native share sheet — Chrome Android + iOS Safari 15+. Because the
      // blob is already in memory (pre-fetched in useEffect), this call
      // happens immediately after the user gesture, well within the 5s
      // transient-activation window. Cold-start Chromium delays are now
      // absorbed BEFORE the user clicks, not after.
      if (
        typeof navigator !== 'undefined' &&
        navigator.canShare &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          title: `Facture ${refCode}`,
          files: [file],
        });
        onClose();
        return;
      }

      // Fallback path (desktop Chrome on some OSes, very old browsers):
      // download the PDF and open WhatsApp with prefilled text. The user
      // manually attaches the file in WhatsApp.
      triggerDownload(pdfBlob);
      window.open(
        `https://wa.me/?text=${encodeURIComponent('فاتورة ' + refCode)}`,
        '_blank'
      );
      onClose();
    } catch (err) {
      // AbortError fires when the user dismisses the share sheet — not an error.
      if (err?.name !== 'AbortError') {
        console.error('[InvoiceActionModal] share failed:', err);
        // Last-resort fallback so the user still gets their invoice
        triggerDownload(pdfBlob);
        onError?.('فشلت مشاركة الواتساب — تم تحميل الملف، شاركه يدوياً');
        onClose();
      }
    } finally {
      setBusy(null);
    }
  };

  // Trigger pending action once the prefetch completes. Lets the user tap a
  // button while the PDF is still loading, then the action fires automatically
  // when the blob arrives.
  useEffect(() => {
    if (!pdfBlob) return;
    if (busy === 'download') {
      handleDownload();
    } else if (busy === 'share') {
      handleShare();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfBlob]);

  // If the prefetch errored out, redirect to HTML fallback immediately so
  // the user still gets their invoice.
  useEffect(() => {
    if (!fetchError) return;
    window.open(HTML_FALLBACK_URL, '_blank');
    onError?.('تعذّر تحميل PDF — تم فتح النسخة HTML');
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchError]);

  const isLoading = !pdfBlob && !fetchError;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal invoice-action-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '380px' }}
      >
        <h3 style={{ marginBottom: '8px' }}>فاتورة {refCode}</h3>
        <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '20px' }}>
          {isLoading ? 'جاري تحضير الملف...' : 'اختر الإجراء المطلوب'}
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
            {busy === 'download'
              ? (isLoading ? 'جاري التحضير...' : 'جاري التحميل...')
              : '📥 تحميل PDF'}
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
            {busy === 'share'
              ? (isLoading ? 'جاري التحضير...' : 'جاري المشاركة...')
              : '📤 مشاركة عبر واتساب'}
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
