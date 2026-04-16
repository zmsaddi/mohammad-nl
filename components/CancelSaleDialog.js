'use client';

import { useEffect, useState } from 'react';
import { formatNumber } from '@/lib/utils';

/**
 * FEAT-05: cancellation dialog for admins.
 *
 * Usage:
 *   <CancelSaleDialog
 *     saleId={row.sale_id}                          // required
 *     invoiceMode="soft"                            // 'soft' (default) or 'delete'
 *     title="إلغاء التوصيل"                         // optional
 *     onSuccess={() => { close + refresh }}         // called after successful cancel
 *     onCancel={() => { close without action }}     // called on dismiss
 *   />
 *
 * Lifecycle:
 *   1. On mount, GET /api/sales/[id]/cancel to fetch the preview payload.
 *   2. If the preview reports a settled bonus, show the Arabic block
 *      message and disable the confirm button entirely.
 *   3. Otherwise render:
 *      - Sale summary (client, item, total, refund amount)
 *      - Reason textarea (required)
 *      - Per-role bonus keep/remove radios (hidden when the sale has
 *        no bonus of that role, or when invoiceMode='delete' which
 *        forces 'remove' for both)
 *   4. Confirm button is disabled until reason is non-empty AND every
 *      existing bonus has a keep/remove choice.
 *   5. On confirm, POST to the same endpoint with { reason, bonusActions,
 *      invoiceMode, notes }. On success, call onSuccess.
 */
export default function CancelSaleDialog({
  saleId,
  invoiceMode = 'soft',
  title = 'إلغاء الطلب',
  onSuccess,
  onCancel,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [refundAmount, setRefundAmount] = useState(0);

  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [sellerChoice, setSellerChoice] = useState(null);
  const [driverChoice, setDriverChoice] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const isDelete = invoiceMode === 'delete';

  // On mount, fetch the preview
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sales/${saleId}/cancel`, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.error || 'خطأ في جلب معاينة الإلغاء');
        } else {
          setPreview(data.preview);
          setRefundAmount(parseFloat(data.refundAmount) || 0);
          // In delete-sale mode, force "remove" for both roles — FK cascade
          // would delete a kept bonus row the moment the sale row drops.
          if (isDelete) {
            if (data.preview?.sellerBonus?.exists) setSellerChoice('remove');
            if (data.preview?.driverBonus?.exists) setDriverChoice('remove');
          }
        }
      } catch (err) {
        if (!cancelled) setError('خطأ في الاتصال');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId]);

  const hasSellerBonus = preview?.sellerBonus?.exists === true;
  const hasDriverBonus = preview?.driverBonus?.exists === true;
  const needsSellerChoice = hasSellerBonus && !isDelete;
  const needsDriverChoice = hasDriverBonus && !isDelete;

  const reasonOk = reason.trim().length > 0;
  const bonusOk =
    (!needsSellerChoice || sellerChoice !== null) &&
    (!needsDriverChoice || driverChoice !== null);
  const canSubmit = !loading && !submitting && !error && reasonOk && bonusOk && preview;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const bonusActions = {};
      if (hasSellerBonus) bonusActions.seller = sellerChoice || 'remove';
      if (hasDriverBonus) bonusActions.driver = driverChoice || 'remove';

      const res = await fetch(`/api/sales/${saleId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: reason.trim(),
          invoiceMode,
          bonusActions: Object.keys(bonusActions).length > 0 ? bonusActions : null,
          notes: notes.trim() || null,
        }),
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || data?.message || 'خطأ في تنفيذ الإلغاء');
        return;
      }
      onSuccess?.(data);
    } catch (err) {
      console.error('[CancelSaleDialog] submit:', err);
      setError('خطأ في الاتصال');
    } finally {
      // BUG-4 hotfix 2026-04-14: always reset submitting so the user can
      // correct a validation error (e.g., missing reason) and retry
      // without the button being stuck disabled.
      setSubmitting(false);
    }
  };

  return (
    // Hotfix 2026-04-14: backdrop onClick removed. Bonus-choice selection
    // and the reason textarea are expensive to re-enter — users reported
    // accidentally tapping outside the dialog and losing their input.
    // The dialog now only closes via the "تأكيد الإلغاء" confirm button,
    // the "رجوع" back button, or a successful cancellation.
    <div className="modal-overlay">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        className="cancel-sale-dialog"
        style={{ maxWidth: '520px' }}
      >
        <h3 style={{ marginBottom: '12px' }}>{title}</h3>

        {loading && (
          <div style={{ padding: '16px', textAlign: 'center', color: '#64748b' }}>
            جاري تحميل المعاينة...
          </div>
        )}

        {!loading && error && !preview && (
          <div
            style={{
              background: '#fee2e2',
              color: '#991b1b',
              padding: '12px',
              borderRadius: '8px',
              marginBottom: '12px',
              fontSize: '0.85rem',
            }}
          >
            ⚠ {error}
          </div>
        )}

        {!loading && preview && (
          <>
            {/* Sale summary */}
            <div
              style={{
                background: '#f8fafc',
                padding: '12px 16px',
                borderRadius: '10px',
                marginBottom: '12px',
                fontSize: '0.85rem',
              }}
            >
              <div style={{ marginBottom: '4px' }}>
                العميل: <strong>{preview.clientName}</strong>
              </div>
              <div style={{ marginBottom: '4px' }}>
                الصنف: <strong>{preview.item}</strong>
              </div>
              <div style={{ marginBottom: '4px' }}>
                الإجمالي: <strong>{formatNumber(preview.total)}</strong>
              </div>
              {refundAmount > 0 && (
                <div style={{ marginTop: '8px', color: '#dc2626', fontWeight: 600 }}>
                  ⤷ سيتم استرجاع: {formatNumber(refundAmount)} €
                </div>
              )}
              {preview.alreadyCancelled && (
                <div style={{ marginTop: '8px', color: '#d97706' }}>
                  ⚠ هذا الطلب مُلغى بالفعل — سيتم تشغيل التنظيف الإضافي فقط
                </div>
              )}
            </div>

            {/* Reason textarea — required */}
            <div style={{ marginBottom: '12px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.78rem',
                  color: '#64748b',
                  marginBottom: '4px',
                }}
              >
                سبب الإلغاء *
              </label>
              <textarea
                className="cancel-dialog-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="اكتب سبب إلغاء الطلب..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: reasonOk ? '1.5px solid #d1d5db' : '2px solid #dc2626',
                  borderRadius: '8px',
                  fontFamily: "'Cairo', sans-serif",
                  fontSize: '0.85rem',
                  resize: 'vertical',
                }}
              />
            </div>

            {/* Bonus keep/remove radios */}
            {(hasSellerBonus || hasDriverBonus) && !isDelete && (
              <div
                style={{
                  background: '#fffbeb',
                  border: '1px solid #fbbf24',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  marginBottom: '12px',
                }}
              >
                <div
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: '#92400e',
                    marginBottom: '8px',
                  }}
                >
                  المكافآت — يجب الاختيار لكل مكافأة
                </div>

                {hasSellerBonus && (
                  <div className="cancel-dialog-bonus-row" style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '0.78rem', color: '#78350f', marginBottom: '4px' }}>
                      مكافأة البائع ({preview.sellerBonus.username},{' '}
                      {formatNumber(preview.sellerBonus.amount)} €)
                    </div>
                    <label className="cancel-dialog-radio" style={{ marginInlineEnd: '14px', fontSize: '0.82rem' }}>
                      <input
                        type="radio"
                        name="sellerChoice"
                        checked={sellerChoice === 'keep'}
                        onChange={() => setSellerChoice('keep')}
                        style={{ marginInlineEnd: '4px' }}
                      />
                      إبقاء
                    </label>
                    <label className="cancel-dialog-radio" style={{ fontSize: '0.82rem' }}>
                      <input
                        type="radio"
                        name="sellerChoice"
                        checked={sellerChoice === 'remove'}
                        onChange={() => setSellerChoice('remove')}
                        style={{ marginInlineEnd: '4px' }}
                      />
                      إزالة
                    </label>
                  </div>
                )}

                {hasDriverBonus && (
                  <div className="cancel-dialog-bonus-row">
                    <div style={{ fontSize: '0.78rem', color: '#78350f', marginBottom: '4px' }}>
                      مكافأة السائق ({preview.driverBonus.username},{' '}
                      {formatNumber(preview.driverBonus.amount)} €)
                    </div>
                    <label className="cancel-dialog-radio" style={{ marginInlineEnd: '14px', fontSize: '0.82rem' }}>
                      <input
                        type="radio"
                        name="driverChoice"
                        checked={driverChoice === 'keep'}
                        onChange={() => setDriverChoice('keep')}
                        style={{ marginInlineEnd: '4px' }}
                      />
                      إبقاء
                    </label>
                    <label className="cancel-dialog-radio" style={{ fontSize: '0.82rem' }}>
                      <input
                        type="radio"
                        name="driverChoice"
                        checked={driverChoice === 'remove'}
                        onChange={() => setDriverChoice('remove')}
                        style={{ marginInlineEnd: '4px' }}
                      />
                      إزالة
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* Delete-sale mode notice: keep option is hidden */}
            {(hasSellerBonus || hasDriverBonus) && isDelete && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fca5a5',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  marginBottom: '12px',
                  fontSize: '0.78rem',
                  color: '#991b1b',
                }}
              >
                ℹ الحذف النهائي للطلب يُلغي جميع المكافآت تلقائياً — لا يمكن الإبقاء عليها.
              </div>
            )}

            {/* Settled bonus warning — the bonus was already paid out.
                Cancelling the order doesn't magically return the money.
                The admin needs to manually recover it from the employee. */}
            {hasSellerBonus && preview.sellerBonus?.settled && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '2px solid #dc2626',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  marginBottom: '12px',
                  fontSize: '0.82rem',
                  color: '#991b1b',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                  ⚠ تنبيه: بونص البائع مُسوَّى (مدفوع فعلاً)
                </div>
                <div>
                  البائع <strong>{preview.sellerBonus.username}</strong> استلم{' '}
                  <strong>{formatNumber(preview.sellerBonus.amount)} €</strong> كتسوية.
                  إلغاء الطلب لا يسترد المبلغ تلقائياً.
                </div>
                <div style={{ marginTop: '6px', fontWeight: 600 }}>
                  → يجب استرداد المبلغ يدوياً من البائع وتسجيل العملية في الملاحظات.
                </div>
              </div>
            )}
            {hasDriverBonus && preview.driverBonus?.settled && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '2px solid #dc2626',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  marginBottom: '12px',
                  fontSize: '0.82rem',
                  color: '#991b1b',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                  ⚠ تنبيه: بونص السائق مُسوَّى (مدفوع فعلاً)
                </div>
                <div>
                  السائق <strong>{preview.driverBonus.username}</strong> استلم{' '}
                  <strong>{formatNumber(preview.driverBonus.amount)} €</strong> كتسوية.
                  إلغاء الطلب لا يسترد المبلغ تلقائياً.
                </div>
                <div style={{ marginTop: '6px', fontWeight: 600 }}>
                  → يجب استرداد المبلغ يدوياً من السائق وتسجيل العملية في الملاحظات.
                </div>
              </div>
            )}

            {/* Notes textarea — optional */}
            <div style={{ marginBottom: '12px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.78rem',
                  color: '#64748b',
                  marginBottom: '4px',
                }}
              >
                ملاحظات (اختياري)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات إضافية..."
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1.5px solid #d1d5db',
                  borderRadius: '8px',
                  fontFamily: "'Cairo', sans-serif",
                  fontSize: '0.85rem',
                }}
              />
            </div>

            {/* Error from submit attempt */}
            {error && (
              <div
                style={{
                  background: '#fee2e2',
                  color: '#991b1b',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  marginBottom: '12px',
                  fontSize: '0.82rem',
                }}
              >
                ⚠ {error}
              </div>
            )}
          </>
        )}

        <div className="modal-actions" style={{ marginTop: '16px' }}>
          <button
            className="btn btn-danger"
            style={{ flex: 1 }}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? 'جاري الإلغاء...' : 'تأكيد الإلغاء'}
          </button>
          <button className="btn btn-outline" onClick={onCancel}>
            تراجع
          </button>
        </div>
      </div>
    </div>
  );
}
